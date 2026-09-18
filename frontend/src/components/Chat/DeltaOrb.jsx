import React from 'react';
import './DeltaOrb.css';

/**
 * Delta AI Avatar Orb - a living, animated 3D sphere that
 * reflects Delta's current state: idle, listening, processing, speaking.
 */
export default function DeltaOrb({ state = 'idle' }) {
  // state: 'idle' | 'listening' | 'processing' | 'speaking' | 'greeting' | 'acknowledging'
  const effectiveState =
    state === 'greeting' || state === 'acknowledging' ? 'speaking'
    : state === 'processing' ? 'processing'
    : state === 'listening' ? 'listening'
    : 'idle';

  return (
    <div className={`delta-orb delta-orb--${effectiveState}`}>
      <div className="delta-orb__sphere">
        <div className="delta-orb__highlight" />
        <div className="delta-orb__ring" />
      </div>
      <div className="delta-orb__glow" />
    </div>
  );
}
