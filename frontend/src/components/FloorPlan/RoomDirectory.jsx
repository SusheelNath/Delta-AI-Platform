import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import useStore from '../../store/useStore';
import { fetchSpaceByGuid } from '../../api/client';
import { selectSpaceFromPolygon } from '../../utils/polygonOverrides';
import './RoomDirectory.css';

const EMPTY = [];

export default function RoomDirectory() {
  const activeFloorId = useStore((s) => s.activeFloorId);
  const searchQuery = useStore((s) => s.searchQuery);
  const selectedSpaceId = useStore((s) => s.selectedSpaceId);
  const activeFloorPolygons = useStore((s) => s.activeFloorId ? (s.floorPolygons[s.activeFloorId] || EMPTY) : EMPTY);

  const directoryExpandGroup = useStore((s) => s.directoryExpandGroup);
  const directorySelectIndex = useStore((s) => s.directorySelectIndex);
  const clearDirectoryAction = useStore((s) => s.clearDirectoryAction);
  const setCurrentExpandedGroup = useStore((s) => s.setCurrentExpandedGroup);
  const setExpandedGroups = useStore((s) => s.setExpandedGroups);

  const [collapsedGroups, setCollapsedGroups] = useState(new Set());
  const initializedFloorRef = useRef(null);
  const selectedRef = useRef(null);
  const directoryRef = useRef(null);
  const scrollState = useRef({ target: 0, current: 0, raf: null });

  const polygons = activeFloorPolygons;

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
      polys.sort((a, b) => (a.space_name || '').localeCompare(b.space_name || '')
        || (a.ifc_guid || '').localeCompare(b.ifc_guid || ''));
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
      setExpandedGroups([]);
      initializedFloorRef.current = activeFloorId;
    }
  }, [groups, activeFloorId, setExpandedGroups]);

  React.useEffect(() => {
    if (selectedRef.current) {
      selectedRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [selectedSpaceId]);

  // Lerped smooth scroll
  useEffect(() => {
    const el = directoryRef.current;
    if (!el) return;
    const s = scrollState.current;
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

  // AI-driven: expand a directory group and optionally select the Nth room
  useEffect(() => {
    if (!directoryExpandGroup || groups.length === 0) return;
    const search = directoryExpandGroup.toLowerCase();

    // Find matching group by function name (fuzzy contains match)
    const match = groups.find(([fn]) => fn.toLowerCase().includes(search))
      || groups.find(([fn]) => fn.toLowerCase() === search);
    if (!match) {
      clearDirectoryAction();
      return;
    }

    const [fnName, fnPolygons] = match;

    // Expand the group
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      next.delete(fnName);
      const allGroupNames = groups.map(([name]) => name);
      setExpandedGroups(allGroupNames.filter((name) => !next.has(name)));
      return next;
    });
    setCurrentExpandedGroup(fnName);

    // If a specific room index is requested, select it
    if (directorySelectIndex != null && directorySelectIndex >= 0) {
      const idx = Math.min(directorySelectIndex, fnPolygons.length - 1);
      const targetPoly = fnPolygons[idx];
      if (targetPoly) {
        handleCardClick(targetPoly);
      }
    }

    clearDirectoryAction();
  }, [directoryExpandGroup, directorySelectIndex, groups]);

  const handleCardClick = useCallback(async (polygon) => {
    await selectSpaceFromPolygon(polygon, activeFloorId, fetchSpaceByGuid);
  }, [activeFloorId]);

  const toggleGroup = useCallback((fn) => {
    const isCurrentlyCollapsed = collapsedGroups.has(fn);
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(fn)) {
        next.delete(fn);
      } else {
        next.add(fn);
      }
      // Sync expanded groups to store: all group names NOT in the collapsed set
      const allGroupNames = groups.map(([name]) => name);
      const expanded = allGroupNames.filter((name) => !next.has(name));
      setExpandedGroups(expanded);
      return next;
    });
    setCurrentExpandedGroup(isCurrentlyCollapsed ? fn : null);
  }, [collapsedGroups, setCurrentExpandedGroup, setExpandedGroups, groups]);

  const isSearching = searchQuery.trim().length > 0;

  if (!activeFloorId && !isSearching) {
    return (
      <div className="room-directory__empty">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="1.2">
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
    <div className="room-directory" ref={directoryRef}>
      {groups.map(([fn, fnPolygons], groupIdx) => {
        const collapsed = collapsedGroups.has(fn);
        const totalOcc = fnPolygons.reduce((s, p) => s + (p.max_occupancy || 0), 0);
        const groupNumber = groupIdx + 1;

        return (
          <div key={fn} className="room-directory__group">
            <button
              className={`room-directory__group-header ${collapsed ? '' : 'room-directory__group-header--open'}`}
              onClick={() => toggleGroup(fn)}
            >
              <span className={`room-directory__chevron ${collapsed ? '' : 'room-directory__chevron--open'}`}>
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                  <path d="M3 2l4 3-4 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </span>
              <span className="room-directory__group-index">{groupNumber}</span>
              <span className="room-directory__group-name">{fn}</span>
              <span className="room-directory__group-meta">
                <span className="room-directory__group-col room-directory__group-col--rooms">
                  <span className="room-directory__col-value">{fnPolygons.length}</span>
                  <span className="room-directory__col-label">{fnPolygons.length === 1 ? 'unit' : 'units'}</span>
                </span>
                <span className="room-directory__group-col room-directory__group-col--occ">
                  <span className="room-directory__col-value">{totalOcc > 0 ? totalOcc.toLocaleString() : '—'}</span>
                  <span className="room-directory__col-label">occ</span>
                </span>
              </span>
            </button>
            <div className={`room-directory__group-body ${collapsed ? 'room-directory__group-body--collapsed' : ''}`}>
              <div className="room-directory__group-body-inner">
                {fnPolygons.map((poly, roomIdx) => (
                  <PolygonCard
                    key={poly.ifc_guid}
                    polygon={poly}
                    roomIndex={roomIdx + 1}
                    isSelected={poly.ifc_guid === selectedSpaceId}
                    onClick={handleCardClick}
                    selectedRef={poly.ifc_guid === selectedSpaceId ? selectedRef : null}
                  />
                ))}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function PolygonCard({ polygon, roomIndex, isSelected, onClick, selectedRef }) {
  const area = polygon.area_m2 != null ? `${Number(polygon.area_m2).toFixed(1)} m\u00b2` : null;
  const occ = polygon.max_occupancy > 0 ? polygon.max_occupancy : null;
  const setHoveredGuid = useStore((s) => s.setHoveredPolygonGuid);

  return (
    <div
      ref={selectedRef}
      className={`room-card ${isSelected ? 'room-card--selected' : ''}`}
      onClick={() => onClick(polygon)}
      onMouseEnter={() => setHoveredGuid(polygon.ifc_guid)}
      onMouseLeave={() => setHoveredGuid(null)}
    >
      <span className="room-card__index">{roomIndex}</span>
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
