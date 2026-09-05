import React from 'react';
import useStore from '../../store/useStore';
import './LoadingScreen.css';

const RADIUS = 70;
const STROKE = 4;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const SIZE = (RADIUS + STROKE) * 2;

export default function LoadingScreen() {
  const loadProgress = useStore((s) => s.loadProgress);
  const loadStage = useStore((s) => s.loadStage);
  const appReady = useStore((s) => s.appReady);

  const clamped = Math.min(loadProgress, 100);
  const offset = CIRCUMFERENCE * (1 - clamped / 100);

  return (
    <div className={`loading-screen ${appReady ? 'loading-screen--done' : ''}`}>
      <div className="loading-screen__content">
        {/* Radial progress ring + logo */}
        <div className="loading-screen__ring-wrap">
          <svg
            className="loading-screen__ring"
            width={SIZE}
            height={SIZE}
            viewBox={`0 0 ${SIZE} ${SIZE}`}
          >
            <defs>
              <linearGradient id="ring-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#E77133" />
                <stop offset="50%" stopColor="#f5a36b" />
                <stop offset="100%" stopColor="#E77133" />
              </linearGradient>
              <filter id="ring-glow">
                <feGaussianBlur stdDeviation="3" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>
            {/* Track */}
            <circle
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={RADIUS}
              fill="none"
              stroke="#1e2636"
              strokeWidth={STROKE}
            />
            {/* Progress arc */}
            <circle
              className="loading-screen__ring-progress"
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={RADIUS}
              fill="none"
              stroke="url(#ring-gradient)"
              strokeWidth={STROKE}
              strokeLinecap="round"
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={offset}
              filter="url(#ring-glow)"
            />
          </svg>

          {/* Delta logo centered inside ring */}
          <div className="loading-screen__logo">
            <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
              <path
                d="M20 4 L36 34 L4 34 Z"
                fill="none"
                stroke="#E77133"
                strokeWidth="2.2"
                strokeLinejoin="round"
                className="loading-screen__logo-path"
              />
            </svg>
          </div>
        </div>

        <h1 className="loading-screen__title">Delta Intelligence Platform</h1>
        <span className="loading-screen__stage">{loadStage}</span>
      </div>
    </div>
  );
}
