import React, { useEffect, useState, useRef, useCallback } from 'react';
import useStore from '../../store/useStore';
import { searchSpaces } from '../../api/client';
import { getCategoryIndex, getCssColorForFunction } from '../../utils/colorScheme';
import './RoomDirectory.css';

const FLOOR_LABELS = {
  H003: 'B3', H002: 'B2', H001: 'B1', H000: 'GF',
  H010: '+1', H020: '+2', H030: '+3', H040: '+4', H050: '+5',
};

export default function RoomDirectory() {
  const activeFloorId = useStore((s) => s.activeFloorId);
  const searchQuery = useStore((s) => s.searchQuery);
  const activeFunctionFilters = useStore((s) => s.activeFunctionFilters);
  const selectedSpaceId = useStore((s) => s.selectedSpaceId);
  const selectSpace = useStore((s) => s.selectSpace);

  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState(new Set());
  const selectedRef = useRef(null);

  // Fetch rooms when floor or search changes
  useEffect(() => {
    let cancelled = false;

    const isSearching = searchQuery.trim().length > 0;
    if (!isSearching && !activeFloorId) {
      setRooms([]);
      return;
    }

    setLoading(true);
    const params = {};
    if (isSearching) {
      params.q = searchQuery.trim();
    } else {
      params.floor_id = activeFloorId;
    }
    params.limit = 500;

    searchSpaces(params)
      .then((data) => {
        if (!cancelled) {
          setRooms(data);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.error('[Delta] Room fetch error:', err);
          setRooms([]);
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [activeFloorId, searchQuery]);

  // Scroll selected card into view
  useEffect(() => {
    if (selectedRef.current) {
      selectedRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [selectedSpaceId]);

  const handleCardClick = useCallback((room) => {
    const guid = room.ifc_guid;
    if (guid) {
      selectSpace(guid, room);
    }
  }, [selectSpace]);

  const toggleGroup = useCallback((zone) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(zone)) next.delete(zone);
      else next.add(zone);
      return next;
    });
  }, []);

  // Filter by active function categories
  const filteredRooms = rooms.filter((room) => {
    const catIdx = getCategoryIndex(room.primary_function || '');
    return catIdx < 0 || activeFunctionFilters[catIdx];
  });

  const isSearching = searchQuery.trim().length > 0;

  // Group by functional_zone (only in browse mode)
  const groups = !isSearching
    ? groupByZone(filteredRooms)
    : null;

  // Empty states
  if (!activeFloorId && !isSearching) {
    return (
      <div className="room-directory__empty">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#5a6478" strokeWidth="1.5">
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" strokeLinecap="round" strokeLinejoin="round"/>
          <polyline points="9 22 9 12 15 12 15 22" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        <p>Select a floor to browse rooms</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="room-directory__empty">
        <div className="room-directory__spinner" />
        <p>Loading rooms...</p>
      </div>
    );
  }

  if (filteredRooms.length === 0) {
    return (
      <div className="room-directory__empty">
        <p>{isSearching ? `No rooms matching "${searchQuery}"` : 'No rooms on this floor match the active filters'}</p>
      </div>
    );
  }

  return (
    <div className="room-directory">
      {isSearching ? (
        // Flat list for search results
        filteredRooms.map((room) => (
          <RoomCard
            key={room.id}
            room={room}
            isSelected={room.ifc_guid === selectedSpaceId}
            showFloor={true}
            onClick={handleCardClick}
            selectedRef={room.ifc_guid === selectedSpaceId ? selectedRef : null}
          />
        ))
      ) : (
        // Grouped by department
        groups.map(([zone, zoneRooms]) => (
          <div key={zone} className="room-directory__group">
            <button
              className="room-directory__group-header"
              onClick={() => toggleGroup(zone)}
            >
              <span className={`room-directory__chevron ${collapsedGroups.has(zone) ? '' : 'room-directory__chevron--open'}`}>
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                  <path d="M3 2l4 3-4 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </span>
              <span className="room-directory__group-name">{zone}</span>
              <span className="room-directory__group-count">{zoneRooms.length}</span>
            </button>
            {!collapsedGroups.has(zone) && zoneRooms.map((room) => (
              <RoomCard
                key={room.id}
                room={room}
                isSelected={room.ifc_guid === selectedSpaceId}
                showFloor={false}
                onClick={handleCardClick}
                selectedRef={room.ifc_guid === selectedSpaceId ? selectedRef : null}
              />
            ))}
          </div>
        ))
      )}
    </div>
  );
}

function RoomCard({ room, isSelected, showFloor, onClick, selectedRef }) {
  const area = room.area_m2 ? `${Number(room.area_m2).toFixed(0)} m\u00b2` : null;
  const capacity = room.normal_occupancy && room.normal_occupancy !== 'Not recorded in IFC Spaces'
    ? room.normal_occupancy
    : null;
  const dotColor = getCssColorForFunction(room.primary_function || '');

  return (
    <div
      ref={selectedRef}
      className={`room-card ${isSelected ? 'room-card--selected' : ''}`}
      onClick={() => onClick(room)}
    >
      <span className="room-card__dot" style={{ background: dotColor }} />
      <div className="room-card__info">
        <span className="room-card__name">{room.space_name || room.id}</span>
        <span className="room-card__function">{room.primary_function || 'Unknown function'}</span>
      </div>
      <div className="room-card__metrics">
        {area && <span className="room-card__area">{area}</span>}
        {capacity && <span className="room-card__capacity">Cap: {capacity}</span>}
        {showFloor && (
          <span className="room-card__floor-badge">{FLOOR_LABELS[room.floor_id] || room.floor_name || room.floor_id}</span>
        )}
      </div>
    </div>
  );
}

function groupByZone(rooms) {
  const map = {};
  for (const room of rooms) {
    const zone = room.functional_zone || 'Unassigned';
    if (!map[zone]) map[zone] = [];
    map[zone].push(room);
  }
  return Object.entries(map).sort(([a], [b]) => {
    if (a === 'Unassigned') return 1;
    if (b === 'Unassigned') return -1;
    return a.localeCompare(b);
  });
}
