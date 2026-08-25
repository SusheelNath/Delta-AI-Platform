"""
Delta Intelligence Platform — Data Ingestion Pipeline
Reads all Excel workbooks from the Hospital AI Platform folder,
translates French terms to English, and loads into SQLite.
"""

import sys
import re
from pathlib import Path

import pandas as pd
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app.config import DATA_DIR, HOSPITAL_DATA_DIR, DATABASE_URL
from app.database import Base, engine
from app.models import Floor, Space, VerticalCore, Translation

# ─── French → English Translation Dictionary ───────────────────────────────

FRENCH_TO_ENGLISH = {
    # Department / Zone names
    "Quartier Opératoire": "Operating Theatre Suite",
    "Quartier Opératoire 1": "Operating Theatre Suite 1",
    "Quartier Opératoire 2 (Reveil)": "Operating Theatre Suite 2 (Recovery)",
    "Quartier Opératoire 3": "Operating Theatre Suite 3",
    "Maternité": "Maternity",
    "Maternité 1": "Maternity 1",
    "Maternité 2": "Maternity 2",
    "Urgence": "Emergency",
    "Unité soins intensifs": "Intensive Care Unit",
    "Imagerie Conventionnelle": "Conventional Imaging",
    "Isotopes": "Nuclear Medicine",
    "Laboratoire": "Laboratory",
    "Pharmacie": "Pharmacy",
    "Stérilisation Central": "Central Sterilisation",
    "Stérilisation": "Sterilisation",
    "Buanderie": "Laundry",
    "Buanderie / housekeeping support": "Laundry / Housekeeping Support",
    "Radiothérapie": "Radiotherapy",
    "Radiotherapie": "Radiotherapy",
    "Atelier": "Workshop",
    "Entrepôt": "Warehouse",
    "Economat": "Supplies / Procurement",
    "Economat / logistics storage": "Supplies / Logistics Storage",
    "Vestiaire": "Changing Room",
    "Quai": "Loading Dock",
    "Quai / loading-logistics area": "Loading Dock / Logistics Area",
    "Lingerie": "Linen Services",
    "Lingerie / staff changing support": "Linen / Staff Changing Support",
    "Déchet": "Waste",
    "Déchet / waste handling": "Waste Handling",
    "Morgue": "Morgue",
    "NON Parachevé": "Unfinished",
    "NON Paracheve": "Unfinished",
    "Dialyse": "Dialysis",
    "Sanitaire": "Sanitary",
    "Garage Ambulances": "Ambulance Bay",
    "Grossesse à Haut Risque": "High-Risk Pregnancy",
    "Pédiatrie": "Paediatrics",
    "Gériatrie": "Geriatrics",
    "Chirurgie": "Surgery",
    "Médecine": "Medicine",
    "Rééducation": "Rehabilitation",
    "Reveil": "Recovery",
    "Unité Chirurgie Médecine": "Surgery/Medicine Unit",
    "Réanimation": "Intensive Care",
    "Néonatalogie": "Neonatology",
    "Accouchement": "Delivery",
    "Consultation": "Consultation",

    # Space names / IFC codes
    "Loc Technique": "Technical Room",
    "Loc Serveur": "Server Room",
    "Escalier": "Staircase",
    "Trémie": "Shaft Opening",
    "Tremie": "Shaft Opening",
    "Salle de Réunion": "Meeting Room",
    "Salle de Reunion": "Meeting Room",
    "Couloir": "Corridor",
    "Bureau": "Office",

    # Vertical core names
    "Monte Malades": "Patient Lift",
    "Monte Personnes": "Personnel Lift",
    "Monte Malades/Personnes": "Patient/Personnel Lift",
    "Monte Visiteur": "Visitor Lift",
    "Escalier atrium": "Atrium Staircase",
    "Escalier secours bout d'aile": "Wing Emergency Staircase",
    "Escalier secours bout d''aile": "Wing Emergency Staircase",

    # Service code descriptions
    "QOP": "Operating Theatre",
    "IMA": "Imaging",
    "ISO": "Nuclear Medicine",
    "URG": "Emergency",
    "USI": "Intensive Care",
    "REV": "Recovery",
    "LAB": "Laboratory",
    "DIV": "Various/General",
    "PHA": "Pharmacy",
    "STE": "Sterilisation",
    "RXT": "Radiotherapy",
    "QUA": "Loading Dock",
    "LIN": "Laundry",
    "ATT": "Workshop",
    "ENT": "Storage/Warehouse",
    "TEC": "Technical",
    "PWH": "Plant/Water/Heating",
    "MET": "Metal/Structural",
    "MA1": "Maternity 1",
    "MA2": "Maternity 2",
    "GHR": "High-Risk Pregnancy",
    "QAC": "Delivery Suite",
    "NNA": "Neonatal Care",
    "NIC": "Neonatal Intensive Care",
    "CD1": "Surgery/Medicine Unit 1",
    "CD2": "Surgery/Medicine Unit 2",
    "CD3": "Surgery/Medicine Unit 3",
    "CD4": "Surgery/Medicine Unit 4",
    "CD5": "Surgery/Medicine Unit 5",
    "CD6": "Surgery/Medicine Unit 6",
    "CD7": "Surgery/Medicine Unit 7",
    "JC1": "Surgical Day Hospital 1",
    "JC2": "Surgical Day Hospital 2",
    "JM1": "Medical Day Hospital 1",
    "PED": "Paediatrics",
    "END": "Endoscopy",
    "SP1": "Rehabilitation Ward 1",
    "SP2": "Rehabilitation Ward 2",
    "GE1": "Geriatrics Ward 1",
    "GE2": "Geriatrics Ward 2",
    "BAR": "Bariatric Surgery",
    "OPH": "Ophthalmology",
    "BOU": "Service Area BOU",
    "SAD": "Service Area SAD",
    "KXX": "Clinical Support",
    "FUN": "Funeral Services",
    "DEC": "Waste/Decontamination",
    "ATR": "Atrium",
    "VES": "Changing Room",
    "CYT": "Cytology/Pharmacy Support",
}

# Floor definitions
FLOOR_DEFINITIONS = {
    "H000": {"name": "Ground Floor", "level": 0, "elevation_cm": 0,
             "description": "Dialysis, restaurant, retail, public circulation, main entrance"},
    "H001": {"name": "Basement 1", "level": -1, "elevation_cm": None,
             "description": "Operating theatres (3 suites), emergency, ICU, imaging, laboratory, recovery"},
    "H002": {"name": "Basement 2", "level": -2, "elevation_cm": None,
             "description": "Pharmacy, central sterilisation, radiotherapy, laundry, logistics, workshop"},
    "H003": {"name": "Basement 3", "level": -3, "elevation_cm": None,
             "description": "Technical infrastructure, shafts, plant rooms"},
    "H010": {"name": "Floor +1", "level": 1, "elevation_cm": 386,
             "description": "Ophthalmology, endoscopy consultations, clinical support"},
    "H020": {"name": "Floor +2", "level": 2, "elevation_cm": 782,
             "description": "Mother & Child: maternity, delivery suite, neonatal care, neonatal ICU"},
    "H030": {"name": "Floor +3", "level": 3, "elevation_cm": 1178,
             "description": "Paediatrics, adult surgery/medicine wards, surgical/medical day hospitals, endoscopy"},
    "H040": {"name": "Floor +4", "level": 4, "elevation_cm": 1574,
             "description": "Rehabilitation, geriatrics, bariatric surgery, surgery/medicine wards"},
    "H050": {"name": "Floor +5", "level": 5, "elevation_cm": 1970,
             "description": "Technical plant, meeting room, atrium, building services"},
}

# Source files: (filename, space_register_sheet_name)
SOURCE_FILES = {
    "H000": ("H000_NB_IFC_Space_Metadata_Occupancy_CORRECTED.xlsx", "H000-NB Space Register"),
    "H001": ("H001_NB_IFC_Space_Metadata_Analysis.xlsx", "H001-NB Space Register"),
    "H002": ("H002_NB_IFC_Space_Analysis_Functions_Routing.xlsx", "H002 Space Register"),
    "H003": ("H003_NB_IFC_Space_Analysis.xlsx", "H003 Space Register"),
    "H010": ("H010_NB_First_Floor_Recalibrated_Occupancy.xlsx", "H010-NB Space Register"),
    "H020": ("H020_NB_IFC_Space_Metadata_Analysis.xlsx", "H020-NB Space Register"),
    "H030": ("H030_NB_IFC_Space_Metadata_with_Visitors.xlsx", "H030-NB Space Register"),
    "H040": ("H040_NB_IFC_Space_Metadata_Analysis.xlsx", "H040-NB Space Register"),
    "H050": ("H050_NB_IFC_Space_Metadata_Analysis.xlsx", "H050-NB Space Register"),
}

# Vertical core sheet names (some files have it, some don't)
VERTICAL_CORE_FILES = {
    "H000": ("H000_NB_IFC_Space_Metadata_Occupancy_CORRECTED.xlsx", "Vertical Cores"),
    "H001": ("H001_NB_IFC_Space_Metadata_Analysis.xlsx", "Vertical Cores"),
    "H002": ("H002_NB_IFC_Space_Analysis_Functions_Routing.xlsx", "Vertical Cores"),
    "H010": ("H010_NB_First_Floor_Recalibrated_Occupancy.xlsx", "Vertical Cores"),
    "H020": ("H020_NB_IFC_Space_Metadata_Analysis.xlsx", "Vertical Cores"),
    "H030": ("H030_NB_IFC_Space_Metadata_with_Visitors.xlsx", "Vertical Cores"),
    "H040": ("H040_NB_IFC_Space_Metadata_Analysis.xlsx", "Vertical Cores"),
    "H050": ("H050_NB_IFC_Space_Metadata_Analysis.xlsx", "Vertical Cores"),
}

# Column mappings — map varying column names to our standardized field names
COLUMN_MAPPINGS = {
    "Space ID": "space_id",
    "IFC Entity": "ifc_entity",
    "IFC GUID": "ifc_guid",
    "Space Name / Code": "space_name",
    "Space Name": "space_name",
    "Room Number": "room_number",
    "Floor": "floor_raw",
    "Section": "section",
    "Service Code": "service_code",
    "Area (m²)": "area_m2",
    "Perimeter (cm)": "perimeter_cm",
    "Height (cm)": "height_cm",
    "Calculation Height (cm)": "calculation_height_cm",
    "Subproject": "subproject",
    "IFC Category": "ifc_category",
    "IFC Reference": "ifc_reference",
    "Floor Finish": "floor_finish",
    "Ceiling Finish": "ceiling_finish",
    "Construction Phase": "construction_phase",
    "Functional Zone / Department Context": "functional_zone",
    "Zone Context Source": "zone_context_source",
    "Zone Confidence": "zone_confidence",
    "H020-NF Context": "nf_context",
    "H030-NF Context": "nf_context",
    "H040-NF Context": "nf_context",
    "H050-NF Context": "nf_context",
    "Primary Function Interpretation": "primary_function",
    "Primary Function": "primary_function",
    "Secondary Functions": "secondary_functions",
    "Space Class": "space_class",
    "Space Class Interpretation": "space_class",
    "Occupiable": "occupiable",
    "Function Confidence": "function_confidence",
    "Analysis Confidence": "function_confidence",
    "Analysis Basis": "analysis_basis",
    "Recommended Normal Occupancy": "normal_occupancy",
    "Normal Occupancy": "normal_occupancy",
    "Recommended Operational Max Occupancy": "max_occupancy",
    "Max Occupancy": "max_occupancy",
    "Patient Capacity": "patient_capacity",
    "Patient / Treatment Stations": "patient_capacity",
    "Accessible": "accessible",
    "Bookable": "bookable",
    "Access Level": "access_level",
    "Visitor Access": "visitor_access",
    "Privacy Level": "privacy_level",
    "Patient Sensitive": "patient_sensitive",
    "Flexibility": "flexibility",
    "Convertible Functions": "convertible_functions",
    "Function Restrictions": "function_restrictions",
    "Noise Sensitivity": "noise_sensitivity",
    "Nearest Lift": "nearest_lift",
    "Lift Distance (m)": "lift_distance_m",
    "Nearest Stair": "nearest_stair",
    "Stair Distance (m)": "stair_distance_m",
    "Step-free Access": "step_free_access",
    "Adjacent Spaces": "adjacent_spaces",
    "Connected Corridor": "connected_corridor",
    "Facilities Available": "facilities_available",
    "Data Status": "data_status",
    "Occupancy Basis": "occupancy_basis",
    "Occupancy Confidence": "occupancy_confidence",
    "Public Route Available": "step_free_access",  # map to step_free for now
    "Normal Visitors / Caregivers": "normal_visitors",
    "Recommended Max Visitors / Caregivers": "max_visitors",
    "Visitor Access Type": "visitor_access_type",
    "Visiting Hours Restricted": "visiting_hours_restricted",
    "Visitor / Caregiver Notes": "visitor_notes",
}


def translate_text(text: str) -> str:
    """Translate French terms to English in a text string."""
    if not isinstance(text, str) or not text.strip():
        return text

    result = text

    # Try exact match first
    if result in FRENCH_TO_ENGLISH:
        return FRENCH_TO_ENGLISH[result]

    # Handle compound patterns like "Function — Department"
    # Translate the department part after " — "
    if " — " in result:
        parts = result.split(" — ", 1)
        translated_dept = translate_text(parts[1].strip())
        result = f"{parts[0]} — {translated_dept}"

    # Handle compound patterns with " / " separator in department names
    # e.g., "Buanderie / housekeeping support"
    if result in FRENCH_TO_ENGLISH:
        return FRENCH_TO_ENGLISH[result]

    # Substring replacements for remaining French terms (longest match first)
    sorted_terms = sorted(FRENCH_TO_ENGLISH.keys(), key=len, reverse=True)
    for french, english in ((f, FRENCH_TO_ENGLISH[f]) for f in sorted_terms):
        if french in result:
            result = result.replace(french, english)

    return result


def translate_vertical_core_name(name: str) -> tuple[str, str]:
    """Translate a vertical core name. Returns (english_name, type)."""
    if not isinstance(name, str):
        return ("Unknown", "unknown")

    original = name

    # Handle Revit-style names: "Escalier:Escalier atrium:8624758"
    base_name = name.split(":")[0].strip() if ":" in name else name

    # Determine type
    core_type = "stair" if "Escalier" in name or "escalier" in name else "lift"

    # Translate
    if "Escalier secours bout d" in name:
        english = "Wing Emergency Staircase"
    elif "Escalier atrium" in name:
        english = "Atrium Staircase"
    elif base_name in FRENCH_TO_ENGLISH:
        english = FRENCH_TO_ENGLISH[base_name]
    elif "Monte Malades/Personnes" in name:
        english = "Patient/Personnel Lift"
    elif "Monte Malades" in name:
        english = "Patient Lift"
    elif "Monte Visiteur" in name:
        english = "Visitor Lift"
    elif "Monte Personnes" in name:
        english = "Personnel Lift"
    elif "Escalier" in name:
        english = "Staircase"
    else:
        english = translate_text(name)

    return (english, core_type)


def process_space_register(floor_id: str, filepath: Path, sheet_name: str) -> list[dict]:
    """Read a Space Register sheet and return normalized space records."""
    print(f"  Reading {sheet_name} from {filepath.name}...")
    df = pd.read_excel(filepath, sheet_name=sheet_name)

    # Map columns to standardized names
    rename_map = {}
    for col in df.columns:
        col_stripped = col.strip()
        if col_stripped in COLUMN_MAPPINGS:
            rename_map[col] = COLUMN_MAPPINGS[col_stripped]

    df = df.rename(columns=rename_map)

    records = []
    for _, row in df.iterrows():
        space_id = row.get("space_id")
        if pd.isna(space_id) or not str(space_id).strip():
            continue

        record = {
            "id": str(space_id).strip(),
            "floor_id": floor_id,
            "ifc_guid": _clean(row.get("ifc_guid")),
            "ifc_entity": _clean(row.get("ifc_entity")),
            "space_name": translate_text(_clean(row.get("space_name")) or ""),
            "room_number": _clean(row.get("room_number")),
            "section": _clean(row.get("section")),
            "service_code": _clean(row.get("service_code")),
            "area_m2": _float(row.get("area_m2")),
            "perimeter_cm": _float(row.get("perimeter_cm")),
            "height_cm": _float(row.get("height_cm")),
            "calculation_height_cm": _float(row.get("calculation_height_cm")),
            "subproject": _clean(row.get("subproject")),
            "ifc_category": _clean(row.get("ifc_category")),
            "ifc_reference": _clean(row.get("ifc_reference")),
            "floor_finish": _clean(row.get("floor_finish")),
            "ceiling_finish": _clean(row.get("ceiling_finish")),
            "construction_phase": _clean(row.get("construction_phase")),
            "functional_zone": translate_text(_clean(row.get("functional_zone")) or ""),
            "zone_context_source": _clean(row.get("zone_context_source")),
            "zone_confidence": _clean(row.get("zone_confidence")),
            "nf_context": translate_text(_clean(row.get("nf_context")) or ""),
            "primary_function": translate_text(_clean(row.get("primary_function")) or ""),
            "secondary_functions": translate_text(_clean(row.get("secondary_functions")) or ""),
            "space_class": _clean(row.get("space_class")),
            "occupiable": _clean(row.get("occupiable")),
            "function_confidence": _clean(row.get("function_confidence")),
            "analysis_basis": _clean(row.get("analysis_basis")),
            "normal_occupancy": _clean(row.get("normal_occupancy")),
            "max_occupancy": _clean(row.get("max_occupancy")),
            "patient_capacity": _clean(row.get("patient_capacity")),
            "occupancy_basis": translate_text(_clean(row.get("occupancy_basis")) or ""),
            "occupancy_confidence": _clean(row.get("occupancy_confidence")),
            "accessible": _clean(row.get("accessible")),
            "bookable": _clean(row.get("bookable")),
            "access_level": _clean(row.get("access_level")),
            "visitor_access": _clean(row.get("visitor_access")),
            "privacy_level": _clean(row.get("privacy_level")),
            "patient_sensitive": _clean(row.get("patient_sensitive")),
            "flexibility": _clean(row.get("flexibility")),
            "convertible_functions": translate_text(_clean(row.get("convertible_functions")) or ""),
            "function_restrictions": translate_text(_clean(row.get("function_restrictions")) or ""),
            "noise_sensitivity": _clean(row.get("noise_sensitivity")),
            "nearest_lift": translate_text(_clean(row.get("nearest_lift")) or ""),
            "lift_distance_m": _float(row.get("lift_distance_m")),
            "nearest_stair": translate_text(_clean(row.get("nearest_stair")) or ""),
            "stair_distance_m": _float(row.get("stair_distance_m")),
            "step_free_access": _clean(row.get("step_free_access")),
            "adjacent_spaces": _clean(row.get("adjacent_spaces")),
            "connected_corridor": _clean(row.get("connected_corridor")),
            "facilities_available": translate_text(_clean(row.get("facilities_available")) or ""),
            "data_status": _clean(row.get("data_status")),
            "normal_visitors": _clean(row.get("normal_visitors")),
            "max_visitors": _clean(row.get("max_visitors")),
            "visitor_access_type": _clean(row.get("visitor_access_type")),
            "visiting_hours_restricted": _clean(row.get("visiting_hours_restricted")),
            "visitor_notes": translate_text(_clean(row.get("visitor_notes")) or ""),
        }

        # Clean empty strings to None
        for key, val in record.items():
            if isinstance(val, str) and not val.strip():
                record[key] = None

        records.append(record)

    return records


def process_vertical_cores(floor_id: str, filepath: Path, sheet_name: str) -> list[dict]:
    """Read a Vertical Cores sheet and return normalized records."""
    print(f"  Reading {sheet_name} from {filepath.name}...")
    try:
        df = pd.read_excel(filepath, sheet_name=sheet_name)
    except Exception as e:
        print(f"  WARNING: Could not read {sheet_name}: {e}")
        return []

    # The first row is typically a title row, second row has column headers
    # Find the header row by looking for 'Name' or 'IFC GUID'
    header_row = None
    for i, row in df.iterrows():
        values = [str(v).strip() for v in row.values if pd.notna(v)]
        if "Name" in values or "IFC GUID" in values:
            header_row = i
            break

    if header_row is None:
        print(f"  WARNING: Could not find header row in {sheet_name}")
        return []

    # Re-read with correct header (df index + 1 because default read used file row 0 as header)
    df = pd.read_excel(filepath, sheet_name=sheet_name, header=header_row + 1)

    records = []
    for _, row in df.iterrows():
        name = row.get("Name")
        if pd.isna(name) or not str(name).strip():
            continue

        name_str = str(name).strip()
        english_name, core_type = translate_vertical_core_name(name_str)

        x = _float(row.get("Plan X (cm)"))
        y = _float(row.get("Plan Y (cm)"))

        records.append({
            "floor_id": floor_id,
            "name": english_name,
            "type": core_type,
            "original_name": name_str,
            "x_coord": x,
            "y_coord": y,
        })

    return records


def _clean(val) -> str | None:
    """Clean a cell value to a string or None."""
    if val is None or (isinstance(val, float) and pd.isna(val)):
        return None
    s = str(val).strip()
    if s.lower() in ("nan", "none", ""):
        return None
    return s


def _float(val) -> float | None:
    """Clean a cell value to a float or None."""
    if val is None or (isinstance(val, float) and pd.isna(val)):
        return None
    try:
        return float(val)
    except (ValueError, TypeError):
        return None


def run_ingestion():
    """Main ingestion pipeline."""
    print("=" * 60)
    print("Delta Intelligence Platform — Data Ingestion")
    print("=" * 60)
    print(f"Source: {HOSPITAL_DATA_DIR}")
    print(f"Database: {DATABASE_URL}")
    print()

    # Ensure data directory exists
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    # Create tables
    print("Creating database tables...")
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)

    session = Session(engine)

    try:
        # ─── 1. Insert Floors ───────────────────────────────────────
        print("\n--- Inserting Floors ---")
        for floor_id, info in FLOOR_DEFINITIONS.items():
            floor = Floor(
                id=floor_id,
                name=info["name"],
                level=info["level"],
                elevation_cm=info["elevation_cm"],
                description=info["description"],
            )
            session.add(floor)
            print(f"  {floor_id}: {info['name']}")
        session.flush()

        # ─── 2. Insert Translation Dictionary ──────────────────────
        print("\n--- Inserting Translation Dictionary ---")
        for french, english in FRENCH_TO_ENGLISH.items():
            category = "general"
            if any(k in french.lower() for k in ["monte", "escalier"]):
                category = "vertical_core"
            elif len(french) <= 3 and french.isupper():
                category = "service_code"
            elif any(k in french.lower() for k in
                     ["quartier", "maternit", "urgence", "unit", "imagerie",
                      "pharmacie", "stérilisation", "buanderie", "radioth",
                      "atelier", "vestiaire", "laboratoire", "gériatrie",
                      "pédiatrie", "chirurgie", "médecine", "rééducation"]):
                category = "department"
            elif any(k in french.lower() for k in
                     ["loc ", "salle", "couloir", "bureau", "trém"]):
                category = "space_name"

            t = Translation(french=french, english=english, category=category)
            session.add(t)
        print(f"  {len(FRENCH_TO_ENGLISH)} translations loaded")
        session.flush()

        # ─── 3. Process Space Registers ─────────────────────────────
        print("\n--- Processing Space Registers ---")
        total_spaces = 0
        guid_set = set()
        id_set = set()

        for floor_id, (filename, sheet_name) in SOURCE_FILES.items():
            filepath = HOSPITAL_DATA_DIR / filename
            if not filepath.exists():
                print(f"  WARNING: {filepath} not found, skipping")
                continue

            records = process_space_register(floor_id, filepath, sheet_name)

            # Deduplicate by space_id
            floor_count = 0
            for rec in records:
                if rec["id"] in id_set:
                    print(f"  WARNING: Duplicate space ID {rec['id']}, skipping")
                    continue
                if rec["ifc_guid"] and rec["ifc_guid"] in guid_set:
                    print(f"  WARNING: Duplicate GUID for {rec['id']}, clearing GUID")
                    rec["ifc_guid"] = None

                id_set.add(rec["id"])
                if rec["ifc_guid"]:
                    guid_set.add(rec["ifc_guid"])

                space = Space(**rec)
                session.add(space)
                floor_count += 1

            total_spaces += floor_count
            print(f"  {floor_id}: {floor_count} spaces loaded")

            # Update floor statistics
            floor_obj = session.get(Floor, floor_id)
            if floor_obj:
                floor_obj.total_spaces = floor_count
                areas = [r["area_m2"] for r in records if r["area_m2"] is not None]
                floor_obj.total_area_m2 = round(sum(areas), 2) if areas else None

        session.flush()
        print(f"\n  TOTAL: {total_spaces} spaces ingested")

        # ─── 4. Process Vertical Cores ──────────────────────────────
        print("\n--- Processing Vertical Cores ---")
        total_cores = 0

        for floor_id, (filename, sheet_name) in VERTICAL_CORE_FILES.items():
            filepath = HOSPITAL_DATA_DIR / filename
            if not filepath.exists():
                continue

            records = process_vertical_cores(floor_id, filepath, sheet_name)
            for rec in records:
                core = VerticalCore(**rec)
                session.add(core)

            total_cores += len(records)
            if records:
                print(f"  {floor_id}: {len(records)} vertical cores loaded")

        print(f"\n  TOTAL: {total_cores} vertical cores ingested")

        # ─── 5. Commit ──────────────────────────────────────────────
        session.commit()
        print("\n" + "=" * 60)
        print("Ingestion complete!")
        print(f"  Floors: {len(FLOOR_DEFINITIONS)}")
        print(f"  Spaces: {total_spaces}")
        print(f"  Vertical Cores: {total_cores}")
        print(f"  Translations: {len(FRENCH_TO_ENGLISH)}")
        print(f"  Database: {DATA_DIR / 'delta.db'}")
        print("=" * 60)

    except Exception as e:
        session.rollback()
        print(f"\nERROR: {e}")
        raise
    finally:
        session.close()


if __name__ == "__main__":
    run_ingestion()
