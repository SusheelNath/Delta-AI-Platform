import React, { useEffect, useRef, useCallback } from 'react';
import useStore from '../../store/useStore';
import { fetchFloors, fetchFloorPolygons, deletePolygon } from '../../api/client';
import FunctionFilter from './FunctionFilter';
import RoomDirectory from './RoomDirectory';
import FloorPlanImage from './FloorPlanImage';
import './FloorPlanPanel.css';

const FLOOR_LABELS = {
  H003: 'B3', H002: 'B2', H001: 'B1', H000: 'GF',
  H010: '+1', H020: '+2', H030: '+3', H040: '+4', H050: '+5',
};

const HEATMAP_MODES = [
  { key: 'function', label: 'Function' },
  { key: 'status', label: 'Status' },
  { key: 'area', label: 'Area' },
  { key: 'area_per_bed', label: 'Area/Bed' },
  { key: 'utilization', label: 'Utilization' },
];

export default function FloorPlanPanel() {
  const floors = useStore((s) => s.floors);
  const activeFloorId = useStore((s) => s.activeFloorId);
  const setFloors = useStore((s) => s.setFloors);
  const setActiveFloor = useStore((s) => s.setActiveFloor);
  const showAllFloors = useStore((s) => s.showAllFloors);
  const clearSelection = useStore((s) => s.clearSelection);
  const panelMode = useStore((s) => s.panelMode);
  const setPanelMode = useStore((s) => s.setPanelMode);
  const panelExpanded = useStore((s) => s.panelExpanded);
  const togglePanelExpanded = useStore((s) => s.togglePanelExpanded);
  const searchQuery = useStore((s) => s.searchQuery);
  const setSearchQuery = useStore((s) => s.setSearchQuery);
  const heatmapMode = useStore((s) => s.heatmapMode);
  const setHeatmapMode = useStore((s) => s.setHeatmapMode);
  const compareMode = useStore((s) => s.compareMode);
  const toggleCompareMode = useStore((s) => s.toggleCompareMode);
  const compareFloorId = useStore((s) => s.compareFloorId);
  const setCompareFloorId = useStore((s) => s.setCompareFloorId);
  const mepVisible = useStore((s) => s.mepVisible);
  const toggleMepVisible = useStore((s) => s.toggleMepVisible);
  const mappingMode = useStore((s) => s.mappingMode);
  const toggleMappingMode = useStore((s) => s.toggleMappingMode);
  const setFloorPolygons = useStore((s) => s.setFloorPolygons);
  const removePolygonFromFloor = useStore((s) => s.removePolygonFromFloor);

  const searchTimerRef = useRef(null);
  const panelRef = useRef(null);

  // Block wheel events from bubbling up to the 3D viewer behind the panel
  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const stopWheel = (e) => e.stopPropagation();
    el.addEventListener('wheel', stopWheel);
    return () => el.removeEventListener('wheel', stopWheel);
  }, []);

  // Delete key — remove selected polygon with confirmation (works from any view)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key !== 'Delete') return;
      const selId = useStore.getState().selectedSpaceId;
      const floorId = useStore.getState().activeFloorId;
      if (!selId || !floorId) return;
      const polygons = useStore.getState().floorPolygons[floorId] || [];
      const poly = polygons.find((p) => p.ifc_guid === selId);
      if (!poly) return;

      const name = poly.space_name || poly.ifc_guid;
      if (!window.confirm(`Delete polygon for "${name}"?`)) return;

      removePolygonFromFloor(floorId, selId);
      clearSelection();
      deletePolygon(selId).catch((err) => {
        console.error('[Delta] Failed to delete polygon from server:', err);
      });
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [removePolygonFromFloor, clearSelection]);

  // Fetch floors on mount
  useEffect(() => {
    if (floors.length > 0) return;
    fetchFloors()
      .then((data) => {
        const sorted = [...data].sort((a, b) => a.level - b.level);
        setFloors(sorted);
      })
      .catch((err) => console.error('[Delta] Failed to fetch floors:', err));
  }, []);

  // Load saved polygons when active floor changes
  useEffect(() => {
    if (!activeFloorId) return;
    fetchFloorPolygons(activeFloorId)
      .then((polygons) => setFloorPolygons(activeFloorId, polygons))
      .catch((err) => console.warn('[Delta] Failed to load polygons:', err));
  }, [activeFloorId, setFloorPolygons]);

  const handleFloorClick = (floorId) => {
    if (activeFloorId === floorId) return; // already selected
    setActiveFloor(floorId);
    clearSelection();
  };

  // Debounced search
  const handleSearchChange = useCallback((e) => {
    const value = e.target.value;
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      setSearchQuery(value);
    }, 300);
  }, [setSearchQuery]);

  const handleSearchClear = useCallback(() => {
    setSearchQuery('');
    const input = document.querySelector('.floorplan-panel__search-input');
    if (input) input.value = '';
  }, [setSearchQuery]);

  return (
    <div ref={panelRef} className="floorplan-panel">
      {/* Header */}
      <div className="floorplan-panel__header">
        <span className="floorplan-panel__title">Floor Plan</span>
        <div className="floorplan-panel__header-actions">
          {panelMode === 'plan' && (
            <button
              className={`floorplan-panel__compare-btn ${compareMode ? 'floorplan-panel__compare-btn--active' : ''}`}
              onClick={toggleCompareMode}
              title={compareMode ? 'Exit compare' : 'Compare floors'}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <rect x="1" y="2" width="5" height="10" rx="1" stroke="currentColor" strokeWidth="1.2"/>
                <rect x="8" y="2" width="5" height="10" rx="1" stroke="currentColor" strokeWidth="1.2"/>
              </svg>
            </button>
          )}
          <button
            className={`floorplan-panel__expand-btn ${panelExpanded ? 'floorplan-panel__expand-btn--active' : ''}`}
            onClick={togglePanelExpanded}
            title={panelExpanded ? 'Collapse panel' : 'Expand panel'}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              {panelExpanded ? (
                <>
                  <path d="M9 1v4h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M5 13V9H1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M13 1L9 5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                  <path d="M1 13L5 9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                </>
              ) : (
                <>
                  <path d="M10 1h3v3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M4 13H1v-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M13 1L9 5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                  <path d="M1 13l4-4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                </>
              )}
            </svg>
          </button>
        </div>
      </div>

      {/* Search bar */}
      <div className="floorplan-panel__search">
        <svg className="floorplan-panel__search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="8"/>
          <path d="M21 21l-4.35-4.35" strokeLinecap="round"/>
        </svg>
        <input
          type="text"
          className="floorplan-panel__search-input"
          placeholder="Search rooms, functions..."
          defaultValue={searchQuery}
          onChange={handleSearchChange}
        />
        {searchQuery && (
          <button className="floorplan-panel__search-clear" onClick={handleSearchClear}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
            </svg>
          </button>
        )}
      </div>

      {/* Floor tabs */}
      <div className="floorplan-panel__floor-tabs">
        {floors.map((floor) => {
          const isActive = activeFloorId === floor.id;
          return (
            <button
              key={floor.id}
              className={`floorplan-panel__floor-tab ${isActive ? 'floorplan-panel__floor-tab--active' : ''}`}
              onClick={() => handleFloorClick(floor.id)}
              title={floor.name}
            >
              {FLOOR_LABELS[floor.id] || floor.id}
            </button>
          );
        })}
      </div>

      {/* View toggle + Heatmap selector + Function filters */}
      <div className="floorplan-panel__controls">
        <div className="floorplan-panel__controls-row">
          <div className="floorplan-panel__view-toggle">
            <button
              className={`floorplan-panel__toggle-btn ${panelMode === 'list' ? 'floorplan-panel__toggle-btn--active' : ''}`}
              onClick={() => setPanelMode('list')}
            >
              List
            </button>
            <button
              className={`floorplan-panel__toggle-btn ${panelMode === 'plan' ? 'floorplan-panel__toggle-btn--active' : ''}`}
              onClick={() => setPanelMode('plan')}
            >
              Plan
            </button>
          </div>

          {panelMode === 'plan' && (
            <>
              <div className="floorplan-panel__heatmap-select">
                <select
                  value={heatmapMode}
                  onChange={(e) => setHeatmapMode(e.target.value)}
                  className="floorplan-panel__heatmap-dropdown"
                >
                  {HEATMAP_MODES.map((m) => (
                    <option key={m.key} value={m.key}>{m.label}</option>
                  ))}
                </select>
              </div>
              <button
                className={`floorplan-panel__mep-btn ${mepVisible ? 'floorplan-panel__mep-btn--active' : ''}`}
                onClick={toggleMepVisible}
                title={mepVisible ? 'Hide MEP / infrastructure' : 'Show MEP / infrastructure'}
              >
                MEP
              </button>
            </>
          )}
          <button
            className={`floorplan-panel__map-btn ${mappingMode ? 'floorplan-panel__map-btn--active' : ''}`}
            onClick={() => { if (panelMode !== 'plan') setPanelMode('plan'); toggleMappingMode(); }}
            title={mappingMode ? 'Exit room mapping mode' : 'Draw room polygons'}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2 2L10 2L10 10L2 10Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" fill="none"/>
              <circle cx="2" cy="2" r="1" fill="currentColor"/>
              <circle cx="10" cy="2" r="1" fill="currentColor"/>
              <circle cx="10" cy="10" r="1" fill="currentColor"/>
              <circle cx="2" cy="10" r="1" fill="currentColor"/>
            </svg>
            Map
          </button>
        </div>
        {panelMode === 'list' && <FunctionFilter />}
      </div>

      {/* Content */}
      <div className="floorplan-panel__content">
        {panelMode === 'list' ? (
          <RoomDirectory />
        ) : compareMode ? (
          <div className="floorplan-panel__compare">
            <div className="floorplan-panel__compare-pane">
              <FloorPlanImage />
            </div>
            <div className="floorplan-panel__compare-divider" />
            <div className="floorplan-panel__compare-pane">
              <div className="floorplan-panel__compare-selector">
                <select
                  value={compareFloorId || ''}
                  onChange={(e) => setCompareFloorId(e.target.value || null)}
                  className="floorplan-panel__compare-dropdown"
                >
                  <option value="">Select floor...</option>
                  {floors.map((f) => (
                    <option key={f.id} value={f.id}>{FLOOR_LABELS[f.id] || f.id} — {f.name}</option>
                  ))}
                </select>
              </div>
              {compareFloorId ? (
                <FloorPlanImage floorIdOverride={compareFloorId} />
              ) : (
                <div className="fpc__empty"><p>Select a floor to compare</p></div>
              )}
            </div>
          </div>
        ) : (
          <FloorPlanImage />
        )}
      </div>
    </div>
  );
}
