import React, { useEffect } from 'react';
import useStore from './store/useStore';
import { fetchFloors, fetchFloorPolygons } from './api/client';
import XeokitViewer from './components/Viewer/XeokitViewer';
import FloorPlanPanel from './components/FloorPlan/FloorPlanPanel';
import ChatPanel from './components/Chat/ChatPanel';
import SpaceToolkit from './components/SpaceToolkit/SpaceToolkit';
import LoadingScreen from './components/LoadingScreen/LoadingScreen';
import './App.css';

const METRIC_KEYS = ['normal_occupancy', 'max_occupancy', 'absolute_occupancy',
  'occupiable', 'used_area_m2', 'free_area_m2', 'area_m2'];

export default function App() {
  const panelExpanded = useStore((s) => s.panelExpanded);
  const appReady = useStore((s) => s.appReady);
  const viewerReady = useStore((s) => s.viewerReady);
  const dataReady = useStore((s) => s.dataReady);

  // Preload all data (floors + polygons for every floor)
  useEffect(() => {
    async function preload() {
      const { setLoadProgress, setLoadStage, setFloors, setFloorPolygons, setDataReady } = useStore.getState();

      // 1. Fetch floor list
      setLoadStage('Loading floor data...');
      let floorList = [];
      try {
        const data = await fetchFloors();
        floorList = [...data].sort((a, b) => a.level - b.level);
        setFloors(floorList);
        setLoadProgress(3);
      } catch (err) {
        console.error('[Delta] Failed to preload floors:', err);
      }

      // 2. Fetch polygons for every floor (parallel)
      if (floorList.length > 0) {
        setLoadStage('Loading space polygons...');
        let loaded = 0;
        await Promise.all(floorList.map(async (floor) => {
          try {
            const serverPolygons = await fetchFloorPolygons(floor.id);
            const local = useStore.getState().floorPolygons[floor.id] || [];
            const localByGuid = new Map(local.map((p) => [p.ifc_guid, p]));
            const serverGuids = new Set(serverPolygons.map((p) => p.ifc_guid));
            const localOnly = local.filter((p) => !serverGuids.has(p.ifc_guid));
            const merged = serverPolygons.map((sp) => {
              const lp = localByGuid.get(sp.ifc_guid);
              if (!lp) return sp;
              if (lp.edited) {
                const base = { ...sp, ...lp };
                for (const k of METRIC_KEYS) { if (sp[k] != null) base[k] = sp[k]; }
                return base;
              }
              if (lp.worldVertices) return { ...sp, worldVertices: lp.worldVertices };
              return sp;
            });
            setFloorPolygons(floor.id, [...merged, ...localOnly]);
          } catch {
            // Backend unavailable — localStorage polygons remain
          }
          loaded++;
          setLoadProgress(3 + Math.round((loaded / floorList.length) * 5));
        }));
      }

      setDataReady(true);
    }
    preload();
  }, []);

  // Set appReady when both data and viewer are loaded
  useEffect(() => {
    if (dataReady && viewerReady) {
      useStore.getState().setAppReady(true);
    }
  }, [dataReady, viewerReady]);

  return (
    <div className="app">
      <LoadingScreen />

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
