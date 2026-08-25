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
  const setHoveredPolygonGuid = useStore((s) => s.setHoveredPolygonGuid);
  const selectSpace = useStore((s) => s.selectSpace);

  const handleClick = useCallback(async (e, polygon) => {
    e.stopPropagation();
    const overrides = getPolygonOverrides(polygon, floorId);
    try {
      const spaceData = await fetchSpaceByGuid(polygon.ifc_guid);
      selectSpace(polygon.ifc_guid, { ...spaceData, ...overrides });
    } catch (err) {
      selectSpace(polygon.ifc_guid, {
        ifc_guid: polygon.ifc_guid,
        ifc_name: polygon.space_name,
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

        return (
          <polygon
            key={poly.ifc_guid}
            points={pts}
            className={`saved-polygon ${isSelected ? 'saved-polygon--selected' : ''} ${isHovered ? 'saved-polygon--hovered' : ''}`}
            fill={isSelected ? 'rgba(231, 113, 51, 0.35)' : isHovered ? 'rgba(231, 113, 51, 0.25)' : 'rgba(231, 113, 51, 0.1)'}
            stroke={isSelected ? '#E77133' : isHovered ? '#E77133' : 'rgba(231, 113, 51, 0.5)'}
            strokeWidth={isSelected ? '0.4' : '0.25'}
            vectorEffect="non-scaling-stroke"
            style={{ cursor: 'pointer', pointerEvents: 'visiblePainted' }}
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
