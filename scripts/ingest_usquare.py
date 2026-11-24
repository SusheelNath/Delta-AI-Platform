"""
USquare Campus — Database Ingest Script

Populates delta.db with:
  1. Floor definitions (35 floors, 8 buildings, bilingual EN+AR)
  2. Room data from extraction results (Option A)
  3. Translations (Dutch→English, French→English IFC vocabulary)

Run from project root:
  cd backend && python -m scripts.ingest_usquare
  OR
  python scripts/ingest_usquare.py
"""

import json
import sys
import os
from pathlib import Path

# Add backend to Python path
SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
BACKEND_DIR = PROJECT_ROOT / "backend"
sys.path.insert(0, str(BACKEND_DIR))

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models import Floor, Space, VerticalCore, Translation
from app.config import DATABASE_URL

# Import USquare data modules
sys.path.insert(0, str(SCRIPT_DIR))
from usquare_floor_definitions import FLOOR_DEFINITIONS, FLOOR_ORDER, BUILDINGS, BUILDING_ORDER
from usquare_translations import (
    ROOM_NAME_NL_EN_AR, FUNCTION_CATEGORIES, FR_EN_IFC_VOCAB,
    SERVICE_CODES, translate_room_name,
)


def main():
    print("=" * 70)
    print("  Delta Intelligence Platform — USquare Database Ingest")
    print("=" * 70)

    # Connect to database
    engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
    Session = sessionmaker(bind=engine)

    # Create tables
    Base.metadata.create_all(bind=engine)
    db = Session()

    try:
        # ── 1. Ingest Floor Definitions ──
        print("\n--- Phase 1: Floor Definitions ---")
        ingest_floors(db)

        # ── 2. Ingest Room Data ──
        print("\n--- Phase 2: Room Data (from extraction) ---")
        ingest_rooms(db)

        # ── 3. Ingest Translations ──
        print("\n--- Phase 3: Translations ---")
        ingest_translations(db)

        # ── 4. Ingest Vertical Cores ──
        print("\n--- Phase 4: Vertical Cores (stairs/lifts from room names) ---")
        ingest_vertical_cores(db)

        db.commit()
        print("\n" + "=" * 70)
        print("  INGEST COMPLETE")
        print("=" * 70)

        # Summary
        print(f"\n  Floors:    {db.query(Floor).count()}")
        print(f"  Spaces:    {db.query(Space).count()}")
        print(f"  V. Cores:  {db.query(VerticalCore).count()}")
        print(f"  Translations: {db.query(Translation).count()}")

    except Exception as e:
        db.rollback()
        print(f"\nERROR: {e}")
        import traceback
        traceback.print_exc()
    finally:
        db.close()


def ingest_floors(db):
    """Populate floors table from usquare_floor_definitions."""
    existing = {f.id for f in db.query(Floor).all()}
    added = 0

    for i, floor_id in enumerate(FLOOR_ORDER):
        if floor_id in existing:
            continue

        fdef = FLOOR_DEFINITIONS[floor_id]
        db.add(Floor(
            id=floor_id,
            name=fdef["name"],
            level=i,  # Use order index as level for sorting
            elevation_cm=fdef["elevation_cm"],
            total_area_m2=None,  # Computed from polygons later
            total_spaces=None,
            description=fdef.get("description", ""),
        ))
        added += 1

    db.flush()
    print(f"  Added {added} floors ({len(existing)} already existed)")


def ingest_rooms(db):
    """Populate spaces table from room extraction results."""
    extraction_path = SCRIPT_DIR / "usquare_rooms_extraction.json"
    if not extraction_path.exists():
        print("  SKIP: usquare_rooms_extraction.json not found")
        print("  Run extract_usquare_rooms.py first")
        return

    with open(extraction_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    # Map IFC storey names to our floor IDs
    from usquare_floor_definitions import IFC_STOREY_TO_FLOOR_ID

    existing_guids = {s.ifc_guid for s in db.query(Space).all() if s.ifc_guid}
    added = 0
    skipped = 0

    rooms_by_storey = data.get("rooms_by_storey", {})
    space_counter = 0

    for ifc_storey, rooms in rooms_by_storey.items():
        floor_id = IFC_STOREY_TO_FLOOR_ID.get(ifc_storey)
        if not floor_id:
            print(f"  WARN: unmapped storey '{ifc_storey}', skipping {len(rooms)} rooms")
            continue

        for room in rooms:
            room_name_nl = room["room_name"]
            en_name, ar_name, function_key = translate_room_name(room_name_nl)

            # Use the first sample GUID as the space identifier
            sample_guids = room.get("sample_guids", [])
            ifc_guid = sample_guids[0] if sample_guids else None

            if ifc_guid and ifc_guid in existing_guids:
                skipped += 1
                continue

            space_counter += 1
            space_id = f"USQ_{floor_id}_{space_counter:04d}"

            # Get function category info
            func_cat = FUNCTION_CATEGORIES.get(function_key, {})
            category = func_cat.get("category", "unknown")

            db.add(Space(
                id=space_id,
                ifc_guid=ifc_guid,
                floor_id=floor_id,
                space_name=en_name,
                room_number=None,
                section=FLOOR_DEFINITIONS.get(floor_id, {}).get("building", ""),
                service_code=None,
                primary_function=func_cat.get("label", en_name),
                functional_zone=category.title(),
                space_class=category,
                occupiable="Yes" if category not in ("circulation", "technical") else "No",
                data_status="extracted",
            ))
            added += 1

    db.flush()
    print(f"  Added {added} spaces ({skipped} already existed)")


def ingest_translations(db):
    """Populate translations table with Dutch→English and French→English."""
    existing = {(t.french, t.category) for t in db.query(Translation).all()}
    added = 0

    # Dutch room name translations
    for nl_name, data in ROOM_NAME_NL_EN_AR.items():
        key = (nl_name, "room_name")
        if key not in existing:
            db.add(Translation(
                french=nl_name,  # Reusing "french" column for source language
                english=data["en"],
                category="room_name",
            ))
            added += 1

    # French IFC vocabulary
    for fr_term, en_term in FR_EN_IFC_VOCAB:
        key = (fr_term, "ifc_vocab")
        if key not in existing:
            db.add(Translation(
                french=fr_term,
                english=en_term,
                category="ifc_vocab",
            ))
            added += 1

    # Service codes
    for code, data in SERVICE_CODES.items():
        key = (code, "service_code")
        if key not in existing:
            db.add(Translation(
                french=code,
                english=data["en"],
                category="service_code",
            ))
            added += 1

    db.flush()
    print(f"  Added {added} translations ({len(existing)} already existed)")


def ingest_vertical_cores(db):
    """Extract vertical cores (stairs/lifts) from room names."""
    existing = db.query(VerticalCore).count()
    if existing > 0:
        print(f"  SKIP: {existing} vertical cores already exist")
        return

    extraction_path = SCRIPT_DIR / "usquare_rooms_extraction.json"
    if not extraction_path.exists():
        return

    with open(extraction_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    from usquare_floor_definitions import IFC_STOREY_TO_FLOOR_ID

    added = 0
    stair_keywords = {"trap", "trappenhal", "staircase", "stairwell", "stair"}
    lift_keywords = {"lift", "elevator", "ascenseur"}

    rooms_by_storey = data.get("rooms_by_storey", {})
    for ifc_storey, rooms in rooms_by_storey.items():
        floor_id = IFC_STOREY_TO_FLOOR_ID.get(ifc_storey)
        if not floor_id:
            continue

        for room in rooms:
            name_lower = room["room_name"].lower()
            en_name, _, _ = translate_room_name(room["room_name"])

            core_type = None
            if any(kw in name_lower for kw in stair_keywords):
                core_type = "stair"
            elif any(kw in name_lower for kw in lift_keywords):
                core_type = "lift"

            if core_type:
                db.add(VerticalCore(
                    floor_id=floor_id,
                    name=en_name,
                    type=core_type,
                    original_name=room["room_name"],
                ))
                added += 1

    db.flush()
    print(f"  Added {added} vertical cores")


if __name__ == "__main__":
    main()
