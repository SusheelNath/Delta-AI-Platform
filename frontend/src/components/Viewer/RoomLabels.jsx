import React, { useEffect, useRef, useCallback } from 'react';
import useStore from '../../store/useStore';
import './RoomLabels.css';

const EMPTY = [];

/**
 * 3D-anchored room labels rendered as HTML overlays on the xeokit canvas.
 * Shows labels for rooms in the currently expanded directory group.
 * Positions update on camera movement via requestAnimationFrame.
 */
export default function RoomLabels({ viewerRef }) {
  const currentExpandedGroup = useStore((s) => s.currentExpandedGroup);
  const activeFloorId = useStore((s) => s.activeFloorId);
  const polygons = useStore((s) => s.activeFloorId ? (s.floorPolygons[s.activeFloorId] || EMPTY) : EMPTY);
  const selectedSpaceId = useStore((s) => s.selectedSpaceId);

  const containerRef = useRef(null);
  const animRef = useRef(null);
  const prevCameraHash = useRef('');
  const prevGroupRef = useRef(null);

  // Get the rooms for the expanded group
  const groupPolygons = React.useMemo(() => {
    if (!currentExpandedGroup || !polygons.length) return [];
    return polygons
      .filter((p) => (p.primary_function || 'Unassigned') === currentExpandedGroup)
      .sort((a, b) => (a.space_name || '').localeCompare(b.space_name || '')
        || (a.ifc_guid || '').localeCompare(b.ifc_guid || ''));
  }, [currentExpandedGroup, polygons]);

  // Project world positions to screen — writes directly to DOM, no setState
  const projectLabels = useCallback(() => {
    const viewer = viewerRef?.current;
    const container = containerRef.current;
    if (!viewer || !groupPolygons.length || !container) return;

    const camera = viewer.scene.camera;
    const canvas = viewer.scene.canvas.canvas;
    if (!canvas) return;

    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w === 0 || h === 0) return;

    // Build camera hash to avoid unnecessary DOM writes
    const eye = camera.eye;
    const hash = `${eye[0].toFixed(1)},${eye[1].toFixed(1)},${eye[2].toFixed(1)}`;
    if (hash === prevCameraHash.current && prevGroupRef.current === currentExpandedGroup) return;
    prevCameraHash.current = hash;
    prevGroupRef.current = currentExpandedGroup;

    const geomData = useStore.getState().floorSpaceGeometry;
    const floorGeom = geomData?.[activeFloorId] || [];
    const geomMap = {};
    for (const g of floorGeom) {
      geomMap[g.id] = g;
    }

    const viewMatrix = camera.viewMatrix;
    const projMatrix = camera.projMatrix;
    const currentSelected = useStore.getState().selectedSpaceId;

    // Build HTML string directly — avoids React re-render cycle entirely
    let html = '';
    for (let i = 0; i < groupPolygons.length; i++) {
      const poly = groupPolygons[i];
      const geom = geomMap[poly.ifc_guid];
      if (!geom) continue;

      // World position = CENTER of the space bounding box
      const worldPos = [
        geom.x + geom.w / 2,     // center X = minX + width/2
        (geom.y || 0) + 0.3,     // y is already center + slight offset
        geom.z + geom.d / 2,     // center Z = minZ + depth/2
      ];

      // Project to clip space using xeokit's camera
      const vx = viewMatrix[0] * worldPos[0] + viewMatrix[4] * worldPos[1] + viewMatrix[8] * worldPos[2] + viewMatrix[12];
      const vy = viewMatrix[1] * worldPos[0] + viewMatrix[5] * worldPos[1] + viewMatrix[9] * worldPos[2] + viewMatrix[13];
      const vz = viewMatrix[2] * worldPos[0] + viewMatrix[6] * worldPos[1] + viewMatrix[10] * worldPos[2] + viewMatrix[14];
      const vw = viewMatrix[3] * worldPos[0] + viewMatrix[7] * worldPos[1] + viewMatrix[11] * worldPos[2] + viewMatrix[15];

      const cx = projMatrix[0] * vx + projMatrix[4] * vy + projMatrix[8] * vz + projMatrix[12] * vw;
      const cy = projMatrix[1] * vx + projMatrix[5] * vy + projMatrix[9] * vz + projMatrix[13] * vw;
      const cw = projMatrix[3] * vx + projMatrix[7] * vy + projMatrix[11] * vz + projMatrix[15] * vw;

      if (cw <= 0) continue; // behind camera

      const ndcX = cx / cw;
      const ndcY = cy / cw;

      // NDC to screen pixels
      const screenX = (ndcX + 1) * 0.5 * w;
      const screenY = (1 - ndcY) * 0.5 * h;

      // Skip if off-screen (with margin)
      if (screenX < -100 || screenX > w + 100 || screenY < -50 || screenY > h + 50) continue;

      const area = poly.area_m2 != null ? `${Number(poly.area_m2).toFixed(1)} m²` : '';
      const isSelected = poly.ifc_guid === currentSelected;
      const cls = `room-labels__label${isSelected ? ' room-labels__label--selected' : ''}`;

      html += `<div class="${cls}" style="left:${screenX}px;top:${screenY}px">`;
      html += `<span class="room-labels__index">${i + 1}</span>`;
      html += `<span class="room-labels__name">${poly.space_name || poly.ifc_guid}</span>`;
      if (area) html += `<span class="room-labels__area">${area}</span>`;
      html += `</div>`;
    }

    container.innerHTML = html;
  }, [viewerRef, groupPolygons, activeFloorId, currentExpandedGroup]);

  // Animation loop to track camera
  useEffect(() => {
    if (!groupPolygons.length) {
      if (containerRef.current) containerRef.current.innerHTML = '';
      return;
    }

    // Reset hash so first tick always renders
    prevCameraHash.current = '';

    let running = true;
    const tick = () => {
      if (!running) return;
      projectLabels();
      animRef.current = requestAnimationFrame(tick);
    };
    animRef.current = requestAnimationFrame(tick);

    return () => {
      running = false;
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, [groupPolygons, projectLabels]);

  // Update on selection change without restarting the loop
  useEffect(() => {
    prevCameraHash.current = '';
  }, [selectedSpaceId]);

  if (!currentExpandedGroup) return null;

  return <div ref={containerRef} className="room-labels" />;
}
