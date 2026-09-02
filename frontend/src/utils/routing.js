/**
 * BFS pathfinding from a room polygon to the nearest elevator and staircase.
 *
 * Uses bounding-box adjacency (gap threshold 2.0 percentage units) to build
 * a neighbor graph, then runs BFS to find the shortest path to the closest
 * Elevator and Staircase by primary_function keyword matching.
 *
 * Coordinates are in percentage space (0-100) matching the snapshot overlay.
 */

const ADJACENCY_THRESHOLD = 2.0; // max bbox gap in percentage units

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/**
 * Compute the centroid of a polygon given its vertices.
 * @param {Array<[number, number]>} vertices - [[x, y], ...]
 * @returns {[number, number]} [cx, cy]
 */
export function centroid(vertices) {
  let cx = 0;
  let cy = 0;
  for (const [x, y] of vertices) {
    cx += x;
    cy += y;
  }
  const n = vertices.length;
  return [cx / n, cy / n];
}

/**
 * Compute axis-aligned bounding box of a polygon.
 * @param {Array<[number, number]>} vertices
 * @returns {{ minX: number, minY: number, maxX: number, maxY: number }}
 */
export function bbox(vertices) {
  let minX = Infinity, minY = Infinity;
  let maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of vertices) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Compute the gap between two axis-aligned bounding boxes.
 * Returns 0 if the boxes overlap or touch.
 * @param {{ minX: number, minY: number, maxX: number, maxY: number }} b1
 * @param {{ minX: number, minY: number, maxX: number, maxY: number }} b2
 * @returns {number} distance (>= 0)
 */
export function bboxGap(b1, b2) {
  const gapX = Math.max(0, b1.minX - b2.maxX, b2.minX - b1.maxX);
  const gapY = Math.max(0, b1.minY - b2.maxY, b2.minY - b1.maxY);
  return Math.sqrt(gapX * gapX + gapY * gapY);
}

/**
 * Compute the area of a polygon in percentage-coordinate space using the
 * Shoelace formula. Returns the absolute area.
 * @param {Array<[number, number]>} vertices
 * @returns {number} area in (percentage units)^2
 */
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

/**
 * Derive a scale factor (meters per percentage unit) from polygons that have
 * both a known real-world area (area_m2) and vertices.
 *
 * For each qualifying polygon:
 *   area_m2 = areaPct * (scaleFactor)^2
 *   => scaleFactor = sqrt(area_m2 / areaPct)
 *
 * Returns the median scale factor across all qualifying polygons for
 * robustness against outliers.
 *
 * @param {Array<Object>} polygons - polygon objects with optional area_m2 and vertices
 * @returns {number} meters per percentage unit (defaults to 1 if no data)
 */
export function computeScaleFactor(polygons) {
  const factors = [];
  for (const p of polygons) {
    if (p.area_m2 && p.area_m2 > 0 && p.vertices && p.vertices.length >= 3) {
      const areaPct = polygonAreaPct(p.vertices);
      if (areaPct > 0) {
        factors.push(Math.sqrt(p.area_m2 / areaPct));
      }
    }
  }
  if (factors.length === 0) return 1;

  // Return the median
  factors.sort((a, b) => a - b);
  const mid = Math.floor(factors.length / 2);
  return factors.length % 2 === 0
    ? (factors[mid - 1] + factors[mid]) / 2
    : factors[mid];
}

// ---------------------------------------------------------------------------
// BFS pathfinding
// ---------------------------------------------------------------------------

/**
 * Build an adjacency list from polygons using bounding-box gap.
 * Two polygons are neighbors if their bbox gap <= ADJACENCY_THRESHOLD.
 * @param {Array<Object>} polygons
 * @returns {Map<string, string[]>} guid -> [neighbor guids]
 */
function buildAdjacency(polygons) {
  const n = polygons.length;
  const boxes = polygons.map((p) => bbox(p.vertices));
  const adj = new Map();

  for (const p of polygons) {
    adj.set(p.ifc_guid, []);
  }

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const gap = bboxGap(boxes[i], boxes[j]);
      if (gap <= ADJACENCY_THRESHOLD) {
        adj.get(polygons[i].ifc_guid).push(polygons[j].ifc_guid);
        adj.get(polygons[j].ifc_guid).push(polygons[i].ifc_guid);
      }
    }
  }

  return adj;
}

/**
 * Run BFS from startGuid and return the shortest path to the nearest polygon
 * whose primary_function matches the given keyword (case-insensitive).
 *
 * @param {Map<string, string[]>} adj - adjacency list
 * @param {Map<string, Object>} byGuid - guid -> polygon lookup
 * @param {string} startGuid
 * @param {string} keyword - e.g. 'elevator' or 'staircase'
 * @returns {{ target: Object, path: Object[] } | null}
 */
function bfsToFunction(adj, byGuid, startGuid, keyword) {
  const visited = new Set();
  const parent = new Map();
  const queue = [startGuid];
  visited.add(startGuid);

  while (queue.length > 0) {
    const current = queue.shift();
    const poly = byGuid.get(current);

    // Check if this polygon matches the target function (skip the start itself)
    if (
      current !== startGuid &&
      poly &&
      poly.primary_function &&
      poly.primary_function.toLowerCase().includes(keyword)
    ) {
      // Reconstruct path from start to current
      const path = [];
      let node = current;
      while (node !== undefined) {
        path.unshift(byGuid.get(node));
        node = parent.get(node);
      }
      return { target: poly, path };
    }

    const neighbors = adj.get(current) || [];
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        parent.set(neighbor, current);
        queue.push(neighbor);
      }
    }
  }

  return null; // no reachable target
}

// ---------------------------------------------------------------------------
// Main routing function
// ---------------------------------------------------------------------------

/**
 * Compute BFS routes from a start room to the nearest elevator and staircase.
 *
 * @param {Array<Object>} polygons - all polygon objects on the current floor,
 *   each with { ifc_guid, vertices: [[x,y],...], primary_function?, area_m2? }
 * @param {string} startGuid - ifc_guid of the starting room
 * @returns {{ toElevator: RouteResult|null, toStaircase: RouteResult|null }}
 *
 * RouteResult = {
 *   target: Object,           // destination polygon
 *   path: Object[],           // ordered array of polygon objects along the route
 *   centroids: [number,number][], // centroid coords for rendering the nav line
 *   distanceM: number         // approximate distance in meters
 * }
 */
export function computeRouting(polygons, startGuid) {
  if (!polygons || polygons.length === 0 || !startGuid) {
    return { toElevator: null, toStaircase: null };
  }

  // Filter to polygons that have vertices
  const valid = polygons.filter((p) => p.vertices && p.vertices.length >= 3 && p.ifc_guid);
  if (valid.length === 0) {
    return { toElevator: null, toStaircase: null };
  }

  // Build lookup and adjacency
  const byGuid = new Map();
  for (const p of valid) {
    byGuid.set(p.ifc_guid, p);
  }

  if (!byGuid.has(startGuid)) {
    return { toElevator: null, toStaircase: null };
  }

  const adj = buildAdjacency(valid);
  const scaleFactor = computeScaleFactor(valid);

  /**
   * Convert a BFS result into a full RouteResult with centroids and distance.
   */
  function toRouteResult(bfsResult) {
    if (!bfsResult) return null;

    const { target, path } = bfsResult;
    const centroids = path.map((p) => centroid(p.vertices));

    // Sum Euclidean distances between consecutive centroids, scaled to meters
    let distancePct = 0;
    for (let i = 1; i < centroids.length; i++) {
      const dx = centroids[i][0] - centroids[i - 1][0];
      const dy = centroids[i][1] - centroids[i - 1][1];
      distancePct += Math.sqrt(dx * dx + dy * dy);
    }

    return {
      target,
      path,
      centroids,
      distanceM: Math.round(distancePct * scaleFactor * 10) / 10,
    };
  }

  const elevatorResult = bfsToFunction(adj, byGuid, startGuid, 'elevator');
  const staircaseResult = bfsToFunction(adj, byGuid, startGuid, 'staircase');

  return {
    toElevator: toRouteResult(elevatorResult),
    toStaircase: toRouteResult(staircaseResult),
  };
}
