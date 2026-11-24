import React, { useEffect, useState } from 'react';
import useStore from '../../store/useStore';
import { fetchFloors } from '../../api/client';
import { BUILDING_GROUPS, FLOOR_NAMES, FLOOR_ORDER } from '../../utils/translateNL';
import './FloorSelector.css';

/**
 * Static floor definitions for the Office Campus.
 * 35 floors across 8 buildings, grouped for the selector UI.
 * Used as fallback if the API is unavailable.
 */
const FLOOR_DEFINITIONS = FLOOR_ORDER.map((id, idx) => {
  const names = FLOOR_NAMES[id] || { en: id, ar: id };
  return { id, name: names.en, nameAr: names.ar, shortLabel: id.replace('_', ' '), level: idx };
});

export default function FloorSelector() {
  const floors = useStore((s) => s.floors);
  const floorVisibility = useStore((s) => s.floorVisibility);
  const activeFloorId = useStore((s) => s.activeFloorId);
  const setFloors = useStore((s) => s.setFloors);
  const toggleFloorVisibility = useStore((s) => s.toggleFloorVisibility);
  const setActiveFloor = useStore((s) => s.setActiveFloor);
  const showAllFloors = useStore((s) => s.showAllFloors);

  // Drill-down: null = building list, string = drilled into that building group
  const [currentBuilding, setCurrentBuilding] = useState(null);

  // Fetch floors from API, fallback to static definitions
  useEffect(() => {
    let cancelled = false;

    async function loadFloors() {
      try {
        const apiFloors = await fetchFloors();
        if (!cancelled && apiFloors && apiFloors.length > 0) {
          const merged = apiFloors.map((af) => {
            const names = FLOOR_NAMES[af.id] || { en: af.name || af.id, ar: af.name || af.id };
            const orderIdx = FLOOR_ORDER.indexOf(af.id);
            return {
              ...af,
              name: names.en,
              nameAr: names.ar,
              shortLabel: af.id.replace('_', ' '),
              level: orderIdx >= 0 ? orderIdx : 999,
            };
          });
          merged.sort((a, b) => a.level - b.level);
          setFloors(merged);
        }
      } catch (err) {
        console.warn('Floor API unavailable, using static definitions');
        if (!cancelled) {
          setFloors(FLOOR_DEFINITIONS);
        }
      }
    }

    loadFloors();
    return () => { cancelled = true; };
  }, [setFloors]);

  const floorMap = new Map(floors.map((f) => [f.id, f]));
  const allVisible = floors.length > 0 && floors.every((f) => floorVisibility[f.id] !== false);

  const handleFloorClick = (floorId) => {
    toggleFloorVisibility(floorId);
  };

  const handleFloorDoubleClick = (floorId) => {
    setActiveFloor(floorId);
  };

  // Current group when drilled in
  const activeGroup = currentBuilding
    ? BUILDING_GROUPS.find((g) => g.id === currentBuilding)
    : null;

  // ── Building list view ──
  if (!currentBuilding) {
    return (
      <div className="floor-selector">
        <div className="floor-selector__header">
          <span className="floor-selector__label">Buildings</span>
          <button
            className={`floor-selector__pill ${allVisible ? 'floor-selector__pill--active' : ''}`}
            onClick={showAllFloors}
            title="Show all floors"
          >
            All
          </button>
        </div>

        <div className="floor-selector__list">
          {BUILDING_GROUPS.map((group) => {
            const groupFloors = group.floors.filter((fid) => floorMap.has(fid));
            if (groupFloors.length === 0) return null;
            const visibleCount = groupFloors.filter((fid) => floorVisibility[fid] !== false).length;
            const allGroupVisible = visibleCount === groupFloors.length;

            return (
              <button
                key={group.id}
                className={`floor-selector__building ${allGroupVisible ? 'floor-selector__building--active' : ''}`}
                onClick={() => setCurrentBuilding(group.id)}
                title={group.labelAr}
              >
                <div className="floor-selector__building-info">
                  <span className="floor-selector__building-name">{group.label}</span>
                  <span className="floor-selector__building-name-ar">{group.labelAr}</span>
                </div>
                <div className="floor-selector__building-meta">
                  <span className="floor-selector__building-count">{visibleCount}/{groupFloors.length}</span>
                  <svg className="floor-selector__chevron" width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path d="M4.5 2.5L8 6L4.5 9.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // ── Floor list view (drilled into a building) ──
  const groupFloors = activeGroup ? activeGroup.floors.filter((fid) => floorMap.has(fid)) : [];

  return (
    <div className="floor-selector">
      <div className="floor-selector__header">
        <button
          className="floor-selector__back"
          onClick={() => setCurrentBuilding(null)}
          title="Back to buildings"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M9 3L5 7L9 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <span className="floor-selector__label">{activeGroup.label}</span>
        <button
          className={`floor-selector__pill ${allVisible ? 'floor-selector__pill--active' : ''}`}
          onClick={showAllFloors}
          title="Show all floors"
        >
          All
        </button>
      </div>

      <div className="floor-selector__list">
        {groupFloors.map((floorId) => {
          const floor = floorMap.get(floorId);
          if (!floor) return null;
          const visible = floorVisibility[floorId] !== false;
          const solo = activeFloorId === floorId;
          const names = FLOOR_NAMES[floorId] || { en: floor.name, ar: '' };
          const levelPart = names.en.includes('\u2013') ? names.en.split('\u2013')[1].trim() : names.en;
          const levelPartAr = names.ar.includes('\u2013') ? names.ar.split('\u2013')[1].trim() : names.ar;

          return (
            <button
              key={floorId}
              className={`floor-selector__floor ${visible ? 'floor-selector__floor--active' : 'floor-selector__floor--dimmed'} ${solo ? 'floor-selector__floor--solo' : ''}`}
              onClick={() => handleFloorClick(floorId)}
              onDoubleClick={() => handleFloorDoubleClick(floorId)}
              title={`${names.en} (click to toggle, double-click to solo)`}
            >
              <span className="floor-selector__floor-en">{levelPart}</span>
              <span className="floor-selector__floor-ar">{levelPartAr}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
