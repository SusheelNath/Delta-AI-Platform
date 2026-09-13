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
      // Support both space_id (direct guid) and space_name (name lookup)
      let guid = action.space_id;
      if (!guid && action.space_name) {
        const poly = findPolygonByName(action.space_name);
        if (poly) guid = poly.ifc_guid;
      }
      if (!guid) break;
      try {
        const spaceData = await fetchSpaceByGuid(guid);
        store.selectSpace(guid, spaceData);
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
      store.setCurrentExpandedGroup(action.function_name);
      break;

    case 'select_room_in_group': {
      // Convert 1-based index from LLM to 0-based
      const roomIdx = (action.room_index || 1) - 1;
      // Expand the directory group in the list UI
      store.selectRoomInGroup(action.function_name, roomIdx);

      // Also directly select the space for 3D viewer (don't rely on
      // RoomDirectory being mounted — resolve the polygon here)
      let floorId = store.activeFloorId;
      if (!floorId) {
        // Infer from visibility (same logic as ChatPanel)
        const vis = (store.floors || []).filter((f) => (store.floorVisibility || {})[f.id]);
        if (vis.length === 1) floorId = vis[0].id;
      }
      if (floorId) {
        const floorPolys = (store.floorPolygons[floorId] || []);
        const fnSearch = (action.function_name || '').toLowerCase();
        const grouped = floorPolys
          .filter((p) => (p.primary_function || '').toLowerCase().includes(fnSearch))
          .sort((a, b) => (a.space_name || '').localeCompare(b.space_name || '')
            || (a.ifc_guid || '').localeCompare(b.ifc_guid || ''));
        const idx = Math.min(roomIdx, grouped.length - 1);
        if (idx >= 0 && grouped[idx]) {
          const poly = grouped[idx];
          try {
            const spaceData = await fetchSpaceByGuid(poly.ifc_guid);
            store.selectSpace(poly.ifc_guid, spaceData);
          } catch {
            store.selectSpace(poly.ifc_guid, {
              ifc_guid: poly.ifc_guid,
              space_name: poly.space_name,
              primary_function: poly.primary_function,
              floor_id: floorId,
            });
          }
          // Open the Space Metadata drawer
          store.setDrawerOpen(true);
        }
      }
      break;
    }

    case 'toggle_mep':
      store.toggleMepVisible();
      break;

    case 'set_panel_mode':
      store.setPanelMode(action.mode);
      break;

    case 'reset_heatmap':
      store.setHeatmapMode('function');
      break;

    case 'reset_filters':
      store.setAllFunctionFilters(true);
      break;

    case 'compare_floors':
      if (!store.compareMode) store.toggleCompareMode();
      store.setCompareFloorId(action.floor_id_2);
      store.setActiveFloor(action.floor_id_1);
      break;

    case 'set_floor_relative': {
      // Resolve relative direction from current floor
      const floorOrder = ['H003', 'H002', 'H001', 'H000', 'H010', 'H020', 'H030', 'H040', 'H050'];
      let curFloor = store.activeFloorId;
      if (!curFloor) {
        const vis = (store.floors || []).filter((f) => (store.floorVisibility || {})[f.id]);
        if (vis.length === 1) curFloor = vis[0].id;
      }
      const curIdx = floorOrder.indexOf(curFloor);
      if (curIdx >= 0) {
        const newIdx = action.direction === 'up' ? curIdx + 1 : curIdx - 1;
        if (newIdx >= 0 && newIdx < floorOrder.length) {
          store.setActiveFloor(floorOrder[newIdx]);
        }
      }
      break;
    }

    case 'no_selection_hint':
      // No-op — the confirmation text already carries the message
      break;

    case 'clear_all':
      store.clearAll();
      break;

    case 'clear_highlights':
      store.clearHighlights();
      break;

    case 'clear_search':
      store.setSearchQuery('');
      break;

    case 'toggle_drawer':
      store.setDrawerOpen(action.action === 'open');
      break;

    case 'open_toolkit_section':
      // Open drawer and set routing panel if section is routing
      store.setDrawerOpen(true);
      if (action.section === 'routing') store.setRoutingPanelOpen(true);
      break;

    case 'toggle_profile':
      // Profile mode is handled by the SpaceToolkit component (compact/full)
      // Currently no dedicated store state — no-op with text narration
      break;

    case 'close_card':
      store.clearSelection();
      break;

    case 'new_session':
      store.newChat();
      break;

    case 'load_session': {
      // Load the most recent session
      const sessions = store.sessionList || [];
      if (sessions.length > 0) {
        const latest = sessions[0]; // sorted by most recent
        store.loadSession(latest.id);
      }
      break;
    }

    case 'clear_learnings':
      store.clearAllLearnings();
      break;

    case 'enter_compare_mode':
      if (!store.compareMode) store.toggleCompareMode();
      break;

    case 'exit_compare_mode':
      if (store.compareMode) store.toggleCompareMode();
      break;

    case 'voice_on':
      store.setVoiceActive(true);
      break;

    case 'voice_off':
      store.setVoiceActive(false);
      break;

    case 'set_floor_visibility': {
      const vis = store.floorVisibility || {};
      const isVisible = !!vis[action.floor_id];
      if (action.visible !== isVisible) {
        store.toggleFloorVisibility(action.floor_id);
      }
      break;
    }

    case 'zoom_view':
      // Dispatch custom event for the 3D viewer to handle
      window.dispatchEvent(new CustomEvent('delta-zoom', { detail: { action: action.action } }));
      break;

    case 'fly_to_zone':
      // Dispatch custom event for the 3D viewer to fly to a zone
      window.dispatchEvent(new CustomEvent('delta-fly-to-zone', { detail: { zone: action.zone_name } }));
      break;

    case 'highlight_spaces': {
      // Find all polygons matching the filter text and highlight them
      const filter = (action.filter || '').toLowerCase();
      const allPolys = [];
      const fp = store.floorPolygons || {};
      for (const fid of Object.keys(fp)) {
        for (const p of fp[fid] || []) allPolys.push(p);
      }
      const guids = allPolys
        .filter((p) => {
          const blob = [p.space_name, p.primary_function, p.functional_zone, p.secondary_functions]
            .filter(Boolean).join(' ').toLowerCase();
          return blob.includes(filter);
        })
        .map((p) => p.ifc_guid);
      store.setHighlightedGuids(guids);
      break;
    }

    case 'highlight_adjacent': {
      // Find the target space, then highlight its adjacent spaces
      const target = findPolygonByName(action.space_name);
      if (!target) break;
      const floorId = target._floorId || target.floor_id;
      const floorPolys = getFloorPolygons(floorId);
      // Use adjacency data if available (adjacent_guids field), else spatial proximity
      const adjGuids = target.adjacent_guids || [];
      if (adjGuids.length > 0) {
        store.setHighlightedGuids(adjGuids);
      } else {
        // Fallback: highlight all rooms on same floor (the LLM narration carries detail)
        const guids = floorPolys.map((p) => p.ifc_guid).filter((g) => g !== target.ifc_guid);
        store.setHighlightedGuids(guids.slice(0, 20));
      }
      break;
    }

    case 'count_highlight': {
      // Count matching rooms and highlight them (+ toggle filter pill if category given)
      const query = (action.query || '').toLowerCase();
      const allP = [];
      const fpol = store.floorPolygons || {};
      for (const fid of Object.keys(fpol)) {
        // If floor_id specified, only search that floor
        if (action.floor_id && fid !== action.floor_id) continue;
        for (const p of fpol[fid] || []) allP.push(p);
      }
      const matchGuids = allP
        .filter((p) => {
          const blob = [p.space_name, p.primary_function, p.functional_zone]
            .filter(Boolean).join(' ').toLowerCase();
          return blob.includes(query);
        })
        .map((p) => p.ifc_guid);
      store.setHighlightedGuids(matchGuids);
      // Also toggle category filter pill if category_index given
      if (action.category_index != null && action.category_index >= 0) {
        // First show all, then show only the matching category
        store.setAllFunctionFilters(false);
        store.toggleFunctionFilter(action.category_index);
      }
      break;
    }

    case 'set_search':
      store.setSearchQuery(action.query || '');
      break;

    default:
      console.warn('[Action] Unknown action type:', type);
  }
}
