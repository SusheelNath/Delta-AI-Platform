import React, { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import useStore from '../../store/useStore';
import { searchSpaces, fullSavePolygons } from '../../api/client';
import { getColorForFunction, getCategoryIndex } from '../../utils/colorScheme';
import { unprojectPolygon, earClipTriangulate, computePolygonMetrics } from '../../utils/unprojectPolygon';
import { selectSpaceFromPolygon } from '../../utils/polygonOverrides';
import { buildEvacTooltip } from '../../utils/evacTooltip';
import DeltaSpinner from '../shared/DeltaSpinner';
import './XeokitViewer.css';

let Viewer, XKTLoaderPlugin, NavCubePlugin, StoreyViewsPlugin, SectionPlanesPlugin;
let XMesh, XReadableGeometry, XPhongMaterial, XbuildSphereGeometry;

async function loadXeokit() {
  if (Viewer) return;
  const sdk = await import('@xeokit/xeokit-sdk');
  Viewer = sdk.Viewer;
  XKTLoaderPlugin = sdk.XKTLoaderPlugin;
  NavCubePlugin = sdk.NavCubePlugin;
  StoreyViewsPlugin = sdk.StoreyViewsPlugin;
  SectionPlanesPlugin = sdk.SectionPlanesPlugin;
  XMesh = sdk.Mesh;
  XReadableGeometry = sdk.ReadableGeometry;
  XPhongMaterial = sdk.PhongMaterial;
  XbuildSphereGeometry = sdk.buildSphereGeometry;
}

const MEP_SPACE_CLASSES = new Set([
  'Void / shaft',
  'Technical / vertical core',
  'Technical / plant',
  'Vertical circulation / lift support',
  'Circulation',
  'Transition / circulation',
]);

// Heatmap gradient: t=0 → green (low), t=1 → red (high) — matches FloorPlanCanvas
function heatColorRGB(t) {
  const r = Math.min(1, t * 2);
  const g = Math.min(1, 2 - t * 2);
  const b = (1 - t) * 0.6;
  return [r, g, b];
}

// Evacuation-specific: 4 discrete bands with strong, readable colors
// t=0 → Excellent (green), t→0.33 → Good (yellow), t→0.66 → At Risk (orange), t→1 → Critical (red)
const EVAC_BANDS = [
  { max: 0.25, color: [0.18, 0.82, 0.42], label: 'Excellent' },  // #2ED16B
  { max: 0.50, color: [0.95, 0.85, 0.15], label: 'Good' },       // #F2D926
  { max: 0.75, color: [1.00, 0.55, 0.10], label: 'At Risk' },    // #FF8C1A
  { max: 1.01, color: [0.92, 0.15, 0.15], label: 'Critical' },   // #EB2626
];

function evacColorRGB(t) {
  for (const band of EVAC_BANDS) {
    if (t <= band.max) return band.color;
  }
  return EVAC_BANDS[3].color;
}

// Infrastructure functions to dim in evacuation mode
const EVAC_INFRA = new Set([
  'no access', 'ventilation shaft', 'corridor', 'shaft', 'void', 'riser',
  'circulation', 'lobby', 'entrance', 'vestibule',
]);

// Exit functions to mark as safe points
const EXIT_FUNCTIONS = new Set(['elevator', 'staircase']);

function throttle(fn, ms) {
  let last = 0, timer = null;
  return function (...args) {
    const now = Date.now();
    clearTimeout(timer);
    if (now - last >= ms) {
      last = now;
      fn.apply(this, args);
    } else {
      timer = setTimeout(() => { last = Date.now(); fn.apply(this, args); }, ms - (now - last));
    }
  };
}

const EMPTY = [];

// ── 4×4 matrix helpers for ray-plane intersection ──
function mulMat4(a, b) {
  const r = new Float64Array(16);
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      r[i * 4 + j] = a[i * 4] * b[j] + a[i * 4 + 1] * b[4 + j] + a[i * 4 + 2] * b[8 + j] + a[i * 4 + 3] * b[12 + j];
    }
  }
  return r;
}

function invertMat4(m) {
  const inv = new Float64Array(16);
  inv[0]  =  m[5]*m[10]*m[15] - m[5]*m[11]*m[14] - m[9]*m[6]*m[15] + m[9]*m[7]*m[14] + m[13]*m[6]*m[11] - m[13]*m[7]*m[10];
  inv[4]  = -m[4]*m[10]*m[15] + m[4]*m[11]*m[14] + m[8]*m[6]*m[15] - m[8]*m[7]*m[14] - m[12]*m[6]*m[11] + m[12]*m[7]*m[10];
  inv[8]  =  m[4]*m[9]*m[15]  - m[4]*m[11]*m[13] - m[8]*m[5]*m[15] + m[8]*m[7]*m[13] + m[12]*m[5]*m[11] - m[12]*m[7]*m[9];
  inv[12] = -m[4]*m[9]*m[14]  + m[4]*m[10]*m[13] + m[8]*m[5]*m[14] - m[8]*m[6]*m[13] - m[12]*m[5]*m[10] + m[12]*m[6]*m[9];
  inv[1]  = -m[1]*m[10]*m[15] + m[1]*m[11]*m[14] + m[9]*m[2]*m[15] - m[9]*m[3]*m[14] - m[13]*m[2]*m[11] + m[13]*m[3]*m[10];
  inv[5]  =  m[0]*m[10]*m[15] - m[0]*m[11]*m[14] - m[8]*m[2]*m[15] + m[8]*m[3]*m[14] + m[12]*m[2]*m[11] - m[12]*m[3]*m[10];
  inv[9]  = -m[0]*m[9]*m[15]  + m[0]*m[11]*m[13] + m[8]*m[1]*m[15] - m[8]*m[3]*m[13] - m[12]*m[1]*m[11] + m[12]*m[3]*m[9];
  inv[13] =  m[0]*m[9]*m[14]  - m[0]*m[10]*m[13] - m[8]*m[1]*m[14] + m[8]*m[2]*m[13] + m[12]*m[1]*m[10] - m[12]*m[2]*m[9];
  inv[2]  =  m[1]*m[6]*m[15]  - m[1]*m[7]*m[14]  - m[5]*m[2]*m[15] + m[5]*m[3]*m[14] + m[13]*m[2]*m[7]  - m[13]*m[3]*m[6];
  inv[6]  = -m[0]*m[6]*m[15]  + m[0]*m[7]*m[14]  + m[4]*m[2]*m[15] - m[4]*m[3]*m[14] - m[12]*m[2]*m[7]  + m[12]*m[3]*m[6];
  inv[10] =  m[0]*m[5]*m[15]  - m[0]*m[7]*m[13]  - m[4]*m[1]*m[15] + m[4]*m[3]*m[13] + m[12]*m[1]*m[7]  - m[12]*m[3]*m[5];
  inv[14] = -m[0]*m[5]*m[14]  + m[0]*m[6]*m[13]  + m[4]*m[1]*m[14] - m[4]*m[2]*m[13] - m[12]*m[1]*m[6]  + m[12]*m[2]*m[5];
  inv[3]  = -m[1]*m[6]*m[11]  + m[1]*m[7]*m[10]  + m[5]*m[2]*m[11] - m[5]*m[3]*m[10] - m[9]*m[2]*m[7]   + m[9]*m[3]*m[6];
  inv[7]  =  m[0]*m[6]*m[11]  - m[0]*m[7]*m[10]  - m[4]*m[2]*m[11] + m[4]*m[3]*m[10] + m[8]*m[2]*m[7]   - m[8]*m[3]*m[6];
  inv[11] = -m[0]*m[5]*m[11]  + m[0]*m[7]*m[9]   + m[4]*m[1]*m[11] - m[4]*m[3]*m[9]  - m[8]*m[1]*m[7]   + m[8]*m[3]*m[5];
  inv[15] =  m[0]*m[5]*m[10]  - m[0]*m[6]*m[9]   - m[4]*m[1]*m[10] + m[4]*m[2]*m[9]  + m[8]*m[1]*m[6]   - m[8]*m[2]*m[5];
  const det = m[0]*inv[0] + m[1]*inv[4] + m[2]*inv[8] + m[3]*inv[12];
  if (Math.abs(det) < 1e-12) return null;
  const id = 1.0 / det;
  for (let i = 0; i < 16; i++) inv[i] *= id;
  return inv;
}

function transformVec4(m, v) {
  const w = m[3]*v[0] + m[7]*v[1] + m[11]*v[2] + m[15]*v[3];
  const iw = w !== 0 ? 1.0 / w : 1.0;
  return [
    (m[0]*v[0] + m[4]*v[1] + m[8]*v[2]  + m[12]*v[3]) * iw,
    (m[1]*v[0] + m[5]*v[1] + m[9]*v[2]  + m[13]*v[3]) * iw,
    (m[2]*v[0] + m[6]*v[1] + m[10]*v[2] + m[14]*v[3]) * iw,
  ];
}

const GLASS_TYPES = {
  'IfcWindow':      { opacity: 0.55 },
  'IfcCurtainWall': { opacity: 0.50 },
};

let cachedXKT = null;

let cachedExclusions = null;

async function fetchExclusions() {
  if (cachedExclusions) return cachedExclusions;
  try {
    const res = await fetch('/models/exclusions.json');
    if (!res.ok) return [];
    cachedExclusions = await res.json();
    return cachedExclusions;
  } catch { return []; }
}

export default function XeokitViewer() {
  const canvasRef = useRef(null);
  const navCubeCanvasRef = useRef(null);
  const viewerRef = useRef(null);
  const modelRef = useRef(null);
  const highlightedRef = useRef(null);
  const modelAABBRef = useRef(null);
  const floorAABBCache = useRef(new Map()); // floorId → { xMin, zMin, xMax, zMax, yAvg }

  const setViewerReady = useStore((s) => s.setViewerReady);
  const setLoadProgress = useStore((s) => s.setLoadProgress);
  const setLoadStage = useStore((s) => s.setLoadStage);
  const selectSpace = useStore((s) => s.selectSpace);
  const clearSelection = useStore((s) => s.clearSelection);
  const floorVisibility = useStore((s) => s.floorVisibility);
  const selectedSpaceId = useStore((s) => s.selectedSpaceId);
  const activeFloorId = useStore((s) => s.activeFloorId);
  const setFloorSpaceGeometry = useStore((s) => s.setFloorSpaceGeometry);
  const activeFunctionFilters = useStore((s) => s.activeFunctionFilters);
  const setFloorToStoreyId = useStore((s) => s.setFloorToStoreyId);
  const setStoreyPluginRef = useStore((s) => s.setStoreyPluginRef);
  const mepVisible = useStore((s) => s.mepVisible);
  const setFloorSnapshot = useStore((s) => s.setFloorSnapshot);
  const floorTransitioning = useStore((s) => s.floorTransitioning);
  const setFloorTransitioning = useStore((s) => s.setFloorTransitioning);
  const heatmapMode = useStore((s) => s.heatmapMode);

  const [modelError, setModelError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadStatus, setLoadStatus] = useState('Initialising viewer...');
  const [polygonTooltip, setPolygonTooltip] = useState(null); // { name, area, x, y }
  const [transitionLabel, setTransitionLabel] = useState('');
  const [showTransition, setShowTransition] = useState(false);
  const [transitionFading, setTransitionFading] = useState(false);
  const showTransitionRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState(null); // { ok, msg }

  const handleFullSave = useCallback(async () => {
    setSaving(true);
    setSaveResult(null);
    try {
      const allPolygons = useStore.getState().floorPolygons;
      const payload = [];
      for (const [floorId, polys] of Object.entries(allPolygons)) {
        for (const p of polys) {
          if (!p.vertices || p.vertices.length < 3) continue;
          payload.push({
            ifc_guid: p.ifc_guid,
            floor_id: p.floor_id || floorId,
            vertices: p.vertices,
            space_name: p.space_name || null,
            primary_function: p.primary_function || null,
            area_m2: p.area_m2 ?? null,
            perimeter_cm: p.perimeter_cm ?? null,
          });
        }
      }
      const result = await fullSavePolygons(payload);
      setSaveResult({ ok: true, msg: `Saved ${result.saved} polygons` + (result.git_pushed ? ' — pushed to GitHub' : ' — git push failed') });
    } catch (err) {
      setSaveResult({ ok: false, msg: err.message });
    } finally {
      setSaving(false);
      setTimeout(() => setSaveResult(null), 4000);
    }
  }, []);

  // Fade-out transition overlay over 300ms before unmounting
  useEffect(() => {
    if (floorTransitioning) {
      showTransitionRef.current = true;
      setShowTransition(true);
      setTransitionFading(false);
    } else if (showTransitionRef.current) {
      setTransitionFading(true);
      const timer = setTimeout(() => {
        showTransitionRef.current = false;
        setShowTransition(false);
        setTransitionFading(false);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [floorTransitioning]);

  const storeyObjectsRef = useRef({});
  const mepIdsRef = useRef(new Set());
  const sectionPluginRef = useRef(null);
  const sectionPlaneRef = useRef(null);
  const xrayedIdsRef = useRef([]);
  const hiddenSlabsRef = useRef([]);
  const prevFloorRef = useRef(undefined); // track previous floor for transition guard

  // ── Initialize xeokit viewer ──
  useEffect(() => {
    let destroyed = false;
    let abortController = new AbortController();

    async function init() {
      try {
        await loadXeokit();
      } catch (err) {
        console.error('[Delta] Failed to load xeokit SDK:', err);
        setLoading(false);
        setModelError(true);
        return;
      }

      if (destroyed || !canvasRef.current) return;

      const viewer = new Viewer({
        canvasElement: canvasRef.current,
        transparent: false,
        logarithmicDepthBufferEnabled: true,
        preserveDrawingBuffer: true,
        antialias: true,
        gammaOutput: true,
        pbrEnabled: false,
      });

      viewer.scene.canvas.canvas.style.background = 'transparent';
      viewer.scene.canvas.backgroundColor = [235/255, 235/255, 240/255];
      viewer.camera.projection = 'perspective';
      viewer.camera.perspective.near = 1.0;

      // Highlight material (primary selection)
      viewer.scene.highlightMaterial.fill = true;
      viewer.scene.highlightMaterial.fillAlpha = 0.3;
      viewer.scene.highlightMaterial.fillColor = [0.91, 0.44, 0.20];
      viewer.scene.highlightMaterial.edges = true;
      viewer.scene.highlightMaterial.edgeAlpha = 0.8;
      viewer.scene.highlightMaterial.edgeColor = [1.0, 0.55, 0.30];

      // X-ray material (used for IfcSpace ghost outlines in floor plan view)
      viewer.scene.xrayMaterial.fill = true;
      viewer.scene.xrayMaterial.fillAlpha = 0.05;
      viewer.scene.xrayMaterial.fillColor = [0.7, 0.7, 0.72];
      viewer.scene.xrayMaterial.edges = false;

      if (navCubeCanvasRef.current) {
        const navCube = new NavCubePlugin(viewer, {
          canvasElement: navCubeCanvasRef.current,
          visible: true,
          color: '#c8c8d0',
          frontColor: '#d0d0d8',
          backColor: '#b8b8c0',
          leftColor: '#c4c4cc',
          rightColor: '#c4c4cc',
          topColor: '#d4d4dc',
          bottomColor: '#b0b0b8',
          hoverColor: 'rgba(231, 113, 51, 0.30)',
          textColor: '#000000',
          highColor: '#E77133',
          shadowVisible: false,
          cameraFlyDuration: 0.4,
          fitVisible: false,
        });
        // Hack internal scene — config edgeColor & resolutionScale are not wired up
        try {
          const ncScene = navCube._navCubeScene;
          if (ncScene && ncScene.edgeMaterial) {
            ncScene.edgeMaterial.edgeColor = [0.91, 0.44, 0.20];
            ncScene.edgeMaterial.edgeAlpha = 1.0;
          }
          // Boost canvas backing resolution for crisp text
          if (ncScene && ncScene.canvas) {
            ncScene.canvas.resolutionScale = window.devicePixelRatio || 2;
          }
        } catch (_) { /* non-critical */ }
      }

      const xktLoader = new XKTLoaderPlugin(viewer);
      viewerRef.current = viewer;

      // ── Download XKT ──
      let xktData = cachedXKT;

      if (!xktData) {
        setLoadStatus('Downloading 3D model (227 MB)...');
        setLoadStage('Downloading 3D model...');
        setLoadProgress(8);
        console.log('[Delta] Starting XKT download...');

        try {
          const response = await fetch('/models/hospital.xkt', {
            signal: abortController.signal,
          });
          if (!response.ok) throw new Error(`HTTP ${response.status} fetching model`);

          const contentLength = response.headers.get('content-length');
          const total = contentLength ? parseInt(contentLength, 10) : 0;
          const reader = response.body.getReader();
          const chunks = [];
          let received = 0;

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            received += value.length;
            if (total > 0) {
              const pct = Math.round((received / total) * 100);
              setLoadStatus(`Downloading 3D model... ${pct}%`);
              setLoadProgress(8 + Math.round(pct * 0.72));
            }
          }

          if (destroyed) return;

          const combined = new Uint8Array(received);
          let offset = 0;
          for (const chunk of chunks) {
            combined.set(chunk, offset);
            offset += chunk.length;
          }

          xktData = combined.buffer;
          cachedXKT = xktData;
          console.log(`[Delta] Download complete: ${(received / 1024 / 1024).toFixed(1)} MB`);
        } catch (err) {
          if (err.name === 'AbortError') {
            console.log('[Delta] Download aborted (component unmounted)');
            return;
          }
          console.error('[Delta] Download failed:', err);
          if (!destroyed) { setLoading(false); setModelError(true); }
          return;
        }
      } else {
        console.log('[Delta] Using cached XKT data');
      }

      if (destroyed) return;

      // ── Parse model ──
      setLoadStatus('Parsing geometry...');
      setLoadStage('Parsing geometry...');
      setLoadProgress(82);

      try {
        const model = xktLoader.load({ id: 'hospital', xkt: xktData, edges: false });
        modelRef.current = model;

        model.on('loaded', () => {
          if (destroyed) return;

          const objCount = Object.keys(viewer.scene.objects).length;
          const aabb = viewer.scene.aabb;
          console.log(`[Delta] Model loaded: ${objCount} objects`);
          console.log(`[Delta] Scene AABB: [${aabb.map(v => v.toFixed(1)).join(', ')}]`);

          modelAABBRef.current = [...aabb];

          setLoadStatus('Colouring spaces...');
          setLoadStage('Colouring spaces...');
          setLoadProgress(88);
          hideStructuralElements(viewer);
          applyExclusions(viewer);
          buildStoreyMapping(viewer);
          applyGlassTransparency(viewer);
          colorByFunction(viewer);
          applyElementColorOverrides(viewer);
          extractFloorGeometry(viewer);
          buildMepSet();

          // Initialize StoreyViewsPlugin for rendered floor plans
          try {
            const storeyPlugin = new StoreyViewsPlugin(viewer, { fitStoreyMaps: true });
            setStoreyPluginRef(storeyPlugin);
            console.log('[Delta] StoreyViewsPlugin initialized,', Object.keys(storeyPlugin.storeys || {}).length, 'storeys');
          } catch (err) {
            console.warn('[Delta] StoreyViewsPlugin init failed:', err);
          }

          // Initialize SectionPlanesPlugin for floor cutaway
          try {
            sectionPluginRef.current = new SectionPlanesPlugin(viewer, {
              overviewVisible: false,
            });
            console.log('[Delta] SectionPlanesPlugin initialized');
          } catch (err) {
            console.warn('[Delta] SectionPlanesPlugin init failed:', err);
          }

          viewer.cameraFlight.flyTo({ aabb, duration: 0.5 }, () => {
            console.log('[Delta] Camera positioned at model');
          });

          // Expose metaScene extraction for rename registry export
          window.__deltaExportMetaScene = async () => {
            const metaObjects = viewer.metaScene?.metaObjects;
            if (!metaObjects) return null;
            const elements = [];
            for (const [id, mo] of Object.entries(metaObjects)) {
              elements.push({
                id,
                type: mo.type || 'Unknown',
                name: mo.name || null,
                parent_name: mo.parent?.name || null,
                parent_type: mo.parent?.type || null,
              });
            }
            return elements;
          };

          setLoadStage('Ready');
          setLoadProgress(100);
          setLoading(false);
          setViewerReady(true);
        });

        model.on('error', (err) => {
          console.error('[Delta] Model parse error:', err);
          if (!destroyed) { setLoading(false); setModelError(true); }
        });
      } catch (err) {
        console.error('[Delta] xktLoader.load() threw:', err);
        if (!destroyed) { setLoading(false); setModelError(true); }
        return;
      }

      // ── Instant click — disable double-click delay ──
      viewer.cameraControl.doubleClickTimeFrame = 0;

      // ── Click handler — select whichever polygon is currently hovered ──
      viewer.cameraControl.on('picked', async () => {
        const ifcGuid = useStore.getState().hoveredPolygonGuid;
        if (!ifcGuid) return;

        // Clear any previously highlighted IfcSpace
        if (highlightedRef.current) {
          const prev = viewer.scene.objects[highlightedRef.current];
          if (prev) prev.highlighted = false;
          highlightedRef.current = null;
        }

        // Use the shared helper so all selection paths produce identical metadata
        const floorId = useStore.getState().activeFloorId;
        const floorPolys = floorId ? (useStore.getState().floorPolygons[floorId] || []) : [];
        const polyData = floorPolys.find((p) => p.ifc_guid === ifcGuid);
        if (polyData) {
          selectSpaceFromPolygon(polyData, floorId);
        } else {
          // Polygon not in store (rare) — use intelligence cache fallback
          const intel = useStore.getState().getIntelligence(ifcGuid);
          selectSpace(ifcGuid, intel || { ifc_guid: ifcGuid, floor_id: floorId });
        }
      });

      viewer.cameraControl.on('pickedNothing', () => {
        if (highlightedRef.current) {
          const prev = viewer.scene.objects[highlightedRef.current];
          if (prev) prev.highlighted = false;
          highlightedRef.current = null;
        }
        useStore.getState().setHoveredPolygonGuid(null);
        useStore.getState().clearHighlights();
        clearSelection();
      });

      // ── Hover handler: pointer cursor + tooltip over polygon meshes ──
      const canvasEl = viewer.scene.canvas.canvas;
      let lastHoveredGuid = null;

      const processHover = throttle((e) => {
        if (!e || !e.entity) return;
        const id = e.entity.id;
        if (id.startsWith('polygon-')) {
          const ifcGuid = id.slice('polygon-'.length);
          if (ifcGuid !== lastHoveredGuid) {
            lastHoveredGuid = ifcGuid;
            useStore.getState().setHoveredPolygonGuid(ifcGuid);
          }
          const st = useStore.getState();
          const floorId = st.activeFloorId;
          const polygons = floorId ? (st.floorPolygons[floorId] || []) : [];
          const poly = polygons.find((p) => p.ifc_guid === ifcGuid);
          if (poly) {
            const tip = {
              name: poly.space_name || poly.primary_function || ifcGuid,
              area: poly.area_m2 != null ? `${Number(poly.area_m2).toFixed(1)} m²` : null,
              x: e.canvasPos[0] + 14,
              y: e.canvasPos[1] - 10,
            };

            // Enrich tooltip in evacuation mode
            if (st.heatmapMode === 'evacuation') {
              buildEvacTooltip(tip, poly, polygons);
            }

            // Enrich tooltip with find_room reasoning
            const frResults = st.findRoomResults;
            if (frResults && frResults[ifcGuid]) {
              const fr = frResults[ifcGuid];
              tip.findRoom = true;
              tip.findRoomType = fr.type;
              tip.findRoomCapacity = fr.capacity;
              tip.findRoomReason = fr.reason;
              tip.findRoomScore = fr.score;
              tip.fn = poly.primary_function || '';
              tip.zone = poly.functional_zone || '';
              tip.areaM2 = poly.area_m2 != null ? Number(poly.area_m2).toFixed(1) : null;
            }

            setPolygonTooltip(tip);
          }
        } else if (lastHoveredGuid !== null) {
          lastHoveredGuid = null;
          useStore.getState().setHoveredPolygonGuid(null);
          setPolygonTooltip(null);
        }
      }, 60);

      viewer.cameraControl.on('hover', (e) => {
        if (!e || !e.entity) {
          if (lastHoveredGuid !== null) {
            lastHoveredGuid = null;
            useStore.getState().setHoveredPolygonGuid(null);
            setPolygonTooltip(null);
          }
          canvasEl.style.cursor = '';
          return;
        }
        const id = e.entity.id;
        canvasEl.style.cursor = id.startsWith('polygon-') ? 'pointer' : '';
        processHover(e);
      });

      viewer.cameraControl.on('hoverOut', () => {
        canvasEl.style.cursor = '';
        lastHoveredGuid = null;
        useStore.getState().setHoveredPolygonGuid(null);
        setPolygonTooltip(null);
      });
    }

    init();

    return () => {
      destroyed = true;
      abortController.abort();
      if (viewerRef.current) {
        viewerRef.current.destroy();
        viewerRef.current = null;
      }
    };
  }, []);

  // ── Hide structural elements (piles, footings, columns) ──
  function hideStructuralElements(viewer) {
    const metaObjects = viewer.metaScene?.metaObjects;
    if (!metaObjects) return;
    const hideTypes = new Set(['IfcPile', 'IfcFooting', 'IfcColumn']);
    let hidden = 0;
    for (const [id, metaObj] of Object.entries(metaObjects)) {
      if (hideTypes.has(metaObj.type)) {
        const obj = viewer.scene.objects[id];
        if (obj) { obj.visible = false; hidden++; }
      }
    }
    console.log(`[Delta] Hidden ${hidden} structural elements (piles/footings/columns)`);
  }

  // ── Apply exclusions from static JSON on load ──
  async function applyExclusions(viewer) {
    const excluded = await fetchExclusions();
    let applied = 0;
    for (const id of excluded) {
      const obj = viewer.scene.objects[id];
      if (obj) { obj.visible = false; applied++; }
    }
    if (excluded.length > 0) {
      console.log(`[Delta] Applied ${applied}/${excluded.length} exclusions from exclusions.json`);
    }
  }

  // ── Build storey mapping ──
  function buildStoreyMapping(viewer) {
    const mapping = {};
    const floorToStorey = {};
    const metaObjects = viewer.metaScene?.metaObjects;
    if (!metaObjects) return;
    for (const [id, metaObj] of Object.entries(metaObjects)) {
      if (metaObj.type === 'IfcBuildingStorey') {
        const childIds = collectChildIds(metaObj);
        mapping[id] = childIds;
        const name = metaObj.name || '';
        const floorMatch = name.match(/H\d{3}/i);
        if (floorMatch) {
          const floorId = floorMatch[0].toUpperCase();
          if (!mapping[floorId]) {
            mapping[floorId] = childIds;
          } else {
            const existing = new Set(mapping[floorId]);
            childIds.forEach((cid) => existing.add(cid));
            mapping[floorId] = [...existing];
          }
          if (!floorToStorey[floorId]) {
            floorToStorey[floorId] = id;
          }
        }
      }
    }
    storeyObjectsRef.current = mapping;
    setFloorToStoreyId(floorToStorey);
    console.log('[Delta] Storey mapping:', Object.keys(mapping).length, 'storeys');
    console.log('[Delta] Floor-to-storey IDs:', Object.keys(floorToStorey).join(', '));
  }

  function collectChildIds(metaObj) {
    const ids = [];
    function walk(mo) {
      if (mo.id) ids.push(mo.id);
      if (mo.children) { for (const child of mo.children) walk(child); }
    }
    if (metaObj.children) { for (const child of metaObj.children) walk(child); }
    return ids;
  }

  // ── Apply glass transparency to windows / curtain walls ──
  function applyGlassTransparency(viewer) {
    const metaObjects = viewer.metaScene?.metaObjects;
    if (!metaObjects) return;
    let applied = 0;
    for (const [id, metaObj] of Object.entries(metaObjects)) {
      const glass = GLASS_TYPES[metaObj.type];
      if (!glass) continue;
      const obj = viewer.scene.objects[id];
      if (!obj) continue;
      obj.opacity = glass.opacity;
      applied++;
    }
    console.log(`[Delta] Applied glass transparency to ${applied} elements`);
  }

  // ── Color by function ──
  function colorByFunction(viewer) {
    const metaObjects = viewer.metaScene?.metaObjects;
    if (!metaObjects) return;
    for (const [id, obj] of Object.entries(viewer.scene.objects)) {
      const metaObj = metaObjects[id];
      if (metaObj && metaObj.type === 'IfcSpace') {
        obj.colorize = getColorForFunction(metaObj.name || '');
        obj.opacity = 0.85;
      }
    }
  }

  // ── Per-element color overrides (applied after colorByFunction) ──
  const ELEMENT_COLOR_OVERRIDES = {
    '2dXBJaEM1BReUR07kz7NA1': [0.55, 0.57, 0.62],
    '3jgtwS1EH6jOj3i4pQgEmi': [0.55, 0.57, 0.62],
    '0Y2h8VME5AWvcAclFiBlXG': [0.55, 0.57, 0.62],
    '05GXCJWHrCGxE4mU7PVyFZ': [0.55, 0.57, 0.62],
    '2A0H3kuVn1HunsV3vdOHwD': [0.55, 0.57, 0.62],
    '2K5XXoyg9BHhrc9$Ya2uwB': [0.55, 0.57, 0.62],
    '3jhv1hhAjEOALm1re0PIjO': [0.55, 0.57, 0.62],
    '2P0a3mup52o9zTOesMO5Xv': [0.55, 0.57, 0.62],
    '2l2c39k4X25AisbVd27tok': [0.78, 0.80, 0.82],
    '0$XbCuEHb379S23ihwhGue': [0.78, 0.80, 0.82],
    '02KHbdq85F0gVMsBrMfo_n': [0.78, 0.80, 0.82],
    '3G9W4WfvbBBA2RSAXyYjSD': [0.78, 0.80, 0.82],
    '05bes2cs98P9SO5E9YkZZE': [0.78, 0.80, 0.82],
    '1bM80eh4L9NhDLykMYbqxM': [0.78, 0.80, 0.82],
    '2ecJUeL0PFmwbRBWFJx9RP': [0.78, 0.80, 0.82],
    '2QlRG69pzAY9Wcg9UHM5Nt': [0.78, 0.80, 0.82],
    '3INOHyKIj2xxK$ndX9bhIA': [0.78, 0.80, 0.82],
    '2Xf1kNTYD4fxfR8$Zqv$Jf': [0.78, 0.80, 0.82],
    '1b1JWMdwX1wx3jDPiUQPzx': [0.78, 0.80, 0.82],
    '368E3ezHzD4Q$j2ZpQ0gPH': [0.78, 0.80, 0.82],
  };

  // ── Name-based color overrides (applied after per-element overrides) ──
  const NAME_COLOR_OVERRIDES = [
    { pattern: 'Screed', color: [0.78, 0.80, 0.82] },
  ];

  function applyElementColorOverrides(viewer) {
    for (const [guid, color] of Object.entries(ELEMENT_COLOR_OVERRIDES)) {
      const obj = viewer.scene.objects[guid];
      if (obj) {
        obj.colorize = [1, 1, 1];
        obj.colorize = color;
        obj.opacity = 1.0;
      } else {
        console.warn(`[Delta] Color override: entity ${guid} not found in scene`);
      }
    }
    // Apply name-based color overrides
    const metaObjects = viewer.metaScene?.metaObjects;
    if (metaObjects) {
      let nameOverrides = 0;
      for (const [id, metaObj] of Object.entries(metaObjects)) {
        const name = metaObj.name || '';
        for (const { pattern, color } of NAME_COLOR_OVERRIDES) {
          if (name.includes(pattern)) {
            const obj = viewer.scene.objects[id];
            if (obj) { obj.colorize = color; obj.opacity = 1.0; nameOverrides++; }
            break;
          }
        }
      }
      console.log(`[Delta] Applied ${nameOverrides} name-based color overrides`);
    }

    // Tint white/whitish materials on +2 floor (H020) to a warm cream
    const h020Ids = storeyObjectsRef.current['H020'] || [];
    if (h020Ids.length > 0 && metaObjects) {
      const CREAM = [0.96, 0.92, 0.84];
      let tinted = 0;
      for (const id of h020Ids) {
        const meta = metaObjects[id];
        if (meta && meta.type === 'IfcSpace') continue; // skip — colored by function
        const obj = viewer.scene.objects[id];
        if (!obj) continue;
        const c = obj.colorize;
        if (c && c[0] > 0.85 && c[1] > 0.85 && c[2] > 0.85) {
          obj.colorize = CREAM;
          tinted++;
        }
      }
      console.log(`[Delta] Tinted ${tinted} white elements on H020 to cream`);
    }
  }

  // ── Extract floor geometry for 2D plan ──
  function extractFloorGeometry(viewer) {
    const metaObjects = viewer.metaScene?.metaObjects;
    if (!metaObjects) return;
    const mapping = storeyObjectsRef.current;

    for (const [key, objectIds] of Object.entries(mapping)) {
      if (!/^H\d{3}$/i.test(key)) continue;
      const floorId = key.toUpperCase();
      const spaces = [];

      for (const objId of objectIds) {
        const meta = metaObjects[objId];
        if (!meta || meta.type !== 'IfcSpace') continue;
        const entity = viewer.scene.objects[objId];
        if (!entity) continue;

        const aabb = entity.aabb;
        const name = meta.name || '';
        spaces.push({
          id: objId,
          x: aabb[0],
          y: (aabb[1] + aabb[4]) / 2,
          yTop: aabb[4],
          z: aabb[2],
          w: aabb[3] - aabb[0],
          d: aabb[5] - aabb[2],
          name,
          categoryIndex: getCategoryIndex(name),
        });
      }

      setFloorSpaceGeometry(floorId, spaces);
      console.log(`[Delta] Floor ${floorId}: ${spaces.length} IfcSpace extracted from ${objectIds.length} storey children`);
    }

    // Diagnostic: count ALL IfcSpace in the entire model vs what was captured
    let totalIfcSpaces = 0;
    const capturedIds = new Set();
    for (const [key, objectIds] of Object.entries(mapping)) {
      if (!/^H\d{3}$/i.test(key)) continue;
      for (const oid of objectIds) {
        const meta = metaObjects[oid];
        if (meta && meta.type === 'IfcSpace') capturedIds.add(oid);
      }
    }
    const orphaned = [];
    for (const [id, meta] of Object.entries(metaObjects)) {
      if (meta.type !== 'IfcSpace') continue;
      totalIfcSpaces++;
      if (!capturedIds.has(id)) {
        const parentType = meta.parent?.type || 'none';
        const parentName = meta.parent?.name || 'unnamed';
        orphaned.push({ id, name: meta.name, parentType, parentName });
      }
    }
    console.log(`[Delta] DIAGNOSTIC: ${totalIfcSpaces} total IfcSpace in model, ${capturedIds.size} mapped to floors, ${orphaned.length} orphaned`);
    if (orphaned.length > 0) {
      console.table(orphaned.slice(0, 30));
      // Log parent type distribution for orphans
      const parentDist = {};
      for (const o of orphaned) {
        const key = `${o.parentType} (${o.parentName})`;
        parentDist[key] = (parentDist[key] || 0) + 1;
      }
      console.log('[Delta] Orphan parent distribution:', parentDist);
    }
    console.log('[Delta] Floor geometry extracted for 2D plans');
  }

  // ── Build MEP object set from API data ──
  async function buildMepSet() {
    try {
      const allSpaces = await searchSpaces({});
      const mepIds = new Set();
      for (const sp of allSpaces) {
        if (!sp.ifc_guid) continue;
        const isMep = MEP_SPACE_CLASSES.has(sp.space_class || '') || sp.occupiable === 'No';
        if (isMep) mepIds.add(sp.ifc_guid);
      }
      mepIdsRef.current = mepIds;
      console.log(`[Delta] MEP set built: ${mepIds.size} infrastructure objects`);

      // Apply initial state (hide MEP by default)
      const viewer = viewerRef.current;
      if (viewer) {
        const ids = [...mepIds].filter((id) => viewer.scene.objects[id]);
        if (ids.length > 0) viewer.scene.setObjectsVisible(ids, false);
      }
    } catch (err) {
      console.warn('[Delta] Failed to build MEP set:', err);
    }
  }

  // ── Watch mepVisible → show/hide MEP in 3D ──
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || mepIdsRef.current.size === 0) return;
    const excludedSet = new Set(cachedExclusions || []);
    const ids = [...mepIdsRef.current].filter((id) => {
      if (excludedSet.has(id)) return false; // respect permanent exclusions
      return !!viewer.scene.objects[id];
    });
    if (ids.length === 0) return;
    viewer.scene.setObjectsVisible(ids, mepVisible);
  }, [mepVisible]);

  // ── Project space centers to canvas percentage coordinates ──
  function projectSpaces(viewer, spaces) {
    const viewMat = viewer.camera.viewMatrix;
    const projMat = viewer.camera.projMatrix;
    const positions = [];
    for (const space of spaces) {
      const wx = space.x + space.w / 2;
      const wy = space.y;
      const wz = space.z + space.d / 2;
      const vx = viewMat[0]*wx + viewMat[4]*wy + viewMat[8]*wz + viewMat[12];
      const vy = viewMat[1]*wx + viewMat[5]*wy + viewMat[9]*wz + viewMat[13];
      const vz = viewMat[2]*wx + viewMat[6]*wy + viewMat[10]*wz + viewMat[14];
      const vw = viewMat[3]*wx + viewMat[7]*wy + viewMat[11]*wz + viewMat[15];
      const cx = projMat[0]*vx + projMat[4]*vy + projMat[8]*vz + projMat[12]*vw;
      const cy = projMat[1]*vx + projMat[5]*vy + projMat[9]*vz + projMat[13]*vw;
      const cw = projMat[3]*vx + projMat[7]*vy + projMat[11]*vz + projMat[15]*vw;
      if (cw <= 0) continue;
      const pctX = (cx / cw + 1) * 0.5 * 100;
      const pctY = (1 - cy / cw) * 0.5 * 100;
      if (pctX < -5 || pctX > 105 || pctY < -5 || pctY > 105) continue;
      positions.push({ id: space.id, name: space.name, leftPct: pctX, topPct: pctY });
    }
    return positions;
  }

  // Track pending hi-res capture so we can cancel on floor switch
  const pendingHiResRef = useRef(null); // { cancelled: boolean, origW, origH, origStyleW, origStyleH }

  // ── Capture snapshot at a given scale, return Blob URL via callback ──
  function captureAtScale(viewer, scaleFactor, callback) {
    const canvas = viewer.scene.canvas.canvas;
    const origW = canvas.width;
    const origH = canvas.height;
    const origStyleW = canvas.style.width;
    const origStyleH = canvas.style.height;

    canvas.width = origW * scaleFactor;
    canvas.height = origH * scaleFactor;
    canvas.style.width = origStyleW;
    canvas.style.height = origStyleH;
    viewer.scene.glRedraw();
    viewer.scene.render(true);

    const resW = canvas.width;
    const resH = canvas.height;

    const handle = { cancelled: false, origW, origH, origStyleW, origStyleH };

    // Use toBlob for async, memory-efficient encoding
    canvas.toBlob((blob) => {
      // Restore original size (even if cancelled, always restore canvas)
      canvas.width = origW;
      canvas.height = origH;
      canvas.style.width = origStyleW;
      canvas.style.height = origStyleH;
      viewer.scene.glRedraw();

      if (blob && !handle.cancelled) {
        const url = URL.createObjectURL(blob);
        callback(url, resW, resH);
      }
    }, 'image/jpeg', 0.92);

    return handle;
  }

  // ── Two-tier floor snapshot: fast 2x immediately, then 6x hi-res ──
  const captureFloorSnapshot = useCallback((viewer, floorId) => {
    // Cancel any pending hi-res capture from a previous floor to prevent
    // the canvas being at 6x size when we read matrices below
    if (pendingHiResRef.current && !pendingHiResRef.current.cancelled) {
      pendingHiResRef.current.cancelled = true;
      // Force-restore canvas if it's currently at an enlarged size
      const h = pendingHiResRef.current;
      const canvas = viewer.scene.canvas.canvas;
      if (canvas.width !== h.origW || canvas.height !== h.origH) {
        canvas.width = h.origW;
        canvas.height = h.origH;
        canvas.style.width = h.origStyleW;
        canvas.style.height = h.origStyleH;
        viewer.scene.glRedraw();
        viewer.scene.render(true);
      }
    }
    pendingHiResRef.current = null;

    const geometry = useStore.getState().floorSpaceGeometry;
    const spaces = geometry[floorId] || [];
    const spacePositions = projectSpaces(viewer, spaces);

    // Always capture fresh matrices from the deterministic flyToFloorPlan camera position
    const viewMatrix = [...viewer.camera.viewMatrix];
    const projMatrix = [...viewer.camera.projMatrix];

    // Tier 1: fast 2x capture for immediate display
    captureAtScale(viewer, 2, (imageUrl, w, h) => {
      setFloorSnapshot(floorId, { imageUrl, spacePositions, viewMatrix, projMatrix });
      console.log(`[Delta] Fast snapshot for ${floorId}: ${w}x${h}px, ${spacePositions.length} spaces`);

      // Tier 2: hi-res 6x capture in background — only if still on the same floor
      requestAnimationFrame(() => {
        if (!viewerRef.current) return;
        if (useStore.getState().activeFloorId !== floorId) return; // floor changed, skip hi-res
        const handle = captureAtScale(viewerRef.current, 6, (hiResUrl, hw, hh) => {
          // Revoke the old fast URL
          const prev = useStore.getState().floorSnapshots[floorId];
          if (prev?.imageUrl && prev.imageUrl !== hiResUrl) {
            URL.revokeObjectURL(prev.imageUrl);
          }
          setFloorSnapshot(floorId, { imageUrl: hiResUrl });
          console.log(`[Delta] Hi-res snapshot for ${floorId}: ${hw}x${hh}px`);
        });
        pendingHiResRef.current = handle;
      });
    });
  }, [setFloorSnapshot]);

  // ── Fly to top-down tilted view for a floor ──
  const flyToFloorPlan = useCallback((viewer, floorId) => {
    const geometry = useStore.getState().floorSpaceGeometry;
    const spaces = geometry[floorId];
    if (!spaces || spaces.length === 0) return;

    let aabb = floorAABBCache.current.get(floorId);
    if (!aabb) {
      let xMin = Infinity, zMin = Infinity, xMax = -Infinity, zMax = -Infinity, ySum = 0;
      for (const s of spaces) {
        if (s.x < xMin) xMin = s.x;
        if (s.z < zMin) zMin = s.z;
        if (s.x + s.w > xMax) xMax = s.x + s.w;
        if (s.z + s.d > zMax) zMax = s.z + s.d;
        ySum += s.y || 0;
      }
      aabb = { xMin, zMin, xMax, zMax, yAvg: ySum / spaces.length };
      floorAABBCache.current.set(floorId, aabb);
    }
    const { xMin, zMin, xMax, zMax, yAvg } = aabb;

    const cx = (xMin + xMax) / 2;
    const cz = (zMin + zMax) / 2;
    const maxRange = Math.max(xMax - xMin, zMax - zMin);

    // Height above floor to see everything; slight tilt offset (~80° angle)
    const heightMul = floorId === 'H050' ? 3.4
      : new Set(['H010', 'H020', 'H030', 'H040']).has(floorId) ? 1.8
      : 1.3;
    const height = maxRange * heightMul;
    const tiltOffset = height * 0.18; // tan(10°) ≈ 0.176

    viewer.cameraFlight.flyTo({
      eye: [cx, yAvg + height, cz + tiltOffset],
      look: [cx, yAvg, cz],
      up: [0, 0, -1],
      duration: 1.0,
    });
  }, []);

  // ── Watch activeFloorId → fly to top-down, xray IfcSpace, section plane ──
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || loading) return;

    // ── Begin floor transition ──
    // Destroy old polygon meshes immediately to prevent stale 3D overlays
    for (const mesh of savedMeshesRef.current.values()) {
      try { mesh.destroy(); } catch {}
    }
    savedMeshesRef.current.clear();

    // Only show transition overlay when actively switching floors (not on initial load)
    const isInitial = prevFloorRef.current === undefined;
    const floorChanged = prevFloorRef.current !== activeFloorId;
    prevFloorRef.current = activeFloorId;

    if (!isInitial && floorChanged) {
      const floors = useStore.getState().floors;
      const targetFloor = activeFloorId
        ? floors.find((f) => f.id === activeFloorId)
        : null;
      const label = targetFloor
        ? (targetFloor.name || targetFloor.shortLabel || activeFloorId)
        : 'All floors';
      setTransitionLabel(label);
      setFloorTransitioning(true);
    }

    // Clean up previous state
    if (sectionPlaneRef.current) {
      sectionPlaneRef.current.destroy();
      sectionPlaneRef.current = null;
    }
    for (const oid of xrayedIdsRef.current) {
      const entity = viewer.scene.objects[oid];
      if (entity) entity.xrayed = false;
    }
    xrayedIdsRef.current = [];
    // Restore previously hidden slabs
    for (const oid of hiddenSlabsRef.current) {
      const entity = viewer.scene.objects[oid];
      if (entity) entity.visible = true;
    }
    hiddenSlabsRef.current = [];
    // Re-apply element color overrides after slab restore
    applyElementColorOverrides(viewer);

    const metaObjects = viewer.metaScene?.metaObjects;

    if (activeFloorId) {
      // Cancel any in-progress flight before starting new one
      try { viewer.cameraFlight.cancel(); } catch {}
      flyToFloorPlan(viewer, activeFloorId);

      const mapping = storeyObjectsRef.current;
      const objectIds = mapping[activeFloorId] || [];

      // X-ray IfcSpace on this floor (ghost wireframe, no solid Z-fighting faces)
      const xrayed = [];
      let maxY = -Infinity;
      for (const oid of objectIds) {
        const meta = metaObjects?.[oid];
        if (!meta || meta.type !== 'IfcSpace') continue;
        const entity = viewer.scene.objects[oid];
        if (!entity) continue;
        entity.xrayed = true;
        xrayed.push(oid);
        const topY = entity.aabb[4];
        if (topY > maxY) maxY = topY;
      }
      xrayedIdsRef.current = xrayed;

      // Hide ALL IfcSlab and IfcCovering across the ENTIRE scene
      const slabTypes = new Set(['IfcSlab', 'IfcCovering']);
      const hiddenSlabs = [];
      if (metaObjects) {
        for (const [oid, meta] of Object.entries(metaObjects)) {
          if (!slabTypes.has(meta.type)) continue;
          const entity = viewer.scene.objects[oid];
          if (entity && entity.visible) {
            entity.visible = false;
            hiddenSlabs.push(oid);
          }
        }
      }
      hiddenSlabsRef.current = hiddenSlabs;

      // Section plane at ceiling to clip from above
      if (sectionPluginRef.current && maxY > -Infinity) {
        const clipY = maxY - 0.15;
        sectionPlaneRef.current = sectionPluginRef.current.createSectionPlane({
          pos: [0, clipY, 0],
          dir: [0, -1, 0],
          active: true,
        });
      }
      console.log(`[Delta] Floor plan: x-rayed ${xrayed.length} spaces, hidden ${hiddenSlabs.length} slabs/coverings, section plane active`);

      // Capture snapshot when camera flight arrives, then end transition
      let cancelled = false;
      let settleTimer = null;
      const subId = viewer.cameraFlight.on('stopped', () => {
        viewer.cameraFlight.off(subId);
        if (cancelled || !viewerRef.current) return;
        settleTimer = setTimeout(() => {
          if (!cancelled && viewerRef.current) {
            captureFloorSnapshot(viewerRef.current, activeFloorId);
            // Small delay for snapshot to propagate and polygon meshes to rebuild
            setTimeout(() => { if (!cancelled) setFloorTransitioning(false); }, 200);
          }
        }, 100);
      });
      return () => {
        cancelled = true;
        viewer.cameraFlight.off(subId);
        if (settleTimer) clearTimeout(settleTimer);
      };
    } else {
      // All floors — fly back to full model perspective
      const aabb = modelAABBRef.current || viewer.scene.aabb;
      viewer.cameraFlight.flyTo({ aabb, duration: 1.0 });
      // End transition after flight duration
      const flightTimer = setTimeout(() => setFloorTransitioning(false), 1200);
      return () => clearTimeout(flightTimer);
    }
  }, [activeFloorId, loading, flyToFloorPlan, captureFloorSnapshot, setFloorTransitioning]);

  // ── Watch floor visibility ──
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !viewer.scene) return;
    const mapping = storeyObjectsRef.current;
    if (!mapping || Object.keys(mapping).length === 0) return;
    const excludedSet = new Set(cachedExclusions || []);
    const hideTypes = new Set(['IfcPile', 'IfcFooting', 'IfcColumn']);
    const metaObjects = viewer.metaScene?.metaObjects;
    const mepIds = mepIdsRef.current;
    const showMep = useStore.getState().mepVisible;
    for (const [floorId, objectIds] of Object.entries(mapping)) {
      const visible = floorVisibility[floorId] !== false;
      const existingIds = objectIds.filter((oid) => viewer.scene.objects[oid]);
      if (existingIds.length === 0) continue;
      if (visible) {
        const showIds = existingIds.filter((oid) => {
          if (excludedSet.has(oid)) return false;
          const meta = metaObjects?.[oid];
          if (meta && hideTypes.has(meta.type)) return false;
          if (!showMep && mepIds.has(oid)) return false;
          return true;
        });
        if (showIds.length > 0) viewer.scene.setObjectsVisible(showIds, true);
      } else {
        viewer.scene.setObjectsVisible(existingIds, false);
      }
    }
  }, [floorVisibility]);

  // ── Watch selectedSpaceId ──
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    if (!selectedSpaceId) {
      if (highlightedRef.current) {
        const prev = viewer.scene.objects[highlightedRef.current];
        if (prev) prev.highlighted = false;
        highlightedRef.current = null;
      }
      useStore.getState().setHoveredPolygonGuid(null);
      const floorId = useStore.getState().activeFloorId;
      if (floorId) {
        flyToFloorPlan(viewer, floorId);
      } else {
        const aabb = modelAABBRef.current || viewer.scene.aabb;
        viewer.cameraFlight.flyTo({ aabb, duration: 1.0 });
      }
      return;
    }

    if (highlightedRef.current) {
      const prev = viewer.scene.objects[highlightedRef.current];
      if (prev) prev.highlighted = false;
      highlightedRef.current = null;
    }

    // Only fly camera when in free 3D mode (no active floor plan)
    const spaceObj = viewer.scene.objects[selectedSpaceId];
    if (!useStore.getState().activeFloorId && spaceObj) {
      viewer.cameraFlight.flyTo({ aabb: spaceObj.aabb, duration: 1.0, fitFOV: 45 });
    }
  }, [selectedSpaceId]);

  // ── Watch function filters → dim/show spaces in 3D ──
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    const metaObjects = viewer.metaScene?.metaObjects;
    if (!metaObjects) return;

    for (const [id, obj] of Object.entries(viewer.scene.objects)) {
      const meta = metaObjects[id];
      if (!meta || meta.type !== 'IfcSpace') continue;
      const catIdx = getCategoryIndex(meta.name || '');
      const active = catIdx < 0 || activeFunctionFilters[catIdx];
      obj.opacity = active ? 0.85 : 0.08;
      obj.colorize = active ? getColorForFunction(meta.name || '') : [0.15, 0.15, 0.18];
    }
  }, [activeFunctionFilters]);

  // ── Helper: create a 3D polygon mesh from 2D percentage vertices ──
  function createPolygonMesh(viewer, vertices2D, viewMatrix, projMatrix, planeY, opts = {}) {
    if (!XMesh || !XReadableGeometry || !XPhongMaterial) return null;
    if (!vertices2D || vertices2D.length < 3) return null;

    // Use pre-computed world vertices if available (stable across floor transitions),
    // otherwise fall back to unprojection from current snapshot matrices
    const worldVerts = opts.worldVertices || unprojectPolygon(vertices2D, viewMatrix, projMatrix, planeY + 0.05);
    if (!worldVerts) {
      console.warn('[Delta] unprojectPolygon returned null');
      return null;
    }

    const positions = [];
    for (const [x, y, z] of worldVerts) positions.push(x, y, z);
    const indices = earClipTriangulate(vertices2D);

    try {
      return new XMesh(viewer.scene, {
        id: opts.id || undefined,
        geometry: new XReadableGeometry(viewer.scene, {
          positions: new Float32Array(positions),
          indices,
          primitive: 'triangles',
        }),
        material: new XPhongMaterial(viewer.scene, {
          diffuse: opts.diffuse || [0.91, 0.44, 0.20],
          emissive: opts.emissive || [0.2, 0.06, 0.0],
          alpha: opts.alpha ?? 0.25,
          backfaces: true,
        }),
        pickable: opts.pickable ?? false,
        clippable: false,
        collidable: false,
        edges: false,
      });
    } catch (err) {
      console.warn('[Delta] Failed to create polygon mesh:', err);
      return null;
    }
  }

  // ── Render ALL saved floor polygons as pickable 3D meshes ──
  const savedMeshesRef = useRef(new Map()); // ifcGuid → mesh
  const floorPolygons = useStore((s) => s.activeFloorId ? (s.floorPolygons[s.activeFloorId] || EMPTY) : EMPTY);
  const hoveredPolygonGuid = useStore((s) => s.hoveredPolygonGuid);
  const floorSnapshots = useStore((s) => s.floorSnapshots);
  const activeRoute = useStore((s) => s.activeRoute);
  const currentExpandedGroup = useStore((s) => s.currentExpandedGroup);
  const expandedGroups = useStore((s) => s.expandedGroups);
  const highlightedGuids = useStore((s) => s.highlightedGuids);
  const repurposeGuids = useStore((s) => s.repurposeGuids);

  // Derive a stable key from snapshot matrices so mesh effect only re-runs when matrices change,
  // not when the image URL updates (Tier 2 hi-res capture)
  const snapshotMatrixKey = useMemo(() => {
    const snap = activeFloorId ? floorSnapshots[activeFloorId] : null;
    if (!snap?.viewMatrix) return null;
    return snap.viewMatrix[12].toFixed(4) + '|' + snap.viewMatrix[14].toFixed(4) + '|' + snap.projMatrix[0].toFixed(4);
  }, [activeFloorId, floorSnapshots]);

  // Create meshes once per floor — delta updates when only polygons change
  const prevMeshStateRef = useRef({ floorId: null, matrixKey: null });

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !activeFloorId || !snapshotMatrixKey) {
      // Tear down everything if prerequisites missing
      for (const mesh of savedMeshesRef.current.values()) {
        try { mesh.destroy(); } catch {}
      }
      savedMeshesRef.current.clear();
      prevMeshStateRef.current = { floorId: null, matrixKey: null };
      return;
    }

    const polygons = floorPolygons;
    const snapshot = useStore.getState().floorSnapshots[activeFloorId];
    if (!snapshot?.viewMatrix || !snapshot?.projMatrix) return;

    const geometry = useStore.getState().floorSpaceGeometry;
    const spaces = geometry[activeFloorId] || [];
    const maxYTop = spaces.length > 0
      ? Math.max(...spaces.map(s => s.yTop || s.y || 0))
      : 0;

    const floorOrMatrixChanged = prevMeshStateRef.current.floorId !== activeFloorId
      || prevMeshStateRef.current.matrixKey !== snapshotMatrixKey;

    if (floorOrMatrixChanged) {
      // Full rebuild — floor or camera matrix changed
      for (const mesh of savedMeshesRef.current.values()) {
        try { mesh.destroy(); } catch {}
      }
      savedMeshesRef.current.clear();

      for (const poly of polygons) {
        if (!poly.vertices || poly.vertices.length < 3) continue;
        const mesh = createPolygonMesh(viewer, poly.vertices, snapshot.viewMatrix, snapshot.projMatrix, maxYTop, {
          id: `polygon-${poly.ifc_guid}`,
          pickable: true,
          alpha: 0.01,
          diffuse: [0, 0, 0],
          emissive: [0, 0, 0],
          worldVertices: poly.worldVertices || undefined,
        });
        if (mesh) {
          savedMeshesRef.current.set(poly.ifc_guid, mesh);
        }
      }
      prevMeshStateRef.current = { floorId: activeFloorId, matrixKey: snapshotMatrixKey };
    } else {
      // Delta update — only polygons changed, same floor/matrix
      const newGuids = new Set(polygons.map(p => p.ifc_guid));
      const oldGuids = new Set(savedMeshesRef.current.keys());

      // Remove deleted polygons
      for (const guid of oldGuids) {
        if (!newGuids.has(guid)) {
          try { savedMeshesRef.current.get(guid).destroy(); } catch {}
          savedMeshesRef.current.delete(guid);
        }
      }

      // Add new or recreate modified polygons
      for (const poly of polygons) {
        if (!poly.vertices || poly.vertices.length < 3) continue;
        if (oldGuids.has(poly.ifc_guid) && !poly.edited) continue; // unchanged
        // Destroy old if exists
        if (savedMeshesRef.current.has(poly.ifc_guid)) {
          try { savedMeshesRef.current.get(poly.ifc_guid).destroy(); } catch {}
        }
        const mesh = createPolygonMesh(viewer, poly.vertices, snapshot.viewMatrix, snapshot.projMatrix, maxYTop, {
          id: `polygon-${poly.ifc_guid}`,
          pickable: true,
          alpha: 0.01,
          diffuse: [0, 0, 0],
          emissive: [0, 0, 0],
          worldVertices: poly.worldVertices || undefined,
        });
        if (mesh) {
          savedMeshesRef.current.set(poly.ifc_guid, mesh);
        }
      }
    }

    return () => {
      for (const mesh of savedMeshesRef.current.values()) {
        try { mesh.destroy(); } catch {}
      }
      savedMeshesRef.current.clear();
    };
  }, [activeFloorId, floorPolygons, snapshotMatrixKey, loading]);

  // ── 3D Geometry Editing: vertex handle spheres + drag-on-plane ──
  const editing3D = useStore((s) => s.editing3D);
  const edit3DHandlesRef = useRef([]); // sphere meshes
  const edit3DMeshRef = useRef(null);  // live preview polygon mesh

  // Setup/teardown: create handles, attach drag listeners (only when editing3D changes)
  useEffect(() => {
    const viewer = viewerRef.current;
    // Cleanup previous handles + preview
    for (const h of edit3DHandlesRef.current) { try { h.destroy(); } catch {} }
    edit3DHandlesRef.current = [];
    if (edit3DMeshRef.current) { try { edit3DMeshRef.current.destroy(); } catch {} edit3DMeshRef.current = null; }

    if (!editing3D || !viewer || !XMesh || !XReadableGeometry || !XPhongMaterial || !XbuildSphereGeometry) return;

    // Compute initial world vertices if not available
    let worldVerts = useStore.getState().editing3DVerts;
    if (worldVerts.length === 0 && editing3D.ifc_guid) {
      const st = useStore.getState();
      const poly = (st.floorPolygons[editing3D.floor_id] || []).find(p => p.ifc_guid === editing3D.ifc_guid);
      if (poly?.vertices && poly.vertices.length >= 3) {
        const snapshot = st.floorSnapshots[editing3D.floor_id];
        if (snapshot?.viewMatrix && snapshot?.projMatrix) {
          const computed = unprojectPolygon(poly.vertices, snapshot.viewMatrix, snapshot.projMatrix, editing3D.planeY);
          if (computed) {
            worldVerts = computed;
            useStore.setState({
              editing3DVerts: computed.map(v => [...v]),
              editing3D: { ...editing3D, originalWorldVerts: computed.map(v => [...v]) },
            });
          }
        }
      }
      if (worldVerts.length === 0) return;
    }

    const planeY = editing3D.planeY;

    // Create vertex handle spheres
    const sphereGeom = new XReadableGeometry(viewer.scene, XbuildSphereGeometry({ radius: 0.12, heightSegments: 12, widthSegments: 12 }));
    for (let i = 0; i < worldVerts.length; i++) {
      const [x, y, z] = worldVerts[i];
      try {
        const sphere = new XMesh(viewer.scene, {
          id: `edit3d-handle-${i}`,
          geometry: sphereGeom,
          material: new XPhongMaterial(viewer.scene, {
            diffuse: i === 0 ? [1, 1, 1] : [0.91, 0.44, 0.20],
            emissive: i === 0 ? [0.91, 0.44, 0.20] : [0.5, 0.2, 0.05],
            alpha: 1.0,
          }),
          position: [x, y, z],
          pickable: true,
          clippable: false,
          collidable: false,
        });
        edit3DHandlesRef.current.push(sphere);
      } catch {}
    }

    // Create initial preview polygon mesh
    function rebuildPreviewMesh(verts) {
      if (edit3DMeshRef.current) { try { edit3DMeshRef.current.destroy(); } catch {} edit3DMeshRef.current = null; }
      if (verts.length < 3) return;
      const positions = [];
      for (const [x, y, z] of verts) positions.push(x, y, z);
      const flat2D = verts.map(v => [v[0], v[2]]);
      const indices = earClipTriangulate(flat2D);
      try {
        edit3DMeshRef.current = new XMesh(viewer.scene, {
          id: 'edit3d-preview',
          geometry: new XReadableGeometry(viewer.scene, {
            positions: new Float32Array(positions),
            indices,
            primitive: 'triangles',
          }),
          material: new XPhongMaterial(viewer.scene, {
            diffuse: [0.91, 0.44, 0.20],
            emissive: [0.3, 0.1, 0.02],
            alpha: 0.25,
            backfaces: true,
          }),
          pickable: false, clippable: false, collidable: false, edges: false,
        });
      } catch {}
    }

    rebuildPreviewMesh(worldVerts);

    // Hide the original polygon mesh while editing
    const origMesh = savedMeshesRef.current.get(editing3D.ifc_guid);
    if (origMesh) { try { origMesh.material.alpha = 0; } catch {} }

    // Subscribe to vertex changes for live updates (imperative, no re-render)
    let prevVerts = worldVerts;
    const unsub = useStore.subscribe((state) => {
      const verts = state.editing3DVerts;
      if (!verts || verts === prevVerts || verts.length === 0) return;
      prevVerts = verts;
      // Update handle positions
      for (let i = 0; i < verts.length && i < edit3DHandlesRef.current.length; i++) {
        try { edit3DHandlesRef.current[i].position = [verts[i][0], verts[i][1], verts[i][2]]; } catch {}
      }
      // Rebuild preview mesh
      rebuildPreviewMesh(verts);
    });

    // ── Drag logic: ray-plane intersection ──
    const canvas = viewer.scene.canvas.canvas;
    let dragIndex = null;

    function rayPlaneIntersect(canvasX, canvasY) {
      const camera = viewer.scene.camera;
      const rect = canvas.getBoundingClientRect();
      const ndcX = ((canvasX - rect.left) / rect.width) * 2 - 1;
      const ndcY = -(((canvasY - rect.top) / rect.height) * 2 - 1);
      const pvMat = mulMat4(pMat(camera), vMat(camera));
      const inv = invertMat4(pvMat);
      if (!inv) return null;
      const near = transformVec4(inv, [ndcX, ndcY, -1, 1]);
      const far = transformVec4(inv, [ndcX, ndcY, 1, 1]);
      const dx = far[0] - near[0], dy = far[1] - near[1], dz = far[2] - near[2];
      if (Math.abs(dy) < 1e-6) return null;
      const t = (planeY - near[1]) / dy;
      return [near[0] + dx * t, planeY, near[2] + dz * t];
    }
    function vMat(cam) { return cam.viewMatrix; }
    function pMat(cam) { return cam.projMatrix; }

    function onMouseDown(e) {
      const hit = viewer.scene.pick({ canvasPos: [e.offsetX, e.offsetY] });
      if (hit?.entity?.id?.startsWith('edit3d-handle-')) {
        const idx = parseInt(hit.entity.id.replace('edit3d-handle-', ''), 10);
        if (!isNaN(idx)) {
          e.stopPropagation();
          dragIndex = idx;
          viewer.cameraControl.pointerEnabled = false;
          canvas.style.cursor = 'grabbing';
        }
      }
    }

    function onMouseMove(e) {
      if (dragIndex === null) return;
      const worldPos = rayPlaneIntersect(e.clientX, e.clientY);
      if (!worldPos) return;
      useStore.getState().update3DVertex(dragIndex, worldPos[0], worldPos[2]);
    }

    function onMouseUp() {
      if (dragIndex !== null) {
        dragIndex = null;
        viewer.cameraControl.pointerEnabled = true;
        canvas.style.cursor = '';
      }
    }

    function onKeyDown(e) {
      if (e.key === 'Enter') { e.preventDefault(); useStore.getState().confirm3DEdit(); }
      if (e.key === 'Escape') { e.preventDefault(); useStore.getState().cancel3DEdit(); }
    }

    canvas.addEventListener('mousedown', onMouseDown, true);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('keydown', onKeyDown);

    return () => {
      unsub();
      canvas.removeEventListener('mousedown', onMouseDown, true);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('keydown', onKeyDown);
      for (const h of edit3DHandlesRef.current) { try { h.destroy(); } catch {} }
      edit3DHandlesRef.current = [];
      if (edit3DMeshRef.current) { try { edit3DMeshRef.current.destroy(); } catch {} edit3DMeshRef.current = null; }
      if (origMesh) { try { origMesh.material.alpha = 0.01; } catch {} }
      if (viewer.cameraControl) viewer.cameraControl.pointerEnabled = true;
    };
  }, [editing3D]);

  // Route & selection highlights: dark-focus BIM + blue corridors + nav line
  const bimDarkenedRef = useRef(false);
  const routeNavMeshesRef = useRef([]); // ground stripe + waypoint dots
  const exitMarkersRef = useRef([]);     // diamond markers above exit points
  const exitPulseRef = useRef(null);     // animation frame for exit pulse
  const meshStateRef = useRef(new Map()); // guid → 'start'|'target'|'path'|'hover'|'default'
  const breatheRafRef = useRef(null);
  const breatheMeshRef = useRef(null);
  const alphaLerpsRef = useRef(new Map());

  function lerpMeshAlpha(guid, mesh, target, duration = 120) {
    const prev = alphaLerpsRef.current.get(guid);
    if (prev) cancelAnimationFrame(prev.raf);
    const start = mesh.material.alpha;
    if (Math.abs(start - target) < 0.01) {
      mesh.material.alpha = target;
      alphaLerpsRef.current.delete(guid);
      return;
    }
    const t0 = performance.now();
    const tick = (now) => {
      const p = Math.min(1, (now - t0) / duration);
      const e = p * (2 - p);
      try { mesh.material.alpha = start + (target - start) * e; } catch {}
      if (p < 1) {
        const entry = alphaLerpsRef.current.get(guid);
        if (entry) entry.raf = requestAnimationFrame(tick);
      } else {
        alphaLerpsRef.current.delete(guid);
      }
    };
    alphaLerpsRef.current.set(guid, { raf: requestAnimationFrame(tick) });
  }

  useEffect(() => {
    const viewer = viewerRef.current;
    const hasRoute = !!activeRoute?.path;
    const hasHighlights = (highlightedGuids && highlightedGuids.length > 0) || (repurposeGuids && repurposeGuids.length > 0);
    const isEvacMode = heatmapMode === 'evacuation';
    const needDarken = hasRoute || hasHighlights || isEvacMode;

    // ── BIM dark-focus: darken/restore all scene objects ──
    if (viewer) {
      if (needDarken && !bimDarkenedRef.current) {
        for (const obj of Object.values(viewer.scene.objects)) {
          try { obj.colorize = [0.12, 0.12, 0.15]; obj.opacity = 0.6; } catch {}
        }
        bimDarkenedRef.current = true;
      } else if (!needDarken && bimDarkenedRef.current) {
        const metaObjects = viewer.metaScene?.metaObjects;
        for (const [id, obj] of Object.entries(viewer.scene.objects)) {
          try {
            const meta = metaObjects?.[id];
            if (meta?.type === 'IfcSpace') {
              const catIdx = getCategoryIndex(meta.name || '');
              const active = catIdx < 0 || useStore.getState().activeFunctionFilters[catIdx];
              obj.opacity = active ? 0.85 : 0.08;
              obj.colorize = active ? getColorForFunction(meta.name || '') : [0.15, 0.15, 0.18];
            } else {
              const glass = GLASS_TYPES[meta?.type];
              obj.colorize = null;
              obj.opacity = glass ? glass.opacity : 1.0;
            }
          } catch {}
        }
        bimDarkenedRef.current = false;
      }
    }

    // ── Clean up previous nav meshes ──
    for (const m of routeNavMeshesRef.current) { try { m.destroy(); } catch {} }
    routeNavMeshesRef.current = [];

    // ── Build route guid set ──
    const routeStartGuid = activeRoute?.path?.[0]?.ifc_guid || null;
    const routePathGuids = activeRoute?.path ? new Set(activeRoute.path.map((p) => p.ifc_guid)) : null;

    // ── Build group membership set for all expanded directory groups ──
    const groupGuids = new Set();
    if (expandedGroups.length > 0) {
      const expandedSet = new Set(expandedGroups);
      for (const p of floorPolygons) {
        if (expandedSet.has(p.primary_function || 'Unassigned')) {
          groupGuids.add(p.ifc_guid);
        }
      }
    }

    // ── Build highlight sets ──
    const hlSet = highlightedGuids && highlightedGuids.length > 0
      ? new Set(highlightedGuids) : null;
    const rpSet = repurposeGuids && repurposeGuids.length > 0
      ? new Set(repurposeGuids) : null;

    // ── Heatmap value lookup (occupancy modes) ──
    const isHeatmap = heatmapMode && heatmapMode !== 'function';
    let heatValues = null; // guid → normalized t (0–1)
    if (isHeatmap) {
      const vals = [];
      const raw = new Map();
      for (const p of floorPolygons) {
        let v = null;
        if (heatmapMode === 'occupancy' && (p.max_occupancy || 0) > 0) v = p.max_occupancy;
        else if (heatmapMode === 'occupancy_density' && (p.max_occupancy || 0) > 0 && (p.area_m2 || 0) > 0) v = p.max_occupancy / p.area_m2;
        else if (heatmapMode === 'evacuation' && (p.absolute_occupancy || 0) > 0) v = p.absolute_occupancy;
        else if (heatmapMode === 'area') v = p.area_m2 || 0;
        else if (heatmapMode === 'area_per_bed' && p.area_per_bed != null) v = p.area_per_bed;
        else if (heatmapMode === 'utilization') v = (p.max_occupancy || 0) > 0 ? 0.7 : 0.3;
        if (v != null && v > 0) { vals.push(v); raw.set(p.ifc_guid, v); }
      }
      if (vals.length > 0) {
        const mn = Math.min(...vals);
        const mx = Math.max(...vals);
        const range = mx - mn || 1;
        heatValues = new Map();
        for (const [g, v] of raw) {
          let t = Math.max(0, Math.min(1, (v - mn) / range));
          if (heatmapMode === 'evacuation') t = 1 - t; // inverted: high capacity = green
          heatValues.set(g, t);
        }
      }
    }

    // ── Evacuation mode: build function lookup + exit set ──
    const isEvac = heatmapMode === 'evacuation';
    const guidFnMap = new Map(); // guid → primary_function (lowercase)
    const exitGuids = new Set();
    if (isEvac) {
      for (const p of floorPolygons) {
        const fn = (p.primary_function || '').toLowerCase();
        guidFnMap.set(p.ifc_guid, fn);
        if (EXIT_FUNCTIONS.has(fn)) exitGuids.add(p.ifc_guid);
      }
    }

    // When heatmapMode changes, invalidate cached mesh states to force re-render
    if (isHeatmap || meshStateRef.current._prevHeatmap !== heatmapMode) {
      meshStateRef.current.clear();
      meshStateRef.current._prevHeatmap = heatmapMode;
    }

    // ── Apply colors to overlay polygon meshes (skip unchanged) ──
    for (const [guid, mesh] of savedMeshesRef.current) {
      const isRouteStart = routeStartGuid === guid;
      const isRouteTarget = activeRoute?.targetGuid === guid;
      const isRoutePath = routePathGuids?.has(guid) && !isRouteStart && !isRouteTarget;
      const isHoverOrSelect = hoveredPolygonGuid === guid || selectedSpaceId === guid;
      const isGroupMember = groupGuids.has(guid);

      const isHighlighted = hlSet && hlSet.has(guid);
      const isRepurpose = rpSet && rpSet.has(guid);
      const isDimmedByHighlight = (hlSet || rpSet) && !isHighlighted && !isRepurpose;

      const newState = isRouteStart ? 'start'
        : isRouteTarget ? 'target'
        : isRoutePath ? 'path'
        : isHoverOrSelect ? 'hover'
        : isHighlighted ? 'highlight'
        : isRepurpose ? 'repurpose'
        : isGroupMember ? 'group'
        : isDimmedByHighlight ? 'highlight-dim'
        : 'default';

      if (meshStateRef.current.get(guid) === newState) continue;
      meshStateRef.current.set(guid, newState);

      try {
        if (newState === 'start') {
          lerpMeshAlpha(guid, mesh, 0.65);
          mesh.material.diffuse = [0.95, 0.30, 0.10];
          mesh.material.emissive = [0.70, 0.20, 0.05];
        } else if (newState === 'target') {
          lerpMeshAlpha(guid, mesh, 0.65);
          mesh.material.diffuse = [0.10, 0.90, 0.60];
          mesh.material.emissive = [0.05, 0.50, 0.30];
        } else if (newState === 'path') {
          lerpMeshAlpha(guid, mesh, 0.45);
          mesh.material.diffuse = [0.25, 0.58, 1.0];
          mesh.material.emissive = [0.08, 0.22, 0.55];
        } else if (newState === 'hover') {
          lerpMeshAlpha(guid, mesh, 0.65);
          mesh.material.diffuse = [1.0, 0.55, 0.2];
          mesh.material.emissive = [0.7, 0.3, 0.05];
        } else if (newState === 'highlight') {
          lerpMeshAlpha(guid, mesh, 0.65);
          mesh.material.diffuse = [0.91, 0.44, 0.20]; // #E77133
          mesh.material.emissive = [0.50, 0.20, 0.05];
        } else if (newState === 'repurpose') {
          lerpMeshAlpha(guid, mesh, 0.60);
          mesh.material.diffuse = [0.23, 0.51, 0.96]; // #3B82F6
          mesh.material.emissive = [0.10, 0.25, 0.55];
        } else if (newState === 'group') {
          lerpMeshAlpha(guid, mesh, 0.50);
          mesh.material.diffuse = [1.0, 0.55, 0.2];
          mesh.material.emissive = [0.2, 0.075, 0.0];
        } else if (newState === 'highlight-dim') {
          lerpMeshAlpha(guid, mesh, 0.06);
          mesh.material.diffuse = [0.12, 0.12, 0.15];
          mesh.material.emissive = [0, 0, 0];
        } else if (isEvac && exitGuids.has(guid)) {
          // Exit marker — cyan fill, distinct from heatmap palette
          lerpMeshAlpha(guid, mesh, 0.80);
          mesh.material.diffuse = [0.00, 0.83, 1.00]; // #00D4FF
          mesh.material.emissive = [0.00, 0.40, 0.55];
        } else if (isEvac && EVAC_INFRA.has(guidFnMap.get(guid) || '')) {
          // Dim infrastructure in evacuation mode
          lerpMeshAlpha(guid, mesh, 0.04);
          mesh.material.diffuse = [0.10, 0.10, 0.12];
          mesh.material.emissive = [0, 0, 0];
        } else if (isHeatmap && heatValues?.has(guid)) {
          // Heatmap overlay — evacuation uses discrete bands, others use gradient
          const hc = isEvac ? evacColorRGB(heatValues.get(guid)) : heatColorRGB(heatValues.get(guid));
          lerpMeshAlpha(guid, mesh, isEvac ? 0.72 : 0.55);
          mesh.material.diffuse = hc;
          mesh.material.emissive = [hc[0] * 0.40, hc[1] * 0.40, hc[2] * 0.40];
        } else {
          lerpMeshAlpha(guid, mesh, 0.01);
          mesh.material.diffuse = [0, 0, 0];
          mesh.material.emissive = [0, 0, 0];
        }
      } catch {}
    }

    // ── Breathe animation for selected mesh ──
    if (breatheRafRef.current) { cancelAnimationFrame(breatheRafRef.current); breatheRafRef.current = null; }
    breatheMeshRef.current = null;
    if (selectedSpaceId) {
      const selMesh = savedMeshesRef.current.get(selectedSpaceId);
      if (selMesh) {
        const prevLerp = alphaLerpsRef.current.get(selectedSpaceId);
        if (prevLerp) { cancelAnimationFrame(prevLerp.raf); alphaLerpsRef.current.delete(selectedSpaceId); }
        breatheMeshRef.current = selMesh;
        const startTime = performance.now();
        const tick = (now) => {
          if (breatheMeshRef.current !== selMesh) return;
          const t = (Math.sin((now - startTime) / 1000 * Math.PI) + 1) / 2; // 0→1→0 over 2s
          try {
            selMesh.material.alpha = 0.50 + t * 0.30; // 0.50 → 0.80
            selMesh.material.emissive = [0.5 + t * 0.3, 0.2 + t * 0.15, 0.02 + t * 0.03];
          } catch {}
          breatheRafRef.current = requestAnimationFrame(tick);
        };
        breatheRafRef.current = requestAnimationFrame(tick);
      }
    }

    // ── Exit diamond markers (evacuation mode) ──
    for (const m of exitMarkersRef.current) { try { m.destroy(); } catch {} }
    exitMarkersRef.current = [];
    if (exitPulseRef.current) { cancelAnimationFrame(exitPulseRef.current); exitPulseRef.current = null; }

    if (isEvac && exitGuids.size > 0 && viewer && XMesh && XReadableGeometry && XPhongMaterial) {
      const geometry = useStore.getState().floorSpaceGeometry;
      const spaces = geometry[activeFloorId] || [];
      const maxYTop = spaces.length > 0 ? Math.max(...spaces.map(s => s.yTop || s.y || 0)) : 0;
      const markerY = maxYTop + 0.6;

      // Build diamond geometry: two pyramids joined at base (octahedron-like)
      const S = 0.15; // half-width
      const H = 0.35; // half-height
      // 6 vertices: top, bottom, 4 equatorial
      const dPos = [
        0, H, 0,    // 0: top
        0, -H, 0,   // 1: bottom
        S, 0, 0,    // 2: +X
        0, 0, S,    // 3: +Z
        -S, 0, 0,   // 4: -X
        0, 0, -S,   // 5: -Z
      ];
      const dIdx = [
        0,2,3, 0,3,4, 0,4,5, 0,5,2,  // top 4 faces
        1,3,2, 1,4,3, 1,5,4, 1,2,5,  // bottom 4 faces
      ];

      // Find centroids of exit meshes
      const exitMeshes = [];
      for (const guid of exitGuids) {
        const mesh = savedMeshesRef.current.get(guid);
        if (!mesh) continue;
        const pos = mesh.geometry._state?.positionsCompressed || mesh.geometry._state?.positions;
        if (!pos || pos.length < 3) continue;
        let cx = 0, cy = 0, cz = 0, n = 0;
        for (let i = 0; i < pos.length; i += 3) {
          cx += pos[i]; cy += pos[i+1]; cz += pos[i+2]; n++;
        }
        if (n === 0) continue;
        cx /= n; cy /= n; cz /= n;

        // Create diamond at centroid, elevated above floor
        const offsetPos = new Float32Array(dPos.length);
        for (let i = 0; i < dPos.length; i += 3) {
          offsetPos[i] = dPos[i] + cx;
          offsetPos[i+1] = dPos[i+1] + markerY;
          offsetPos[i+2] = dPos[i+2] + cz;
        }
        try {
          const marker = new XMesh(viewer.scene, {
            geometry: new XReadableGeometry(viewer.scene, {
              positions: offsetPos, indices: dIdx, primitive: 'triangles',
            }),
            material: new XPhongMaterial(viewer.scene, {
              diffuse: [0.00, 0.83, 1.00],
              emissive: [0.00, 0.50, 0.70],
              alpha: 0.92,
              backfaces: true,
            }),
            pickable: false, clippable: false, collidable: false, edges: false,
          });
          exitMarkersRef.current.push(marker);
          exitMeshes.push(mesh);
        } catch {}
      }

      // Pulse animation: exit meshes + diamonds cycle alpha
      if (exitMeshes.length > 0 || exitMarkersRef.current.length > 0) {
        const startTime = performance.now();
        const pulseTick = (now) => {
          const t = (Math.sin((now - startTime) / 800 * Math.PI) + 1) / 2; // 0→1→0 over 1.6s
          for (const mesh of exitMeshes) {
            try {
              mesh.material.alpha = 0.60 + t * 0.35;
              mesh.material.emissive = [0.00, 0.30 + t * 0.25, 0.40 + t * 0.30];
            } catch {}
          }
          for (const marker of exitMarkersRef.current) {
            try {
              marker.material.alpha = 0.70 + t * 0.28;
              marker.material.emissive = [0.00, 0.40 + t * 0.30, 0.55 + t * 0.35];
            } catch {}
          }
          exitPulseRef.current = requestAnimationFrame(pulseTick);
        };
        exitPulseRef.current = requestAnimationFrame(pulseTick);
      }
    }

    // ── Create nav meshes: ground stripe, breadcrumb dots, polygon glow borders ──
    if (!viewer || !hasRoute || !activeRoute?.pathLine || activeRoute.pathLine.length < 2) return;
    if (!activeFloorId) return;

    const snapshot = useStore.getState().floorSnapshots[activeFloorId];
    if (!snapshot?.viewMatrix || !snapshot?.projMatrix) return;

    const geomData = useStore.getState().floorSpaceGeometry;
    const spaces = geomData[activeFloorId] || [];
    const maxYTop = spaces.length > 0 ? Math.max(...spaces.map(s => s.yTop || s.y || 0)) : 0;
    const planeY = maxYTop + 0.10;

    // Unproject pathLine → 3D world coords
    const worldPath = unprojectPolygon(activeRoute.pathLine, snapshot.viewMatrix, snapshot.projMatrix, planeY);
    if (!worldPath || worldPath.length < 2) return;

    // ── (a) Faint ground stripe ──
    const HALF_W = 0.05;
    const stripPos = [];
    const stripIdx = [];
    for (let i = 0; i < worldPath.length; i++) {
      const [x, y, z] = worldPath[i];
      let dx, dz;
      if (i < worldPath.length - 1) { dx = worldPath[i + 1][0] - x; dz = worldPath[i + 1][2] - z; }
      else { dx = x - worldPath[i - 1][0]; dz = z - worldPath[i - 1][2]; }
      const len = Math.sqrt(dx * dx + dz * dz) || 1;
      const px = -dz / len * HALF_W, pz = dx / len * HALF_W;
      stripPos.push(x + px, y, z + pz, x - px, y, z - pz);
      if (i < worldPath.length - 1) {
        const b = i * 2;
        stripIdx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
      }
    }
    try {
      routeNavMeshesRef.current.push(new XMesh(viewer.scene, {
        geometry: new XReadableGeometry(viewer.scene, { positions: new Float32Array(stripPos), indices: stripIdx, primitive: 'triangles' }),
        material: new XPhongMaterial(viewer.scene, { diffuse: [0.25, 0.65, 1.0], emissive: [0.12, 0.35, 0.65], alpha: 0.35, backfaces: true }),
        pickable: false, clippable: false, collidable: false, edges: false,
      }));
    } catch {}

    // ── (b) Breadcrumb dot chain — single batched mesh ──
    if (XbuildSphereGeometry) {
      const DOT_SPACING = 0.4;
      const dotPlaneY = planeY + 0.12;

      // Collect all dot center positions
      const dotCenters = [];
      let accumulated = 0;
      for (let i = 1; i < worldPath.length; i++) {
        const [ax, , az] = worldPath[i - 1];
        const [bx, , bz] = worldPath[i];
        const segDx = bx - ax, segDz = bz - az;
        const segLen = Math.sqrt(segDx * segDx + segDz * segDz);
        if (segLen < 0.001) continue;
        const dirX = segDx / segLen, dirZ = segDz / segLen;
        let pos = DOT_SPACING - accumulated;
        while (pos <= segLen) {
          dotCenters.push([ax + dirX * pos, dotPlaneY, az + dirZ * pos]);
          pos += DOT_SPACING;
        }
        accumulated = segLen - (pos - DOT_SPACING);
      }

      if (dotCenters.length > 0) {
        // Build one sphere template at the origin
        const template = XbuildSphereGeometry({ center: [0, 0, 0], radius: 0.06, heightSegments: 6, widthSegments: 6 });
        const tPos = template.positions;
        const tIdx = template.indices;
        const vertsPerSphere = tPos.length / 3;

        // Merge all spheres into one geometry buffer
        const allPos = new Float32Array(dotCenters.length * tPos.length);
        const allIdx = new Uint32Array(dotCenters.length * tIdx.length);

        for (let d = 0; d < dotCenters.length; d++) {
          const [cx, cy, cz] = dotCenters[d];
          const posOff = d * tPos.length;
          const idxOff = d * tIdx.length;
          const vertOff = d * vertsPerSphere;
          for (let v = 0; v < tPos.length; v += 3) {
            allPos[posOff + v] = tPos[v] + cx;
            allPos[posOff + v + 1] = tPos[v + 1] + cy;
            allPos[posOff + v + 2] = tPos[v + 2] + cz;
          }
          for (let j = 0; j < tIdx.length; j++) {
            allIdx[idxOff + j] = tIdx[j] + vertOff;
          }
        }

        try {
          routeNavMeshesRef.current.push(new XMesh(viewer.scene, {
            geometry: new XReadableGeometry(viewer.scene, { positions: allPos, indices: allIdx, primitive: 'triangles' }),
            material: new XPhongMaterial(viewer.scene, { diffuse: [0.40, 0.85, 1.0], emissive: [0.25, 0.60, 0.90], alpha: 0.9 }),
            pickable: false, clippable: false, collidable: false, edges: false,
          }));
        } catch {}
      }

      // Start + end marker spheres (larger)
      for (const [pt, color, emis] of [
        [worldPath[0], [0.95, 0.50, 0.15], [0.65, 0.28, 0.06]],
        [worldPath[worldPath.length - 1], [0.10, 0.90, 0.60], [0.05, 0.55, 0.30]],
      ]) {
        try {
          const sg = XbuildSphereGeometry({ center: [pt[0], dotPlaneY + 0.05, pt[2]], radius: 0.12, heightSegments: 10, widthSegments: 10 });
          routeNavMeshesRef.current.push(new XMesh(viewer.scene, {
            geometry: new XReadableGeometry(viewer.scene, sg),
            material: new XPhongMaterial(viewer.scene, { diffuse: color, emissive: emis, alpha: 0.95 }),
            pickable: false, clippable: false, collidable: false, edges: false,
          }));
        } catch {}
      }
    }

    // ── (c) Polygon glow borders — outline line mesh + quad-strip halo ──
    const polygons = useStore.getState().floorPolygons[activeFloorId] || [];
    const borderPlaneY = maxYTop + 0.12;
    const BORDER_HALF_W = 0.04;

    for (const [guid] of savedMeshesRef.current) {
      const isStart = routeStartGuid === guid;
      const isTarget = activeRoute?.targetGuid === guid;
      const isPath = routePathGuids?.has(guid) && !isStart && !isTarget;
      if (!isStart && !isTarget && !isPath) continue;

      const poly = polygons.find((p) => p.ifc_guid === guid);
      if (!poly?.vertices || poly.vertices.length < 3) continue;

      const borderColor = isStart ? [1.0, 0.62, 0.26] : isTarget ? [0.20, 0.90, 0.60] : [0.35, 0.70, 1.0];
      const borderEmis = isStart ? [0.70, 0.35, 0.10] : isTarget ? [0.10, 0.60, 0.35] : [0.18, 0.40, 0.70];
      const glowColor = isStart ? [1.0, 0.50, 0.15] : isTarget ? [0.15, 0.80, 0.50] : [0.25, 0.55, 0.95];
      const glowEmis = isStart ? [0.55, 0.25, 0.05] : isTarget ? [0.06, 0.45, 0.25] : [0.10, 0.30, 0.55];

      // Close the polygon loop
      const verts2D = [...poly.vertices, poly.vertices[0]];
      const worldVerts = unprojectPolygon(verts2D, snapshot.viewMatrix, snapshot.projMatrix, borderPlaneY);
      if (!worldVerts || worldVerts.length < 4) continue;

      // (c1) Crisp outline — primitive 'lines'
      const linePos = [];
      const lineIdx = [];
      for (let i = 0; i < worldVerts.length; i++) {
        linePos.push(worldVerts[i][0], worldVerts[i][1], worldVerts[i][2]);
        if (i < worldVerts.length - 1) { lineIdx.push(i, i + 1); }
      }
      try {
        routeNavMeshesRef.current.push(new XMesh(viewer.scene, {
          geometry: new XReadableGeometry(viewer.scene, { positions: new Float32Array(linePos), indices: lineIdx, primitive: 'lines' }),
          material: new XPhongMaterial(viewer.scene, { diffuse: borderColor, emissive: borderEmis, alpha: 0.9, backfaces: true }),
          pickable: false, clippable: false, collidable: false, edges: false,
        }));
      } catch {}

      // (c2) Soft glow halo — quad-strip border
      const haloPos = [];
      const haloIdx = [];
      for (let i = 0; i < worldVerts.length; i++) {
        const [x, y, z] = worldVerts[i];
        // Direction to next vertex
        const next = worldVerts[(i + 1) % worldVerts.length];
        const prev = worldVerts[(i - 1 + worldVerts.length) % worldVerts.length];
        // Average perpendicular for smooth corners
        const d1x = next[0] - x, d1z = next[2] - z;
        const d2x = x - prev[0], d2z = z - prev[2];
        const avgDx = d1x + d2x, avgDz = d1z + d2z;
        const avgLen = Math.sqrt(avgDx * avgDx + avgDz * avgDz) || 1;
        const nx = -avgDz / avgLen * BORDER_HALF_W;
        const nz = avgDx / avgLen * BORDER_HALF_W;
        haloPos.push(x + nx, y, z + nz, x - nx, y, z - nz);
        if (i < worldVerts.length - 1) {
          const b = i * 2;
          haloIdx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
        }
      }
      try {
        routeNavMeshesRef.current.push(new XMesh(viewer.scene, {
          geometry: new XReadableGeometry(viewer.scene, { positions: new Float32Array(haloPos), indices: haloIdx, primitive: 'triangles' }),
          material: new XPhongMaterial(viewer.scene, { diffuse: glowColor, emissive: glowEmis, alpha: 0.45, backfaces: true }),
          pickable: false, clippable: false, collidable: false, edges: false,
        }));
      } catch {}
    }
  }, [hoveredPolygonGuid, selectedSpaceId, activeRoute, activeFloorId, expandedGroups, floorPolygons, heatmapMode, highlightedGuids, repurposeGuids]);

  // ── Find Room legend ──
  const findRoomResults = useStore((s) => s.findRoomResults);
  const clearHighlights = useStore((s) => s.clearHighlights);

  // ── Heatmap legend stats ──
  const setHeatmapMode = useStore((s) => s.setHeatmapMode);
  const heatmapLegend = useMemo(() => {
    if (!heatmapMode || heatmapMode === 'function') return null;
    const labels = {
      occupancy: 'Occupancy Capacity',
      occupancy_density: 'Occupancy Density (ppl/m²)',
      evacuation: 'Evacuation Access',
      area: 'Area (m²)',
      area_per_bed: 'Area per Bed (m²)',
      utilization: 'Utilization',
      status: 'Status',
    };
    const units = {
      occupancy: '', occupancy_density: ' ppl/m²', evacuation: '',
      area: ' m²', area_per_bed: ' m²', utilization: '', status: '',
    };
    const vals = [];
    for (const p of floorPolygons) {
      let v = null;
      if (heatmapMode === 'occupancy' && (p.max_occupancy || 0) > 0) v = p.max_occupancy;
      else if (heatmapMode === 'occupancy_density' && (p.max_occupancy || 0) > 0 && (p.area_m2 || 0) > 0) v = p.max_occupancy / p.area_m2;
      else if (heatmapMode === 'evacuation' && (p.absolute_occupancy || 0) > 0) v = p.absolute_occupancy;
      else if (heatmapMode === 'area') v = p.area_m2 || 0;
      else if (heatmapMode === 'area_per_bed' && p.area_per_bed != null) v = p.area_per_bed;
      else if (heatmapMode === 'utilization') v = (p.max_occupancy || 0) > 0 ? 0.7 : 0.3;
      if (v != null && v > 0) vals.push(v);
    }
    if (vals.length === 0) return null;
    const mn = Math.min(...vals);
    const mx = Math.max(...vals);
    const fmt = (v) => v >= 10 ? Math.round(v) : v.toFixed(1);
    const inverted = heatmapMode === 'evacuation';
    return {
      label: labels[heatmapMode] || heatmapMode,
      minLabel: fmt(inverted ? mx : mn) + (units[heatmapMode] || ''),
      maxLabel: fmt(inverted ? mn : mx) + (units[heatmapMode] || ''),
      count: vals.length,
    };
  }, [heatmapMode, floorPolygons]);

  return (
    <div className="xeokit-viewer">
      <canvas ref={canvasRef} className="xeokit-viewer__canvas" />
      <canvas ref={navCubeCanvasRef} className="xeokit-viewer__navcube" />

      {loading && (
        <div className="xeokit-viewer__overlay">
          <DeltaSpinner size={72} label={loadStatus} />
        </div>
      )}

      {showTransition && !loading && (
        <div className={`xeokit-viewer__transition-overlay ${transitionFading ? 'xeokit-viewer__transition-overlay--fading' : ''}`}>
          <DeltaSpinner size={64} label={transitionLabel} />
        </div>
      )}

      {modelError && !loading && (
        <div className="xeokit-viewer__overlay">
          <div className="xeokit-viewer__error-icon">&#9651;</div>
          <p className="xeokit-viewer__error-title">3D model not loaded</p>
          <p className="xeokit-viewer__error-sub">Run the setup script to convert the IFC file.</p>
        </div>
      )}


      {/* Polygon hover tooltip */}
      {polygonTooltip && (
        <div className="xeokit-viewer__polygon-tooltip" style={{ left: polygonTooltip.x, top: polygonTooltip.y }}>
          <div className="xeokit-viewer__polygon-tooltip-name">{polygonTooltip.name}</div>
          {polygonTooltip.findRoom ? (
            <div className="xeokit-viewer__polygon-tooltip-evac">
              {polygonTooltip.fn && polygonTooltip.fn !== polygonTooltip.name && (
                <div className="xeokit-viewer__polygon-tooltip-fn">{polygonTooltip.fn}</div>
              )}
              {(polygonTooltip.zone || polygonTooltip.areaM2) && (
                <div className="xeokit-viewer__polygon-tooltip-meta">
                  {polygonTooltip.zone}{polygonTooltip.zone && polygonTooltip.areaM2 ? ' · ' : ''}{polygonTooltip.areaM2 && `${polygonTooltip.areaM2} m²`}
                </div>
              )}
              <div className="xeokit-viewer__polygon-tooltip-meta">
                Capacity: {polygonTooltip.findRoomCapacity}
              </div>
              <div className="xeokit-viewer__polygon-tooltip-band">
                <span className="xeokit-viewer__polygon-tooltip-dot" style={{ background: polygonTooltip.findRoomType === 'direct' ? '#E77133' : '#3B82F6' }} />
                <span>{polygonTooltip.findRoomType === 'direct' ? 'Matches capacity' : 'Repurpose candidate'}</span>
              </div>
              <div className="xeokit-viewer__polygon-tooltip-reason">{polygonTooltip.findRoomReason}</div>
            </div>
          ) : polygonTooltip.evacMode ? (
            <div className="xeokit-viewer__polygon-tooltip-evac">
              {polygonTooltip.fn && polygonTooltip.fn !== polygonTooltip.name && (
                <div className="xeokit-viewer__polygon-tooltip-fn">{polygonTooltip.fn}</div>
              )}
              {(polygonTooltip.zone || polygonTooltip.areaM2) && (
                <div className="xeokit-viewer__polygon-tooltip-meta">
                  {polygonTooltip.zone}{polygonTooltip.zone && polygonTooltip.areaM2 ? ' · ' : ''}{polygonTooltip.areaM2 && `${polygonTooltip.areaM2} m²`}
                </div>
              )}
              {polygonTooltip.evacOccupancy > 0 && (
                <div className="xeokit-viewer__polygon-tooltip-meta">
                  {polygonTooltip.evacOccupancy} people{polygonTooltip.evacDensity ? ` · ${polygonTooltip.evacDensity} ppl/m²` : ''}
                </div>
              )}
              <div className="xeokit-viewer__polygon-tooltip-band">
                <span className="xeokit-viewer__polygon-tooltip-dot" style={{ background: polygonTooltip.evacColor }} />
                <span>{polygonTooltip.evacLabel}</span>
              </div>
              <div className="xeokit-viewer__polygon-tooltip-reason">{polygonTooltip.evacReason}</div>
            </div>
          ) : (
            polygonTooltip.area && <div className="xeokit-viewer__polygon-tooltip-area">{polygonTooltip.area}</div>
          )}
        </div>
      )}

      {/* Heatmap legend */}
      {heatmapLegend && (
        <div className={`xeokit-viewer__heatmap-legend ${heatmapMode === 'evacuation' ? 'xeokit-viewer__heatmap-legend--evac' : ''}`}>
          <div className="xeokit-viewer__heatmap-legend-header">
            <span className="xeokit-viewer__heatmap-legend-title">{heatmapLegend.label}</span>
            <button
              className="xeokit-viewer__heatmap-legend-close"
              onClick={() => setHeatmapMode('function')}
              title="Close heatmap"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
              </svg>
            </button>
          </div>
          {heatmapMode === 'evacuation' ? (
            <>
              <div className="xeokit-viewer__evac-bands">
                <div className="xeokit-viewer__evac-band"><span className="xeokit-viewer__evac-dot" style={{ background: '#2ED16B' }} />Excellent</div>
                <div className="xeokit-viewer__evac-band"><span className="xeokit-viewer__evac-dot" style={{ background: '#F2D926' }} />Good</div>
                <div className="xeokit-viewer__evac-band"><span className="xeokit-viewer__evac-dot" style={{ background: '#FF8C1A' }} />At Risk</div>
                <div className="xeokit-viewer__evac-band"><span className="xeokit-viewer__evac-dot" style={{ background: '#EB2626' }} />Critical</div>
              </div>
              <div className="xeokit-viewer__evac-exit"><span className="xeokit-viewer__evac-dot" style={{ background: '#00D4FF', border: '1.5px solid #00a0cc' }} />Exit Point</div>
              <div className="xeokit-viewer__heatmap-legend-count">{heatmapLegend.count} spaces</div>
            </>
          ) : (
            <>
              <div className="xeokit-viewer__heatmap-legend-bar">
                <span className="xeokit-viewer__heatmap-legend-label">{heatmapLegend.minLabel}</span>
                <div className="xeokit-viewer__heatmap-legend-gradient" />
                <span className="xeokit-viewer__heatmap-legend-label">{heatmapLegend.maxLabel}</span>
              </div>
              <div className="xeokit-viewer__heatmap-legend-count">{heatmapLegend.count} spaces</div>
            </>
          )}
        </div>
      )}
      {/* Find Room legend */}
      {findRoomResults && Object.keys(findRoomResults).length > 0 && (
        <div className="xeokit-viewer__heatmap-legend xeokit-viewer__heatmap-legend--find-room">
          <div className="xeokit-viewer__heatmap-legend-header">
            <span className="xeokit-viewer__heatmap-legend-title">Room Finder</span>
            <button
              className="xeokit-viewer__heatmap-legend-close"
              onClick={() => { clearHighlights(); }}
              title="Clear results"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><line x1="2" y1="2" x2="8" y2="8"/><line x1="8" y1="2" x2="2" y2="8"/></svg>
            </button>
          </div>
          <div className="xeokit-viewer__evac-bands">
            <div className="xeokit-viewer__evac-band">
              <span className="xeokit-viewer__evac-dot" style={{ background: '#E77133' }} />
              Matches capacity
            </div>
            <div className="xeokit-viewer__evac-band">
              <span className="xeokit-viewer__evac-dot" style={{ background: '#3B82F6' }} />
              Repurpose candidate
            </div>
          </div>
          <div className="xeokit-viewer__heatmap-legend-count">
            {Object.keys(findRoomResults).length} rooms
          </div>
        </div>
      )}
    </div>
  );
}
