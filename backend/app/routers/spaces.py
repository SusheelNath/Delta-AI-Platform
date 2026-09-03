"""Space endpoints — polygon-driven.

All data derives from polygons.json + computed intelligence.
The DB Space table is no longer queried.
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.services.polygon_intelligence import (
    read_all_polygons,
    compute_space_intelligence,
    compute_floor_intelligence,
    get_floor_polygons,
    search_polygons,
    FLOOR_NAMES,
)
from app.services.classifier import classify_function
from app.services.geometry import compute_floor_spatial

router = APIRouter(tags=["spaces"])


def _polygon_to_summary(p: dict, metadata: dict | None = None) -> dict:
    """Convert a polygon + optional classifier metadata to a summary dict."""
    if metadata is None:
        metadata = classify_function(p.get("primary_function"), p.get("space_name"))
    return {
        "id": p.get("ifc_guid", ""),
        "ifc_guid": p.get("ifc_guid"),
        "floor_id": p.get("floor_id", ""),
        "space_name": p.get("space_name"),
        "room_number": None,
        "area_m2": p.get("area_m2"),
        "primary_function": p.get("primary_function"),
        "space_class": metadata.get("space_class"),
        "occupiable": metadata.get("accessible"),
        "functional_zone": metadata.get("functional_zone"),
        "normal_occupancy": None,
        "max_occupancy": None,
        "accessible": metadata.get("accessible"),
        "bookable": metadata.get("bookable"),
        "access_level": metadata.get("access_level"),
        "data_status": "complete" if (p.get("primary_function") and p.get("area_m2")) else "partial",
    }


@router.get("/floors/{floor_id}/spaces")
def list_floor_spaces(floor_id: str, db: Session = Depends(get_db)):
    """List all spaces on a floor (from polygons)."""
    polygons = get_floor_polygons(floor_id)
    return [_polygon_to_summary(p) for p in polygons]


@router.get("/spaces/search")
def search_spaces_endpoint(
    q: str | None = None,
    floor_id: str | None = None,
    primary_function: str | None = None,
    min_area: float | None = None,
    max_area: float | None = None,
    bookable: str | None = None,
    accessible: str | None = None,
    space_class: str | None = None,
    service_code: str | None = None,
    limit: int = Query(default=100, le=500),
    db: Session = Depends(get_db),
):
    """Search spaces across all polygons with filters."""
    polygons = read_all_polygons()

    # Text + area + floor filters handled by search_polygons
    results = search_polygons(
        polygons=polygons,
        q=q,
        floor_id=floor_id,
        primary_function=primary_function,
        min_area=min_area,
        max_area=max_area,
        limit=500,  # pre-filter generously, then apply classifier filters
    )

    # Post-filter by classifier-derived fields
    filtered = []
    for p in results:
        meta = classify_function(p.get("primary_function"), p.get("space_name"))

        if bookable and meta.get("bookable", "").lower() != bookable.lower():
            continue
        if accessible and meta.get("accessible", "").lower() != accessible.lower():
            continue
        if space_class and space_class.lower() not in meta.get("space_class", "").lower():
            continue

        # Compute full intelligence for search results
        floor_polys = [pp for pp in polygons if pp.get("floor_id") == p.get("floor_id")]
        intel = compute_space_intelligence(p, floor_polys, db)
        filtered.append(intel)

        if len(filtered) >= limit:
            break

    return filtered


@router.get("/spaces/by-guid/{ifc_guid}")
def get_space_by_guid(ifc_guid: str, db: Session = Depends(get_db)):
    """Get full space intelligence by GUID (from polygon + computed data)."""
    polygons = read_all_polygons()
    poly = next((p for p in polygons if p.get("ifc_guid") == ifc_guid), None)

    if not poly:
        raise HTTPException(status_code=404, detail=f"No polygon with GUID {ifc_guid}")

    floor_id = poly.get("floor_id", "")
    floor_polygons = [p for p in polygons if p.get("floor_id") == floor_id]

    return compute_space_intelligence(poly, floor_polygons, db)


@router.patch("/spaces/by-guid/{ifc_guid}")
def update_space_by_guid(ifc_guid: str, body: dict, db: Session = Depends(get_db)):
    """Polygon metadata is permanently locked.

    space_name, primary_function, vertices, area_m2, and perimeter_cm
    cannot be modified through any API endpoint.
    """
    raise HTTPException(
        status_code=403,
        detail="Polygon metadata is permanently locked. "
               "space_name, primary_function, vertices, area, and perimeter cannot be modified.",
    )


@router.get("/spaces/{space_id}")
def get_space(space_id: str, db: Session = Depends(get_db)):
    """Get space by ID (which is ifc_guid in polygon-first world)."""
    return get_space_by_guid(space_id, db)
