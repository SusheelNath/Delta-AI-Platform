"""
USquare Room Extraction Script (Option A)
Extracts room boundaries from IFC elements tagged with 'Nom de la pièce'.

Strategy:
1. Parse ABC architectural IFC (the only file with room names)
2. Find elements with 'Nom de la pièce' property
3. Trace each element to its containing IfcBuildingStorey
4. Group elements by (storey, room_name) to identify distinct rooms
5. Extract element geometry bounding boxes
6. Compute room boundary polygons from grouped element bounds
"""

import ifcopenshell
import ifcopenshell.geom
import json
import sys
from collections import defaultdict
from pathlib import Path

IFC_PATH = Path(r"C:\Users\sushe\Downloads\USquare\USQUARE-13895_BATIMENT_ABC_BIM_ASBUILT.ifc")
OUTPUT_DIR = Path(r"C:\Users\sushe\Desktop\Desktop\Modak Labs LLC\Deployments\Delta Intelligence Platform\scripts")


def get_element_storey(element, _cache={}):
    """Walk containment to find IfcBuildingStorey for an element."""
    eid = element.id()
    if eid in _cache:
        return _cache[eid]

    result = None

    # Method 1: IfcRelContainedInSpatialStructure
    if hasattr(element, "ContainedInStructure"):
        for rel in element.ContainedInStructure:
            struct = rel.RelatingStructure
            if struct.is_a("IfcBuildingStorey"):
                result = struct
                break
            # If contained in building/site, walk further
            if hasattr(struct, "Decomposes"):
                for decomp in struct.Decomposes:
                    parent = decomp.RelatingObject
                    if parent.is_a("IfcBuildingStorey"):
                        result = parent
                        break

    # Method 2: IfcRelAggregates (Decomposes)
    if result is None and hasattr(element, "Decomposes"):
        for rel in element.Decomposes:
            parent = rel.RelatingObject
            if parent.is_a("IfcBuildingStorey"):
                result = parent
                break
            # Recurse up
            result = get_element_storey(parent, _cache)
            if result:
                break

    _cache[eid] = result
    return result


def get_room_name_from_element(element):
    """Extract 'Nom de la pièce' property value from an element."""
    # Check via IsDefinedBy relationships
    if not hasattr(element, "IsDefinedBy"):
        return None

    for rel in element.IsDefinedBy:
        if rel.is_a("IfcRelDefinesByProperties"):
            pset = rel.RelatingPropertyDefinition
            if pset.is_a("IfcPropertySet") and hasattr(pset, "HasProperties"):
                for prop in pset.HasProperties:
                    if hasattr(prop, "Name") and prop.Name in ("Nom de la pièce", "Nom de la piece"):
                        if hasattr(prop, "NominalValue") and prop.NominalValue:
                            val = str(prop.NominalValue.wrappedValue).strip()
                            if val:
                                return val
    return None


def is_actual_room_name(name):
    """Filter out element type names that aren't actual room names."""
    # Known non-room patterns (element types, materials, dimensions)
    skip_patterns = [
        "mur de base", "mur ", "murs ", "sol", "toit", "plafond",
        "garde-corps", "men.", "meneau", "panneau", "grille",
        "groupe de mod", "ch\u00e2ssis", "vitrage", "cadre",
        "mod\u00e8le", "rideau", "dalle", "poutre", "poteau",
        "escalier_", "couvertine", "bardage", "profil",
        "euronorm", "he-", "heb", "hea", "ipe",
        "acier", "b\u00e9ton", "m\u00e9tal", "bois", "brique",
        "peinture", "enduit", "isolation",
    ]
    name_lower = name.lower()

    # Skip if it looks like a number or dimension
    try:
        float(name)
        return False
    except ValueError:
        pass

    # Skip numeric patterns like "15", "4", "13", "26"
    if name_lower.replace(".", "").replace(",", "").isdigit():
        return False

    for pat in skip_patterns:
        if name_lower.startswith(pat):
            return False

    return True


def main():
    print(f"Loading {IFC_PATH.name} ({IFC_PATH.stat().st_size / 1e6:.0f} MB)...")
    model = ifcopenshell.open(str(IFC_PATH))
    print(f"  Loaded. Schema: {model.schema}")

    # Build storey lookup
    storeys = model.by_type("IfcBuildingStorey")
    print(f"  {len(storeys)} storeys found")

    # --- Phase 1: Find all elements with room names ---
    print(f"\n--- Phase 1: Scanning elements for 'Nom de la pièce' ---")

    # We need to scan all building elements
    element_types = [
        "IfcWall", "IfcWallStandardCase", "IfcDoor", "IfcWindow",
        "IfcSlab", "IfcColumn", "IfcBeam", "IfcCovering",
        "IfcCurtainWall", "IfcFurnishingElement", "IfcBuildingElementProxy",
        "IfcStair", "IfcStairFlight", "IfcRailing", "IfcMember", "IfcPlate",
        "IfcRoof",
    ]

    # Collect: (storey_name, room_name) -> [element_ids]
    room_elements = defaultdict(list)
    no_storey_count = 0
    no_room_count = 0
    filtered_count = 0
    total_scanned = 0

    for etype in element_types:
        elements = model.by_type(etype)
        for elem in elements:
            total_scanned += 1
            room_name = get_room_name_from_element(elem)
            if not room_name:
                no_room_count += 1
                continue

            if not is_actual_room_name(room_name):
                filtered_count += 1
                continue

            storey = get_element_storey(elem)
            if not storey:
                no_storey_count += 1
                continue

            room_elements[(storey.Name, room_name)].append({
                "id": elem.id(),
                "guid": elem.GlobalId,
                "type": elem.is_a(),
                "name": elem.Name,
            })

    print(f"  Scanned {total_scanned} elements")
    print(f"  No room name: {no_room_count}")
    print(f"  Filtered (not a room): {filtered_count}")
    print(f"  No storey found: {no_storey_count}")
    print(f"  Room groups found: {len(room_elements)}")

    # --- Phase 2: Analyze room groups ---
    print(f"\n--- Phase 2: Room groups by storey ---")

    rooms_by_storey = defaultdict(list)
    for (storey_name, room_name), elems in sorted(room_elements.items()):
        rooms_by_storey[storey_name].append({
            "room_name": room_name,
            "element_count": len(elems),
            "element_types": list(set(e["type"] for e in elems)),
            "element_guids": [e["guid"] for e in elems],
        })

    for storey_name in sorted(rooms_by_storey.keys()):
        rooms = rooms_by_storey[storey_name]
        total_elems = sum(r["element_count"] for r in rooms)
        print(f"\n  {storey_name}: {len(rooms)} rooms, {total_elems} tagged elements")
        for r in sorted(rooms, key=lambda x: -x["element_count"])[:8]:
            types_str = ", ".join(r["element_types"][:3])
            print(f"    {r['element_count']:3d} elems | {r['room_name']:<30s} | [{types_str}]")

    # --- Phase 3: Attempt geometry extraction ---
    print(f"\n--- Phase 3: Geometry extraction (bounding boxes) ---")
    print(f"  Setting up geometry processing...")

    settings = ifcopenshell.geom.settings()
    settings.set("use-world-coords", True)

    # Test with a small subset first
    test_rooms = list(room_elements.items())[:5]
    geometry_results = []

    for (storey_name, room_name), elems in test_rooms:
        print(f"\n  Testing: {storey_name} / {room_name} ({len(elems)} elements)")
        room_bounds = {
            "min_x": float("inf"), "min_y": float("inf"), "min_z": float("inf"),
            "max_x": float("-inf"), "max_y": float("-inf"), "max_z": float("-inf"),
        }
        geom_count = 0

        for elem_info in elems[:10]:  # Limit to 10 elements per room for testing
            try:
                ifc_elem = model.by_id(elem_info["id"])
                shape = ifcopenshell.geom.create_shape(settings, ifc_elem)
                verts = shape.geometry.verts
                # Vertices are flat [x1,y1,z1, x2,y2,z2, ...]
                for i in range(0, len(verts), 3):
                    x, y, z = verts[i], verts[i+1], verts[i+2]
                    room_bounds["min_x"] = min(room_bounds["min_x"], x)
                    room_bounds["min_y"] = min(room_bounds["min_y"], y)
                    room_bounds["min_z"] = min(room_bounds["min_z"], z)
                    room_bounds["max_x"] = max(room_bounds["max_x"], x)
                    room_bounds["max_y"] = max(room_bounds["max_y"], y)
                    room_bounds["max_z"] = max(room_bounds["max_z"], z)
                geom_count += 1
            except Exception as e:
                print(f"    Geom failed for {elem_info['guid']}: {e}")

        if geom_count > 0:
            dx = room_bounds["max_x"] - room_bounds["min_x"]
            dy = room_bounds["max_y"] - room_bounds["min_y"]
            dz = room_bounds["max_z"] - room_bounds["min_z"]
            # Convert from model units (centimeters) to meters
            area_approx = (dx * dy) / 10000  # cm² to m²
            print(f"    Geometry: {geom_count}/{len(elems)} elements processed")
            print(f"    Bounds: X=[{room_bounds['min_x']:.1f}, {room_bounds['max_x']:.1f}] "
                  f"Y=[{room_bounds['min_y']:.1f}, {room_bounds['max_y']:.1f}] "
                  f"Z=[{room_bounds['min_z']:.1f}, {room_bounds['max_z']:.1f}]")
            print(f"    Size: {dx:.1f} x {dy:.1f} x {dz:.1f} cm")
            print(f"    Approx area: {area_approx:.1f} m²")

            geometry_results.append({
                "storey": storey_name,
                "room_name": room_name,
                "bounds": room_bounds,
                "area_m2_approx": round(area_approx, 1),
                "elements_with_geom": geom_count,
                "elements_total": len(elems),
            })

    # --- Save intermediate results ---
    output = {
        "summary": {
            "total_scanned": total_scanned,
            "room_groups": len(room_elements),
            "storeys_with_rooms": len(rooms_by_storey),
        },
        "rooms_by_storey": {
            storey: [
                {
                    "room_name": r["room_name"],
                    "element_count": r["element_count"],
                    "element_types": r["element_types"],
                    "sample_guids": r["element_guids"][:5],
                }
                for r in rooms
            ]
            for storey, rooms in rooms_by_storey.items()
        },
        "geometry_test": geometry_results,
    }

    out_path = OUTPUT_DIR / "usquare_rooms_extraction.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)
    print(f"\n\nResults saved to {out_path}")

    # --- Summary ---
    print(f"\n{'='*60}")
    print(f"  EXTRACTION SUMMARY")
    print(f"{'='*60}")
    all_room_names = set()
    total_rooms = 0
    for rooms in rooms_by_storey.values():
        total_rooms += len(rooms)
        for r in rooms:
            all_room_names.add(r["room_name"])

    print(f"  Distinct room names: {len(all_room_names)}")
    print(f"  Total room instances (storey x name): {total_rooms}")
    print(f"  Storeys with rooms: {len(rooms_by_storey)}")
    print(f"\n  All distinct room names:")
    for name in sorted(all_room_names):
        print(f"    - {name}")


if __name__ == "__main__":
    main()
