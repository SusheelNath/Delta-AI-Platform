import React, { useCallback, useMemo } from 'react';
import useStore from '../../store/useStore';
import { computePolygonMetrics } from '../../utils/unprojectPolygon';
import { buildEvacTooltip } from '../../utils/evacTooltip';

/** Get polygon-derived area (stored) and perimeter (computed) for Space Toolkit. */
function getPolygonOverrides(polygon, floorId) {
  const overrides = {};
  // Use stored area (same value the tooltip shows)
  if (polygon.area_m2 != null) {
    overrides.area_m2 = polygon.area_m2;
  }
  // Compute perimeter from vertices + snapshot matrices
  const snapshot = useStore.getState().floorSnapshots[floorId];
  if (snapshot?.viewMatrix && snapshot?.projMatrix && polygon.vertices?.length >= 3) {
    const geom = useStore.getState().floorSpaceGeometry?.[floorId] || [];
    const avgY = geom.length > 0 ? geom.reduce((sum, s) => sum + (s.y || 0), 0) / geom.length : 0;
    const metrics = computePolygonMetrics(polygon.vertices, snapshot.viewMatrix, snapshot.projMatrix, avgY);
    if (metrics) {
      overrides.perimeter_cm = Math.round(metrics.perimeter_m * 100);
      // Also set area from computation if not stored
      if (overrides.area_m2 == null) {
        overrides.area_m2 = Math.round(metrics.area_m2 * 100) / 100;
      }
    }
  }
  return overrides;
}

export default function SavedPolygonsOverlay({ floorId, onTooltipChange }) {
  const polygons = useStore((s) => s.floorPolygons[floorId] || []);
  const selectedSpaceId = useStore((s) => s.selectedSpaceId);
  const hoveredPolygonGuid = useStore((s) => s.hoveredPolygonGuid);
  const activeRoute = useStore((s) => s.activeRoute);
  const highlightedGuids = useStore((s) => s.highlightedGuids);
  const repurposeGuids = useStore((s) => s.repurposeGuids);
  const editingGeometry = useStore((s) => s.editingGeometry);
  const setHoveredPolygonGuid = useStore((s) => s.setHoveredPolygonGuid);
  const selectSpace = useStore((s) => s.selectSpace);
  const mappingMode = useStore((s) => s.mappingMode);
  const isDrawing = useStore((s) => s.mappingMode && s.pendingPolygonVertices.length > 0);

  // Build position map for gradient intensity along route path (Option C)
  const routePathMap = useMemo(() => {
    if (!activeRoute?.path) return null;
    const map = new Map();
    const len = activeRoute.path.length;
    activeRoute.path.forEach((p, i) => {
      map.set(p.ifc_guid, len > 1 ? i / (len - 1) : 0);
    });
    return map;
  }, [activeRoute]);

  const handleClick = useCallback((e, polygon) => {
    e.stopPropagation();
    let overrides = {};
    try {
      overrides = getPolygonOverrides(polygon, floorId);
    } catch (err) {
      console.warn('[Delta] getPolygonOverrides failed:', err);
    }
    const intel = useStore.getState().getIntelligence(polygon.ifc_guid);
    if (intel) {
      selectSpace(polygon.ifc_guid, { ...intel, ...overrides });
    } else {
      selectSpace(polygon.ifc_guid, {
        ifc_guid: polygon.ifc_guid,
        space_name: polygon.space_name,
        primary_function: polygon.primary_function,
        floor_id: floorId,
        ...overrides,
      });
    }
  }, [selectSpace, floorId]);

  const handleMouseEnter = useCallback((e, polygon) => {
    setHoveredPolygonGuid(polygon.ifc_guid);
    const name = polygon.space_name || polygon.primary_function || polygon.ifc_guid;
    const area = polygon.area_m2 != null ? `${Number(polygon.area_m2).toFixed(1)} m\u00B2` : null;
    // Position relative to the main container (outside transform)
    const container = e.currentTarget.closest('.floor-plan-image');
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const tip = { name, area, x: e.clientX - rect.left + 14, y: e.clientY - rect.top - 10 };
    // Enrich in evacuation mode
    const st = useStore.getState();
    if (st.heatmapMode === 'evacuation') {
      const floorPolys = st.floorPolygons[floorId] || [];
      buildEvacTooltip(tip, polygon, floorPolys);
    }
    // Enrich with find_room reasoning
    const frResults = st.findRoomResults;
    if (frResults && frResults[polygon.ifc_guid]) {
      const fr = frResults[polygon.ifc_guid];
      tip.findRoom = true;
      tip.findRoomType = fr.type;
      tip.findRoomCapacity = fr.capacity;
      tip.findRoomReason = fr.reason;
      tip.fn = polygon.primary_function || '';
      tip.zone = polygon.functional_zone || '';
      tip.areaM2 = polygon.area_m2 != null ? Number(polygon.area_m2).toFixed(1) : null;
    }
    onTooltipChange?.(tip);
  }, [setHoveredPolygonGuid, onTooltipChange, floorId]);

  const handleMouseMove = useCallback((e) => {
    const container = e.currentTarget.closest('.floor-plan-image');
    if (!container) return;
    const rect = container.getBoundingClientRect();
    onTooltipChange?.((prev) => prev ? { ...prev, x: e.clientX - rect.left + 14, y: e.clientY - rect.top - 10 } : null);
  }, [onTooltipChange]);

  const handleMouseLeave = useCallback(() => {
    setHoveredPolygonGuid(null);
    onTooltipChange?.(null);
  }, [setHoveredPolygonGuid, onTooltipChange]);

  if (polygons.length === 0) return null;

  const highlightSet = useMemo(() => {
    if (!highlightedGuids || highlightedGuids.length === 0) return null;
    return new Set(highlightedGuids);
  }, [highlightedGuids]);

  const repurposeSet = useMemo(() => {
    if (!repurposeGuids || repurposeGuids.length === 0) return null;
    return new Set(repurposeGuids);
  }, [repurposeGuids]);

  const routeStartGuid = activeRoute?.path?.[0]?.ifc_guid || null;
  const hasRoute = !!routePathMap;

  // Cache points strings — only recomputed when polygon vertices change
  const pointsCache = useMemo(() => {
    const cache = new Map();
    for (const poly of polygons) {
      cache.set(poly.ifc_guid, poly.vertices.map((v) => `${v[0]},${v[1]}`).join(' '));
    }
    return cache;
  }, [polygons]);

  return (
    <svg
      className="saved-polygons-overlay"
      style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
    >
      {polygons.map((poly) => {
        const pts = pointsCache.get(poly.ifc_guid);
        const isSelected = selectedSpaceId === poly.ifc_guid;
        const isHovered = hoveredPolygonGuid === poly.ifc_guid;

        // Route role detection
        const isRouteStart = routeStartGuid === poly.ifc_guid;
        const isRouteTarget = activeRoute?.targetGuid === poly.ifc_guid;
        const routeT = routePathMap?.get(poly.ifc_guid);
        const isRouteMid = routeT !== undefined && !isRouteStart && !isRouteTarget;

        const isBeingEdited = editingGeometry?.ifc_guid === poly.ifc_guid;
        let fill, stroke, sw, className = 'saved-polygon';

        if (isBeingEdited && editingGeometry.mode === 'vertex') {
          // Hide — VertexEditOverlay draws this polygon
          fill = 'transparent';
          stroke = 'transparent';
          sw = '0';
        } else if (isBeingEdited && editingGeometry.mode === 'redraw') {
          // Dim the old polygon while redrawing
          fill = 'rgba(231, 113, 51, 0.08)';
          stroke = 'rgba(231, 113, 51, 0.3)';
          sw = '0.3';
        } else if (isRouteStart) {
          // Source — warm amber with pulsing border
          fill = 'rgba(255, 159, 67, 0.45)';
          stroke = '#ff9f43';
          sw = '2.5';
        } else if (isRouteTarget) {
          // Destination — vivid emerald
          fill = 'rgba(52, 211, 153, 0.55)';
          stroke = '#34d399';
          sw = '3';
        } else if (isRouteMid) {
          // Corridor gradient ribbon: orange-tinted blue → pure electric blue
          const r = Math.round(120 - routeT * 41);    // 120 → 79
          const g = Math.round(140 + routeT * 32);    // 140 → 172
          const b = 255;
          const fillOp = (0.30 + routeT * 0.20).toFixed(2);
          const strokeOp = (0.50 + routeT * 0.50).toFixed(2);
          fill = `rgba(${r}, ${g}, ${b}, ${fillOp})`;
          stroke = `rgba(${r}, ${g}, ${b}, ${strokeOp})`;
          sw = '2';
          className += ' saved-polygon--route-mid';
        } else if (hasRoute) {
          // Dark-focus: dim all non-route polygons
          fill = 'rgba(0, 0, 0, 0.03)';
          stroke = 'transparent';
          sw = '0.25';
        } else if (highlightSet && highlightSet.has(poly.ifc_guid)) {
          // Highlighted room — orange glow (direct capacity match)
          fill = 'rgba(231, 113, 51, 0.40)';
          stroke = '#E77133';
          sw = '0.5';
        } else if (repurposeSet && repurposeSet.has(poly.ifc_guid)) {
          // Repurpose candidate — blue glow
          fill = 'rgba(59, 130, 246, 0.35)';
          stroke = '#3B82F6';
          sw = '0.5';
        } else if (highlightSet || repurposeSet) {
          // Non-highlighted room when highlights active — dim
          fill = 'rgba(0, 0, 0, 0.05)';
          stroke = 'rgba(0, 0, 0, 0.08)';
          sw = '0.15';
        } else if (isSelected) {
          fill = 'rgba(255, 140, 50, 0.35)';
          stroke = '#FFB366';
          sw = '0.4';
        } else if (isHovered) {
          fill = 'rgba(255, 140, 50, 0.25)';
          stroke = '#FFB366';
          sw = '0.25';
        } else {
          fill = 'transparent';
          stroke = 'transparent';
          sw = '0.25';
        }

        return (
          <polygon
            key={poly.ifc_guid}
            points={pts}
            className={className}
            fill={fill}
            stroke={stroke}
            strokeWidth={sw}
            vectorEffect="non-scaling-stroke"
            style={{ cursor: isDrawing ? 'crosshair' : 'pointer', pointerEvents: isDrawing ? 'none' : 'all' }}
            onClick={(e) => handleClick(e, poly)}
            onMouseEnter={(e) => handleMouseEnter(e, poly)}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
          />
        );
      })}
    </svg>
  );
}
