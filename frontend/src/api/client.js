/**
 * API client for the Delta Intelligence Platform FastAPI backend.
 * All endpoints are proxied via Vite dev server (/api → localhost:8000).
 */

const BASE = '/api';

async function request(url) {
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status}: ${text}`);
  }
  return res.json();
}

/**
 * Fetch all floors.
 * GET /api/floors
 */
export async function fetchFloors() {
  return request(`${BASE}/floors`);
}

/**
 * Fetch all spaces on a given floor.
 * GET /api/floors/{floorId}/spaces
 */
export async function fetchFloorSpaces(floorId) {
  return request(`${BASE}/floors/${encodeURIComponent(floorId)}/spaces`);
}

/**
 * Fetch full detail for a single space by internal ID.
 * GET /api/spaces/{spaceId}
 */
export async function fetchSpaceDetail(spaceId) {
  return request(`${BASE}/spaces/${encodeURIComponent(spaceId)}`);
}

/**
 * Fetch a space by its IFC GlobalId (GUID).
 * GET /api/spaces/by-guid/{guid}
 */
export async function fetchSpaceByGuid(guid) {
  return request(`${BASE}/spaces/by-guid/${encodeURIComponent(guid)}`);
}

/**
 * Search spaces with optional query parameters.
 * GET /api/spaces/search?...
 * @param {Object} params - key/value pairs for query string
 */
export async function searchSpaces(params = {}) {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      qs.append(key, value);
    }
  }
  return request(`${BASE}/spaces/search?${qs.toString()}`);
}

/**
 * Save IFC object exclusion list for XKT baking.
 * POST /api/exclusions
 */
export async function saveExclusions(objectIds) {
  const res = await fetch(`${BASE}/exclusions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ object_ids: objectIds }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status}: ${text}`);
  }
  return res.json();
}

/**
 * Update a space's name and/or primary function.
 * PATCH /api/spaces/by-guid/{ifcGuid}
 */
export async function updateSpace(ifcGuid, { space_name, primary_function }) {
  const body = {};
  if (space_name !== undefined) body.space_name = space_name;
  if (primary_function !== undefined) body.primary_function = primary_function;
  const res = await fetch(`${BASE}/spaces/by-guid/${encodeURIComponent(ifcGuid)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status}: ${text}`);
  }
  return res.json();
}

/**
 * Save or update a polygon for a space.
 * PUT /api/spaces/{ifcGuid}/polygon
 */
export async function savePolygon(ifcGuid, vertices, floorId, computedAreaM2 = null, computedPerimeterCm = null, spaceName = null, primaryFunction = null) {
  const payload = { vertices, floor_id: floorId };
  if (computedAreaM2 != null) payload.computed_area_m2 = computedAreaM2;
  if (computedPerimeterCm != null) payload.computed_perimeter_cm = computedPerimeterCm;
  if (spaceName) payload.space_name = spaceName;
  if (primaryFunction) payload.primary_function = primaryFunction;
  const res = await fetch(`${BASE}/spaces/${encodeURIComponent(ifcGuid)}/polygon`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status}: ${text}`);
  }
  return res.json();
}

/**
 * Fetch all saved polygons for a floor.
 * GET /api/floors/{floorId}/polygons
 */
export async function fetchFloorPolygons(floorId) {
  return request(`${BASE}/floors/${encodeURIComponent(floorId)}/polygons`);
}

/**
 * Bulk sync localStorage polygons to server (push any the server doesn't have).
 * POST /api/polygons/sync
 */
export async function syncPolygons(polygons) {
  const res = await fetch(`${BASE}/polygons/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(polygons),
  });
  if (!res.ok) return null;
  return res.json();
}

/**
 * Delete a saved polygon for a space.
 * DELETE /api/spaces/{ifcGuid}/polygon
 */
export async function deletePolygon(ifcGuid) {
  const res = await fetch(`${BASE}/spaces/${encodeURIComponent(ifcGuid)}/polygon`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status}: ${text}`);
  }
  return res.json();
}

/**
 * Stream a chat response from Delta AI (Ollama backend).
 * Returns a ReadableStream reader; the caller consumes SSE tokens.
 *
 * @param {Array<{role:string, text:string}>} messages  - conversation history
 * @param {string|null} selectedSpaceId - currently selected space ID (or null)
 * @param {AbortSignal} [signal] - optional abort signal
 * @returns {Promise<ReadableStreamDefaultReader>}
 */
export async function streamChat(messages, selectedSpaceId, signal) {
  const res = await fetch(`${BASE}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: messages.map((m) => ({ role: m.role, text: m.text })),
      selected_space_id: selectedSpaceId || null,
    }),
    signal,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Chat API ${res.status}: ${text}`);
  }
  return res.body.getReader();
}
