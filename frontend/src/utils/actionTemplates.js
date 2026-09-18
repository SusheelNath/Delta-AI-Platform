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
    clear_selection: "Done - selection cleared. The view is ready for your next pick.",
    clear_route: "Route cleared. Select a room to find a new path.",
    clear_all: "Everything reset - clean slate. What would you like to explore?",
    clear_highlights: "Highlights cleared.",
    clear_search: "Search cleared.",
    reset_heatmap: "Back to the default function view.",
    reset_filters: "All room types are now visible.",
    toggle_mep: "Infrastructure layer toggled.",
    set_floor_relative: confirmText,
    enter_compare_mode: "Compare mode is active - select two floors to see them side by side.",
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

  return `Navigating to **${fname}** - ${count} spaces${areaStr}.${fnStr}`;
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
    `**Chirec Delta Hospital** - ${floorCount} floors, ${totalSpaces.toLocaleString()} spaces, ${totalAreaStr}`,
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
    parts.push(`**${fname}** - ${count} spaces · ${areaStr}  `);
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
  const lines = [`Here are the **3 largest rooms** on **${fname}** - highlighted in orange:`, ''];

  polys.forEach((p, i) => {
    const name = p.space_name || p.ifc_guid;
    const fn = p.primary_function || '';
    const area = p.area_m2.toFixed(1);
    const zone = p.functional_zone ? ` · ${p.functional_zone}` : '';
    lines.push(`${i + 1}. **${name}** - ${area} m² · ${fn}${zone}`);
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
        lines.push(`${idx}. **${r.name}** - ${r.fn} · cap. ${r.capacity}${area}${tag ? `\n   _${tag}_` : ''}\n`);
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
        lines.push(`${idx}. **${r.name}** - ${r.fn} · cap. ${r.capacity}${area}${tag ? `\n   _${tag}_` : ''}\n`);
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

/**
 * Build a rich chat message from a repurpose option.
 * Used when the user clicks "Inject to Chat" in the RepurposePanel.
 */
export function buildRepurposeResponse(option, spaceName, floorId, activeTab = 'overview', currentFunction = '', areaM2 = 0) {
  const fname = FLOOR_NAMES[floorId] || floorId || '';
  const p = [];
  const sign = (v) => v >= 0 ? '+' : '';
  const eur = (v) => `\u20AC${(v || 0).toLocaleString()}`;
  const pct = (r) => r != null ? Math.round(r * 100) : 0;
  const hr = () => p.push('\n---\n');
  // Extract amount/explanation from {amount, explanation} or plain number
  const itemAmt = (v) => typeof v === 'object' && v ? (v.amount || 0) : (v || 0);
  const itemExpl = (v) => typeof v === 'object' && v ? v.explanation : null;

  // Shared references
  const c = option.cost_breakdown || {};
  const roi = option.roi || {};
  const impact = option.operational_impact || {};
  const tl = option.timeline || {};
  const delta = option.furnishing_delta || {};
  const re = roi.explanations || {};
  const totalInvestment = roi.total_investment || c.total_project_cost || c.total_capex || 0;
  const area = Math.round(areaM2 || (c.cost_per_m2 ? (c.total_project_cost || 0) / c.cost_per_m2 : 0));

  // Header
  p.push(`### Repurpose Analysis \u2014 ${spaceName || 'Selected Space'} (${fname})`);
  p.push(`**${currentFunction || 'Current'}** \u2192 **${option.target_label}** | Score: **${option.overall_score}%** | ${option.target_category || ''}\n`);

  // ════════════════════════════════════════════════════════════════
  if (activeTab === 'overview') {
  // ════════════════════════════════════════════════════════════════

    // Executive summary
    p.push(`> ${option.overall_score >= 75 ? 'Strong candidate' : option.overall_score >= 50 ? 'Viable candidate' : 'Challenging conversion'} for repurposing. ${roi.payback_months ? `Payback in ${roi.payback_months} months.` : 'Non-revenue investment.'} Total cost ${eur(c.total_project_cost || c.total_capex)}.`);
    p.push('');

    // Room profile - bullets
    p.push('#### Room Profile\n');
    if (area) p.push(`- **Area** \u2014 ${area} m\u00B2`);
    if (currentFunction) p.push(`- **Current function** \u2014 ${currentFunction}`);
    p.push(`- **Target function** \u2014 ${option.target_label}`);
    p.push(`- **Category** \u2014 ${option.target_category || '-'}`);
    p.push(`- **Renovation class** \u2014 ${c.renovation?.explanation?.match(/(\w+)\s+renovation/)?.[1] || '-'}`);
    p.push(`- **Total project cost** \u2014 ${eur(c.total_project_cost || c.total_capex)} (${eur(c.cost_per_m2)}/m\u00B2)`);
    if (roi.payback_months) p.push(`- **Payback** \u2014 ${roi.payback_months} months`);
    if (roi.roi_5yr_pct != null) p.push(`- **5-year ROI** \u2014 ${sign(roi.roi_5yr_pct)}${roi.roi_5yr_pct}%`);
    const keepCount = delta.keep?.length || 0;
    const totalFurnItems = keepCount + (delta.remove?.length || 0) + (delta.add?.length || 0);
    if (totalFurnItems) p.push(`- **Asset reuse** \u2014 ${Math.round(keepCount / totalFurnItems * 100)}% (${keepCount}/${totalFurnItems} items)`);
    p.push('');

    // Justification
    if (option.justification?.length > 0) {
      p.push('#### Why This Conversion Works\n');
      for (const j of option.justification) p.push(`- ${j}`);
      p.push('');
    }

    // Score breakdown - bullets
    if (option.scores) {
      const scoreLabels = {
        area_fit: 'Size Match', distribution_gap: 'Service Demand', adjacency: 'Location Synergy',
        zone_fit: 'Zone Fit', infrastructure: 'Infrastructure', regulatory: 'Regulatory',
        furnishing_reuse: 'Asset Retention', cost_efficiency: 'Cost Efficiency',
        revenue_impact: 'Revenue Impact', service_continuity: 'Service Continuity',
        patient_flow: 'Patient Flow', operational_complexity: 'Conversion Ease',
        utilisation_potential: 'Utilisation',
      };
      const entries = Object.entries(option.scores);
      const strengths = entries.filter(([, v]) => v >= 65);
      const moderate = entries.filter(([, v]) => v >= 40 && v < 65);
      const risks = entries.filter(([, v]) => v < 40);

      if (strengths.length) {
        p.push('#### Strengths\n');
        for (const [key, val] of strengths) {
          p.push(`- **${scoreLabels[key] || key}** (${val}) \u2014 ${option.score_reasons?.[key] || ''}`);
        }
        p.push('');
      } else {
        p.push('#### Strengths\n');
        p.push('_No dimensions scored above 65._');
        p.push('');
      }

      if (moderate.length) {
        p.push('#### Moderate\n');
        for (const [key, val] of moderate) {
          p.push(`- **${scoreLabels[key] || key}** (${val}) \u2014 ${option.score_reasons?.[key] || ''}`);
        }
        p.push('');
      }

      if (risks.length) {
        p.push('#### Risks & Weaknesses\n');
        for (const [key, val] of risks) {
          p.push(`- **${scoreLabels[key] || key}** (${val}) \u2014 ${option.score_reasons?.[key] || ''}`);
        }
        p.push('');
      }
    }

    hr();
    p.push(`_See Costs, ROI, Timeline, and Furnishings tabs for detailed breakdowns._`);

  // ════════════════════════════════════════════════════════════════
  } else if (activeTab === 'costs') {
  // ════════════════════════════════════════════════════════════════

    // Executive summary
    p.push(`> Total project cost **${eur(c.total_project_cost || c.total_capex)}** (${eur(c.cost_per_m2)}/m\u00B2). CAPEX ${eur(c.total_capex)}, design fees ${eur(c.design_fees)}, contingency ${eur(c.contingency)}.`);
    p.push('');

    // Cost drivers context
    if (c.cost_drivers?.length > 0) {
      p.push('#### Cost Drivers\n');
      for (const d of c.cost_drivers) p.push(`- ${d}`);
      p.push('');
    }

    // Bullet-list section builder
    const costSection = (num, title, data, keys) => {
      if (!data) return;
      p.push(`#### ${num}. ${title} \u2014 ${eur(data.subtotal)}\n`);
      for (const [k, label] of keys) {
        const raw = data[k];
        const amt = itemAmt(raw);
        if (!amt) continue;
        const expl = itemExpl(raw);
        p.push(`- **${label}** \u2014 ${eur(amt)}${expl ? `\n  ${expl}` : ''}`);
      }
      p.push('');
    };

    // 1. Renovation
    costSection(1, 'Renovation Works', c.renovation, [
      ['paint_flooring', 'Paint & flooring'], ['ceiling_walls', 'Ceiling & walls'], ['mep_services', 'MEP services'],
    ]);

    // 2. Furnishings
    costSection(2, 'Furnishings', c.furnishing, [
      ['removal', 'Removal & disposal'], ['new_purchase', 'New purchase'], ['installation', 'Installation & fitting'],
    ]);

    // 3. Vendor Concessions
    if (c.vendor_concessions) {
      const vc = c.vendor_concessions;
      p.push(`#### 3. Vendor Concessions \u2014 ${eur(Math.abs(vc.subtotal || 0))} savings\n`);
      for (const [key, label] of [['framework_discount', 'Framework discount'], ['trade_in_credit', 'Trade-in credit'],
        ['bulk_procurement', 'Bulk procurement'], ['warranty_transfer', 'Warranty transfer'], ['reuse_savings', 'Asset reuse']]) {
        const item = vc[key];
        if (!item || item.amount === 0) continue;
        const vendor = item.vendor ? ` _(${item.vendor})_` : '';
        p.push(`- **${label}** \u2014 -${eur(Math.abs(item.amount))}${vendor}${item.explanation ? `\n  ${item.explanation}` : ''}`);
      }
      if (vc.net_furnishing_cost != null) p.push(`\n_Net furnishing cost after concessions: ${eur(vc.net_furnishing_cost)}_`);
      p.push('');
    }

    // 4. Infrastructure
    costSection(4, 'Infrastructure', c.infrastructure, [
      ['medical_gas', 'Medical gas install'], ['nurse_call', 'Nurse call install'],
      ['hvac_upgrade', 'HVAC upgrade (surgical)'], ['plumbing', 'Plumbing / new sink'], ['data_cabling', 'Data cabling point'],
    ]);

    // 5. Compliance
    costSection(5, 'Compliance', c.compliance, [
      ['fire_safety_review', 'Fire safety review'], ['accessibility_audit', 'Accessibility audit'],
      ['infection_control', 'Infection control review'], ['permitting_fees', 'Permitting & approvals'],
      ['environmental_review', 'Environmental assessment'],
    ]);

    // 6. Labour
    if (c.labour) {
      p.push(`#### 6. Labour & Human Resources \u2014 ${eur(c.labour.subtotal)}\n`);
      for (const [key, label] of [['general_contractor', 'General contractor'], ['specialist_trades', 'Specialist trades'],
        ['medical_gas_installer', 'Medical gas installer'], ['project_management', 'Project management'],
        ['health_safety_officer', 'Health & safety officer'], ['clerk_of_works', 'Clerk of works']]) {
        const item = c.labour[key];
        if (!item?.amount) continue;
        const d = item.detail;
        const detail = d ? (d.workers && d.weeks && d.rate ? `${d.workers} workers \u00D7 ${d.weeks} wk @ ${eur(d.rate)}/wk` : d.explanation || '') : '';
        p.push(`- **${label}** \u2014 ${eur(item.amount)}${detail ? `\n  ${detail}` : ''}`);
      }
      p.push('');
    }

    // 7. Permits
    if (c.commune_permits) {
      p.push(`#### 7. Commune & Municipal Permits \u2014 ${eur(c.commune_permits.subtotal)}\n`);
      for (const [key, label] of [['building_permit', 'Building permit'], ['change_of_use', 'Change of use'],
        ['fire_inspection', 'Fire inspection'], ['health_authority', 'Health authority'],
        ['occupation_certificate', 'Occupation certificate'], ['environmental_clearance', 'Environmental clearance']]) {
        const item = c.commune_permits[key];
        if (!item?.amount) continue;
        const d = item.detail;
        const processing = d?.processing_weeks ? ` _(${d.processing_weeks} weeks)_` : '';
        p.push(`- **${label}** \u2014 ${eur(item.amount)}${processing}${d?.explanation ? `\n  ${d.explanation}` : ''}`);
      }
      p.push('');
    }

    // 8. Commissioning
    if (c.commissioning) {
      p.push(`#### 8. Commissioning & Handover \u2014 ${eur(c.commissioning.subtotal)}\n`);
      for (const [key, label] of [['systems_testing', 'Systems testing'], ['infection_control_clean', 'Infection control clean'],
        ['snagging', 'Snagging & defects'], ['equipment_calibration', 'Equipment calibration'],
        ['as_built_docs', 'As-built documentation'], ['staff_orientation', 'Staff orientation']]) {
        const item = c.commissioning[key];
        if (!item?.amount) continue;
        p.push(`- **${label}** \u2014 ${eur(item.amount)}${item.explanation ? `\n  ${item.explanation}` : ''}`);
      }
      p.push('');
    }

    // 9. Operational Disruption
    if (c.disruption) {
      p.push(`#### 9. Operational Disruption \u2014 ${eur(c.disruption.subtotal)}\n`);
      for (const [key, label] of [['temporary_relocation', 'Temporary relocation'], ['wayfinding_signage', 'Wayfinding & signage'],
        ['it_reconfiguration', 'IT reconfiguration'], ['staff_retraining', 'Staff retraining'],
        ['adjacent_mitigation', 'Adjacent area mitigation'], ['patient_scheduling', 'Patient scheduling'],
        ['communication_plan', 'Communication plan']]) {
        const item = c.disruption[key];
        if (!item?.amount) continue;
        const reason = item.justification || item.explanation || '';
        p.push(`- **${label}** \u2014 ${eur(item.amount)}${reason ? `\n  ${reason}` : ''}`);
      }
      p.push('');
    }

    // 10. Contingency
    if (c.contingency_breakdown) {
      const cb = c.contingency_breakdown;
      p.push(`#### 10. Contingency Reserve \u2014 ${pct(cb.total_rate)}%\n`);
      for (const [key, label] of [['base', 'Base contingency'], ['complexity', 'Complexity premium'],
        ['regulatory', 'Regulatory risk'], ['supply_chain', 'Supply chain']]) {
        const item = cb[key];
        if (!item) continue;
        p.push(`- **${label}** \u2014 ${pct(item.rate)}% (${eur(item.amount)})${item.explanation ? `\n  ${item.explanation}` : ''}`);
      }
      p.push(`- **Total** \u2014 ${pct(cb.total_rate)}% (${eur(cb.total)})`);
      p.push('');
    }

    hr();

    // Cost Summary - bullets
    p.push('#### Cost Summary\n');
    if (c.renovation) p.push(`- Renovation \u2014 ${eur(c.renovation.subtotal)}`);
    if (c.furnishing) p.push(`- Furnishings \u2014 ${eur(c.furnishing.subtotal)}`);
    if (c.vendor_concessions) p.push(`- Vendor concessions \u2014 -${eur(Math.abs(c.vendor_concessions.subtotal || 0))}`);
    if (c.infrastructure) p.push(`- Infrastructure \u2014 ${eur(c.infrastructure.subtotal)}`);
    if (c.compliance) p.push(`- Compliance \u2014 ${eur(c.compliance.subtotal)}`);
    if (c.labour) p.push(`- Labour \u2014 ${eur(c.labour.subtotal)}`);
    if (c.commune_permits) p.push(`- Permits \u2014 ${eur(c.commune_permits.subtotal)}`);
    if (c.commissioning) p.push(`- Commissioning \u2014 ${eur(c.commissioning.subtotal)}`);
    if (c.disruption) p.push(`- Disruption \u2014 ${eur(c.disruption.subtotal)}`);
    p.push(`- **CAPEX** \u2014 **${eur(c.total_capex)}**`);
    if (c.design_fees) p.push(`- Design fees (6%) \u2014 ${eur(c.design_fees)}`);
    if (c.contingency) p.push(`- Contingency \u2014 ${eur(c.contingency)}`);
    p.push(`- **Total Project Cost** \u2014 **${eur(c.total_project_cost || c.total_capex)}**`);
    p.push('');

    // Financial Structure - bullets, no duplicate retention
    if (c.financial_structure) {
      const fs = c.financial_structure;
      p.push('#### Financial Structure\n');
      const milestones = fs.payment_milestones || [];
      const hasRetentionMilestone = milestones.some(m => /retention/i.test(m.stage));
      for (const m of milestones) p.push(`- **${m.stage}** \u2014 ${m.pct}% (${eur(m.amount)})`);
      if (fs.retention && !hasRetentionMilestone) {
        p.push(`- **Retention** \u2014 ${fs.retention.pct}% (${eur(fs.retention.amount)}) \u2014 held for ${fs.retention.period_months}-month defects liability`);
      }
      p.push('');
      if (fs.vat) p.push(`- VAT: ${fs.vat.rate}% (${eur(fs.vat.amount)})${fs.vat.note ? ` \u2014 ${fs.vat.note}` : ''}`);
      if (fs.retention) p.push(`- Retention: ${eur(fs.retention.amount)} held for ${fs.retention.period_months}-month defects liability`);
      if (fs.capex_opex_split) p.push(`- CAPEX/OPEX split: ${eur(fs.capex_opex_split.capex)} capital / ${eur(fs.capex_opex_split.opex)} operational`);
      if (fs.depreciation) {
        const dep = fs.depreciation;
        p.push(`- Depreciation: fit-out ${eur(dep.fitout_annual)}/yr (${dep.fitout_years}y), furnishings ${eur(dep.furnishing_annual)}/yr (${dep.furnishing_years}y)`);
      }
    }

  // ════════════════════════════════════════════════════════════════
  } else if (activeTab === 'roi') {
  // ════════════════════════════════════════════════════════════════

    // Executive summary / verdict
    const verdict = roi.net_annual_delta > 0
      ? `Positive-return investment with ${roi.payback_months ? roi.payback_months + '-month payback' : 'long-term recovery'}. 5-year ROI: ${sign(roi.roi_5yr_pct)}${roi.roi_5yr_pct}%.`
      : roi.net_annual_delta === 0
        ? 'Revenue-neutral conversion. Value is operational, not financial.'
        : `Service-quality investment. Net annual cost of ${eur(Math.abs(roi.net_annual_delta))}/yr offset by operational benefit.`;
    p.push(`> ${verdict}`);
    p.push('');

    // Key metrics - bullets
    p.push('#### Key Metrics\n');
    p.push(`- **Net annual impact** \u2014 ${sign(roi.net_annual_delta)}${eur(roi.net_annual_delta)}/yr${re.net_annual_delta ? `\n  ${re.net_annual_delta}` : ''}`);
    p.push(`- **Total investment** \u2014 ${eur(totalInvestment)}${re.total_investment ? `\n  ${re.total_investment}` : ''}`);
    p.push(`- **Payback period** \u2014 ${roi.payback_months ? `${roi.payback_months} months` : 'Non-revenue'}${re.payback ? `\n  ${re.payback}` : ''}`);
    if (roi.roi_5yr_pct != null) p.push(`- **5-year ROI** \u2014 ${sign(roi.roi_5yr_pct)}${roi.roi_5yr_pct}%${re.roi_5yr ? `\n  ${re.roi_5yr}` : ''}`);
    if (roi.downtime_cost > 0) p.push(`- **Downtime revenue loss** \u2014 ${eur(roi.downtime_cost)}${re.downtime_cost ? `\n  ${re.downtime_cost}` : ''}`);
    p.push('');

    // Investment breakdown - bullets
    const ib = roi.investment_breakdown;
    if (ib) {
      const ibAmt = (k) => { const v = ib[k]; if (!v) return 0; return typeof v === 'object' && 'amount' in v ? v.amount : v; };
      const ibExpl = (k) => { const v = ib[k]; return typeof v === 'object' ? v.explanation : null; };
      p.push('#### Investment Breakdown\n');
      for (const [k, label] of [['capex', 'Capital expenditure'], ['design_fees', 'Design & professional fees'],
        ['contingency', 'Contingency reserve'], ['disruption', 'Operational disruption'], ['commune_permits', 'Commune & municipal permits']]) {
        if (ibAmt(k) > 0) p.push(`- **${label}** \u2014 ${eur(ibAmt(k))}${ibExpl(k) ? `\n  ${ibExpl(k)}` : ''}`);
      }
      if (ibAmt('vendor_concessions') < 0) p.push(`- **Vendor concessions** \u2014 ${eur(ibAmt('vendor_concessions'))}${ibExpl('vendor_concessions') ? `\n  ${ibExpl('vendor_concessions')}` : ''}`);
      p.push(`- **Total project investment** \u2014 ${eur(totalInvestment)}`);
      p.push('');
    }

    // Revenue & OPEX - bullets
    p.push('#### Revenue & OPEX Comparison\n');
    p.push(`- **Revenue** \u2014 ${eur(roi.annual_revenue_current)}/yr \u2192 ${eur(roi.annual_revenue_target)}/yr (${sign(roi.annual_revenue_delta)}${eur(roi.annual_revenue_delta)})${re.revenue_delta ? `\n  ${re.revenue_delta}` : ''}`);
    p.push(`- **OPEX** \u2014 ${eur(roi.annual_opex_current)}/yr \u2192 ${eur(roi.annual_opex_target)}/yr (${sign(roi.annual_opex_delta)}${eur(roi.annual_opex_delta)})${re.opex_delta ? `\n  ${re.opex_delta}` : ''}`);
    p.push(`- **Net annual** \u2014 ${sign(roi.net_annual_delta)}${eur(roi.net_annual_delta)}/yr${re.net_annual_delta ? `\n  ${re.net_annual_delta}` : ''}`);
    p.push('');

    // Narrative
    if (roi.roi_narrative) {
      p.push(`> ${roi.roi_narrative}`);
      p.push('');
    }

    // Operational impact - bullets
    if (impact.care_capacity || impact.staffing || impact.occupancy || impact.service_continuity) {
      p.push('#### Operational Impact\n');
      if (impact.care_capacity) {
        const cc = impact.care_capacity;
        p.push(`- **Care capacity** \u2014 ${cc.current_beds} \u2192 ${cc.projected_beds} beds (${sign(cc.delta)}${cc.delta})\n  ${cc.assessment}`);
      }
      if (impact.staffing) {
        const st = impact.staffing;
        const costNote = st.annual_cost_delta !== 0 ? `, ${sign(st.annual_cost_delta)}${eur(st.annual_cost_delta)}/yr` : '';
        p.push(`- **Staffing** \u2014 ${st.current_fte} \u2192 ${st.projected_fte} FTE (${sign(st.delta_fte)}${st.delta_fte} FTE${costNote})`);
      }
      if (impact.occupancy) {
        const oc = impact.occupancy;
        p.push(`- **Occupancy** \u2014 ${oc.current} \u2192 ${oc.projected} persons (density ${oc.current_density} \u2192 ${oc.projected_density}/m\u00B2)`);
      }
      if (impact.service_continuity) {
        const sc = impact.service_continuity;
        p.push(`- **Service risk** \u2014 ${sc.risk_level}\n  ${sc.assessment}`);
      }
      p.push('');
    }

    // Risk factors
    const risks = [];
    if (roi.downtime_cost > 0) risks.push(`Revenue loss of ${eur(roi.downtime_cost)} during ${tl.weeks_min || '?'}\u2013${tl.weeks_max || '?'} week construction period`);
    if (impact.service_continuity?.risk_level === 'high') risks.push(`High service continuity risk \u2014 ${impact.service_continuity.assessment}`);
    if (impact.staffing?.delta_fte > 1) risks.push(`Staffing increase of ${impact.staffing.delta_fte} FTE (${eur(impact.staffing.annual_cost_delta)}/yr ongoing)`);
    if (roi.roi_5yr_pct != null && roi.roi_5yr_pct < 0) risks.push(`Negative 5-year ROI (${roi.roi_5yr_pct}%) \u2014 non-financial benefits must justify`);
    if (risks.length) {
      hr();
      p.push('#### Risk Factors\n');
      for (const r of risks) p.push(`- ${r}`);
    }

  // ════════════════════════════════════════════════════════════════
  } else if (activeTab === 'timeline') {
  // ════════════════════════════════════════════════════════════════

    // Executive summary
    p.push(`> Estimated **${tl.total || '?'}** from mobilisation to handover. Room unavailable throughout.`);
    p.push('');

    // Duration factors
    if (tl.reasons?.length > 0) {
      p.push('#### Duration Factors\n');
      for (const r of tl.reasons) p.push(`- ${r}`);
      p.push('');
    }

    // Phases - merged schedule + details
    if (tl.phases?.length > 0) {
      p.push('#### Project Phases\n');
      tl.phases.forEach((phase, i) => {
        p.push(`**${i + 1}. ${phase.name}** \u2014 ${phase.weeks}${phase.responsible ? ` _(${phase.responsible})_` : ''}`);
        if (phase.description) p.push(`_${phase.description}_`);
        if (phase.tasks?.length > 0) {
          for (const task of phase.tasks) p.push(`- ${task}`);
        }
        p.push('');
      });
    }

    // Resource requirements - bullets
    if (c.labour) {
      p.push('#### Resource Requirements\n');
      for (const [key, label] of [['general_contractor', 'General contractor'], ['specialist_trades', 'Specialist trades'],
        ['medical_gas_installer', 'Medical gas installer'], ['project_management', 'Project management'],
        ['health_safety_officer', 'Health & safety officer'], ['clerk_of_works', 'Clerk of works']]) {
        const item = c.labour[key];
        if (!item?.amount) continue;
        const d = item.detail;
        p.push(`- **${label}** \u2014 ${d?.weeks ? d.weeks + ' weeks' : '-'}, ${d?.workers || '-'} workers \u2014 ${eur(item.amount)}`);
      }
      p.push(`- **Total labour** \u2014 ${eur(c.labour.subtotal)}`);
      p.push('');
    }

    // Payment milestones - bullets
    if (c.financial_structure?.payment_milestones?.length > 0) {
      p.push('#### Payment Milestones\n');
      for (const m of c.financial_structure.payment_milestones) {
        p.push(`- **${m.stage}** \u2014 ${m.pct}% (${eur(m.amount)})`);
      }
      p.push('');
    }

    hr();

    // Disruption impact
    p.push('#### Disruption Impact\n');
    if (roi.downtime_cost > 0) p.push(`- Revenue loss during works: **${eur(roi.downtime_cost)}**${re.downtime_cost ? ` \u2014 ${re.downtime_cost}` : ''}`);
    if (c.disruption?.subtotal > 0) p.push(`- Operational disruption costs: **${eur(c.disruption.subtotal)}** \u2014 relocation, signage, IT, retraining`);
    p.push(`- Room unavailable for **${tl.weeks_min || '?'}\u2013${tl.weeks_max || '?'} weeks** \u2014 coordinate with floor operations`);

  // ════════════════════════════════════════════════════════════════
  } else if (activeTab === 'furnishings') {
  // ════════════════════════════════════════════════════════════════

    const keep = delta.keep || [];
    const remove = delta.remove || [];
    const add = delta.add || [];
    const keepCount = keep.length;
    const removeCount = remove.length;
    const addCount = add.length;
    const totalItems = keepCount + removeCount + addCount;
    const reuseRate = totalItems > 0 ? Math.round(keepCount / totalItems * 100) : 0;
    const addTotal = add.reduce((s, f) => s + (f.unit_cost || 0) * (f.quantity || 0), 0);
    const removeQty = remove.reduce((s, f) => s + (f.quantity || 0), 0);
    const addQty = add.reduce((s, f) => s + (f.quantity || 0), 0);
    const keepQty = keep.reduce((s, f) => s + (f.quantity || 0), 0);

    // Executive summary
    p.push(`> ${reuseRate}% asset reuse rate. ${keepCount} item types retained, ${removeCount} removed, ${addCount} new to procure. Total procurement: **${eur(addTotal)}**.`);
    p.push('');

    // Transition summary - bullets
    p.push('#### Transition Summary\n');
    p.push(`- **Items retained** \u2014 ${keepCount} types (${keepQty} units)`);
    p.push(`- **Items to remove** \u2014 ${removeCount} types (${removeQty} units)`);
    p.push(`- **Items to procure** \u2014 ${addCount} types (${addQty} units)`);
    p.push(`- **Reuse rate** \u2014 ${reuseRate}%`);
    p.push(`- **Procurement cost** \u2014 ${eur(addTotal)}`);
    if (c.furnishing) p.push(`- **Removal & disposal** \u2014 ${eur(itemAmt(c.furnishing.removal))}`);
    if (c.furnishing) p.push(`- **Installation** \u2014 ${eur(itemAmt(c.furnishing.installation))}`);
    if (c.furnishing) p.push(`- **Furnishing subtotal** \u2014 **${eur(c.furnishing.subtotal)}**`);
    p.push('');

    // Retained assets - bullets
    if (keepCount > 0) {
      p.push('#### Retained Assets\n');
      p.push('_Carried over from current layout \u2014 no procurement required._\n');
      for (const f of keep) p.push(`- ${f.quantity}\u00D7 ${f.label}`);
      p.push('');
    }

    // Assets to remove - bullets
    if (removeCount > 0) {
      p.push('#### Assets to Remove\n');
      p.push('_Relocated, stored, or disposed. Disposal cost included in furnishing removal line._\n');
      for (const f of remove) p.push(`- ${f.quantity}\u00D7 ${f.label}`);
      p.push('');
    }

    // New procurement - bullets
    if (addCount > 0) {
      p.push('#### New Procurement\n');
      for (const f of add) {
        const cost = (f.unit_cost || 0) * (f.quantity || 0);
        p.push(`- ${f.quantity}\u00D7 **${f.label}** \u2014 ${f.unit_cost ? `${eur(f.unit_cost)}/ea` : 'included'}${cost > 0 ? ` \u2014 ${eur(cost)}` : ''}`);
      }
      p.push(`- **Total procurement** \u2014 **${eur(addTotal)}**`);
      p.push('');
    }

    // Vendor concessions - bullets
    if (c.vendor_concessions && c.vendor_concessions.subtotal < 0) {
      p.push('#### Vendor Concessions Applied\n');
      p.push('_These savings offset the procurement cost above._\n');
      for (const [key, label] of [['framework_discount', 'Framework discount'], ['trade_in_credit', 'Trade-in credit'],
        ['bulk_procurement', 'Bulk procurement'], ['warranty_transfer', 'Warranty transfer'], ['reuse_savings', 'Asset reuse']]) {
        const item = c.vendor_concessions[key];
        if (!item || item.amount === 0) continue;
        const vendor = item.vendor ? ` _(${item.vendor})_` : '';
        p.push(`- **${label}** \u2014 -${eur(Math.abs(item.amount))}${vendor}`);
      }
      p.push(`- **Total savings** \u2014 -${eur(Math.abs(c.vendor_concessions.subtotal))}`);
      if (c.vendor_concessions.net_furnishing_cost != null) {
        p.push(`\n_Net furnishing cost after concessions: **${eur(c.vendor_concessions.net_furnishing_cost)}**_`);
      }
      p.push('');
    }

    hr();
    p.push(`_Procurement lead times may affect the project timeline (currently ${tl.total || '?'}). Coordinate with vendors early._`);
  }

  return p.join('\n');
}

