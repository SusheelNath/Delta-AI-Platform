import React, { useCallback } from 'react';
import useStore from '../../store/useStore';
import { fetchSpaceByGuid } from '../../api/client';
import { computePolygonMetrics } from '../../utils/unprojectPolygon';

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
  const setHoveredPolygonGuid = useStore((s) => s.setHoveredPolygonGuid);
  const selectSpace = useStore((s) => s.selectSpace);
  const mappingMode = useStore((s) => s.mappingMode);
  const isDrawing = useStore((s) => s.mappingMode && s.pendingPolygonVertices.length > 0);

  const handleClick = useCallback(async (e, polygon) => {
    e.stopPropagation();
    let overrides = {};
    try {
      overrides = getPolygonOverrides(polygon, floorId);
    } catch (err) {
      console.warn('[Delta] getPolygonOverrides failed:', err);
    }
    try {
      const spaceData = await fetchSpaceByGuid(polygon.ifc_guid);
      selectSpace(polygon.ifc_guid, { ...spaceData, ...overrides });
    } catch (err) {
      // No DB record (e.g. cloned H040 polygons) — use polygon metadata directly
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
    onTooltipChange?.({ name, area, x: e.clientX - rect.left + 14, y: e.clientY - rect.top - 10 });
  }, [setHoveredPolygonGuid, onTooltipChange]);

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

  return (
    <svg
      className="saved-polygons-overlay"
      style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
    >
      {polygons.map((poly) => {
        const pts = poly.vertices.map((v) => `${v[0]},${v[1]}`).join(' ');
        const isSelected = selectedSpaceId === poly.ifc_guid;
        const isHovered = hoveredPolygonGuid === poly.ifc_guid;
        const isEdited = poly.edited === true;
        const isAssigned = poly.space_name && poly.space_name !== 'Unassigned';

        // Check if this polygon is part of the active route
        const isRouteTarget = activeRoute?.targetGuid === poly.ifc_guid;
        const isRoutePath = activeRoute?.path?.some((p) => p.ifc_guid === poly.ifc_guid);

        // Blue for routing, orange for hover/select, transparent otherwise
        const fill = isRouteTarget ? 'rgba(56, 139, 253, 0.35)'
          : isRoutePath ? 'rgba(56, 139, 253, 0.15)'
          : isSelected ? 'rgba(255, 140, 50, 0.35)'
          : isHovered ? 'rgba(255, 140, 50, 0.25)'
          : 'transparent';
        const stroke = isRouteTarget ? '#79b8ff'
          : isRoutePath ? 'rgba(56, 139, 253, 0.4)'
          : isSelected || isHovered ? '#FFB366'
          : 'transparent';

        return (
          <polygon
            key={poly.ifc_guid}
            points={pts}
            className={`saved-polygon ${isSelected ? 'saved-polygon--selected' : ''} ${isHovered ? 'saved-polygon--hovered' : ''}`}
            fill={fill}
            stroke={stroke}
            strokeWidth={isSelected ? '0.4' : '0.25'}
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
