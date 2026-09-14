import React from 'react';
import './DeltaSpinner.css';

/**
 * Unified Delta spinner — radial arc orbiting the △ logo.
 * @param {number} size  Outer diameter in px (default 36)
 * @param {string} label Optional text below the spinner
 */
export default function DeltaSpinner({ size = 64, label }) {
  const r = size * 0.38;          // arc radius
  const sw = Math.max(2, size * 0.08); // stroke width
  const logoSize = size * 0.42;   // triangle font-size

  return (
    <div className="delta-spinner">
      <div className="delta-spinner__ring" style={{ width: size, height: size }}>
        <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size}>
          <defs>
            <linearGradient id="ds-grad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#E77133" />
              <stop offset="60%" stopColor="#f5a36b" />
              <stop offset="100%" stopColor="#E77133" stopOpacity="0.2" />
            </linearGradient>
          </defs>
          {/* Track */}
          <circle
            cx={size / 2} cy={size / 2} r={r}
            fill="none" stroke="#e5e2de" strokeWidth={sw}
            opacity="0.5"
          />
          {/* Spinning arc */}
          <circle
            className="delta-spinner__arc"
            cx={size / 2} cy={size / 2} r={r}
            fill="none" stroke="url(#ds-grad)" strokeWidth={sw}
            strokeLinecap="round"
            strokeDasharray={`${r * Math.PI * 0.75} ${r * Math.PI * 1.25}`}
          />
        </svg>
        {/* Centered △ logo */}
        <span className="delta-spinner__logo" style={{ fontSize: logoSize }}>
          &#9651;
        </span>
      </div>
      {label && <span className="delta-spinner__label">{label}</span>}
    </div>
  );
}
