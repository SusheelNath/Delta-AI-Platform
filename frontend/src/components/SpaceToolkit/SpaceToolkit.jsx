import React, { useState, useEffect } from 'react';
import useStore from '../../store/useStore';
import { translateFR } from '../../utils/translateFR';
import './SpaceToolkit.css';

const SPACE_TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'physical', label: 'Physical' },
  { key: 'access', label: 'Access' },
  { key: 'routing', label: 'Routing' },
  { key: 'facilities', label: 'Facilities' },
];

export default function SpaceToolkit() {
  const selectedSpace = useStore((s) => s.selectedSpace);
  const clearSelection = useStore((s) => s.clearSelection);
  const drawerOpen = useStore((s) => s.drawerOpen);
  const toggleDrawer = useStore((s) => s.toggleDrawer);
  const [activeTab, setActiveTab] = useState(null);

  const tabs = SPACE_TABS;

  // Reset tab when selection changes
  useEffect(() => {
    if (selectedSpace) {
      setActiveTab('overview');
    }
  }, [selectedSpace]);

  if (!selectedSpace) return null;

  const s = selectedSpace;

  const get = (key, fallback = '--') => {
    if (s[key] !== undefined && s[key] !== null && s[key] !== '') return translateFR(String(s[key]));
    return fallback;
  };

  const getBool = (key) => {
    const v = s[key];
    if (v === true || v === 'true' || v === 'Yes' || v === 'yes') return 'Yes';
    if (v === false || v === 'false' || v === 'No' || v === 'no') return 'No';
    return '--';
  };

  const handleClose = () => clearSelection();

  const handleAskDelta = () => {
    const name = s.space_name || s.ifc_name || s.ifc_guid || 'this element';
    if (window.__deltaInputRef?.current) {
      window.__deltaSetInput?.(`Tell me about ${name}`);
      window.__deltaInputRef.current.focus();
    }
  };

  // Display values (all passed through FR→EN translation)
  const rawName = s.space_name || s.ifc_name || s.ifc_guid || 'Unknown';
  const displayName = translateFR(rawName);
  const displayType = s.ifc_type || 'IfcSpace';
  const displayId = s.id || s.ifc_guid || '--';
  const floorName = translateFR(s.floor_name || s.floor_id || '--');
  const zone = translateFR(s.functional_zone || '--');
  const primaryFunction = translateFR(s.primary_function || '--');
  const area = s.area_m2 != null ? Number(s.area_m2).toFixed(1) : '--';
  const status = s.data_status || null;

  // Format IFC type for display (strip "Ifc" prefix)
  const typeLabel = displayType.startsWith('Ifc') ? displayType.slice(3) : displayType;

  return (
    <div className={`space-toolkit ${drawerOpen ? 'space-toolkit--open' : 'space-toolkit--closed'}`}>
      {/* Notch tab */}
      <button className="space-toolkit__notch" onClick={toggleDrawer} title={drawerOpen ? 'Collapse panel' : 'Expand panel'}>
        <span className="space-toolkit__notch-chevron">{drawerOpen ? '\u203A' : '\u2039'}</span>
      </button>

      {/* Header */}
      <div className="space-toolkit__header">
        <div className="space-toolkit__header-top">
          <span className="space-toolkit__badge">SPACE TOOLKIT</span>
          <button className="space-toolkit__close" onClick={handleClose} title="Close">&times;</button>
        </div>
        <h2 className="space-toolkit__name">{displayName}</h2>
        <p className="space-toolkit__meta">{displayId}</p>
        {zone !== '--' && <p className="space-toolkit__zone">{zone}</p>}

        {/* Badges */}
        <div className="space-toolkit__badges">
          <span className="space-toolkit__type-badge">{typeLabel}</span>
          {status && (
            <span className={`space-toolkit__status ${status === 'Active' ? 'space-toolkit__status--active' : ''}`}>
              {status}
            </span>
          )}
          {primaryFunction !== '--' && (
            <span className="space-toolkit__fn-badge">{primaryFunction}</span>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="space-toolkit__tabs">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            className={`space-toolkit__tab ${activeTab === tab.key ? 'space-toolkit__tab--active' : ''}`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="space-toolkit__content">

        {activeTab === 'overview' && (
          <div className="space-toolkit__section">
            <Row label="Primary Function" value={primaryFunction} />
            <Row label="Secondary Functions" value={get('secondary_functions')} />
            <Row label="Space Class" value={get('space_class')} />
            <Row label="Floor" value={floorName} />
            <Row label="Area" value={area !== '--' ? `${area} m\u00B2` : '--'} />
            <Row label="Normal Occupancy" value={get('normal_occupancy')} />
            <Row label="Max Occupancy" value={get('max_occupancy')} />
            <Row label="Patient Capacity" value={get('patient_capacity')} />
            <Row label="Flexibility" value={get('flexibility')} />
            <Row label="Convertible To" value={get('convertible_functions')} />
            <Row label="Restrictions" value={get('function_restrictions')} />
            <Row label="Noise Sensitivity" value={get('noise_sensitivity')} />
          </div>
        )}

        {activeTab === 'physical' && (
          <div className="space-toolkit__section">
            <Row label="Area" value={area !== '--' ? `${area} m\u00B2` : '--'} />
            <Row label="Perimeter" value={s.perimeter_cm ? `${Number(s.perimeter_cm).toFixed(0)} cm` : '--'} />
            <Row label="Height" value={s.height_cm ? `${Number(s.height_cm).toFixed(0)} cm` : (s.calculation_height_cm ? `${Number(s.calculation_height_cm).toFixed(0)} cm` : '--')} />
            <Row label="Floor Finish" value={get('floor_finish')} />
            <Row label="Ceiling Finish" value={get('ceiling_finish')} />
            <Row label="Section" value={get('section')} />
            <Row label="Room Number" value={get('room_number')} />
            <Row label="Service Code" value={get('service_code')} />
            <Row label="IFC GUID" value={get('ifc_guid')} mono />
          </div>
        )}

        {activeTab === 'access' && (
          <div className="space-toolkit__section">
            <Row label="Accessible" value={get('accessible')} />
            <Row label="Bookable" value={getBool('bookable')} />
            <Row label="Occupiable" value={get('occupiable')} />
            <Row label="Access Level" value={get('access_level')} />
            <Row label="Privacy Level" value={get('privacy_level')} />
            <Row label="Visitor Access" value={get('visitor_access')} />
            <Row label="Normal Visitors" value={get('normal_visitors')} />
            <Row label="Max Visitors" value={get('max_visitors')} />
            <Row label="Hours Restricted" value={get('visiting_hours_restricted')} />
            <Row label="Visitor Notes" value={get('visitor_notes')} />
          </div>
        )}

        {activeTab === 'routing' && (
          <div className="space-toolkit__section">
            <Row label="Nearest Lift" value={get('nearest_lift')} />
            <Row label="Lift Distance" value={s.lift_distance_m != null ? `${Number(s.lift_distance_m).toFixed(1)} m` : '--'} />
            <Row label="Nearest Stair" value={get('nearest_stair')} />
            <Row label="Stair Distance" value={s.stair_distance_m != null ? `${Number(s.stair_distance_m).toFixed(1)} m` : '--'} />
            <Row label="Step-free Access" value={get('step_free_access')} />
            <Row label="Adjacent Spaces" value={get('adjacent_spaces')} />
          </div>
        )}

        {activeTab === 'facilities' && (
          <div className="space-toolkit__section">
            <FacilitiesList value={get('facilities_available')} />
          </div>
        )}
      </div>

      {/* Footer action */}
      <div className="space-toolkit__footer">
        <button className="space-toolkit__ask-btn" onClick={handleAskDelta}>
          Ask Delta About This Space
        </button>
      </div>
    </div>
  );
}

function Row({ label, value, mono = false }) {
  if (value === '--') return null;
  return (
    <div className="space-toolkit__row">
      <span className="space-toolkit__row-label">{label}</span>
      <span className={`space-toolkit__row-value ${mono ? 'space-toolkit__row-value--mono' : ''}`}>{value}</span>
    </div>
  );
}

function FacilitiesList({ value }) {
  if (!value || value === '--') {
    return <p className="space-toolkit__empty">No facilities data available.</p>;
  }
  const items = value.split(',').map((s) => s.trim()).filter(Boolean);
  return (
    <div className="space-toolkit__facilities">
      {items.map((item, i) => (
        <span key={i} className="space-toolkit__facility-tag">{item}</span>
      ))}
    </div>
  );
}
