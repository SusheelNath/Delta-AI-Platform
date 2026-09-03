import React, { useEffect, useRef, useCallback } from 'react';
import useStore from '../../store/useStore';
import { fetchFloors, fetchFloorPolygons, syncPolygons, savePolygon } from '../../api/client';
import { computePolygonMetrics } from '../../utils/unprojectPolygon';
import RoomDirectory from './RoomDirectory';
import FloorPlanImage from './FloorPlanImage';
import PolygonEditCard from './PolygonEditCard';
import './FloorPlanPanel.css';

const FLOOR_LABELS = {
  H003: 'B3', H002: 'B2', H001: 'B1', H000: 'GF',
  H010: '+1', H020: '+2', H030: '+3', H040: '+4', H050: '+5',
};

export default function FloorPlanPanel() {
  const floors = useStore((s) => s.floors);
  const activeFloorId = useStore((s) => s.activeFloorId);
  const setFloors = useStore((s) => s.setFloors);
  const setActiveFloor = useStore((s) => s.setActiveFloor);
  const showAllFloors = useStore((s) => s.showAllFloors);
  const clearSelection = useStore((s) => s.clearSelection);
  const editingPolygon = useStore((s) => s.editingPolygon);
  const panelMode = useStore((s) => s.panelMode);
  const setPanelMode = useStore((s) => s.setPanelMode);

  const searchQuery = useStore((s) => s.searchQuery);
  const setSearchQuery = useStore((s) => s.setSearchQuery);
  const compareMode = useStore((s) => s.compareMode);
  const toggleCompareMode = useStore((s) => s.toggleCompareMode);
  const compareFloorId = useStore((s) => s.compareFloorId);
  const setCompareFloorId = useStore((s) => s.setCompareFloorId);
  const setFloorPolygons = useStore((s) => s.setFloorPolygons);

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

  // P key — push all edited polygons on current floor to backend with fresh metrics
  useEffect(() => {
    const handlePush = (e) => {
      if (e.key !== 'p' && e.key !== 'P') return;
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
      const floorId = useStore.getState().activeFloorId;
      if (!floorId) return;
      const polygons = useStore.getState().floorPolygons[floorId] || [];
      const edited = polygons.filter((p) => p.edited && p.vertices?.length >= 3);
      if (edited.length === 0) return;

      // Get snapshot matrices for fresh metric computation
      const snapshot = useStore.getState().floorSnapshots[floorId];
      const geom = useStore.getState().floorSpaceGeometry?.[floorId] || [];
      const avgY = geom.length > 0 ? geom.reduce((sum, s) => sum + (s.y || 0), 0) / geom.length : 0;

      let saved = 0;
      for (const p of edited) {
        let area = p.area_m2 ?? null;
        let perimCm = p.perimeter_cm ?? null;

        // Compute fresh area + perimeter from polygon vertices
        if (snapshot?.viewMatrix && snapshot?.projMatrix && p.vertices?.length >= 3) {
          const metrics = computePolygonMetrics(p.vertices, snapshot.viewMatrix, snapshot.projMatrix, avgY);
          if (metrics) {
            area = Math.round(metrics.area_m2 * 100) / 100;
            perimCm = Math.round(metrics.perimeter_m * 100);
          }
        }

        savePolygon(p.ifc_guid, p.vertices, p.floor_id || floorId, area, perimCm, p.space_name || null, p.primary_function || null)
          .then(() => { saved++; if (saved === edited.length) console.log(`[Delta] Saved ${saved} edited polygons to backend (with metrics)`); })
          .catch((err) => console.error('[Delta] Failed to save polygon:', err));
      }
    };
    window.addEventListener('keydown', handlePush);
    return () => window.removeEventListener('keydown', handlePush);
  }, []);

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

  // Sync polygons with backend when active floor changes (localStorage is source of truth)
  useEffect(() => {
    if (!activeFloorId) return;

    // 1. Push any localStorage polygons the server doesn't have,
    //    and re-save any locally edited polygons to update the backend
    const allLocal = useStore.getState().floorPolygons;
    const localForFloor = allLocal[activeFloorId] || [];
    if (localForFloor.length > 0) {
      const syncPayload = localForFloor
        .filter((p) => p.vertices?.length >= 3)
        .map((p) => ({
          ifc_guid: p.ifc_guid,
          floor_id: p.floor_id || activeFloorId,
          vertices: p.vertices,
          space_name: p.space_name || null,
          primary_function: p.primary_function || null,
          area_m2: p.area_m2 ?? null,
          perimeter_cm: p.perimeter_cm ?? null,
        }));
      if (syncPayload.length > 0) {
        syncPolygons(syncPayload).catch(() => {});
      }
      // Re-save edited polygons individually to update backend
      for (const p of localForFloor) {
        if (p.edited && p.vertices?.length >= 3) {
          savePolygon(p.ifc_guid, p.vertices, p.floor_id || activeFloorId, p.area_m2 ?? null, p.perimeter_cm ?? null, p.space_name || null, p.primary_function || null)
            .catch(() => {});
        }
      }
    }

    // 2. Fetch server polygons and merge with local (preserving worldVertices)
    fetchFloorPolygons(activeFloorId)
      .then((serverPolygons) => {
        const local = useStore.getState().floorPolygons[activeFloorId] || [];
        const localByGuid = new Map(local.map((p) => [p.ifc_guid, p]));
        const serverGuids = new Set(serverPolygons.map((p) => p.ifc_guid));
        const localOnly = local.filter((p) => !serverGuids.has(p.ifc_guid));
        // Merge server data with local edits (local wins when edited)
        const merged = serverPolygons.map((sp) => {
          const lp = localByGuid.get(sp.ifc_guid);
          if (!lp) return sp;
          if (lp.edited) {
            // Local edits take priority — overlay local fields onto server base
            return { ...sp, ...lp };
          }
          const extras = {};
          if (lp.worldVertices) extras.worldVertices = lp.worldVertices;
          return Object.keys(extras).length > 0 ? { ...sp, ...extras } : sp;
        });
        setFloorPolygons(activeFloorId, [...merged, ...localOnly]);
      })
      .catch(() => {
        // Backend unavailable — localStorage polygons are already in the store
      });
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

  const activeFloor = floors.find((f) => f.id === activeFloorId);
  const floorPolygons = useStore.getState().floorPolygons;
  const polyCount = activeFloorId ? (floorPolygons[activeFloorId] || []).length : 0;

  return (
    <div ref={panelRef} className="floorplan-panel">
      {/* ── Hero floor selector ── */}
      <div className="floorplan-panel__hero">
        <select
          className="floorplan-panel__hero-select"
          value={activeFloorId || ''}
          onChange={(e) => {
            const val = e.target.value;
            if (val) { handleFloorClick(val); } else { showAllFloors(); clearSelection(); }
          }}
        >
          <option value="">All floors</option>
          {floors.map((floor) => (
            <option key={floor.id} value={floor.id}>{floor.name}</option>
          ))}
        </select>
        {activeFloor && (
          <div className="floorplan-panel__hero-stats">
            <span>{polyCount} spaces</span>
            <span className="floorplan-panel__hero-dot">&middot;</span>
            <span>{activeFloor.total_area_m2 != null ? `${Number(activeFloor.total_area_m2).toLocaleString(undefined, { maximumFractionDigits: 0 })} m\u00B2` : '--'}</span>
          </div>
        )}
      </div>

      {/* ── Search (only when floor selected) ── */}
      {activeFloorId && (
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
      )}

      {/* ── View toggle (segmented, full width) ── */}
      {activeFloorId && (
        <div className="floorplan-panel__mode-bar">
          <button
            className={`floorplan-panel__seg-btn ${panelMode === 'list' ? 'floorplan-panel__seg-btn--active' : ''}`}
            onClick={() => setPanelMode('list')}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
              <line x1="3" y1="3" x2="11" y2="3"/><line x1="3" y1="7" x2="11" y2="7"/><line x1="3" y1="11" x2="9" y2="11"/>
            </svg>
            List
          </button>
          <button
            className={`floorplan-panel__seg-btn ${panelMode === 'plan' ? 'floorplan-panel__seg-btn--active' : ''}`}
            onClick={() => setPanelMode('plan')}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="2" width="10" height="10" rx="1.5"/>
              <line x1="2" y1="6" x2="12" y2="6"/><line x1="7" y1="6" x2="7" y2="12"/>
            </svg>
            Plan
          </button>
        </div>
      )}

      {/* ── Content ── */}
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
          <>
            <FloorPlanImage />
            {/* Compare button below plan */}
            <button
              className={`floorplan-panel__compare-text-btn ${compareMode ? 'floorplan-panel__compare-text-btn--active' : ''}`}
              onClick={toggleCompareMode}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <rect x="1" y="2" width="5" height="10" rx="1" stroke="currentColor" strokeWidth="1.2"/>
                <rect x="8" y="2" width="5" height="10" rx="1" stroke="currentColor" strokeWidth="1.2"/>
              </svg>
              {compareMode ? 'Exit compare' : 'Compare floors'}
            </button>
          </>
        )}
      </div>

      {/* Polygon edit card (double-click from list or plan) */}
      {editingPolygon && editingPolygon.floor_id === activeFloorId && panelMode === 'list' && (
        <PolygonEditCard />
      )}
    </div>
  );
}
