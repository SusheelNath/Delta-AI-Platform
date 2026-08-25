/**
 * Unproject 2D polygon vertices (percentage coordinates on the snapshot image)
 * back to 3D world coordinates on a horizontal plane at a given Y value.
 *
 * Uses the view and projection matrices captured at snapshot time.
 */

function multiplyMatrix4(a, b) {
  const out = new Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      out[col * 4 + row] =
        a[0 * 4 + row] * b[col * 4 + 0] +
        a[1 * 4 + row] * b[col * 4 + 1] +
        a[2 * 4 + row] * b[col * 4 + 2] +
        a[3 * 4 + row] * b[col * 4 + 3];
    }
  }
  return out;
}

function invertMatrix4(m) {
  const m00 = m[0], m01 = m[1], m02 = m[2], m03 = m[3];
  const m10 = m[4], m11 = m[5], m12 = m[6], m13 = m[7];
  const m20 = m[8], m21 = m[9], m22 = m[10], m23 = m[11];
  const m30 = m[12], m31 = m[13], m32 = m[14], m33 = m[15];

  const b00 = m00 * m11 - m01 * m10;
  const b01 = m00 * m12 - m02 * m10;
  const b02 = m00 * m13 - m03 * m10;
  const b03 = m01 * m12 - m02 * m11;
  const b04 = m01 * m13 - m03 * m11;
  const b05 = m02 * m13 - m03 * m12;
  const b06 = m20 * m31 - m21 * m30;
  const b07 = m20 * m32 - m22 * m30;
  const b08 = m20 * m33 - m23 * m30;
  const b09 = m21 * m32 - m22 * m31;
  const b10 = m21 * m33 - m23 * m31;
  const b11 = m22 * m33 - m23 * m32;

  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (Math.abs(det) < 1e-8) return null;
  det = 1.0 / det;

  return [
    (m11 * b11 - m12 * b10 + m13 * b09) * det,
    (m02 * b10 - m01 * b11 - m03 * b09) * det,
    (m31 * b05 - m32 * b04 + m33 * b03) * det,
    (m22 * b04 - m21 * b05 - m23 * b03) * det,
    (m12 * b08 - m10 * b11 - m13 * b07) * det,
    (m00 * b11 - m02 * b08 + m03 * b07) * det,
    (m32 * b02 - m30 * b05 - m33 * b01) * det,
    (m20 * b05 - m22 * b02 + m23 * b01) * det,
    (m10 * b10 - m11 * b08 + m13 * b06) * det,
    (m01 * b08 - m00 * b10 - m03 * b06) * det,
    (m30 * b04 - m31 * b02 + m33 * b00) * det,
    (m21 * b02 - m20 * b04 - m23 * b00) * det,
    (m11 * b07 - m10 * b09 - m12 * b06) * det,
    (m00 * b09 - m01 * b07 + m02 * b06) * det,
    (m31 * b01 - m30 * b03 - m32 * b00) * det,
    (m20 * b03 - m21 * b01 + m22 * b00) * det,
  ];
}

function transformPoint4(m, p) {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12] * p[3],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13] * p[3],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14] * p[3],
    m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15] * p[3],
  ];
}

function unprojectToPlane(pctX, pctY, invVP, planeY) {
  const ndcX = (pctX / 100) * 2 - 1;
  const ndcY = 1 - (pctY / 100) * 2;

  const near = transformPoint4(invVP, [ndcX, ndcY, -1, 1]);
  const far = transformPoint4(invVP, [ndcX, ndcY, 1, 1]);

  const p0 = [near[0] / near[3], near[1] / near[3], near[2] / near[3]];
  const p1 = [far[0] / far[3], far[1] / far[3], far[2] / far[3]];

  const dir = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
  if (Math.abs(dir[1]) < 1e-8) return null;

  const t = (planeY - p0[1]) / dir[1];
  return [p0[0] + t * dir[0], planeY, p0[2] + t * dir[2]];
}

/**
 * Convert 2D polygon vertices (percentage coords) to 3D world coordinates.
 * @param {Array<[number, number]>} vertices - [[leftPct, topPct], ...]
 * @param {number[]} viewMatrix - 4x4 column-major view matrix
 * @param {number[]} projMatrix - 4x4 column-major projection matrix
 * @param {number} planeY - Y coordinate of the floor plane
 * @returns {Array<[number, number, number]>|null} - [[x, y, z], ...] world coords
 */
export function unprojectPolygon(vertices, viewMatrix, projMatrix, planeY) {
  const vp = multiplyMatrix4(projMatrix, viewMatrix);
  const invVP = invertMatrix4(vp);
  if (!invVP) return null;

  const worldVertices = [];
  for (const [pctX, pctY] of vertices) {
    const pt = unprojectToPlane(pctX, pctY, invVP, planeY);
    if (!pt) return null;
    worldVertices.push(pt);
  }
  return worldVertices;
}

/**
 * Compute real-world area (m²) and perimeter (m) of a 2D polygon by
 * unprojecting its percentage-coordinate vertices to 3D world coordinates.
 *
 * @param {Array<[number, number]>} vertices - [[leftPct, topPct], ...]
 * @param {number[]} viewMatrix - 4x4 column-major view matrix
 * @param {number[]} projMatrix - 4x4 column-major projection matrix
 * @param {number} planeY - Y coordinate of the floor plane
 * @returns {{ area_m2: number, perimeter_m: number }|null}
 */
export function computePolygonMetrics(vertices, viewMatrix, projMatrix, planeY) {
  const worldVerts = unprojectPolygon(vertices, viewMatrix, projMatrix, planeY);
  if (!worldVerts || worldVerts.length < 3) return null;

  const n = worldVerts.length;

  // Shoelace formula on the XZ plane (Y is up in xeokit)
  let area = 0;
  let perimeter = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += worldVerts[i][0] * worldVerts[j][2];
    area -= worldVerts[j][0] * worldVerts[i][2];
    const dx = worldVerts[j][0] - worldVerts[i][0];
    const dz = worldVerts[j][2] - worldVerts[i][2];
    perimeter += Math.sqrt(dx * dx + dz * dz);
  }

  return { area_m2: Math.abs(area) / 2, perimeter_m: perimeter };
}

/** @deprecated Use computePolygonMetrics instead */
export function computePolygonAreaM2(vertices, viewMatrix, projMatrix, planeY) {
  const result = computePolygonMetrics(vertices, viewMatrix, projMatrix, planeY);
  return result ? result.area_m2 : null;
}

/**
 * Test whether point (px,py) lies inside triangle (ax,ay)-(bx,by)-(cx,cy).
 */
function pointInTriangle(px, py, ax, ay, bx, by, cx, cy) {
  const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
  const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
  const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}

/**
 * Triangulate a simple (possibly concave) polygon using ear-clipping.
 * Generates both front-facing and back-facing triangles so the mesh
 * is pickable from either side in xeokit's ray-cast picking.
 * @param {Array<[number, number]>} vertices2D - 2D coordinates for shape
 * @returns {number[]} flat index array
 */
export function earClipTriangulate(vertices2D) {
  const n = vertices2D.length;
  if (n < 3) return [];
  if (n === 3) return [0, 1, 2, 0, 2, 1];

  // Signed area to determine winding direction
  let area = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += vertices2D[i][0] * vertices2D[j][1];
    area -= vertices2D[j][0] * vertices2D[i][1];
  }
  const ccw = area > 0;

  // Working index list
  const idx = [];
  for (let i = 0; i < n; i++) idx.push(i);

  const indices = [];
  let ear = 0;
  let remaining = n;
  let failCount = 0;

  while (remaining > 3) {
    const ia = idx[ear % remaining];
    const ib = idx[(ear + 1) % remaining];
    const ic = idx[(ear + 2) % remaining];

    const ax = vertices2D[ia][0], ay = vertices2D[ia][1];
    const bx = vertices2D[ib][0], by = vertices2D[ib][1];
    const cx = vertices2D[ic][0], cy = vertices2D[ic][1];

    // Check if triangle is convex with respect to polygon winding
    const cross = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    const isConvex = ccw ? cross > 0 : cross < 0;

    let clipped = false;
    if (isConvex) {
      // Ensure no other vertex falls inside this triangle
      let inside = false;
      for (let j = 0; j < remaining; j++) {
        const vi = idx[j];
        if (vi === ia || vi === ib || vi === ic) continue;
        if (pointInTriangle(vertices2D[vi][0], vertices2D[vi][1], ax, ay, bx, by, cx, cy)) {
          inside = true;
          break;
        }
      }
      if (!inside) {
        indices.push(ia, ib, ic);   // front face
        indices.push(ia, ic, ib);   // back face
        idx.splice((ear + 1) % remaining, 1);
        remaining--;
        failCount = 0;
        clipped = true;
      }
    }

    if (!clipped) {
      ear++;
      failCount++;
      if (failCount >= remaining) break; // degenerate polygon, stop
    }
  }

  // Last triangle
  if (remaining === 3) {
    indices.push(idx[0], idx[1], idx[2]);
    indices.push(idx[0], idx[2], idx[1]);
  }

  return indices;
}
