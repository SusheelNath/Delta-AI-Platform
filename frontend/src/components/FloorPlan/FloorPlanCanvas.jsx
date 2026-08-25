import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import useStore from '../../store/useStore';
import { searchSpaces, fetchSpaceByGuid } from '../../api/client';
import { FUNCTION_CATEGORIES, getCategoryIndex, getCssColorForFunction } from '../../utils/colorScheme';
import './FloorPlanCanvas.css';

const MIN_SCALE = 0.4;
const MAX_SCALE = 6;
const ZOOM_STEP = 1.25;
const PADDING = 30;
const INSET_PX = 1.5; // gap between rooms in canvas-space px

// Infrastructure space_class values (MEP layer)
const MEP_SPACE_CLASSES = new Set([
  'Void / shaft',
  'Technical / vertical core',
  'Technical / plant',
  'Vertical circulation / lift support',
  'Circulation',
  'Transition / circulation',
]);

function heatColor(t) {
  const r = Math.round(255 * Math.min(1, t * 2));
  const g = Math.round(255 * Math.min(1, 2 - t * 2));
  const b = Math.round(255 * (1 - t) * 0.6);
  return `rgb(${r},${g},${b})`;
}

const STATUS_COLORS = {
  operational: '#4ade80',
  maintenance: '#fbbf24',
  closed: '#ef4444',
  unknown: '#6b7280',
};

function parseStatus(dataStatus) {
  if (!dataStatus) return 'operational';
  const s = dataStatus.toLowerCase();
  if (s.includes('maint') || s.includes('renovation') || s.includes('repair')) return 'maintenance';
  if (s.includes('closed') || s.includes('inactive') || s.includes('decommission')) return 'closed';
  if (s.includes('partial') || s.includes('review') || s.includes('draft')) return 'unknown';
  return 'operational';
}

export default function FloorPlanCanvas({ floorIdOverride }) {
  const activeFloorId = useStore((s) => s.activeFloorId);
  const floorSpaceGeometry = useStore((s) => s.floorSpaceGeometry);
  const activeFunctionFilters = useStore((s) => s.activeFunctionFilters);
  const selectedSpaceId = useStore((s) => s.selectedSpaceId);
  const selectSpace = useStore((s) => s.selectSpace);
  const searchQuery = useStore((s) => s.searchQuery);
  const heatmapMode = useStore((s) => s.heatmapMode);
  const mepVisible = useStore((s) => s.mepVisible);

  const floorId = floorIdOverride || activeFloorId;

  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const [spaceData, setSpaceData] = useState({});
  const [transform, setTransform] = useState({ scale: 1, tx: 0, ty: 0 });
  const [hovered, setHovered] = useState(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const [deptSummary, setDeptSummary] = useState(null);
  const [disambig, setDisambig] = useState(null); // { rooms: [...], x, y }
  const isPanning = useRef(false);
  const panStart = useRef({ x: 0, y: 0 });
  const didPan = useRef(false);
  const boundsRef = useRef(null);

  const spaces = floorId ? (floorSpaceGeometry[floorId] || []) : [];

  // Fetch space details when floor changes
  useEffect(() => {
    if (!floorId) return;
    let cancelled = false;
    searchSpaces({ floor_id: floorId })
      .then((data) => {
        if (cancelled) return;
        const map = {};
        for (const sp of data) {
          if (sp.ifc_guid) map[sp.ifc_guid] = sp;
        }
        setSpaceData(map);
      })
      .catch((err) => console.warn('[Delta] Failed to fetch space data:', err));
    return () => { cancelled = true; };
  }, [floorId]);

  // Reset on floor change
  useEffect(() => {
    setTransform({ scale: 1, tx: 0, ty: 0 });
    setHovered(null);
    setDeptSummary(null);
    setDisambig(null);
  }, [floorId]);

  // Build room list — classify as MEP or occupiable, filter, deduplicate
  const rooms = useMemo(() => {
    if (spaces.length === 0) return [];

    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (const s of spaces) {
      if (s.x < minX) minX = s.x;
      if (s.z < minZ) minZ = s.z;
      if (s.x + s.w > maxX) maxX = s.x + s.w;
      if (s.z + s.d > maxZ) maxZ = s.z + s.d;
    }
    const rangeX = maxX - minX || 1;
    const rangeZ = maxZ - minZ || 1;
    boundsRef.current = { minX, minZ, rangeX, rangeZ };

    const result = [];
    for (const s of spaces) {
      const detail = spaceData[s.id] || {};
      const fnName = detail.primary_function || s.name || '';
      const catIdx = getCategoryIndex(fnName);
      const spaceClass = detail.space_class || '';
      const occupiable = detail.occupiable || '';

      // Classify: MEP infrastructure vs occupiable room
      const isMep = MEP_SPACE_CLASSES.has(spaceClass) || occupiable === 'No';

      // If MEP layer is off, skip infrastructure rooms
      if (isMep && !mepVisible) continue;

      const isActive = catIdx < 0 || activeFunctionFilters[catIdx];
      const area = detail.area_m2 || 0;
      const capacity = parseInt(detail.normal_occupancy || detail.patient_capacity || '0', 10) || 0;
      const status = parseStatus(detail.data_status);
      const zone = detail.functional_zone || '';
      const displayName = detail.space_name || s.name || '';

      result.push({
        id: s.id,
        name: displayName,
        nx: (s.x - minX) / rangeX,
        nz: (s.z - minZ) / rangeZ,
        nw: s.w / rangeX,
        nd: s.d / rangeZ,
        catIdx,
        isActive,
        isMep,
        spaceClass,
        area,
        capacity,
        status,
        zone,
        fn: fnName,
        roomNumber: detail.room_number || '',
        areaPerBed: capacity > 0 ? area / capacity : null,
      });
    }

    // Deduplicate: remove rooms that fully contain other rooms (zone envelopes)
    const CONTAIN_TOL = 0.002;
    const removeSet = new Set();
    for (let i = 0; i < result.length; i++) {
      if (removeSet.has(i)) continue;
      const a = result[i];
      for (let j = 0; j < result.length; j++) {
        if (i === j || removeSet.has(j)) continue;
        const b = result[j];
        if (b.nx >= a.nx - CONTAIN_TOL &&
            b.nz >= a.nz - CONTAIN_TOL &&
            b.nx + b.nw <= a.nx + a.nw + CONTAIN_TOL &&
            b.nz + b.nd <= a.nz + a.nd + CONTAIN_TOL) {
          removeSet.add(i);
          break;
        }
      }
    }
    const deduped = result.filter((_, i) => !removeSet.has(i));

    // Sort by area descending — largest rooms draw first, smallest on top
    deduped.sort((a, b) => (b.nw * b.nd) - (a.nw * a.nd));

    return deduped;
  }, [spaces, spaceData, activeFunctionFilters, mepVisible]);

  // Department zones
  const departments = useMemo(() => {
    const zoneMap = {};
    for (const room of rooms) {
      if (!room.zone || !room.isActive) continue;
      if (!zoneMap[room.zone]) {
        zoneMap[room.zone] = { zone: room.zone, rooms: [], sumX: 0, sumZ: 0, totalArea: 0, totalCapacity: 0 };
      }
      const z = zoneMap[room.zone];
      z.rooms.push(room);
      z.sumX += room.nx + room.nw / 2;
      z.sumZ += room.nz + room.nd / 2;
      z.totalArea += room.area;
      z.totalCapacity += room.capacity;
    }
    return Object.values(zoneMap).map((z) => ({
      ...z,
      cx: z.sumX / z.rooms.length,
      cz: z.sumZ / z.rooms.length,
      count: z.rooms.length,
    }));
  }, [rooms]);

  // Search matches
  const searchMatches = useMemo(() => {
    if (!searchQuery || searchQuery.trim().length === 0) return null;
    const q = searchQuery.toLowerCase().trim();
    return new Set(
      rooms.filter((r) => r.name.toLowerCase().includes(q) || r.fn.toLowerCase().includes(q) || r.zone.toLowerCase().includes(q))
        .map((r) => r.id)
    );
  }, [searchQuery, rooms]);

  // Heatmap stats
  const heatmapStats = useMemo(() => {
    if (heatmapMode === 'function') return null;
    const values = [];
    for (const r of rooms) {
      if (!r.isActive) continue;
      if (heatmapMode === 'area_per_bed' && r.areaPerBed !== null) values.push(r.areaPerBed);
      else if (heatmapMode === 'utilization') values.push(r.capacity > 0 ? 0.7 : 0.3);
      else if (heatmapMode === 'area') values.push(r.area);
    }
    if (values.length === 0) return null;
    const min = Math.min(...values);
    const max = Math.max(...values);
    return { min, max, range: max - min || 1 };
  }, [rooms, heatmapMode]);

  const MEP_COLORS = {
    'Void / shaft': '#4a5568',
    'Technical / vertical core': '#5a4a6e',
    'Technical / plant': '#4a6058',
    'Vertical circulation / lift support': '#6e5a4a',
    'Circulation': '#3d5a7a',
    'Transition / circulation': '#3d5a7a',
  };

  const getRoomColor = useCallback((room) => {
    if (!room.isActive) return '#1a1d24';
    if (room.isMep) return MEP_COLORS[room.spaceClass] || '#4a5568';
    if (heatmapMode === 'status') return STATUS_COLORS[room.status] || STATUS_COLORS.unknown;
    if (heatmapMode === 'function' || !heatmapStats) {
      return room.catIdx >= 0 ? FUNCTION_CATEGORIES[room.catIdx].cssColor : '#808590';
    }
    let val = 0;
    if (heatmapMode === 'area_per_bed') val = room.areaPerBed ?? 0;
    else if (heatmapMode === 'utilization') val = room.capacity > 0 ? 0.7 : 0.3;
    else if (heatmapMode === 'area') val = room.area;
    const t = Math.max(0, Math.min(1, (val - heatmapStats.min) / heatmapStats.range));
    return heatColor(t);
  }, [heatmapMode, heatmapStats]);

  // Compute layout helpers
  const getLayout = useCallback(() => {
    const container = containerRef.current;
    if (!container || !boundsRef.current) return null;
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    const drawW = cw - PADDING * 2;
    const drawH = ch - PADDING * 2;
    const aspect = boundsRef.current.rangeX / boundsRef.current.rangeZ;
    let mapW, mapH;
    if (drawW / drawH > aspect) { mapH = drawH; mapW = mapH * aspect; }
    else { mapW = drawW; mapH = mapW / aspect; }
    const offsetX = PADDING + (drawW - mapW) / 2;
    const offsetZ = PADDING + (drawH - mapH) / 2;
    return { cw, ch, mapW, mapH, offsetX, offsetZ };
  }, []);

  // ── Canvas rendering ──
  useEffect(() => {
    const canvas = canvasRef.current;
    const layout = getLayout();
    if (!canvas || !layout || rooms.length === 0) return;

    const { cw, ch, mapW, mapH, offsetX, offsetZ } = layout;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = cw * dpr;
    canvas.height = ch * dpr;
    canvas.style.width = cw + 'px';
    canvas.style.height = ch + 'px';

    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);

    ctx.fillStyle = '#0a0e17';
    ctx.fillRect(0, 0, cw, ch);

    ctx.save();
    ctx.translate(transform.tx, transform.ty);
    ctx.scale(transform.scale, transform.scale);

    const isSearching = searchMatches !== null;
    const inset = INSET_PX / transform.scale;

    // Draw rooms (already sorted large-first, so small rooms draw on top)
    for (const room of rooms) {
      let rx = offsetX + room.nx * mapW + inset;
      let rz = offsetZ + room.nz * mapH + inset;
      let rw = room.nw * mapW - inset * 2;
      let rh = room.nd * mapH - inset * 2;
      if (rw < 1 || rh < 1) continue;

      let color = getRoomColor(room);
      let alpha = room.isActive ? (room.isMep ? 0.5 : 0.88) : 0.15;

      if (isSearching) {
        alpha = searchMatches.has(room.id) ? 1 : 0.1;
        if (!searchMatches.has(room.id)) color = '#1a1d24';
      }

      const isSelected = room.id === selectedSpaceId;
      const isHovered = hovered && hovered.id === room.id;

      // Fill
      ctx.globalAlpha = alpha;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.roundRect(rx, rz, rw, rh, Math.min(3, rw * 0.05));
      ctx.fill();

      // MEP hatching pattern (diagonal lines)
      if (room.isMep) {
        ctx.save();
        ctx.clip();
        ctx.globalAlpha = 0.15;
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 0.5 / transform.scale;
        const step = 6 / transform.scale;
        for (let d = -rh; d < rw + rh; d += step) {
          ctx.beginPath();
          ctx.moveTo(rx + d, rz);
          ctx.lineTo(rx + d + rh, rz + rh);
          ctx.stroke();
        }
        ctx.restore();
        ctx.globalAlpha = alpha;
      }

      // Border
      if (isSelected) {
        ctx.strokeStyle = '#E77133';
        ctx.lineWidth = 2.5 / transform.scale;
        ctx.globalAlpha = 1;
      } else if (isHovered) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5 / transform.scale;
        ctx.globalAlpha = 1;
      } else if (room.isMep) {
        ctx.setLineDash([4 / transform.scale, 3 / transform.scale]);
        ctx.strokeStyle = 'rgba(255,255,255,0.25)';
        ctx.lineWidth = 0.8 / transform.scale;
      } else {
        ctx.strokeStyle = 'rgba(0,0,0,0.4)';
        ctx.lineWidth = 0.8 / transform.scale;
      }
      ctx.beginPath();
      ctx.roundRect(rx, rz, rw, rh, Math.min(3, rw * 0.05));
      ctx.stroke();
      ctx.setLineDash([]);

      // Status badge (non-operational only)
      if (heatmapMode !== 'status' && room.status !== 'operational') {
        const badgeR = Math.max(2.5, 4 / transform.scale);
        ctx.globalAlpha = 1;
        ctx.fillStyle = STATUS_COLORS[room.status];
        ctx.beginPath();
        ctx.arc(rx + rw - badgeR - 1 / transform.scale, rz + badgeR + 1 / transform.scale, badgeR, 0, Math.PI * 2);
        ctx.fill();
      }

    }

    ctx.globalAlpha = 1;

    ctx.restore();
  }, [rooms, transform, hovered, selectedSpaceId, searchMatches, getRoomColor, heatmapMode, getLayout]);

  // ── Hit testing — returns all rooms at point (for disambiguation) ──
  const hitTestAll = useCallback((clientX, clientY) => {
    const container = containerRef.current;
    const layout = getLayout();
    if (!container || !layout || rooms.length === 0) return [];

    const rect = container.getBoundingClientRect();
    const cx = (clientX - rect.left - transform.tx) / transform.scale;
    const cy = (clientY - rect.top - transform.ty) / transform.scale;
    const { mapW, mapH, offsetX, offsetZ } = layout;
    const inset = INSET_PX / transform.scale;

    const hits = [];
    // Iterate in reverse (small rooms are at the end, drawn on top)
    for (let i = rooms.length - 1; i >= 0; i--) {
      const room = rooms[i];
      if (!room.isActive) continue;
      const rx = offsetX + room.nx * mapW + inset;
      const rz = offsetZ + room.nz * mapH + inset;
      const rw = room.nw * mapW - inset * 2;
      const rh = room.nd * mapH - inset * 2;
      if (cx >= rx && cx <= rx + rw && cy >= rz && cy <= rz + rh) {
        hits.push(room);
      }
    }
    return hits;
  }, [rooms, transform, getLayout]);

  const handleMouseMove = useCallback((e) => {
    const hits = hitTestAll(e.clientX, e.clientY);
    const room = hits.length > 0 ? hits[0] : null;
    setHovered(room);
    if (room) {
      const container = containerRef.current;
      if (container) {
        const cr = container.getBoundingClientRect();
        setTooltipPos({ x: e.clientX - cr.left + 14, y: e.clientY - cr.top - 10 });
      }
    }

    if (!isPanning.current) return;
    const dx = e.clientX - panStart.current.x;
    const dy = e.clientY - panStart.current.y;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) didPan.current = true;
    panStart.current = { x: e.clientX, y: e.clientY };
    setTransform((prev) => ({ ...prev, tx: prev.tx + dx, ty: prev.ty + dy }));
  }, [hitTestAll]);

  const handleMouseDown = useCallback((e) => {
    if (e.button === 0 || e.button === 1) {
      isPanning.current = true;
      didPan.current = false;
      panStart.current = { x: e.clientX, y: e.clientY };
    }
  }, []);

  const handleMouseUp = useCallback(async (e) => {
    isPanning.current = false;
    if (didPan.current) return;

    setDisambig(null);
    const hits = hitTestAll(e.clientX, e.clientY);
    if (hits.length === 0) return;

    if (hits.length === 1) {
      // Single room — select directly
      const room = hits[0];
      try {
        const detail = await fetchSpaceByGuid(room.id);
        selectSpace(room.id, detail);
      } catch { selectSpace(room.id, null); }
    } else {
      // Multiple rooms overlap — show disambiguation
      const container = containerRef.current;
      if (container) {
        const cr = container.getBoundingClientRect();
        setDisambig({
          rooms: hits,
          x: e.clientX - cr.left,
          y: e.clientY - cr.top,
        });
      }
    }
  }, [hitTestAll, selectSpace]);

  const handleDisambigSelect = useCallback(async (room) => {
    setDisambig(null);
    try {
      const detail = await fetchSpaceByGuid(room.id);
      selectSpace(room.id, detail);
    } catch { selectSpace(room.id, null); }
  }, [selectSpace]);

  const handleMouseLeave = useCallback(() => {
    isPanning.current = false;
    setHovered(null);
  }, []);

  const handleWheel = useCallback((e) => {
    e.preventDefault();
    setDisambig(null);
    const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
    setTransform((prev) => {
      const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, prev.scale * factor));
      if (newScale === prev.scale) return prev;
      const container = containerRef.current;
      if (!container) return { ...prev, scale: newScale };
      const rect = container.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const ratio = newScale / prev.scale;
      return { scale: newScale, tx: cx - (cx - prev.tx) * ratio, ty: cy - (cy - prev.ty) * ratio };
    });
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  const zoomIn = useCallback(() => {
    setTransform((prev) => {
      const newScale = Math.min(MAX_SCALE, prev.scale * ZOOM_STEP);
      const container = containerRef.current;
      if (!container) return { ...prev, scale: newScale };
      const cw = container.clientWidth / 2;
      const ch = container.clientHeight / 2;
      const ratio = newScale / prev.scale;
      return { scale: newScale, tx: cw - (cw - prev.tx) * ratio, ty: ch - (ch - prev.ty) * ratio };
    });
  }, []);

  const zoomOut = useCallback(() => {
    setTransform((prev) => {
      const newScale = Math.max(MIN_SCALE, prev.scale / ZOOM_STEP);
      const container = containerRef.current;
      if (!container) return { ...prev, scale: newScale };
      const cw = container.clientWidth / 2;
      const ch = container.clientHeight / 2;
      const ratio = newScale / prev.scale;
      return { scale: newScale, tx: cw - (cw - prev.tx) * ratio, ty: ch - (ch - prev.ty) * ratio };
    });
  }, []);

  const resetView = useCallback(() => {
    setTransform({ scale: 1, tx: 0, ty: 0 });
    setDisambig(null);
  }, []);

  const handleDeptClick = useCallback((zone) => {
    const dept = departments.find((d) => d.zone === zone);
    if (!dept) return;
    setDeptSummary(deptSummary?.zone === zone ? null : dept);
  }, [departments, deptSummary]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => setTransform((prev) => ({ ...prev })));
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  if (!floorId) {
    return <div className="fpc__empty"><p>Select a floor to view plan</p></div>;
  }

  if (spaces.length === 0) {
    return (
      <div className="fpc__empty">
        <div className="fpc__spinner" />
        <p>Loading floor plan...</p>
      </div>
    );
  }

  const isSearching = searchMatches !== null;

  return (
    <div className="fpc" ref={containerRef}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
    >
      <canvas ref={canvasRef} className="fpc__canvas" />

      {/* Zoom controls */}
      <div className="fpc__zoom">
        <button className="fpc__zoom-btn" onClick={zoomIn} title="Zoom in">+</button>
        <button className="fpc__zoom-btn" onClick={zoomOut} title="Zoom out">−</button>
        <button className="fpc__zoom-btn fpc__zoom-btn--reset" onClick={resetView} title="Reset view">⟲</button>
      </div>

      {/* Legend */}
      {heatmapMode === 'function' && (
        <div className="fpc__legend">
          {FUNCTION_CATEGORIES.map((cat, i) => (
            <div key={i} className="fpc__legend-item">
              <span className="fpc__legend-dot" style={{ background: cat.cssColor }} />
              <span className="fpc__legend-label">{cat.label}</span>
            </div>
          ))}
          {mepVisible && (
            <>
              <div className="fpc__legend-divider" />
              <div className="fpc__legend-item">
                <span className="fpc__legend-dot fpc__legend-dot--mep" style={{ background: '#4a5568' }} />
                <span className="fpc__legend-label">MEP / Infra</span>
              </div>
            </>
          )}
        </div>
      )}

      {heatmapMode === 'status' && (
        <div className="fpc__legend">
          {Object.entries(STATUS_COLORS).filter(([k]) => k !== 'unknown').map(([key, color]) => (
            <div key={key} className="fpc__legend-item">
              <span className="fpc__legend-dot" style={{ background: color }} />
              <span className="fpc__legend-label">{key.charAt(0).toUpperCase() + key.slice(1)}</span>
            </div>
          ))}
        </div>
      )}

      {(heatmapMode === 'area_per_bed' || heatmapMode === 'area' || heatmapMode === 'utilization') && (
        <div className="fpc__legend">
          <div className="fpc__legend-gradient">
            <span className="fpc__legend-label">Low</span>
            <div className="fpc__legend-bar" />
            <span className="fpc__legend-label">High</span>
          </div>
        </div>
      )}

      {/* Hover tooltip */}
      {hovered && !disambig && (
        <div className="fpc__tooltip" style={{ left: tooltipPos.x, top: tooltipPos.y }}>
          <div className="fpc__tooltip-header">
            <span className="fpc__tooltip-dot" style={{ background: getRoomColor(hovered) }} />
            <span className="fpc__tooltip-name">{hovered.name}</span>
          </div>
          {hovered.fn && <div className="fpc__tooltip-row"><span className="fpc__tooltip-key">Function</span><span>{hovered.fn}</span></div>}
          {hovered.zone && (
            <div className="fpc__tooltip-row fpc__tooltip-row--link" onClick={() => handleDeptClick(hovered.zone)}>
              <span className="fpc__tooltip-key">Department</span><span>{hovered.zone}</span>
            </div>
          )}
          {hovered.area > 0 && <div className="fpc__tooltip-row"><span className="fpc__tooltip-key">Area</span><span>{hovered.area.toFixed(1)} m²</span></div>}
          {hovered.capacity > 0 && <div className="fpc__tooltip-row"><span className="fpc__tooltip-key">Capacity</span><span>{hovered.capacity}</span></div>}
          {hovered.areaPerBed !== null && hovered.areaPerBed > 0 && (
            <div className="fpc__tooltip-row"><span className="fpc__tooltip-key">Area/bed</span><span>{hovered.areaPerBed.toFixed(1)} m²</span></div>
          )}
          <div className="fpc__tooltip-row">
            <span className="fpc__tooltip-key">Status</span>
            <span className="fpc__tooltip-status" data-status={hovered.status}>
              {hovered.status.charAt(0).toUpperCase() + hovered.status.slice(1)}
            </span>
          </div>
        </div>
      )}

      {/* Disambiguation popup */}
      {disambig && (
        <div className="fpc__disambig" style={{ left: disambig.x, top: disambig.y }}>
          <div className="fpc__disambig-title">{disambig.rooms.length} rooms here</div>
          {disambig.rooms.map((room) => (
            <button key={room.id} className="fpc__disambig-item" onClick={() => handleDisambigSelect(room)}>
              <span className="fpc__disambig-dot" style={{ background: getRoomColor(room) }} />
              <span className="fpc__disambig-name">{room.name}</span>
              {room.fn && <span className="fpc__disambig-fn">{room.fn}</span>}
            </button>
          ))}
        </div>
      )}

      {/* Department summary popup */}
      {deptSummary && (
        <div className="fpc__dept-popup">
          <div className="fpc__dept-header">
            <span>{deptSummary.zone}</span>
            <button className="fpc__dept-close" onClick={() => setDeptSummary(null)}>×</button>
          </div>
          <div className="fpc__dept-stats">
            <div className="fpc__dept-stat">
              <span className="fpc__dept-stat-val">{deptSummary.count}</span>
              <span className="fpc__dept-stat-key">Rooms</span>
            </div>
            <div className="fpc__dept-stat">
              <span className="fpc__dept-stat-val">{deptSummary.totalArea.toFixed(0)}</span>
              <span className="fpc__dept-stat-key">m² total</span>
            </div>
            <div className="fpc__dept-stat">
              <span className="fpc__dept-stat-val">{deptSummary.totalCapacity}</span>
              <span className="fpc__dept-stat-key">Capacity</span>
            </div>
          </div>
          <div className="fpc__dept-breakdown">
            {Object.entries(
              deptSummary.rooms.reduce((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc; }, {})
            ).map(([status, count]) => (
              <span key={status} className="fpc__dept-badge" data-status={status}>{count} {status}</span>
            ))}
          </div>
        </div>
      )}

      {/* Search badge */}
      {isSearching && (
        <div className="fpc__search-badge">
          {searchMatches.size} {searchMatches.size === 1 ? 'match' : 'matches'}
        </div>
      )}
    </div>
  );
}
