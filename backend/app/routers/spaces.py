from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import or_, func

from app.database import get_db
from app.models import Space, Floor
from app.schemas import SpaceSummary, SpaceDetail, SpaceUpdateRequest

router = APIRouter(tags=["spaces"])


def _to_detail(space: Space) -> dict:
    """Convert a Space ORM object to a SpaceDetail dict with floor_name."""
    d = {c.name: getattr(space, c.name) for c in space.__table__.columns}
    d["floor_name"] = space.floor.name if space.floor else None
    return d


@router.get("/floors/{floor_id}/spaces", response_model=list[SpaceSummary])
def list_floor_spaces(floor_id: str, db: Session = Depends(get_db)):
    spaces = (
        db.query(Space)
        .filter(Space.floor_id == floor_id.upper())
        .order_by(Space.id)
        .all()
    )
    return spaces


@router.get("/spaces/search", response_model=list[SpaceDetail])
def search_spaces(
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
    query = db.query(Space).join(Floor)

    if floor_id:
        query = query.filter(Space.floor_id == floor_id.upper())

    if primary_function:
        query = query.filter(
            func.lower(Space.primary_function).contains(primary_function.lower())
        )

    if min_area is not None:
        query = query.filter(Space.area_m2 >= min_area)

    if max_area is not None:
        query = query.filter(Space.area_m2 <= max_area)

    if bookable:
        query = query.filter(func.lower(Space.bookable) == bookable.lower())

    if accessible:
        query = query.filter(func.lower(Space.accessible) == accessible.lower())

    if space_class:
        query = query.filter(
            func.lower(Space.space_class).contains(space_class.lower())
        )

    if service_code:
        query = query.filter(
            func.lower(Space.service_code).contains(service_code.lower())
        )

    if q:
        search_term = f"%{q.lower()}%"
        query = query.filter(
            or_(
                func.lower(Space.space_name).like(search_term),
                func.lower(Space.primary_function).like(search_term),
                func.lower(Space.functional_zone).like(search_term),
                func.lower(Space.room_number).like(search_term),
                func.lower(Space.id).like(search_term),
                func.lower(Space.facilities_available).like(search_term),
                func.lower(Space.convertible_functions).like(search_term),
            )
        )

    spaces = query.order_by(Space.floor_id, Space.id).limit(limit).all()
    return [SpaceDetail(**_to_detail(s)) for s in spaces]


@router.get("/spaces/by-guid/{ifc_guid}", response_model=SpaceDetail)
def get_space_by_guid(ifc_guid: str, db: Session = Depends(get_db)):
    space = (
        db.query(Space)
        .join(Floor)
        .filter(Space.ifc_guid == ifc_guid)
        .first()
    )
    if not space:
        raise HTTPException(status_code=404, detail=f"Space with GUID {ifc_guid} not found")
    return SpaceDetail(**_to_detail(space))


@router.patch("/spaces/by-guid/{ifc_guid}", response_model=SpaceDetail)
def update_space_by_guid(
    ifc_guid: str,
    body: SpaceUpdateRequest,
    db: Session = Depends(get_db),
):
    space = (
        db.query(Space)
        .join(Floor)
        .filter(Space.ifc_guid == ifc_guid)
        .first()
    )
    if not space:
        raise HTTPException(status_code=404, detail=f"Space with GUID {ifc_guid} not found")

    if body.space_name is not None:
        space.space_name = body.space_name
    if body.primary_function is not None:
        space.primary_function = body.primary_function

    db.commit()
    db.refresh(space)
    return SpaceDetail(**_to_detail(space))


@router.get("/spaces/{space_id}", response_model=SpaceDetail)
def get_space(space_id: str, db: Session = Depends(get_db)):
    space = (
        db.query(Space)
        .join(Floor)
        .filter(Space.id == space_id)
        .first()
    )
    if not space:
        raise HTTPException(status_code=404, detail=f"Space {space_id} not found")
    return SpaceDetail(**_to_detail(space))
