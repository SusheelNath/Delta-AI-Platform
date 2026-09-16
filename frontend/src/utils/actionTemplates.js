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
    case 'modify_furnishing':
      return buildFurnishingModifyResponse(actions.filter((a) => a.type === 'modify_furnishing'));
    case 'suggest_furnishings':
      return buildSuggestFurnishingsResponse();
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

  // Group rooms by floor, preserving score order within each floor
  const groupByFloor = (rooms) => {
    const grouped = new Map();
    for (const r of rooms) {
      const fid = r.floorId;
      if (!grouped.has(fid)) grouped.set(fid, []);
      grouped.get(fid).push(r);
    }
    // Sort floors by FLOOR_ORDER
    return [...grouped.entries()].sort((a, b) =>
      FLOOR_ORDER.indexOf(a[0]) - FLOOR_ORDER.indexOf(b[0])
    );
  };

  // Build concise suitability tag from reason (strip redundant function name)
  const shortReason = (r) => {
    const tags = [];
    if (r.reason.includes('high-suitability')) tags.push('high suitability');
    else if (r.reason.includes('moderate-suitability')) tags.push('moderate suitability');
    if (r.reason.includes('well-accessible floor')) tags.push('accessible floor');
    if (r.reason.includes('accessible zone')) tags.push('accessible zone');
    if (r.type === 'repurpose') tags.push(`capacity ${r.capacity} → repurposable`);
    return tags.length > 0 ? tags.join(' · ') : '';
  };

  const lines = [];
  let idx = 1;

  if (direct.length > 0) {
    lines.push(`**${direct.length} room${direct.length !== 1 ? 's' : ''} matching capacity** (orange):\n`);
    for (const [fid, rooms] of groupByFloor(direct)) {
      const fname = FLOOR_NAMES[fid] || fid;
      lines.push(`**${fname}**\n`);
      for (const r of rooms) {
        const area = r.area ? ` · ${r.area.toFixed(1)} m²` : '';
        const tag = shortReason(r);
        lines.push(`${idx}. **${r.name}** — ${r.fn} · cap. ${r.capacity}${area}${tag ? `\n   _${tag}_` : ''}\n`);
        idx++;
      }
    }
  }

  if (repurpose.length > 0) {
    lines.push(`**${repurpose.length} repurpose candidate${repurpose.length !== 1 ? 's' : ''}** (blue):\n`);
    for (const [fid, rooms] of groupByFloor(repurpose)) {
      const fname = FLOOR_NAMES[fid] || fid;
      lines.push(`**${fname}**\n`);
      for (const r of rooms) {
        const area = r.area ? ` · ${r.area.toFixed(1)} m²` : '';
        const tag = shortReason(r);
        lines.push(`${idx}. **${r.name}** — ${r.fn} · cap. ${r.capacity}${area}${tag ? `\n   _${tag}_` : ''}\n`);
        idx++;
      }
    }
  }

  return lines.join('\n');
}

/**
 * Build the facilities_available text from enriched furnishings.
 * Mirrors backend _get_facilities_cached() format: "2x Desk, Cabinet, 3x Visitor Chair"
 */
export function buildFacilitiesText(furnishings) {
  if (!furnishings || furnishings.length === 0) return null;
  const counts = {};
  for (const f of furnishings) {
    const label = f.label || f.item_type.replace(/_/g, ' ');
    counts[label] = (counts[label] || 0) + (f.quantity || 0);
  }
  const parts = Object.keys(counts).sort().map((label) => {
    const qty = counts[label];
    return qty > 1 ? `${qty}x ${label}` : label;
  });
  return parts.length > 0 ? parts.join(', ') : null;
}

// Station-based occupancy categories (mirrors backend compute_furnishing_occupancy)
const _BED_TYPES = new Set([
  'patient_bed', 'patient_bed_double', 'icu_bed', 'recovery_bed',
  'crib', 'examination_table', 'surgical_table',
]);
const _INDEPENDENT_SEATING = new Set([
  'visitor_chair', 'waiting_bench', 'stool', 'wheelchair_bay',
]);
const _DESK_TYPE = 'desk';
const _DESK_CHAIR_TYPE = 'desk_chair';

/**
 * Break furnishings into station-based categories for display.
 * @param {Array} furnishings - enriched furnishing objects [{item_type, label, quantity, ...}]
 * @returns {{ beds, workstations, seating, other }} with label+qty arrays
 */
function classifyStations(furnishings) {
  const beds = [];
  const seating = [];
  const other = [];
  let deskQty = 0;
  let deskChairQty = 0;

  for (const f of furnishings) {
    const t = f.item_type;
    const label = f.label || t.replace(/_/g, ' ');
    const qty = f.quantity || 0;
    if (_BED_TYPES.has(t)) {
      beds.push({ label, qty });
    } else if (t === _DESK_TYPE) {
      deskQty += qty;
    } else if (t === _DESK_CHAIR_TYPE) {
      deskChairQty += qty;
    } else if (_INDEPENDENT_SEATING.has(t)) {
      seating.push({ label, qty });
    } else {
      other.push({ label, qty });
    }
  }

  const paired = Math.min(deskQty, deskChairQty);
  const surplusDesks = Math.max(0, deskQty - deskChairQty);
  const surplusChairs = Math.max(0, deskChairQty - deskQty);

  const workstations = [];
  if (paired > 0) workstations.push({ label: 'Paired workstation (desk + chair)', qty: paired });
  if (surplusDesks > 0) workstations.push({ label: 'Desk (no chair)', qty: surplusDesks, note: '0 occ' });
  if (surplusChairs > 0) seating.push({ label: 'Desk chair (surplus)', qty: surplusChairs });

  return { beds, workstations, seating, other };
}

/**
 * Build a before/after comparison with station-based breakdown.
 * @param {{ area_m2, used_area_m2, free_area_m2, normal_occupancy, max_occupancy, absolute_occupancy, furnLines }} baseline
 * @param {{ area_m2, used_area_m2, free_area_m2, normal_occupancy, max_occupancy, absolute_occupancy }} afterMetrics
 * @param {Array} afterFurnishings - enriched furnishing objects
 * @returns {string} formatted markdown comparison
 */
export function buildBeforeAfterComparison(baseline, afterMetrics, afterFurnishings) {
  if (!baseline || !afterMetrics) return null;

  const parts = [];
  parts.push('**Before \u2192 After:**');

  // Metrics diff
  const diffLine = (label, before, after, unit) => {
    const b = before != null ? Number(before) : null;
    const a = after != null ? Number(after) : null;
    if (b == null && a == null) return null;
    const bStr = b != null ? (Number.isInteger(b) ? b : b.toFixed(1)) : '--';
    const aStr = a != null ? (Number.isInteger(a) ? a : a.toFixed(1)) : '--';
    const delta = (b != null && a != null) ? a - b : null;
    const deltaStr = delta != null && delta !== 0
      ? ` (${delta > 0 ? '+' : ''}${Number.isInteger(delta) ? delta : delta.toFixed(1)})`
      : '';
    return `${label}: ${bStr} \u2192 ${aStr}${unit}${deltaStr}`;
  };

  const usedLine = diffLine('Used area', baseline.used_area_m2, afterMetrics.used_area_m2, ' m\u00B2');
  const freeLine = diffLine('Free area', baseline.free_area_m2, afterMetrics.free_area_m2, ' m\u00B2');
  const normLine = diffLine('Normal occ.', baseline.normal_occupancy, afterMetrics.normal_occupancy, '');
  const maxLine = diffLine('Max occ.', baseline.max_occupancy, afterMetrics.max_occupancy, '');
  const absLine = diffLine('Absolute occ.', baseline.absolute_occupancy, afterMetrics.absolute_occupancy, '');

  if (usedLine) parts.push(usedLine);
  if (freeLine) parts.push(freeLine);
  if (normLine) parts.push(normLine);
  if (maxLine) parts.push(maxLine);
  if (absLine) parts.push(absLine);

  // Station breakdown of after-state
  if (afterFurnishings && afterFurnishings.length > 0) {
    const { beds, workstations, seating, other } = classifyStations(afterFurnishings);

    parts.push('');
    parts.push('**Station breakdown:**');

    if (beds.length > 0) {
      parts.push(`_Beds_ \u2014 ${beds.map((b) => `${b.qty}\u00D7 ${b.label}`).join(', ')}`);
    }
    if (workstations.length > 0) {
      parts.push(`_Workstations_ \u2014 ${workstations.map((w) => `${w.qty}\u00D7 ${w.label}${w.note ? ` (${w.note})` : ''}`).join(', ')}`);
    }
    if (seating.length > 0) {
      parts.push(`_Seating_ \u2014 ${seating.map((s) => `${s.qty}\u00D7 ${s.label}`).join(', ')}`);
    }
    if (other.length > 0) {
      parts.push(`_Other_ \u2014 ${other.map((o) => `${o.qty}\u00D7 ${o.label}`).join(', ')} (0 occ, area only)`);
    }
  }

  // Clear baseline after use
  useStore.setState({ _furnishingBaseline: null });

  return parts.join('\n');
}

function buildFurnishingModifyResponse(actions) {
  const actionList = Array.isArray(actions) ? actions : [actions];
  const store = useStore.getState();
  const result = store._lastFurnishingResult;
  const spaceName = store.selectedSpace?.space_name || store.selectedSpaceId || 'this space';

  if (!result) return `Furnishing change applied to **${spaceName}**.`;
  if (result.error) return `Could not modify furnishings: _${result.error}_`;

  const parts = [];

  for (const action of actionList) {
    const act = action.action; // "add" | "remove" | "remove_all"
    if (act === 'remove_all') {
      parts.push(`All furnishings removed from **${spaceName}**.`);
    } else if (act === 'add') {
      const qty = action.quantity || 1;
      const label = action.item_type?.replace(/_/g, ' ') || 'item';
      parts.push(`Added **${qty}\u00D7 ${label}** to **${spaceName}**.`);
    } else if (act === 'remove') {
      const qty = action.quantity;
      const label = action.item_type?.replace(/_/g, ' ') || 'item';
      if (qty) {
        parts.push(`Removed **${qty}\u00D7 ${label}** from **${spaceName}**.`);
      } else {
        parts.push(`Removed all **${label}** from **${spaceName}**.`);
      }
    } else {
      parts.push(`Furnishings updated for **${spaceName}**.`);
    }
  }

  const m = result.metrics;
  if (m) {
    parts.push('');
    parts.push(`Area: ${m.area_m2?.toFixed(1) ?? '--'} m\u00B2 \u00B7 Used: ${m.used_area_m2?.toFixed(1) ?? '--'} m\u00B2 \u00B7 Free: ${m.free_area_m2?.toFixed(1) ?? '--'} m\u00B2`);
    parts.push(`Occupancy: ${m.normal_occupancy ?? 0} normal / ${m.max_occupancy ?? 0} max / ${m.absolute_occupancy ?? 0} absolute`);
  }

  const furn = result.furnishings;
  if (furn && furn.length > 0) {
    parts.push('');
    parts.push('**Current furnishings:**');
    for (const f of furn) {
      parts.push(`- ${f.quantity}\u00D7 ${f.label || f.item_type}${f.footprint_m2 > 0 ? ` (${(f.footprint_m2 * f.quantity).toFixed(1)} m\u00B2)` : ''}`);
    }
  } else if (act === 'remove_all') {
    parts.push('\nThe room is now empty. Use the furnishing editor to add items.');
  }

  // Append before/after comparison if baseline exists
  const baseline = store._furnishingBaseline;
  if (baseline && m) {
    const comparison = buildBeforeAfterComparison(baseline, m, furn);
    if (comparison) {
      parts.push('');
      parts.push(comparison);
    }
  }

  return parts.join('\n');
}

function buildSuggestFurnishingsResponse() {
  const store = useStore.getState();
  const spaceName = store.selectedSpace?.space_name || 'this space';
  return `Opening the **Furnishing Editor** for **${spaceName}**. Use the **Add New** tab to browse the catalog and add items with live validation.`;
}

