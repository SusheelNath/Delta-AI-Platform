/**
 * Multi-source corridor routing with smooth navigation lines.
 *
 * 1. Finds ALL corridor entry points adjacent to the source room.
 * 2. Multi-source Dijkstra on corridor network — explores ALL reachable
 *    targets and picks the one nearest by straight-line distance from source.
 * 3. Navigation line: centroid-bridge waypoints → Chaikin corner cutting (×2)
 *    → centripetal Catmull-Rom spline for cusp-free smooth curves.
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
// Smooth path line helpers (Approach 5: centroid-bridge → Chaikin → centripetal CR)
// ---------------------------------------------------------------------------

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
 * Chaikin corner-cutting subdivision.
 * Each iteration replaces sharp corners with two new points at the 25% and 75%
 * positions along each segment, converging to a smooth quadratic B-spline.
 * First and last points are preserved.
 */
function chaikinCut(points) {
  if (points.length < 3) return points;
  const result = [points[0]];
  for (let i = 0; i < points.length - 1; i++) {
    const [ax, ay] = points[i];
    const [bx, by] = points[i + 1];
    result.push([ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25]);
    result.push([ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75]);
  }
  result.push(points[points.length - 1]);
  return result;
}

/**
 * Centripetal Catmull-Rom spline interpolation.
 * Parameterises by sqrt(chord length) to eliminate cusps and
 * self-intersections with unevenly spaced control points.
 *
 * @param {Array<[number,number]>} pts - control points
 * @param {number} samplesPerSeg - sample count per segment
 * @returns {Array<[number,number]>} - interpolated curve points
 */
function centripetalCR(pts, samplesPerSeg) {
  if (pts.length < 2) return pts;
  if (pts.length === 2) return pts;

  // Extend with phantom points for first/last segment tangents
  const P = [
    [2 * pts[0][0] - pts[1][0], 2 * pts[0][1] - pts[1][1]],
    ...pts,
    [2 * pts[pts.length - 1][0] - pts[pts.length - 2][0],
     2 * pts[pts.length - 1][1] - pts[pts.length - 2][1]],
  ];

  const result = [];
  for (let i = 1; i < P.length - 2; i++) {
    const p0 = P[i - 1], p1 = P[i], p2 = P[i + 1], p3 = P[i + 2];

    // Centripetal parameterisation (alpha = 0.5)
    const dist = (a, b) => Math.sqrt((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2);
    const t0 = 0;
    const t1 = t0 + Math.sqrt(dist(p0, p1) || 0.001);
    const t2 = t1 + Math.sqrt(dist(p1, p2) || 0.001);
    const t3 = t2 + Math.sqrt(dist(p2, p3) || 0.001);

    for (let s = 0; s < samplesPerSeg; s++) {
      const t = t1 + (t2 - t1) * (s / samplesPerSeg);

      const A1x = (t1 - t) / (t1 - t0) * p0[0] + (t - t0) / (t1 - t0) * p1[0];
      const A1y = (t1 - t) / (t1 - t0) * p0[1] + (t - t0) / (t1 - t0) * p1[1];
      const A2x = (t2 - t) / (t2 - t1) * p1[0] + (t - t1) / (t2 - t1) * p2[0];
      const A2y = (t2 - t) / (t2 - t1) * p1[1] + (t - t1) / (t2 - t1) * p2[1];
      const A3x = (t3 - t) / (t3 - t2) * p2[0] + (t - t2) / (t3 - t2) * p3[0];
      const A3y = (t3 - t) / (t3 - t2) * p2[1] + (t - t2) / (t3 - t2) * p3[1];

      const B1x = (t2 - t) / (t2 - t0) * A1x + (t - t0) / (t2 - t0) * A2x;
      const B1y = (t2 - t) / (t2 - t0) * A1y + (t - t0) / (t2 - t0) * A2y;
      const B2x = (t3 - t) / (t3 - t1) * A2x + (t - t1) / (t3 - t1) * A3x;
      const B2y = (t3 - t) / (t3 - t1) * A2y + (t - t1) / (t3 - t1) * A3y;

      result.push([
        (t2 - t) / (t2 - t1) * B1x + (t - t1) / (t2 - t1) * B2x,
        (t2 - t) / (t2 - t1) * B1y + (t - t1) / (t2 - t1) * B2y,
      ]);
    }
  }
  result.push(pts[pts.length - 1]);
  return result;
}

/**
 * Build smooth navigation path line.
 * Pipeline: centroid-bridge waypoints → Chaikin (×2) → centripetal Catmull-Rom
 *
 * Waypoints: source centroid → bridge₁ → bridge₂ → ... → dest centroid
 * Bridge-to-bridge keeps the path inside polygons; no corridor centroids.
 * Chaikin pre-rounds corners.
 * Centripetal CR produces a cusp-free flowing curve.
 */
function computePathLine(path, centroidMap) {
  if (path.length === 0) return [];
  if (path.length === 1) return [centroidMap.get(path[0].ifc_guid)];

  // Pre-compute bridge points between consecutive polygons
  const bridges = [];
  for (let i = 0; i < path.length - 1; i++) {
    bridges.push(findBridgePoint(path[i].vertices, path[i + 1].vertices));
  }

  // Build bridge-to-bridge waypoint sequence (centroids only at endpoints)
  const waypoints = [centroidMap.get(path[0].ifc_guid)];
  for (let i = 0; i < bridges.length; i++) {
    if (bridges[i]) waypoints.push(bridges[i]);
  }
  waypoints.push(centroidMap.get(path[path.length - 1].ifc_guid));

  // Too few points for smoothing — return raw waypoints
  if (waypoints.length < 3) return waypoints;

  // Phase 1: Chaikin corner cutting (2 iterations)
  let smoothed = waypoints;
  for (let iter = 0; iter < 2; iter++) {
    smoothed = chaikinCut(smoothed);
  }

  // Phase 2: Centripetal Catmull-Rom interpolation (8 samples per segment)
  return centripetalCR(smoothed, 8);
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
