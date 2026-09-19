import React, { useState, useEffect, useRef, useMemo } from 'react';
import useStore from '../../store/useStore';
import { translateFR } from '../../utils/translateFR';
import { computeRouting } from '../../utils/routing';
import { fetchSpaceFurnishings } from '../../api/client';
import { buildBeforeAfterComparison, buildFacilitiesText, buildRepurposeResponse } from '../../utils/actionTemplates';
import FurnishingEditor from './FurnishingEditor';
import RepurposePanel from './RepurposePanel';
import ExpansionPanel from './ExpansionPanel';
import './SpaceToolkit.css';

export default function SpaceToolkit() {
  const selectedSpace = useStore((s) => s.selectedSpace);
  const selectedSpaceId = useStore((s) => s.selectedSpaceId);
  const clearSelection = useStore((s) => s.clearSelection);
  const drawerOpen = useStore((s) => s.drawerOpen);
  const toggleDrawer = useStore((s) => s.toggleDrawer);
  const activeFloorId = useStore((s) => s.activeFloorId);
  const activeFloorPolygons = useStore((s) => s.activeFloorId ? (s.floorPolygons[s.activeFloorId] || []) : []);
  const setActiveRoute = useStore((s) => s.setActiveRoute);
  const clearActiveRoute = useStore((s) => s.clearActiveRoute);
  const activeRoute = useStore((s) => s.activeRoute);
  const routingPanelOpen = useStore((s) => s.routingPanelOpen);
  const setRoutingPanelOpen = useStore((s) => s.setRoutingPanelOpen);
  const [routingOpen, setRoutingOpen] = useState(false);
  const contentRef = useRef(null);
  const tkScrollState = useRef({ target: 0, current: 0, raf: null });
  const [descOpen, setDescOpen] = useState(false);
  const [metricsOpen, setMetricsOpen] = useState(false);
  const [furnishingsOpen, setFurnishingsOpen] = useState(false);
  const [furnishings, setFurnishings] = useState([]);
  const [editorOpen, setEditorOpen] = useState(false);
  const [repurposeOpen, setRepurposeOpen] = useState(false);
  const [expansionOpen, setExpansionOpen] = useState(false);
  const expansionOptions = useStore((s) => s.expansionOptions);

  // Collapse dropdowns when selection changes
  useEffect(() => {
    setRoutingOpen(false);
    setDescOpen(false);
    setMetricsOpen(false);
    setFurnishingsOpen(false);
    setFurnishings([]);
    setEditorOpen(false);
    setRepurposeOpen(false);
    setExpansionOpen(false);
  }, [selectedSpace]);

  // Load furnishings from preloaded store, fallback to API fetch
  const preloadedFurnishings = useStore((s) => s.spaceFurnishings);
  useEffect(() => {
    if (!selectedSpaceId) return;
    const cached = preloadedFurnishings[selectedSpaceId];
    if (cached) {
      setFurnishings(cached);
      return;
    }
    // Fallback: fetch if not preloaded
    fetchSpaceFurnishings(selectedSpaceId)
      .then(setFurnishings)
      .catch(() => setFurnishings([]));
  }, [selectedSpaceId, preloadedFurnishings]);

  // Lerped smooth scroll
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const s = tkScrollState.current;
    s.current = el.scrollTop;
    s.target = el.scrollTop;

    const tick = () => {
      const diff = s.target - s.current;
      if (Math.abs(diff) < 0.3) {
        s.current = s.target;
        el.scrollTop = s.target;
        s.raf = null;
        return;
      }
      s.current += diff * 0.18;
      el.scrollTop = Math.round(s.current);
      s.raf = requestAnimationFrame(tick);
    };

    const onWheel = (e) => {
      e.preventDefault();
      const max = el.scrollHeight - el.clientHeight;
      s.target = Math.max(0, Math.min(max, s.target + e.deltaY * 0.8));
      if (!s.raf) s.raf = requestAnimationFrame(tick);
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
      if (s.raf) cancelAnimationFrame(s.raf);
    };
  }, []);

  // Compute routing when dropdown opens
  const routing = useMemo(() => {
    if (!selectedSpaceId || !activeFloorId) return null;
    if (activeFloorPolygons.length === 0) return null;
    return computeRouting(activeFloorPolygons, selectedSpaceId);
  }, [selectedSpaceId, activeFloorId, activeFloorPolygons]);

  // AI-driven: open routing section when store signals
  useEffect(() => {
    if (routingPanelOpen && !routingOpen) {
      setRoutingOpen(true);
      setRoutingPanelOpen(false);
    }
  }, [routingPanelOpen]);

  // AI-driven: open furnishing editor when actionResolver dispatches event
  useEffect(() => {
    const handler = () => {
      setFurnishingsOpen(true);
      setEditorOpen(true);
    };
    window.addEventListener('delta-open-furnishing-editor', handler);
    return () => window.removeEventListener('delta-open-furnishing-editor', handler);
  }, []);

  // AI-driven: open repurpose panel when chat chip or action dispatches event
  useEffect(() => {
    const handler = () => setRepurposeOpen(true);
    window.addEventListener('delta-open-repurpose-panel', handler);
    return () => window.removeEventListener('delta-open-repurpose-panel', handler);
  }, []);

  // AI-driven: open expansion panel when Scenario tab chip dispatches event
  useEffect(() => {
    const handler = () => setExpansionOpen(true);
    window.addEventListener('delta-open-expansion-panel', handler);
    return () => window.removeEventListener('delta-open-expansion-panel', handler);
  }, []);

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
        pathLine: data.pathLine,
        distanceM: data.distanceM,
        waypoints: data.waypoints,
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
      <div className="space-toolkit__content" ref={contentRef}>
        {/* Description dropdown */}
        <button
          className={`space-toolkit__dropdown-toggle ${descOpen ? 'space-toolkit__dropdown-toggle--active' : ''}`}
          onClick={() => setDescOpen((v) => !v)}
        >
          <span className={`space-toolkit__dropdown-arrow ${descOpen ? 'space-toolkit__dropdown-arrow--open' : ''}`}>&#9656;</span>
          Description
        </button>
        <div className={`space-toolkit__dropdown-body ${descOpen ? '' : 'space-toolkit__dropdown-body--collapsed'}`}>
          <div className="space-toolkit__section space-toolkit__section--nested">
            <Row label="Primary Function" value={primaryFunction} />
            <Row label="Room Number" value={get('room_number')} />
            <Row label="IFC GUID" value={get('ifc_guid')} mono />
          </div>
        </div>

        {/* Metrics dropdown */}
        <button
          className={`space-toolkit__dropdown-toggle ${metricsOpen ? 'space-toolkit__dropdown-toggle--active' : ''}`}
          onClick={() => setMetricsOpen((v) => !v)}
        >
          <span className={`space-toolkit__dropdown-arrow ${metricsOpen ? 'space-toolkit__dropdown-arrow--open' : ''}`}>&#9656;</span>
          Metrics
        </button>
        <div className={`space-toolkit__dropdown-body ${metricsOpen ? '' : 'space-toolkit__dropdown-body--collapsed'}`}>
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
        </div>

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
        <div className={`space-toolkit__dropdown-body ${furnishingsOpen ? '' : 'space-toolkit__dropdown-body--collapsed'}`}>
          {editorOpen ? (
            <FurnishingEditor
              ifcGuid={selectedSpaceId}
              floorId={activeFloorId}
              currentFurnishings={furnishings}
              area_m2={s.area_m2}
              onClose={() => setEditorOpen(false)}
              onSaved={(newFurnishings, metrics) => {
                setFurnishings(newFurnishings);
                setEditorOpen(false);
                // Update preloaded furnishing cache
                if (selectedSpaceId) {
                  useStore.getState().mergeSpaceFurnishings({ [selectedSpaceId]: newFurnishings });
                }
                // Push updated metrics + facilities text into selectedSpace
                const facilitiesText = buildFacilitiesText(newFurnishings);
                if (metrics) {
                  useStore.getState().updateSelectedSpaceMetrics(metrics, facilitiesText);
                }
                // Inject before/after comparison into chat if baseline exists
                const baseline = useStore.getState()._furnishingBaseline;
                if (baseline && metrics) {
                  const comparison = buildBeforeAfterComparison(baseline, metrics, newFurnishings);
                  if (comparison) {
                    const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                    useStore.getState().addMessage({
                      role: 'delta',
                      text: `Furnishings saved.\n\n${comparison}`,
                      time: now,
                    });
                  }
                }
              }}
            />
          ) : (
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
              <button
                className="space-toolkit__edit-furnishings-btn"
                onClick={() => setEditorOpen(true)}
              >
                Edit Furnishings
              </button>
            </div>
          )}
        </div>

        {/* Routing dropdown */}
        <button
          className={`space-toolkit__dropdown-toggle ${routingOpen ? 'space-toolkit__dropdown-toggle--active' : ''}`}
          onClick={() => setRoutingOpen((v) => !v)}
        >
          <span className={`space-toolkit__dropdown-arrow ${routingOpen ? 'space-toolkit__dropdown-arrow--open' : ''}`}>&#9656;</span>
          Routing
        </button>
        <div className={`space-toolkit__dropdown-body ${routingOpen ? '' : 'space-toolkit__dropdown-body--collapsed'}`}>
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
                <span className="space-toolkit__route-metrics">
                  <span className="space-toolkit__route-dist">{routing.toElevator.distanceM.toFixed(1)} m</span>
                  <span className="space-toolkit__route-time">{routing.toElevator.distanceM < 72 ? `~${Math.max(5, Math.round(routing.toElevator.distanceM / 1.2 / 5) * 5)} sec` : `~${Math.max(1, Math.round(routing.toElevator.distanceM / 72))} min`}</span>
                </span>
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
                <span className="space-toolkit__route-metrics">
                  <span className="space-toolkit__route-dist">{routing.toStaircase.distanceM.toFixed(1)} m</span>
                  <span className="space-toolkit__route-time">{routing.toStaircase.distanceM < 72 ? `~${Math.max(5, Math.round(routing.toStaircase.distanceM / 1.2 / 5) * 5)} sec` : `~${Math.max(1, Math.round(routing.toStaircase.distanceM / 72))} min`}</span>
                </span>
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
        </div>

        {/* Repurpose dropdown */}
        <button
          className={`space-toolkit__dropdown-toggle ${repurposeOpen ? 'space-toolkit__dropdown-toggle--active' : ''}`}
          onClick={() => setRepurposeOpen((v) => !v)}
        >
          <span className={`space-toolkit__dropdown-arrow ${repurposeOpen ? 'space-toolkit__dropdown-arrow--open' : ''}`}>&#9656;</span>
          Repurpose Analysis
        </button>
        <div className={`space-toolkit__dropdown-body space-toolkit__dropdown-body--large ${repurposeOpen ? '' : 'space-toolkit__dropdown-body--collapsed'}`}>
          <RepurposePanel
            ifcGuid={selectedSpaceId}
            spaceName={s.space_name}
            primaryFunction={s.primary_function}
            floorId={activeFloorId}
            area_m2={s.area_m2}
            onClose={() => setRepurposeOpen(false)}
            onInjectChat={(option, activeTab) => {
              const text = buildRepurposeResponse(option, s.space_name, activeFloorId, activeTab, s.primary_function, s.area_m2);
              const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
              useStore.getState().addMessage({ role: 'delta', text, time: now });
            }}
          />
        </div>

        {/* Expansion Analysis dropdown - only for commercial spaces */}
        {(() => {
          const expansionOpts = (expansionOptions || {})[selectedSpaceId] || [];
          const fn = (s.primary_function || '').toLowerCase();
          const nm = (s.space_name || '').toLowerCase();
          const isCommercial = ['commercial', 'restaurant', 'coffee', 'cafe', 'cafeteria',
            'gift', 'shop', 'pharmacy', 'kiosk', 'retail', 'florist', 'bar', 'canteen', 'bistro']
            .some(kw => fn.includes(kw) || nm.includes(kw));
          if (!isCommercial && expansionOpts.length === 0) return null;
          return (
            <>
              <button
                className={`space-toolkit__dropdown-toggle ${expansionOpen ? 'space-toolkit__dropdown-toggle--active' : ''}`}
                onClick={() => setExpansionOpen((v) => !v)}
              >
                <span className={`space-toolkit__dropdown-arrow ${expansionOpen ? 'space-toolkit__dropdown-arrow--open' : ''}`}>&#9656;</span>
                Expansion Analysis
              </button>
              <div className={`space-toolkit__dropdown-body space-toolkit__dropdown-body--large ${expansionOpen ? '' : 'space-toolkit__dropdown-body--collapsed'}`}>
                {expansionOpen && <ExpansionPanel />}
              </div>
            </>
          );
        })()}

        {/* Components Library - hidden (kept for future use) */}
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
