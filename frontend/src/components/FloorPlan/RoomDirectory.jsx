import React, { useState, useRef, useCallback, useMemo } from 'react';
import useStore from '../../store/useStore';
import { fetchSpaceByGuid } from '../../api/client';
import { computePolygonMetrics } from '../../utils/unprojectPolygon';
import './RoomDirectory.css';


function getPolygonOverrides(polygon, floorId) {
  const overrides = {};
  if (polygon.area_m2 != null) {
    overrides.area_m2 = polygon.area_m2;
  }
  if (polygon.normal_occupancy != null) overrides.normal_occupancy = polygon.normal_occupancy;
  if (polygon.max_occupancy != null) overrides.max_occupancy = polygon.max_occupancy;
  if (polygon.absolute_occupancy != null) overrides.absolute_occupancy = polygon.absolute_occupancy;
  if (polygon.occupiable != null) overrides.occupiable = polygon.occupiable;
  if (polygon.used_area_m2 != null) overrides.used_area_m2 = polygon.used_area_m2;
  if (polygon.free_area_m2 != null) overrides.free_area_m2 = polygon.free_area_m2;

  const snapshot = useStore.getState().floorSnapshots[floorId];
  if (snapshot?.viewMatrix && snapshot?.projMatrix && polygon.vertices?.length >= 3) {
    const geom = useStore.getState().floorSpaceGeometry?.[floorId] || [];
    const avgY = geom.length > 0 ? geom.reduce((sum, s) => sum + (s.y || 0), 0) / geom.length : 0;
    const metrics = computePolygonMetrics(polygon.vertices, snapshot.viewMatrix, snapshot.projMatrix, avgY);
    if (metrics) {
      overrides.perimeter_cm = Math.round(metrics.perimeter_m * 100);
      if (overrides.area_m2 == null) {
        overrides.area_m2 = Math.round(metrics.area_m2 * 100) / 100;
      }
    }
  }
  if (overrides.perimeter_cm == null && polygon.perimeter_m != null) {
    overrides.perimeter_cm = Math.round(polygon.perimeter_m * 100);
  }
  return overrides;
}

export default function RoomDirectory() {
  const activeFloorId = useStore((s) => s.activeFloorId);
  const searchQuery = useStore((s) => s.searchQuery);
  const selectedSpaceId = useStore((s) => s.selectedSpaceId);
  const selectSpace = useStore((s) => s.selectSpace);
  const floorPolygons = useStore((s) => s.floorPolygons);

  const [collapsedGroups, setCollapsedGroups] = useState(new Set());
  const initializedFloorRef = useRef(null);
  const selectedRef = useRef(null);

  const polygons = useMemo(() => {
    if (!activeFloorId) return [];
    return floorPolygons[activeFloorId] || [];
  }, [activeFloorId, floorPolygons]);

  const filtered = useMemo(() => {
    if (!searchQuery || searchQuery.trim().length === 0) return polygons;
    const q = searchQuery.toLowerCase().trim();
    return polygons.filter((p) => {
      const name = (p.space_name || '').toLowerCase();
      const fn = (p.primary_function || '').toLowerCase();
      return name.includes(q) || fn.includes(q);
    });
  }, [polygons, searchQuery]);

  const groups = useMemo(() => {
    const map = {};
    for (const poly of filtered) {
      const fn = poly.primary_function || 'Unassigned';
      if (!map[fn]) map[fn] = [];
      map[fn].push(poly);
    }
    for (const polys of Object.values(map)) {
      polys.sort((a, b) => (a.space_name || '').localeCompare(b.space_name || ''));
    }
    return Object.entries(map).sort(([a], [b]) => {
      if (a === 'Unassigned') return 1;
      if (b === 'Unassigned') return -1;
      return a.localeCompare(b);
    });
  }, [filtered]);

  // Start all groups collapsed; reset when floor changes
  React.useEffect(() => {
    if (groups.length > 0 && initializedFloorRef.current !== activeFloorId) {
      setCollapsedGroups(new Set(groups.map(([fn]) => fn)));
      initializedFloorRef.current = activeFloorId;
    }
  }, [groups, activeFloorId]);

  React.useEffect(() => {
    if (selectedRef.current) {
      selectedRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [selectedSpaceId]);

  const setEditingPolygon = useStore((s) => s.setEditingPolygon);

  const handleCardDoubleClick = useCallback((polygon) => {
    setEditingPolygon({ ifc_guid: polygon.ifc_guid, floor_id: activeFloorId });
  }, [setEditingPolygon, activeFloorId]);

  const handleCardClick = useCallback(async (polygon) => {
    let overrides = {};
    try {
      overrides = getPolygonOverrides(polygon, activeFloorId);
    } catch {}
    try {
      const spaceData = await fetchSpaceByGuid(polygon.ifc_guid);
      // API data is authoritative for metrics — don't let stale polygon overrides mask it
      const METRIC_KEYS = ['normal_occupancy', 'max_occupancy', 'absolute_occupancy',
        'occupiable', 'used_area_m2', 'free_area_m2'];
      const safeOverrides = { ...overrides };
      for (const k of METRIC_KEYS) {
        if (spaceData[k] != null) delete safeOverrides[k];
      }
      selectSpace(polygon.ifc_guid, { ...spaceData, ...safeOverrides });
    } catch {
      selectSpace(polygon.ifc_guid, {
        ifc_guid: polygon.ifc_guid,
        space_name: polygon.space_name,
        primary_function: polygon.primary_function,
        floor_id: activeFloorId,
        ...overrides,
      });
    }
  }, [selectSpace, activeFloorId]);

  const toggleGroup = useCallback((fn) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(fn)) next.delete(fn);
      else next.add(fn);
      return next;
    });
  }, []);

  const isSearching = searchQuery.trim().length > 0;

  if (!activeFloorId && !isSearching) {
    return (
      <div className="room-directory__empty">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#7b8ca1" strokeWidth="1.2">
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" strokeLinecap="round" strokeLinejoin="round"/>
          <polyline points="9 22 9 12 15 12 15 22" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        <p>Select a floor to browse rooms</p>
      </div>
    );
  }

  if (filtered.length === 0) {
    return (
      <div className="room-directory__empty">
        <p>{isSearching ? `No rooms matching "${searchQuery}"` : 'No spaces on this floor'}</p>
      </div>
    );
  }

  return (
    <div className="room-directory">
      {groups.map(([fn, fnPolygons]) => {
        const collapsed = collapsedGroups.has(fn);
        const totalOcc = fnPolygons.reduce((s, p) => s + (p.max_occupancy || 0), 0);

        return (
          <div key={fn} className="room-directory__group">
            <button
              className="room-directory__group-header"
              onClick={() => toggleGroup(fn)}
            >
              <span className={`room-directory__chevron ${collapsed ? '' : 'room-directory__chevron--open'}`}>
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                  <path d="M3 2l4 3-4 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </span>
              <span className="room-directory__group-name">{fn}</span>
              <span className="room-directory__group-meta">
                <span className="room-directory__group-count">{fnPolygons.length}</span>
                {totalOcc > 0 && (
                  <span className="room-directory__group-occ">{totalOcc} occ</span>
                )}
              </span>
            </button>
            {!collapsed && fnPolygons.map((poly) => (
              <PolygonCard
                key={poly.ifc_guid}
                polygon={poly}
                isSelected={poly.ifc_guid === selectedSpaceId}
                onClick={handleCardClick}
                onDoubleClick={handleCardDoubleClick}
                selectedRef={poly.ifc_guid === selectedSpaceId ? selectedRef : null}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}

function PolygonCard({ polygon, isSelected, onClick, onDoubleClick, selectedRef }) {
  const area = polygon.area_m2 != null ? `${Number(polygon.area_m2).toFixed(1)} m\u00b2` : null;
  const occ = polygon.max_occupancy > 0 ? polygon.max_occupancy : null;

  return (
    <div
      ref={selectedRef}
      className={`room-card ${isSelected ? 'room-card--selected' : ''}`}
      onClick={() => onClick(polygon)}
      onDoubleClick={() => onDoubleClick(polygon)}
    >
      <div className="room-card__info">
        <span className="room-card__name">{polygon.space_name || polygon.ifc_guid}</span>
        <span className="room-card__sub">
          {area && <span>{area}</span>}
          {area && occ ? <span className="room-card__sub-dot">&middot;</span> : null}
          {occ && <span>{occ} occ</span>}
        </span>
      </div>
    </div>
  );
}
