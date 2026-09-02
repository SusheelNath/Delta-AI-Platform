import React, { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import useStore from '../../store/useStore';
import { fetchSpaceByGuid, searchSpaces } from '../../api/client';
import { getColorForFunction, getCategoryIndex } from '../../utils/colorScheme';
import { unprojectPolygon, earClipTriangulate, computePolygonMetrics } from '../../utils/unprojectPolygon';
import './XeokitViewer.css';

let Viewer, XKTLoaderPlugin, NavCubePlugin, StoreyViewsPlugin, SectionPlanesPlugin;
let XMesh, XReadableGeometry, XPhongMaterial;

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
}

const MEP_SPACE_CLASSES = new Set([
  'Void / shaft',
  'Technical / vertical core',
  'Technical / plant',
  'Vertical circulation / lift support',
  'Circulation',
  'Transition / circulation',
]);

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

  const setViewerReady = useStore((s) => s.setViewerReady);
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

  const [modelError, setModelError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadStatus, setLoadStatus] = useState('Initialising viewer...');
  const [polygonTooltip, setPolygonTooltip] = useState(null); // { name, area, x, y }
  const [transitionLabel, setTransitionLabel] = useState('');

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

      viewer.scene.canvas.canvas.style.background = '#0a1628';
      viewer.scene.canvas.backgroundColor = [10/255, 22/255, 40/255];
      viewer.camera.projection = 'perspective';
      viewer.camera.perspective.near = 1.0;

      // ── SAO (Scalable Ambient Occlusion) — adds depth shadows ──
      viewer.scene.sao.enabled = true;
      viewer.scene.sao.intensity = 0.2;
      viewer.scene.sao.bias = 0.5;
      viewer.scene.sao.scale = 800;
      viewer.scene.sao.minResolution = 0.0;
      viewer.scene.sao.kernelRadius = 100;
      viewer.scene.sao.blendFactor = 1.0;

      // ── Reduce ambient light ──
      for (const light of Object.values(viewer.scene.lights)) {
        if (light.type === 'AmbientLight') {
          light.intensity = 0.65;
        }
      }

      // ── Edge material — black outlines on geometry boundaries ──
      viewer.scene.edgeMaterial.edgeColor = [0, 0, 0];
      viewer.scene.edgeMaterial.edgeAlpha = 0.4;
      viewer.scene.edgeMaterial.edgeWidth = 1;

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
      viewer.scene.xrayMaterial.fillColor = [0.6, 0.6, 0.7];
      viewer.scene.xrayMaterial.edges = true;
      viewer.scene.xrayMaterial.edgeAlpha = 0.25;
      viewer.scene.xrayMaterial.edgeColor = [0.4, 0.4, 0.5];

      if (navCubeCanvasRef.current) {
        new NavCubePlugin(viewer, {
          canvasElement: navCubeCanvasRef.current,
          visible: true,
          color: '#1a2030',
          frontColor: '#2d3548',
          backColor: '#161b26',
          edgeColor: '#E77133',
          highColor: '#E77133',
          shadowVisible: false,
        });
      }

      const xktLoader = new XKTLoaderPlugin(viewer);
      viewerRef.current = viewer;

      // ── Download XKT ──
      let xktData = cachedXKT;

      if (!xktData) {
        setLoadStatus('Downloading 3D model (227 MB)...');
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

      try {
        const model = xktLoader.load({ id: 'hospital', xkt: xktData, edges: true });
        modelRef.current = model;

        model.on('loaded', () => {
          if (destroyed) return;

          const objCount = Object.keys(viewer.scene.objects).length;
          const aabb = viewer.scene.aabb;
          console.log(`[Delta] Model loaded: ${objCount} objects`);
          console.log(`[Delta] Scene AABB: [${aabb.map(v => v.toFixed(1)).join(', ')}]`);

          modelAABBRef.current = [...aabb];

          setLoadStatus('Colouring spaces...');
          hideStructuralElements(viewer);
          applyExclusions(viewer);
          buildStoreyMapping(viewer);
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

        // Build polygon-derived overrides for Space Toolkit
        const floorId = useStore.getState().activeFloorId;
        const floorPolys = floorId ? (useStore.getState().floorPolygons[floorId] || []) : [];
        const polyData = floorPolys.find((p) => p.ifc_guid === ifcGuid);
        const overrides = {};
        if (polyData) {
          if (polyData.area_m2 != null) overrides.area_m2 = polyData.area_m2;
          if (floorId) {
            const snapshot = useStore.getState().floorSnapshots[floorId];
            if (snapshot?.viewMatrix && snapshot?.projMatrix && polyData.vertices?.length >= 3) {
              const geom = useStore.getState().floorSpaceGeometry?.[floorId] || [];
              const avgY = geom.length > 0 ? geom.reduce((sum, sp) => sum + (sp.y || 0), 0) / geom.length : 0;
              const metrics = computePolygonMetrics(polyData.vertices, snapshot.viewMatrix, snapshot.projMatrix, avgY);
              if (metrics) {
                overrides.perimeter_cm = Math.round(metrics.perimeter_m * 100);
                if (overrides.area_m2 == null) overrides.area_m2 = Math.round(metrics.area_m2 * 100) / 100;
              }
            }
          }
        }

        try {
          const spaceData = await fetchSpaceByGuid(ifcGuid);
          selectSpace(ifcGuid, { ...spaceData, ...overrides });
        } catch (err) {
          selectSpace(ifcGuid, {
            ifc_guid: ifcGuid,
            space_name: polyData?.space_name,
            primary_function: polyData?.primary_function,
            floor_id: floorId,
            ...overrides,
          });
        }
      });

      viewer.cameraControl.on('pickedNothing', () => {
        if (highlightedRef.current) {
          const prev = viewer.scene.objects[highlightedRef.current];
          if (prev) prev.highlighted = false;
          highlightedRef.current = null;
        }
        useStore.getState().setHoveredPolygonGuid(null);
        clearSelection();
      });

      // ── Hover handler: pointer cursor + tooltip over polygon meshes ──
      const canvasEl = viewer.scene.canvas.canvas;
      viewer.cameraControl.on('hover', (e) => {
        if (!e || !e.entity) return;
        const id = e.entity.id;
        if (id.startsWith('polygon-')) {
          canvasEl.style.cursor = 'pointer';
          const ifcGuid = id.slice('polygon-'.length);
          useStore.getState().setHoveredPolygonGuid(ifcGuid);
          const floorId = useStore.getState().activeFloorId;
          const polygons = floorId ? (useStore.getState().floorPolygons[floorId] || []) : [];
          const poly = polygons.find((p) => p.ifc_guid === ifcGuid);
          if (poly) {
            setPolygonTooltip({
              name: poly.space_name || poly.primary_function || ifcGuid,
              area: poly.area_m2 != null ? `${Number(poly.area_m2).toFixed(1)} m²` : null,
              x: e.canvasPos[0] + 14,
              y: e.canvasPos[1] - 10,
            });
          }
        } else {
          useStore.getState().setHoveredPolygonGuid(null);
          setPolygonTooltip(null);
        }
      });

      viewer.cameraControl.on('hoverOut', () => {
        canvasEl.style.cursor = '';
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

  // ── Per-element position offsets (fix z-clipping) ──
  const ELEMENT_OFFSET_OVERRIDES = {
    '3oCszVTFbEdhxb6Y3$XhpG': [0, 0.0001, 0],
    '3oCszVTFbEdhxb6Y3$XhpL': [0, 0.0001, 0],
  };

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
    // Apply position offsets
    for (const [guid, offset] of Object.entries(ELEMENT_OFFSET_OVERRIDES)) {
      const obj = viewer.scene.objects[guid];
      if (obj) {
        obj.offset = offset;
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

    const xMin = Math.min(...spaces.map(s => s.x));
    const zMin = Math.min(...spaces.map(s => s.z));
    const xMax = Math.max(...spaces.map(s => s.x + s.w));
    const zMax = Math.max(...spaces.map(s => s.z + s.d));
    const yAvg = spaces.reduce((sum, s) => sum + (s.y || 0), 0) / spaces.length;

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
      if (active) {
        obj.colorize = getColorForFunction(meta.name || '');
      } else {
        obj.colorize = [0.15, 0.15, 0.18];
      }
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
      });
    } catch (err) {
      console.warn('[Delta] Failed to create polygon mesh:', err);
      return null;
    }
  }

  // ── Render ALL saved floor polygons as pickable 3D meshes ──
  const savedMeshesRef = useRef(new Map()); // ifcGuid → mesh
  const floorPolygons = useStore((s) => s.floorPolygons);
  const hoveredPolygonGuid = useStore((s) => s.hoveredPolygonGuid);
  const floorSnapshots = useStore((s) => s.floorSnapshots);
  const activeRoute = useStore((s) => s.activeRoute);

  // Derive a stable key from snapshot matrices so mesh effect only re-runs when matrices change,
  // not when the image URL updates (Tier 2 hi-res capture)
  const snapshotMatrixKey = useMemo(() => {
    const snap = activeFloorId ? floorSnapshots[activeFloorId] : null;
    if (!snap?.viewMatrix) return null;
    return snap.viewMatrix[12].toFixed(4) + '|' + snap.viewMatrix[14].toFixed(4) + '|' + snap.projMatrix[0].toFixed(4);
  }, [activeFloorId, floorSnapshots]);

  // Create meshes once per floor (invisible by default)
  useEffect(() => {
    const viewer = viewerRef.current;
    for (const mesh of savedMeshesRef.current.values()) {
      try { mesh.destroy(); } catch {}
    }
    savedMeshesRef.current.clear();

    if (!viewer || !activeFloorId || !snapshotMatrixKey) return;

    const polygons = floorPolygons[activeFloorId] || [];
    if (polygons.length === 0) return;

    const snapshot = useStore.getState().floorSnapshots[activeFloorId];
    if (!snapshot?.viewMatrix || !snapshot?.projMatrix) return;

    const geometry = useStore.getState().floorSpaceGeometry;
    const spaces = geometry[activeFloorId] || [];
    const maxYTop = spaces.length > 0
      ? Math.max(...spaces.map(s => s.yTop || s.y || 0))
      : 0;

    for (const poly of polygons) {
      if (!poly.vertices || poly.vertices.length < 3) continue;
      // Always compute fresh world vertices from current snapshot matrices
      // to ensure 3D meshes stay aligned with the current camera/snapshot state
      const mesh = createPolygonMesh(viewer, poly.vertices, snapshot.viewMatrix, snapshot.projMatrix, maxYTop, {
        id: `polygon-${poly.ifc_guid}`,
        pickable: true,
        alpha: 0.01,
        diffuse: [0, 0, 0],
        emissive: [0, 0, 0],
      });
      if (mesh) {
        savedMeshesRef.current.set(poly.ifc_guid, mesh);
      }
    }

    return () => {
      for (const mesh of savedMeshesRef.current.values()) {
        try { mesh.destroy(); } catch {}
      }
      savedMeshesRef.current.clear();
    };
  }, [activeFloorId, floorPolygons, snapshotMatrixKey, loading]);

  // Show orange fill on hover/selection, blue for route target/path, near-invisible otherwise
  useEffect(() => {
    const routePathGuids = activeRoute?.path ? new Set(activeRoute.path.map((p) => p.ifc_guid)) : null;
    for (const [guid, mesh] of savedMeshesRef.current) {
      const isHoverOrSelect = hoveredPolygonGuid === guid || selectedSpaceId === guid;
      const isRouteTarget = activeRoute?.targetGuid === guid;
      const isRoutePath = routePathGuids?.has(guid);
      try {
        if (isRouteTarget) {
          mesh.material.alpha = 0.45;
          mesh.material.diffuse = [0.22, 0.55, 0.99];
          mesh.material.emissive = [0.05, 0.15, 0.4];
        } else if (isRoutePath) {
          mesh.material.alpha = 0.2;
          mesh.material.diffuse = [0.22, 0.55, 0.99];
          mesh.material.emissive = [0.02, 0.08, 0.2];
        } else if (isHoverOrSelect) {
          mesh.material.alpha = 0.45;
          mesh.material.diffuse = [1.0, 0.55, 0.2];
          mesh.material.emissive = [0.4, 0.15, 0.0];
        } else {
          mesh.material.alpha = 0.01;
          mesh.material.diffuse = [0, 0, 0];
          mesh.material.emissive = [0, 0, 0];
        }
      } catch {}
    }
  }, [hoveredPolygonGuid, selectedSpaceId, activeRoute]);


  return (
    <div className="xeokit-viewer">
      <canvas ref={canvasRef} className="xeokit-viewer__canvas" />
      <canvas ref={navCubeCanvasRef} className="xeokit-viewer__navcube" width="200" height="200" />

      {loading && (
        <div className="xeokit-viewer__overlay">
          <div className="xeokit-viewer__spinner" />
          <p>{loadStatus}</p>
        </div>
      )}

      {floorTransitioning && !loading && (
        <div className="xeokit-viewer__transition-overlay">
          <div className="xeokit-viewer__transition-ring">
            <svg viewBox="0 0 50 50">
              <circle className="xeokit-viewer__transition-track" cx="25" cy="25" r="22" />
              <circle className="xeokit-viewer__transition-arc" cx="25" cy="25" r="22" />
            </svg>
          </div>
          <p className="xeokit-viewer__transition-label">{transitionLabel}</p>
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
          {polygonTooltip.area && <div className="xeokit-viewer__polygon-tooltip-area">{polygonTooltip.area}</div>}
        </div>
      )}
    </div>
  );
}
