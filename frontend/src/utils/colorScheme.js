/**
 * Color scheme for IFC space functions.
 * Returns [r, g, b] in 0-1 range for xeokit.
 */

export const FUNCTION_CATEGORIES = [
  {
    label: 'Clinical',
    keywords: ['operating', 'imaging', 'emergency', 'icu', 'dialysis', 'consultation', 'clinical', 'treatment', 'examination', 'endoscopy', 'radiology', 'laboratory', 'therapy', 'intensive'],
    color: [0.24, 0.48, 0.82],
    cssColor: '#3d7ad1',
  },
  {
    label: 'Patient',
    keywords: ['single room', 'double room', 'patient', 'ward', 'bedroom', 'bed room', 'recovery', 'maternity', 'neonatal'],
    color: [0.30, 0.69, 0.47],
    cssColor: '#4db078',
  },
  {
    label: 'Technical',
    keywords: ['technical', 'shaft', 'plant', 'mechanical', 'electrical', 'hvac', 'server', 'utility'],
    color: [0.45, 0.48, 0.52],
    cssColor: '#737b85',
  },
  {
    label: 'Circulation',
    keywords: ['corridor', 'lift lobby', 'staircase', 'airlock', 'circulation', 'hall', 'passage', 'lobby', 'vestibule', 'elevator'],
    color: [0.60, 0.62, 0.65],
    cssColor: '#999ea6',
  },
  {
    label: 'Administrative',
    keywords: ['office', 'meeting', 'conference', 'administration', 'administrative', 'secretariat', 'management'],
    color: [0.82, 0.65, 0.24],
    cssColor: '#d1a63d',
  },
  {
    label: 'Public',
    keywords: ['restaurant', 'retail', 'waiting', 'reception', 'cafeteria', 'shop', 'public', 'commercial', 'canteen', 'lounge'],
    color: [0.24, 0.71, 0.69],
    cssColor: '#3db5b0',
  },
  {
    label: 'Support',
    keywords: ['storage', 'laundry', 'pharmacy', 'sterilisation', 'sterilization', 'changing', 'supply', 'logistics', 'depot', 'archive', 'linen', 'waste', 'cleaning', 'kitchen', 'preparation'],
    color: [0.62, 0.47, 0.32],
    cssColor: '#9e7852',
  },
];

const DEFAULT_COLOR = [0.50, 0.52, 0.55];
const DEFAULT_CSS = '#808590';

/**
 * Returns the category index (0-6) for a function name, or -1 if unmatched.
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
