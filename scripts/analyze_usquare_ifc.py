"""
USquare IFC Analysis Script
Parses all 4 USquare IFC files to extract:
- Building storeys with elevations
- Room names from property sets
- Element counts by type
- IfcSpace entities (if any)
- Property structure for room boundary extraction
"""

import ifcopenshell
import os
import json
from collections import Counter, defaultdict
from pathlib import Path

IFC_DIR = Path(r"C:\Users\sushe\Downloads\USquare")

FILES = {
    "SITE": "SITE_USQUARE_BPC.ifc",
    "ABC_ARCH": "USQUARE-13895_BATIMENT_ABC_BIM_ASBUILT.ifc",
    "M_ARCH": "USQUARE-13895_BATIMENT_M_BIM_ASBUILT.ifc",
    "ABC_MEP": "USQUARE-13895_TS_BATIMENT_ABC_BIM_ASBUILT.ifc",
}


def analyze_file(label, filename):
    filepath = IFC_DIR / filename
    print(f"\n{'='*80}")
    print(f"  {label}: {filename} ({filepath.stat().st_size / 1e6:.1f} MB)")
    print(f"{'='*80}")

    model = ifcopenshell.open(str(filepath))
    schema = model.schema

    print(f"\n  Schema: {schema}")

    # --- Header info ---
    # (ifcopenshell doesn't expose FILE_NAME directly, skip)

    # --- IfcProject ---
    projects = model.by_type("IfcProject")
    for p in projects:
        print(f"\n  IfcProject: '{p.Name}' | Description: '{p.Description}'")

    # --- IfcSite ---
    sites = model.by_type("IfcSite")
    print(f"\n  IfcSite count: {len(sites)}")
    for s in sites[:5]:
        print(f"    - '{s.Name}' | '{s.Description}' | RefLat={s.RefLatitude} RefLon={s.RefLongitude}")

    # --- IfcBuilding ---
    buildings = model.by_type("IfcBuilding")
    print(f"\n  IfcBuilding count: {len(buildings)}")
    for b in buildings:
        print(f"    - '{b.Name}' | '{b.Description}'")
        # Check for address
        if b.BuildingAddress:
            addr = b.BuildingAddress
            print(f"      Address: {addr.AddressLines}, {addr.Town}, {addr.PostalCode}, {addr.Country}")

    # --- IfcBuildingStorey ---
    storeys = model.by_type("IfcBuildingStorey")
    print(f"\n  IfcBuildingStorey count: {len(storeys)}")
    storey_data = []
    for s in storeys:
        elev = s.Elevation if s.Elevation else 0
        storey_data.append({
            "name": s.Name,
            "elevation": elev,
            "guid": s.GlobalId,
            "description": s.Description,
        })
    storey_data.sort(key=lambda x: x["elevation"])
    for i, sd in enumerate(storey_data):
        print(f"    {i+1:2d}. {sd['name']:<35s} elev={sd['elevation']:>8.1f}  guid={sd['guid']}")

    # --- IfcSpace ---
    spaces = model.by_type("IfcSpace")
    print(f"\n  IfcSpace count: {len(spaces)}")
    if spaces:
        for sp in spaces[:10]:
            print(f"    - '{sp.Name}' | '{sp.LongName}' | guid={sp.GlobalId}")

    # --- Room names from properties ---
    print(f"\n  Scanning for room-name properties...")
    room_props = Counter()
    room_prop_keys = set()
    elements_with_rooms = []

    # Check all property sets for room-related properties
    psets = model.by_type("IfcPropertySet")
    room_related_keys = {"nom de la piece", "room name", "room number", "name",
                         "space name", "ruimtenaam", "ruimte", "kamernaam",
                         "nom", "piecename", "roomname"}

    for pset in psets:
        if not hasattr(pset, "HasProperties"):
            continue
        for prop in pset.HasProperties:
            if not hasattr(prop, "Name"):
                continue
            pname_lower = prop.Name.lower().strip()
            if any(rk in pname_lower for rk in room_related_keys):
                room_prop_keys.add(prop.Name)
                if hasattr(prop, "NominalValue") and prop.NominalValue:
                    val = prop.NominalValue.wrappedValue
                    if val and str(val).strip():
                        room_props[str(val).strip()] += 1

    print(f"  Room-related property keys found: {room_prop_keys}")
    print(f"  Distinct room names: {len(room_props)}")
    print(f"  Total room-name occurrences: {sum(room_props.values())}")
    if room_props:
        print(f"\n  Top 40 room names:")
        for name, count in room_props.most_common(40):
            print(f"    {count:4d}x  {name}")

    # --- Element type counts ---
    print(f"\n  Element type counts:")
    type_counts = Counter()
    for entity in model:
        type_counts[entity.is_a()] += 1

    # Show relevant types
    relevant = ["IfcWall", "IfcWallStandardCase", "IfcDoor", "IfcWindow",
                "IfcSlab", "IfcColumn", "IfcBeam", "IfcMember", "IfcPlate",
                "IfcRoof", "IfcCurtainWall", "IfcStair", "IfcStairFlight",
                "IfcRailing", "IfcCovering", "IfcFurnishingElement",
                "IfcBuildingElementProxy", "IfcFlowSegment", "IfcFlowTerminal",
                "IfcFlowFitting", "IfcFlowController", "IfcDistributionPort",
                "IfcSpace", "IfcZone"]
    for t in relevant:
        if type_counts.get(t, 0) > 0:
            print(f"    {t:<30s} {type_counts[t]:>6d}")

    # --- Property set survey (sample) ---
    print(f"\n  Property set names (distinct):")
    pset_names = Counter()
    for pset in psets:
        if pset.Name:
            pset_names[pset.Name] += 1
    for name, count in pset_names.most_common(30):
        print(f"    {count:5d}x  {name}")

    # --- Find elements with room assignments ---
    print(f"\n  Analyzing room-to-storey relationships...")
    room_by_storey = defaultdict(Counter)

    for pset in psets:
        if not hasattr(pset, "HasProperties"):
            continue
        room_val = None
        for prop in pset.HasProperties:
            if hasattr(prop, "Name") and prop.Name == "Nom de la piece":
                if hasattr(prop, "NominalValue") and prop.NominalValue:
                    room_val = str(prop.NominalValue.wrappedValue).strip()
                    break
        if not room_val:
            continue

        # Find which elements use this pset
        if hasattr(pset, "DefinesOccurrence"):
            for rel in pset.DefinesOccurrence:
                if hasattr(rel, "RelatedObjects"):
                    for obj in rel.RelatedObjects:
                        # Walk up containment to find storey
                        storey_name = _find_storey(obj)
                        if storey_name:
                            room_by_storey[storey_name][room_val] += 1

    if room_by_storey:
        print(f"\n  Rooms by storey:")
        for storey in sorted(room_by_storey.keys()):
            rooms = room_by_storey[storey]
            total = sum(rooms.values())
            distinct = len(rooms)
            print(f"    {storey:<35s} {distinct:3d} distinct rooms, {total:4d} tagged elements")
            for rname, cnt in rooms.most_common(5):
                print(f"      {cnt:3d}x {rname}")

    return {
        "label": label,
        "filename": filename,
        "schema": schema,
        "storey_count": len(storeys),
        "storeys": storey_data,
        "space_count": len(spaces),
        "room_names": dict(room_props),
        "room_by_storey": {k: dict(v) for k, v in room_by_storey.items()},
    }


def _find_storey(element):
    """Walk containment hierarchy to find the IfcBuildingStorey."""
    # Try direct containment
    if hasattr(element, "ContainedInStructure"):
        for rel in element.ContainedInStructure:
            if hasattr(rel, "RelatingStructure"):
                struct = rel.RelatingStructure
                if struct.is_a("IfcBuildingStorey"):
                    return struct.Name
    # Try decomposition
    if hasattr(element, "Decomposes"):
        for rel in element.Decomposes:
            if hasattr(rel, "RelatingObject"):
                parent = rel.RelatingObject
                if parent.is_a("IfcBuildingStorey"):
                    return parent.Name
                return _find_storey(parent)
    return None


def main():
    results = {}
    for label, filename in FILES.items():
        filepath = IFC_DIR / filename
        if not filepath.exists():
            print(f"SKIP: {filename} not found")
            continue
        try:
            results[label] = analyze_file(label, filename)
        except Exception as e:
            print(f"ERROR analyzing {filename}: {e}")
            import traceback
            traceback.print_exc()

    # Save results
    output_path = Path(r"C:\Users\sushe\Desktop\Desktop\Modak Labs LLC\Deployments\Delta Intelligence Platform\scripts\usquare_analysis.json")
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2, ensure_ascii=False)
    print(f"\n\nResults saved to {output_path}")


if __name__ == "__main__":
    main()
