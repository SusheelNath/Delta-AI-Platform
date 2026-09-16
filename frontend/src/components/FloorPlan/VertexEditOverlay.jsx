import React, { useCallback, useRef } from 'react';
import useStore from '../../store/useStore';

/**
 * SVG overlay for dragging polygon vertices in geometry-edit mode.
 * Rendered inside FloorPlanImage's transformed container, same coordinate
 * space as SavedPolygonsOverlay (viewBox 0 0 100 100, percentage coords).
 */
export default function VertexEditOverlay() {
  const editingGeometry = useStore((s) => s.editingGeometry);
  const editingVertices = useStore((s) => s.editingVertices);
  const updateEditingVertex = useStore((s) => s.updateEditingVertex);
  const addEditingVertex = useStore((s) => s.addEditingVertex);
  const removeEditingVertex = useStore((s) => s.removeEditingVertex);

  const dragging = useRef(null); // { index, svgEl }

  // Convert mouse event to SVG percentage coords
  const toSVG = useCallback((e, svgEl) => {
    const rect = svgEl.getBoundingClientRect();
    return [
      ((e.clientX - rect.left) / rect.width) * 100,
      ((e.clientY - rect.top) / rect.height) * 100,
    ];
  }, []);

  const handleMouseDown = useCallback((e, index) => {
    e.stopPropagation();
    e.preventDefault();
    const svgEl = e.currentTarget.closest('svg');
    dragging.current = { index, svgEl };

    const onMove = (me) => {
      if (!dragging.current) return;
      const pos = toSVG(me, dragging.current.svgEl);
      updateEditingVertex(dragging.current.index, pos);
    };

    const onUp = () => {
      dragging.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [toSVG, updateEditingVertex]);

  // Right-click to remove vertex (min 3)
  const handleContextMenu = useCallback((e, index) => {
    e.preventDefault();
    e.stopPropagation();
    removeEditingVertex(index);
  }, [removeEditingVertex]);

  // Double-click on midpoint to add vertex
  const handleMidpointClick = useCallback((e, afterIndex) => {
    e.stopPropagation();
    e.preventDefault();
    const svgEl = e.currentTarget.closest('svg');
    const pos = toSVG(e, svgEl);
    addEditingVertex(afterIndex, pos);
  }, [toSVG, addEditingVertex]);

  if (!editingGeometry || editingGeometry.mode !== 'vertex' || editingVertices.length < 3) return null;

  const points = editingVertices.map(v => `${v[0]},${v[1]}`).join(' ');

  // Midpoints between consecutive vertices
  const midpoints = editingVertices.map((v, i) => {
    const next = editingVertices[(i + 1) % editingVertices.length];
    return [(v[0] + next[0]) / 2, (v[1] + next[1]) / 2];
  });

  return (
    <svg
      className="vertex-edit-overlay"
      style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 5 }}
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
    >
      {/* Filled polygon preview */}
      <polygon
        points={points}
        fill="rgba(231, 113, 51, 0.15)"
        stroke="#E77133"
        strokeWidth="0.4"
        vectorEffect="non-scaling-stroke"
      />

      {/* Edge lines (for clarity) */}
      {editingVertices.map((v, i) => {
        const next = editingVertices[(i + 1) % editingVertices.length];
        return (
          <line
            key={`edge-${i}`}
            x1={v[0]} y1={v[1]}
            x2={next[0]} y2={next[1]}
            stroke="#E77133"
            strokeWidth="0.5"
            vectorEffect="non-scaling-stroke"
            strokeDasharray="none"
          />
        );
      })}

      {/* Midpoint handles (smaller, for adding vertices) */}
      {midpoints.map((mp, i) => (
        <circle
          key={`mid-${i}`}
          cx={mp[0]} cy={mp[1]}
          r="0.6"
          fill="rgba(231, 113, 51, 0.3)"
          stroke="#E77133"
          strokeWidth="0.15"
          vectorEffect="non-scaling-stroke"
          style={{ cursor: 'cell', pointerEvents: 'all' }}
          onDoubleClick={(e) => handleMidpointClick(e, i)}
        />
      ))}

      {/* Vertex handles (draggable) */}
      {editingVertices.map((v, i) => (
        <circle
          key={`v-${i}`}
          cx={v[0]} cy={v[1]}
          r="0.8"
          fill={i === 0 ? '#fff' : '#E77133'}
          stroke={i === 0 ? '#E77133' : '#fff'}
          strokeWidth="0.25"
          vectorEffect="non-scaling-stroke"
          style={{ cursor: 'grab', pointerEvents: 'all' }}
          onMouseDown={(e) => handleMouseDown(e, i)}
          onContextMenu={(e) => handleContextMenu(e, i)}
        />
      ))}
    </svg>
  );
}
