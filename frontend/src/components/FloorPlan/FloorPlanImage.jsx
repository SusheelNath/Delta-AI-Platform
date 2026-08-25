import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import useStore from '../../store/useStore';
import { getCategoryIndex } from '../../utils/colorScheme';
import PolygonDrawingOverlay from './PolygonDrawingOverlay';
import SavedPolygonsOverlay from './SavedPolygonsOverlay';
import MatchConfirmCard from './MatchConfirmCard';

const ZOOM_FACTOR = 0.85;
const MIN_SCALE = 0.01;
const MAX_SCALE = 30;

function pointInPolygon(px, py, verts) {
  let inside = false;
  for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) {
    const xi = verts[i][0], yi = verts[i][1];
    const xj = verts[j][0], yj = verts[j][1];
    if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

export default function FloorPlanImage({ floorIdOverride }) {
  const storeFloorId = useStore((s) => s.activeFloorId);
  const activeFloorId = floorIdOverride || storeFloorId;
  const floorSnapshots = useStore((s) => s.floorSnapshots);
  const activeFunctionFilters = useStore((s) => s.activeFunctionFilters);
  const searchQuery = useStore((s) => s.searchQuery);
  const selectedSpaceId = useStore((s) => s.selectedSpaceId);
  const mappingMode = useStore((s) => s.mappingMode);
  const addPendingVertex = useStore((s) => s.addPendingVertex);
  const undoPendingVertex = useStore((s) => s.undoPendingVertex);
  const clearPendingPolygon = useStore((s) => s.clearPendingPolygon);
  const setPendingPolygonVertices = useStore((s) => s.setPendingPolygonVertices);
  const setMatchCandidates = useStore((s) => s.setMatchCandidates);
  const matchCandidateList = useStore((s) => s.matchCandidateList);

  const [transform, setTransform] = useState({ scale: 1, tx: 0, ty: 0 });
  const [imgDims, setImgDims] = useState(null); // { w, h } once decoded
  const [drawMousePct, setDrawMousePct] = useState(null);
  const [polygonTooltip, setPolygonTooltip] = useState(null); // { name, area, x, y }
  const containerRef = useRef(null);
  const isPanning = useRef(false);
  const panStart = useRef({ x: 0, y: 0 });
  const didPan = useRef(false);
  const rafRef = useRef(null);

  const snapshot = activeFloorId ? floorSnapshots[activeFloorId] : null;
  const imageUrl = snapshot?.imageUrl || null;
  const spacePositionsRaw = snapshot?.spacePositions || null;

  // Pre-decode image to get dimensions, then fit to container
  useEffect(() => {
    setImgDims(null);
    if (!imageUrl) return;

    const img = new Image();
    img.onload = () => setImgDims({ w: img.naturalWidth, h: img.naturalHeight });
    img.src = imageUrl;
  }, [activeFloorId, imageUrl]);

  // Fit image to container once dimensions and container are ready
  const fitted = !!imgDims;
  useEffect(() => {
    if (!imgDims) return;
    const container = containerRef.current;
    if (!container) return;
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    const fitScale = Math.min(cw / imgDims.w, ch / imgDims.h, 1);
    const scaledW = imgDims.w * fitScale;
    const scaledH = imgDims.h * fitScale;
    setTransform({ scale: fitScale, tx: (cw - scaledW) / 2, ty: (ch - scaledH) / 2 });
  }, [imgDims]);

  // Space positions filtered by function filters
  const spacePositions = useMemo(() => {
    if (!spacePositionsRaw) return [];
    return spacePositionsRaw.map((sp) => {
      const catIdx = getCategoryIndex(sp.name);
      const isActive = catIdx < 0 || activeFunctionFilters[catIdx];
      return { ...sp, catIdx, isActive };
    });
  }, [spacePositionsRaw, activeFunctionFilters]);

  // Filter spaces matching search query
  const searchMatches = useMemo(() => {
    if (!searchQuery || searchQuery.trim().length === 0) return null;
    const q = searchQuery.toLowerCase().trim();
    return new Set(
      spacePositions
        .filter((sp) => sp.name.toLowerCase().includes(q))
        .map((sp) => sp.id)
    );
  }, [searchQuery, spacePositions]);

  // Convert client coords to image percentage coords
  const clientToPct = useCallback((clientX, clientY) => {
    const container = containerRef.current;
    if (!container) return null;
    const img = container.querySelector('img');
    if (!img) return null;
    const rect = img.getBoundingClientRect();
    return [
      ((clientX - rect.left) / rect.width) * 100,
      ((clientY - rect.top) / rect.height) * 100,
    ];
  }, []);

  // Finish polygon — find matching spaces
  const finishPolygon = useCallback(() => {
    const rawVerts = useStore.getState().pendingPolygonVertices;
    // Remove duplicate vertices from double-click
    const vertices = [...rawVerts];
    while (vertices.length > 3) {
      const last = vertices[vertices.length - 1];
      const prev = vertices[vertices.length - 2];
      if (Math.abs(last[0] - prev[0]) < 0.5 && Math.abs(last[1] - prev[1]) < 0.5) {
        vertices.pop();
      } else {
        break;
      }
    }

    if (vertices.length < 3) {
      clearPendingPolygon();
      return;
    }

    // Write deduplicated vertices back to store
    setPendingPolygonVertices(vertices);

    // Compute centroid
    const cx = vertices.reduce((s, v) => s + v[0], 0) / vertices.length;
    const cy = vertices.reduce((s, v) => s + v[1], 0) / vertices.length;

    // Filter out already-mapped spaces
    const existingPolygons = useStore.getState().floorPolygons[activeFloorId] || [];
    const mappedGuids = new Set(existingPolygons.map((p) => p.ifc_guid));

    // Find candidate matches
    const candidates = spacePositions
      .filter((sp) => sp.isActive && !mappedGuids.has(sp.id))
      .map((sp) => {
        const inside = pointInPolygon(sp.leftPct, sp.topPct, vertices);
        const dist = Math.sqrt((sp.leftPct - cx) ** 2 + (sp.topPct - cy) ** 2);
        return { ...sp, inside, distance: dist };
      })
      .sort((a, b) => {
        if (a.inside && !b.inside) return -1;
        if (!a.inside && b.inside) return 1;
        return a.distance - b.distance;
      })
      .slice(0, 20); // Top 20 candidates

    if (candidates.length > 0) {
      setMatchCandidates(candidates);
    } else {
      clearPendingPolygon();
    }
  }, [activeFloorId, spacePositions, clearPendingPolygon, setPendingPolygonVertices, setMatchCandidates]);

  // Click handler — mapping mode vertex placement
  const handleImageClick = useCallback((e) => {
    if (didPan.current) return;
    if (!imageUrl) return;

    if (mappingMode && matchCandidateList.length === 0) {
      const pct = clientToPct(e.clientX, e.clientY);
      if (pct) addPendingVertex(pct);
    }
  }, [imageUrl, mappingMode, matchCandidateList.length, addPendingVertex, clientToPct]);

  // Pan/zoom handlers
  const handleWheel = useCallback((e) => {
    e.preventDefault();
    const zoomIn = e.deltaY < 0;
    const factor = zoomIn ? 1 / ZOOM_FACTOR : ZOOM_FACTOR;
    setTransform((prev) => {
      const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, prev.scale * factor));
      if (newScale === prev.scale) return prev;

      const container = containerRef.current;
      if (!container) return { ...prev, scale: newScale };
      const rect = container.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;

      const ratio = newScale / prev.scale;
      return {
        scale: newScale,
        tx: cx - (cx - prev.tx) * ratio,
        ty: cy - (cy - prev.ty) * ratio,
      };
    });
  }, []);

  const handleMouseDown = useCallback((e) => {
    if (e.button === 0 || e.button === 1) {
      isPanning.current = true;
      didPan.current = false;
      panStart.current = { x: e.clientX, y: e.clientY };
    }
  }, []);

  // Throttled mouse move via requestAnimationFrame
  const handleMouseMove = useCallback((e) => {
    const clientX = e.clientX;
    const clientY = e.clientY;

    // Panning is immediate (no throttle)
    if (isPanning.current) {
      const dx = clientX - panStart.current.x;
      const dy = clientY - panStart.current.y;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) didPan.current = true;
      panStart.current = { x: clientX, y: clientY };
      setTransform((prev) => ({ ...prev, tx: prev.tx + dx, ty: prev.ty + dy }));
    }

    // Draw position tracking throttled to animation frame
    if (mappingMode) {
      if (rafRef.current) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        const pct = clientToPct(clientX, clientY);
        setDrawMousePct(pct);
      });
    }
  }, [mappingMode, clientToPct]);

  const handleMouseUp = useCallback(() => {
    isPanning.current = false;
  }, []);

  const handleMouseLeave = useCallback(() => {
    isPanning.current = false;
    setDrawMousePct(null);
    setPolygonTooltip(null);
  }, []);

  const handleDoubleClick = useCallback(() => {
    if (mappingMode) {
      finishPolygon();
      return;
    }
    const container = containerRef.current;
    if (!container || !imgDims) {
      setTransform({ scale: 1, tx: 0, ty: 0 });
      return;
    }
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    const fitScale = Math.min(cw / imgDims.w, ch / imgDims.h, 1);
    const scaledW = imgDims.w * fitScale;
    const scaledH = imgDims.h * fitScale;
    setTransform({ scale: fitScale, tx: (cw - scaledW) / 2, ty: (ch - scaledH) / 2 });
  }, [imgDims, mappingMode, finishPolygon]);

  // Keyboard shortcuts for mapping mode
  useEffect(() => {
    if (!mappingMode) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        clearPendingPolygon();
      } else if (e.key === 'z' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        undoPendingVertex();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mappingMode, clearPendingPolygon, undoPendingVertex]);

  // Zoom 2D view to center on selected polygon
  useEffect(() => {
    if (!selectedSpaceId || !activeFloorId || !imgDims) return;
    const container = containerRef.current;
    if (!container) return;

    const polygons = useStore.getState().floorPolygons[activeFloorId] || [];
    const poly = polygons.find((p) => p.ifc_guid === selectedSpaceId);
    if (!poly?.vertices || poly.vertices.length < 3) return;

    // Bounding box of the polygon in percentage coords
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const v of poly.vertices) {
      if (v[0] < minX) minX = v[0];
      if (v[0] > maxX) maxX = v[0];
      if (v[1] < minY) minY = v[1];
      if (v[1] > maxY) maxY = v[1];
    }

    // Centroid in image pixels
    const cx = ((minX + maxX) / 2 / 100) * imgDims.w;
    const cy = ((minY + maxY) / 2 / 100) * imgDims.h;

    // Target scale: fit polygon with padding
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    const polyW = ((maxX - minX) / 100) * imgDims.w;
    const polyH = ((maxY - minY) / 100) * imgDims.h;
    const padding = 3;
    const targetScale = Math.min(cw / (polyW * padding), ch / (polyH * padding), MAX_SCALE);

    // Center polygon centroid in container
    setTransform({
      scale: targetScale,
      tx: cw / 2 - cx * targetScale,
      ty: ch / 2 - cy * targetScale,
    });
  }, [selectedSpaceId, activeFloorId, imgDims]);

  // Attach non-passive wheel listener
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [handleWheel, fitted]);

  // Cleanup RAF on unmount
  useEffect(() => {
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, []);

  // Empty state — no floor selected
  if (!activeFloorId) {
    return (
      <div className="floor-plan-image__empty">
        <p>Select a floor to view plan</p>
      </div>
    );
  }

  // Show spinner while snapshot is generating
  if (!imageUrl) {
    return (
      <div className="floor-plan-image__empty">
        <div className="floor-plan-image__spinner" />
        <p>Capturing floor plan...</p>
      </div>
    );
  }

  const isSearching = searchMatches !== null;
  const showMatchCard = mappingMode && matchCandidateList.length > 0;

  return (
    <div
      ref={containerRef}
      className={`floor-plan-image ${mappingMode ? 'floor-plan-image--mapping' : ''}`}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
      onDoubleClick={handleDoubleClick}
    >
      <div
        className="floor-plan-image__transform"
        style={{
          transform: `translate(${transform.tx}px, ${transform.ty}px) scale(${transform.scale})`,
          visibility: fitted ? 'visible' : 'hidden',
        }}
      >
        <img
          src={imageUrl}
          alt="Floor plan"
          className="floor-plan-image__img"
          draggable={false}
          onClick={handleImageClick}
          style={isSearching ? { filter: 'brightness(0.6)' } : undefined}
        />

        {/* Saved polygon outlines (Phase C) */}
        <SavedPolygonsOverlay floorId={activeFloorId} onTooltipChange={setPolygonTooltip} />

        {/* Drawing overlay (Phase B) */}
        {mappingMode && (
          <PolygonDrawingOverlay mousePos={drawMousePct} />
        )}

        {/* Search-matched labels */}
        {isSearching && spacePositions.map((sp) => {
          if (!searchMatches.has(sp.id)) return null;
          return (
            <span
              key={sp.id}
              className="floor-plan-image__label floor-plan-image__label--search"
              style={{ left: `${sp.leftPct}%`, top: `${sp.topPct}%` }}
            >
              {sp.name}
            </span>
          );
        })}
      </div>

      {/* Polygon hover tooltip — outside transform so it doesn't scale/pan */}
      {polygonTooltip && (
        <div className="saved-polygon__tooltip" style={{ left: polygonTooltip.x, top: polygonTooltip.y }}>
          <div className="saved-polygon__tooltip-name">{polygonTooltip.name}</div>
          {polygonTooltip.area && <div className="saved-polygon__tooltip-area">{polygonTooltip.area}</div>}
        </div>
      )}

      {/* Search result count */}
      {isSearching && (
        <div className="floor-plan-image__search-badge">
          {searchMatches.size} {searchMatches.size === 1 ? 'match' : 'matches'}
        </div>
      )}

      {/* Mapping mode indicator */}
      {mappingMode && !showMatchCard && (
        <div className="floor-plan-image__mapping-hint">
          Click to add vertices. Double-click to finish. Esc to cancel.
        </div>
      )}

      {/* Match confirmation card */}
      {showMatchCard && <MatchConfirmCard />}
    </div>
  );
}
