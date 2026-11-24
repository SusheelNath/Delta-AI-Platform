"""
USquare Campus — Floor Definitions & Naming Scheme

Merged from 4 IFC files (SITE, ABC_ARCH, M_ARCH, ABC_MEP).
Human-readable naming for non-engineer teams.

Naming convention:
  floor_id:     {building}_{level}   e.g. "A_G", "AB_B1", "C_3"
  display_name: "Building {X} – {Level}"
  arabic_name:  Arabic sub-text equivalent

Buildings: A, B, C, AB, AC, CC, M, CAMPUS (site)
Levels:    B1 (basement), G (ground), 1–4, MZ1/MZ2 (mezzanine), R (roof), T (technical)
"""

# ─── Unified Floor Definitions ────────────────────────────────────────────────
# Sorted by elevation (ascending). Elevations in cm from IFC datum.

FLOOR_DEFINITIONS = {
    # ── Campus / Site ──
    "CAMPUS_SITE": {
        "name": "Campus – Site Level",
        "name_ar": "الحرم الجامعي – مستوى الموقع",
        "building": "Campus",
        "building_ar": "الحرم الجامعي",
        "level": "Site",
        "level_ar": "الموقع",
        "level_index": -10,
        "elevation_cm": -323,
        "ifc_storey_name": "NIV CLOS DES MARIES (79,12)",
        "ifc_source": "SITE",
        "description": "Campus site level, landscape, drainage infrastructure",
        "description_ar": "مستوى موقع الحرم الجامعي، المناظر الطبيعية، البنية التحتية للصرف",
    },
    "CAMPUS_G": {
        "name": "Campus – Ground",
        "name_ar": "الحرم الجامعي – الطابق الأرضي",
        "building": "Campus",
        "building_ar": "الحرم الجامعي",
        "level": "Ground",
        "level_ar": "الطابق الأرضي",
        "level_index": 0,
        "elevation_cm": 0,
        "ifc_storey_name": "R00",
        "ifc_source": "SITE",
        "description": "Campus ground level, outdoor areas, bike parking, street furniture",
        "description_ar": "الطابق الأرضي للحرم، المناطق الخارجية، مواقف الدراجات، الأثاث الحضري",
    },
    "CAMPUS_2": {
        "name": "Campus – Level 2",
        "name_ar": "الحرم الجامعي – الطابق الثاني",
        "building": "Campus",
        "building_ar": "الحرم الجامعي",
        "level": "Level 2",
        "level_ar": "الطابق الثاني",
        "level_index": 2,
        "elevation_cm": 400,
        "ifc_storey_name": "Niveau 2",
        "ifc_source": "SITE",
        "description": "Campus elevated level, elevated walkways and site connections",
        "description_ar": "المستوى المرتفع للحرم، الممرات المرتفعة وروابط الموقع",
    },

    # ── CC Technical ──
    "CC_T": {
        "name": "Building CC – Technical",
        "name_ar": "المبنى CC – الطابق الفني",
        "building": "CC",
        "building_ar": "المبنى CC",
        "level": "Technical",
        "level_ar": "الطابق الفني",
        "level_index": -2,
        "elevation_cm": 8000,
        "ifc_storey_name": "BAT_CC_TECH",
        "ifc_source": "ABC_MEP",
        "description": "CC technical basement, MEP plant rooms, utilities",
        "description_ar": "الطابق السفلي الفني لـ CC، غرف المعدات الميكانيكية والكهربائية، المرافق",
    },

    # ── Basements ──
    "AB_B1": {
        "name": "Building AB – Basement",
        "name_ar": "المبنى AB – الطابق السفلي",
        "building": "AB",
        "building_ar": "المبنى AB",
        "level": "Basement",
        "level_ar": "الطابق السفلي",
        "level_index": -1,
        "elevation_cm": 8002,
        "ifc_storey_name": "BAT_AB_R-1_Existant",
        "ifc_source": "ABC_ARCH",
        "description": "AB basement, existing structure, storage and services",
        "description_ar": "الطابق السفلي لـ AB، الهيكل القائم، التخزين والخدمات",
    },
    "A_B1": {
        "name": "Building A – Basement",
        "name_ar": "المبنى A – الطابق السفلي",
        "building": "A",
        "building_ar": "المبنى A",
        "level": "Basement",
        "level_ar": "الطابق السفلي",
        "level_index": -1,
        "elevation_cm": 8114,
        "ifc_storey_name": "BAT_A_R-1",
        "ifc_source": "ABC_ARCH",
        "description": "Building A basement, services and infrastructure",
        "description_ar": "الطابق السفلي للمبنى A، الخدمات والبنية التحتية",
    },

    # ── Ground Floors ──
    "C_G": {
        "name": "Building C – Ground",
        "name_ar": "المبنى C – الطابق الأرضي",
        "building": "C",
        "building_ar": "المبنى C",
        "level": "Ground",
        "level_ar": "الطابق الأرضي",
        "level_index": 0,
        "elevation_cm": 8202,
        "ifc_storey_name": "BAT_C_R00",
        "ifc_source": "ABC_ARCH",
        "description": "Technical rooms, staircases, sanitary facilities, first aid, data rooms, surveillance",
        "description_ar": "الغرف الفنية، السلالم، المرافق الصحية، الإسعافات الأولية، غرف البيانات، المراقبة",
    },
    "AC_G": {
        "name": "Building AC – Ground",
        "name_ar": "المبنى AC – الطابق الأرضي",
        "building": "AC",
        "building_ar": "المبنى AC",
        "level": "Ground",
        "level_ar": "الطابق الأرضي",
        "level_index": 0,
        "elevation_cm": 8206,
        "ifc_storey_name": "BAT_AC_R00",
        "ifc_source": "ABC_ARCH",
        "description": "Multipurpose spaces, storage, technical rooms",
        "description_ar": "المساحات متعددة الأغراض، التخزين، الغرف الفنية",
    },
    "AC_GF": {
        "name": "Building AC – Ground (Finished)",
        "name_ar": "المبنى AC – الطابق الأرضي (مكتمل)",
        "building": "AC",
        "building_ar": "المبنى AC",
        "level": "Ground (Finished)",
        "level_ar": "الطابق الأرضي (مكتمل)",
        "level_index": 0,
        "elevation_cm": 8211,
        "ifc_storey_name": "BAT_AC-FINI_R00",
        "ifc_source": "ABC_ARCH",
        "description": "AC ground floor finished fit-out level",
        "description_ar": "مستوى التشطيب النهائي للطابق الأرضي لـ AC",
    },
    "M_G": {
        "name": "Building M – Ground",
        "name_ar": "المبنى M – الطابق الأرضي",
        "building": "M",
        "building_ar": "المبنى M",
        "level": "Ground",
        "level_ar": "الطابق الأرضي",
        "level_index": 0,
        "elevation_cm": 8223,
        "ifc_storey_name": "BAT_M_R00 existant",
        "ifc_source": "M_ARCH",
        "description": "Building M ground floor, shell/casco (unfinished interior)",
        "description_ar": "الطابق الأرضي للمبنى M، هيكل خارجي (داخلي غير مكتمل)",
    },
    "A_G": {
        "name": "Building A – Ground",
        "name_ar": "المبنى A – الطابق الأرضي",
        "building": "A",
        "building_ar": "المبنى A",
        "level": "Ground",
        "level_ar": "الطابق الأرضي",
        "level_index": 0,
        "elevation_cm": 8244,
        "ifc_storey_name": "BAT_A_R00",
        "ifc_source": "ABC_ARCH",
        "description": "Main campus hub: café, seminar rooms, offices, bike parking, sanitary, corridors, surveillance",
        "description_ar": "المحور الرئيسي للحرم: مقهى، قاعات ندوات، مكاتب، مواقف دراجات، مرافق صحية، ممرات، مراقبة",
    },
    "AB_G": {
        "name": "Building AB – Ground",
        "name_ar": "المبنى AB – الطابق الأرضي",
        "building": "AB",
        "building_ar": "المبنى AB",
        "level": "Ground",
        "level_ar": "الطابق الأرضي",
        "level_index": 0,
        "elevation_cm": 8274,
        "ifc_storey_name": "BAT_AB_R00",
        "ifc_source": "ABC_ARCH",
        "description": "Multipurpose spaces, seminar room, café, sanitary, technical rooms",
        "description_ar": "المساحات متعددة الأغراض، قاعة ندوات، مقهى، مرافق صحية، غرف فنية",
    },
    "M_AX": {
        "name": "Building M – Annex",
        "name_ar": "المبنى M – الملحق",
        "building": "M",
        "building_ar": "المبنى M",
        "level": "Annex",
        "level_ar": "الملحق",
        "level_index": 0,
        "elevation_cm": 8278,
        "ifc_storey_name": "BAT_M_Annexe",
        "ifc_source": "ABC_MEP",
        "description": "Building M annex, MEP services extension",
        "description_ar": "ملحق المبنى M، توسعة خدمات الميكانيكية والكهربائية",
    },
    "B_G": {
        "name": "Building B – Ground",
        "name_ar": "المبنى B – الطابق الأرضي",
        "building": "B",
        "building_ar": "المبنى B",
        "level": "Ground",
        "level_ar": "الطابق الأرضي",
        "level_index": 0,
        "elevation_cm": 8329,
        "ifc_storey_name": "BAT_B_R00",
        "ifc_source": "ABC_ARCH",
        "description": "Lockers, stroller parking, vestibules",
        "description_ar": "خزائن، مواقف عربات الأطفال، ردهات",
    },

    # ── Level 1 ──
    "CC_1": {
        "name": "Building CC – Level 1",
        "name_ar": "المبنى CC – الطابق الأول",
        "building": "CC",
        "building_ar": "المبنى CC",
        "level": "Level 1",
        "level_ar": "الطابق الأول",
        "level_index": 1,
        "elevation_cm": 8500,
        "ifc_storey_name": "BAT_CC_R01",
        "ifc_source": "ABC_ARCH",
        "description": "CC first floor",
        "description_ar": "الطابق الأول لـ CC",
    },
    "AC_1": {
        "name": "Building AC – Level 1",
        "name_ar": "المبنى AC – الطابق الأول",
        "building": "AC",
        "building_ar": "المبنى AC",
        "level": "Level 1",
        "level_ar": "الطابق الأول",
        "level_index": 1,
        "elevation_cm": 8541,
        "ifc_storey_name": "BAT_AC_R01",
        "ifc_source": "ABC_ARCH",
        "description": "Multipurpose spaces, storage",
        "description_ar": "المساحات متعددة الأغراض، التخزين",
    },
    "M_1": {
        "name": "Building M – Level 1",
        "name_ar": "المبنى M – الطابق الأول",
        "building": "M",
        "building_ar": "المبنى M",
        "level": "Level 1",
        "level_ar": "الطابق الأول",
        "level_index": 1,
        "elevation_cm": 8631,
        "ifc_storey_name": "BAT_M_R01 existant",
        "ifc_source": "M_ARCH",
        "description": "Building M first floor, shell/casco (unfinished interior)",
        "description_ar": "الطابق الأول للمبنى M، هيكل خارجي (داخلي غير مكتمل)",
    },
    "C_1": {
        "name": "Building C – Level 1",
        "name_ar": "المبنى C – الطابق الأول",
        "building": "C",
        "building_ar": "المبنى C",
        "level": "Level 1",
        "level_ar": "الطابق الأول",
        "level_index": 1,
        "elevation_cm": 8621,
        "ifc_storey_name": "BAT_C_R01",
        "ifc_source": "ABC_ARCH",
        "description": "Control centre, workshops, kitchenettes, waste rooms",
        "description_ar": "مركز التحكم، ورش العمل، المطابخ الصغيرة، غرف النفايات",
    },
    "AB_1": {
        "name": "Building AB – Level 1",
        "name_ar": "المبنى AB – الطابق الأول",
        "building": "AB",
        "building_ar": "المبنى AB",
        "level": "Level 1",
        "level_ar": "الطابق الأول",
        "level_index": 1,
        "elevation_cm": 8700,
        "ifc_storey_name": "BAT_AB_R01",
        "ifc_source": "ABC_ARCH",
        "description": "Seminar rooms, coworking, multipurpose, technical rooms",
        "description_ar": "قاعات ندوات، مساحات عمل مشتركة، متعددة الأغراض، غرف فنية",
    },
    "A_1": {
        "name": "Building A – Level 1",
        "name_ar": "المبنى A – الطابق الأول",
        "building": "A",
        "building_ar": "المبنى A",
        "level": "Level 1",
        "level_ar": "الطابق الأول",
        "level_index": 1,
        "elevation_cm": 8735,
        "ifc_storey_name": "BAT_A_R01",
        "ifc_source": "ABC_ARCH",
        "description": "Studios, meeting rooms, offices, café, surveillance, sanitary",
        "description_ar": "استوديوهات، قاعات اجتماعات، مكاتب، مقهى، مراقبة، مرافق صحية",
    },
    "B_1": {
        "name": "Building B – Level 1",
        "name_ar": "المبنى B – الطابق الأول",
        "building": "B",
        "building_ar": "المبنى B",
        "level": "Level 1",
        "level_ar": "الطابق الأول",
        "level_index": 1,
        "elevation_cm": 8794,
        "ifc_storey_name": "BAT_B_R01",
        "ifc_source": "ABC_ARCH",
        "description": "Building B first floor",
        "description_ar": "الطابق الأول للمبنى B",
    },

    # ── Level 2 ──
    "AC_2": {
        "name": "Building AC – Level 2",
        "name_ar": "المبنى AC – الطابق الثاني",
        "building": "AC",
        "building_ar": "المبنى AC",
        "level": "Level 2",
        "level_ar": "الطابق الثاني",
        "level_index": 2,
        "elevation_cm": 8933,
        "ifc_storey_name": "BAT_AC_R02",
        "ifc_source": "ABC_ARCH",
        "description": "AC second floor",
        "description_ar": "الطابق الثاني لـ AC",
    },
    "A_MZ1": {
        "name": "Building A – Mezzanine 1",
        "name_ar": "المبنى A – الميزانين الأول",
        "building": "A",
        "building_ar": "المبنى A",
        "level": "Mezzanine 1",
        "level_ar": "الميزانين الأول",
        "level_index": 1.5,
        "elevation_cm": 8990,
        "ifc_storey_name": "BAT_A_R01MEZZ",
        "ifc_source": "ABC_ARCH",
        "description": "Studio apartments, mezzanine level between floors 1 and 2",
        "description_ar": "شقق استوديو، مستوى الميزانين بين الطابقين الأول والثاني",
    },
    "AB_2": {
        "name": "Building AB – Level 2",
        "name_ar": "المبنى AB – الطابق الثاني",
        "building": "AB",
        "building_ar": "المبنى AB",
        "level": "Level 2",
        "level_ar": "الطابق الثاني",
        "level_index": 2,
        "elevation_cm": 9030,
        "ifc_storey_name": "BAT_AB_R02",
        "ifc_source": "ABC_ARCH",
        "description": "AB second floor",
        "description_ar": "الطابق الثاني لـ AB",
    },
    "C_2": {
        "name": "Building C – Level 2",
        "name_ar": "المبنى C – الطابق الثاني",
        "building": "C",
        "building_ar": "المبنى C",
        "level": "Level 2",
        "level_ar": "الطابق الثاني",
        "level_index": 2,
        "elevation_cm": 9076,
        "ifc_storey_name": "BAT_C_R02",
        "ifc_source": "ABC_ARCH",
        "description": "C second floor",
        "description_ar": "الطابق الثاني لـ C",
    },
    "B_2": {
        "name": "Building B – Level 2",
        "name_ar": "المبنى B – الطابق الثاني",
        "building": "B",
        "building_ar": "المبنى B",
        "level": "Level 2",
        "level_ar": "الطابق الثاني",
        "level_index": 2,
        "elevation_cm": 9249,
        "ifc_storey_name": "BAT_B_R02",
        "ifc_source": "ABC_ARCH",
        "description": "B second floor",
        "description_ar": "الطابق الثاني لـ B",
    },
    "A_2": {
        "name": "Building A – Level 2",
        "name_ar": "المبنى A – الطابق الثاني",
        "building": "A",
        "building_ar": "المبنى A",
        "level": "Level 2",
        "level_ar": "الطابق الثاني",
        "level_index": 2,
        "elevation_cm": 9260,
        "ifc_storey_name": "BAT_A_R02",
        "ifc_source": "ABC_ARCH",
        "description": "Studio apartments",
        "description_ar": "شقق استوديو",
    },
    "A_MZ2": {
        "name": "Building A – Mezzanine 2",
        "name_ar": "المبنى A – الميزانين الثاني",
        "building": "A",
        "building_ar": "المبنى A",
        "level": "Mezzanine 2",
        "level_ar": "الميزانين الثاني",
        "level_index": 2.5,
        "elevation_cm": 9514,
        "ifc_storey_name": "BAT_A_R02MEZZ",
        "ifc_source": "ABC_ARCH",
        "description": "Studio apartments, mezzanine level between floors 2 and 3",
        "description_ar": "شقق استوديو، مستوى الميزانين بين الطابقين الثاني والثالث",
    },

    # ── Level 3 ──
    "C_3": {
        "name": "Building C – Level 3",
        "name_ar": "المبنى C – الطابق الثالث",
        "building": "C",
        "building_ar": "المبنى C",
        "level": "Level 3",
        "level_ar": "الطابق الثالث",
        "level_index": 3,
        "elevation_cm": 9531,
        "ifc_storey_name": "BAT_C_R03",
        "ifc_source": "ABC_ARCH",
        "description": "C third floor",
        "description_ar": "الطابق الثالث لـ C",
    },
    "M_R": {
        "name": "Building M – Roof",
        "name_ar": "المبنى M – السطح",
        "building": "M",
        "building_ar": "المبنى M",
        "level": "Roof",
        "level_ar": "السطح",
        "level_index": 99,
        "elevation_cm": 9621,
        "ifc_storey_name": "BAT_M_TOITURE existant",
        "ifc_source": "M_ARCH",
        "description": "Building M roof, existing structure",
        "description_ar": "سطح المبنى M، الهيكل القائم",
    },
    "B_3": {
        "name": "Building B – Level 3",
        "name_ar": "المبنى B – الطابق الثالث",
        "building": "B",
        "building_ar": "المبنى B",
        "level": "Level 3",
        "level_ar": "الطابق الثالث",
        "level_index": 3,
        "elevation_cm": 9704,
        "ifc_storey_name": "BAT_B_R03",
        "ifc_source": "ABC_ARCH",
        "description": "B third floor",
        "description_ar": "الطابق الثالث لـ B",
    },
    "A_3": {
        "name": "Building A – Level 3",
        "name_ar": "المبنى A – الطابق الثالث",
        "building": "A",
        "building_ar": "المبنى A",
        "level": "Level 3",
        "level_ar": "الطابق الثالث",
        "level_index": 3,
        "elevation_cm": 9786,
        "ifc_storey_name": "BAT_A_R03",
        "ifc_source": "ABC_ARCH",
        "description": "A third floor",
        "description_ar": "الطابق الثالث لـ A",
    },

    # ── Level 4 ──
    "C_4": {
        "name": "Building C – Level 4",
        "name_ar": "المبنى C – الطابق الرابع",
        "building": "C",
        "building_ar": "المبنى C",
        "level": "Level 4",
        "level_ar": "الطابق الرابع",
        "level_index": 4,
        "elevation_cm": 9830,
        "ifc_storey_name": "BAT_C_R04",
        "ifc_source": "ABC_ARCH",
        "description": "C fourth floor",
        "description_ar": "الطابق الرابع لـ C",
    },
    "A_4": {
        "name": "Building A – Level 4",
        "name_ar": "المبنى A – الطابق الرابع",
        "building": "A",
        "building_ar": "المبنى A",
        "level": "Level 4",
        "level_ar": "الطابق الرابع",
        "level_index": 4,
        "elevation_cm": 10161,
        "ifc_storey_name": "BAT_A_R04",
        "ifc_source": "ABC_ARCH",
        "description": "A fourth floor",
        "description_ar": "الطابق الرابع لـ A",
    },

    # ── Roofs ──
    "A_R": {
        "name": "Building A – Roof",
        "name_ar": "المبنى A – السطح",
        "building": "A",
        "building_ar": "المبنى A",
        "level": "Roof",
        "level_ar": "السطح",
        "level_index": 99,
        "elevation_cm": 10986,
        "ifc_storey_name": "BAT_A_Toiture",
        "ifc_source": "ABC_ARCH",
        "description": "Building A roof, technical plant, solar, rooftop services",
        "description_ar": "سطح المبنى A، المعدات الفنية، الطاقة الشمسية، خدمات السطح",
    },
}

# ─── IFC Storey Name → Floor ID Lookup ────────────────────────────────────────
# Used by the ingest pipeline to map IFC data to our floor system

IFC_STOREY_TO_FLOOR_ID = {
    v["ifc_storey_name"]: k
    for k, v in FLOOR_DEFINITIONS.items()
}

# ─── Floor Order (by elevation, for UI navigation) ────────────────────────────

FLOOR_ORDER = sorted(FLOOR_DEFINITIONS.keys(), key=lambda k: FLOOR_DEFINITIONS[k]["elevation_cm"])

# ─── Building Groups (for grouped floor selector UI) ─────────────────────────

BUILDINGS = {}
for floor_id, fdef in FLOOR_DEFINITIONS.items():
    bldg = fdef["building"]
    if bldg not in BUILDINGS:
        BUILDINGS[bldg] = {
            "name": fdef["building"],
            "name_ar": fdef["building_ar"],
            "floors": [],
        }
    BUILDINGS[bldg]["floors"].append(floor_id)

# Sort floors within each building by elevation
for bldg in BUILDINGS.values():
    bldg["floors"].sort(key=lambda fid: FLOOR_DEFINITIONS[fid]["elevation_cm"])

# ─── Building display order ───────────────────────────────────────────────────

BUILDING_ORDER = ["Campus", "A", "B", "C", "AB", "AC", "CC", "M"]


if __name__ == "__main__":
    print(f"Total floors: {len(FLOOR_DEFINITIONS)}")
    print(f"Buildings: {list(BUILDINGS.keys())}")
    print(f"\nFloor order (by elevation):")
    for fid in FLOOR_ORDER:
        fd = FLOOR_DEFINITIONS[fid]
        print(f"  {fid:<12s} {fd['name']:<35s} elev={fd['elevation_cm']:>6d}  {fd['name_ar']}")
    print(f"\nIFC storey → floor_id mapping ({len(IFC_STOREY_TO_FLOOR_ID)} entries):")
    for ifc_name, fid in sorted(IFC_STOREY_TO_FLOOR_ID.items()):
        print(f"  {ifc_name:<35s} → {fid}")
