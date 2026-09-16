/**
 * Shared evacuation tooltip builder for 2D and 3D views.
 */

const EXIT_FUNCTIONS = new Set(['elevator', 'staircase']);

const EVAC_INFRA = new Set([
  'no access', 'ventilation shaft', 'corridor', 'shaft', 'void', 'riser',
  'circulation', 'lobby', 'entrance', 'vestibule',
]);

const EVAC_BANDS = [
  { max: 0.25, color: '#2ED16B', label: 'Excellent' },
  { max: 0.50, color: '#F2D926', label: 'Good' },
  { max: 0.75, color: '#FF8C1A', label: 'At Risk' },
  { max: 1.01, color: '#EB2626', label: 'Critical' },
];

/**
 * Enrich a tooltip object with evacuation-mode data.
 * @param {object} tip  - base tooltip { name, area, x, y }
 * @param {object} poly - polygon data from store
 * @param {Array}  allPolygons - all polygons on the floor (for normalization)
 * @returns {object} tip with evacMode fields added
 */
export function buildEvacTooltip(tip, poly, allPolygons) {
  const fn = (poly.primary_function || '').toLowerCase();
  tip.evacMode = true;
  tip.fn = poly.primary_function || '';
  tip.zone = poly.functional_zone || '';
  tip.areaM2 = poly.area_m2 != null ? Number(poly.area_m2).toFixed(1) : null;

  if (EXIT_FUNCTIONS.has(fn)) {
    tip.evacType = 'exit';
    tip.evacLabel = 'Exit Point';
    tip.evacColor = '#00D4FF';
    tip.evacReason = `${poly.primary_function} — primary evacuation route`;
  } else if (EVAC_INFRA.has(fn)) {
    tip.evacType = 'infra';
    tip.evacLabel = 'Infrastructure';
    tip.evacColor = '#6b7280';
    tip.evacReason = 'Not included in evacuation analysis';
  } else {
    const occ = poly.absolute_occupancy || 0;
    const area = poly.area_m2 || 0;
    tip.evacOccupancy = occ;
    tip.evacDensity = occ > 0 && area > 0
      ? (occ / area).toFixed(2)
      : null;

    if (occ > 0) {
      const vals = allPolygons
        .map(p => p.absolute_occupancy || 0)
        .filter(v => v > 0);
      const mn = Math.min(...vals);
      const mx = Math.max(...vals);
      const range = mx - mn || 1;
      const t = 1 - Math.max(0, Math.min(1, (occ - mn) / range)); // inverted
      const band = EVAC_BANDS.find(b => t <= b.max) || EVAC_BANDS[3];
      tip.evacLabel = band.label;
      tip.evacColor = band.color;

      const areaStr = area > 0 ? ` across ${Math.round(area)} m²` : '';
      const reasons = {
        Excellent:  `${occ} people${areaStr} — low density, fast to evacuate`,
        Good:       `${occ} people${areaStr} — moderate load, standard timeline`,
        'At Risk':  `${occ} people${areaStr} — high density, potential bottleneck`,
        Critical:   `${occ} people${areaStr} — highest load on floor, evacuation priority`,
      };
      tip.evacReason = reasons[band.label];
    } else {
      tip.evacLabel = 'No data';
      tip.evacColor = '#9ca3af';
      tip.evacReason = 'No occupancy data available';
    }
  }

  return tip;
}
