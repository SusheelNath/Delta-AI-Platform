import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import useStore from '../../store/useStore';
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

  // Eagerly compute initial collapsed set to avoid one-frame flash
  const [collapsedGroups, setCollapsedGroups] = useState(() => {
    const allGroupNames = groups.map(([fn]) => fn);
    if (allGroupNames.length === 0) return new Set();
    // If a space is already selected, expand its group
    if (selectedSpaceId) {
      const selectedPoly = filtered.find((p) => p.ifc_guid === selectedSpaceId);
      if (selectedPoly) {
        const selectedFn = selectedPoly.primary_function || 'Unassigned';
        return new Set(allGroupNames.filter((fn) => fn !== selectedFn));
      }
    }
    return new Set(allGroupNames);
  });
  const initializedFloorRef = useRef(activeFloorId);
  const [fading, setFading] = useState(false);

  // Reset when floor changes — with fade transition
  React.useEffect(() => {
    if (groups.length > 0 && initializedFloorRef.current !== activeFloorId) {
      setFading(true);
      const timer = setTimeout(() => {
        setCollapsedGroups(new Set(groups.map(([fn]) => fn)));
        setExpandedGroups([]);
        initializedFloorRef.current = activeFloorId;
        setFading(false);
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [groups, activeFloorId, setExpandedGroups]);

  // On selection: collapse all groups, expand only the selected item's parent, scroll to it
  // On deselection (null): leave dropdowns as-is
  // Global store writes (setExpandedGroups, setCurrentExpandedGroup) are deferred via
  // queueMicrotask so they don't trigger sibling re-renders (XeokitViewer) mid-commit.
  React.useEffect(() => {
    if (!selectedSpaceId || groups.length === 0) return;
    const selectedPoly = filtered.find((p) => p.ifc_guid === selectedSpaceId);
    if (!selectedPoly) return;
    const selectedFn = selectedPoly.primary_function || 'Unassigned';
    const allGroupNames = groups.map(([name]) => name);
    setCollapsedGroups(new Set(allGroupNames.filter((name) => name !== selectedFn)));
    queueMicrotask(() => {
      setExpandedGroups([selectedFn]);
      setCurrentExpandedGroup(selectedFn);
    });
  }, [selectedSpaceId, groups, filtered, setExpandedGroups, setCurrentExpandedGroup]);

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

    // Expand the group — defer store writes to avoid mid-render cascade
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      next.delete(fnName);
      const allGroupNames = groups.map(([name]) => name);
      queueMicrotask(() => {
        setExpandedGroups(allGroupNames.filter((name) => !next.has(name)));
        setCurrentExpandedGroup(fnName);
      });
      return next;
    });

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

  const handleCardClick = useCallback((polygon) => {
    selectSpaceFromPolygon(polygon, activeFloorId);
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
        <svg className="room-directory__empty-icon" width="48" height="48" viewBox="0 0 48 48" fill="none">
          {/* Floor plan outline */}
          <rect x="6" y="10" width="36" height="28" rx="2" stroke="#d0cbc3" strokeWidth="1.2" />
          <line x1="6" y1="24" x2="42" y2="24" stroke="#d0cbc3" strokeWidth="1" strokeDasharray="3 2" />
          <line x1="24" y1="24" x2="24" y2="38" stroke="#d0cbc3" strokeWidth="1" strokeDasharray="3 2" />
          <line x1="18" y1="10" x2="18" y2="24" stroke="#d0cbc3" strokeWidth="1" strokeDasharray="3 2" />
          <line x1="32" y1="10" x2="32" y2="24" stroke="#d0cbc3" strokeWidth="1" strokeDasharray="3 2" />
          {/* Delta accent */}
          <path d="M24 16l4 7h-8z" fill="none" stroke="#E77133" strokeWidth="1.2" strokeLinejoin="round" opacity="0.5" />
        </svg>
        <p className="room-directory__empty-title">Select a floor</p>
        <p className="room-directory__empty-sub">Choose a floor from the dropdown above to explore rooms and spaces</p>
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
    <div className={`room-directory ${fading ? 'room-directory--fading' : 'room-directory--visible'}`} ref={directoryRef}>
      {groups.map(([fn, fnPolygons], groupIdx) => {
        const collapsed = collapsedGroups.has(fn);
        const totalOcc = fnPolygons.reduce((s, p) => s + (p.max_occupancy || 0), 0);
        const totalArea = fnPolygons.reduce((s, p) => s + (p.area_m2 || 0), 0);
        const areaLabel = totalArea >= 10 ? String(Math.round(totalArea)) : totalArea.toFixed(1);
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
                <span className="room-directory__group-col room-directory__group-col--area">
                  <span className="room-directory__col-value">{areaLabel}</span>
                  <span className="room-directory__col-label">m²</span>
                </span>
                <span className="room-directory__group-col room-directory__group-col--occ">
                  <span className="room-directory__col-value">{totalOcc > 0 ? totalOcc : '—'}</span>
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
  const area = polygon.area_m2 != null ? `${Number(polygon.area_m2).toFixed(1)}` : null;
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
      </div>
      {area && <span className="room-card__area">{area} m&sup2;</span>}
    </div>
  );
}
