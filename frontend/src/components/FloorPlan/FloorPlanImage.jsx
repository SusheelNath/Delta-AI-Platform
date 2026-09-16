import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import useStore from '../../store/useStore';
import { getCategoryIndex } from '../../utils/colorScheme';
import SavedPolygonsOverlay from './SavedPolygonsOverlay';
import VertexEditOverlay from './VertexEditOverlay';
import PolygonDrawingOverlay from './PolygonDrawingOverlay';
import DeltaSpinner from '../shared/DeltaSpinner';

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
  const editingGeometry = useStore((s) => s.editingGeometry);
  const findRoomResults = useStore((s) => s.findRoomResults);
  const clearHighlights = useStore((s) => s.clearHighlights);

  const [transform, setTransform] = useState({ scale: 1, tx: 0, ty: 0 });
  const [imgDims, setImgDims] = useState(null); // { w, h } once decoded
  const [polygonTooltip, setPolygonTooltip] = useState(null); // { name, area, x, y }
  const [redrawMousePos, setRedrawMousePos] = useState(null);
  const containerRef = useRef(null);
  const transformElRef = useRef(null);
  const isPanning = useRef(false);
  const panStart = useRef({ x: 0, y: 0 });
  const didPan = useRef(false);
  const rafId = useRef(0);
  const zoomTarget = useRef(null); // { scale, tx, ty }
  const zoomRaf = useRef(null);

  const snapshot = activeFloorId ? floorSnapshots[activeFloorId] : null;
  const imageUrl = snapshot?.imageUrl || null;
  const spacePositionsRaw = snapshot?.spacePositions || null;

  // Crossfade: keep previous image visible while new one loads
  const prevImageRef = useRef(null);
  const [crossfading, setCrossfading] = useState(false);
  useEffect(() => {
    if (imageUrl && prevImageRef.current && prevImageRef.current !== imageUrl) {
      setCrossfading(true);
      const timer = setTimeout(() => setCrossfading(false), 350);
      return () => clearTimeout(timer);
    }
    if (imageUrl) prevImageRef.current = imageUrl;
  }, [imageUrl]);

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

  // Pan/zoom handlers — lerped smooth zoom
  const LERP_FACTOR = 0.18;

  const startZoomLerp = useCallback(() => {
    if (zoomRaf.current) return;
    const tick = () => {
      const target = zoomTarget.current;
      if (!target) { zoomRaf.current = null; return; }
      setTransform((prev) => {
        const ds = target.scale - prev.scale;
        const dx = target.tx - prev.tx;
        const dy = target.ty - prev.ty;
        if (Math.abs(ds) < 0.0005 && Math.abs(dx) < 0.3 && Math.abs(dy) < 0.3) {
          zoomTarget.current = null;
          return target; // snap to final
        }
        const next = {
          scale: prev.scale + ds * LERP_FACTOR,
          tx: prev.tx + dx * LERP_FACTOR,
          ty: prev.ty + dy * LERP_FACTOR,
        };
        if (transformElRef.current) {
          transformElRef.current.style.transform = `translate(${next.tx}px, ${next.ty}px) scale(${next.scale})`;
        }
        return next;
      });
      if (zoomTarget.current) {
        zoomRaf.current = requestAnimationFrame(tick);
      } else {
        zoomRaf.current = null;
      }
    };
    zoomRaf.current = requestAnimationFrame(tick);
  }, []);

  const handleWheel = useCallback((e) => {
    e.preventDefault();
    const zoomIn = e.deltaY < 0;
    const factor = zoomIn ? 1 / ZOOM_FACTOR : ZOOM_FACTOR;

    // Compute target from current target (for chaining rapid scrolls) or current transform
    const base = zoomTarget.current || { scale: 0, tx: 0, ty: 0 };
    setTransform((prev) => {
      const from = zoomTarget.current || prev;
      const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, from.scale * factor));
      if (newScale === from.scale) return prev;

      const container = containerRef.current;
      if (!container) { zoomTarget.current = { ...from, scale: newScale }; startZoomLerp(); return prev; }
      const rect = container.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;

      const ratio = newScale / from.scale;
      zoomTarget.current = {
        scale: newScale,
        tx: cx - (cx - from.tx) * ratio,
        ty: cy - (cy - from.ty) * ratio,
      };
      startZoomLerp();
      return prev; // don't jump — lerp will animate
    });
  }, [startZoomLerp]);

  const handleMouseDown = useCallback((e) => {
    if (e.button === 0 || e.button === 1) {
      isPanning.current = true;
      didPan.current = false;
      panStart.current = { x: e.clientX, y: e.clientY };
      // Cancel any in-flight zoom lerp so pan doesn't fight it
      zoomTarget.current = null;
      if (zoomRaf.current) { cancelAnimationFrame(zoomRaf.current); zoomRaf.current = null; }
    }
  }, []);

  const handleMouseMove = useCallback((e) => {
    if (isPanning.current) {
      const dx = e.clientX - panStart.current.x;
      const dy = e.clientY - panStart.current.y;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) didPan.current = true;
      panStart.current = { x: e.clientX, y: e.clientY };
      // Apply CSS transform directly for zero-lag panning, defer React state
      setTransform((prev) => {
        const next = { ...prev, tx: prev.tx + dx, ty: prev.ty + dy };
        if (transformElRef.current) {
          cancelAnimationFrame(rafId.current);
          rafId.current = requestAnimationFrame(() => {
            if (transformElRef.current) {
              transformElRef.current.style.transform = `translate(${next.tx}px, ${next.ty}px) scale(${next.scale})`;
            }
          });
        }
        return next;
      });
    }

    // Track mouse position for redraw preview line
    const eg = useStore.getState().editingGeometry;
    if (eg && eg.mode === 'redraw' && transformElRef.current) {
      const rect = transformElRef.current.getBoundingClientRect();
      setRedrawMousePos([
        ((e.clientX - rect.left) / rect.width) * 100,
        ((e.clientY - rect.top) / rect.height) * 100,
      ]);
    }
  }, []);

  const handleMouseUp = useCallback(() => {
    isPanning.current = false;
  }, []);

  const handleClick = useCallback((e) => {
    if (didPan.current) return;

    // In redraw mode, clicks add vertices
    const eg = useStore.getState().editingGeometry;
    if (eg && eg.mode === 'redraw') {
      const transformEl = transformElRef.current;
      if (!transformEl) return;
      const rect = transformEl.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 100;
      const y = ((e.clientY - rect.top) / rect.height) * 100;
      useStore.getState().addPendingVertex([x, y]);
      return;
    }

    // Default: clear highlights on click in empty space
    useStore.getState().clearHighlights();
  }, []);

  const handleMouseLeave = useCallback(() => {
    isPanning.current = false;
    setPolygonTooltip(null);
    setRedrawMousePos(null);
  }, []);

  // Right-click: undo last vertex in redraw mode
  const handleContextMenu = useCallback((e) => {
    const eg = useStore.getState().editingGeometry;
    if (eg && eg.mode === 'redraw') {
      e.preventDefault();
      useStore.getState().undoPendingVertex();
    }
  }, []);

  // Keyboard: Enter to confirm, Escape to cancel geometry edit
  useEffect(() => {
    if (!editingGeometry) return;
    const onKey = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); useStore.getState().confirmGeometryEdit(); }
      if (e.key === 'Escape') { e.preventDefault(); useStore.getState().cancelGeometryEdit(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editingGeometry]);

  const handleDoubleClick = useCallback(() => {
    // Don't reset zoom during geometry editing
    if (useStore.getState().editingGeometry) return;
    const container = containerRef.current;
    if (!container || !imgDims) {
      zoomTarget.current = { scale: 1, tx: 0, ty: 0 };
      startZoomLerp();
      return;
    }
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    const fitScale = Math.min(cw / imgDims.w, ch / imgDims.h, 1);
    const scaledW = imgDims.w * fitScale;
    const scaledH = imgDims.h * fitScale;
    zoomTarget.current = { scale: fitScale, tx: (cw - scaledW) / 2, ty: (ch - scaledH) / 2 };
    startZoomLerp();
  }, [imgDims, startZoomLerp]);

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

    // Center polygon centroid in container — lerped
    zoomTarget.current = {
      scale: targetScale,
      tx: cw / 2 - cx * targetScale,
      ty: ch / 2 - cy * targetScale,
    };
    startZoomLerp();
  }, [selectedSpaceId, activeFloorId, imgDims, startZoomLerp]);

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
        <svg width="56" height="56" viewBox="0 0 56 56" fill="none" opacity="0.5">
          <rect x="8" y="12" width="40" height="32" rx="2" stroke="#c0bbb3" strokeWidth="1.2" />
          <line x1="8" y1="28" x2="48" y2="28" stroke="#c0bbb3" strokeWidth="0.8" strokeDasharray="3 2" />
          <line x1="28" y1="28" x2="28" y2="44" stroke="#c0bbb3" strokeWidth="0.8" strokeDasharray="3 2" />
          <line x1="20" y1="12" x2="20" y2="28" stroke="#c0bbb3" strokeWidth="0.8" strokeDasharray="3 2" />
          <line x1="38" y1="12" x2="38" y2="28" stroke="#c0bbb3" strokeWidth="0.8" strokeDasharray="3 2" />
          <path d="M28 20l5 8h-10z" fill="none" stroke="#E77133" strokeWidth="1" strokeLinejoin="round" opacity="0.6" />
        </svg>
        <p style={{ fontWeight: 600, color: '#6b7280', fontSize: '14px' }}>Select a floor</p>
        <p style={{ color: '#9ca3af', fontSize: '11.5px' }}>Choose a floor from the dropdown to view plan</p>
      </div>
    );
  }

  // Show spinner while snapshot is generating
  if (!imageUrl) {
    return (
      <div className="floor-plan-image__empty">
        <DeltaSpinner size={64} label="Capturing floor plan..." />
      </div>
    );
  }

  const isSearching = searchMatches !== null;
  return (
    <div
      ref={containerRef}
      className={`floor-plan-image ${editingGeometry ? 'floor-plan-image--editing' : ''}`}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onContextMenu={handleContextMenu}
    >
      <div
        ref={transformElRef}
        className="floor-plan-image__transform"
        style={{
          transform: `translate(${transform.tx}px, ${transform.ty}px) scale(${transform.scale})`,
          visibility: fitted ? 'visible' : 'hidden',
        }}
      >
        <img
          src={imageUrl}
          alt="Floor plan"
          className={`floor-plan-image__img ${crossfading ? 'floor-plan-image__img--fade-in' : ''}`}
          draggable={false}
          style={isSearching ? { filter: 'brightness(0.6)' } : activeRoute ? { filter: 'brightness(0.35)' } : undefined}
          onLoad={() => { prevImageRef.current = imageUrl; }}
        />

        {/* Saved polygon outlines */}
        <SavedPolygonsOverlay floorId={activeFloorId} onTooltipChange={setPolygonTooltip} />

        {/* Vertex editing overlay */}
        {editingGeometry?.mode === 'vertex' && <VertexEditOverlay />}

        {/* Redraw drawing overlay */}
        {editingGeometry?.mode === 'redraw' && <PolygonDrawingOverlay mousePos={redrawMousePos} />}

        {/* Route navigation — breathing dot trail */}
        {activeRoute?.pathLine && activeRoute.pathLine.length >= 2 && (() => {
          const pl = activeRoute.pathLine;
          const pts = pl.map((p) => `${p[0]},${p[1]}`).join(' ');
          return (
            <svg
              className="routing-line-overlay routing-line-overlay--breathe"
              style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 3 }}
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
            >
              {/* Faint wide glow layer */}
              <polyline
                className="routing-line-overlay__glow"
                points={pts}
                fill="none"
                stroke="rgba(79, 195, 254, 0.35)"
                strokeWidth="5"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray="2 8"
                vectorEffect="non-scaling-stroke"
              />
              {/* Crisp bright dot layer */}
              <polyline
                className="routing-line-overlay__dots"
                points={pts}
                fill="none"
                stroke="#4fc3fe"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray="2 8"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
          );
        })()}

        {/* Route waypoint labels */}
        {activeRoute?.waypoints?.map((wp) => (
          <span
            key={wp.guid}
            className={`floor-plan-image__route-label ${wp.isDestination ? 'floor-plan-image__route-label--dest' : ''}`}
            style={{ left: `${wp.centroid[0]}%`, top: `${wp.centroid[1]}%` }}
          >
            {wp.isDestination ? wp.name : `via ${wp.name}`}
          </span>
        ))}

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
          {polygonTooltip.findRoom ? (
            <div className="saved-polygon__tooltip-evac">
              {polygonTooltip.fn && polygonTooltip.fn !== polygonTooltip.name && (
                <div className="saved-polygon__tooltip-fn">{polygonTooltip.fn}</div>
              )}
              {(polygonTooltip.zone || polygonTooltip.areaM2) && (
                <div className="saved-polygon__tooltip-meta">
                  {polygonTooltip.zone}{polygonTooltip.zone && polygonTooltip.areaM2 ? ' · ' : ''}{polygonTooltip.areaM2 && `${polygonTooltip.areaM2} m²`}
                </div>
              )}
              <div className="saved-polygon__tooltip-meta">
                Capacity: {polygonTooltip.findRoomCapacity}
              </div>
              <div className="saved-polygon__tooltip-band">
                <span className="saved-polygon__tooltip-dot" style={{ background: polygonTooltip.findRoomType === 'direct' ? '#E77133' : '#3B82F6' }} />
                <span>{polygonTooltip.findRoomType === 'direct' ? 'Matches capacity' : 'Repurpose candidate'}</span>
              </div>
              <div className="saved-polygon__tooltip-reason">{polygonTooltip.findRoomReason}</div>
            </div>
          ) : polygonTooltip.evacMode ? (
            <div className="saved-polygon__tooltip-evac">
              {polygonTooltip.fn && polygonTooltip.fn !== polygonTooltip.name && (
                <div className="saved-polygon__tooltip-fn">{polygonTooltip.fn}</div>
              )}
              {(polygonTooltip.zone || polygonTooltip.areaM2) && (
                <div className="saved-polygon__tooltip-meta">
                  {polygonTooltip.zone}{polygonTooltip.zone && polygonTooltip.areaM2 ? ' · ' : ''}{polygonTooltip.areaM2 && `${polygonTooltip.areaM2} m²`}
                </div>
              )}
              {polygonTooltip.evacOccupancy > 0 && (
                <div className="saved-polygon__tooltip-meta">
                  {polygonTooltip.evacOccupancy} people{polygonTooltip.evacDensity ? ` · ${polygonTooltip.evacDensity} ppl/m²` : ''}
                </div>
              )}
              <div className="saved-polygon__tooltip-band">
                <span className="saved-polygon__tooltip-dot" style={{ background: polygonTooltip.evacColor }} />
                <span>{polygonTooltip.evacLabel}</span>
              </div>
              <div className="saved-polygon__tooltip-reason">{polygonTooltip.evacReason}</div>
            </div>
          ) : (
            polygonTooltip.area && <div className="saved-polygon__tooltip-area">{polygonTooltip.area}</div>
          )}
        </div>
      )}

      {/* Route distance & travel time badge */}
      {activeRoute?.distanceM != null && (() => {
        const secs = Math.round(activeRoute.distanceM / 1.2);
        const timeStr = secs < 60
          ? `~${Math.max(5, Math.round(secs / 5) * 5)} sec walk`
          : `~${Math.max(1, Math.round(secs / 60))} min walk`;
        return (
          <div className="floor-plan-image__route-badge">
            <span className="floor-plan-image__route-badge-dist">{activeRoute.distanceM.toFixed(1)} m</span>
            <span className="floor-plan-image__route-badge-sep" />
            <span className="floor-plan-image__route-badge-time">{timeStr}</span>
          </div>
        );
      })()}

      {/* Search result count */}
      {isSearching && (
        <div className="floor-plan-image__search-badge">
          {searchMatches.size} {searchMatches.size === 1 ? 'match' : 'matches'}
        </div>
      )}

      {/* Find Room legend */}
      {findRoomResults && Object.keys(findRoomResults).length > 0 && (
        <div className="floor-plan-image__find-room-legend">
          <div className="floor-plan-image__find-room-legend-header">
            <span className="floor-plan-image__find-room-legend-title">Room Finder</span>
            <button
              className="floor-plan-image__find-room-legend-close"
              onClick={() => clearHighlights()}
              title="Clear results"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><line x1="2" y1="2" x2="8" y2="8"/><line x1="8" y1="2" x2="2" y2="8"/></svg>
            </button>
          </div>
          <div className="floor-plan-image__find-room-legend-bands">
            <div className="floor-plan-image__find-room-legend-band">
              <span className="floor-plan-image__find-room-legend-dot" style={{ background: '#E77133' }} />
              Matches capacity
            </div>
            <div className="floor-plan-image__find-room-legend-band">
              <span className="floor-plan-image__find-room-legend-dot" style={{ background: '#3B82F6' }} />
              Repurpose candidate
            </div>
          </div>
          <div className="floor-plan-image__find-room-legend-count">
            {Object.keys(findRoomResults).length} rooms
          </div>
        </div>
      )}

    </div>
  );
}
