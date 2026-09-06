/**
 * Multi-source corridor routing with edge-disciplined navigation lines.
 *
 * 1. Finds ALL corridor entry points adjacent to the source room.
 * 2. Multi-source Dijkstra on corridor network — explores ALL reachable
 *    targets and picks the one nearest by straight-line distance from source.
 * 3. Navigation line traces polygon boundaries (edge-to-edge) instead of
 *    cutting through polygon interiors.
 * 4. Fallback: full-adjacency Dijkstra if corridor routing finds nothing.
 *
 * Coordinates are in percentage space (0–100).
 */

const ADJACENCY_THRESHOLD = 2.0;

/** Walkable circulation spaces. */
const CORRIDOR_RE = /corridor|circulation|hallway|passage|lobby|entrance|reception|vestibule|basement|atrium|main hall|ramp/i;

/** Vertical transport infrastructure. */
const INFRA_RE = /elevator|staircase|stairway|stair|lift/i;

/** Target matchers. */
const ELEVATOR_TARGET_RE = /elevator|lift/i;
const STAIRCASE_TARGET_RE = /stair/i;

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

export function centroid(vertices) {
  let cx = 0, cy = 0;
  for (const [x, y] of vertices) { cx += x; cy += y; }
  return [cx / vertices.length, cy / vertices.length];
}

export function bbox(vertices) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of vertices) {
    if (x < minX) minX = x; if (y < minY) minY = y;
    if (x > maxX) maxX = x; if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

export function bboxGap(b1, b2) {
  const gapX = Math.max(0, b1.minX - b2.maxX, b2.minX - b1.maxX);
  const gapY = Math.max(0, b1.minY - b2.maxY, b2.minY - b1.maxY);
  return Math.sqrt(gapX * gapX + gapY * gapY);
}

export function polygonAreaPct(vertices) {
  const n = vertices.length;
  if (n < 3) return 0;
  let area = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += vertices[i][0] * vertices[j][1];
    area -= vertices[j][0] * vertices[i][1];
  }
  return Math.abs(area) / 2;
}

export function computeScaleFactor(polygons) {
  const factors = [];
  for (const p of polygons) {
    if (p.area_m2 && p.area_m2 > 0 && p.vertices && p.vertices.length >= 3) {
      const areaPct = polygonAreaPct(p.vertices);
      if (areaPct > 0) factors.push(Math.sqrt(p.area_m2 / areaPct));
    }
  }
  if (factors.length === 0) return 1;
  factors.sort((a, b) => a - b);
  const mid = Math.floor(factors.length / 2);
  return factors.length % 2 === 0
    ? (factors[mid - 1] + factors[mid]) / 2
    : factors[mid];
}

// ---------------------------------------------------------------------------
// Edge-disciplined path line helpers
// ---------------------------------------------------------------------------

/** Squared distance from point p to segment a–b. */
function ptSegDistSq(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return (p[0] - a[0]) ** 2 + (p[1] - a[1]) ** 2;
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = a[0] + t * dx, cy = a[1] + t * dy;
  return (p[0] - cx) ** 2 + (p[1] - cy) ** 2;
}

/** Find bridge point — midpoint of the closest pair of edge midpoints. */
function findBridgePoint(vertsA, vertsB) {
  let bestDist = Infinity, bestPt = null;
  const edgeMids = (verts) => {
    const mids = [];
    for (let i = 0; i < verts.length; i++) {
      const j = (i + 1) % verts.length;
      mids.push([(verts[i][0] + verts[j][0]) / 2, (verts[i][1] + verts[j][1]) / 2]);
    }
    return mids;
  };
  const midsA = edgeMids(vertsA), midsB = edgeMids(vertsB);
  for (const ma of midsA) {
    for (const mb of midsB) {
      const d = (ma[0] - mb[0]) ** 2 + (ma[1] - mb[1]) ** 2;
      if (d < bestDist) { bestDist = d; bestPt = [(ma[0] + mb[0]) / 2, (ma[1] + mb[1]) / 2]; }
    }
  }
  return bestPt;
}

/**
 * Trace the shorter boundary arc of a polygon from entryPt to exitPt.
 * Returns intermediate vertex coordinates (excluding the bridge points
 * themselves) that the line should pass through.
 */
function traceBoundary(vertices, entryPt, exitPt) {
  const n = vertices.length;
  if (n < 3) return [];

  // Find which edge each bridge point lies on
  const findEdge = (pt) => {
    let best = Infinity, idx = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const d = ptSegDistSq(pt, vertices[i], vertices[j]);
      if (d < best) { best = d; idx = i; }
    }
    return idx;
  };

  const entryEdge = findEdge(entryPt);
  const exitEdge = findEdge(exitPt);

  if (entryEdge === exitEdge) return []; // same edge — direct line

  // CW: collect vertices from end-of-entry-edge to start-of-exit-edge
  const cw = [];
  let i = (entryEdge + 1) % n;
  for (let safety = 0; safety <= n; safety++) {
    if (i === (exitEdge + 1) % n) break;
    cw.push(vertices[i]);
    i = (i + 1) % n;
  }

  // CCW: collect vertices from start-of-entry-edge back to end-of-exit-edge
  const ccw = [];
  i = entryEdge;
  for (let safety = 0; safety <= n; safety++) {
    if (i === exitEdge) break;
    ccw.push(vertices[i]);
    i = (i - 1 + n) % n;
  }

  // Pick the shorter arc
  const arcLen = (pts) => {
    if (pts.length === 0) return 0;
    let len = 0, prev = entryPt;
    for (const p of pts) {
      len += Math.sqrt((p[0] - prev[0]) ** 2 + (p[1] - prev[1]) ** 2);
      prev = p;
    }
    len += Math.sqrt((exitPt[0] - prev[0]) ** 2 + (exitPt[1] - prev[1]) ** 2);
    return len;
  };

  return arcLen(cw) <= arcLen(ccw) ? cw : ccw;
}

/**
 * Build the navigation path line with edge discipline.
 * - Source & destination: centroid → bridge (direct)
 * - Intermediate polygons: bridge_in → boundary trace → bridge_out
 */
function computePathLine(path, centroidMap) {
  if (path.length === 0) return [];
  if (path.length === 1) return [centroidMap.get(path[0].ifc_guid)];

  // Pre-compute all bridge points
  const bridges = [];
  for (let i = 0; i < path.length - 1; i++) {
    bridges.push(findBridgePoint(path[i].vertices, path[i + 1].vertices));
  }

  if (path.length === 2) {
    const pts = [centroidMap.get(path[0].ifc_guid)];
    if (bridges[0]) pts.push(bridges[0]);
    pts.push(centroidMap.get(path[1].ifc_guid));
    return pts;
  }

  // Source: centroid → first bridge
  const points = [centroidMap.get(path[0].ifc_guid)];
  if (bridges[0]) points.push(bridges[0]);

  // Intermediate polygons: trace boundary from entry bridge to exit bridge
  for (let i = 1; i < path.length - 1; i++) {
    const entryBridge = bridges[i - 1];
    const exitBridge = bridges[i];
    if (entryBridge && exitBridge) {
      const edgePts = traceBoundary(path[i].vertices, entryBridge, exitBridge);
      for (const ep of edgePts) points.push(ep);
    }
    if (bridges[i]) points.push(bridges[i]);
  }

  // Destination: last bridge → centroid
  points.push(centroidMap.get(path[path.length - 1].ifc_guid));

  return points;
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

function isCorridor(poly) {
  return CORRIDOR_RE.test(poly?.primary_function || '');
}

function isInfrastructure(poly) {
  return INFRA_RE.test(poly?.primary_function || '');
}

function isElevatorTarget(poly) {
  return ELEVATOR_TARGET_RE.test(poly?.primary_function || '');
}

function isStaircaseTarget(poly) {
  return STAIRCASE_TARGET_RE.test(poly?.primary_function || '');
}

// ---------------------------------------------------------------------------
// Adjacency builders
// ---------------------------------------------------------------------------

function buildFullAdjacency(polygons) {
  const n = polygons.length;
  const boxes = polygons.map((p) => bbox(p.vertices));
  const adj = new Map();
  for (const p of polygons) adj.set(p.ifc_guid, []);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (bboxGap(boxes[i], boxes[j]) <= ADJACENCY_THRESHOLD) {
        adj.get(polygons[i].ifc_guid).push(polygons[j].ifc_guid);
        adj.get(polygons[j].ifc_guid).push(polygons[i].ifc_guid);
      }
    }
  }
  return adj;
}

function buildCorridorNetworkAdjacency(polygons) {
  const n = polygons.length;
  const boxes = polygons.map((p) => bbox(p.vertices));
  const adj = new Map();
  for (const p of polygons) adj.set(p.ifc_guid, []);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (bboxGap(boxes[i], boxes[j]) > ADJACENCY_THRESHOLD) continue;
      const pi = polygons[i], pj = polygons[j];
      const iOk = isCorridor(pi) || isInfrastructure(pi);
      const jOk = isCorridor(pj) || isInfrastructure(pj);
      if (iOk && jOk) {
        adj.get(pi.ifc_guid).push(pj.ifc_guid);
        adj.get(pj.ifc_guid).push(pi.ifc_guid);
      }
    }
  }
  return adj;
}

// ---------------------------------------------------------------------------
// Dijkstra: source → nearest corridor (full adjacency)
// Used when no corridors are directly adjacent to the source room.
// ---------------------------------------------------------------------------

function dijkstraToCorridor(fullAdj, byGuid, centroidMap, startGuid) {
  const dist = new Map();
  const parent = new Map();
  const visited = new Set();
  const pq = [{ guid: startGuid, cost: 0 }];
  dist.set(startGuid, 0);

  while (pq.length > 0) {
    let minIdx = 0;
    for (let i = 1; i < pq.length; i++) {
      if (pq[i].cost < pq[minIdx].cost) minIdx = i;
    }
    const { guid: current, cost: currentCost } = pq.splice(minIdx, 1)[0];
    if (visited.has(current)) continue;
    visited.add(current);

    if (current !== startGuid && isCorridor(byGuid.get(current))) {
      const path = [];
      let node = current;
      while (node !== undefined) { path.unshift(byGuid.get(node)); node = parent.get(node); }
      return { corridorGuid: current, pathToCorr: path, cost: currentCost };
    }

    const [cx1, cy1] = centroidMap.get(current);
    for (const neighbor of (fullAdj.get(current) || [])) {
      if (visited.has(neighbor)) continue;
      const [cx2, cy2] = centroidMap.get(neighbor);
      const d = Math.sqrt((cx2 - cx1) ** 2 + (cy2 - cy1) ** 2);
      const newCost = currentCost + d;
      if (!dist.has(neighbor) || newCost < dist.get(neighbor)) {
        dist.set(neighbor, newCost);
        parent.set(neighbor, current);
        pq.push({ guid: neighbor, cost: newCost });
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Multi-source corridor Dijkstra
// Explores the ENTIRE corridor network from all entry corridors, then picks
// the target nearest by straight-line distance from the source.
// ---------------------------------------------------------------------------

function findRouteViaCorridors(fullAdj, corrAdj, byGuid, centroidMap, startGuid, isTargetFn) {
  const startPoly = byGuid.get(startGuid);
  const startCentroid = centroidMap.get(startGuid);

  if (isTargetFn(startPoly)) return null;

  // ---- Step 1: collect ALL corridor entry points from source ----
  const entries = new Map();

  if (isCorridor(startPoly)) {
    entries.set(startGuid, { pathToCorr: [startPoly], cost: 0 });
  } else {
    for (const ng of (fullAdj.get(startGuid) || [])) {
      if (isCorridor(byGuid.get(ng))) {
        const c1 = centroidMap.get(startGuid);
        const c2 = centroidMap.get(ng);
        const d = Math.sqrt((c2[0] - c1[0]) ** 2 + (c2[1] - c1[1]) ** 2);
        entries.set(ng, { pathToCorr: [startPoly, byGuid.get(ng)], cost: d });
      }
    }
    if (entries.size === 0) {
      const result = dijkstraToCorridor(fullAdj, byGuid, centroidMap, startGuid);
      if (result) {
        entries.set(result.corridorGuid, {
          pathToCorr: result.pathToCorr,
          cost: result.cost,
        });
      }
    }
  }

  if (entries.size === 0) return null;

  // ---- Step 2: run full Dijkstra on corridor network (no early stop) ----
  const dist = new Map();
  const parent = new Map();
  const visited = new Set();
  const pq = [];

  for (const [guid, entry] of entries) {
    dist.set(guid, entry.cost);
    pq.push({ guid, cost: entry.cost });
  }

  while (pq.length > 0) {
    let minIdx = 0;
    for (let i = 1; i < pq.length; i++) {
      if (pq[i].cost < pq[minIdx].cost) minIdx = i;
    }
    const { guid: current, cost: currentCost } = pq.splice(minIdx, 1)[0];
    if (visited.has(current)) continue;
    visited.add(current);

    const [cx1, cy1] = centroidMap.get(current);
    for (const neighbor of (corrAdj.get(current) || [])) {
      if (visited.has(neighbor)) continue;
      const [cx2, cy2] = centroidMap.get(neighbor);
      const d = Math.sqrt((cx2 - cx1) ** 2 + (cy2 - cy1) ** 2);
      const newCost = currentCost + d;
      if (!dist.has(neighbor) || newCost < dist.get(neighbor)) {
        dist.set(neighbor, newCost);
        parent.set(neighbor, current);
        pq.push({ guid: neighbor, cost: newCost });
      }
    }
  }

  // ---- Step 3: among reachable targets, pick nearest by straight-line ----
  let bestGuid = null;
  let bestStraight = Infinity;

  for (const [guid] of byGuid) {
    if (guid === startGuid) continue;
    if (!isTargetFn(byGuid.get(guid))) continue;
    if (!visited.has(guid)) continue;
    const c = centroidMap.get(guid);
    const d = Math.sqrt((c[0] - startCentroid[0]) ** 2 + (c[1] - startCentroid[1]) ** 2);
    if (d < bestStraight) { bestStraight = d; bestGuid = guid; }
  }

  if (!bestGuid) {
    return findRouteFallback(fullAdj, byGuid, centroidMap, startGuid, isTargetFn);
  }

  // ---- Step 4: reconstruct path ----
  const corridorPath = [];
  let node = bestGuid;
  while (node !== undefined) {
    corridorPath.unshift(node);
    node = parent.get(node);
  }
  const entryGuid = corridorPath[0];
  const entry = entries.get(entryGuid);

  const merged = [...entry.pathToCorr];
  for (let i = 1; i < corridorPath.length; i++) {
    merged.push(byGuid.get(corridorPath[i]));
  }
  return { target: byGuid.get(bestGuid), path: merged };
}

// ---------------------------------------------------------------------------
// Fallback: full-adjacency Dijkstra to nearest target
// ---------------------------------------------------------------------------

function findRouteFallback(fullAdj, byGuid, centroidMap, startGuid, isTargetFn) {
  const startCentroid = centroidMap.get(startGuid);
  const dist = new Map();
  const parent = new Map();
  const visited = new Set();
  const pq = [{ guid: startGuid, cost: 0 }];
  dist.set(startGuid, 0);

  // Run full Dijkstra
  while (pq.length > 0) {
    let minIdx = 0;
    for (let i = 1; i < pq.length; i++) {
      if (pq[i].cost < pq[minIdx].cost) minIdx = i;
    }
    const { guid: current, cost: currentCost } = pq.splice(minIdx, 1)[0];
    if (visited.has(current)) continue;
    visited.add(current);

    const [cx1, cy1] = centroidMap.get(current);
    for (const neighbor of (fullAdj.get(current) || [])) {
      if (visited.has(neighbor)) continue;
      const [cx2, cy2] = centroidMap.get(neighbor);
      const d = Math.sqrt((cx2 - cx1) ** 2 + (cy2 - cy1) ** 2);
      const newCost = currentCost + d;
      if (!dist.has(neighbor) || newCost < dist.get(neighbor)) {
        dist.set(neighbor, newCost);
        parent.set(neighbor, current);
        pq.push({ guid: neighbor, cost: newCost });
      }
    }
  }

  // Pick nearest reachable target by straight-line distance
  let bestGuid = null;
  let bestDist = Infinity;
  for (const [guid] of byGuid) {
    if (guid === startGuid) continue;
    if (!isTargetFn(byGuid.get(guid))) continue;
    if (!visited.has(guid)) continue;
    const c = centroidMap.get(guid);
    const d = Math.sqrt((c[0] - startCentroid[0]) ** 2 + (c[1] - startCentroid[1]) ** 2);
    if (d < bestDist) { bestDist = d; bestGuid = guid; }
  }

  if (!bestGuid) return null;

  const path = [];
  let n = bestGuid;
  while (n !== undefined) {
    path.unshift(byGuid.get(n));
    n = parent.get(n);
  }
  return { target: byGuid.get(bestGuid), path };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export function computeRouting(polygons, startGuid) {
  if (!polygons || polygons.length === 0 || !startGuid) {
    return { toElevator: null, toStaircase: null };
  }

  const valid = polygons.filter((p) => p.vertices && p.vertices.length >= 3 && p.ifc_guid);
  if (valid.length === 0) {
    return { toElevator: null, toStaircase: null };
  }

  const byGuid = new Map();
  const centroidMap = new Map();
  for (const p of valid) {
    byGuid.set(p.ifc_guid, p);
    centroidMap.set(p.ifc_guid, centroid(p.vertices));
  }

  if (!byGuid.has(startGuid)) {
    return { toElevator: null, toStaircase: null };
  }

  const fullAdj = buildFullAdjacency(valid);
  const corrAdj = buildCorridorNetworkAdjacency(valid);
  const scaleFactor = computeScaleFactor(valid);

  function toRouteResult(result) {
    if (!result) return null;

    const { target, path } = result;
    const pathCentroids = path.map((p) => centroidMap.get(p.ifc_guid));
    const pathLine = computePathLine(path, centroidMap);

    // Distance from actual pathLine (the edge-traced walking path),
    // not centroid-to-centroid shortcuts
    let distancePct = 0;
    for (let i = 1; i < pathLine.length; i++) {
      const dx = pathLine[i][0] - pathLine[i - 1][0];
      const dy = pathLine[i][1] - pathLine[i - 1][1];
      distancePct += Math.sqrt(dx * dx + dy * dy);
    }

    const corridorIdx = [];
    for (let i = 1; i < path.length - 1; i++) {
      if (CORRIDOR_RE.test(path[i].primary_function || '')) corridorIdx.push(i);
    }

    const waypointIdx = new Set();
    if (corridorIdx.length > 0) {
      waypointIdx.add(corridorIdx[0]);
      if (corridorIdx.length > 2) waypointIdx.add(corridorIdx[Math.floor(corridorIdx.length / 2)]);
      if (corridorIdx.length > 1) waypointIdx.add(corridorIdx[corridorIdx.length - 1]);
    }
    waypointIdx.add(path.length - 1);

    const waypoints = [...waypointIdx].sort((a, b) => a - b).map((idx) => ({
      guid: path[idx].ifc_guid,
      name: path[idx].space_name || path[idx].primary_function || 'Unknown',
      centroid: pathCentroids[idx],
      isDestination: idx === path.length - 1,
    }));

    return {
      target,
      path,
      centroids: pathCentroids,
      pathLine,
      distanceM: Math.round(distancePct * scaleFactor * 10) / 10,
      waypoints,
    };
  }

  return {
    toElevator: toRouteResult(findRouteViaCorridors(fullAdj, corrAdj, byGuid, centroidMap, startGuid, isElevatorTarget)),
    toStaircase: toRouteResult(findRouteViaCorridors(fullAdj, corrAdj, byGuid, centroidMap, startGuid, isStaircaseTarget)),
  };
}
