import React from 'react';
import useStore from '../../store/useStore';
import './LoadingScreen.css';

export default function LoadingScreen() {
  const loadProgress = useStore((s) => s.loadProgress);
  const loadStage = useStore((s) => s.loadStage);
  const appReady = useStore((s) => s.appReady);

  return (
    <div className={`loading-screen ${appReady ? 'loading-screen--done' : ''}`}>
      <div className="loading-screen__content">
        <div className="loading-screen__icon">&#9651;</div>
        <h1 className="loading-screen__title">Delta Intelligence Platform</h1>

        <div className="loading-screen__bar-container">
          <div
            className="loading-screen__bar-fill"
            style={{ width: `${Math.min(loadProgress, 100)}%` }}
          />
        </div>

        <div className="loading-screen__info">
          <span className="loading-screen__stage">{loadStage}</span>
        </div>
      </div>
    </div>
  );
}
