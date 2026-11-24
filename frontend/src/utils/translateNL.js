/**
 * Dutch/French → English + Arabic translation for campus IFC element names.
 *
 * The campus IFC contains:
 *   - Room names in Dutch/Flemish (from VUB Revit model)
 *   - Element type names in French (Revit FRA installation)
 *   - System labels in French
 *
 * Applied at display time since the XKT model retains original text.
 */

// ─── Dutch Room Names → English + Arabic ─────────────────────────────────────

export const ROOM_TRANSLATIONS = {
  // Work spaces
  'kantoor':                { en: 'Office',                    ar: 'مكتب' },
  'coworking':              { en: 'Coworking Space',           ar: 'مساحة عمل مشتركة' },

  // Meeting & Events
  'seminariezaal':          { en: 'Seminar Room',              ar: 'قاعة ندوات' },
  'seminarie zaal':         { en: 'Seminar Room',              ar: 'قاعة ندوات' },
  'vergaderzaal':           { en: 'Meeting Room',              ar: 'قاعة اجتماعات' },
  'polyvalente ruimte':     { en: 'Multipurpose Room',         ar: 'قاعة متعددة الأغراض' },
  'polyvalent ruimte':      { en: 'Multipurpose Room',         ar: 'قاعة متعددة الأغراض' },

  // Residential
  'studio 1sk':             { en: 'Studio Apartment (1BR)',    ar: 'شقة استوديو (غرفة نوم واحدة)' },

  // Food & Beverage
  'cafe':                   { en: 'Café',                      ar: 'مقهى' },
  'kitchenette':            { en: 'Kitchenette',               ar: 'مطبخ صغير' },

  // Circulation
  'gang':                   { en: 'Corridor',                  ar: 'ممر' },
  'trap':                   { en: 'Staircase',                 ar: 'درج' },
  'trappenhal':             { en: 'Stairwell',                 ar: 'بئر الدرج' },
  'sas':                    { en: 'Vestibule',                 ar: 'ردهة' },

  // Sanitary
  'sanitair':               { en: 'Sanitary Facilities',       ar: 'مرافق صحية' },
  'sanitair / douches':     { en: 'Sanitary / Showers',        ar: 'مرافق صحية / دُش' },
  'sanitair M':             { en: 'Sanitary (Men)',            ar: 'مرافق صحية (رجال)' },
  'sanitair V':             { en: 'Sanitary (Women)',          ar: 'مرافق صحية (نساء)' },
  'douches':                { en: 'Showers',                   ar: 'دُش' },
  'water':                  { en: 'Water / Utility',           ar: 'مياه / مرافق' },

  // Storage & Support
  'berging':                { en: 'Storage Room',              ar: 'غرفة تخزين' },
  'lockers':                { en: 'Locker Room',               ar: 'غرفة خزائن' },
  'lockers + kinderwagen':  { en: 'Lockers & Stroller Parking', ar: 'خزائن ومواقف عربات أطفال' },
  'afvalruimte':            { en: 'Waste Room',                ar: 'غرفة نفايات' },
  'fietsenstalling site':   { en: 'Bicycle Parking',           ar: 'مواقف دراجات' },

  // Technical
  'technieken':             { en: 'Technical Room',            ar: 'غرفة فنية' },
  'tecnieken/data':         { en: 'Technical / Data Room',     ar: 'غرفة فنية / بيانات' },
  'data':                   { en: 'Data Room',                 ar: 'غرفة بيانات' },
  'warmtepomp/ventilatie':  { en: 'Heat Pump / Ventilation',   ar: 'مضخة حرارية / تهوية' },

  // Safety & Security
  'toezicht':               { en: 'Surveillance / Monitoring', ar: 'مراقبة' },
  'controle centrum':       { en: 'Control Centre',            ar: 'مركز التحكم' },
  'ehbo':                   { en: 'First Aid',                 ar: 'إسعافات أولية' },

  // Workshop
  'atelier':                { en: 'Workshop',                  ar: 'ورشة عمل' },
};

// ─── French IFC Element Names → English ──────────────────────────────────────
// Longest-match-first ordering (same pattern as the former translateFR.js).

const FR_EN = [
  // Structural
  ['Dalle béton', 'Concrete Slab'],
  ['Dalle de sol', 'Floor Slab'],
  ['Dalle', 'Slab'],
  ['Béton armé', 'Reinforced Concrete'],
  ['Béton', 'Concrete'],
  ['Fondation', 'Foundation'],
  ['Poteau', 'Column'],
  ['Poutre', 'Beam'],
  ['Plancher', 'Floor'],
  ['Charpente métallique', 'Steel Frame'],
  ['Charpente', 'Roof Structure'],

  // Walls
  ['Mur extérieur', 'Exterior Wall'],
  ['Mur intérieur', 'Interior Wall'],
  ['Mur-rideau', 'Curtain Wall'],
  ['Mur rideau', 'Curtain Wall'],
  ['Mur coupe-feu', 'Firewall'],
  ['Mur de base', 'Base Wall'],
  ['Mur existant', 'Existing Wall'],
  ['Mur', 'Wall'],
  ['Murs', 'Walls'],
  ['Cloison vitrée', 'Glass Partition'],
  ['Cloison', 'Partition'],
  ['Bardage', 'Cladding'],

  // Roofing
  ['Toiture technique', 'Technical Roof'],
  ['Toiture terrasse', 'Flat Roof'],
  ['Toiture', 'Roof'],
  ['Toit de base', 'Base Roof'],
  ['Couvertine', 'Coping'],
  ['Chéneau', 'Gutter'],
  ['Acrotère', 'Parapet'],

  // Openings
  ['Porte coupe-feu', 'Fire Door'],
  ['Porte battante intérieure pleine', 'Interior Solid Swing Door'],
  ['Porte double vitrée', 'Double Glass Door'],
  ['Porte simple pleine', 'Single Solid Door'],
  ['Porte battante', 'Swing Door'],
  ['Porte vitrée', 'Glass Door'],
  ['Porte', 'Door'],
  ['Châssis 2 ouvrants avec imposte', 'Double Casement with Transom'],
  ['Châssis simple oscillo battant', 'Single Tilt-and-Turn'],
  ['Châssis 1 fixe', 'Single Fixed Frame'],
  ['Châssis', 'Frame'],
  ['Vitres inclinées', 'Inclined Glazing'],
  ['Vitrage', 'Glazing'],
  ['Imposte', 'Transom'],
  ['Ouvrant', 'Opening Panel'],
  ['Men. ext.', 'Ext. Joinery'],
  ['Men. int.', 'Int. Joinery'],
  ['Menuiserie', 'Joinery'],
  ['Meneau rectangulaire', 'Rectangular Mullion'],
  ['Meneau', 'Mullion'],

  // Vertical
  ['Escalier secours', 'Emergency Staircase'],
  ['Escalier', 'Staircase'],
  ['Garde-corps', 'Railing'],
  ['Rampe', 'Ramp'],
  ['Main courante', 'Handrail'],
  ['Ascenseur', 'Elevator'],

  // MEP
  ['Alimentation hydraulique', 'Hydraulic Supply'],
  ['Retour hydraulique', 'Hydraulic Return'],
  ['Gaine technique', 'Service Shaft'],
  ['Gaine de ventilation', 'Ventilation Duct'],
  ['Gaine', 'Duct'],
  ['Ventilation', 'Ventilation'],
  ['Plomberie', 'Plumbing'],
  ['Éclairage', 'Lighting'],
  ['Sprinkler', 'Sprinkler'],
  ['Désenfumage', 'Smoke Extraction'],

  // Finishes
  ['Faux-plafond', 'Suspended Ceiling'],
  ['Plafond composé', 'Composite Ceiling'],
  ['Plafond', 'Ceiling'],
  ['Peinture plafond sur enduit', 'Ceiling Paint on Plaster'],
  ['Peinture intérieure sur enduit', 'Interior Paint on Plaster'],
  ['Peinture', 'Paint'],
  ['Enduit', 'Plaster'],
  ['Isolation', 'Insulation'],

  // Campus / Site
  ['Forme directe', 'Direct Forming'],
  ['Arceau vélo', 'Bicycle Rack'],
  ['Table et bancs', 'Table and Benches'],
  ['Banc', 'Bench'],
  ['Mât', 'Pole'],
  ['Lanterne', 'Lantern'],
  ['Projecteur', 'Floodlight'],

  // General
  ['Panneau système', 'System Panel'],
  ['Seuil en pierre', 'Stone Threshold'],
  ['Structure métallique', 'Steel Structure'],
  ['Structure', 'Structure'],
  ['Sol', 'Floor'],
  ['Niveau', 'Level'],
  ['Existant', 'Existing'],
  ['Volume', 'Volume'],
  ['Grille basse façade', 'Low Façade Grille'],
  ['Grille façade', 'Façade Grille'],
  ['Grille', 'Grille'],
  ['Groupe de modèles', 'Model Group'],
  ['Nomenclature', 'Schedule'],
];

// ─── Full name overrides (exact match) ───────────────────────────────────────

const NAME_OVERRIDES = {
  'Volume toiture technique': 'Rooftop',
  'Boîte à lettres - ALUBOX': 'Mailbox',
  'Boîte à lettres': 'Mailbox',
};

// ─── Floor Name Translations ─────────────────────────────────────────────────
// Maps floor_id → { en, ar } for floor selector and labels.

export const FLOOR_NAMES = {
  CAMPUS_SITE: { en: 'Campus – Site Level',              ar: 'الحرم الجامعي – مستوى الموقع' },
  CAMPUS_G:    { en: 'Campus – Ground',                  ar: 'الحرم الجامعي – الطابق الأرضي' },
  CAMPUS_2:    { en: 'Campus – Level 2',                 ar: 'الحرم الجامعي – الطابق الثاني' },
  CC_T:        { en: 'Building CC – Technical',          ar: 'المبنى CC – الطابق الفني' },
  AB_B1:       { en: 'Building AB – Basement',           ar: 'المبنى AB – الطابق السفلي' },
  A_B1:        { en: 'Building A – Basement',            ar: 'المبنى A – الطابق السفلي' },
  C_G:         { en: 'Building C – Ground',              ar: 'المبنى C – الطابق الأرضي' },
  AC_G:        { en: 'Building AC – Ground',             ar: 'المبنى AC – الطابق الأرضي' },
  AC_GF:       { en: 'Building AC – Ground (Finished)',  ar: 'المبنى AC – الطابق الأرضي (مكتمل)' },
  M_G:         { en: 'Building M – Ground',              ar: 'المبنى M – الطابق الأرضي' },
  A_G:         { en: 'Building A – Ground',              ar: 'المبنى A – الطابق الأرضي' },
  AB_G:        { en: 'Building AB – Ground',             ar: 'المبنى AB – الطابق الأرضي' },
  M_AX:        { en: 'Building M – Annex',               ar: 'المبنى M – الملحق' },
  B_G:         { en: 'Building B – Ground',              ar: 'المبنى B – الطابق الأرضي' },
  CC_1:        { en: 'Building CC – Level 1',            ar: 'المبنى CC – الطابق الأول' },
  AC_1:        { en: 'Building AC – Level 1',            ar: 'المبنى AC – الطابق الأول' },
  M_1:         { en: 'Building M – Level 1',             ar: 'المبنى M – الطابق الأول' },
  C_1:         { en: 'Building C – Level 1',             ar: 'المبنى C – الطابق الأول' },
  AB_1:        { en: 'Building AB – Level 1',            ar: 'المبنى AB – الطابق الأول' },
  A_1:         { en: 'Building A – Level 1',             ar: 'المبنى A – الطابق الأول' },
  B_1:         { en: 'Building B – Level 1',             ar: 'المبنى B – الطابق الأول' },
  AC_2:        { en: 'Building AC – Level 2',            ar: 'المبنى AC – الطابق الثاني' },
  A_MZ1:       { en: 'Building A – Mezzanine 1',        ar: 'المبنى A – الميزانين الأول' },
  AB_2:        { en: 'Building AB – Level 2',            ar: 'المبنى AB – الطابق الثاني' },
  C_2:         { en: 'Building C – Level 2',             ar: 'المبنى C – الطابق الثاني' },
  B_2:         { en: 'Building B – Level 2',             ar: 'المبنى B – الطابق الثاني' },
  A_2:         { en: 'Building A – Level 2',             ar: 'المبنى A – الطابق الثاني' },
  A_MZ2:       { en: 'Building A – Mezzanine 2',        ar: 'المبنى A – الميزانين الثاني' },
  C_3:         { en: 'Building C – Level 3',             ar: 'المبنى C – الطابق الثالث' },
  M_R:         { en: 'Building M – Roof',                ar: 'المبنى M – السطح' },
  B_3:         { en: 'Building B – Level 3',             ar: 'المبنى B – الطابق الثالث' },
  A_3:         { en: 'Building A – Level 3',             ar: 'المبنى A – الطابق الثالث' },
  C_4:         { en: 'Building C – Level 4',             ar: 'المبنى C – الطابق الرابع' },
  A_4:         { en: 'Building A – Level 4',             ar: 'المبنى A – الطابق الرابع' },
  A_R:         { en: 'Building A – Roof',                ar: 'المبنى A – السطح' },
};

// ─── Building Groups (for grouped floor selector) ────────────────────────────

export const BUILDING_GROUPS = [
  { id: 'Campus', label: 'Campus',      labelAr: 'الحرم الجامعي', floors: ['CAMPUS_SITE', 'CAMPUS_G', 'CAMPUS_2'] },
  { id: 'B',      label: 'Building B',  labelAr: 'المبنى B',  floors: ['B_G', 'B_1', 'B_2', 'B_3'] },
  { id: 'AB',     label: 'Building AB', labelAr: 'المبنى AB', floors: ['AB_B1', 'AB_G', 'AB_1', 'AB_2'] },
  { id: 'A',      label: 'Building A',  labelAr: 'المبنى A',  floors: ['A_B1', 'A_G', 'A_1', 'A_MZ1', 'A_2', 'A_MZ2', 'A_3', 'A_4', 'A_R'] },
  { id: 'AC',     label: 'Building AC', labelAr: 'المبنى AC', floors: ['AC_G', 'AC_GF', 'AC_1', 'AC_2'] },
  { id: 'C',      label: 'Building C',  labelAr: 'المبنى C',  floors: ['C_G', 'C_1', 'C_2', 'C_3', 'C_4'] },
  { id: 'M',      label: 'Building M',  labelAr: 'المبنى M',  floors: ['M_G', 'M_AX', 'M_1', 'M_R'] },
];

// Floor display order (by elevation)
export const FLOOR_ORDER = [
  'CAMPUS_SITE', 'CAMPUS_G', 'CAMPUS_2',
  'CC_T', 'AB_B1', 'A_B1',
  'C_G', 'AC_G', 'AC_GF', 'M_G', 'A_G', 'AB_G', 'M_AX', 'B_G',
  'CC_1', 'AC_1', 'M_1', 'C_1', 'AB_1', 'A_1', 'B_1',
  'AC_2', 'A_MZ1', 'AB_2', 'C_2', 'B_2', 'A_2',
  'A_MZ2', 'C_3', 'M_R', 'B_3', 'A_3',
  'C_4', 'A_4', 'A_R',
];

// ─── IFC Storey Name → Floor ID Mapping ─────────────────────────────────────
// Maps the raw IFC IfcBuildingStorey.Name to our floor_id system.
// Used by XeokitViewer to build the storey→floor mapping after model load.

export const IFC_STOREY_TO_FLOOR_ID = {
  'NIV CLOS DES MARIES (79,12)': 'CAMPUS_SITE',
  'R00':                          'CAMPUS_G',
  'Niveau 2':                     'CAMPUS_2',
  'BAT_CC_TECH':                  'CC_T',
  'BAT_AB_R-1_Existant':          'AB_B1',
  'BAT_A_R-1':                    'A_B1',
  'BAT_C_R00':                    'C_G',
  'BAT_AC_R00':                   'AC_G',
  'BAT_AC-FINI_R00':              'AC_GF',
  'BAT_M_R00 existant':           'M_G',
  'BAT_A_R00':                    'A_G',
  'BAT_AB_R00':                   'AB_G',
  'BAT_M_Annexe':                 'M_AX',
  'BAT_B_R00':                    'B_G',
  'BAT_CC_R01':                   'CC_1',
  'BAT_AC_R01':                   'AC_1',
  'BAT_M_R01 existant':           'M_1',
  'BAT_C_R01':                    'C_1',
  'BAT_AB_R01':                   'AB_1',
  'BAT_A_R01':                    'A_1',
  'BAT_B_R01':                    'B_1',
  'BAT_AC_R02':                   'AC_2',
  'BAT_A_R01MEZZ':                'A_MZ1',
  'BAT_AB_R02':                   'AB_2',
  'BAT_C_R02':                    'C_2',
  'BAT_B_R02':                    'B_2',
  'BAT_A_R02':                    'A_2',
  'BAT_A_R02MEZZ':                'A_MZ2',
  'BAT_C_R03':                    'C_3',
  'BAT_M_TOITURE existant':       'M_R',
  'BAT_B_R03':                    'B_3',
  'BAT_A_R03':                    'A_3',
  'BAT_C_R04':                    'C_4',
  'BAT_A_R04':                    'A_4',
  'BAT_A_Toiture':                'A_R',
};

// ─── Translation Functions ───────────────────────────────────────────────────

/**
 * Translate a Dutch room name to English + Arabic.
 * Returns { en, ar } or { en: original, ar: original } if not found.
 */
export function translateRoomName(dutchName) {
  if (!dutchName) return { en: dutchName, ar: dutchName };
  const key = dutchName.trim().toLowerCase();

  // Try exact match
  for (const [k, v] of Object.entries(ROOM_TRANSLATIONS)) {
    if (k.toLowerCase() === key) return v;
  }

  // Fallback
  return { en: dutchName, ar: dutchName };
}

/**
 * Translate a French IFC element name/description to English.
 * Checks exact overrides first, then applies partial replacements.
 */
export function translateFR(text) {
  if (!text || text === '--') return text;

  // Exact override
  if (NAME_OVERRIDES[text]) return NAME_OVERRIDES[text];

  let result = text;

  // Apply longest-match-first replacements
  for (const [fr, en] of FR_EN) {
    if (result.includes(fr)) {
      result = result.split(fr).join(en);
    }
  }

  return result;
}

/**
 * Get floor display name with Arabic sub-text.
 * @param {string} floorId - e.g. 'A_G', 'C_1'
 * @returns {{ en: string, ar: string }}
 */
export function getFloorName(floorId) {
  return FLOOR_NAMES[floorId] || { en: floorId, ar: floorId };
}
