/**
 * Action resolver for Delta AI tool calls.
 *
 * Receives parsed action events from the SSE stream and dispatches
 * them to the Zustand store, resolving space names to polygons and
 * computing routes as needed.
 */

import useStore from '../store/useStore';
import { computeRouting } from './routing';
import { selectSpaceFromPolygon } from './polygonOverrides';
import { bulkModifyFurnishings, fetchSpaceFurnishings, invalidateCache } from '../api/client';
import { buildFacilitiesText } from './actionTemplates';

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
      let poly = null;
      if (!guid && action.space_name) {
        poly = findPolygonByName(action.space_name);
        if (poly) guid = poly.ifc_guid;
      }
      if (!guid) break;

      // Find the polygon in store so we can apply overrides
      if (!poly) {
        const allFloorPolygons = store.floorPolygons || {};
        for (const fid of Object.keys(allFloorPolygons)) {
          const found = (allFloorPolygons[fid] || []).find((p) => p.ifc_guid === guid);
          if (found) { poly = { ...found, _floorId: fid }; break; }
        }
      }

      if (poly) {
        const floorId = poly._floorId || poly.floor_id || store.activeFloorId;
        selectSpaceFromPolygon(poly, floorId);
      } else {
        // No local polygon — use intelligence cache directly
        const intel = store.getIntelligence(guid);
        if (intel) {
          store.selectSpace(guid, intel);
        }
      }
      break;
    }

    case 'route_to_elevator':
    case 'route_to_staircase': {
      // Prefer direct GUID lookup over ambiguous name search
      let poly = null;
      if (action.space_id) {
        const allFloorPolygons = store.floorPolygons || {};
        for (const fid of Object.keys(allFloorPolygons)) {
          const found = (allFloorPolygons[fid] || []).find((p) => p.ifc_guid === action.space_id);
          if (found) { poly = { ...found, _floorId: fid }; break; }
        }
      }
      if (!poly && action.space_name) {
        poly = findPolygonByName(action.space_name);
      }
      if (!poly) break;
      const floorId = poly._floorId || poly.floor_id;
      const floorPolys = getFloorPolygons(floorId);
      if (!floorPolys.length) break;

      // Only select the space if it isn't already selected
      const alreadySelected = store.selectedSpaceId === poly.ifc_guid;
      if (!alreadySelected) {
        selectSpaceFromPolygon(poly, floorId);
      }

      // Compute routing
      const routing = computeRouting(floorPolys, poly.ifc_guid);
      if (!routing) break;

      const routeType = type === 'route_to_elevator' ? 'elevator' : 'staircase';
      const data = routeType === 'elevator' ? routing.toElevator : routing.toStaircase;
      if (!data) break;

      // Selection is now synchronous, so activate route immediately
      {
        store.setActiveRoute({
          type: routeType,
          path: data.path,
          targetGuid: data.target.ifc_guid,
          centroids: data.centroids,
          pathLine: data.pathLine,
          distanceM: data.distanceM,
          waypoints: data.waypoints,
        });
        store.setDrawerOpen(true);
        store.setRoutingPanelOpen(true);
      }
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

      // Expand the directory group UI only (don't trigger RoomDirectory's
      // handleCardClick — we handle selection here as the single authority)
      store.expandDirectoryGroup(action.function_name);

      // Resolve the polygon directly from the frontend store
      let floorId = store.activeFloorId;
      if (!floorId) {
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
          selectSpaceFromPolygon(grouped[idx], floorId);
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
      // Singularize: "elevators" → "elevator", "staircases" → "staircase"
      const rawFilter = (action.filter || '').toLowerCase();
      const filter = rawFilter.replace(/s$/, '');
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

    case 'search_largest_rooms': {
      const floorId = store.activeFloorId;
      if (!floorId) break;
      const _infra = new Set([
        'no access', 'ventilation shaft', 'elevator', 'corridor',
        'toilet', 'staircase', 'shaft', 'void', 'riser',
        'circulation', 'lobby', 'entrance', 'vestibule',
      ]);
      const polys = (store.floorPolygons[floorId] || [])
        .filter((p) => p.area_m2 != null && p.area_m2 > 0
          && !_infra.has((p.primary_function || '').toLowerCase()))
        .sort((a, b) => b.area_m2 - a.area_m2)
        .slice(0, 3);
      store.setHighlightedGuids(polys.map((p) => p.ifc_guid));
      break;
    }

    case 'find_room': {
      const capacity = action.capacity || 0;
      const fnFilter = (action.function || '').toLowerCase();
      const _infraFind = new Set([
        'no access', 'ventilation shaft', 'elevator', 'corridor',
        'toilet', 'staircase', 'shaft', 'void', 'riser',
        'circulation', 'lobby', 'entrance', 'vestibule',
      ]);

      // ── Function suitability scores (weight 40%) ──
      const FN_SCORES = {
        conference: 10, meeting: 10, lecture: 10, seminar: 10, training: 10,
        assembly: 10, auditorium: 10, 'multi-purpose': 9, 'multipurpose': 9,
        waiting: 8, reception: 8, lobby: 7, cafeteria: 8, canteen: 8,
        restaurant: 7, lounge: 7, atrium: 7,
        office: 6, administrative: 6, classroom: 7, consultation: 6,
        examination: 5, treatment: 5, 'patient care': 5, ward: 5,
        nursing: 5, recovery: 5, rehabilitation: 5,
        laboratory: 4, pharmacy: 4, radiology: 4, imaging: 4,
        storage: 2, technical: 2, service: 2, utility: 2, mechanical: 2,
        ambulance: 1, parking: 1, loading: 1,
      };

      // ── Zone suitability scores (weight 30%) ──
      const ZONE_SCORES = {
        Public: 10, Outpatient: 9, 'Outpatient Treatment': 9,
        Administrative: 8, Amenity: 8, Departmental: 7,
        'Inpatient Care': 6, 'Clinical Support': 6, Surgical: 5,
        'Critical Care': 5, Emergency: 5, Maternity: 5,
        Rehabilitation: 6, Diagnostics: 5, 'Staff Welfare': 6,
        Operations: 4, Service: 3, 'Facility Services': 3,
        Technical: 2, Circulation: 2,
      };

      // ── Floor accessibility scores (weight 10%) ──
      const FLOOR_SCORES = {
        H000: 10, H010: 8, H020: 8, H030: 7, H040: 6, H050: 6,
        H001: 5, H002: 4, H003: 3,
      };

      const threshold = Math.floor(capacity * 0.7);
      const fp = store.floorPolygons || {};
      const allFloors = Object.keys(fp);
      const candidates = [];

      for (const fid of allFloors) {
        for (const p of fp[fid] || []) {
          const fn = (p.primary_function || '').toLowerCase();
          if (_infraFind.has(fn)) continue;
          if (fnFilter && !fn.includes(fnFilter)) continue;
          const cap = p.max_occupancy || p.absolute_occupancy || (p.area_m2 ? Math.floor(p.area_m2 / 3) : 0);
          if (cap < threshold) continue;

          const isDirect = cap >= capacity;

          // Score: function (40%) + zone (30%) + capacity fit (20%) + floor (10%)
          let fnScore = 3; // default
          for (const [kw, sc] of Object.entries(FN_SCORES)) {
            if (fn.includes(kw)) { fnScore = sc; break; }
          }
          const zone = p.functional_zone || '';
          const zoneScore = ZONE_SCORES[zone] || 3;
          const floorScore = FLOOR_SCORES[fid] || 5;
          const ratio = capacity > 0 ? cap / capacity : 1;
          const fitScore = ratio >= 1
            ? Math.max(1, 10 - (ratio - 1) * 4) // closer to 1.0 = better
            : ratio * 10; // below threshold scales linearly
          const totalScore = fnScore * 0.4 + zoneScore * 0.3 + fitScore * 0.2 + floorScore * 0.1;

          // Build reasoning
          const reasons = [];
          if (fnScore >= 8) reasons.push(`high-suitability function (${p.primary_function})`);
          else if (fnScore >= 5) reasons.push(`moderate-suitability function (${p.primary_function})`);
          else reasons.push(`low-suitability function (${p.primary_function})`);
          if (zoneScore >= 8) reasons.push(`accessible zone (${zone})`);
          else if (zoneScore >= 5) reasons.push(`${zone} zone`);
          if (floorScore >= 8) reasons.push('well-accessible floor');
          if (!isDirect) reasons.push(`capacity ${cap} — could be repurposed to fit ${capacity}`);

          candidates.push({
            guid: p.ifc_guid,
            type: isDirect ? 'direct' : 'repurpose',
            score: totalScore,
            capacity: cap,
            area: p.area_m2 || 0,
            name: p.space_name || p.ifc_guid,
            fn: p.primary_function || '',
            zone,
            floorId: fid,
            reason: reasons.join('; '),
          });
        }
      }

      // Sort by score descending, take top 10
      candidates.sort((a, b) => b.score - a.score);
      const top10 = candidates.slice(0, 10);

      const directGuids = top10.filter((c) => c.type === 'direct').map((c) => c.guid);
      const repurposeGuids = top10.filter((c) => c.type === 'repurpose').map((c) => c.guid);

      // Build results map for tooltips/legend
      const resultsMap = {};
      for (const c of top10) {
        resultsMap[c.guid] = c;
      }

      store.setHighlightedGuids(directGuids);
      store.setRepurposeGuids(repurposeGuids);
      store.setFindRoomResults(resultsMap);
      break;
    }

    case 'modify_furnishing': {
      // Requires a selected space
      const guid = store.selectedSpaceId;
      const floor = store.activeFloorId;
      if (!guid || !floor) break;

      const changeAction = action.action; // "add" | "remove" | "remove_all"
      const changes = [];

      if (changeAction === 'remove_all') {
        changes.push({ action: 'remove_all' });
      } else if (changeAction === 'add' && action.item_type) {
        changes.push({ action: 'add', item_type: action.item_type, quantity: action.quantity || 1 });
      } else if (changeAction === 'remove' && action.item_type) {
        changes.push({ action: 'remove', item_type: action.item_type });
      }

      if (changes.length === 0) break;

      try {
        const result = await bulkModifyFurnishings(guid, floor, changes);
        // Store the result so the template builder can read it
        store._lastFurnishingResult = result;
        // Update selected space metrics + facilities text
        if (result.metrics) {
          const facilitiesText = buildFacilitiesText(result.furnishings);
          store.updateSelectedSpaceMetrics(result.metrics, facilitiesText);
        }
        // Update preloaded furnishing cache
        if (result.furnishings) {
          store.mergeSpaceFurnishings({ [guid]: result.furnishings });
        }
      } catch (err) {
        console.warn('[Action] Furnishing modification failed:', err);
        store._lastFurnishingResult = { error: err.message };
      }
      break;
    }

    case 'suggest_furnishings': {
      // Open the furnishing editor via drawer + furnishings dropdown
      store.setDrawerOpen(true);
      // Dispatch a custom event that SpaceToolkit can listen for
      window.dispatchEvent(new CustomEvent('delta-open-furnishing-editor'));
      break;
    }

    default:
      console.warn('[Action] Unknown action type:', type);
  }
}
