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

  // Pre-computed intelligence (loaded at boot from backend cache)
  floorIntelligence: {},  // { [floorId]: { [guid]: intelligenceDict } }

  // Preloaded furnishings keyed by ifc_guid (loaded at boot from backend)
  spaceFurnishings: {},  // { [ifc_guid]: [furnishingObj, ...] }

  // Polygon mapping mode
  mappingMode: false,
  floorPolygons: loadPolygonsFromStorage(),  // persisted to localStorage
  pendingPolygonVertices: [],     // [[leftPct, topPct], ...]
  matchCandidateList: [],         // [{ id, name, leftPct, topPct, distance, inside }, ...]
  matchCandidateIndex: 0,
  hoveredPolygonGuid: null,

  // Polygon editing (double-click to relabel)
  editingPolygon: null,  // { ifc_guid, floor_id } or null
  editingGeometry: null,  // { ifc_guid, floor_id, mode: 'vertex' | 'redraw', originalVertices: [...] } or null
  editingVertices: [],     // working copy of vertices during vertex-drag editing

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

  // Guide booklet
  guideBookletOpen: false,

  // Highlights (persistent glow on rooms until cleared)
  highlightedGuids: [],   // ifc_guid list to highlight on the floor plan
  repurposeGuids: [],     // ifc_guid list for repurpose candidates (blue)
  findRoomResults: null,  // Map<guid, { type, score, reason, capacity, ... }> for find_room

  // AI Learnings
  learningsPanelOpen: false,
  learnings: [],  // [{ id, learning_type, content, confidence, observation_count, last_observed }]

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

  updateSelectedSpaceMetrics: (metrics, facilitiesText) => {
    set((s) => {
      if (!s.selectedSpace) return {};
      return {
        selectedSpace: {
          ...s.selectedSpace,
          ...(metrics.used_area_m2 != null && { used_area_m2: metrics.used_area_m2 }),
          ...(metrics.free_area_m2 != null && { free_area_m2: metrics.free_area_m2 }),
          ...(metrics.normal_occupancy != null && { normal_occupancy: metrics.normal_occupancy }),
          ...(metrics.max_occupancy != null && { max_occupancy: metrics.max_occupancy }),
          ...(metrics.absolute_occupancy != null && { absolute_occupancy: metrics.absolute_occupancy }),
          ...(metrics.furnishing_source != null && { furnishing_source: metrics.furnishing_source }),
          ...(facilitiesText !== undefined && { facilities_available: facilitiesText }),
        },
      };
    });
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

  setFloorIntelligence: (floorId, intelMap) => {
    set({ floorIntelligence: { ...get().floorIntelligence, [floorId]: intelMap } });
  },

  mergeSpaceFurnishings: (furnishingsByGuid) => {
    set({ spaceFurnishings: { ...get().spaceFurnishings, ...furnishingsByGuid } });
  },

  /** Look up intelligence for a space by guid. Checks active floor first, then all. */
  getIntelligence: (guid) => {
    const state = get();
    // Fast path: check active floor
    if (state.activeFloorId) {
      const intel = (state.floorIntelligence[state.activeFloorId] || {})[guid];
      if (intel) return intel;
    }
    // Fallback: search all floors
    for (const fid of Object.keys(state.floorIntelligence)) {
      const intel = (state.floorIntelligence[fid] || {})[guid];
      if (intel) return intel;
    }
    return null;
  },

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

  // ── Geometry editing actions ──
  startGeometryEdit: (ifc_guid, floor_id, mode) => {
    const poly = (get().floorPolygons[floor_id] || []).find(p => p.ifc_guid === ifc_guid);
    if (!poly) return;
    set({
      editingGeometry: { ifc_guid, floor_id, mode, originalVertices: [...poly.vertices.map(v => [...v])] },
      editingVertices: mode === 'vertex' ? poly.vertices.map(v => [...v]) : [],
      pendingPolygonVertices: [],
    });
  },

  updateEditingVertex: (index, newPos) => set((s) => {
    const verts = [...s.editingVertices];
    verts[index] = newPos;
    return { editingVertices: verts };
  }),

  addEditingVertex: (afterIndex, pos) => set((s) => {
    const verts = [...s.editingVertices];
    verts.splice(afterIndex + 1, 0, pos);
    return { editingVertices: verts };
  }),

  removeEditingVertex: (index) => set((s) => {
    if (s.editingVertices.length <= 3) return {}; // minimum 3 vertices
    const verts = [...s.editingVertices];
    verts.splice(index, 1);
    return { editingVertices: verts };
  }),

  confirmGeometryEdit: () => {
    const state = get();
    const eg = state.editingGeometry;
    if (!eg) return;

    const newVertices = eg.mode === 'vertex'
      ? state.editingVertices
      : state.pendingPolygonVertices;

    if (newVertices.length < 3) return;

    // Update polygon vertices in store
    const prev = state.floorPolygons;
    const floor = (prev[eg.floor_id] || []).map(p =>
      p.ifc_guid === eg.ifc_guid ? { ...p, vertices: newVertices, edited: true } : p
    );
    const updated = { ...prev, [eg.floor_id]: floor };

    // Persist to localStorage
    savePolygonsToStorage(updated);

    set({
      floorPolygons: updated,
      editingGeometry: null,
      editingVertices: [],
      pendingPolygonVertices: [],
    });
  },

  cancelGeometryEdit: () => set({
    editingGeometry: null,
    editingVertices: [],
    pendingPolygonVertices: [],
  }),

  // ── 3D geometry editing actions ──
  editing3D: null, // { ifc_guid, floor_id, planeY, originalWorldVerts: [...] } or null
  editing3DVerts: [], // working copy of world vertices [[x,y,z], ...]

  startGeometryEdit3D: (ifc_guid, floor_id) => {
    const state = get();
    const poly = (state.floorPolygons[floor_id] || []).find(p => p.ifc_guid === ifc_guid);
    if (!poly || !poly.vertices || poly.vertices.length < 3) return;

    // Get the current world vertices — either stored or compute from unprojection
    const snapshot = state.floorSnapshots[floor_id];
    const geometry = state.floorSpaceGeometry || {};
    const spaces = geometry[floor_id] || [];
    const maxYTop = spaces.length > 0 ? Math.max(...spaces.map(s => s.yTop || s.y || 0)) : 0;
    const planeY = maxYTop + 0.05;

    let worldVerts = poly.worldVertices;
    if (!worldVerts && snapshot?.viewMatrix && snapshot?.projMatrix) {
      // Dynamic import not available here — store the 2D verts + plane info,
      // let XeokitViewer compute the initial world verts
      worldVerts = null;
    }

    set({
      editing3D: { ifc_guid, floor_id, planeY, originalWorldVerts: worldVerts ? worldVerts.map(v => [...v]) : null },
      editing3DVerts: worldVerts ? worldVerts.map(v => [...v]) : [],
    });
  },

  update3DVertex: (index, newX, newZ) => set((s) => {
    const verts = s.editing3DVerts.map(v => [...v]);
    if (verts[index]) {
      verts[index][0] = newX;
      // verts[index][1] stays locked (Y = floor plane)
      verts[index][2] = newZ;
    }
    return { editing3DVerts: verts };
  }),

  confirm3DEdit: () => {
    const state = get();
    const e3d = state.editing3D;
    if (!e3d || state.editing3DVerts.length < 3) return;

    const prev = state.floorPolygons;
    const floor = (prev[e3d.floor_id] || []).map(p =>
      p.ifc_guid === e3d.ifc_guid
        ? { ...p, worldVertices: state.editing3DVerts.map(v => [...v]), edited: true }
        : p
    );
    const updated = { ...prev, [e3d.floor_id]: floor };
    savePolygonsToStorage(updated);

    set({ floorPolygons: updated, editing3D: null, editing3DVerts: [] });
  },

  cancel3DEdit: () => set({ editing3D: null, editing3DVerts: [] }),

  setActiveRoute: (route) => set({ activeRoute: route }),
  clearActiveRoute: () => set({ activeRoute: null }),

  // Highlight actions
  setHighlightedGuids: (guids) => set({ highlightedGuids: guids }),
  setRepurposeGuids: (guids) => set({ repurposeGuids: guids }),
  setFindRoomResults: (results) => set({ findRoomResults: results }),
  clearHighlights: () => set({ highlightedGuids: [], repurposeGuids: [], findRoomResults: null }),

  // Universal clear — resets UI state to default (preserves chat history)
  clearAll: () => set({
    heatmapMode: 'function',
    activeFunctionFilters: { 0: true, 1: true, 2: true, 3: true, 4: true, 5: true, 6: true },
    selectedSpaceId: null,
    selectedSpace: null,
    activeRoute: null,
    highlightedGuids: [],
    repurposeGuids: [],
    findRoomResults: null,
    expandedGroups: [],
    searchQuery: '',
    drawerOpen: false,
    compareMode: false,
    compareFloorId: null,
    mepVisible: false,
  }),

  // AI-controllable UI state
  directoryExpandGroup: null,      // function name to expand in RoomDirectory
  directorySelectIndex: null,      // index of room to select within expanded group
  currentExpandedGroup: null,      // tracks which group is currently open (for "select the 4th one")
  expandedGroups: [],              // all currently expanded group names (for multi-group 3D highlighting)
  routingPanelOpen: false,         // whether SpaceToolkit routing section is open

  expandDirectoryGroup: (functionName) => set({ directoryExpandGroup: functionName, directorySelectIndex: null }),
  selectRoomInGroup: (functionName, index) => set({ directoryExpandGroup: functionName, directorySelectIndex: index }),
  clearDirectoryAction: () => set({ directoryExpandGroup: null, directorySelectIndex: null }),
  setCurrentExpandedGroup: (name) => set({ currentExpandedGroup: name }),
  setExpandedGroups: (groups) => set({ expandedGroups: groups }),
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

  // ── Learnings ──

  setGuideBookletOpen: (open) => set({ guideBookletOpen: open }),
  setLearningsPanelOpen: (open) => set({ learningsPanelOpen: open }),

  fetchLearnings: async () => {
    try {
      const { fetchLearnings: apiFetch } = await import('../api/client');
      const data = await apiFetch();
      set({ learnings: Array.isArray(data) ? data : [] });
    } catch (e) {
      console.warn('[Learnings] Failed to fetch:', e);
    }
  },

  generateLearnings: async () => {
    try {
      const { generateLearnings: apiGen } = await import('../api/client');
      const { messages, activeSessionId } = get();
      const sessionId = activeSessionId || 'default';
      const conv = messages.map((m) => ({ role: m.role, text: m.text }));
      await apiGen(sessionId, conv);
      // Refresh learnings after generation
      const { fetchLearnings: apiFetch } = await import('../api/client');
      const data = await apiFetch();
      set({ learnings: Array.isArray(data) ? data : [] });
    } catch (e) {
      console.warn('[Learnings] Failed to generate:', e);
    }
  },

  removeLearning: async (learningId) => {
    try {
      const { deleteLearning } = await import('../api/client');
      await deleteLearning(learningId);
      set((state) => ({
        learnings: state.learnings.filter((lr) => lr.id !== learningId),
      }));
    } catch (e) {
      console.warn('[Learnings] Failed to delete:', e);
    }
  },

  clearAllLearnings: async () => {
    try {
      const { clearLearnings } = await import('../api/client');
      await clearLearnings();
      set({ learnings: [] });
    } catch (e) {
      console.warn('[Learnings] Failed to clear:', e);
    }
  },
}));

export default useStore;
