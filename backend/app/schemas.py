from pydantic import BaseModel


class FloorSummary(BaseModel):
    id: str
    name: str
    level: int
    elevation_cm: float | None = None
    total_area_m2: float | None = None
    total_spaces: int | None = None
    description: str | None = None

    model_config = {"from_attributes": True}


class SpaceSummary(BaseModel):
    id: str
    ifc_guid: str | None = None
    floor_id: str
    space_name: str | None = None
    room_number: str | None = None
    area_m2: float | None = None
    primary_function: str | None = None
    space_class: str | None = None
    occupiable: str | None = None
    functional_zone: str | None = None
    normal_occupancy: str | None = None
    max_occupancy: str | None = None
    accessible: str | None = None
    bookable: str | None = None
    access_level: str | None = None
    data_status: str | None = None

    model_config = {"from_attributes": True}


class SpaceDetail(BaseModel):
    id: str
    ifc_guid: str | None = None
    floor_id: str
    ifc_entity: str | None = None
    space_name: str | None = None
    room_number: str | None = None
    section: str | None = None
    service_code: str | None = None

    # Physical
    area_m2: float | None = None
    perimeter_cm: float | None = None
    height_cm: float | None = None
    calculation_height_cm: float | None = None
    subproject: str | None = None
    ifc_category: str | None = None
    ifc_reference: str | None = None
    floor_finish: str | None = None
    ceiling_finish: str | None = None
    construction_phase: str | None = None

    # Functional
    functional_zone: str | None = None
    zone_context_source: str | None = None
    zone_confidence: str | None = None
    nf_context: str | None = None
    primary_function: str | None = None
    secondary_functions: str | None = None
    space_class: str | None = None
    occupiable: str | None = None
    function_confidence: str | None = None
    analysis_basis: str | None = None

    # Occupancy
    normal_occupancy: str | None = None
    max_occupancy: str | None = None
    patient_capacity: str | None = None
    occupancy_basis: str | None = None
    occupancy_confidence: str | None = None

    # Access
    accessible: str | None = None
    bookable: str | None = None
    access_level: str | None = None
    visitor_access: str | None = None
    privacy_level: str | None = None
    patient_sensitive: str | None = None

    # Flexibility
    flexibility: str | None = None
    convertible_functions: str | None = None
    function_restrictions: str | None = None
    noise_sensitivity: str | None = None

    # Routing
    nearest_lift: str | None = None
    lift_distance_m: float | None = None
    nearest_stair: str | None = None
    stair_distance_m: float | None = None
    step_free_access: str | None = None
    adjacent_spaces: str | None = None
    connected_corridor: str | None = None

    # Facilities
    facilities_available: str | None = None

    # Visitors
    normal_visitors: str | None = None
    max_visitors: str | None = None
    visitor_access_type: str | None = None
    visiting_hours_restricted: str | None = None
    visitor_notes: str | None = None

    # Status
    data_status: str | None = None

    # Parent floor info
    floor_name: str | None = None

    model_config = {"from_attributes": True}


class VerticalCoreSummary(BaseModel):
    id: int
    floor_id: str
    name: str
    type: str
    original_name: str | None = None
    x_coord: float | None = None
    y_coord: float | None = None

    model_config = {"from_attributes": True}


class SpaceUpdateRequest(BaseModel):
    space_name: str | None = None
    primary_function: str | None = None


class PolygonSaveRequest(BaseModel):
    vertices: list[list[float]]
    floor_id: str
    space_name: str | None = None
    primary_function: str | None = None
    computed_area_m2: float | None = None
    computed_perimeter_cm: float | None = None


class SpacePolygonResponse(BaseModel):
    ifc_guid: str
    floor_id: str
    vertices: list[list[float]]
    space_name: str | None = None
    primary_function: str | None = None
    area_m2: float | None = None
    perimeter_m: float | None = None
    normal_occupancy: int = 0
    max_occupancy: int = 0
    absolute_occupancy: int = 0
    occupancy_class: str | None = None
    occupiable: bool = False
    used_area_m2: float | None = None
    free_area_m2: float | None = None
    furnishing_source: str | None = None
    created_at: str | None = None

    model_config = {"from_attributes": True}


class PolygonSyncItem(BaseModel):
    ifc_guid: str
    floor_id: str
    vertices: list[list[float]]
    space_name: str | None = None
    primary_function: str | None = None
    area_m2: float | None = None
    perimeter_cm: float | None = None


class SpaceMetricsResponse(BaseModel):
    ifc_guid: str
    floor_id: str
    area_m2: float | None = None
    perimeter_m: float | None = None
    normal_occupancy: int = 0
    max_occupancy: int = 0
    absolute_occupancy: int = 0
    occupancy_class: str | None = None
    occupiable: bool = False
    used_area_m2: float | None = None
    free_area_m2: float | None = None
    furnishing_source: str | None = None
    computed_at: str | None = None

    model_config = {"from_attributes": True}


# ── Furnishing schemas ──

class FurnishingTypeResponse(BaseModel):
    item_type: str
    category: str
    label: str
    footprint_m2: float
    normal_occ: int
    max_occ: int

    model_config = {"from_attributes": True}


class SpaceFurnishingCreate(BaseModel):
    ifc_guid: str
    floor_id: str
    item_type: str
    quantity: int = 1
    item_label: str | None = None
    notes: str | None = None


class SpaceFurnishingUpdate(BaseModel):
    quantity: int | None = None
    item_label: str | None = None
    notes: str | None = None


class SpaceFurnishingResponse(BaseModel):
    id: int
    ifc_guid: str
    floor_id: str
    item_type: str
    quantity: int
    item_label: str | None = None
    notes: str | None = None
    created_at: str | None = None
    # Joined from furnishing_types
    category: str | None = None
    label: str | None = None
    footprint_m2: float | None = None
    normal_occ: int | None = None
    max_occ: int | None = None

    model_config = {"from_attributes": True}


class SearchParams(BaseModel):
    q: str | None = None
    floor_id: str | None = None
    primary_function: str | None = None
    min_area: float | None = None
    max_area: float | None = None
    bookable: str | None = None
    accessible: str | None = None
    space_class: str | None = None
    service_code: str | None = None
