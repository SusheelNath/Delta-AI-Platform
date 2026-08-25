import React from 'react';
import useStore from './store/useStore';
import XeokitViewer from './components/Viewer/XeokitViewer';
import FloorPlanPanel from './components/FloorPlan/FloorPlanPanel';
import ChatPanel from './components/Chat/ChatPanel';
import SpaceToolkit from './components/SpaceToolkit/SpaceToolkit';
import './App.css';

export default function App() {
  const panelExpanded = useStore((s) => s.panelExpanded);

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header__brand">
          <span className="app-header__icon">&#9651;</span>
          <span className="app-header__title">Delta Intelligence Platform</span>
        </div>
        <div className="app-header__meta">
        </div>
      </header>

      <div className={`app-body ${panelExpanded ? 'app-body--panel-expanded' : ''}`}>
        <div className="app-floorplan-panel">
          <FloorPlanPanel />
        </div>

        <div className="app-viewer-panel">
          <div className="app-viewer-container">
            <XeokitViewer />
          </div>
          <SpaceToolkit />
        </div>

        <div className="app-chat-panel">
          <ChatPanel />
        </div>
      </div>
    </div>
  );
}
