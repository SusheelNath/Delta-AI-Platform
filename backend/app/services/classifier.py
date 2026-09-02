"""
Function Classifier: derives space metadata from primary_function keywords.

Maps primary_function strings to structured properties:
  functional_zone, space_class, accessible, bookable, access_level,
  privacy_level, noise_sensitivity, visitor_access, flexibility,
  convertible_functions, secondary_functions.

Same keyword-matching pattern as furnishing rules.
Static defaults that work out of the box — the AI layer can override any field.
"""

# ══════════════════════════════════════════════════════════════════════
# Default metadata (returned when no rule matches)
# ══════════════════════════════════════════════════════════════════════

DEFAULT_METADATA = {
    "functional_zone": "General",
    "space_class": "Support",
    "accessible": "Unknown",
    "bookable": "No",
    "access_level": "Staff",
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
# Rule order matters — more specific keywords must come before generic ones.

FUNCTION_METADATA_RULES = [
    # ═══════════════════ SINGLE PATIENT ROOMS ═══════════════════
    (["single patient room", "single-bed", "single surgery/medicine inpatient",
      "single geriatric inpatient", "single-bed rehabilitation",
      "single neonatal intensive-care", "single post-partum maternity",
      "single high-risk pregnancy", "koala maternity",
      "single clinical/day-hospital treatment"],
     {
         "functional_zone": "Inpatient Care",
         "space_class": "Clinical",
         "accessible": "Yes",
         "bookable": "No",
         "access_level": "Controlled",
         "privacy_level": "High",
         "noise_sensitivity": "High",
         "visitor_access": "Visiting hours",
         "flexibility": "Low",
         "convertible_functions": "Isolation, recovery",
         "secondary_functions": "Rest, family visits",
     }),

    # ═══════════════════ DOUBLE PATIENT ROOMS ═══════════════════
    (["double patient room", "two-bed", "double surgery/medicine inpatient",
      "double geriatric inpatient", "double-bed rehabilitation",
      "double post-partum maternity", "double bariatric"],
     {
         "functional_zone": "Inpatient Care",
         "space_class": "Clinical",
         "accessible": "Yes",
         "bookable": "No",
         "access_level": "Controlled",
         "privacy_level": "Medium",
         "noise_sensitivity": "High",
         "visitor_access": "Visiting hours",
         "flexibility": "Low",
         "convertible_functions": "Single room conversion",
         "secondary_functions": "Rest, family visits, shared recovery",
     }),

    # ═══════════════════ LARGER PATIENT ROOMS / SUITES ═══════════════════
    (["larger single patient room", "suite / larger single",
      "surgery/medicine suite", "geriatric suite", "rehabilitation suite",
      "maternity suite", "bariatric/adapted suite"],
     {
         "functional_zone": "Inpatient Care",
         "space_class": "Clinical",
         "accessible": "Yes",
         "bookable": "No",
         "access_level": "Controlled",
         "privacy_level": "High",
         "noise_sensitivity": "High",
         "visitor_access": "Visiting hours",
         "flexibility": "Low",
         "convertible_functions": "VIP room, isolation",
         "secondary_functions": "Extended stay, family accommodation",
     }),

    # ═══════════════════ PATIENT CARE (generic) ═══════════════════
    (["patient care", "patient room"],
     {
         "functional_zone": "Inpatient Care",
         "space_class": "Clinical",
         "accessible": "Yes",
         "bookable": "No",
         "access_level": "Controlled",
         "privacy_level": "High",
         "noise_sensitivity": "High",
         "visitor_access": "Visiting hours",
         "flexibility": "Low",
         "convertible_functions": "Recovery, isolation",
         "secondary_functions": "Rest, monitoring",
     }),

    # ═══════════════════ ICU ═══════════════════
    (["intensive-care", "intensive care", "icu"],
     {
         "functional_zone": "Critical Care",
         "space_class": "Clinical",
         "accessible": "Yes",
         "bookable": "No",
         "access_level": "Restricted",
         "privacy_level": "High",
         "noise_sensitivity": "Very high",
         "visitor_access": "Restricted",
         "flexibility": "Very low",
         "convertible_functions": None,
         "secondary_functions": "Ventilation, continuous monitoring",
     }),

    # ═══════════════════ OPERATING ROOMS ═══════════════════
    (["operating room", "operating-theatre", "operating theatre",
      "surgical room", "surgery room", "coded op5", "coded op7",
      "caesarean", "obstetric procedure"],
     {
         "functional_zone": "Surgical",
         "space_class": "Clinical",
         "accessible": "Controlled",
         "bookable": "Yes",
         "access_level": "Restricted",
         "privacy_level": "Very high",
         "noise_sensitivity": "Very high",
         "visitor_access": "None",
         "flexibility": "Very low",
         "convertible_functions": None,
         "secondary_functions": "Anaesthesia, sterile procedures",
     }),

    # ═══════════════════ SCRUB / SURGICAL PREPARATION ═══════════════════
    (["scrub / surgical", "scrub station", "surgical preparation"],
     {
         "functional_zone": "Surgical",
         "space_class": "Clinical",
         "accessible": "Controlled",
         "bookable": "No",
         "access_level": "Restricted",
         "privacy_level": "Medium",
         "noise_sensitivity": "High",
         "visitor_access": "None",
         "flexibility": "Low",
         "convertible_functions": None,
         "secondary_functions": "Sterile preparation, hand washing",
     }),

    # ═══════════════════ RECOVERY / POST-ANAESTHESIA ═══════════════════
    (["recovery", "post-operative", "post operative", "pacu",
      "post-anaesthesia"],
     {
         "functional_zone": "Surgical",
         "space_class": "Clinical",
         "accessible": "Yes",
         "bookable": "No",
         "access_level": "Controlled",
         "privacy_level": "High",
         "noise_sensitivity": "High",
         "visitor_access": "Restricted",
         "flexibility": "Low",
         "convertible_functions": "Observation, short-stay",
         "secondary_functions": "Post-surgical monitoring, wake-up",
     }),

    # ═══════════════════ NEONATAL ═══════════════════
    (["neonatal", "nicu", "resuscitation"],
     {
         "functional_zone": "Critical Care",
         "space_class": "Clinical",
         "accessible": "Controlled",
         "bookable": "No",
         "access_level": "Restricted",
         "privacy_level": "Very high",
         "noise_sensitivity": "Very high",
         "visitor_access": "Restricted",
         "flexibility": "Very low",
         "convertible_functions": None,
         "secondary_functions": "Neonatal monitoring, incubation",
     }),

    # ═══════════════════ BIRTHING / DELIVERY ═══════════════════
    (["birthing", "delivery room"],
     {
         "functional_zone": "Maternity",
         "space_class": "Clinical",
         "accessible": "Yes",
         "bookable": "No",
         "access_level": "Controlled",
         "privacy_level": "Very high",
         "noise_sensitivity": "High",
         "visitor_access": "Restricted",
         "flexibility": "Low",
         "convertible_functions": "Patient room",
         "secondary_functions": "Labour support, partner presence",
     }),

    # ═══════════════════ DIALYSIS ═══════════════════
    (["dialysis"],
     {
         "functional_zone": "Outpatient Treatment",
         "space_class": "Clinical",
         "accessible": "Yes",
         "bookable": "Yes",
         "access_level": "Controlled",
         "privacy_level": "Medium",
         "noise_sensitivity": "Medium",
         "visitor_access": "Visiting hours",
         "flexibility": "Low",
         "convertible_functions": "Day treatment",
         "secondary_functions": "Haemodialysis, peritoneal dialysis",
     }),

    # ═══════════════════ CONSULTATION / EXAMINATION ═══════════════════
    (["consultation", "examination", "endoscopy procedure",
      "triage room", "triage area"],
     {
         "functional_zone": "Outpatient",
         "space_class": "Clinical",
         "accessible": "Yes",
         "bookable": "Yes",
         "access_level": "Controlled",
         "privacy_level": "High",
         "noise_sensitivity": "Medium",
         "visitor_access": "By appointment",
         "flexibility": "Medium",
         "convertible_functions": "Examination, minor procedures",
         "secondary_functions": "Diagnosis, patient interview",
     }),

    # ═══════════════════ PHYSIOTHERAPY / REHABILITATION ═══════════════════
    (["physiotherapy", "kinesiotherapy", "occupational therapy", "ergotherapy"],
     {
         "functional_zone": "Rehabilitation",
         "space_class": "Clinical",
         "accessible": "Yes",
         "bookable": "Yes",
         "access_level": "Controlled",
         "privacy_level": "Medium",
         "noise_sensitivity": "Medium",
         "visitor_access": "By appointment",
         "flexibility": "Medium",
         "convertible_functions": "Exercise room, group therapy",
         "secondary_functions": "Physical rehabilitation, mobility training",
     }),

    # ═══════════════════ IMAGING / RADIOLOGY ═══════════════════
    (["diagnostic-imaging", "radiography", "x-ray", "mri room", "mri suite",
      "scanner", "radiology", "nuclear-medicine", "nuclear medicine",
      "radiotherapy bunker"],
     {
         "functional_zone": "Diagnostics",
         "space_class": "Clinical",
         "accessible": "Controlled",
         "bookable": "Yes",
         "access_level": "Restricted",
         "privacy_level": "High",
         "noise_sensitivity": "High",
         "visitor_access": "None",
         "flexibility": "Very low",
         "convertible_functions": None,
         "secondary_functions": "Imaging, radiation therapy",
     }),

    # ═══════════════════ EMERGENCY ═══════════════════
    (["emergency-department clinical", "emergency"],
     {
         "functional_zone": "Emergency",
         "space_class": "Clinical",
         "accessible": "Yes",
         "bookable": "No",
         "access_level": "Controlled",
         "privacy_level": "Medium",
         "noise_sensitivity": "Medium",
         "visitor_access": "Restricted",
         "flexibility": "Medium",
         "convertible_functions": "Triage, observation",
         "secondary_functions": "Acute assessment, stabilisation",
     }),

    # ═══════════════════ NURSING STATION ═══════════════════
    (["nursing station", "staff base", "staff work base"],
     {
         "functional_zone": "Clinical Support",
         "space_class": "Administrative",
         "accessible": "Yes",
         "bookable": "No",
         "access_level": "Staff",
         "privacy_level": "Low",
         "noise_sensitivity": "Medium",
         "visitor_access": "Enquiry",
         "flexibility": "Medium",
         "convertible_functions": "Workstation, monitoring hub",
         "secondary_functions": "Charting, medication preparation, handover",
     }),

    # ═══════════════════ OFFICE / WORKROOM ═══════════════════
    (["office", "bureau", "workroom"],
     {
         "functional_zone": "Administrative",
         "space_class": "Administrative",
         "accessible": "Yes",
         "bookable": "No",
         "access_level": "Staff",
         "privacy_level": "Medium",
         "noise_sensitivity": "Medium",
         "visitor_access": "By appointment",
         "flexibility": "High",
         "convertible_functions": "Meeting room, consultation",
         "secondary_functions": "Administration, documentation",
     }),

    # ═══════════════════ CONTROL ROOM ═══════════════════
    (["control room"],
     {
         "functional_zone": "Operations",
         "space_class": "Administrative",
         "accessible": "Controlled",
         "bookable": "No",
         "access_level": "Restricted",
         "privacy_level": "Medium",
         "noise_sensitivity": "High",
         "visitor_access": "None",
         "flexibility": "Low",
         "convertible_functions": None,
         "secondary_functions": "Monitoring, systems control",
     }),

    # ═══════════════════ RECEPTION ═══════════════════
    (["reception"],
     {
         "functional_zone": "Public",
         "space_class": "Administrative",
         "accessible": "Yes",
         "bookable": "No",
         "access_level": "Public",
         "privacy_level": "Low",
         "noise_sensitivity": "Low",
         "visitor_access": "Open",
         "flexibility": "Medium",
         "convertible_functions": "Information desk",
         "secondary_functions": "Patient registration, enquiries",
     }),

    # ═══════════════════ WAITING ROOM ═══════════════════
    (["waiting room", "waiting", "main hall", "day room", "lounge",
      "play room"],
     {
         "functional_zone": "Public",
         "space_class": "Public",
         "accessible": "Yes",
         "bookable": "No",
         "access_level": "Public",
         "privacy_level": "Low",
         "noise_sensitivity": "Low",
         "visitor_access": "Open",
         "flexibility": "High",
         "convertible_functions": "Information area, temporary seating",
         "secondary_functions": "Patient waiting, visitor waiting",
     }),

    # ═══════════════════ MEETING / CONFERENCE ═══════════════════
    (["meeting", "conference"],
     {
         "functional_zone": "Administrative",
         "space_class": "Administrative",
         "accessible": "Yes",
         "bookable": "Yes",
         "access_level": "Staff",
         "privacy_level": "Medium",
         "noise_sensitivity": "Medium",
         "visitor_access": "By invitation",
         "flexibility": "High",
         "convertible_functions": "Training, presentation, office",
         "secondary_functions": "Team meetings, case discussions",
     }),

    # ═══════════════════ ASSEMBLY ROOM ═══════════════════
    (["assembly"],
     {
         "functional_zone": "Administrative",
         "space_class": "Public",
         "accessible": "Yes",
         "bookable": "Yes",
         "access_level": "Staff",
         "privacy_level": "Low",
         "noise_sensitivity": "Low",
         "visitor_access": "By invitation",
         "flexibility": "High",
         "convertible_functions": "Conference, training, event",
         "secondary_functions": "Lectures, ceremonies, large meetings",
     }),

    # ═══════════════════ RESTAURANT / CAFETERIA ═══════════════════
    (["restaurant", "cafeteria"],
     {
         "functional_zone": "Amenity",
         "space_class": "Public",
         "accessible": "Yes",
         "bookable": "No",
         "access_level": "Public",
         "privacy_level": "Low",
         "noise_sensitivity": "Low",
         "visitor_access": "Open",
         "flexibility": "Medium",
         "convertible_functions": "Event space",
         "secondary_functions": "Staff dining, visitor meals",
     }),

    # ═══════════════════ COMMERCIAL ═══════════════════
    (["commercial", "supermarket", "convenience store", "pharmacy", "store"],
     {
         "functional_zone": "Amenity",
         "space_class": "Commercial",
         "accessible": "Yes",
         "bookable": "No",
         "access_level": "Public",
         "privacy_level": "Low",
         "noise_sensitivity": "Low",
         "visitor_access": "Open",
         "flexibility": "Medium",
         "convertible_functions": "Retail, dispensary",
         "secondary_functions": "Hospital pharmacy, convenience retail",
     }),

    # ═══════════════════ LABORATORY ═══════════════════
    (["laboratory", "lab "],
     {
         "functional_zone": "Diagnostics",
         "space_class": "Clinical",
         "accessible": "Controlled",
         "bookable": "No",
         "access_level": "Restricted",
         "privacy_level": "Medium",
         "noise_sensitivity": "Medium",
         "visitor_access": "None",
         "flexibility": "Low",
         "convertible_functions": None,
         "secondary_functions": "Sample analysis, pathology",
     }),

    # ═══════════════════ STERILISATION ═══════════════════
    (["sterilisation", "sterilization", "sterile"],
     {
         "functional_zone": "Clinical Support",
         "space_class": "Support",
         "accessible": "Controlled",
         "bookable": "No",
         "access_level": "Restricted",
         "privacy_level": "Low",
         "noise_sensitivity": "Medium",
         "visitor_access": "None",
         "flexibility": "Low",
         "convertible_functions": None,
         "secondary_functions": "Instrument processing, decontamination",
     }),

    # ═══════════════════ DIRTY UTILITY ═══════════════════
    (["dirty utility"],
     {
         "functional_zone": "Clinical Support",
         "space_class": "Support",
         "accessible": "Controlled",
         "bookable": "No",
         "access_level": "Staff",
         "privacy_level": "Low",
         "noise_sensitivity": "Low",
         "visitor_access": "None",
         "flexibility": "Low",
         "convertible_functions": None,
         "secondary_functions": "Waste processing, soiled linen",
     }),

    # ═══════════════════ CLEAN UTILITY ═══════════════════
    (["clean utility"],
     {
         "functional_zone": "Clinical Support",
         "space_class": "Support",
         "accessible": "Controlled",
         "bookable": "No",
         "access_level": "Staff",
         "privacy_level": "Low",
         "noise_sensitivity": "Low",
         "visitor_access": "None",
         "flexibility": "Low",
         "convertible_functions": None,
         "secondary_functions": "Supplies, clean linen storage",
     }),

    # ═══════════════════ PREPARATION ROOM ═══════════════════
    (["preparation room"],
     {
         "functional_zone": "Clinical Support",
         "space_class": "Support",
         "accessible": "Controlled",
         "bookable": "No",
         "access_level": "Staff",
         "privacy_level": "Low",
         "noise_sensitivity": "Medium",
         "visitor_access": "None",
         "flexibility": "Low",
         "convertible_functions": None,
         "secondary_functions": "Medication prep, procedure prep",
     }),

    # ═══════════════════ PANTRY ═══════════════════
    (["pantry"],
     {
         "functional_zone": "Support",
         "space_class": "Support",
         "accessible": "Yes",
         "bookable": "No",
         "access_level": "Staff",
         "privacy_level": "Low",
         "noise_sensitivity": "Low",
         "visitor_access": "None",
         "flexibility": "Medium",
         "convertible_functions": "Kitchenette",
         "secondary_functions": "Patient meal staging, beverages",
     }),

    # ═══════════════════ HOUSEKEEPING / CLEANING ═══════════════════
    (["housekeeping", "cleaning room", "janitor"],
     {
         "functional_zone": "Facility Services",
         "space_class": "Support",
         "accessible": "Controlled",
         "bookable": "No",
         "access_level": "Staff",
         "privacy_level": "Low",
         "noise_sensitivity": "Low",
         "visitor_access": "None",
         "flexibility": "Low",
         "convertible_functions": None,
         "secondary_functions": "Cleaning supplies, equipment storage",
     }),

    # ═══════════════════ STORAGE ═══════════════════
    (["storage", "store room", "archive", "reserve"],
     {
         "functional_zone": "Support",
         "space_class": "Support",
         "accessible": "Controlled",
         "bookable": "No",
         "access_level": "Staff",
         "privacy_level": "Low",
         "noise_sensitivity": "Low",
         "visitor_access": "None",
         "flexibility": "High",
         "convertible_functions": "Additional storage, equipment staging",
         "secondary_functions": "Material storage, archive",
     }),

    # ═══════════════════ MORGUE ═══════════════════
    (["morgue"],
     {
         "functional_zone": "Clinical Support",
         "space_class": "Clinical",
         "accessible": "Controlled",
         "bookable": "No",
         "access_level": "Restricted",
         "privacy_level": "Very high",
         "noise_sensitivity": "Very high",
         "visitor_access": "Restricted",
         "flexibility": "Very low",
         "convertible_functions": None,
         "secondary_functions": "Body storage, family viewing",
     }),

    # ═══════════════════ LOCKER / CHANGING ═══════════════════
    (["locker", "changing"],
     {
         "functional_zone": "Staff Welfare",
         "space_class": "Support",
         "accessible": "Yes",
         "bookable": "No",
         "access_level": "Staff",
         "privacy_level": "Medium",
         "noise_sensitivity": "Low",
         "visitor_access": "None",
         "flexibility": "Medium",
         "convertible_functions": "Storage",
         "secondary_functions": "Personal storage, uniform change",
     }),

    # ═══════════════════ SANITARY / WC ═══════════════════
    (["toilet", "wc", "washroom", "sanitary", "sanitation", "ensuite",
      "shower / wash", "assisted bathroom", "bathing room"],
     {
         "functional_zone": "Service",
         "space_class": "Service",
         "accessible": "Yes",
         "bookable": "No",
         "access_level": "Public",
         "privacy_level": "High",
         "noise_sensitivity": "Low",
         "visitor_access": "Open",
         "flexibility": "Very low",
         "convertible_functions": None,
         "secondary_functions": "Hygiene, personal care",
     }),

    (["shower"],
     {
         "functional_zone": "Service",
         "space_class": "Service",
         "accessible": "Yes",
         "bookable": "No",
         "access_level": "Controlled",
         "privacy_level": "High",
         "noise_sensitivity": "Low",
         "visitor_access": "None",
         "flexibility": "Very low",
         "convertible_functions": None,
         "secondary_functions": "Patient bathing, staff shower",
     }),

    # ═══════════════════ STAFF (generic) ═══════════════════
    (["staff room", "staff access"],
     {
         "functional_zone": "Staff Welfare",
         "space_class": "Administrative",
         "accessible": "Yes",
         "bookable": "No",
         "access_level": "Staff",
         "privacy_level": "Medium",
         "noise_sensitivity": "Low",
         "visitor_access": "None",
         "flexibility": "Medium",
         "convertible_functions": "Break room, small meeting",
         "secondary_functions": "Staff rest, informal meetings",
     }),

    # ═══════════════════ RESIDENCY / ON-CALL ═══════════════════
    (["residency", "on-call", "patient care + residency"],
     {
         "functional_zone": "Staff Welfare",
         "space_class": "Clinical",
         "accessible": "Yes",
         "bookable": "No",
         "access_level": "Staff",
         "privacy_level": "High",
         "noise_sensitivity": "High",
         "visitor_access": "None",
         "flexibility": "Low",
         "convertible_functions": "Patient room",
         "secondary_functions": "On-call rest, overnight accommodation",
     }),

    # ═══════════════════ ELEVATOR / LIFT ═══════════════════
    (["elevator", "lift"],
     {
         "functional_zone": "Circulation",
         "space_class": "Infrastructure",
         "accessible": "Yes",
         "bookable": "No",
         "access_level": "Public",
         "privacy_level": "None",
         "noise_sensitivity": "Low",
         "visitor_access": "Open",
         "flexibility": "None",
         "convertible_functions": None,
         "secondary_functions": "Vertical transport, bed transport",
     }),

    # ═══════════════════ STAIRCASE ═══════════════════
    (["staircase", "stairway", "stair"],
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
         "secondary_functions": "Vertical circulation, emergency egress",
     }),

    # ═══════════════════ CORRIDOR / CIRCULATION ═══════════════════
    (["corridor", "circulation", "hallway"],
     {
         "functional_zone": "Circulation",
         "space_class": "Infrastructure",
         "accessible": "Yes",
         "bookable": "No",
         "access_level": "Public",
         "privacy_level": "None",
         "noise_sensitivity": "Low",
         "visitor_access": "Open",
         "flexibility": "None",
         "convertible_functions": None,
         "secondary_functions": "Horizontal circulation, wayfinding",
     }),

    # ═══════════════════ LOBBY / TRANSITION ═══════════════════
    (["airlock", "lobby", "transition", "atrium"],
     {
         "functional_zone": "Circulation",
         "space_class": "Infrastructure",
         "accessible": "Yes",
         "bookable": "No",
         "access_level": "Public",
         "privacy_level": "None",
         "noise_sensitivity": "Low",
         "visitor_access": "Open",
         "flexibility": "Low",
         "convertible_functions": None,
         "secondary_functions": "Access transition, climate buffer",
     }),

    # ═══════════════════ SHAFT / VENT ═══════════════════
    (["shaft", "vent"],
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
         "secondary_functions": "Building services, HVAC",
     }),

    # ═══════════════════ TECHNICAL / PLANT ═══════════════════
    (["technical", "plant room", "building-services", "coded technical",
      "core / technical"],
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
         "secondary_functions": "MEP, building systems",
     }),

    # ═══════════════════ PARKING / RAMP ═══════════════════
    (["parking", "ramp"],
     {
         "functional_zone": "External",
         "space_class": "Infrastructure",
         "accessible": "Yes",
         "bookable": "No",
         "access_level": "Public",
         "privacy_level": "None",
         "noise_sensitivity": "Low",
         "visitor_access": "Open",
         "flexibility": "Low",
         "convertible_functions": None,
         "secondary_functions": "Vehicle access, ambulance bay",
     }),

    # ═══════════════════ WASTE ═══════════════════
    (["waste", "ambulance"],
     {
         "functional_zone": "Facility Services",
         "space_class": "Support",
         "accessible": "Controlled",
         "bookable": "No",
         "access_level": "Restricted",
         "privacy_level": "Low",
         "noise_sensitivity": "Low",
         "visitor_access": "None",
         "flexibility": "Low",
         "convertible_functions": None,
         "secondary_functions": "Waste management, logistics",
     }),

    # ═══════════════════ DEPARTMENT-SPECIFIC FALLBACK ═══════════════════
    (["department-specific", "existing department"],
     {
         "functional_zone": "Departmental",
         "space_class": "Administrative",
         "accessible": "Controlled",
         "bookable": "No",
         "access_level": "Staff",
         "privacy_level": "Medium",
         "noise_sensitivity": "Medium",
         "visitor_access": "By appointment",
         "flexibility": "Medium",
         "convertible_functions": "Office, workstation",
         "secondary_functions": "Department operations",
     }),

    # ═══════════════════ PATIENT (bare keyword — last resort) ═══════════════════
    (["patient"],
     {
         "functional_zone": "Inpatient Care",
         "space_class": "Clinical",
         "accessible": "Yes",
         "bookable": "No",
         "access_level": "Controlled",
         "privacy_level": "High",
         "noise_sensitivity": "High",
         "visitor_access": "Visiting hours",
         "flexibility": "Low",
         "convertible_functions": "Recovery, observation",
         "secondary_functions": "Patient care",
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
