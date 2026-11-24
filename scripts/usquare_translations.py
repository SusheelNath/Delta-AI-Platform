"""
USquare Campus — Translation Dictionaries

Dutch (NL) + French (FR) → English (EN) + Arabic (AR)

The USquare IFC has:
  - Room names in Dutch/Flemish (from VUB)
  - IFC system labels and element type names in French (Revit FRA)
  - Architectural terms in French

This module provides translation for all three layers:
  1. Room names (Dutch → English + Arabic)
  2. Function classifications (Dutch room names → English function labels)
  3. IFC element vocabulary (French → English)
"""

# ─── Room Name Translation: Dutch → English + Arabic ──────────────────────────
# Every distinct room name found in the USquare ABC IFC via 'Nom de la pièce'
# property. These are the 33 room types extracted by the analysis script.

ROOM_NAME_NL_EN_AR = {
    # ── Office / Work spaces ──
    "kantoor": {
        "en": "Office",
        "ar": "مكتب",
        "function": "office",
    },
    "coworking": {
        "en": "Coworking Space",
        "ar": "مساحة عمل مشتركة",
        "function": "coworking",
    },

    # ── Meeting / Event spaces ──
    "seminariezaal": {
        "en": "Seminar Room",
        "ar": "قاعة ندوات",
        "function": "seminar_room",
    },
    "seminarie zaal": {
        "en": "Seminar Room",
        "ar": "قاعة ندوات",
        "function": "seminar_room",
    },
    "vergaderzaal": {
        "en": "Meeting Room",
        "ar": "قاعة اجتماعات",
        "function": "meeting_room",
    },
    "polyvalente ruimte": {
        "en": "Multipurpose Room",
        "ar": "قاعة متعددة الأغراض",
        "function": "multipurpose",
    },
    "polyvalent ruimte": {
        "en": "Multipurpose Room",
        "ar": "قاعة متعددة الأغراض",
        "function": "multipurpose",
    },

    # ── Residential / Accommodation ──
    "studio 1sk": {
        "en": "Studio Apartment (1BR)",
        "ar": "شقة استوديو (غرفة نوم واحدة)",
        "function": "studio_apartment",
    },

    # ── Food & Beverage ──
    "cafe": {
        "en": "Café",
        "ar": "مقهى",
        "function": "cafe",
    },
    "kitchenette": {
        "en": "Kitchenette",
        "ar": "مطبخ صغير",
        "function": "kitchenette",
    },

    # ── Circulation ──
    "gang": {
        "en": "Corridor",
        "ar": "ممر",
        "function": "corridor",
    },
    "trap": {
        "en": "Staircase",
        "ar": "درج",
        "function": "staircase",
    },
    "trappenhal": {
        "en": "Stairwell",
        "ar": "بئر الدرج",
        "function": "stairwell",
    },
    "sas": {
        "en": "Vestibule",
        "ar": "ردهة",
        "function": "vestibule",
    },

    # ── Sanitary ──
    "sanitair": {
        "en": "Sanitary Facilities",
        "ar": "مرافق صحية",
        "function": "sanitary",
    },
    "sanitair / douches": {
        "en": "Sanitary / Showers",
        "ar": "مرافق صحية / دُش",
        "function": "sanitary_showers",
    },
    "sanitair M": {
        "en": "Sanitary (Men)",
        "ar": "مرافق صحية (رجال)",
        "function": "sanitary_men",
    },
    "sanitair V": {
        "en": "Sanitary (Women)",
        "ar": "مرافق صحية (نساء)",
        "function": "sanitary_women",
    },
    "douches": {
        "en": "Showers",
        "ar": "دُش",
        "function": "showers",
    },
    "water": {
        "en": "Water / Utility",
        "ar": "مياه / مرافق",
        "function": "utility_water",
    },

    # ── Storage / Support ──
    "berging": {
        "en": "Storage Room",
        "ar": "غرفة تخزين",
        "function": "storage",
    },
    "lockers": {
        "en": "Locker Room",
        "ar": "غرفة خزائن",
        "function": "lockers",
    },
    "lockers + kinderwagen": {
        "en": "Lockers & Stroller Parking",
        "ar": "خزائن ومواقف عربات أطفال",
        "function": "lockers_stroller",
    },
    "afvalruimte": {
        "en": "Waste Room",
        "ar": "غرفة نفايات",
        "function": "waste",
    },
    "fietsenstalling site": {
        "en": "Bicycle Parking",
        "ar": "مواقف دراجات",
        "function": "bicycle_parking",
    },

    # ── Technical / Infrastructure ──
    "technieken": {
        "en": "Technical Room",
        "ar": "غرفة فنية",
        "function": "technical",
    },
    "tecnieken/data": {
        "en": "Technical / Data Room",
        "ar": "غرفة فنية / بيانات",
        "function": "technical_data",
    },
    "data": {
        "en": "Data Room",
        "ar": "غرفة بيانات",
        "function": "data_room",
    },
    "warmtepomp/ventilatie": {
        "en": "Heat Pump / Ventilation",
        "ar": "مضخة حرارية / تهوية",
        "function": "hvac_plant",
    },

    # ── Safety & Security ──
    "toezicht": {
        "en": "Surveillance / Monitoring",
        "ar": "مراقبة",
        "function": "surveillance",
    },
    "controle centrum": {
        "en": "Control Centre",
        "ar": "مركز التحكم",
        "function": "control_centre",
    },
    "ehbo": {
        "en": "First Aid",
        "ar": "إسعافات أولية",
        "function": "first_aid",
    },

    # ── Workshop / Creative ──
    "atelier": {
        "en": "Workshop",
        "ar": "ورشة عمل",
        "function": "workshop",
    },
}


# ─── Function Categories ──────────────────────────────────────────────────────
# Maps function labels to categories for the UI color scheme and filtering.
# Replaces the hospital-centric categories with office-campus categories.

FUNCTION_CATEGORIES = {
    # Work
    "office":            {"category": "work",          "label": "Office",                "label_ar": "مكتب"},
    "coworking":         {"category": "work",          "label": "Coworking",             "label_ar": "عمل مشترك"},
    "studio_apartment":  {"category": "residential",   "label": "Studio Apartment",      "label_ar": "شقة استوديو"},

    # Meeting & Events
    "seminar_room":      {"category": "meeting",       "label": "Seminar Room",          "label_ar": "قاعة ندوات"},
    "meeting_room":      {"category": "meeting",       "label": "Meeting Room",          "label_ar": "قاعة اجتماعات"},
    "multipurpose":      {"category": "meeting",       "label": "Multipurpose Room",     "label_ar": "قاعة متعددة الأغراض"},

    # Food & Beverage
    "cafe":              {"category": "amenity",       "label": "Café",                  "label_ar": "مقهى"},
    "kitchenette":       {"category": "amenity",       "label": "Kitchenette",           "label_ar": "مطبخ صغير"},

    # Circulation
    "corridor":          {"category": "circulation",   "label": "Corridor",              "label_ar": "ممر"},
    "staircase":         {"category": "circulation",   "label": "Staircase",             "label_ar": "درج"},
    "stairwell":         {"category": "circulation",   "label": "Stairwell",             "label_ar": "بئر الدرج"},
    "vestibule":         {"category": "circulation",   "label": "Vestibule",             "label_ar": "ردهة"},

    # Sanitary
    "sanitary":          {"category": "sanitary",      "label": "Sanitary Facilities",   "label_ar": "مرافق صحية"},
    "sanitary_showers":  {"category": "sanitary",      "label": "Sanitary / Showers",    "label_ar": "مرافق صحية / دُش"},
    "sanitary_men":      {"category": "sanitary",      "label": "Sanitary (Men)",        "label_ar": "مرافق صحية (رجال)"},
    "sanitary_women":    {"category": "sanitary",      "label": "Sanitary (Women)",      "label_ar": "مرافق صحية (نساء)"},
    "showers":           {"category": "sanitary",      "label": "Showers",               "label_ar": "دُش"},
    "utility_water":     {"category": "sanitary",      "label": "Water / Utility",       "label_ar": "مياه / مرافق"},

    # Storage & Support
    "storage":           {"category": "support",       "label": "Storage Room",          "label_ar": "غرفة تخزين"},
    "lockers":           {"category": "support",       "label": "Locker Room",           "label_ar": "غرفة خزائن"},
    "lockers_stroller":  {"category": "support",       "label": "Lockers & Strollers",   "label_ar": "خزائن وعربات أطفال"},
    "waste":             {"category": "support",       "label": "Waste Room",            "label_ar": "غرفة نفايات"},
    "bicycle_parking":   {"category": "support",       "label": "Bicycle Parking",       "label_ar": "مواقف دراجات"},

    # Technical / Infrastructure
    "technical":         {"category": "technical",     "label": "Technical Room",        "label_ar": "غرفة فنية"},
    "technical_data":    {"category": "technical",     "label": "Technical / Data",      "label_ar": "فنية / بيانات"},
    "data_room":         {"category": "technical",     "label": "Data Room",             "label_ar": "غرفة بيانات"},
    "hvac_plant":        {"category": "technical",     "label": "HVAC Plant",            "label_ar": "معدات التدفئة والتهوية"},

    # Safety & Security
    "surveillance":      {"category": "security",      "label": "Surveillance",          "label_ar": "مراقبة"},
    "control_centre":    {"category": "security",      "label": "Control Centre",        "label_ar": "مركز التحكم"},
    "first_aid":         {"category": "security",      "label": "First Aid",             "label_ar": "إسعافات أولية"},

    # Workshop / Creative
    "workshop":          {"category": "creative",      "label": "Workshop",              "label_ar": "ورشة عمل"},
}

# Category definitions with colors (for frontend colorScheme.js)
CATEGORY_DEFINITIONS = {
    "work":        {"label": "Work Spaces",          "label_ar": "مساحات العمل"},
    "residential": {"label": "Residential",          "label_ar": "سكني"},
    "meeting":     {"label": "Meeting & Events",     "label_ar": "الاجتماعات والفعاليات"},
    "amenity":     {"label": "Amenities",            "label_ar": "المرافق"},
    "circulation": {"label": "Circulation",          "label_ar": "الحركة والتنقل"},
    "sanitary":    {"label": "Sanitary",             "label_ar": "صحي"},
    "support":     {"label": "Support & Storage",    "label_ar": "الدعم والتخزين"},
    "technical":   {"label": "Technical",            "label_ar": "فني"},
    "security":    {"label": "Safety & Security",    "label_ar": "السلامة والأمن"},
    "creative":    {"label": "Workshop & Creative",  "label_ar": "ورش العمل والإبداع"},
}


# ─── IFC Element Vocabulary: French → English ─────────────────────────────────
# The IFC system labels and Revit element type names are in French.
# This replaces the hospital-specific translateFR.js vocabulary.
# Longest-match-first ordering (same pattern as existing translateFR.js).

FR_EN_IFC_VOCAB = [
    # Structural
    ["Dalle béton", "Concrete Slab"],
    ["Dalle de sol", "Floor Slab"],
    ["Dalle", "Slab"],
    ["Béton armé", "Reinforced Concrete"],
    ["Béton", "Concrete"],
    ["Fondation", "Foundation"],
    ["Semelle", "Footing"],
    ["Poteau", "Column"],
    ["Poutre", "Beam"],
    ["Plancher", "Floor"],
    ["Radier", "Raft Foundation"],
    ["Prédalle", "Precast Slab"],
    ["Préfabriqué", "Prefabricated"],
    ["Charpente métallique", "Steel Frame"],
    ["Charpente", "Roof Structure"],

    # Walls & Partitions
    ["Mur extérieur", "Exterior Wall"],
    ["Mur intérieur", "Interior Wall"],
    ["Mur rideau", "Curtain Wall"],
    ["Mur-rideau", "Curtain Wall"],
    ["Mur de soutènement", "Retaining Wall"],
    ["Mur porteur", "Load-bearing Wall"],
    ["Mur en béton", "Concrete Wall"],
    ["Mur coupe-feu", "Firewall"],
    ["Mur de base", "Base Wall"],
    ["Mur existant", "Existing Wall"],
    ["Mur", "Wall"],
    ["Murs", "Walls"],
    ["Cloison intérieure", "Interior Partition"],
    ["Cloison vitrée", "Glass Partition"],
    ["Cloison", "Partition"],
    ["Paroi", "Panel"],
    ["Voile béton", "Concrete Shear Wall"],
    ["Voile", "Shear Wall"],
    ["Bardage", "Cladding"],

    # Roofing
    ["Toiture technique", "Technical Roof"],
    ["Toiture terrasse", "Flat Roof"],
    ["Toiture végétalisée", "Green Roof"],
    ["Toiture", "Roof"],
    ["Toit de base", "Base Roof"],
    ["Couverture", "Roofing"],
    ["Couvertine", "Coping"],
    ["Étanchéité", "Waterproofing"],
    ["Acrotère", "Parapet"],
    ["Chéneau", "Gutter"],

    # Openings
    ["Porte coupe-feu", "Fire Door"],
    ["Porte coulissante", "Sliding Door"],
    ["Porte battante", "Swing Door"],
    ["Porte vitrée", "Glass Door"],
    ["Porte double vitrée", "Double Glass Door"],
    ["Porte double", "Double Door"],
    ["Porte simple pleine", "Single Solid Door"],
    ["Porte simple", "Single Door"],
    ["Porte", "Door"],
    ["Fenêtre", "Window"],
    ["Châssis", "Frame"],
    ["Vitrage", "Glazing"],
    ["Vitres inclinées", "Inclined Glazing"],
    ["Imposte", "Transom"],
    ["Ouvrant", "Opening Panel"],
    ["Menuiserie extérieure", "External Joinery"],
    ["Menuiserie intérieure", "Internal Joinery"],
    ["Menuiserie", "Joinery"],
    ["Men. ext.", "Ext. Joinery"],
    ["Men. int.", "Int. Joinery"],

    # Stairs & Vertical
    ["Escalier secours", "Emergency Staircase"],
    ["Escalier", "Staircase"],
    ["Garde-corps", "Railing"],
    ["Rampe", "Ramp"],
    ["Marche", "Step"],
    ["Palier", "Landing"],
    ["Contremarche", "Riser"],
    ["Main courante", "Handrail"],
    ["Ascenseur", "Elevator"],
    ["Trémie", "Shaft Opening"],

    # MEP / Technical
    ["Gaine technique", "Service Shaft"],
    ["Gaine de ventilation", "Ventilation Duct"],
    ["Gaine", "Duct"],
    ["Conduit", "Duct"],
    ["Tuyau", "Pipe"],
    ["Canalisation", "Piping"],
    ["Ventilation", "Ventilation"],
    ["Climatisation", "Air Conditioning"],
    ["Chauffage", "Heating"],
    ["Plomberie", "Plumbing"],
    ["Électricité", "Electrical"],
    ["Éclairage", "Lighting"],
    ["Sprinkler", "Sprinkler"],
    ["Désenfumage", "Smoke Extraction"],
    ["Groupe électrogène", "Generator"],
    ["Tableau électrique", "Electrical Panel"],
    ["Transformateur", "Transformer"],
    ["Alimentation hydraulique", "Hydraulic Supply"],
    ["Retour hydraulique", "Hydraulic Return"],
    ["Warmtepomp", "Heat Pump"],

    # Finishes
    ["Faux-plafond", "Suspended Ceiling"],
    ["Faux plafond", "Suspended Ceiling"],
    ["Plafond composé", "Composite Ceiling"],
    ["Plafond suspendu", "Suspended Ceiling"],
    ["Plafond", "Ceiling"],
    ["Revêtement de sol", "Floor Covering"],
    ["Revêtement mural", "Wall Covering"],
    ["Revêtement", "Covering"],
    ["Carrelage", "Tiling"],
    ["Peinture", "Paint"],
    ["Enduit", "Plaster"],
    ["Isolation", "Insulation"],
    ["Isolant", "Insulation"],

    # Fire safety
    ["Compartimentage", "Fire Compartmentation"],
    ["Coupe-feu", "Fire-rated"],
    ["Protection incendie", "Fire Protection"],

    # Campus-specific (from SITE model)
    ["Forme directe", "Direct Forming"],
    ["Massif drainant", "Drainage Bed"],
    ["Arceau vélo", "Bicycle Rack"],
    ["Table et bancs", "Table and Benches"],
    ["Banc", "Bench"],
    ["Mât", "Pole"],
    ["Lanterne", "Lantern"],
    ["Projecteur", "Floodlight"],

    # General construction
    ["Structure métallique", "Steel Structure"],
    ["Structure", "Structure"],
    ["Panneau système", "System Panel"],
    ["Profil", "Profile"],
    ["Seuil en pierre", "Stone Threshold"],
    ["Sol", "Floor"],
    ["Niveau", "Level"],
    ["Existant", "Existing"],
    ["Neuf", "New"],
    ["Volume", "Volume"],
    ["Nomenclature", "Schedule"],
    ["Groupe de modèles", "Model Group"],
    ["Grille", "Grille"],
    ["Meneau", "Mullion"],
]


# ─── Service Code Translations (Office Campus) ───────────────────────────────
# Replaces hospital service codes (QOP, MA1, URG, etc.)
# These map building zones and department types for USquare.

SERVICE_CODES = {
    # Building zones
    "BAT_A":  {"en": "Building A",        "ar": "المبنى A",    "type": "building"},
    "BAT_B":  {"en": "Building B",        "ar": "المبنى B",    "type": "building"},
    "BAT_C":  {"en": "Building C",        "ar": "المبنى C",    "type": "building"},
    "BAT_AB": {"en": "Building AB",       "ar": "المبنى AB",   "type": "building"},
    "BAT_AC": {"en": "Building AC",       "ar": "المبنى AC",   "type": "building"},
    "BAT_CC": {"en": "Building CC",       "ar": "المبنى CC",   "type": "building"},
    "BAT_M":  {"en": "Building M",        "ar": "المبنى M",    "type": "building"},

    # Functional departments
    "ADM":  {"en": "Administration",       "ar": "الإدارة",           "type": "department"},
    "OPS":  {"en": "Operations",           "ar": "العمليات",          "type": "department"},
    "SEC":  {"en": "Security",             "ar": "الأمن",             "type": "department"},
    "FAC":  {"en": "Facilities Management","ar": "إدارة المرافق",     "type": "department"},
    "ICT":  {"en": "IT & Communications",  "ar": "تقنية المعلومات والاتصالات", "type": "department"},
    "EVT":  {"en": "Events & Conferences", "ar": "الفعاليات والمؤتمرات", "type": "department"},
    "F&B":  {"en": "Food & Beverage",      "ar": "الأغذية والمشروبات", "type": "department"},
    "RES":  {"en": "Residential",          "ar": "سكني",              "type": "department"},
    "MNT":  {"en": "Maintenance",          "ar": "الصيانة",           "type": "department"},
    "HSE":  {"en": "Health, Safety & Environment", "ar": "الصحة والسلامة والبيئة", "type": "department"},
}


def translate_room_name(dutch_name):
    """Translate a Dutch room name to English + Arabic."""
    entry = ROOM_NAME_NL_EN_AR.get(dutch_name.strip().lower())
    if entry:
        return entry["en"], entry["ar"], entry["function"]

    # Try case-insensitive match
    for key, val in ROOM_NAME_NL_EN_AR.items():
        if key.lower() == dutch_name.strip().lower():
            return val["en"], val["ar"], val["function"]

    # Fallback: return original with unknown function
    return dutch_name, dutch_name, "unknown"


def translate_ifc_element(french_text):
    """Translate a French IFC element name to English."""
    if not french_text:
        return french_text
    result = french_text
    for fr, en in FR_EN_IFC_VOCAB:
        if fr in result:
            result = result.replace(fr, en)
    return result


if __name__ == "__main__":
    print("=== Room Name Translations ===")
    for nl, data in ROOM_NAME_NL_EN_AR.items():
        print(f"  {nl:<30s} → {data['en']:<30s} | {data['ar']}")

    print(f"\n=== Function Categories ({len(FUNCTION_CATEGORIES)}) ===")
    for func, cat in FUNCTION_CATEGORIES.items():
        print(f"  {func:<20s} [{cat['category']:<12s}] {cat['label']:<25s} | {cat['label_ar']}")

    print(f"\n=== IFC Vocabulary ({len(FR_EN_IFC_VOCAB)} terms) ===")
    for fr, en in FR_EN_IFC_VOCAB[:10]:
        print(f"  {fr:<30s} → {en}")
    print(f"  ... and {len(FR_EN_IFC_VOCAB) - 10} more")
