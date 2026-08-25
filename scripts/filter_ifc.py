"""
Delta Intelligence Platform — IFC Object Filter

Reads excluded_objects.json (exported from the browser tool) and removes
those objects from the source IFC file, producing a filtered IFC ready
for XKT conversion.

Usage: python scripts/filter_ifc.py

Prerequisites: pip install ifcopenshell
"""

import json
import sys
import time
from pathlib import Path

try:
    import ifcopenshell
    import ifcopenshell.util.element
except ImportError:
    print("ERROR: ifcopenshell is not installed.")
    print("Install it with: pip install ifcopenshell")
    sys.exit(1)

SCRIPTS_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPTS_DIR.parent
EXCLUSIONS_FILE = SCRIPTS_DIR / "excluded_objects.json"

IFC_SOURCE = Path(r"C:\Users\sushe\Downloads\Hospital AI platform\A10004_Chirec_Light_IFC (1).ifc")
IFC_FILTERED = SCRIPTS_DIR / "hospital_filtered.ifc"


def main():
    print("=" * 60)
    print("Delta Intelligence Platform — IFC Object Filter")
    print("=" * 60)

    # Load exclusion list
    if not EXCLUSIONS_FILE.exists():
        print(f"\nERROR: {EXCLUSIONS_FILE} not found.")
        print("Use the browser tool to select and hide objects, then click 'Export for XKT bake'.")
        sys.exit(1)

    excluded_ids = set(json.loads(EXCLUSIONS_FILE.read_text()))
    print(f"\nExclusion list: {len(excluded_ids)} object IDs loaded")

    if len(excluded_ids) == 0:
        print("No objects to exclude. Nothing to do.")
        sys.exit(0)

    # Load IFC
    if not IFC_SOURCE.exists():
        print(f"\nERROR: IFC file not found at {IFC_SOURCE}")
        sys.exit(1)

    print(f"\nSource IFC: {IFC_SOURCE}")
    print(f"File size: {IFC_SOURCE.stat().st_size / 1024 / 1024:.0f} MB")
    print("\nLoading IFC file (this may take a few minutes for large files)...")

    start = time.time()
    ifc = ifcopenshell.open(str(IFC_SOURCE))
    load_time = time.time() - start
    print(f"Loaded in {load_time:.1f}s")

    # Find and remove excluded objects
    print(f"\nSearching for {len(excluded_ids)} objects to remove...")
    removed = 0
    not_found = 0

    for guid in excluded_ids:
        try:
            element = ifc.by_guid(guid)
            ifcopenshell.util.element.remove_deep2(ifc, element)
            removed += 1
        except RuntimeError:
            # GUID not found in IFC
            not_found += 1
        except Exception as e:
            print(f"  Warning: Could not remove {guid}: {e}")

    print(f"\nRemoved: {removed} objects")
    if not_found > 0:
        print(f"Not found (already absent or invalid GUID): {not_found}")

    # Write filtered IFC
    print(f"\nWriting filtered IFC to: {IFC_FILTERED}")
    write_start = time.time()
    ifc.write(str(IFC_FILTERED))
    write_time = time.time() - write_start
    filtered_size = IFC_FILTERED.stat().st_size / 1024 / 1024

    total_time = time.time() - start
    print(f"Written in {write_time:.1f}s ({filtered_size:.0f} MB)")
    print(f"\nTotal time: {total_time:.1f}s")
    print("=" * 60)
    print(f"\nFiltered IFC saved to: {IFC_FILTERED}")
    print("\nNext step — reconvert to XKT:")
    print(f"  node scripts/convert_ifc.mjs --filtered")
    print("=" * 60)


if __name__ == "__main__":
    main()
