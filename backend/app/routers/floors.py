from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Floor, VerticalCore
from app.schemas import FloorSummary, VerticalCoreSummary

router = APIRouter(tags=["floors"])


@router.get("/floors", response_model=list[FloorSummary])
def list_floors(db: Session = Depends(get_db)):
    floors = db.query(Floor).order_by(Floor.level).all()
    return floors


@router.get("/floors/{floor_id}", response_model=FloorSummary)
def get_floor(floor_id: str, db: Session = Depends(get_db)):
    floor = db.query(Floor).filter(Floor.id == floor_id.upper()).first()
    if not floor:
        raise HTTPException(status_code=404, detail=f"Floor {floor_id} not found")
    return floor


@router.get("/vertical-cores", response_model=list[VerticalCoreSummary])
def list_vertical_cores(floor_id: str | None = None, db: Session = Depends(get_db)):
    query = db.query(VerticalCore)
    if floor_id:
        query = query.filter(VerticalCore.floor_id == floor_id.upper())
    return query.all()
