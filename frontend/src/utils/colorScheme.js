/**
 * Color scheme for office campus space functions.
 * Returns [r, g, b] in 0-1 range for xeokit.
 *
 * 10 categories mapped to the campus room typology:
 *   0 work, 1 residential, 2 meeting, 3 amenity, 4 circulation,
 *   5 sanitary, 6 support, 7 technical, 8 security, 9 creative
 */

export const FUNCTION_CATEGORIES = [
  {
    label: 'Work',
    keywords: ['office', 'coworking', 'coworking space', 'kantoor', 'workspace', 'desk', 'open plan'],
    color: [0.24, 0.48, 0.82],   // blue
    cssColor: '#3d7ad1',
  },
  {
    label: 'Residential',
    keywords: ['studio', 'apartment', 'studio 1sk', 'residential', 'dwelling', 'living'],
    color: [0.20, 0.65, 0.60],   // warm teal
    cssColor: '#33a699',
  },
  {
    label: 'Meeting',
    keywords: ['seminar', 'meeting', 'conference', 'multipurpose', 'polyvalent', 'vergaderzaal', 'seminariezaal', 'seminarie zaal', 'polyvalente ruimte'],
    color: [0.82, 0.65, 0.24],   // amber/gold
    cssColor: '#d1a63d',
  },
  {
    label: 'Amenity',
    keywords: ['cafe', 'caf\u00e9', 'kitchenette', 'restaurant', 'canteen', 'lounge', 'reception', 'waiting', 'break room'],
    color: [0.30, 0.69, 0.47],   // green
    cssColor: '#4db078',
  },
  {
    label: 'Circulation',
    keywords: ['corridor', 'staircase', 'stairwell', 'vestibule', 'gang', 'trap', 'trappenhal', 'sas', 'lobby', 'lift lobby', 'elevator', 'airlock', 'circulation', 'hall', 'passage'],
    color: [0.60, 0.62, 0.65],   // neutral gray
    cssColor: '#999ea6',
  },
  {
    label: 'Sanitary',
    keywords: ['sanitary', 'sanitair', 'showers', 'douches', 'toilet', 'washroom', 'water', 'wc', 'bathroom'],
    color: [0.62, 0.72, 0.78],   // light blue-gray
    cssColor: '#9eb8c7',
  },
  {
    label: 'Support',
    keywords: ['storage', 'berging', 'lockers', 'locker', 'waste', 'afvalruimte', 'bicycle parking', 'fietsenstalling', 'kinderwagen', 'archive', 'cleaning', 'depot', 'supply'],
    color: [0.62, 0.47, 0.32],   // brown/tan
    cssColor: '#9e7852',
  },
  {
    label: 'Technical',
    keywords: ['technical', 'technieken', 'data room', 'data', 'hvac', 'ventilation', 'warmtepomp', 'shaft', 'plant', 'mechanical', 'electrical', 'server', 'utility', 'riser'],
    color: [0.38, 0.40, 0.44],   // dark gray
    cssColor: '#616670',
  },
  {
    label: 'Security',
    keywords: ['surveillance', 'toezicht', 'control centre', 'controle centrum', 'first aid', 'ehbo', 'security', 'monitoring', 'guard'],
    color: [0.85, 0.35, 0.22],   // orange-red
    cssColor: '#d95938',
  },
  {
    label: 'Creative',
    keywords: ['workshop', 'atelier', 'makerspace', 'lab', 'studio workshop', 'creative'],
    color: [0.58, 0.36, 0.72],   // purple
    cssColor: '#945cb8',
  },
];

const DEFAULT_COLOR = [0.50, 0.52, 0.55];
const DEFAULT_CSS = '#808590';

/**
 * Returns the category index (0-9) for a function name, or -1 if unmatched.
 */
export function getCategoryIndex(primaryFunction) {
  if (!primaryFunction) return -1;
  const lower = primaryFunction.toLowerCase();
  for (let i = 0; i < FUNCTION_CATEGORIES.length; i++) {
    for (const keyword of FUNCTION_CATEGORIES[i].keywords) {
      if (lower.includes(keyword)) return i;
    }
  }
  return -1;
}

/**
 * Returns [r, g, b] color (0-1 range) for a given primary function string.
 */
export function getColorForFunction(primaryFunction) {
  const idx = getCategoryIndex(primaryFunction);
  return idx >= 0 ? FUNCTION_CATEGORIES[idx].color : DEFAULT_COLOR;
}

/**
 * Returns CSS hex color for a given primary function string.
 */
export function getCssColorForFunction(primaryFunction) {
  const idx = getCategoryIndex(primaryFunction);
  return idx >= 0 ? FUNCTION_CATEGORIES[idx].cssColor : DEFAULT_CSS;
}

/**
 * Colors for query/search result highlighting.
 */
export const QUERY_COLORS = {
  BEST_MATCH: [0.30, 0.78, 0.40],   // green
  ACCEPTABLE: [0.90, 0.72, 0.22],   // amber
  POOR_MATCH: [0.85, 0.28, 0.25],   // red
  DIMMED:     [0.25, 0.25, 0.28],   // dark
};
