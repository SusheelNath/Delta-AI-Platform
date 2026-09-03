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

## Delete Polygon Toolkit

Delete key removes the currently selected polygon with a confirmation dialog.

### Prerequisites

- `removePolygonFromFloor(floorId, ifcGuid)` must exist in `useStore.js` (already present)
- `deletePolygon` must be imported from `api/client.js` (already present)

### 1. FloorPlanPanel.jsx — Add import

Add `deletePolygon` to the client import:

```jsx
import { fetchFloors, fetchFloorPolygons, syncPolygons, savePolygon, deletePolygon } from '../../api/client';
```

### 2. FloorPlanPanel.jsx — Add store selector

Add inside the component, near other store selectors:

```jsx
const removePolygonFromFloor = useStore((s) => s.removePolygonFromFloor);
```

### 3. FloorPlanPanel.jsx — Add Delete key handler

Insert inside the component, after the P-key handler `useEffect`:

```jsx
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
```

### 4. useStore.js — removePolygonFromFloor (already present)

```js
removePolygonFromFloor: (floorId, ifcGuid) => {
  const prev = get().floorPolygons;
  const updated = { ...prev, [floorId]: (prev[floorId] || []).filter((p) => p.ifc_guid !== ifcGuid) };
  savePolygonsToStorage(updated);
  set({ floorPolygons: updated });
},
```

### Notes

- Select a polygon first (click it in 2D floor plan or 3D viewer), then press **Delete**.
- Confirmation dialog shows the polygon name before deleting.
- Removes from localStorage, store, and sends DELETE to backend.
- Backend DELETE endpoint is currently disabled (returns 403) — polygon is only removed locally.
  To enable server-side deletion, update `/api/spaces/{ifc_guid}/polygon` DELETE route in `polygons.py`.

---
