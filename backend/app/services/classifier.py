"""
Function Classifier: derives space metadata from primary_function keywords.

Maps primary_function strings to structured properties:
  functional_zone, space_class, accessible, bookable, access_level,
  privacy_level, noise_sensitivity, visitor_access, flexibility,
  convertible_functions, secondary_functions.

Same keyword-matching pattern as furnishing rules.
Static defaults that work out of the box - the AI layer can override any field.

Context: Office campus, Abu Dhabi (UAE).
Regulatory references: ADIBC (Abu Dhabi International Building Code),
Estidama Pearl Rating System, UAE Fire & Life Safety Code.
"""

# ══════════════════════════════════════════════════════════════════════
# Default metadata (returned when no rule matches)
# ══════════════════════════════════════════════════════════════════════

DEFAULT_METADATA = {
    "functional_zone": "General",
    "space_class": "Support",
    "accessible": "ADIBC compliant",
    "bookable": "No",
    "access_level": "Tenant",
    "privacy_level": "Low",
    "noise_sensitivity": "Low",
    "visitor_access": "None",
    "flexibility": "Medium",
    "convertible_functions": None,
    "secondary_functions": None,
}


# ══════════════════════════════════════════════════════════════════════
# Classification rules
# ══════════════════════════════════════════════════════════════════════
#
# Each rule: (keywords_list, metadata_dict)
#   keywords: list of case-insensitive substrings (first match wins)
#   metadata: dict of property overrides (merged onto DEFAULT_METADATA)
#
# Rule order matters - more specific keywords must come before generic ones.

FUNCTION_METADATA_RULES = [

    # ═══════════════════ OFFICE (kantoor) ═══════════════════
    (["kantoor", "office", "bureau", "workroom"],
     {
         "functional_zone": "Work",
         "space_class": "Workspace",
         "accessible": "ADIBC compliant",
         "bookable": "No",
         "access_level": "Tenant",
         "privacy_level": "Medium",
         "noise_sensitivity": "Medium",
         "visitor_access": "By appointment",
         "flexibility": "High",
         "convertible_functions": "Meeting room, coworking",
         "secondary_functions": "Focused work, documentation, calls",
     }),

    # ═══════════════════ COWORKING SPACE ═══════════════════
    (["coworking", "co-working", "hot desk", "flex desk", "open workspace"],
     {
         "functional_zone": "Work",
         "space_class": "Workspace",
         "accessible": "ADIBC compliant",
         "bookable": "Yes",
         "access_level": "Campus",
         "privacy_level": "Low",
         "noise_sensitivity": "Low",
         "visitor_access": "Open",
         "flexibility": "Very high",
         "convertible_functions": "Event space, workshop, training",
         "secondary_functions": "Collaborative work, networking, drop-in desks",
     }),

    # ═══════════════════ SEMINAR ROOM (seminariezaal) ═══════════════════
    (["seminariezaal", "seminarie zaal", "seminar", "lecture hall",
      "auditorium"],
     {
         "functional_zone": "Meeting & Events",
         "space_class": "Meeting",
         "accessible": "ADIBC compliant",
         "bookable": "Yes",
         "access_level": "Campus",
         "privacy_level": "Low",
         "noise_sensitivity": "Medium",
         "visitor_access": "By invitation",
         "flexibility": "High",
         "convertible_functions": "Conference, workshop, training, presentation",
         "secondary_functions": "Lectures, public talks, panel discussions",
     }),

    # ═══════════════════ MEETING ROOM (vergaderzaal) ═══════════════════
    (["vergaderzaal", "meeting room", "meeting", "conference"],
     {
         "functional_zone": "Meeting & Events",
         "space_class": "Meeting",
         "accessible": "ADIBC compliant",
         "bookable": "Yes",
         "access_level": "Tenant",
         "privacy_level": "Medium",
         "noise_sensitivity": "Medium",
         "visitor_access": "By invitation",
         "flexibility": "High",
         "convertible_functions": "Training room, interview room, video-conference",
         "secondary_functions": "Team meetings, client presentations, reviews",
     }),

    # ═══════════════════ MULTIPURPOSE ROOM (polyvalente ruimte) ═══════════════════
    (["polyvalente ruimte", "polyvalent ruimte", "multipurpose",
      "multi-purpose", "multi purpose", "flex room", "event space"],
     {
         "functional_zone": "Meeting & Events",
         "space_class": "Meeting",
         "accessible": "ADIBC compliant",
         "bookable": "Yes",
         "access_level": "Campus",
         "privacy_level": "Low",
         "noise_sensitivity": "Low",
         "visitor_access": "Open",
         "flexibility": "Very high",
         "convertible_functions": "Exhibition, workshop, dining event, town hall",
         "secondary_functions": "Community events, pop-ups, hackathons",
     }),

    # ═══════════════════ STUDIO APARTMENT (studio 1sk) ═══════════════════
    (["studio 1sk", "studio apartment", "studio apt", "residential unit"],
     {
         "functional_zone": "Residential",
         "space_class": "Residential",
         "accessible": "ADIBC compliant",
         "bookable": "No",
         "access_level": "Private",
         "privacy_level": "Very high",
         "noise_sensitivity": "High",
         "visitor_access": "Resident only",
         "flexibility": "Low",
         "convertible_functions": "Short-stay accommodation, visiting researcher unit",
         "secondary_functions": "Living, sleeping, personal kitchen & bath",
     }),

    # ═══════════════════ CAFE ═══════════════════
    (["cafe", "café", "coffee", "canteen", "cafeteria", "restaurant",
      "food court"],
     {
         "functional_zone": "Amenity",
         "space_class": "Amenity",
         "accessible": "ADIBC compliant",
         "bookable": "No",
         "access_level": "Public",
         "privacy_level": "Low",
         "noise_sensitivity": "Low",
         "visitor_access": "Open",
         "flexibility": "Medium",
         "convertible_functions": "Informal meeting area, networking event",
         "secondary_functions": "Dining, informal meetings, breaks",
     }),

    # ═══════════════════ KITCHENETTE ═══════════════════
    (["kitchenette", "pantry", "tea point", "breakroom", "break room"],
     {
         "functional_zone": "Amenity",
         "space_class": "Amenity",
         "accessible": "ADIBC compliant",
         "bookable": "No",
         "access_level": "Tenant",
         "privacy_level": "Low",
         "noise_sensitivity": "Low",
         "visitor_access": "None",
         "flexibility": "Medium",
         "convertible_functions": "Pantry, beverage station",
         "secondary_functions": "Meal preparation, beverages, informal chat",
     }),

    # ═══════════════════ CORRIDOR (gang) ═══════════════════
    (["gang", "corridor", "hallway", "circulation"],
     {
         "functional_zone": "Circulation",
         "space_class": "Infrastructure",
         "accessible": "ADIBC compliant",
         "bookable": "No",
         "access_level": "Public",
         "privacy_level": "None",
         "noise_sensitivity": "Low",
         "visitor_access": "Open",
         "flexibility": "None",
         "convertible_functions": None,
         "secondary_functions": "Horizontal circulation, wayfinding, emergency egress",
     }),

    # ═══════════════════ STAIRCASE (trap) ═══════════════════
    (["trap", "staircase", "stairway", "stair"],
     {
         "functional_zone": "Circulation",
         "space_class": "Infrastructure",
         "accessible": "No",
         "bookable": "No",
         "access_level": "Public",
         "privacy_level": "None",
         "noise_sensitivity": "Low",
         "visitor_access": "Open",
         "flexibility": "None",
         "convertible_functions": None,
         "secondary_functions": "Vertical circulation, emergency egress (UAE Fire Code)",
     }),

    # ═══════════════════ STAIRWELL (trappenhal) ═══════════════════
    (["trappenhal", "stairwell", "stair hall", "fire stair"],
     {
         "functional_zone": "Circulation",
         "space_class": "Infrastructure",
         "accessible": "No",
         "bookable": "No",
         "access_level": "Public",
         "privacy_level": "None",
         "noise_sensitivity": "Low",
         "visitor_access": "Open",
         "flexibility": "None",
         "convertible_functions": None,
         "secondary_functions": "Fire egress, smoke-free refuge (UAE Fire Code)",
     }),

    # ═══════════════════ VESTIBULE (sas) ═══════════════════
    (["sas", "vestibule", "airlock", "lobby", "entrance hall", "foyer"],
     {
         "functional_zone": "Circulation",
         "space_class": "Infrastructure",
         "accessible": "ADIBC compliant",
         "bookable": "No",
         "access_level": "Public",
         "privacy_level": "None",
         "noise_sensitivity": "Low",
         "visitor_access": "Open",
         "flexibility": "Low",
         "convertible_functions": None,
         "secondary_functions": "Access transition, climate buffer, wayfinding",
     }),

    # ═══════════════════ ELEVATOR / LIFT ═══════════════════
    (["elevator", "lift", "ascenseur"],
     {
         "functional_zone": "Circulation",
         "space_class": "Infrastructure",
         "accessible": "ADIBC compliant",
         "bookable": "No",
         "access_level": "Public",
         "privacy_level": "None",
         "noise_sensitivity": "Low",
         "visitor_access": "Open",
         "flexibility": "None",
         "convertible_functions": None,
         "secondary_functions": "Vertical transport, accessibility",
     }),

    # ═══════════════════ SANITARY FACILITIES (sanitair) ═══════════════════
    (["sanitair / douches", "sanitary / shower", "sanitary/shower"],
     {
         "functional_zone": "Sanitary",
         "space_class": "Service",
         "accessible": "ADIBC compliant",
         "bookable": "No",
         "access_level": "Tenant",
         "privacy_level": "High",
         "noise_sensitivity": "Low",
         "visitor_access": "None",
         "flexibility": "Very low",
         "convertible_functions": None,
         "secondary_functions": "Hygiene, showers, changing",
     }),

    (["sanitair m", "sanitary men", "sanitary (men)", "men's restroom"],
     {
         "functional_zone": "Sanitary",
         "space_class": "Service",
         "accessible": "ADIBC compliant",
         "bookable": "No",
         "access_level": "Campus",
         "privacy_level": "High",
         "noise_sensitivity": "Low",
         "visitor_access": "Open",
         "flexibility": "Very low",
         "convertible_functions": None,
         "secondary_functions": "Hygiene, personal care",
     }),

    (["sanitair v", "sanitary women", "sanitary (women)", "women's restroom"],
     {
         "functional_zone": "Sanitary",
         "space_class": "Service",
         "accessible": "ADIBC compliant",
         "bookable": "No",
         "access_level": "Campus",
         "privacy_level": "High",
         "noise_sensitivity": "Low",
         "visitor_access": "Open",
         "flexibility": "Very low",
         "convertible_functions": None,
         "secondary_functions": "Hygiene, personal care",
     }),

    (["sanitair", "sanitary", "toilet", "wc", "washroom", "restroom",
      "lavatory"],
     {
         "functional_zone": "Sanitary",
         "space_class": "Service",
         "accessible": "ADIBC compliant",
         "bookable": "No",
         "access_level": "Campus",
         "privacy_level": "High",
         "noise_sensitivity": "Low",
         "visitor_access": "Open",
         "flexibility": "Very low",
         "convertible_functions": None,
         "secondary_functions": "Hygiene, personal care",
     }),

    # ═══════════════════ SHOWERS (douches) ═══════════════════
    (["douches", "shower"],
     {
         "functional_zone": "Sanitary",
         "space_class": "Service",
         "accessible": "ADIBC compliant",
         "bookable": "No",
         "access_level": "Tenant",
         "privacy_level": "High",
         "noise_sensitivity": "Low",
         "visitor_access": "None",
         "flexibility": "Very low",
         "convertible_functions": None,
         "secondary_functions": "Staff showers, post-exercise hygiene",
     }),

    # ═══════════════════ WATER / UTILITY ═══════════════════
    (["water", "utility water", "plumbing"],
     {
         "functional_zone": "Sanitary",
         "space_class": "Service",
         "accessible": "Controlled",
         "bookable": "No",
         "access_level": "Facilities",
         "privacy_level": "Low",
         "noise_sensitivity": "Low",
         "visitor_access": "None",
         "flexibility": "Very low",
         "convertible_functions": None,
         "secondary_functions": "Water supply, plumbing access, Estidama water efficiency",
     }),

    # ═══════════════════ STORAGE ROOM (berging) ═══════════════════
    (["berging", "storage", "store room", "archive", "reserve"],
     {
         "functional_zone": "Support",
         "space_class": "Support",
         "accessible": "Controlled",
         "bookable": "No",
         "access_level": "Tenant",
         "privacy_level": "Low",
         "noise_sensitivity": "Low",
         "visitor_access": "None",
         "flexibility": "High",
         "convertible_functions": "Additional storage, equipment staging",
         "secondary_functions": "Material storage, supplies, archive",
     }),

    # ═══════════════════ LOCKERS & STROLLER PARKING ═══════════════════
    (["lockers + kinderwagen", "lockers & stroller", "locker stroller"],
     {
         "functional_zone": "Support",
         "space_class": "Support",
         "accessible": "ADIBC compliant",
         "bookable": "No",
         "access_level": "Campus",
         "privacy_level": "Low",
         "noise_sensitivity": "Low",
         "visitor_access": "Open",
         "flexibility": "Medium",
         "convertible_functions": "General storage, parcel collection",
         "secondary_functions": "Personal storage, stroller/pushchair parking",
     }),

    # ═══════════════════ LOCKER ROOM ═══════════════════
    (["locker", "changing room", "kleedkamer"],
     {
         "functional_zone": "Support",
         "space_class": "Support",
         "accessible": "ADIBC compliant",
         "bookable": "No",
         "access_level": "Tenant",
         "privacy_level": "Medium",
         "noise_sensitivity": "Low",
         "visitor_access": "None",
         "flexibility": "Medium",
         "convertible_functions": "Storage, secure parcel area",
         "secondary_functions": "Personal storage, changing, cycle commuter facilities",
     }),

    # ═══════════════════ WASTE ROOM (afvalruimte) ═══════════════════
    (["afvalruimte", "waste", "refuse", "bin store", "garbage"],
     {
         "functional_zone": "Facility Services",
         "space_class": "Support",
         "accessible": "Controlled",
         "bookable": "No",
         "access_level": "Facilities",
         "privacy_level": "Low",
         "noise_sensitivity": "Low",
         "visitor_access": "None",
         "flexibility": "Low",
         "convertible_functions": None,
         "secondary_functions": "Waste segregation, recycling (Estidama MR-R1)",
     }),

    # ═══════════════════ BICYCLE PARKING ═══════════════════
    (["fietsenstalling", "bicycle", "bike parking", "cycle store"],
     {
         "functional_zone": "Support",
         "space_class": "Infrastructure",
         "accessible": "ADIBC compliant",
         "bookable": "No",
         "access_level": "Campus",
         "privacy_level": "None",
         "noise_sensitivity": "Low",
         "visitor_access": "Open",
         "flexibility": "Low",
         "convertible_functions": "Micro-mobility hub, scooter parking",
         "secondary_functions": "Bicycle storage, sustainable transport (Estidama LBo-3)",
     }),

    # ═══════════════════ TECHNICAL ROOM (technieken) ═══════════════════
    (["technieken", "technical room", "plant room", "building services",
      "mep room"],
     {
         "functional_zone": "Technical",
         "space_class": "Infrastructure",
         "accessible": "Controlled",
         "bookable": "No",
         "access_level": "Facilities",
         "privacy_level": "Low",
         "noise_sensitivity": "Low",
         "visitor_access": "None",
         "flexibility": "Very low",
         "convertible_functions": None,
         "secondary_functions": "MEP equipment, building systems maintenance",
     }),

    # ═══════════════════ TECHNICAL / DATA ROOM ═══════════════════
    (["tecnieken/data", "technical / data", "technical/data",
      "server closet"],
     {
         "functional_zone": "Technical",
         "space_class": "Infrastructure",
         "accessible": "Controlled",
         "bookable": "No",
         "access_level": "Restricted",
         "privacy_level": "Medium",
         "noise_sensitivity": "Medium",
         "visitor_access": "None",
         "flexibility": "Very low",
         "convertible_functions": None,
         "secondary_functions": "Network infrastructure, server equipment, climate-controlled",
     }),

    # ═══════════════════ DATA ROOM ═══════════════════
    (["data room", "data", "server room", "comms room", "network room"],
     {
         "functional_zone": "Technical",
         "space_class": "Infrastructure",
         "accessible": "Controlled",
         "bookable": "No",
         "access_level": "Restricted",
         "privacy_level": "Medium",
         "noise_sensitivity": "Medium",
         "visitor_access": "None",
         "flexibility": "Very low",
         "convertible_functions": None,
         "secondary_functions": "Data hosting, network equipment, UPS, cooling",
     }),

    # ═══════════════════ HEAT PUMP / VENTILATION (HVAC PLANT) ═══════════════════
    (["warmtepomp", "heat pump", "ventilatie", "ventilation",
      "hvac", "ahu", "air handling"],
     {
         "functional_zone": "Technical",
         "space_class": "Infrastructure",
         "accessible": "Controlled",
         "bookable": "No",
         "access_level": "Facilities",
         "privacy_level": "Low",
         "noise_sensitivity": "Low",
         "visitor_access": "None",
         "flexibility": "Very low",
         "convertible_functions": None,
         "secondary_functions": "HVAC plant, Estidama energy efficiency (RE-R1), climate control",
     }),

    # ═══════════════════ SHAFT / DUCT ═══════════════════
    (["shaft", "vent", "duct", "riser"],
     {
         "functional_zone": "Technical",
         "space_class": "Infrastructure",
         "accessible": "No",
         "bookable": "No",
         "access_level": "Restricted",
         "privacy_level": "None",
         "noise_sensitivity": "Low",
         "visitor_access": "None",
         "flexibility": "None",
         "convertible_functions": None,
         "secondary_functions": "Building services risers, HVAC distribution",
     }),

    # ═══════════════════ ELECTRICAL ROOM ═══════════════════
    (["electrical", "switchgear", "transformer", "generator"],
     {
         "functional_zone": "Technical",
         "space_class": "Infrastructure",
         "accessible": "Controlled",
         "bookable": "No",
         "access_level": "Restricted",
         "privacy_level": "Low",
         "noise_sensitivity": "Low",
         "visitor_access": "None",
         "flexibility": "Very low",
         "convertible_functions": None,
         "secondary_functions": "Power distribution, emergency power",
     }),

    # ═══════════════════ SURVEILLANCE / MONITORING (toezicht) ═══════════════════
    (["toezicht", "surveillance", "monitoring", "cctv", "security office"],
     {
         "functional_zone": "Security",
         "space_class": "Security",
         "accessible": "Controlled",
         "bookable": "No",
         "access_level": "Restricted",
         "privacy_level": "High",
         "noise_sensitivity": "Medium",
         "visitor_access": "None",
         "flexibility": "Low",
         "convertible_functions": None,
         "secondary_functions": "CCTV monitoring, access control, incident response",
     }),

    # ═══════════════════ CONTROL CENTRE ═══════════════════
    (["controle centrum", "control centre", "control center",
      "control room", "bms room"],
     {
         "functional_zone": "Security",
         "space_class": "Security",
         "accessible": "Controlled",
         "bookable": "No",
         "access_level": "Restricted",
         "privacy_level": "High",
         "noise_sensitivity": "High",
         "visitor_access": "None",
         "flexibility": "Low",
         "convertible_functions": None,
         "secondary_functions": "BMS monitoring, fire alarm panel, access systems",
     }),

    # ═══════════════════ FIRST AID (ehbo) ═══════════════════
    (["ehbo", "first aid", "medical room", "nurse room", "sick bay"],
     {
         "functional_zone": "Security",
         "space_class": "Security",
         "accessible": "ADIBC compliant",
         "bookable": "No",
         "access_level": "Campus",
         "privacy_level": "High",
         "noise_sensitivity": "Medium",
         "visitor_access": "Open",
         "flexibility": "Low",
         "convertible_functions": "Quiet room, wellness room",
         "secondary_functions": "Emergency first aid, AED station, occupational health",
     }),

    # ═══════════════════ WORKSHOP / ATELIER ═══════════════════
    (["atelier", "workshop", "makerspace", "maker space", "fab lab"],
     {
         "functional_zone": "Creative",
         "space_class": "Workspace",
         "accessible": "ADIBC compliant",
         "bookable": "Yes",
         "access_level": "Campus",
         "privacy_level": "Low",
         "noise_sensitivity": "Low",
         "visitor_access": "By invitation",
         "flexibility": "High",
         "convertible_functions": "Studio, prototyping lab, art space",
         "secondary_functions": "Hands-on work, prototyping, creative projects",
     }),

    # ═══════════════════ RECEPTION / FRONT DESK ═══════════════════
    (["reception", "front desk", "welcome desk", "concierge"],
     {
         "functional_zone": "Public",
         "space_class": "Administrative",
         "accessible": "ADIBC compliant",
         "bookable": "No",
         "access_level": "Public",
         "privacy_level": "Low",
         "noise_sensitivity": "Low",
         "visitor_access": "Open",
         "flexibility": "Medium",
         "convertible_functions": "Information desk",
         "secondary_functions": "Visitor registration, enquiries, deliveries",
     }),

    # ═══════════════════ WAITING / LOUNGE ═══════════════════
    (["waiting", "lounge", "atrium", "main hall"],
     {
         "functional_zone": "Public",
         "space_class": "Public",
         "accessible": "ADIBC compliant",
         "bookable": "No",
         "access_level": "Public",
         "privacy_level": "Low",
         "noise_sensitivity": "Low",
         "visitor_access": "Open",
         "flexibility": "High",
         "convertible_functions": "Informal meeting area, exhibition",
         "secondary_functions": "Visitor waiting, informal seating, displays",
     }),

    # ═══════════════════ PARKING / RAMP ═══════════════════
    (["parking", "ramp", "garage", "car park"],
     {
         "functional_zone": "External",
         "space_class": "Infrastructure",
         "accessible": "ADIBC compliant",
         "bookable": "No",
         "access_level": "Campus",
         "privacy_level": "None",
         "noise_sensitivity": "Low",
         "visitor_access": "Open",
         "flexibility": "Low",
         "convertible_functions": None,
         "secondary_functions": "Vehicle access, EV charging bays",
     }),

    # ═══════════════════ HOUSEKEEPING / CLEANING ═══════════════════
    (["housekeeping", "cleaning", "janitor", "cleaner"],
     {
         "functional_zone": "Facility Services",
         "space_class": "Support",
         "accessible": "Controlled",
         "bookable": "No",
         "access_level": "Facilities",
         "privacy_level": "Low",
         "noise_sensitivity": "Low",
         "visitor_access": "None",
         "flexibility": "Low",
         "convertible_functions": None,
         "secondary_functions": "Cleaning supplies, equipment storage",
     }),

    # ═══════════════════ STAFF ROOM (generic) ═══════════════════
    (["staff room", "staff area", "break room", "rest area"],
     {
         "functional_zone": "Amenity",
         "space_class": "Amenity",
         "accessible": "ADIBC compliant",
         "bookable": "No",
         "access_level": "Tenant",
         "privacy_level": "Medium",
         "noise_sensitivity": "Low",
         "visitor_access": "None",
         "flexibility": "Medium",
         "convertible_functions": "Informal meeting, quiet room",
         "secondary_functions": "Staff rest, informal meetings, prayer break",
     }),

    # ═══════════════════ PRAYER / MULTI-FAITH ROOM ═══════════════════
    (["prayer", "multi-faith", "musholla", "musalla"],
     {
         "functional_zone": "Amenity",
         "space_class": "Amenity",
         "accessible": "ADIBC compliant",
         "bookable": "No",
         "access_level": "Campus",
         "privacy_level": "High",
         "noise_sensitivity": "High",
         "visitor_access": "Open",
         "flexibility": "Low",
         "convertible_functions": "Quiet room, meditation",
         "secondary_functions": "Prayer, meditation, quiet reflection",
     }),

    # ═══════════════════ GENERIC TECHNICAL (last-resort) ═══════════════════
    (["technical", "tech room"],
     {
         "functional_zone": "Technical",
         "space_class": "Infrastructure",
         "accessible": "Controlled",
         "bookable": "No",
         "access_level": "Facilities",
         "privacy_level": "Low",
         "noise_sensitivity": "Low",
         "visitor_access": "None",
         "flexibility": "Very low",
         "convertible_functions": None,
         "secondary_functions": "Building services, MEP",
     }),
]


# ══════════════════════════════════════════════════════════════════════
# Public API
# ══════════════════════════════════════════════════════════════════════

def classify_function(primary_function: str | None, space_name: str | None = None) -> dict:
    """Classify a space into structured metadata.

    Tries primary_function first; if no rule matches, falls back to space_name.
    Both fields come from polygon data.

    Returns a dict with all metadata fields populated.
    Uses DEFAULT_METADATA as base, overridden by the first matching rule.
    """
    for text in (primary_function, space_name):
        if not text:
            continue
        text_lower = text.lower()
        for keywords, metadata in FUNCTION_METADATA_RULES:
            if any(kw.lower() in text_lower for kw in keywords):
                result = dict(DEFAULT_METADATA)
                result.update(metadata)
                return result

    return dict(DEFAULT_METADATA)
