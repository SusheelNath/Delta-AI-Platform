import React, { useEffect } from 'react';
import useStore from '../../store/useStore';
import { fetchFloors } from '../../api/client';
import './FloorSelector.css';

/**
 * Static floor definitions with display metadata.
 * Used as fallback if the API is unavailable.
 */
const FLOOR_DEFINITIONS = [
  { id: 'H003', name: 'Basement 3', shortLabel: 'B3', level: -3 },
  { id: 'H002', name: 'Basement 2', shortLabel: 'B2', level: -2 },
  { id: 'H001', name: 'Basement 1', shortLabel: 'B1', level: -1 },
  { id: 'H000', name: 'Ground Floor', shortLabel: 'Ground', level: 0 },
  { id: 'H010', name: 'Floor +1', shortLabel: '+1', level: 1 },
  { id: 'H020', name: 'Floor +2', shortLabel: '+2', level: 2 },
  { id: 'H030', name: 'Floor +3', shortLabel: '+3', level: 3 },
  { id: 'H040', name: 'Floor +4', shortLabel: '+4', level: 4 },
  { id: 'H050', name: 'Floor +5', shortLabel: '+5', level: 5 },
];

export default function FloorSelector() {
  const floors = useStore((s) => s.floors);
  const floorVisibility = useStore((s) => s.floorVisibility);
  const activeFloorId = useStore((s) => s.activeFloorId);
  const setFloors = useStore((s) => s.setFloors);
  const toggleFloorVisibility = useStore((s) => s.toggleFloorVisibility);
  const setActiveFloor = useStore((s) => s.setActiveFloor);
  const showAllFloors = useStore((s) => s.showAllFloors);

  // Fetch floors from API, fallback to static definitions
  useEffect(() => {
    let cancelled = false;

    async function loadFloors() {
      try {
        const apiFloors = await fetchFloors();
        if (!cancelled && apiFloors && apiFloors.length > 0) {
          // Merge API floors with our display metadata
          const merged = apiFloors.map((af) => {
            const def = FLOOR_DEFINITIONS.find((d) => d.id === af.id);
            return {
              ...af,
              shortLabel: def?.shortLabel || af.name || af.id,
              level: def?.level ?? 0,
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

  const allVisible = floors.length > 0 && floors.every((f) => floorVisibility[f.id] !== false);

  const handleAllClick = () => {
    showAllFloors();
  };

  const handleFloorClick = (floorId) => {
    toggleFloorVisibility(floorId);
  };

  const handleFloorDoubleClick = (floorId) => {
    setActiveFloor(floorId);
  };

  return (
    <div className="floor-selector">
      <span className="floor-selector__label">Floors</span>

      <button
        className={`floor-selector__btn floor-selector__btn--all ${allVisible ? 'floor-selector__btn--active' : ''}`}
        onClick={handleAllClick}
        title="Show all floors"
      >
        All
      </button>

      <div className="floor-selector__divider" />

      {floors.map((floor) => {
        const visible = floorVisibility[floor.id] !== false;
        const solo = activeFloorId === floor.id;
        return (
          <button
            key={floor.id}
            className={`floor-selector__btn ${visible ? 'floor-selector__btn--active' : 'floor-selector__btn--dimmed'} ${solo ? 'floor-selector__btn--solo' : ''}`}
            onClick={() => handleFloorClick(floor.id)}
            onDoubleClick={() => handleFloorDoubleClick(floor.id)}
            title={`${floor.name || floor.id} (click to toggle, double-click to solo)`}
          >
            {floor.shortLabel || floor.id}
          </button>
        );
      })}
    </div>
  );
}
