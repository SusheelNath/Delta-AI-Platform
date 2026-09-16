/**
 * Frontend template responses for instant actions.
 *
 * Generates rich narrative text from data already loaded in the store,
 * so the chat can show meaningful overviews without an LLM call.
 */

import useStore from '../store/useStore';
import { getCategoryIndex, FUNCTION_CATEGORIES } from './colorScheme';

const FLOOR_NAMES = {
  H003: 'Basement 3', H002: 'Basement 2', H001: 'Basement 1',
  H000: 'Ground Floor',
  H010: 'Floor +1', H020: 'Floor +2', H030: 'Floor +3',
  H040: 'Floor +4', H050: 'Floor +5',
};

const FLOOR_ORDER = ['H003', 'H002', 'H001', 'H000', 'H010', 'H020', 'H030', 'H040', 'H050'];

// Infrastructure functions to exclude from "top functions" display
const INFRA_FUNCTIONS = new Set([
  'no access', 'ventilation shaft', 'elevator', 'corridor',
  'toilet', 'staircase', 'shaft', 'void', 'riser',
  'circulation', 'lobby', 'entrance', 'vestibule',
]);

function isInfraFunction(fn) {
  return INFRA_FUNCTIONS.has(fn.toLowerCase());
}

/**
 * Classify a function into a high-level category label.
 */
function getCategoryLabel(fn) {
  const idx = getCategoryIndex(fn);
  return idx >= 0 ? FUNCTION_CATEGORIES[idx].label : 'Other';
}

/**
 * Generate a rich template response for an instant action.
 * Returns a string if a template exists, or null to fall back to confirmations.
 */
export function getActionTemplate(actions) {
  if (!actions || actions.length === 0) return null;

  const primary = actions[0];

  switch (primary.type) {
    case 'show_all_floors':
      return buildAllFloorsOverview();
    case 'set_floor':
      return buildFloorNavResponse(primary.floor_id);
    case 'search_largest_rooms':
      return buildLargestRoomsResponse();
    case 'highlight_spaces':
      return buildHighlightResponse(primary.filter);
    case 'find_room':
      return buildFindRoomResponse();
    default:
      return null;
  }
}

/**
 * Wrap raw confirmation text with a conversational tone.
 * Used for actions that don't have a rich data template.
 *
 * @param {string} confirmText - raw confirmation (e.g. "Clearing route.")
 * @param {Array} actions - action objects for context
 * @returns {string} conversational version
 */
export function wrapConfirmation(confirmText, actions) {
  if (!actions || actions.length === 0) return confirmText;
  const type = actions[0].type;

  const wrappers = {
    clear_selection: "Done — selection cleared. The view is ready for your next pick.",
    clear_route: "Route cleared. Select a room to find a new path.",
    clear_all: "Everything reset — clean slate. What would you like to explore?",
    clear_highlights: "Highlights cleared.",
    clear_search: "Search cleared.",
    reset_heatmap: "Back to the default function view.",
    reset_filters: "All room types are now visible.",
    toggle_mep: "Infrastructure layer toggled.",
    set_floor_relative: confirmText,
    enter_compare_mode: "Compare mode is active — select two floors to see them side by side.",
    exit_compare_mode: "Back to single-floor view.",
    zoom_view: "View adjusted.",
    new_session: "Fresh session started. How can I help?",
    clear_learnings: "All learned preferences have been cleared.",
  };

  return wrappers[type] || confirmText;
}

function buildFloorNavResponse(floorId) {
  if (!floorId) return null;
  const state = useStore.getState();
  const polys = (state.floorPolygons || {})[floorId] || [];
  if (polys.length === 0) return null;

  const fname = FLOOR_NAMES[floorId] || floorId;
  const count = polys.length;

  let area = 0;
  const fnCounts = {};
  for (const p of polys) {
    if (p.area_m2 != null) area += p.area_m2;
    const fn = p.primary_function || 'Unassigned';
    if (!isInfraFunction(fn)) {
      fnCounts[fn] = (fnCounts[fn] || 0) + 1;
    }
  }

  const topFns = Object.entries(fnCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([fn, c]) => `${fn} (${c})`);

  const areaStr = area > 0 ? ` across ${Math.round(area).toLocaleString()} m²` : '';
  const fnStr = topFns.length > 0 ? `\n\n${topFns.join(' · ')}` : '';

  return `Navigating to **${fname}** — ${count} spaces${areaStr}.${fnStr}`;
}

function buildAllFloorsOverview() {
  const state = useStore.getState();
  const floorPolygons = state.floorPolygons || {};

  let totalSpaces = 0;
  let totalArea = 0;
  const categoryCounts = {};
  const floorData = [];

  for (const fid of FLOOR_ORDER) {
    const polys = floorPolygons[fid];
    if (!polys || polys.length === 0) continue;

    const count = polys.length;
    totalSpaces += count;

    let floorArea = 0;
    const fnCounts = {};
    const catCounts = {};
    for (const p of polys) {
      if (p.area_m2 != null) floorArea += p.area_m2;
      const fn = p.primary_function || 'Unassigned';
      fnCounts[fn] = (fnCounts[fn] || 0) + 1;
      const cat = getCategoryLabel(fn);
      catCounts[cat] = (catCounts[cat] || 0) + 1;
      categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
    }
    totalArea += floorArea;

    // Top 3 meaningful functions (filter out infrastructure)
    const meaningfulFns = Object.entries(fnCounts)
      .filter(([fn]) => !isInfraFunction(fn))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([fn, c]) => `${fn} (${c})`);

    // If no meaningful functions, show top category instead
    const topCats = Object.entries(catCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([cat]) => cat);

    floorData.push({ fid, count, floorArea, meaningfulFns, topCats });
  }

  const floorCount = floorData.length;
  const totalAreaStr = totalArea > 0 ? `${Math.round(totalArea).toLocaleString()} m²` : '';

  // Conversational intro + header
  const parts = [
    `Here's a full overview of the building.`,
    '',
    `**Chirec Delta Hospital** — ${floorCount} floors, ${totalSpaces.toLocaleString()} spaces, ${totalAreaStr}`,
    '',
  ];

  // Category breakdown
  const sortedCats = Object.entries(categoryCounts)
    .sort((a, b) => b[1] - a[1]);
  if (sortedCats.length > 0) {
    const catLine = sortedCats
      .map(([cat, c]) => `${cat} ${c}`)
      .join(' · ');
    parts.push(catLine, '');
  }

  // Per-floor breakdown
  for (const { fid, count, floorArea, meaningfulFns, topCats } of floorData) {
    const fname = FLOOR_NAMES[fid] || fid;
    const areaStr = floorArea > 0 ? `${Math.round(floorArea).toLocaleString()} m²` : '';
    const fnStr = meaningfulFns.length > 0
      ? meaningfulFns.join(', ')
      : topCats.join(', ');
    parts.push(`**${fname}** — ${count} spaces · ${areaStr}  `);
    parts.push(`${fnStr}`, '');
  }

  return parts.join('\n');
}

function buildLargestRoomsResponse() {
  const state = useStore.getState();
  const floorId = state.activeFloorId;
  if (!floorId) return null;

  const polys = (state.floorPolygons[floorId] || [])
    .filter((p) => p.area_m2 != null && p.area_m2 > 0 && !isInfraFunction(p.primary_function || ''))
    .sort((a, b) => b.area_m2 - a.area_m2)
    .slice(0, 3);

  if (polys.length === 0) return 'No non-infrastructure rooms with area data found on this floor.';

  const fname = FLOOR_NAMES[floorId] || floorId;
  const lines = [`Here are the **3 largest rooms** on **${fname}** — highlighted in orange:`, ''];

  polys.forEach((p, i) => {
    const name = p.space_name || p.ifc_guid;
    const fn = p.primary_function || '';
    const area = p.area_m2.toFixed(1);
    const zone = p.functional_zone ? ` · ${p.functional_zone}` : '';
    lines.push(`${i + 1}. **${name}** — ${area} m² · ${fn}${zone}`);
  });

  return lines.join('\n');
}

function buildHighlightResponse(filter) {
  const state = useStore.getState();
  const floorId = state.activeFloorId;
  const fp = state.floorPolygons || {};
  const search = (filter || '').toLowerCase().replace(/s$/, '');

  const matches = [];
  const searchFloors = floorId ? [floorId] : Object.keys(fp);
  for (const fid of searchFloors) {
    for (const p of fp[fid] || []) {
      const blob = [p.space_name, p.primary_function, p.functional_zone, p.secondary_functions]
        .filter(Boolean).join(' ').toLowerCase();
      if (blob.includes(search)) {
        matches.push({ ...p, _floorId: fid });
      }
    }
  }

  if (matches.length === 0) {
    const scope = floorId ? ` on ${FLOOR_NAMES[floorId] || floorId}` : '';
    return `No **${filter}** found${scope}.`;
  }

  const scope = floorId ? `on **${FLOOR_NAMES[floorId] || floorId}**` : 'across all floors';
  return `Highlighting **${matches.length} ${filter}** ${scope}.`;
}

function buildFindRoomResponse() {
  const state = useStore.getState();
  const results = state.findRoomResults;
  if (!results) return null;

  const entries = Object.values(results);
  if (entries.length === 0) return 'No rooms found matching your criteria. Try a lower number.';

  const direct = entries.filter((e) => e.type === 'direct').sort((a, b) => b.score - a.score);
  const repurpose = entries.filter((e) => e.type === 'repurpose').sort((a, b) => b.score - a.score);

  const lines = [];

  if (direct.length > 0) {
    lines.push(`**${direct.length} room${direct.length !== 1 ? 's' : ''} matching capacity** (highlighted in orange):`, '');
    direct.forEach((r, i) => {
      const floor = FLOOR_NAMES[r.floorId] || r.floorId;
      const area = r.area ? `${r.area.toFixed(1)} m²` : '';
      lines.push(`${i + 1}. **${r.name}** — capacity ${r.capacity} · ${area} · ${floor} · ${r.fn}`);
      lines.push(`   _${r.reason}_`);
    });
  }

  if (repurpose.length > 0) {
    if (direct.length > 0) lines.push('');
    lines.push(`**${repurpose.length} repurpose candidate${repurpose.length !== 1 ? 's' : ''}** (highlighted in blue):`, '');
    repurpose.forEach((r, i) => {
      const floor = FLOOR_NAMES[r.floorId] || r.floorId;
      const area = r.area ? `${r.area.toFixed(1)} m²` : '';
      const idx = direct.length + i + 1;
      lines.push(`${idx}. **${r.name}** — capacity ${r.capacity} · ${area} · ${floor} · ${r.fn}`);
      lines.push(`   _${r.reason}_`);
    });
  }

  return lines.join('\n');
}

