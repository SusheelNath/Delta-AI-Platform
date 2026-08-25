import React, { useState } from 'react';
import useStore from '../../store/useStore';
import './MetadataCard.css';

export default function MetadataCard() {
  const selectedSpace = useStore((s) => s.selectedSpace);
  const clearSelection = useStore((s) => s.clearSelection);
  const [expanded, setExpanded] = useState(false);

  if (!selectedSpace) return null;

  const s = selectedSpace;

  const handleClose = () => {
    setExpanded(false);
    clearSelection();
  };

  const handleAskDelta = () => {
    const name = s.name || s.space_name || s.id || 'this space';
    // Focus chat input and prefill
    if (window.__deltaInputRef?.current) {
      window.__deltaSetInput?.(`Tell me about ${name}`);
      window.__deltaInputRef.current.focus();
    }
  };

  const handleToggleExpand = () => {
    setExpanded(!expanded);
  };

  // Helper to safely get nested values
  const get = (key, fallback = '--') => {
    if (s[key] !== undefined && s[key] !== null && s[key] !== '') return String(s[key]);
    return fallback;
  };

  const getBool = (key) => {
    const v = s[key];
    if (v === true || v === 'true' || v === 'Yes' || v === 'yes') return 'Yes';
    if (v === false || v === 'false' || v === 'No' || v === 'no') return 'No';
    return '--';
  };

  const spaceName = s.space_name || s.id || 'Unknown Space';
  const spaceId = s.id || '--';
  const floorName = s.floor_name || s.floor_id || '--';
  const department = s.functional_zone || '--';
  const area = s.area_m2 != null ? Number(s.area_m2).toFixed(1) : '--';
  const capacityNormal = s.normal_occupancy || '--';
  const capacityMax = s.max_occupancy || '--';
  const status = s.data_status || 'Active';
  const bookable = getBool('bookable');
  const primaryFunction = s.primary_function || '--';

  return (
    <div className={`metadata-card ${expanded ? 'metadata-card--expanded' : ''}`}>
      {/* Close button */}
      <button className="metadata-card__close" onClick={handleClose} title="Close">
        &times;
      </button>

      {/* Compact view */}
      <div className="metadata-card__compact">
        <h3 className="metadata-card__name">{spaceName}</h3>
        <p className="metadata-card__sub">{spaceId} | {floorName}</p>

        {department !== '--' && (
          <p className="metadata-card__dept">{department}</p>
        )}

        <div className="metadata-card__row">
          <span className="metadata-card__label">Function</span>
          <span className="metadata-card__value">{primaryFunction}</span>
        </div>

        <div className="metadata-card__row">
          <span className="metadata-card__label">Area</span>
          <span className="metadata-card__value">{area !== '--' ? `${area} m\u00B2` : '--'}</span>
        </div>

        <div className="metadata-card__row">
          <span className="metadata-card__label">Capacity</span>
          <span className="metadata-card__value">{capacityNormal} / {capacityMax}</span>
        </div>

        <div className="metadata-card__tags">
          <span className={`metadata-card__tag ${status === 'Active' ? 'metadata-card__tag--green' : 'metadata-card__tag--grey'}`}>
            {status}
          </span>
          {bookable !== '--' && (
            <span className={`metadata-card__tag ${bookable === 'Yes' ? 'metadata-card__tag--blue' : 'metadata-card__tag--grey'}`}>
              {bookable === 'Yes' ? 'Bookable' : 'Not Bookable'}
            </span>
          )}
        </div>

        <div className="metadata-card__actions">
          <button className="metadata-card__btn metadata-card__btn--primary" onClick={handleToggleExpand}>
            {expanded ? 'Compact View' : 'View Full Profile'}
          </button>
          <button className="metadata-card__btn metadata-card__btn--secondary" onClick={handleAskDelta}>
            Ask Delta
          </button>
        </div>
      </div>

      {/* Expanded full profile */}
      {expanded && (
        <div className="metadata-card__full">
          {/* 1. Identification */}
          <div className="metadata-card__section">
            <h4 className="metadata-card__section-title">Identification</h4>
            <div className="metadata-card__grid">
              <MetaRow label="Space ID" value={get('id')} />
              <MetaRow label="IFC GUID" value={get('ifc_guid')} mono />
              <MetaRow label="Room Number" value={get('room_number')} />
              <MetaRow label="Floor" value={floorName} />
              <MetaRow label="Section" value={get('section')} />
              <MetaRow label="Service Code" value={get('service_code')} />
            </div>
          </div>

          {/* 2. Physical */}
          <div className="metadata-card__section">
            <h4 className="metadata-card__section-title">Physical</h4>
            <div className="metadata-card__grid">
              <MetaRow label="Area" value={area !== '--' ? `${area} m\u00B2` : '--'} />
              <MetaRow label="Perimeter" value={s.perimeter_cm ? `${Number(s.perimeter_cm).toFixed(0)} cm` : '--'} />
              <MetaRow label="Height" value={s.height_cm ? `${Number(s.height_cm).toFixed(0)} cm` : (s.calculation_height_cm ? `${Number(s.calculation_height_cm).toFixed(0)} cm` : '--')} />
            </div>
          </div>

          {/* 3. Functional */}
          <div className="metadata-card__section">
            <h4 className="metadata-card__section-title">Functional</h4>
            <div className="metadata-card__grid">
              <MetaRow label="Primary Function" value={primaryFunction} />
              <MetaRow label="Secondary Functions" value={get('secondary_functions')} />
              <MetaRow label="Convertible To" value={get('convertible_functions')} />
              <MetaRow label="Restrictions" value={get('function_restrictions')} />
              <MetaRow label="Flexibility" value={get('flexibility')} />
              <MetaRow label="Noise Sensitivity" value={get('noise_sensitivity')} />
            </div>
          </div>

          {/* 4. Operational */}
          <div className="metadata-card__section">
            <h4 className="metadata-card__section-title">Operational</h4>
            <div className="metadata-card__grid">
              <MetaRow label="Normal Occupancy" value={get('normal_occupancy')} />
              <MetaRow label="Max Occupancy" value={get('max_occupancy')} />
              <MetaRow label="Patient Capacity" value={get('patient_capacity')} />
              <MetaRow label="Accessible" value={get('accessible')} />
              <MetaRow label="Bookable" value={get('bookable')} />
              <MetaRow label="Access Level" value={get('access_level')} />
              <MetaRow label="Visitor Access" value={get('visitor_access')} />
              <MetaRow label="Privacy Level" value={get('privacy_level')} />
            </div>
          </div>

          {/* 5. Routing */}
          <div className="metadata-card__section">
            <h4 className="metadata-card__section-title">Routing</h4>
            <div className="metadata-card__grid">
              <MetaRow label="Nearest Lift" value={get('nearest_lift')} />
              <MetaRow label="Lift Distance" value={s.lift_distance_m != null ? `${Number(s.lift_distance_m).toFixed(1)} m` : '--'} />
              <MetaRow label="Nearest Stair" value={get('nearest_stair')} />
              <MetaRow label="Stair Distance" value={s.stair_distance_m != null ? `${Number(s.stair_distance_m).toFixed(1)} m` : '--'} />
              <MetaRow label="Step-free Access" value={get('step_free_access')} />
              <MetaRow label="Adjacent Spaces" value={get('adjacent_spaces')} />
            </div>
          </div>

          {/* 6. Facilities */}
          <div className="metadata-card__section">
            <h4 className="metadata-card__section-title">Facilities</h4>
            <div className="metadata-card__grid">
              <MetaRow label="Facilities" value={get('facilities_available')} full />
            </div>
          </div>

          {/* 7. Visitors (conditional) */}
          {(s.normal_visitors || s.max_visitors || s.visitor_access_type || s.visiting_hours_restricted || s.visitor_notes) && (
            <div className="metadata-card__section">
              <h4 className="metadata-card__section-title">Visitors</h4>
              <div className="metadata-card__grid">
                <MetaRow label="Normal Visitors" value={get('normal_visitors')} />
                <MetaRow label="Max Visitors" value={get('max_visitors')} />
                <MetaRow label="Access Type" value={get('visitor_access_type')} />
                <MetaRow label="Hours Restricted" value={get('visiting_hours_restricted')} />
                <MetaRow label="Notes" value={get('visitor_notes')} full />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * A single metadata row (label: value).
 */
function MetaRow({ label, value, mono = false, full = false }) {
  return (
    <div className={`metadata-card__meta-row ${full ? 'metadata-card__meta-row--full' : ''}`}>
      <span className="metadata-card__meta-label">{label}</span>
      <span className={`metadata-card__meta-value ${mono ? 'metadata-card__meta-value--mono' : ''}`}>
        {value}
      </span>
    </div>
  );
}
