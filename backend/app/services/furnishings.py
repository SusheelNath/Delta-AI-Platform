"""
Furnishing type catalog and rule-based seeder for CHIREC Delta Hospital.

Provides:
- FURNISHING_CATALOG: reference data for the furnishing_types table
- FUNCTION_FURNISHING_RULES: maps primary_function keywords to default furnishings
- seed_furnishing_types(): populates furnishing_types table
- seed_space_furnishings(): auto-populates space_furnishings from polygon functions
- compute_furnishing_occupancy(): computes occupancy from furnishing inventory
"""

import math
from datetime import datetime

from sqlalchemy.orm import Session

from app.models import FurnishingType, SpaceFurnishing, SpaceMetrics


# ══════════════════════════════════════════════════════════════════════
# Furnishing type catalog
# ══════════════════════════════════════════════════════════════════════
# (item_type, category, label, footprint_m2, normal_occ, max_occ)

FURNISHING_CATALOG = [
    # ── Beds ──
    ("patient_bed",         "bed",       "Patient Bed",           4.5, 1, 2),
    ("patient_bed_double",  "bed",       "Patient Bed (Double)",  6.0, 2, 4),
    ("icu_bed",             "bed",       "ICU Bed",               8.0, 1, 3),
    ("surgical_table",      "bed",       "Surgical Table",        6.0, 0, 5),
    ("examination_table",   "bed",       "Examination Table",     3.0, 1, 2),
    ("recovery_bed",        "bed",       "Recovery Bed",          3.5, 1, 2),
    ("crib",                "bed",       "Crib",                  2.0, 1, 2),
    ("stretcher",           "bed",       "Stretcher / Gurney",    2.5, 1, 2),
    ("incubator",           "bed",       "Incubator",             2.0, 1, 1),
    ("bassinet",            "bed",       "Bassinet",              1.2, 1, 1),
    ("dialysis_chair",      "bed",       "Dialysis Chair",        3.0, 1, 1),
    ("triage_station",      "bed",       "Triage Station",        4.0, 1, 2),
    ("birthing_bed",        "bed",       "Birthing Bed",          5.0, 1, 3),
    ("dental_chair",        "bed",       "Dental Chair",          3.5, 1, 2),

    # ── Seating ──
    ("visitor_chair",       "seating",   "Visitor Chair",         0.8, 1, 1),
    ("desk_chair",          "seating",   "Desk Chair",            1.2, 1, 1),
    ("waiting_bench",       "seating",   "Waiting Bench",         1.8, 3, 4),
    ("stool",               "seating",   "Stool",                 0.4, 1, 1),
    ("wheelchair_bay",      "seating",   "Wheelchair Bay",        1.5, 1, 1),
    ("recliner",            "seating",   "Recliner",              1.5, 1, 1),
    ("sofa",                "seating",   "Sofa",                  2.5, 2, 3),
    ("high_chair",          "seating",   "High Chair",            0.5, 1, 1),

    # ── Storage ──
    ("wardrobe",            "storage",   "Wardrobe",              0.6, 0, 0),
    ("closet",              "storage",   "Closet",                0.5, 0, 0),
    ("cabinet",             "storage",   "Cabinet",               0.4, 0, 0),
    ("shelving",            "storage",   "Shelving Unit",         0.5, 0, 0),
    ("medication_cart",     "storage",   "Medication Cart",       0.6, 0, 0),
    ("supply_cart",         "storage",   "Supply Cart",           0.5, 0, 0),
    ("locker",              "storage",   "Locker",                0.3, 0, 0),
    ("filing_cabinet",      "storage",   "Filing Cabinet",        0.4, 0, 0),
    ("linen_cart",          "storage",   "Linen Cart",            0.6, 0, 0),
    ("laundry_cart",        "storage",   "Laundry Cart",          0.6, 0, 0),
    ("waste_bin",           "storage",   "Waste Bin",             0.2, 0, 0),
    ("biohazard_bin",       "storage",   "Biohazard Bin",         0.3, 0, 0),
    ("sharps_container",    "storage",   "Sharps Container",      0.1, 0, 0),
    ("crash_cart",          "storage",   "Crash Cart",            0.6, 0, 0),
    ("instrument_trolley",  "storage",   "Instrument Trolley",    0.5, 0, 0),
    ("iv_stand",            "storage",   "IV Stand",              0.2, 0, 0),
    ("coat_rack",           "storage",   "Coat Rack",             0.3, 0, 0),

    # ── Clinical Equipment ──
    ("ventilator",          "equipment", "Ventilator",            0.8, 0, 0),
    ("monitor",             "equipment", "Patient Monitor",       0.3, 0, 0),
    ("infusion_pump",       "equipment", "Infusion Pump",         0.2, 0, 0),
    ("anaesthesia_unit",    "equipment", "Anaesthesia Unit",      1.0, 0, 0),
    ("defibrillator",       "equipment", "Defibrillator",         0.3, 0, 0),
    ("imaging_unit",        "equipment", "Imaging Unit",          4.0, 0, 2),
    ("autoclave",           "equipment", "Autoclave",             1.0, 0, 0),
    ("oxygen_tank",         "equipment", "Oxygen Tank",           0.3, 0, 0),
    ("suction_unit",        "equipment", "Suction Unit",          0.3, 0, 0),
    ("ecg_machine",         "equipment", "ECG Machine",           0.5, 0, 0),
    ("ultrasound",          "equipment", "Ultrasound Machine",    1.2, 0, 1),
    ("blood_pressure_unit", "equipment", "Blood Pressure Monitor",0.2, 0, 0),
    ("pulse_oximeter",      "equipment", "Pulse Oximeter",        0.1, 0, 0),
    ("dialysis_machine",    "equipment", "Dialysis Machine",      1.5, 0, 0),
    ("xray_unit",           "equipment", "X-Ray Unit",            6.0, 0, 2),
    ("ct_scanner",          "equipment", "CT Scanner",           12.0, 0, 3),
    ("mri_scanner",         "equipment", "MRI Scanner",          20.0, 0, 3),
    ("sterilizer",          "equipment", "Sterilizer",            0.8, 0, 0),
    ("centrifuge",          "equipment", "Centrifuge",            0.4, 0, 0),
    ("microscope",          "equipment", "Microscope",            0.3, 0, 0),
    ("surgical_light",      "equipment", "Surgical Light",        0.0, 0, 0),
    ("baby_warmer",         "equipment", "Baby Warmer",           1.5, 0, 0),
    ("phototherapy_unit",   "equipment", "Phototherapy Unit",     1.0, 0, 0),

    # ── Office / IT Equipment ──
    ("printer",             "equipment", "Printer / Copier",      0.8, 0, 0),
    ("computer",            "equipment", "Computer Workstation",  0.5, 0, 0),
    ("server_rack",         "equipment", "Server Rack",           1.0, 0, 0),
    ("projector",           "equipment", "Projector",             0.3, 0, 0),
    ("display_screen",      "equipment", "Display Screen",        0.2, 0, 0),
    ("telephone",           "equipment", "Telephone",             0.1, 0, 0),
    ("intercom",            "equipment", "Intercom",              0.0, 0, 0),
    ("whiteboard",          "equipment", "Whiteboard",            0.5, 0, 0),

    # ── Fixtures ──
    ("sink",                "fixture",   "Sink",                  0.4, 0, 0),
    ("toilet",              "fixture",   "Toilet",                1.2, 0, 0),
    ("shower",              "fixture",   "Shower",                1.5, 0, 0),
    ("scrub_station",       "fixture",   "Scrub Station",         0.8, 0, 0),
    ("gas_outlet",          "fixture",   "Gas Outlet",            0.0, 0, 0),
    ("nurse_call",          "fixture",   "Nurse Call",            0.0, 0, 0),
    ("hand_sanitizer",      "fixture",   "Hand Sanitizer Station",0.1, 0, 0),
    ("fire_extinguisher",   "fixture",   "Fire Extinguisher",     0.1, 0, 0),
    ("eyewash_station",     "fixture",   "Eyewash Station",       0.3, 0, 0),
    ("water_fountain",      "fixture",   "Water Fountain",        0.3, 0, 0),
    ("mirror",              "fixture",   "Mirror",                0.0, 0, 0),
    ("soap_dispenser",      "fixture",   "Soap Dispenser",        0.0, 0, 0),
    ("paper_towel_dispenser","fixture",  "Paper Towel Dispenser", 0.0, 0, 0),
    ("baby_changing_station","fixture",  "Baby Changing Station", 1.0, 0, 0),
    ("grab_bar",            "fixture",   "Grab Bar",              0.0, 0, 0),

    # ── Furniture ──
    ("desk",                "furniture", "Desk",                  2.0, 1, 1),
    ("reception_desk",      "furniture", "Reception Desk",        4.0, 1, 2),
    ("table",               "furniture", "Table",                 1.8, 0, 0),
    ("conference_table",    "furniture", "Conference Table",      4.0, 0, 0),
    ("dining_table",        "furniture", "Dining Table",          2.5, 0, 0),
    ("countertop",          "furniture", "Countertop",            1.5, 0, 0),
    ("bedside_table",       "furniture", "Bedside Table",         0.3, 0, 0),
    ("curtain_divider",     "furniture", "Curtain Divider",       0.2, 0, 0),
    ("room_divider",        "furniture", "Room Divider / Screen", 1.0, 0, 0),
    ("bookshelf",           "furniture", "Bookshelf",             0.5, 0, 0),
    ("notice_board",        "furniture", "Notice Board",          0.0, 0, 0),
    ("sign_board",          "furniture", "Sign Board",            0.0, 0, 0),
    ("podium",              "furniture", "Podium / Lectern",      0.5, 0, 0),

    # ── Kitchen / Food Service ──
    ("refrigerator",        "appliance", "Refrigerator",          0.8, 0, 0),
    ("microwave",           "appliance", "Microwave",             0.3, 0, 0),
    ("oven",                "appliance", "Oven",                  0.8, 0, 0),
    ("dishwasher",          "appliance", "Dishwasher",            0.6, 0, 0),
    ("coffee_machine",      "appliance", "Coffee Machine",        0.3, 0, 0),
    ("vending_machine",     "appliance", "Vending Machine",       1.0, 0, 0),
    ("ice_machine",         "appliance", "Ice Machine",           0.5, 0, 0),
    ("food_trolley",        "appliance", "Food Trolley",          0.6, 0, 0),
    ("water_cooler",        "appliance", "Water Cooler",          0.3, 0, 0),

    # ── Elevator ──
    ("elevator_panel",      "equipment", "Elevator Control Panel", 0.2, 0, 0),
    ("handrail",            "fixture",   "Handrail",              0.1, 0, 0),
    ("elevator_mirror",     "fixture",   "Elevator Mirror",       0.0, 0, 0),

    # ── Facilities / MEP ──
    ("hvac_unit",           "equipment", "HVAC Unit",             3.0, 0, 0),
    ("electrical_panel",    "equipment", "Electrical Panel",      0.6, 0, 0),
    ("pump",                "equipment", "Pump",                  1.0, 0, 0),
    ("generator",           "equipment", "Generator",             4.0, 0, 0),
    ("ups_unit",            "equipment", "UPS Unit",              1.0, 0, 0),
    ("fire_alarm_panel",    "equipment", "Fire Alarm Panel",      0.3, 0, 0),
    ("cctv_camera",         "equipment", "CCTV Camera",           0.0, 0, 0),
    ("access_control",      "equipment", "Access Control Panel",  0.1, 0, 0),

    # ── Safety / Emergency ──
    ("aed",                 "safety",    "AED",                   0.2, 0, 0),
    ("first_aid_kit",       "safety",    "First Aid Kit",         0.1, 0, 0),
    ("emergency_light",     "safety",    "Emergency Light",       0.0, 0, 0),
    ("exit_sign",           "safety",    "Exit Sign",             0.0, 0, 0),
    ("spill_kit",           "safety",    "Spill Kit",             0.2, 0, 0),
    ("fire_blanket",        "safety",    "Fire Blanket",          0.1, 0, 0),
    ("evacuation_chair",    "safety",    "Evacuation Chair",      0.5, 0, 0),
    ("oxygen_mask_station", "safety",    "Oxygen Mask Station",   0.1, 0, 0),
]


# ══════════════════════════════════════════════════════════════════════
# Excluded function patterns - these rooms NEVER get furnishings
# ══════════════════════════════════════════════════════════════════════

EXCLUDED_PATTERNS = [
    "staircase", "stairway", "stair ", "stair-core", "vertical circulation",
    "shaft", "vent shaft", "ventilation", "vent",
    "no access", "no acccess", "no infrastructure",
    "parking", "ramp",
    "airlock", "lobby", "transition",
    "basement",
    "waste",
    "technical", "plant room", "building-services",
    "coded technical",
    "core / technical",
    "staircasse",  # typo in data
    "loading",
    "ambulance",  # vehicle bay, not a room
    "atrium",     # open public space, not furnishable rooms
]


def _is_excluded(fn: str, space_name: str | None = None) -> bool:
    """Check if a space should be excluded from furnishing.

    Checks both primary_function and space_name against exclusion patterns.
    """
    for text in (fn, space_name):
        if not text:
            continue
        text_lower = text.lower()
        for pattern in EXCLUDED_PATTERNS:
            if pattern in text_lower:
                return True
    return False


# ══════════════════════════════════════════════════════════════════════
# Rule-based seeding: primary_function → default furnishings
# ══════════════════════════════════════════════════════════════════════
#
# Each rule: (keywords_list, base_furnishings, options)
#   keywords: list of case-insensitive substrings (first match wins)
#   base_furnishings: [(item_type, quantity), ...]
#   options: dict with optional keys:
#     min_area: minimum room area (m²) for this rule to apply
#     scale: dict of {item_type: {"per_m2": float, "min": int, "max": int}}
#            scales quantity based on room area

FUNCTION_FURNISHING_RULES = [
    # ═══════════════════ SINGLE PATIENT ROOMS ═══════════════════
    (["single patient room", "single-bed", "single surgery/medicine inpatient",
      "single geriatric inpatient", "single-bed rehabilitation",
      "single neonatal intensive-care", "single post-partum maternity",
      "single high-risk pregnancy", "koala maternity",
      "single clinical/day-hospital treatment"],
     [("patient_bed", 1), ("bedside_table", 1), ("wardrobe", 1),
      ("visitor_chair", 2), ("nurse_call", 1), ("gas_outlet", 1), ("cabinet", 1),
      ("monitor", 1), ("hand_sanitizer", 1), ("waste_bin", 1)],
     {"min_area": 10}),

    # ═══════════════════ DOUBLE PATIENT ROOMS ═══════════════════
    (["double patient room", "two-bed", "double surgery/medicine inpatient",
      "double geriatric inpatient", "double-bed rehabilitation",
      "double post-partum maternity", "double bariatric"],
     [("patient_bed", 2), ("bedside_table", 2), ("wardrobe", 2),
      ("visitor_chair", 2), ("curtain_divider", 1), ("nurse_call", 2), ("gas_outlet", 2),
      ("monitor", 2), ("hand_sanitizer", 1), ("waste_bin", 2)],
     {"min_area": 18}),

    # ═══════════════════ LARGER PATIENT ROOMS / SUITES ═══════════════════
    (["larger single patient room", "suite / larger single",
      "surgery/medicine suite", "geriatric suite", "rehabilitation suite",
      "maternity suite", "bariatric/adapted suite"],
     [("patient_bed", 1), ("bedside_table", 1), ("wardrobe", 1),
      ("visitor_chair", 2), ("desk", 1), ("desk_chair", 1),
      ("nurse_call", 1), ("gas_outlet", 1), ("cabinet", 1),
      ("monitor", 1), ("hand_sanitizer", 1), ("waste_bin", 1), ("recliner", 1)],
     {"min_area": 15}),

    # ═══════════════════ ISOLATED SEATING ROOM ═══════════════════
    (["isolated seating"],
     [("recliner", 1), ("bedside_table", 1), ("nurse_call", 1),
      ("hand_sanitizer", 1), ("waste_bin", 1), ("curtain_divider", 1)],
     {"min_area": 6}),

    # ═══════════════════ PATIENT ROOM (named) ═══════════════════
    (["patient room"],
     [("patient_bed", 1), ("bedside_table", 1), ("wardrobe", 1),
      ("visitor_chair", 2), ("nurse_call", 1), ("gas_outlet", 1), ("cabinet", 1),
      ("monitor", 1), ("hand_sanitizer", 1), ("waste_bin", 1)],
     {"min_area": 10}),

    # ═══════════════════ WAITING ROOM (before Patient Care) ═══════════════════
    (["waiting room", "waiting", "day room", "lounge", "play room"],
     [("waiting_bench", 2), ("visitor_chair", 3), ("water_fountain", 1),
      ("hand_sanitizer", 1), ("waste_bin", 1), ("display_screen", 1),
      ("wheelchair_bay", 1)],
     {"min_area": 8,
      "scale": {"waiting_bench": {"per_m2": 8, "min": 2, "max": 12},
                "visitor_chair": {"per_m2": 6, "min": 2, "max": 20},
                "wheelchair_bay": {"per_m2": 30, "min": 1, "max": 4}}}),

    # ═══════════════════ MAIN HALL (public spaces) ═══════════════════
    (["main hall"],
     [("waiting_bench", 6), ("visitor_chair", 10), ("wheelchair_bay", 3),
      ("water_fountain", 2), ("hand_sanitizer", 3), ("waste_bin", 4),
      ("display_screen", 2), ("sign_board", 2), ("aed", 1),
      ("fire_extinguisher", 2), ("vending_machine", 2), ("notice_board", 1)],
     {"min_area": 100,
      "scale": {"waiting_bench": {"per_m2": 40, "min": 4, "max": 40},
                "visitor_chair": {"per_m2": 25, "min": 6, "max": 60},
                "wheelchair_bay": {"per_m2": 80, "min": 2, "max": 10},
                "waste_bin": {"per_m2": 100, "min": 2, "max": 15},
                "hand_sanitizer": {"per_m2": 150, "min": 2, "max": 10}}}),

    # ═══════════════════ PATIENT CARE (generic) ═══════════════════
    (["patient care", "patient room"],
     [("patient_bed", 1), ("bedside_table", 1), ("visitor_chair", 1),
      ("nurse_call", 1), ("cabinet", 1), ("hand_sanitizer", 1), ("waste_bin", 1)],
     {"min_area": 10,
      "scale": {"patient_bed": {"per_m2": 25, "min": 1, "max": 2},
                "bedside_table": {"per_m2": 25, "min": 1, "max": 2},
                "visitor_chair": {"per_m2": 15, "min": 1, "max": 3},
                "curtain_divider": {"per_m2": 30, "min": 0, "max": 1}}}),

    # ═══════════════════ OFFICE / WORKROOM (before ICU) ═══════════════════
    (["office", "bureau", "workroom"],
     [("desk", 1), ("desk_chair", 1), ("cabinet", 1), ("shelving", 1),
      ("computer", 1), ("telephone", 1), ("waste_bin", 1)],
     {"min_area": 5,
      "scale": {"desk": {"per_m2": 8, "min": 1, "max": 8},
                "desk_chair": {"per_m2": 8, "min": 1, "max": 8},
                "computer": {"per_m2": 8, "min": 1, "max": 8}}}),

    # ═══════════════════ ICU ═══════════════════
    (["intensive-care", "intensive care", "icu"],
     [("icu_bed", 1), ("ventilator", 1), ("monitor", 2), ("infusion_pump", 2),
      ("bedside_table", 1), ("nurse_call", 1), ("gas_outlet", 2),
      ("defibrillator", 1), ("crash_cart", 1), ("suction_unit", 1),
      ("pulse_oximeter", 1), ("iv_stand", 1), ("hand_sanitizer", 1),
      ("waste_bin", 1), ("biohazard_bin", 1)],
     {"min_area": 12}),

    # ═══════════════════ CONTROL ROOM ═══════════════════
    (["control room", "control"],
     [("desk", 2), ("desk_chair", 2), ("monitor", 2), ("computer", 2),
      ("telephone", 1), ("display_screen", 1)],
     {"min_area": 5}),

    # ═══════════════════ SERVER ROOM ═══════════════════
    (["server room", "server"],
     [("server_rack", 2), ("ups_unit", 1), ("fire_extinguisher", 1),
      ("cctv_camera", 1), ("electrical_panel", 1)],
     {"min_area": 5,
      "scale": {"server_rack": {"per_m2": 6, "min": 1, "max": 10}}}),

    # ═══════════════════ OPERATING ROOMS / SURGERY ═══════════════════
    (["operating room", "operating-theatre", "operating theatre",
      "surgical room", "surgery room", "coded op5", "coded op7",
      "caesarean", "obstetric procedure"],
     [("surgical_table", 1), ("anaesthesia_unit", 1), ("monitor", 2),
      ("infusion_pump", 1), ("defibrillator", 1), ("scrub_station", 1),
      ("gas_outlet", 4), ("supply_cart", 1), ("surgical_light", 2),
      ("crash_cart", 1), ("instrument_trolley", 1),
      ("waste_bin", 1), ("biohazard_bin", 1), ("sharps_container", 1),
      ("hand_sanitizer", 1), ("iv_stand", 1)],
     {"min_area": 20}),

    # ═══════════════════ SCRUB / SURGICAL PREPARATION ═══════════════════
    (["scrub / surgical", "scrub station", "surgical preparation"],
     [("scrub_station", 2), ("sink", 1), ("supply_cart", 1), ("shelving", 1),
      ("hand_sanitizer", 1), ("mirror", 1)],
     {"min_area": 6}),

    # ═══════════════════ RECOVERY / POST-ANAESTHESIA ═══════════════════
    (["recovery", "post-operative", "post operative", "pacu",
      "post-anaesthesia"],
     [("recovery_bed", 1), ("monitor", 1), ("infusion_pump", 1),
      ("nurse_call", 1), ("gas_outlet", 1), ("pulse_oximeter", 1),
      ("blood_pressure_unit", 1), ("iv_stand", 1),
      ("waste_bin", 1), ("hand_sanitizer", 1)],
     {"min_area": 8}),

    # ═══════════════════ NEONATAL ═══════════════════
    (["neonatal", "nicu", "resuscitation"],
     [("incubator", 1), ("monitor", 1), ("infusion_pump", 1),
      ("nurse_call", 1), ("gas_outlet", 2), ("baby_warmer", 1),
      ("phototherapy_unit", 1), ("pulse_oximeter", 1),
      ("hand_sanitizer", 1), ("waste_bin", 1)],
     {"min_area": 6}),

    # ═══════════════════ BIRTHING / DELIVERY ═══════════════════
    (["birthing", "delivery room"],
     [("birthing_bed", 1), ("monitor", 2), ("infusion_pump", 1),
      ("nurse_call", 1), ("gas_outlet", 2), ("supply_cart", 1),
      ("visitor_chair", 1), ("baby_warmer", 1), ("crash_cart", 1),
      ("bassinet", 1), ("iv_stand", 1),
      ("waste_bin", 1), ("hand_sanitizer", 1)],
     {"min_area": 15}),

    # ═══════════════════ DIALYSIS ═══════════════════
    (["dialysis"],
     [("dialysis_chair", 1), ("dialysis_machine", 1), ("monitor", 1),
      ("infusion_pump", 1), ("visitor_chair", 1), ("nurse_call", 1),
      ("iv_stand", 1), ("waste_bin", 1), ("hand_sanitizer", 1)],
     {"min_area": 6}),

    # ═══════════════════ DENTAL CHECK-UP ═══════════════════
    (["dental check-up", "dental"],
     [("dental_chair", 1), ("desk", 1), ("desk_chair", 1),
      ("cabinet", 1), ("sink", 1), ("surgical_light", 1),
      ("hand_sanitizer", 1), ("waste_bin", 1), ("instrument_trolley", 1),
      ("computer", 1)],
     {"min_area": 8}),

    # ═══════════════════ CONSULTATION / EXAMINATION / CHECK-UP ═══════════════════
    (["consultation", "examination", "endoscopy procedure",
      "triage room", "triage area", "check-up", "check up", "checkup"],
     [("examination_table", 1), ("desk", 1), ("desk_chair", 1),
      ("visitor_chair", 2), ("cabinet", 1), ("sink", 1),
      ("hand_sanitizer", 1), ("waste_bin", 1), ("computer", 1),
      ("blood_pressure_unit", 1)],
     {"min_area": 8}),

    # ═══════════════════ PHYSIOTHERAPY / REHABILITATION ═══════════════════
    (["physiotherapy", "kinesiotherapy", "occupational therapy", "ergotherapy"],
     [("examination_table", 1), ("desk", 1), ("desk_chair", 1),
      ("visitor_chair", 1), ("cabinet", 1), ("hand_sanitizer", 1),
      ("waste_bin", 1)],
     {"min_area": 10}),

    # ═══════════════════ IMAGING / RADIOLOGY ═══════════════════
    (["diagnostic-imaging", "radiography", "x-ray", "mri room", "mri suite",
      "scanner", "radiology", "nuclear-medicine", "nuclear medicine",
      "radiotherapy bunker"],
     [("imaging_unit", 1), ("monitor", 1), ("desk", 1), ("desk_chair", 1),
      ("computer", 1), ("fire_extinguisher", 1)],
     {"min_area": 10}),

    # ═══════════════════ NURSING STATION ═══════════════════
    (["nursing station", "staff base", "staff work base", "nurse's offices"],
     [("desk", 2), ("desk_chair", 2), ("monitor", 1), ("cabinet", 1),
      ("shelving", 1), ("computer", 2), ("telephone", 1), ("printer", 1),
      ("medication_cart", 1), ("hand_sanitizer", 1), ("waste_bin", 1)],
     {"min_area": 6,
      "scale": {"desk": {"per_m2": 6, "min": 2, "max": 6},
                "desk_chair": {"per_m2": 6, "min": 2, "max": 6},
                "computer": {"per_m2": 6, "min": 2, "max": 6}}}),

    # ═══════════════════ RECEPTION ═══════════════════
    (["reception", "intake"],
     [("reception_desk", 1), ("desk_chair", 2), ("visitor_chair", 4), ("cabinet", 1),
      ("computer", 1), ("telephone", 1), ("printer", 1), ("display_screen", 1),
      ("hand_sanitizer", 1), ("waste_bin", 1)],
     {"min_area": 6,
      "scale": {"visitor_chair": {"per_m2": 8, "min": 2, "max": 12},
                "desk_chair": {"per_m2": 15, "min": 1, "max": 4}}}),

    # ═══════════════════ MEETING / CONFERENCE / DEBRIEF ═══════════════════
    (["meeting", "conference", "debrief", "gathering"],
     [("conference_table", 1), ("desk_chair", 6), ("projector", 1),
      ("whiteboard", 1), ("display_screen", 1), ("waste_bin", 1)],
     {"min_area": 10,
      "scale": {"desk_chair": {"per_m2": 4, "min": 4, "max": 24}}}),

    # ═══════════════════ ASSEMBLY ROOM ═══════════════════
    (["assembly"],
     [("conference_table", 1), ("desk_chair", 8), ("projector", 1),
      ("display_screen", 1), ("podium", 1), ("waste_bin", 1)],
     {"min_area": 12,
      "scale": {"desk_chair": {"per_m2": 4, "min": 6, "max": 30}}}),

    # ═══════════════════ RESTAURANT / CAFETERIA ═══════════════════
    (["restaurant", "cafeteria"],
     [("dining_table", 4), ("visitor_chair", 16), ("countertop", 2),
      ("refrigerator", 1), ("microwave", 1), ("coffee_machine", 1),
      ("food_trolley", 1), ("waste_bin", 3), ("hand_sanitizer", 1),
      ("high_chair", 2), ("water_cooler", 1), ("vending_machine", 1)],
     {"min_area": 30,
      "scale": {"dining_table": {"per_m2": 12, "min": 2, "max": 20},
                "visitor_chair": {"per_m2": 3, "min": 8, "max": 80},
                "waste_bin": {"per_m2": 50, "min": 2, "max": 10},
                "high_chair": {"per_m2": 60, "min": 1, "max": 6}}}),

    # ═══════════════════ PHARMACY ═══════════════════
    (["pharmacy"],
     [("countertop", 1), ("shelving", 3), ("desk", 1), ("desk_chair", 1),
      ("cabinet", 1), ("computer", 1), ("refrigerator", 1),
      ("medication_cart", 1), ("hand_sanitizer", 1), ("waste_bin", 1)],
     {"min_area": 8,
      "scale": {"shelving": {"per_m2": 8, "min": 2, "max": 20}}}),

    # ═══════════════════ RETAIL / COMMERCIAL ═══════════════════
    (["convenience store", "supermarket", "store", "commercial"],
     [("countertop", 1), ("shelving", 3), ("display_screen", 1),
      ("waste_bin", 1)],
     {"min_area": 5,
      "scale": {"shelving": {"per_m2": 6, "min": 2, "max": 25}}}),

    # ═══════════════════ LABORATORY ═══════════════════
    (["laboratory", "lab "],
     [("countertop", 2), ("stool", 2), ("cabinet", 2), ("sink", 1),
      ("shelving", 2), ("microscope", 1), ("centrifuge", 1),
      ("eyewash_station", 1), ("biohazard_bin", 1), ("sharps_container", 1),
      ("hand_sanitizer", 1), ("waste_bin", 1), ("fire_extinguisher", 1)],
     {"min_area": 6}),

    # ═══════════════════ STERILISATION ═══════════════════
    (["sterilisation", "sterilization", "sterile"],
     [("autoclave", 1), ("sterilizer", 1), ("countertop", 2), ("shelving", 2),
      ("sink", 1), ("hand_sanitizer", 1), ("waste_bin", 1)],
     {"min_area": 6,
      "scale": {"autoclave": {"per_m2": 50, "min": 1, "max": 10},
                "countertop": {"per_m2": 25, "min": 2, "max": 16},
                "shelving": {"per_m2": 20, "min": 2, "max": 20},
                "sink": {"per_m2": 60, "min": 1, "max": 8}}}),

    # ═══════════════════ DIRTY UTILITY ═══════════════════
    (["dirty utility"],
     [("sink", 1), ("countertop", 1), ("shelving", 1), ("cabinet", 1),
      ("waste_bin", 1), ("biohazard_bin", 1), ("laundry_cart", 1),
      ("hand_sanitizer", 1)],
     {"min_area": 4}),

    # ═══════════════════ CLEAN UTILITY ═══════════════════
    (["clean utility"],
     [("countertop", 1), ("shelving", 2), ("cabinet", 1), ("medication_cart", 1),
      ("supply_cart", 1), ("hand_sanitizer", 1), ("linen_cart", 1)],
     {"min_area": 4}),

    # ═══════════════════ PREPARATION ROOM ═══════════════════
    (["preparation room", "processing"],
     [("countertop", 1), ("cabinet", 2), ("sink", 1), ("supply_cart", 1),
      ("hand_sanitizer", 1), ("waste_bin", 1)],
     {"min_area": 5}),

    # ═══════════════════ PANTRY ═══════════════════
    (["pantry"],
     [("countertop", 1), ("sink", 1), ("shelving", 1), ("cabinet", 1),
      ("refrigerator", 1), ("microwave", 1), ("coffee_machine", 1),
      ("waste_bin", 1)],
     {"min_area": 3}),

    # ═══════════════════ HOUSEKEEPING / CLEANING ═══════════════════
    (["housekeeping", "cleaning room", "janitor", "laundry"],
     [("sink", 1), ("shelving", 2), ("cabinet", 1), ("laundry_cart", 1),
      ("waste_bin", 1), ("supply_cart", 1)],
     {"min_area": 3}),

    # ═══════════════════ COLD STORAGE ═══════════════════
    (["cold storage"],
     [("refrigerator", 2), ("shelving", 2), ("fire_extinguisher", 1)],
     {"min_area": 3,
      "scale": {"refrigerator": {"per_m2": 6, "min": 1, "max": 8},
                "shelving": {"per_m2": 8, "min": 1, "max": 10}}}),

    # ═══════════════════ STORAGE ═══════════════════
    (["storage", "store room", "archive", "reserve"],
     [("shelving", 2), ("cabinet", 1), ("fire_extinguisher", 1)],
     {"min_area": 3,
      "scale": {"shelving": {"per_m2": 6, "min": 1, "max": 30},
                "cabinet": {"per_m2": 20, "min": 1, "max": 10}}}),

    # ═══════════════════ BODY STORE / MORGUE ═══════════════════
    (["body store", "morgue", "incinerator"],
     [("countertop", 2), ("sink", 1), ("cabinet", 2), ("shelving", 2),
      ("refrigerator", 2), ("hand_sanitizer", 1), ("waste_bin", 1),
      ("biohazard_bin", 1)],
     {"min_area": 10,
      "scale": {"countertop": {"per_m2": 30, "min": 2, "max": 12},
                "refrigerator": {"per_m2": 20, "min": 1, "max": 8},
                "cabinet": {"per_m2": 30, "min": 2, "max": 10},
                "shelving": {"per_m2": 20, "min": 2, "max": 15},
                "sink": {"per_m2": 60, "min": 1, "max": 6}}}),

    # ═══════════════════ LOCKER / CHANGING ═══════════════════
    (["locker", "changing"],
     [("locker", 6), ("bench", 2), ("mirror", 1), ("waste_bin", 1)],
     {"min_area": 4,
      "scale": {"locker": {"per_m2": 2, "min": 4, "max": 30},
                "bench": {"per_m2": 8, "min": 1, "max": 6}}}),

    # ═══════════════════ SANITARY / WC ═══════════════════
    (["toilet", "wc", "washroom", "sanitary", "sanitation", "ensuite",
      "shower / wash", "assisted bathroom", "bathing room"],
     [("toilet", 1), ("sink", 1), ("hand_sanitizer", 1), ("soap_dispenser", 1),
      ("paper_towel_dispenser", 1), ("mirror", 1), ("waste_bin", 1)],
     {"min_area": 2.0,
      "scale": {"toilet": {"per_m2": 6, "min": 1, "max": 20},
                "sink": {"per_m2": 10, "min": 1, "max": 12}}}),

    # ═══════════════════ ACCESSIBILITY TOILET ═══════════════════
    (["accessibility toilet", "accessible toilet", "adapted toilet"],
     [("toilet", 1), ("sink", 1), ("grab_bar", 3), ("hand_sanitizer", 1),
      ("soap_dispenser", 1), ("paper_towel_dispenser", 1), ("mirror", 1),
      ("waste_bin", 1), ("nurse_call", 1), ("baby_changing_station", 1)],
     {"min_area": 3}),

    (["shower"],
     [("shower", 1), ("sink", 1), ("grab_bar", 1), ("mirror", 1),
      ("soap_dispenser", 1), ("waste_bin", 1)],
     {"min_area": 2}),

    # ═══════════════════ STAFF (generic catchall) ═══════════════════
    (["staff room", "staff access", "staff"],
     [("desk", 1), ("desk_chair", 2), ("visitor_chair", 2), ("cabinet", 1),
      ("countertop", 1), ("sink", 1), ("coffee_machine", 1), ("microwave", 1),
      ("refrigerator", 1), ("locker", 2), ("waste_bin", 1)],
     {"min_area": 5,
      "scale": {"desk": {"per_m2": 10, "min": 1, "max": 8},
                "desk_chair": {"per_m2": 8, "min": 2, "max": 12},
                "visitor_chair": {"per_m2": 10, "min": 1, "max": 6},
                "locker": {"per_m2": 5, "min": 2, "max": 12}}}),

    # ═══════════════════ RESIDENCY / ON-CALL ═══════════════════
    (["residency", "on-call", "patient care + residency"],
     [("patient_bed", 1), ("desk", 1), ("desk_chair", 1), ("wardrobe", 1),
      ("bedside_table", 1), ("telephone", 1), ("waste_bin", 1)],
     {"min_area": 8}),

    # ═══════════════════ EMERGENCY CLINICAL ROOMS ═══════════════════
    (["emergency-department clinical", "emergency"],
     [("examination_table", 1), ("monitor", 1), ("desk", 1), ("desk_chair", 1),
      ("cabinet", 1), ("sink", 1), ("defibrillator", 1), ("crash_cart", 1),
      ("iv_stand", 1), ("hand_sanitizer", 1), ("waste_bin", 1),
      ("biohazard_bin", 1), ("sharps_container", 1)],
     {"min_area": 8,
      "scale": {"examination_table": {"per_m2": 25, "min": 1, "max": 30},
                "monitor": {"per_m2": 30, "min": 1, "max": 25},
                "desk": {"per_m2": 60, "min": 1, "max": 10},
                "desk_chair": {"per_m2": 60, "min": 1, "max": 10},
                "cabinet": {"per_m2": 40, "min": 1, "max": 15},
                "sink": {"per_m2": 80, "min": 1, "max": 10}}}),

    # ═══════════════════ DEPARTMENT-SPECIFIC (unresolved) ═══════════════════
    (["department-specific", "existing department"],
     [("desk", 1), ("desk_chair", 1), ("cabinet", 1), ("shelving", 1),
      ("computer", 1), ("waste_bin", 1)],
     {"min_area": 5}),

    # ═══════════════════ RADIOTHERAPY ═══════════════════
    (["radiotherapy", "dosimetry", "medical physics"],
     [("imaging_unit", 1), ("monitor", 1), ("desk", 1), ("desk_chair", 1),
      ("computer", 1), ("fire_extinguisher", 1)],
     {"min_area": 8}),

    # ═══════════════════ RADIOTHERAPY SIMULATION ═══════════════════
    (["radiotherapy simulation"],
     [("examination_table", 1), ("imaging_unit", 1), ("monitor", 1),
      ("desk", 1), ("desk_chair", 1), ("computer", 1)],
     {"min_area": 10}),

    # ═══════════════════ WORKSHOP ═══════════════════
    (["workshop", "carpentry", "woodwork", "mechanical workshop"],
     [("countertop", 2), ("stool", 2), ("shelving", 2), ("cabinet", 1),
      ("fire_extinguisher", 1), ("first_aid_kit", 1), ("waste_bin", 1)],
     {"min_area": 8,
      "scale": {"shelving": {"per_m2": 10, "min": 1, "max": 10}}}),

    # ═══════════════════ ENTRANCE ═══════════════════
    (["entrance"],
     [("reception_desk", 1), ("desk_chair", 1), ("visitor_chair", 2),
      ("display_screen", 1), ("cctv_camera", 1), ("aed", 1),
      ("wheelchair_bay", 1), ("hand_sanitizer", 1), ("waste_bin", 1)],
     {"min_area": 10}),

    # ═══════════════════ DEPARTMENT SUPPORT (generic small rooms) ═══════════════════
    (["support/service space", "department support"],
     [("countertop", 1), ("cabinet", 1), ("shelving", 1), ("waste_bin", 1)],
     {"min_area": 3}),

    # ═══════════════════ ELEVATOR ═══════════════════
    (["elevator", "lift"],
     [("elevator_panel", 1), ("handrail", 2), ("elevator_mirror", 1),
      ("emergency_light", 1), ("cctv_camera", 1)],
     {"min_area": 4}),

    # ═══════════════════ FACILITIES / MEP ═══════════════════
    (["facilities", "facitilies", "hvac", "plant room", "building-services"],
     [("hvac_unit", 1), ("electrical_panel", 1), ("shelving", 1), ("cabinet", 1),
      ("fire_extinguisher", 1), ("fire_alarm_panel", 1)],
     {"min_area": 8,
      "scale": {"hvac_unit": {"per_m2": 15, "min": 1, "max": 6},
                "electrical_panel": {"per_m2": 20, "min": 1, "max": 4}}}),

    # ═══════════════════ CORRIDOR ═══════════════════
    (["corridor", "circulation"],
     [("emergency_light", 1), ("exit_sign", 1), ("fire_extinguisher", 1)],
     {"min_area": 3,
      "scale": {"fire_extinguisher": {"per_m2": 60, "min": 1, "max": 8},
                "emergency_light": {"per_m2": 40, "min": 1, "max": 10},
                "exit_sign": {"per_m2": 40, "min": 1, "max": 10},
                "hand_sanitizer": {"per_m2": 80, "min": 0, "max": 6},
                "handrail": {"per_m2": 50, "min": 0, "max": 8},
                "sign_board": {"per_m2": 100, "min": 0, "max": 5},
                "aed": {"per_m2": 300, "min": 0, "max": 3},
                "waste_bin": {"per_m2": 80, "min": 0, "max": 6},
                "cctv_camera": {"per_m2": 200, "min": 0, "max": 4},
                "notice_board": {"per_m2": 200, "min": 0, "max": 3}}}),

]


# Absolute occupancy standing density: arm's-length spacing
STANDING_DENSITY_M2 = 1.8  # m² per person
EGRESS_RESERVE_PER_DOOR = 1.5  # m² kept clear per door
FURNITURE_BUFFER_FACTOR = 0.15  # 15% of used area as clearance around furniture
DEFAULT_DOORS = 1  # assume 1 door per space unless otherwise specified
MAX_FURNISHING_PCT = 0.80  # skip seeding if furnishings would exceed 80% of room area


# ══════════════════════════════════════════════════════════════════════
# Seed functions
# ══════════════════════════════════════════════════════════════════════

def seed_furnishing_types(db: Session) -> int:
    """Populate furnishing_types table from catalog. Returns count of new rows."""
    existing = {ft.item_type for ft in db.query(FurnishingType).all()}
    added = 0
    for item_type, category, label, footprint, normal_occ, max_occ in FURNISHING_CATALOG:
        if item_type not in existing:
            db.add(FurnishingType(
                item_type=item_type,
                category=category,
                label=label,
                footprint_m2=footprint,
                normal_occ=normal_occ,
                max_occ=max_occ,
            ))
            added += 1
    db.commit()
    return added


def _matches_any(function: str, keywords: list[str]) -> bool:
    fn_lower = function.lower()
    return any(kw.lower() in fn_lower for kw in keywords)


def _apply_scaling(base_furnishings: list[tuple], area_m2: float,
                   scale_rules: dict, ft_footprints: dict) -> list[tuple]:
    """Scale furnishing quantities based on room area.

    scale_rules: {item_type: {"per_m2": float, "min": int, "max": int}}
      per_m2: one item per this many m² of room area
    """
    result = []
    base_types = set()
    for item_type, base_qty in base_furnishings:
        base_types.add(item_type)
        if item_type in scale_rules:
            rule = scale_rules[item_type]
            scaled_qty = max(rule["min"], min(rule["max"],
                             math.floor(area_m2 / rule["per_m2"])))
            result.append((item_type, scaled_qty))
        else:
            result.append((item_type, base_qty))
    # Add scale-only items not in base (e.g. corridor extras with min=0)
    for item_type, rule in scale_rules.items():
        if item_type not in base_types:
            scaled_qty = max(rule["min"], min(rule["max"],
                             math.floor(area_m2 / rule["per_m2"])))
            if scaled_qty > 0:
                result.append((item_type, scaled_qty))
    return result


def _compute_total_footprint(furnishing_list: list[tuple],
                             ft_footprints: dict) -> float:
    """Compute total footprint of a furnishing list."""
    return sum(ft_footprints.get(item_type, 0) * qty
               for item_type, qty in furnishing_list)


def seed_space_furnishings(db: Session, polygons: list[dict]) -> dict:
    """Auto-populate space_furnishings for all polygons based on primary_function.

    Only adds furnishings to spaces that don't already have any.
    Respects exclusion list, area minimums, and scaling rules.
    Returns stats dict."""
    valid_types = {ft.item_type for ft in db.query(FurnishingType).all()}

    # Build footprint lookup
    ft_footprints = {}
    for ft in db.query(FurnishingType).all():
        ft_footprints[ft.item_type] = ft.footprint_m2

    existing_guids = {
        row.ifc_guid for row in
        db.query(SpaceFurnishing.ifc_guid).distinct().all()
    }

    now = datetime.utcnow().isoformat()
    seeded = 0
    skipped_existing = 0
    skipped_excluded = 0
    skipped_no_function = 0
    skipped_too_small = 0
    skipped_overflow = 0
    no_match = 0

    for p in polygons:
        ifc_guid = p.get("ifc_guid")
        if not ifc_guid:
            continue

        if ifc_guid in existing_guids:
            skipped_existing += 1
            continue

        fn = p.get("primary_function") or ""
        space_name = p.get("space_name") or ""
        floor_id = p.get("floor_id", "")
        area_m2 = p.get("area_m2") or 0

        # Skip unknown / empty functions (check both polygon fields)
        if (not fn or fn == "?" or fn == "Unassigned") and not space_name:
            skipped_no_function += 1
            continue

        # Skip excluded space types (check both polygon fields)
        if _is_excluded(fn, space_name):
            skipped_excluded += 1
            continue

        # Find matching rule - two-pass:
        #   Pass 1: space_name (more specific, e.g. "Cafeteria" vs fn="Commercial")
        #   Pass 2: primary_function (generic fallback)
        matched = False
        matched_rule = None
        if space_name:
            for keywords, base_furnishings, options in FUNCTION_FURNISHING_RULES:
                if _matches_any(space_name, keywords):
                    matched_rule = (keywords, base_furnishings, options)
                    break
        if not matched_rule and fn:
            for keywords, base_furnishings, options in FUNCTION_FURNISHING_RULES:
                if _matches_any(fn, keywords):
                    matched_rule = (keywords, base_furnishings, options)
                    break
        if matched_rule:
            keywords, base_furnishings, options = matched_rule

            # Check minimum area
            min_area = options.get("min_area", 0)
            if area_m2 > 0 and area_m2 < min_area:
                skipped_too_small += 1
                matched = True
            else:
                # Apply scaling if specified
                scale_rules = options.get("scale", {})
                if scale_rules and area_m2 > 0:
                    furnishing_list = _apply_scaling(
                        base_furnishings, area_m2, scale_rules, ft_footprints)
                else:
                    furnishing_list = list(base_furnishings)

                # Check total footprint doesn't exceed room area
                if area_m2 > 0:
                    total_fp = _compute_total_footprint(furnishing_list, ft_footprints)
                    if total_fp > area_m2 * MAX_FURNISHING_PCT:
                        skipped_overflow += 1
                        matched = True

                if not matched:
                    # Add furnishings
                    for item_type, quantity in furnishing_list:
                        if item_type not in valid_types:
                            continue
                        if quantity <= 0:
                            continue
                        db.add(SpaceFurnishing(
                            ifc_guid=ifc_guid,
                            floor_id=floor_id,
                            item_type=item_type,
                            quantity=quantity,
                            created_at=now,
                        ))
                    seeded += 1
                    matched = True

        if not matched:
            no_match += 1

    db.commit()
    return {
        "seeded": seeded,
        "skipped_existing": skipped_existing,
        "skipped_excluded": skipped_excluded,
        "skipped_no_function": skipped_no_function,
        "skipped_too_small": skipped_too_small,
        "skipped_overflow": skipped_overflow,
        "no_rule_match": no_match,
    }


# ══════════════════════════════════════════════════════════════════════
# Occupancy computation from furnishings
# ══════════════════════════════════════════════════════════════════════


# ── Station-based occupancy classification ──
# Beds are independent stations - each generates occupancy on its own.
_BED_TYPES = {
    "patient_bed", "patient_bed_double", "icu_bed", "recovery_bed",
    "crib", "examination_table", "surgical_table",
}
# Desks need chairs to generate occupancy (paired workstations).
_DESK_TYPE = "desk"
_DESK_CHAIR_TYPE = "desk_chair"
# Independent seating - generates occupancy without needing a desk/bed.
_INDEPENDENT_SEATING = {
    "visitor_chair", "waiting_bench", "stool", "wheelchair_bay",
}
# Everything else (table, countertop, equipment, storage, fixtures) = 0 occupancy.
# They still consume floor area, which reduces absolute occupancy.


def compute_furnishing_occupancy(
    furnishings: list[SpaceFurnishing],
    furnishing_types: dict[str, FurnishingType],
    area_m2: float,
    num_doors: int = DEFAULT_DOORS,
) -> dict:
    """Compute normal, max, and absolute occupancy from furnishing inventory
    using station-based pairing logic.

    Station rules:
      1. Beds - independent stations, use catalog normal/max occ per item.
      2. Desks + desk chairs - paired workstations.  Occupied stations =
         min(desks, desk_chairs).  Each station = 1 normal, 1 max.
         Surplus desk chairs (beyond desk count) spill into independent
         seating (1 normal, 1 max each).
      3. Independent seating (visitor chairs, benches, stools, wheelchair
         bays) - each generates its catalog normal/max occ.
      4. Everything else (tables, countertops, equipment, storage, fixtures)
         - 0 occupancy, but footprint still reduces absolute capacity.

    Returns dict with:
        normal_occupancy, max_occupancy, absolute_occupancy,
        used_area_m2, free_area_m2
    """
    used_area = 0.0
    normal_occ = 0
    max_occ = 0

    desk_qty = 0
    desk_chair_qty = 0

    for f in furnishings:
        ft = furnishing_types.get(f.item_type)
        if not ft:
            continue

        # All items consume floor area regardless of occupancy contribution
        used_area += ft.footprint_m2 * f.quantity

        if f.item_type in _BED_TYPES:
            # Beds are independent stations - catalog values apply directly
            normal_occ += ft.normal_occ * f.quantity
            max_occ += ft.max_occ * f.quantity

        elif f.item_type == _DESK_TYPE:
            # Desks tallied for pairing - no occupancy on their own
            desk_qty += f.quantity

        elif f.item_type == _DESK_CHAIR_TYPE:
            # Desk chairs tallied for pairing - resolved below
            desk_chair_qty += f.quantity

        elif f.item_type in _INDEPENDENT_SEATING:
            # Independent seating - catalog values apply directly
            normal_occ += ft.normal_occ * f.quantity
            max_occ += ft.max_occ * f.quantity

        # else: tables, countertops, equipment, storage, fixtures → 0 occ

    # ── Desk-chair pairing ──
    # Each paired workstation (1 desk + 1 desk chair) = 1 person
    paired = min(desk_qty, desk_chair_qty)
    normal_occ += paired
    max_occ += paired

    # Surplus desk chairs beyond desks become independent seating
    surplus_chairs = max(0, desk_chair_qty - desk_qty)
    normal_occ += surplus_chairs
    max_occ += surplus_chairs

    free_area = max(0, area_m2 - used_area)

    # Rooms with only zero-occ furnishings (storage, equipment) still need
    # at least 1 person to access them
    if normal_occ == 0 and max_occ == 0 and area_m2 >= 2 and furnishings:
        normal_occ = 1
        max_occ = 1

    # Absolute occupancy: max_occ + standing people in remaining space
    egress_reserve = num_doors * EGRESS_RESERVE_PER_DOOR
    furniture_buffer = used_area * FURNITURE_BUFFER_FACTOR
    standable_area = max(0, free_area - egress_reserve - furniture_buffer)
    standing_extra = math.floor(standable_area / STANDING_DENSITY_M2)
    absolute_occ = max_occ + standing_extra

    return {
        "normal_occupancy": normal_occ,
        "max_occupancy": max_occ,
        "absolute_occupancy": absolute_occ,
        "used_area_m2": round(used_area, 2),
        "free_area_m2": round(free_area, 2),
    }
