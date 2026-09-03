# Components Library

Reusable implementation snippets for the Delta Intelligence Platform.
Add when needed, remove when not needed.

---

## WASD Polygon Nudge Toolkit

Nudges all polygons on a target floor using WASD keys. Press P to save.

### Prerequisites

- `nudgeFloorPolygons(floorId, dx, dy)` must exist in `useStore.js` (already present)
- xeokit keyboard camera controls should be disabled while active

### 1. FloorPlanPanel.jsx — Add WASD handler

Insert inside the component, after the P-key handler `useEffect`:

```jsx
// WASD keys — nudge target floor polygons
useEffect(() => {
  const nudge = useStore.getState().nudgeFloorPolygons;
  const STEP = 0.15; // percentage units per press
  const TARGET_FLOOR = 'H020'; // change to target floor
  const handleWASD = (e) => {
    const key = e.key.toLowerCase();
    if (!['w', 'a', 's', 'd'].includes(key)) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const dx = key === 'd' ? STEP : key === 'a' ? -STEP : 0;
    const dy = key === 's' ? STEP : key === 'w' ? -STEP : 0;
    nudge(TARGET_FLOOR, dx, dy);
  };
  window.addEventListener('keydown', handleWASD, true);
  return () => window.removeEventListener('keydown', handleWASD, true);
}, []);
```

### 2. FloorPlanPanel.jsx — Eager polygon load (optional)

Ensures the target floor's polygons are in the store on mount, so nudge works immediately even before navigating to that floor:

```jsx
// Eagerly load target floor polygons on mount so WASD nudge works immediately
useEffect(() => {
  const TARGET_FLOOR = 'H020';
  const existing = useStore.getState().floorPolygons[TARGET_FLOOR];
  if (existing && existing.length > 0) return;
  fetchFloorPolygons(TARGET_FLOOR)
    .then((serverPolygons) => {
      if (serverPolygons.length > 0) {
        setFloorPolygons(TARGET_FLOOR, serverPolygons);
      }
    })
    .catch(() => {});
}, [setFloorPolygons]);
```

### 3. XeokitViewer.jsx — Disable xeokit keyboard controls

Add after `viewer.camera.perspective.near = 1.0;`:

```js
// Disable xeokit keyboard camera controls so WASD only nudges polygons
viewer.cameraControl.keyboardPanRate = 0;
viewer.cameraControl.keyboardRotationRate = 0;
viewer.cameraControl.keyboardDollyRate = 0;
```

### 4. useStore.js — nudgeFloorPolygons (already present)

```js
nudgeFloorPolygons: (floorId, dx, dy) => {
  const prev = get().floorPolygons;
  const floor = (prev[floorId] || []).map((p) => ({
    ...p,
    edited: true,
    vertices: p.vertices.map(([x, y]) => [x + dx, y + dy]),
  }));
  const updated = { ...prev, [floorId]: floor };
  savePolygonsToStorage(updated);
  set({ floorPolygons: updated });
},
```

### Notes

- `STEP = 0.15` moves polygons ~0.15% of the floor plan per keypress. Adjust for finer/coarser control.
- Change `TARGET_FLOOR` to any floor ID (e.g. `'H030'`).
- The `edited: true` flag ensures nudged positions survive server merges on floor switch.
- Press **P** to push edited polygon positions to the backend.
- Use the **SAVE** button in the 3D viewer to persist to backend + backup + GitHub.

---
