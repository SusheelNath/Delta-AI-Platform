"""
Furnishing type catalog and rule-based seeder for Office Campus (Abu Dhabi).

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
    # ── Beds (campus-relevant only) ──
    ("single_bed",          "bed",       "Single Bed (Studio)",   3.5, 1, 2),
    ("examination_table",   "bed",       "Examination Table",     3.0, 1, 2),

    # ── Seating ──
    ("visitor_chair",       "seating",   "Visitor Chair",         0.8, 1, 1),
    ("desk_chair",          "seating",   "Desk Chair",            1.2, 1, 1),
    ("waiting_bench",       "seating",   "Waiting Bench",         1.8, 3, 4),
    ("stool",               "seating",   "Stool",                 0.4, 1, 1),
    ("sofa",                "seating",   "Sofa",                  2.5, 2, 3),
    ("recliner",            "seating",   "Recliner",              1.5, 1, 1),
    ("bar_stool",           "seating",   "Bar Stool",             0.4, 1, 1),
    ("lounge_chair",        "seating",   "Lounge Chair",          1.2, 1, 1),
    ("ergonomic_chair",     "seating",   "Ergonomic Chair",       1.2, 1, 1),

    # ── Storage ──
    ("wardrobe",            "storage",   "Wardrobe",              0.6, 0, 0),
    ("closet",              "storage",   "Closet",                0.5, 0, 0),
    ("cabinet",             "storage",   "Cabinet",               0.4, 0, 0),
    ("shelving",            "storage",   "Shelving Unit",         0.5, 0, 0),
    ("locker",              "storage",   "Locker",                0.3, 0, 0),
    ("filing_cabinet",      "storage",   "Filing Cabinet",        0.4, 0, 0),
    ("waste_bin",           "storage",   "Waste Bin",             0.2, 0, 0),
    ("recycling_bin",       "storage",   "Recycling Bin",         0.2, 0, 0),
    ("coat_rack",           "storage",   "Coat Rack",             0.3, 0, 0),
    ("supply_cart",         "storage",   "Supply Cart",           0.5, 0, 0),
    ("tool_cabinet",        "storage",   "Tool Cabinet",          0.5, 0, 0),

    # ── Office / IT Equipment ──
    ("computer",            "equipment", "Computer Workstation",  0.5, 0, 0),
    ("monitor_screen",      "equipment", "Monitor (Desk)",        0.2, 0, 0),
    ("printer",             "equipment", "Printer / Copier",      0.8, 0, 0),
    ("server_rack",         "equipment", "Server Rack",           1.0, 0, 0),
    ("projector",           "equipment", "Projector",             0.3, 0, 0),
    ("display_screen",      "equipment", "Display Screen",        0.2, 0, 0),
    ("presentation_screen", "equipment", "Presentation Screen",   0.5, 0, 0),
    ("video_conference_unit","equipment","Video Conference Unit",  0.3, 0, 0),
    ("telephone",           "equipment", "Telephone",             0.1, 0, 0),
    ("intercom",            "equipment", "Intercom",              0.0, 0, 0),
    ("whiteboard",          "equipment", "Whiteboard",            0.5, 0, 0),
    ("acoustic_panel",      "equipment", "Acoustic Panel",        0.1, 0, 0),

    # ── Fixtures ──
    ("sink",                "fixture",   "Sink",                  0.4, 0, 0),
    ("toilet",              "fixture",   "Toilet",                1.2, 0, 0),
    ("shower",              "fixture",   "Shower",                1.5, 0, 0),
    ("ablution_fixture",    "fixture",   "Ablution Fixture",      0.6, 0, 0),
    ("hand_sanitizer",      "fixture",   "Hand Sanitizer Station",0.1, 0, 0),
    ("fire_extinguisher",   "fixture",   "Fire Extinguisher",     0.1, 0, 0),
    ("water_fountain",      "fixture",   "Water Fountain",        0.3, 0, 0),
    ("mirror",              "fixture",   "Mirror",                0.0, 0, 0),
    ("soap_dispenser",      "fixture",   "Soap Dispenser",        0.0, 0, 0),
    ("paper_towel_dispenser","fixture",  "Paper Towel Dispenser", 0.0, 0, 0),
    ("grab_bar",            "fixture",   "Grab Bar",              0.0, 0, 0),
    ("bike_rack",           "fixture",   "Bike Rack",             1.5, 0, 0),
    ("stroller_parking_spot","fixture",  "Stroller Parking Spot", 1.2, 0, 0),
    ("prayer_mat",          "fixture",   "Prayer Mat",            1.2, 1, 1),

    # ── Furniture ──
    ("desk",                "furniture", "Desk",                  2.0, 1, 1),
    ("standing_desk",       "furniture", "Standing Desk",         2.0, 1, 1),
    ("sit_stand_desk",      "furniture", "Sit-Stand Desk",        2.0, 1, 1),
    ("hot_desk_station",    "furniture", "Hot Desk Station",      1.8, 1, 1),
    ("reception_desk",      "furniture", "Reception Desk",        4.0, 1, 2),
    ("workbench",           "furniture", "Workbench",             3.0, 1, 2),
    ("table",               "furniture", "Table",                 1.8, 0, 0),
    ("conference_table",    "furniture", "Conference Table",      4.0, 0, 0),
    ("dining_table",        "furniture", "Dining Table",          2.5, 0, 0),
    ("countertop",          "furniture", "Countertop",            1.5, 0, 0),
    ("bedside_table",       "furniture", "Bedside Table",         0.3, 0, 0),
    ("room_divider",        "furniture", "Room Divider / Screen", 1.0, 0, 0),
    ("bookshelf",           "furniture", "Bookshelf",             0.5, 0, 0),
    ("notice_board",        "furniture", "Notice Board",          0.0, 0, 0),
    ("sign_board",          "furniture", "Sign Board",            0.0, 0, 0),
    ("podium",              "furniture", "Podium / Lectern",      0.5, 0, 0),
    ("phone_booth",         "furniture", "Phone Booth / Pod",     1.5, 1, 1),

    # ── Kitchen / Food Service ──
    ("refrigerator",        "appliance", "Refrigerator",          0.8, 0, 0),
    ("microwave",           "appliance", "Microwave",             0.3, 0, 0),
    ("oven",                "appliance", "Oven",                  0.8, 0, 0),
    ("dishwasher",          "appliance", "Dishwasher",            0.6, 0, 0),
    ("coffee_machine",      "appliance", "Coffee Machine",        0.3, 0, 0),
    ("vending_machine",     "appliance", "Vending Machine",       1.0, 0, 0),
    ("ice_machine",         "appliance", "Ice Machine",           0.5, 0, 0),
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
]


# ══════════════════════════════════════════════════════════════════════
# Excluded function patterns - these rooms NEVER get furnishings
# ══════════════════════════════════════════════════════════════════════

EXCLUDED_PATTERNS = [
    "staircase", "stairway", "stair ", "stair-core", "vertical circulation",
    "shaft", "vent shaft", "ventilation", "vent",
    "no access", "no acccess", "no infrastructure",
    "parking", "ramp",
    "bicycle parking", "stroller parking",
    "airlock", "lobby", "transition",
    "basement",
    "waste",
    "technical", "plant room", "building-services",
    "core / technical",
    "staircasse",  # typo in data
    "loading",
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
    # ═══════════════════ OFFICE / KANTOOR ═══════════════════
    (["office", "kantoor", "bureau", "workroom"],
     [("desk", 1), ("desk_chair", 1), ("monitor_screen", 1), ("cabinet", 1),
      ("filing_cabinet", 1), ("computer", 1), ("telephone", 1),
      ("waste_bin", 1), ("recycling_bin", 1)],
     {"min_area": 5,
      "scale": {"desk": {"per_m2": 8, "min": 1, "max": 8},
                "desk_chair": {"per_m2": 8, "min": 1, "max": 8},
                "monitor_screen": {"per_m2": 8, "min": 1, "max": 8},
                "computer": {"per_m2": 8, "min": 1, "max": 8}}}),

    # ═══════════════════ COWORKING / OPEN PLAN ═══════════════════
    (["coworking", "co-working", "open plan", "open office", "flex space"],
     [("hot_desk_station", 4), ("desk_chair", 4), ("monitor_screen", 4),
      ("locker", 4), ("phone_booth", 1), ("printer", 1),
      ("water_cooler", 1), ("waste_bin", 2), ("recycling_bin", 2)],
     {"min_area": 20,
      "scale": {"hot_desk_station": {"per_m2": 6, "min": 2, "max": 40},
                "desk_chair": {"per_m2": 6, "min": 2, "max": 40},
                "monitor_screen": {"per_m2": 6, "min": 2, "max": 40},
                "locker": {"per_m2": 6, "min": 2, "max": 40},
                "phone_booth": {"per_m2": 50, "min": 1, "max": 6}}}),

    # ═══════════════════ SEMINAR ROOM / SEMINARIEZAAL ═══════════════════
    (["seminar", "seminariezaal", "lecture", "auditorium", "assembly"],
     [("conference_table", 1), ("desk_chair", 12), ("projector", 1),
      ("presentation_screen", 1), ("podium", 1), ("whiteboard", 1),
      ("display_screen", 1), ("waste_bin", 1)],
     {"min_area": 20,
      "scale": {"desk_chair": {"per_m2": 3, "min": 8, "max": 60}}}),

    # ═══════════════════ MEETING ROOM / VERGADERZAAL ═══════════════════
    (["meeting", "vergaderzaal", "conference", "boardroom", "debrief",
      "gathering"],
     [("conference_table", 1), ("desk_chair", 6), ("display_screen", 1),
      ("video_conference_unit", 1), ("whiteboard", 1), ("waste_bin", 1)],
     {"min_area": 8,
      "scale": {"desk_chair": {"per_m2": 4, "min": 4, "max": 24}}}),

    # ═══════════════════ MULTIPURPOSE ROOM ═══════════════════
    (["multipurpose", "multi-purpose", "polyvalent", "flexible room"],
     [("table", 4), ("visitor_chair", 12), ("projector", 1),
      ("presentation_screen", 1), ("display_screen", 1),
      ("podium", 1), ("waste_bin", 2)],
     {"min_area": 15,
      "scale": {"table": {"per_m2": 10, "min": 2, "max": 20},
                "visitor_chair": {"per_m2": 3, "min": 6, "max": 60}}}),

    # ═══════════════════ STUDIO APARTMENT ═══════════════════
    (["studio apartment", "studio", "residential unit", "accommodation"],
     [("single_bed", 1), ("bedside_table", 1), ("desk", 1), ("desk_chair", 1),
      ("wardrobe", 1), ("countertop", 1), ("sink", 1), ("microwave", 1),
      ("refrigerator", 1), ("waste_bin", 1)],
     {"min_area": 15}),

    # ═══════════════════ CAFE ═══════════════════
    (["caf\u00e9", "cafe", "cafeteria", "restaurant", "canteen"],
     [("dining_table", 4), ("visitor_chair", 16), ("countertop", 2),
      ("coffee_machine", 1), ("refrigerator", 1), ("microwave", 1),
      ("water_cooler", 1), ("waste_bin", 3), ("recycling_bin", 2),
      ("hand_sanitizer", 1), ("vending_machine", 1)],
     {"min_area": 20,
      "scale": {"dining_table": {"per_m2": 12, "min": 2, "max": 20},
                "visitor_chair": {"per_m2": 3, "min": 8, "max": 80},
                "waste_bin": {"per_m2": 50, "min": 2, "max": 10}}}),

    # ═══════════════════ KITCHENETTE / PANTRY ═══════════════════
    (["kitchenette", "pantry", "tea point", "break room"],
     [("countertop", 1), ("sink", 1), ("microwave", 1), ("refrigerator", 1),
      ("coffee_machine", 1), ("waste_bin", 1), ("recycling_bin", 1),
      ("water_cooler", 1)],
     {"min_area": 3}),

    # ═══════════════════ PRAYER / WORSHIP ROOM ═══════════════════
    (["prayer", "worship", "musalla", "meditation"],
     [("prayer_mat", 6), ("shelving", 1), ("ablution_fixture", 2),
      ("waste_bin", 1)],
     {"min_area": 6,
      "scale": {"prayer_mat": {"per_m2": 2, "min": 4, "max": 40},
                "ablution_fixture": {"per_m2": 15, "min": 1, "max": 8}}}),

    # ═══════════════════ WAITING / LOUNGE ═══════════════════
    (["waiting room", "waiting", "lounge", "day room", "break area"],
     [("waiting_bench", 2), ("visitor_chair", 3), ("sofa", 1),
      ("water_fountain", 1), ("hand_sanitizer", 1), ("waste_bin", 1),
      ("display_screen", 1), ("coffee_machine", 1)],
     {"min_area": 8,
      "scale": {"waiting_bench": {"per_m2": 8, "min": 2, "max": 12},
                "visitor_chair": {"per_m2": 6, "min": 2, "max": 20},
                "sofa": {"per_m2": 20, "min": 1, "max": 4}}}),

    # ═══════════════════ MAIN HALL / LOBBY ═══════════════════
    (["main hall", "foyer"],
     [("waiting_bench", 6), ("visitor_chair", 10), ("sofa", 2),
      ("water_fountain", 2), ("hand_sanitizer", 3), ("waste_bin", 4),
      ("display_screen", 2), ("sign_board", 2), ("aed", 1),
      ("fire_extinguisher", 2), ("vending_machine", 2), ("notice_board", 1)],
     {"min_area": 100,
      "scale": {"waiting_bench": {"per_m2": 40, "min": 4, "max": 40},
                "visitor_chair": {"per_m2": 25, "min": 6, "max": 60},
                "waste_bin": {"per_m2": 100, "min": 2, "max": 15},
                "hand_sanitizer": {"per_m2": 150, "min": 2, "max": 10}}}),

    # ═══════════════════ RECEPTION ═══════════════════
    (["reception", "intake", "front desk"],
     [("reception_desk", 1), ("desk_chair", 2), ("visitor_chair", 4),
      ("cabinet", 1), ("computer", 1), ("telephone", 1), ("printer", 1),
      ("display_screen", 1), ("hand_sanitizer", 1), ("waste_bin", 1)],
     {"min_area": 6,
      "scale": {"visitor_chair": {"per_m2": 8, "min": 2, "max": 12},
                "desk_chair": {"per_m2": 15, "min": 1, "max": 4}}}),

    # ═══════════════════ STORAGE ═══════════════════
    (["storage", "store room", "archive", "reserve"],
     [("shelving", 2), ("cabinet", 1), ("fire_extinguisher", 1)],
     {"min_area": 3,
      "scale": {"shelving": {"per_m2": 6, "min": 1, "max": 30},
                "cabinet": {"per_m2": 20, "min": 1, "max": 10}}}),

    # ═══════════════════ LOCKER ROOM / CHANGING ═══════════════════
    (["locker", "changing", "kleedkamer"],
     [("locker", 6), ("waiting_bench", 2), ("mirror", 1), ("waste_bin", 1)],
     {"min_area": 4,
      "scale": {"locker": {"per_m2": 2, "min": 4, "max": 30},
                "waiting_bench": {"per_m2": 8, "min": 1, "max": 6}}}),

    # ═══════════════════ WORKSHOP / ATELIER ═══════════════════
    (["workshop", "atelier", "makerspace", "maker space", "fab lab"],
     [("workbench", 2), ("stool", 2), ("shelving", 2), ("tool_cabinet", 1),
      ("fire_extinguisher", 1), ("first_aid_kit", 1), ("waste_bin", 1)],
     {"min_area": 8,
      "scale": {"workbench": {"per_m2": 15, "min": 1, "max": 8},
                "stool": {"per_m2": 8, "min": 1, "max": 10},
                "shelving": {"per_m2": 10, "min": 1, "max": 10}}}),

    # ═══════════════════ CONTROL CENTRE ═══════════════════
    (["control centre", "control center", "control room", "control"],
     [("desk", 3), ("desk_chair", 3), ("monitor_screen", 6),
      ("display_screen", 2), ("computer", 3), ("telephone", 1)],
     {"min_area": 8,
      "scale": {"desk": {"per_m2": 8, "min": 2, "max": 10},
                "desk_chair": {"per_m2": 8, "min": 2, "max": 10},
                "monitor_screen": {"per_m2": 4, "min": 4, "max": 20},
                "display_screen": {"per_m2": 15, "min": 1, "max": 6}}}),

    # ═══════════════════ FIRST AID / EHBO ═══════════════════
    (["first aid", "ehbo", "medical room", "sick bay", "infirmary"],
     [("examination_table", 1), ("first_aid_kit", 1), ("sink", 1),
      ("cabinet", 1), ("desk", 1), ("desk_chair", 1), ("visitor_chair", 1),
      ("waste_bin", 1), ("hand_sanitizer", 1)],
     {"min_area": 6}),

    # ═══════════════════ SURVEILLANCE / SECURITY ═══════════════════
    (["surveillance", "security", "bewaking"],
     [("desk", 2), ("desk_chair", 2), ("monitor_screen", 4),
      ("display_screen", 2), ("computer", 2), ("telephone", 1),
      ("cctv_camera", 1), ("access_control", 1)],
     {"min_area": 6,
      "scale": {"monitor_screen": {"per_m2": 4, "min": 2, "max": 12},
                "display_screen": {"per_m2": 10, "min": 1, "max": 6}}}),

    # ═══════════════════ SANITARY / WC ═══════════════════
    (["toilet", "wc", "washroom", "sanitary", "sanitation", "ensuite",
      "shower / wash", "assisted bathroom", "bathing room", "restroom"],
     [("toilet", 1), ("sink", 1), ("hand_sanitizer", 1), ("soap_dispenser", 1),
      ("paper_towel_dispenser", 1), ("mirror", 1), ("waste_bin", 1)],
     {"min_area": 2.0,
      "scale": {"toilet": {"per_m2": 6, "min": 1, "max": 20},
                "sink": {"per_m2": 10, "min": 1, "max": 12}}}),

    # ═══════════════════ ACCESSIBILITY TOILET ═══════════════════
    (["accessibility toilet", "accessible toilet", "adapted toilet"],
     [("toilet", 1), ("sink", 1), ("grab_bar", 3), ("hand_sanitizer", 1),
      ("soap_dispenser", 1), ("paper_towel_dispenser", 1), ("mirror", 1),
      ("waste_bin", 1)],
     {"min_area": 3}),

    (["shower"],
     [("shower", 1), ("sink", 1), ("grab_bar", 1), ("mirror", 1),
      ("soap_dispenser", 1), ("waste_bin", 1)],
     {"min_area": 2}),

    # ═══════════════════ ABLUTION ═══════════════════
    (["ablution", "wudu"],
     [("ablution_fixture", 4), ("sink", 2), ("soap_dispenser", 2),
      ("waste_bin", 1)],
     {"min_area": 4,
      "scale": {"ablution_fixture": {"per_m2": 3, "min": 2, "max": 12},
                "sink": {"per_m2": 6, "min": 1, "max": 8}}}),

    # ═══════════════════ SERVER ROOM ═══════════════════
    (["server room", "server", "data room", "comms room"],
     [("server_rack", 2), ("ups_unit", 1), ("fire_extinguisher", 1),
      ("cctv_camera", 1), ("electrical_panel", 1)],
     {"min_area": 5,
      "scale": {"server_rack": {"per_m2": 6, "min": 1, "max": 10}}}),

    # ═══════════════════ RETAIL / COMMERCIAL ═══════════════════
    (["convenience store", "supermarket", "store", "commercial", "retail",
      "shop"],
     [("countertop", 1), ("shelving", 3), ("display_screen", 1),
      ("waste_bin", 1)],
     {"min_area": 5,
      "scale": {"shelving": {"per_m2": 6, "min": 2, "max": 25}}}),

    # ═══════════════════ COLD STORAGE ═══════════════════
    (["cold storage"],
     [("refrigerator", 2), ("shelving", 2), ("fire_extinguisher", 1)],
     {"min_area": 3,
      "scale": {"refrigerator": {"per_m2": 6, "min": 1, "max": 8},
                "shelving": {"per_m2": 8, "min": 1, "max": 10}}}),

    # ═══════════════════ HOUSEKEEPING / CLEANING ═══════════════════
    (["housekeeping", "cleaning room", "janitor", "laundry"],
     [("sink", 1), ("shelving", 2), ("cabinet", 1), ("supply_cart", 1),
      ("waste_bin", 1)],
     {"min_area": 3}),

    # ═══════════════════ STAFF ROOM ═══════════════════
    (["staff room", "staff access", "staff"],
     [("desk", 1), ("desk_chair", 2), ("visitor_chair", 2), ("cabinet", 1),
      ("countertop", 1), ("sink", 1), ("coffee_machine", 1), ("microwave", 1),
      ("refrigerator", 1), ("locker", 2), ("waste_bin", 1)],
     {"min_area": 5,
      "scale": {"desk": {"per_m2": 10, "min": 1, "max": 8},
                "desk_chair": {"per_m2": 8, "min": 2, "max": 12},
                "visitor_chair": {"per_m2": 10, "min": 1, "max": 6},
                "locker": {"per_m2": 5, "min": 2, "max": 12}}}),

    # ═══════════════════ ENTRANCE ═══════════════════
    (["entrance"],
     [("reception_desk", 1), ("desk_chair", 1), ("visitor_chair", 2),
      ("display_screen", 1), ("cctv_camera", 1), ("aed", 1),
      ("hand_sanitizer", 1), ("waste_bin", 1)],
     {"min_area": 10}),

    # ═══════════════════ SUPPORT / SERVICE SPACE ═══════════════════
    (["support/service space", "department support", "support"],
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
# Beds/examination tables are independent stations - each generates occupancy.
_BED_TYPES = {
    "single_bed", "examination_table",
}
# Desks need chairs to generate occupancy (paired workstations).
_DESK_TYPES = {
    "desk", "standing_desk", "sit_stand_desk", "hot_desk_station",
}
_DESK_CHAIR_TYPE = "desk_chair"
# Independent seating - generates occupancy without needing a desk/bed.
_INDEPENDENT_SEATING = {
    "visitor_chair", "waiting_bench", "stool",
    "lounge_chair", "bar_stool", "ergonomic_chair",
    "prayer_mat", "phone_booth",
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
      1. Beds/examination tables - independent stations, use catalog
         normal/max occ per item.
      2. Desks + desk chairs - paired workstations.  Occupied stations =
         min(desks, desk_chairs).  Each station = 1 normal, 1 max.
         Surplus desk chairs (beyond desk count) spill into independent
         seating (1 normal, 1 max each).
      3. Independent seating (visitor chairs, benches, stools, lounge chairs,
         bar stools, prayer mats, phone booths) - each generates its catalog
         normal/max occ.
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

        elif f.item_type in _DESK_TYPES:
            # All desk variants tallied for pairing - no occupancy on their own
            desk_qty += f.quantity

        elif f.item_type == _DESK_CHAIR_TYPE:
            # Desk chairs tallied for pairing - resolved below
            desk_chair_qty += f.quantity

        elif f.item_type in _INDEPENDENT_SEATING:
            # Independent seating - catalog values apply directly
            normal_occ += ft.normal_occ * f.quantity
            max_occ += ft.max_occ * f.quantity

        # else: tables, countertops, equipment, storage, fixtures -> 0 occ

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
