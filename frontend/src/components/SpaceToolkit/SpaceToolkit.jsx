import React, { useState, useEffect, useMemo } from 'react';
import useStore from '../../store/useStore';
import { translateFR } from '../../utils/translateFR';
import { computeRouting } from '../../utils/routing';
import { fetchSpaceFurnishings } from '../../api/client';
import './SpaceToolkit.css';

export default function SpaceToolkit() {
  const selectedSpace = useStore((s) => s.selectedSpace);
  const selectedSpaceId = useStore((s) => s.selectedSpaceId);
  const clearSelection = useStore((s) => s.clearSelection);
  const drawerOpen = useStore((s) => s.drawerOpen);
  const toggleDrawer = useStore((s) => s.toggleDrawer);
  const activeFloorId = useStore((s) => s.activeFloorId);
  const floorPolygons = useStore((s) => s.floorPolygons);
  const setActiveRoute = useStore((s) => s.setActiveRoute);
  const clearActiveRoute = useStore((s) => s.clearActiveRoute);
  const activeRoute = useStore((s) => s.activeRoute);
  const [routingOpen, setRoutingOpen] = useState(false);
  const [descOpen, setDescOpen] = useState(false);
  const [metricsOpen, setMetricsOpen] = useState(false);
  const [furnishingsOpen, setFurnishingsOpen] = useState(false);
  const [furnishings, setFurnishings] = useState([]);

  // Collapse dropdowns when selection changes
  useEffect(() => {
    setRoutingOpen(false);
    setDescOpen(false);
    setMetricsOpen(false);
    setFurnishingsOpen(false);
    setFurnishings([]);
  }, [selectedSpace]);

  // Eagerly fetch furnishings on selection (for count badge)
  useEffect(() => {
    if (!selectedSpaceId) return;
    fetchSpaceFurnishings(selectedSpaceId)
      .then(setFurnishings)
      .catch(() => setFurnishings([]));
  }, [selectedSpaceId]);

  // Compute routing when dropdown opens
  const routing = useMemo(() => {
    if (!routingOpen || !selectedSpaceId || !activeFloorId) return null;
    const polygons = floorPolygons[activeFloorId] || [];
    if (polygons.length === 0) return null;
    return computeRouting(polygons, selectedSpaceId);
  }, [routingOpen, selectedSpaceId, activeFloorId, floorPolygons]);

  // Clear route when dropdown closes
  useEffect(() => {
    if (!routingOpen) clearActiveRoute();
  }, [routingOpen, clearActiveRoute]);

  if (!selectedSpace) return null;

  const s = selectedSpace;

  const get = (key, fallback = '--') => {
    if (s[key] !== undefined && s[key] !== null && s[key] !== '') return translateFR(String(s[key]));
    return fallback;
  };

  const handleClose = () => clearSelection();

  const handleAskDelta = () => {
    const name = s.space_name || s.ifc_name || s.ifc_guid || 'this element';
    if (window.__deltaInputRef?.current) {
      window.__deltaSetInput?.(`Tell me about ${name}`);
      window.__deltaInputRef.current.focus();
    }
  };

  const handleRouteClick = (type) => {
    if (!routing) return;
    const data = type === 'elevator' ? routing.toElevator : routing.toStaircase;
    if (!data) return;

    if (activeRoute?.type === type) {
      clearActiveRoute();
    } else {
      setActiveRoute({
        type,
        path: data.path,
        targetGuid: data.target.ifc_guid,
        centroids: data.centroids,
        distanceM: data.distanceM,
      });
    }
  };

  // Display values
  const rawName = s.space_name || s.ifc_name || s.ifc_guid || 'Unknown';
  const displayName = translateFR(rawName);
  const displayId = s.id || s.ifc_guid || '--';
  const primaryFunction = translateFR(s.primary_function || '--');
  const area = s.area_m2 != null ? Number(s.area_m2).toFixed(1) : '--';

  return (
    <div className={`space-toolkit ${drawerOpen ? 'space-toolkit--open' : 'space-toolkit--closed'}`}>
      {/* Notch tab */}
      <button className="space-toolkit__notch" onClick={toggleDrawer} title={drawerOpen ? 'Collapse panel' : 'Expand panel'}>
        <span className="space-toolkit__notch-chevron">{drawerOpen ? '\u203A' : '\u2039'}</span>
      </button>

      {/* Header */}
      <div className="space-toolkit__header">
        <div className="space-toolkit__header-top">
          <span className="space-toolkit__badge">SPACE METADATA</span>
          <button className="space-toolkit__close" onClick={handleClose} title="Close">&times;</button>
        </div>
        <h2 className="space-toolkit__name">{displayName}</h2>

        {/* Badges */}
        <div className="space-toolkit__badges">
          {primaryFunction !== '--' && (
            <span className="space-toolkit__fn-badge">{primaryFunction}</span>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="space-toolkit__content">
        {/* Description dropdown */}
        <button
          className={`space-toolkit__dropdown-toggle ${descOpen ? 'space-toolkit__dropdown-toggle--active' : ''}`}
          onClick={() => setDescOpen((v) => !v)}
        >
          <span className={`space-toolkit__dropdown-arrow ${descOpen ? 'space-toolkit__dropdown-arrow--open' : ''}`}>&#9656;</span>
          Description
        </button>
        {descOpen && (
          <div className="space-toolkit__section space-toolkit__section--nested">
            <Row label="Primary Function" value={primaryFunction} />
            <Row label="Room Number" value={get('room_number')} />
            <Row label="IFC GUID" value={get('ifc_guid')} mono />
          </div>
        )}

        {/* Metrics dropdown */}
        <button
          className={`space-toolkit__dropdown-toggle ${metricsOpen ? 'space-toolkit__dropdown-toggle--active' : ''}`}
          onClick={() => setMetricsOpen((v) => !v)}
        >
          <span className={`space-toolkit__dropdown-arrow ${metricsOpen ? 'space-toolkit__dropdown-arrow--open' : ''}`}>&#9656;</span>
          Metrics
        </button>
        {metricsOpen && (
          <div className="space-toolkit__section space-toolkit__section--nested">
            <Row label="Area" value={area !== '--' ? `${area} m\u00B2` : '--'} />
            <Row label="Perimeter" value={s.perimeter_cm ? `${(Number(s.perimeter_cm) / 100).toFixed(1)} m` : '--'} />
            {s.used_area_m2 != null && s.area_m2 != null && (
              <Row label="Used Area" value={`${Number(s.used_area_m2).toFixed(1)} m\u00B2 (${(Number(s.used_area_m2) / Number(s.area_m2) * 100).toFixed(0)}%)`} />
            )}
            {s.free_area_m2 != null && (
              <Row label="Free Area" value={`${Number(s.free_area_m2).toFixed(1)} m\u00B2`} />
            )}
            <Row label="Normal Occupancy" value={s.normal_occupancy != null ? String(s.normal_occupancy) : '--'} />
            <Row label="Max Occupancy" value={s.max_occupancy != null ? String(s.max_occupancy) : '--'} />
            {s.absolute_occupancy > 0 && (
              <Row label="Absolute Occupancy" value={String(s.absolute_occupancy)} />
            )}
          </div>
        )}

        {/* Furnishings dropdown */}
        <button
          className={`space-toolkit__dropdown-toggle ${furnishingsOpen ? 'space-toolkit__dropdown-toggle--active' : ''}`}
          onClick={() => setFurnishingsOpen((v) => !v)}
        >
          <span className={`space-toolkit__dropdown-arrow ${furnishingsOpen ? 'space-toolkit__dropdown-arrow--open' : ''}`}>&#9656;</span>
          Furnishings
          {furnishings.length > 0 && (
            <span className="space-toolkit__furnishing-count">{furnishings.length}</span>
          )}
        </button>
        {furnishingsOpen && (
          <div className="space-toolkit__section space-toolkit__section--nested">
            {furnishings.length === 0 ? (
              <div className="space-toolkit__empty-msg">No furnishings assigned</div>
            ) : (
              furnishings.map((f) => (
                <div key={f.id} className="space-toolkit__furnishing-item">
                  <span className="space-toolkit__furnishing-qty">{f.quantity}×</span>
                  <span className="space-toolkit__furnishing-label">{f.label || f.item_type}</span>
                  <span className="space-toolkit__furnishing-meta">
                    {f.footprint_m2 > 0 ? `${(f.footprint_m2 * f.quantity).toFixed(1)} m\u00B2` : ''}
                    {f.normal_occ > 0 ? ` · ${f.normal_occ * f.quantity} occ` : ''}
                  </span>
                </div>
              ))
            )}
          </div>
        )}

        {/* Routing dropdown */}
        <button
          className={`space-toolkit__dropdown-toggle ${routingOpen ? 'space-toolkit__dropdown-toggle--active' : ''}`}
          onClick={() => setRoutingOpen((v) => !v)}
        >
          <span className={`space-toolkit__dropdown-arrow ${routingOpen ? 'space-toolkit__dropdown-arrow--open' : ''}`}>&#9656;</span>
          Routing
        </button>
        {routingOpen && (
          <div className="space-toolkit__route-cards">
            {routing?.toElevator ? (
              <button
                className={`space-toolkit__route-card ${activeRoute?.type === 'elevator' ? 'space-toolkit__route-card--active' : ''}`}
                onClick={() => handleRouteClick('elevator')}
              >
                <span className="space-toolkit__route-icon">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <line x1="12" y1="3" x2="12" y2="21" />
                    <polyline points="8 8 6 10 8 12" />
                    <polyline points="16 12 18 14 16 16" />
                  </svg>
                </span>
                <span className="space-toolkit__route-info">
                  <span className="space-toolkit__route-name">{routing.toElevator.target.space_name || 'Elevator'}</span>
                  <span className="space-toolkit__route-type">Nearest Elevator</span>
                </span>
                <span className="space-toolkit__route-dist">{routing.toElevator.distanceM.toFixed(1)} m</span>
              </button>
            ) : (
              <div className="space-toolkit__route-card space-toolkit__route-card--empty">
                <span className="space-toolkit__route-icon">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <line x1="12" y1="3" x2="12" y2="21" />
                  </svg>
                </span>
                <span className="space-toolkit__route-info">
                  <span className="space-toolkit__route-name">No elevator found</span>
                  <span className="space-toolkit__route-type">Nearest Elevator</span>
                </span>
              </div>
            )}
            {routing?.toStaircase ? (
              <button
                className={`space-toolkit__route-card ${activeRoute?.type === 'staircase' ? 'space-toolkit__route-card--active' : ''}`}
                onClick={() => handleRouteClick('staircase')}
              >
                <span className="space-toolkit__route-icon space-toolkit__route-icon--stairs">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 18h4v-4h4v-4h4V6h4" />
                  </svg>
                </span>
                <span className="space-toolkit__route-info">
                  <span className="space-toolkit__route-name">{routing.toStaircase.target.space_name || 'Staircase'}</span>
                  <span className="space-toolkit__route-type">Nearest Staircase</span>
                </span>
                <span className="space-toolkit__route-dist">{routing.toStaircase.distanceM.toFixed(1)} m</span>
              </button>
            ) : (
              <div className="space-toolkit__route-card space-toolkit__route-card--empty">
                <span className="space-toolkit__route-icon space-toolkit__route-icon--stairs">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 18h4v-4h4v-4h4V6h4" />
                  </svg>
                </span>
                <span className="space-toolkit__route-info">
                  <span className="space-toolkit__route-name">No staircase found</span>
                  <span className="space-toolkit__route-type">Nearest Staircase</span>
                </span>
              </div>
            )}
          </div>
        )}

        {/* Components Library — hidden (kept for future use) */}
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
