/**
 * Shared helper: compute polygon-derived overrides for Space Metadata.
 *
 * Extracted so that every selection path (viewer click, RoomDirectory click,
 * AI action) produces identical metadata — "frontend data wins".
 */

import useStore from '../store/useStore';
import { computePolygonMetrics } from './unprojectPolygon';

/**
 * Build overrides from local polygon data (area, perimeter, occupancy fields).
 *
 * @param {Object} polygon - polygon object from store.floorPolygons
 * @param {string} floorId - active floor ID
 * @returns {Object} override fields to merge into API space data
 */
export function getPolygonOverrides(polygon, floorId) {
  const overrides = {};
  if (polygon.area_m2 != null) {
    overrides.area_m2 = polygon.area_m2;
  }
  if (polygon.normal_occupancy != null) overrides.normal_occupancy = polygon.normal_occupancy;
  if (polygon.max_occupancy != null) overrides.max_occupancy = polygon.max_occupancy;
  if (polygon.absolute_occupancy != null) overrides.absolute_occupancy = polygon.absolute_occupancy;
  if (polygon.occupiable != null) overrides.occupiable = polygon.occupiable;
  if (polygon.used_area_m2 != null) overrides.used_area_m2 = polygon.used_area_m2;
  if (polygon.free_area_m2 != null) overrides.free_area_m2 = polygon.free_area_m2;

  const snapshot = useStore.getState().floorSnapshots[floorId];
  if (snapshot?.viewMatrix && snapshot?.projMatrix && polygon.vertices?.length >= 3) {
    const geom = useStore.getState().floorSpaceGeometry?.[floorId] || [];
    const avgY = geom.length > 0 ? geom.reduce((sum, s) => sum + (s.y || 0), 0) / geom.length : 0;
    const metrics = computePolygonMetrics(polygon.vertices, snapshot.viewMatrix, snapshot.projMatrix, avgY);
    if (metrics) {
      overrides.perimeter_cm = Math.round(metrics.perimeter_m * 100);
      if (overrides.area_m2 == null) {
        overrides.area_m2 = Math.round(metrics.area_m2 * 100) / 100;
      }
    }
  }
  if (overrides.perimeter_cm == null && polygon.perimeter_m != null) {
    overrides.perimeter_cm = Math.round(polygon.perimeter_m * 100);
  }
  return overrides;
}

/**
 * Synchronous select-space: reads from floorIntelligence cache,
 * applies polygon geometry overrides, writes to store.
 *
 * No network calls. Instant.
 *
 * @param {Object} polygon - polygon from store.floorPolygons
 * @param {string} floorId - floor ID
 * @returns {Object|null} the merged spaceData written to store
 */
export function selectSpaceFromPolygon(polygon, floorId) {
  const store = useStore.getState();
  let overrides = {};
  try {
    overrides = getPolygonOverrides(polygon, floorId);
  } catch { /* non-critical */ }

  // Read from pre-loaded intelligence cache (synchronous)
  const intel = store.getIntelligence(polygon.ifc_guid);

  if (intel) {
    const merged = { ...intel, ...overrides };
    store.selectSpace(polygon.ifc_guid, merged);
    return merged;
  }

  // Fallback: build minimal data from polygon fields
  const fallback = {
    ifc_guid: polygon.ifc_guid,
    space_name: polygon.space_name,
    primary_function: polygon.primary_function,
    floor_id: floorId,
    ...overrides,
  };
  store.selectSpace(polygon.ifc_guid, fallback);
  return fallback;
}
