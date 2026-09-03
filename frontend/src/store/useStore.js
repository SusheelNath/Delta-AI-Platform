import { create } from 'zustand';

const POLYGONS_KEY = 'delta_floorPolygons';

function loadPolygonsFromStorage() {
  try {
    const raw = localStorage.getItem(POLYGONS_KEY);
    if (!raw) return {};
    const data = JSON.parse(raw);
    // Keep only h020-prefixed polygons for H020 (purge stale IFC-guid ones)
    if (data.H020 && Array.isArray(data.H020)) {
      const clean = data.H020.filter((p) => p.ifc_guid?.startsWith('h020-'));
      if (clean.length !== data.H020.length) {
        data.H020 = clean.length > 0 ? clean : undefined;
        if (!data.H020) delete data.H020;
        localStorage.setItem(POLYGONS_KEY, JSON.stringify(data));
      }
    }
    return data;
  } catch { return {}; }
}

function savePolygonsToStorage(floorPolygons) {
  try {
    localStorage.setItem(POLYGONS_KEY, JSON.stringify(floorPolygons));
  } catch (err) {
    console.warn('[Delta] Failed to save polygons to localStorage:', err);
  }
}

const useStore = create((set, get) => ({
  // Floor state
  floors: [],
  activeFloorId: null,
  floorVisibility: {},

  // Selection
  selectedSpaceId: null,
  selectedSpace: null,

  // Drawer
  drawerOpen: false,

  // Viewer
  viewerReady: false,

  // Floor plan geometry (populated after model load)
  floorSpaceGeometry: {},   // { [floorId]: [{ id, x, z, w, d, name, categoryIndex }, ...] }

  // Function filters (all active by default)
  activeFunctionFilters: { 0: true, 1: true, 2: true, 3: true, 4: true, 5: true, 6: true },

  // Panel state
  panelExpanded: false,
  panelMode: 'list',          // 'list' | 'plan'
  searchQuery: '',
  heatmapMode: 'function',    // 'function' | 'area_per_bed' | 'utilization' | 'status' | 'area'
  compareMode: false,
  compareFloorId: null,
  mepVisible: false,

  // StoreyViewsPlugin data
  storeyMaps: {},             // { [floorId]: StoreyMap }
  floorToStoreyId: {},        // { [floorId]: ifcStoreyGuid }
  storeyPluginRef: null,

  // Floor plan snapshots (canvas captures from 3D viewer)
  floorSnapshots: {},         // { [floorId]: { imageUrl, spacePositions } }
  floorTransitioning: false,  // true while camera is flying to a new floor

  // Polygon mapping mode
  mappingMode: false,
  floorPolygons: loadPolygonsFromStorage(),  // persisted to localStorage
  pendingPolygonVertices: [],     // [[leftPct, topPct], ...]
  matchCandidateList: [],         // [{ id, name, leftPct, topPct, distance, inside }, ...]
  matchCandidateIndex: 0,
  hoveredPolygonGuid: null,

  // Polygon editing (double-click to relabel)
  editingPolygon: null,  // { ifc_guid, floor_id } or null

  // Routing navigation
  activeRoute: null,  // { type: 'elevator'|'staircase', path: [...], targetGuid, centroids: [[x,y],...], distanceM }

  // Chat
  messages: [],
  isGenerating: false,

  // ── Actions ──

  setFloors: (floors) => {
    const visibility = {};
    floors.forEach((f) => {
      visibility[f.id] = true;
    });
    set({ floors, floorVisibility: visibility });
  },

  setActiveFloor: (floorId) => {
    // Solo mode: show only this floor
    const { floors } = get();
    const visibility = {};
    floors.forEach((f) => {
      visibility[f.id] = f.id === floorId;
    });
    set({ activeFloorId: floorId, floorVisibility: visibility });
  },

  toggleFloorVisibility: (floorId) => {
    const { floorVisibility } = get();
    set({
      floorVisibility: {
        ...floorVisibility,
        [floorId]: !floorVisibility[floorId],
      },
    });
  },

  showAllFloors: () => {
    const { floors } = get();
    const visibility = {};
    floors.forEach((f) => {
      visibility[f.id] = true;
    });
    set({ activeFloorId: null, floorVisibility: visibility });
  },

  selectSpace: (spaceId, spaceData) => {
    set({ selectedSpaceId: spaceId, selectedSpace: spaceData, activeRoute: null });
  },

  clearSelection: () => {
    set({ selectedSpaceId: null, selectedSpace: null, drawerOpen: false, activeRoute: null });
  },

  toggleDrawer: () => set((s) => ({ drawerOpen: !s.drawerOpen })),
  setDrawerOpen: (open) => set({ drawerOpen: open }),

  setViewerReady: (ready) => {
    set({ viewerReady: ready });
  },

  setFloorSpaceGeometry: (floorId, spaces) => {
    set((state) => ({
      floorSpaceGeometry: { ...state.floorSpaceGeometry, [floorId]: spaces },
    }));
  },

  toggleFunctionFilter: (categoryIndex) => {
    set((state) => ({
      activeFunctionFilters: {
        ...state.activeFunctionFilters,
        [categoryIndex]: !state.activeFunctionFilters[categoryIndex],
      },
    }));
  },

  setAllFunctionFilters: (active) => {
    set({ activeFunctionFilters: { 0: active, 1: active, 2: active, 3: active, 4: active, 5: active, 6: active } });
  },

  togglePanelExpanded: () => set((s) => ({ panelExpanded: !s.panelExpanded })),
  setPanelMode: (mode) => set({ panelMode: mode }),
  setSearchQuery: (query) => set({ searchQuery: query }),
  setHeatmapMode: (mode) => set({ heatmapMode: mode }),
  toggleMepVisible: () => set((s) => ({ mepVisible: !s.mepVisible })),
  toggleCompareMode: () => set((s) => ({ compareMode: !s.compareMode, compareFloorId: null })),
  setCompareFloorId: (id) => set({ compareFloorId: id }),
  setStoreyMap: (floorId, map) => set((s) => ({ storeyMaps: { ...s.storeyMaps, [floorId]: map } })),
  setFloorToStoreyId: (mapping) => set({ floorToStoreyId: mapping }),
  setStoreyPluginRef: (ref) => set({ storeyPluginRef: ref }),
  setFloorTransitioning: (v) => set({ floorTransitioning: v }),
  setFloorSnapshot: (floorId, snapshot) => set((s) => ({
    floorSnapshots: { ...s.floorSnapshots, [floorId]: { ...(s.floorSnapshots[floorId] || {}), ...snapshot } },
  })),

  // ── Polygon mapping actions ──

  toggleMappingMode: () => set((s) => ({
    mappingMode: !s.mappingMode,
    pendingPolygonVertices: [],
    matchCandidateList: [],
    matchCandidateIndex: 0,
  })),

  setFloorPolygons: (floorId, polygons) => {
    const updated = { ...get().floorPolygons, [floorId]: polygons };
    savePolygonsToStorage(updated);
    set({ floorPolygons: updated });
  },

  addPolygonToFloor: (floorId, polygon) => {
    const prev = get().floorPolygons;
    // Replace existing polygon with same GUID, or append if new
    const existing = (prev[floorId] || []).filter((p) => p.ifc_guid !== polygon.ifc_guid);
    const updated = { ...prev, [floorId]: [...existing, polygon] };
    savePolygonsToStorage(updated);
    set({ floorPolygons: updated });
  },

  removePolygonFromFloor: (floorId, ifcGuid) => {
    const prev = get().floorPolygons;
    const updated = { ...prev, [floorId]: (prev[floorId] || []).filter((p) => p.ifc_guid !== ifcGuid) };
    savePolygonsToStorage(updated);
    set({ floorPolygons: updated });
  },

  setPendingPolygonVertices: (verts) => set({ pendingPolygonVertices: verts }),

  addPendingVertex: (vertex) => set((s) => ({
    pendingPolygonVertices: [...s.pendingPolygonVertices, vertex],
  })),

  undoPendingVertex: () => set((s) => ({
    pendingPolygonVertices: s.pendingPolygonVertices.slice(0, -1),
  })),

  clearPendingPolygon: () => set({
    pendingPolygonVertices: [],
    matchCandidateList: [],
    matchCandidateIndex: 0,
  }),

  setMatchCandidates: (list) => set({
    matchCandidateList: list,
    matchCandidateIndex: 0,
  }),

  nextMatchCandidate: () => set((s) => ({
    matchCandidateIndex: Math.min(s.matchCandidateIndex + 1, s.matchCandidateList.length - 1),
  })),

  clearMatchCandidates: () => set({
    matchCandidateList: [],
    matchCandidateIndex: 0,
  }),

  setHoveredPolygonGuid: (guid) => set({ hoveredPolygonGuid: guid }),

  setEditingPolygon: (poly) => set({ editingPolygon: poly }),

  setActiveRoute: (route) => set({ activeRoute: route }),
  clearActiveRoute: () => set({ activeRoute: null }),

  updatePolygonInFloor: (floorId, ifcGuid, updates) => {
    const prev = get().floorPolygons;
    const floor = (prev[floorId] || []).map((p) =>
      p.ifc_guid === ifcGuid ? { ...p, ...updates, edited: true } : p
    );
    const updated = { ...prev, [floorId]: floor };
    savePolygonsToStorage(updated);
    set({ floorPolygons: updated });
  },

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

  addMessage: (message) => {
    set((state) => ({
      messages: [...state.messages, message],
    }));
  },

  setGenerating: (v) => set({ isGenerating: v }),

  appendToLastMessage: (token) => {
    set((state) => {
      const msgs = [...state.messages];
      const last = msgs[msgs.length - 1];
      if (last && last.role === 'delta') {
        msgs[msgs.length - 1] = { ...last, text: last.text + token };
      }
      return { messages: msgs };
    });
  },
}));

export default useStore;
