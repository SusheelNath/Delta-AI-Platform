import React from 'react';
import useStore from '../../store/useStore';

export default function PolygonDrawingOverlay({ mousePos }) {
  const vertices = useStore((s) => s.pendingPolygonVertices);

  if (vertices.length === 0 && !mousePos) return null;

  const points = vertices.map((v) => `${v[0]},${v[1]}`).join(' ');
  const lastV = vertices.length > 0 ? vertices[vertices.length - 1] : null;
  const firstV = vertices.length > 0 ? vertices[0] : null;

  return (
    <svg
      className="polygon-drawing-overlay"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
    >
      {/* Completed edges */}
      {vertices.length >= 2 && (
        <polyline
          points={points}
          fill="none"
          stroke="#E77133"
          strokeWidth="0.3"
          vectorEffect="non-scaling-stroke"
        />
      )}

      {/* Preview line from last vertex to mouse */}
      {lastV && mousePos && (
        <line
          x1={lastV[0]} y1={lastV[1]}
          x2={mousePos[0]} y2={mousePos[1]}
          stroke="#E77133"
          strokeWidth="0.2"
          strokeDasharray="0.5,0.3"
          vectorEffect="non-scaling-stroke"
          opacity="0.6"
        />
      )}

      {/* Closing line preview (from mouse back to first vertex) */}
      {vertices.length >= 2 && mousePos && firstV && (
        <line
          x1={mousePos[0]} y1={mousePos[1]}
          x2={firstV[0]} y2={firstV[1]}
          stroke="#E77133"
          strokeWidth="0.15"
          strokeDasharray="0.3,0.3"
          vectorEffect="non-scaling-stroke"
          opacity="0.3"
        />
      )}

      {/* Vertex dots */}
      {vertices.map((v, i) => (
        <circle
          key={i}
          cx={v[0]} cy={v[1]}
          r="0.1"
          fill={i === 0 ? '#fff' : '#E77133'}
          stroke={i === 0 ? '#E77133' : '#fff'}
          strokeWidth="0.2"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}
