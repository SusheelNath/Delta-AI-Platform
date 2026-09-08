import { create } from 'zustand';
import { getAllSessions, getSession, putSession, deleteSession as dbDeleteSession } from '../utils/sessionDB';

const POLYGONS_KEY = 'delta_floorPolygons';

// Metric keys are server-computed (from space_metrics DB) and must never
// be cached in localStorage — the server fetch + merge always provides them.
const SERVER_METRIC_KEYS = ['normal_occupancy', 'max_occupancy', 'absolute_occupancy',
  'occupiable', 'used_area_m2', 'free_area_m2', 'furnishing_source'];

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
      }
    }
    // Keep only h040-prefixed polygons for H040 (purge BIM-imported ones)
    if (data.H040 && Array.isArray(data.H040)) {
      const clean = data.H040.filter((p) => p.ifc_guid?.startsWith('h040-'));
      if (clean.length !== data.H040.length) {
        data.H040 = clean.length > 0 ? clean : undefined;
        if (!data.H040) delete data.H040;
      }
    }
    // H050 (rooftop) has no polygons — purge any cached ones
    delete data.H050;
    // Strip cached metric values — these are always server-authoritative
    for (const floorId of Object.keys(data)) {
      if (!Array.isArray(data[floorId])) continue;
      for (const p of data[floorId]) {
        for (const k of SERVER_METRIC_KEYS) delete p[k];
      }
    }
    localStorage.setItem(POLYGONS_KEY, JSON.stringify(data));
    return data;
  } catch { return {}; }
}

let _saveTimer = null;
function savePolygonsToStorage(floorPolygons) {
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(POLYGONS_KEY, JSON.stringify(floorPolygons));
    } catch (err) {
      console.warn('[Delta] Failed to save polygons to localStorage:', err);
    }
  }, 1000);
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

  // App-level loading
  appReady: false,
  dataReady: false,
  loadProgress: 0,
  loadStage: 'Initialising...',

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

  // Session history
  activeSessionId: null,
  sessionList: [],        // [{ id, title, created, updated, messageCount, preview }] — no messages (lightweight)
  sessionHistoryOpen: false,

  // Voice (STT / TTS)
  voiceActive: false,
  voiceState: 'idle', // 'idle' | 'greeting' | 'listening' | 'acknowledging' | 'processing' | 'announcing'

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

  setAppReady: (v) => set({ appReady: v }),
  setDataReady: (v) => set({ dataReady: v }),
  setLoadProgress: (p) => set((s) => ({ loadProgress: Math.max(s.loadProgress, p) })),
  setLoadStage: (stage) => set({ loadStage: stage }),

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

  // AI-controllable UI state
  directoryExpandGroup: null,      // function name to expand in RoomDirectory
  directorySelectIndex: null,      // index of room to select within expanded group
  routingPanelOpen: false,         // whether SpaceToolkit routing section is open

  expandDirectoryGroup: (functionName) => set({ directoryExpandGroup: functionName, directorySelectIndex: null }),
  selectRoomInGroup: (functionName, index) => set({ directoryExpandGroup: functionName, directorySelectIndex: index }),
  clearDirectoryAction: () => set({ directoryExpandGroup: null, directorySelectIndex: null }),
  setRoutingPanelOpen: (open) => set({ routingPanelOpen: open }),

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

  setVoiceActive: (v) => set({ voiceActive: v, voiceState: v ? 'greeting' : 'idle' }),
  setVoiceState: (s) => set({ voiceState: s }),

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

  // ── Session history actions ──

  setSessionHistoryOpen: (open) => set({ sessionHistoryOpen: open }),

  /** Load session list from IndexedDB on app start (lightweight — no message bodies). */
  loadSessionList: async () => {
    try {
      const all = await getAllSessions();
      const lightweight = all.map(({ id, title, created, updated, messageCount, preview }) => ({
        id, title, created, updated, messageCount, preview,
      }));
      set({ sessionList: lightweight });
    } catch (e) {
      console.warn('[Sessions] Failed to load list:', e);
    }
  },

  /** Save current messages as a session (create or update). */
  saveCurrentSession: async () => {
    const { messages, activeSessionId } = get();
    // Don't save empty or welcome-only sessions
    if (messages.length === 0) return;
    const hasUserMessage = messages.some((m) => m.role === 'user');
    if (!hasUserMessage) return;

    const now = new Date().toISOString();
    const id = activeSessionId || `s_${Date.now()}`;

    // Extract title from first Delta response ### heading
    let title = '';
    const firstDelta = messages.find((m) => m.role === 'delta' && m.text.trim());
    if (firstDelta) {
      const headingMatch = firstDelta.text.match(/^###\s*(.+)/m);
      if (headingMatch) {
        title = headingMatch[1].replace(/\*\*/g, '').trim().slice(0, 60);
      }
    }
    // Fallback: first user message
    if (!title) {
      const firstUser = messages.find((m) => m.role === 'user');
      if (firstUser) title = firstUser.text.slice(0, 50);
    }
    if (!title) title = 'Untitled Chat';

    // Preview: last Delta message snippet
    const lastDelta = [...messages].reverse().find((m) => m.role === 'delta' && m.text.trim());
    const preview = lastDelta ? lastDelta.text.replace(/[#*\n]/g, ' ').trim().slice(0, 80) : '';

    const session = {
      id,
      title,
      created: activeSessionId ? undefined : now,  // preserve original created
      updated: now,
      messageCount: messages.length,
      preview,
      messages,
    };

    // If updating, preserve created date
    if (activeSessionId) {
      const existing = get().sessionList.find((s) => s.id === activeSessionId);
      if (existing) session.created = existing.created;
    }
    if (!session.created) session.created = now;

    try {
      await putSession(session);
      set({ activeSessionId: id });
      // Refresh lightweight list
      const all = await getAllSessions();
      const lightweight = all.map(({ id: sid, title: t, created: c, updated: u, messageCount: mc, preview: p }) => ({
        id: sid, title: t, created: c, updated: u, messageCount: mc, preview: p,
      }));
      set({ sessionList: lightweight });
    } catch (e) {
      console.warn('[Sessions] Failed to save:', e);
    }
  },

  /** Load a session's full messages into the chat. */
  loadSession: async (sessionId) => {
    try {
      const session = await getSession(sessionId);
      if (!session) return;
      set({
        messages: session.messages || [],
        activeSessionId: session.id,
        sessionHistoryOpen: false,
      });
    } catch (e) {
      console.warn('[Sessions] Failed to load session:', e);
    }
  },

  /** Start a new empty chat, saving current session first if needed. */
  newChat: async () => {
    const { messages, saveCurrentSession } = get();
    if (messages.length > 0) {
      await saveCurrentSession();
    }
    set({
      messages: [],
      activeSessionId: null,
      sessionHistoryOpen: false,
    });
  },

  /** Delete a session from IndexedDB and refresh list. */
  removeSession: async (sessionId) => {
    try {
      await dbDeleteSession(sessionId);
      const { activeSessionId } = get();
      if (activeSessionId === sessionId) {
        set({ messages: [], activeSessionId: null });
      }
      // Refresh list
      const all = await getAllSessions();
      const lightweight = all.map(({ id, title, created, updated, messageCount, preview }) => ({
        id, title, created, updated, messageCount, preview,
      }));
      set({ sessionList: lightweight });
    } catch (e) {
      console.warn('[Sessions] Failed to delete:', e);
    }
  },
}));

export default useStore;
