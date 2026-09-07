/**
 * Action resolver for Delta AI tool calls.
 *
 * Receives parsed action events from the SSE stream and dispatches
 * them to the Zustand store, resolving space names to polygons and
 * computing routes as needed.
 */

import useStore from '../store/useStore';
import { fetchSpaceByGuid } from '../api/client';
import { computeRouting } from './routing';

/**
 * Resolve a space_name to a polygon on the current active floor (or any floor).
 * Returns the first polygon whose space_name contains the search term.
 */
function findPolygonByName(spaceName) {
  const state = useStore.getState();
  const search = spaceName.toLowerCase();

  // Gather all loaded polygons across all floors
  const allPolygons = [];
  const floorPolygons = state.floorPolygons || {};
  for (const fid of Object.keys(floorPolygons)) {
    const polys = floorPolygons[fid] || [];
    for (const p of polys) {
      allPolygons.push({ ...p, _floorId: fid });
    }
  }

  // Exact match first
  let match = allPolygons.find(
    (p) => (p.space_name || '').toLowerCase() === search
  );
  if (match) return match;

  // Contains match
  match = allPolygons.find(
    (p) => (p.space_name || '').toLowerCase().includes(search)
  );
  if (match) return match;

  // Function match
  match = allPolygons.find(
    (p) => (p.primary_function || '').toLowerCase().includes(search)
  );
  return match || null;
}

/**
 * Get all polygons for a given floor from store.
 */
function getFloorPolygons(floorId) {
  const state = useStore.getState();
  return (state.floorPolygons || {})[floorId] || [];
}

/**
 * Resolve and dispatch a single action from the LLM tool call.
 *
 * @param {Object} action - parsed action object from [ACTION] SSE event
 */
export async function resolveAction(action) {
  const store = useStore.getState();
  const type = action.type;

  switch (type) {
    case 'select_space': {
      const poly = findPolygonByName(action.space_name);
      if (!poly) break;
      try {
        const spaceData = await fetchSpaceByGuid(poly.ifc_guid);
        store.selectSpace(poly.ifc_guid, spaceData);
      } catch (err) {
        console.warn('[Action] Failed to select space:', err);
      }
      break;
    }

    case 'route_to_elevator':
    case 'route_to_staircase': {
      const poly = findPolygonByName(action.space_name);
      if (!poly) break;
      const floorId = poly._floorId || poly.floor_id;
      const floorPolys = getFloorPolygons(floorId);
      if (!floorPolys.length) break;

      // Select the space first
      try {
        const spaceData = await fetchSpaceByGuid(poly.ifc_guid);
        store.selectSpace(poly.ifc_guid, spaceData);
      } catch (_) {}

      // Compute routing
      const routing = computeRouting(floorPolys, poly.ifc_guid);
      if (!routing) break;

      const routeType = type === 'route_to_elevator' ? 'elevator' : 'staircase';
      const data = routeType === 'elevator' ? routing.toElevator : routing.toStaircase;
      if (!data) break;

      // Defer route activation so React effects from selectSpace (which clears
      // activeRoute and resets routingOpen) settle before we set the new route.
      setTimeout(() => {
        const s = useStore.getState();
        s.setActiveRoute({
          type: routeType,
          path: data.path,
          targetGuid: data.target.ifc_guid,
          centroids: data.centroids,
          pathLine: data.pathLine,
          distanceM: data.distanceM,
          waypoints: data.waypoints,
        });
        s.setDrawerOpen(true);
        s.setRoutingPanelOpen(true);
      }, 80);
      break;
    }

    case 'clear_route':
      store.clearActiveRoute();
      break;

    case 'set_floor':
      store.setActiveFloor(action.floor_id);
      break;

    case 'show_all_floors':
      store.showAllFloors();
      break;

    case 'set_heatmap':
      store.setHeatmapMode(action.mode);
      break;

    case 'toggle_function_filter': {
      const idx = action.category_index;
      if (idx >= 0) store.toggleFunctionFilter(idx);
      break;
    }

    case 'clear_selection':
      store.clearSelection();
      break;

    case 'expand_directory_group':
      store.expandDirectoryGroup(action.function_name);
      break;

    case 'select_room_in_group': {
      // Convert 1-based index from LLM to 0-based
      const roomIdx = (action.room_index || 1) - 1;
      store.selectRoomInGroup(action.function_name, roomIdx);
      break;
    }

    default:
      console.warn('[Action] Unknown action type:', type);
  }
}
