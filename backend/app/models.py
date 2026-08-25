from sqlalchemy import Column, String, Float, Integer, Boolean, Text, ForeignKey
from sqlalchemy.orm import relationship

from app.database import Base


class Floor(Base):
    __tablename__ = "floors"

    id = Column(String, primary_key=True)  # H000, H001, etc.
    name = Column(String, nullable=False)  # "Ground Floor", "Basement 1"
    level = Column(Integer, nullable=False)  # 0, -1, -2, 1, 2...
    elevation_cm = Column(Float, nullable=True)
    total_area_m2 = Column(Float, nullable=True)
    total_spaces = Column(Integer, nullable=True)
    description = Column(Text, nullable=True)

    spaces = relationship("Space", back_populates="floor")
    vertical_cores = relationship("VerticalCore", back_populates="floor")


class Space(Base):
    __tablename__ = "spaces"

    id = Column(String, primary_key=True)  # Space ID from Excel
    ifc_guid = Column(String, unique=True, index=True, nullable=True)
    floor_id = Column(String, ForeignKey("floors.id"), nullable=False, index=True)
    ifc_entity = Column(String, nullable=True)
    space_name = Column(String, nullable=True)
    room_number = Column(String, nullable=True)
    section = Column(String, nullable=True)
    service_code = Column(String, nullable=True)

    # Physical
    area_m2 = Column(Float, nullable=True)
    perimeter_cm = Column(Float, nullable=True)
    height_cm = Column(Float, nullable=True)
    calculation_height_cm = Column(Float, nullable=True)
    subproject = Column(String, nullable=True)
    ifc_category = Column(String, nullable=True)
    ifc_reference = Column(String, nullable=True)
    floor_finish = Column(String, nullable=True)
    ceiling_finish = Column(String, nullable=True)
    construction_phase = Column(String, nullable=True)

    # Functional
    functional_zone = Column(String, nullable=True)
    zone_context_source = Column(String, nullable=True)
    zone_confidence = Column(String, nullable=True)
    nf_context = Column(String, nullable=True)
    primary_function = Column(String, nullable=True)
    secondary_functions = Column(String, nullable=True)
    space_class = Column(String, nullable=True)
    occupiable = Column(String, nullable=True)
    function_confidence = Column(String, nullable=True)
    analysis_basis = Column(String, nullable=True)

    # Occupancy
    normal_occupancy = Column(String, nullable=True)
    max_occupancy = Column(String, nullable=True)
    patient_capacity = Column(String, nullable=True)
    occupancy_basis = Column(String, nullable=True)
    occupancy_confidence = Column(String, nullable=True)

    # Access
    accessible = Column(String, nullable=True)
    bookable = Column(String, nullable=True)
    access_level = Column(String, nullable=True)
    visitor_access = Column(String, nullable=True)
    privacy_level = Column(String, nullable=True)
    patient_sensitive = Column(String, nullable=True)

    # Flexibility
    flexibility = Column(String, nullable=True)
    convertible_functions = Column(Text, nullable=True)
    function_restrictions = Column(Text, nullable=True)
    noise_sensitivity = Column(String, nullable=True)

    # Routing
    nearest_lift = Column(String, nullable=True)
    lift_distance_m = Column(Float, nullable=True)
    nearest_stair = Column(String, nullable=True)
    stair_distance_m = Column(Float, nullable=True)
    step_free_access = Column(String, nullable=True)
    adjacent_spaces = Column(String, nullable=True)
    connected_corridor = Column(String, nullable=True)

    # Facilities
    facilities_available = Column(Text, nullable=True)

    # Visitors
    normal_visitors = Column(String, nullable=True)
    max_visitors = Column(String, nullable=True)
    visitor_access_type = Column(String, nullable=True)
    visiting_hours_restricted = Column(String, nullable=True)
    visitor_notes = Column(Text, nullable=True)

    # Status
    data_status = Column(String, nullable=True)

    floor = relationship("Floor", back_populates="spaces")


class VerticalCore(Base):
    __tablename__ = "vertical_cores"

    id = Column(Integer, primary_key=True, autoincrement=True)
    floor_id = Column(String, ForeignKey("floors.id"), nullable=False, index=True)
    name = Column(String, nullable=False)  # English name
    type = Column(String, nullable=False)  # "lift" or "stair"
    original_name = Column(String, nullable=True)  # French original
    x_coord = Column(Float, nullable=True)
    y_coord = Column(Float, nullable=True)

    floor = relationship("Floor", back_populates="vertical_cores")


class SpacePolygon(Base):
    __tablename__ = "space_polygons"

    id = Column(Integer, primary_key=True, autoincrement=True)
    ifc_guid = Column(String, ForeignKey("spaces.ifc_guid"), nullable=False, index=True, unique=True)
    floor_id = Column(String, nullable=False, index=True)
    vertices_json = Column(Text, nullable=False)  # JSON: [[leftPct, topPct], ...]
    created_at = Column(String, nullable=True)
    updated_at = Column(String, nullable=True)


class Translation(Base):
    __tablename__ = "translations"

    id = Column(Integer, primary_key=True, autoincrement=True)
    french = Column(String, nullable=False, index=True)
    english = Column(String, nullable=False)
    category = Column(String, nullable=True)  # space_code, department, function, etc.
