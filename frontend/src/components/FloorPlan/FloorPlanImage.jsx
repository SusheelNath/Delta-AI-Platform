import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import useStore from '../../store/useStore';
import { getCategoryIndex } from '../../utils/colorScheme';
import SavedPolygonsOverlay from './SavedPolygonsOverlay';

const ZOOM_FACTOR = 0.85;
const MIN_SCALE = 0.01;
const MAX_SCALE = 30;

export default function FloorPlanImage({ floorIdOverride }) {
  const storeFloorId = useStore((s) => s.activeFloorId);
  const activeFloorId = floorIdOverride || storeFloorId;
  const floorSnapshots = useStore((s) => s.floorSnapshots);
  const activeFunctionFilters = useStore((s) => s.activeFunctionFilters);
  const searchQuery = useStore((s) => s.searchQuery);
  const selectedSpaceId = useStore((s) => s.selectedSpaceId);
  const activeRoute = useStore((s) => s.activeRoute);

  const [transform, setTransform] = useState({ scale: 1, tx: 0, ty: 0 });
  const [imgDims, setImgDims] = useState(null); // { w, h } once decoded
  const [polygonTooltip, setPolygonTooltip] = useState(null); // { name, area, x, y }
  const containerRef = useRef(null);
  const isPanning = useRef(false);
  const panStart = useRef({ x: 0, y: 0 });
  const didPan = useRef(false);

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

  const handleMouseMove = useCallback((e) => {
    if (isPanning.current) {
      const dx = e.clientX - panStart.current.x;
      const dy = e.clientY - panStart.current.y;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) didPan.current = true;
      panStart.current = { x: e.clientX, y: e.clientY };
      setTransform((prev) => ({ ...prev, tx: prev.tx + dx, ty: prev.ty + dy }));
    }
  }, []);

  const handleMouseUp = useCallback(() => {
    isPanning.current = false;
  }, []);

  const handleMouseLeave = useCallback(() => {
    isPanning.current = false;
    setPolygonTooltip(null);
  }, []);

  const handleDoubleClick = useCallback(() => {
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
  }, [imgDims]);

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
  return (
    <div
      ref={containerRef}
      className="floor-plan-image"
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
          style={isSearching ? { filter: 'brightness(0.6)' } : undefined}
        />

        {/* Saved polygon outlines */}
        <SavedPolygonsOverlay floorId={activeFloorId} onTooltipChange={setPolygonTooltip} />

        {/* Routing navigation line */}
        {activeRoute?.centroids && activeRoute.centroids.length >= 2 && (
          <svg
            className="routing-line-overlay"
            style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
          >
            <polyline
              points={activeRoute.centroids.map((c) => `${c[0]},${c[1]}`).join(' ')}
              fill="none"
              stroke="#388bfd"
              strokeWidth="0.35"
              vectorEffect="non-scaling-stroke"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray="4 2"
            />
            {/* Start dot */}
            <circle cx={activeRoute.centroids[0][0]} cy={activeRoute.centroids[0][1]} r="0.5" fill="#388bfd" />
            {/* End dot */}
            <circle
              cx={activeRoute.centroids[activeRoute.centroids.length - 1][0]}
              cy={activeRoute.centroids[activeRoute.centroids.length - 1][1]}
              r="0.6"
              fill="#79b8ff"
              stroke="#388bfd"
              strokeWidth="0.15"
            />
          </svg>
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

    </div>
  );
}
