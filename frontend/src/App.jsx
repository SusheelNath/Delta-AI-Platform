import React, { useEffect, useState } from 'react';
import useStore from './store/useStore';
import { fetchFloors, fetchFloorPolygons, fetchFloorIntelligence, fetchFloorFurnishings, fetchFloorRepurposeOptions, fetchFloorExpansionOptions } from './api/client';
import XeokitViewer from './components/Viewer/XeokitViewer';
import FloorPlanPanel from './components/FloorPlan/FloorPlanPanel';
import ChatPanel from './components/Chat/ChatPanel';
import SpaceToolkit from './components/SpaceToolkit/SpaceToolkit';
import LoadingScreen from './components/LoadingScreen/LoadingScreen';
import HelpGuide from './components/HelpGuide/HelpGuide';
import './App.css';

const METRIC_KEYS = ['normal_occupancy', 'max_occupancy', 'absolute_occupancy',
  'occupiable', 'used_area_m2', 'free_area_m2', 'area_m2'];

export default function App() {
  const appReady = useStore((s) => s.appReady);
  const viewerReady = useStore((s) => s.viewerReady);
  const dataReady = useStore((s) => s.dataReady);
  const leftPanelOpen = useStore((s) => s.leftPanelOpen);
  const rightPanelOpen = useStore((s) => s.rightPanelOpen);
  const [guideOpen, setGuideOpen] = useState(false);

  // Preload all data (floors + polygons for every floor)
  useEffect(() => {
    async function preload() {
      const { setLoadProgress, setLoadStage, setFloors, setFloorPolygons, setFloorIntelligence, mergeSpaceFurnishings, mergeRepurposeOptions, mergeExpansionOptions, setDataReady } = useStore.getState();

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
            // Backend unavailable - localStorage polygons remain
          }
          loaded++;
          setLoadProgress(3 + Math.round((loaded / floorList.length) * 5));
        }));
      }

      // 3. Fetch intelligence for every floor (parallel)
      if (floorList.length > 0) {
        setLoadStage('Loading space intelligence...');
        await Promise.all(floorList.map(async (floor) => {
          try {
            const intel = await fetchFloorIntelligence(floor.id);
            setFloorIntelligence(floor.id, intel);
          } catch {
            // Non-critical - fallback to API calls if cache unavailable
          }
        }));
        setLoadProgress(10);
      }

      // 4. Preload furnishings for every floor (parallel)
      if (floorList.length > 0) {
        setLoadStage('Loading furnishings...');
        await Promise.all(floorList.map(async (floor) => {
          try {
            const furnishings = await fetchFloorFurnishings(floor.id);
            const byGuid = {};
            for (const f of furnishings) {
              const guid = f.ifc_guid;
              if (!byGuid[guid]) byGuid[guid] = [];
              byGuid[guid].push(f);
            }
            mergeSpaceFurnishings(byGuid);
          } catch {
            // Non-critical - SpaceToolkit will fetch per-room as fallback
          }
        }));
      }

      // 5. Preload repurpose options for every floor (parallel)
      if (floorList.length > 0) {
        setLoadStage('Loading repurpose analysis...');
        await Promise.all(floorList.map(async (floor) => {
          try {
            const opts = await fetchFloorRepurposeOptions(floor.id);
            if (opts && typeof opts === 'object') {
              mergeRepurposeOptions(opts);
            }
          } catch {
            // Non-critical - panel will show empty state
          }
        }));
      }

      // 6. Preload expansion options for commercial spaces (parallel)
      if (floorList.length > 0) {
        setLoadStage('Loading expansion analysis...');
        await Promise.all(floorList.map(async (floor) => {
          try {
            const opts = await fetchFloorExpansionOptions(floor.id);
            if (opts && typeof opts === 'object') {
              mergeExpansionOptions(opts);
            }
          } catch {
            // Non-critical - panel will show empty state
          }
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
      <HelpGuide open={guideOpen} onClose={() => setGuideOpen(false)} />

      <header className="app-header">
        <div className="app-header__brand">
          <span className="app-header__icon">&#9651;</span>
          <span className="app-header__title">Delta Intelligence Platform</span>
        </div>
        <div className="app-header__actions">
          <button className="app-header__help-btn" onClick={() => setGuideOpen(true)} title="How to use Delta">
            <svg width="16" height="16" viewBox="0 0 18 18" fill="none">
              <circle cx="9" cy="9" r="8" stroke="currentColor" strokeWidth="1.4"/>
              <path d="M6.5 6.8a2.5 2.5 0 0 1 4.85.8c0 1.2-1.6 1.6-1.85 2.7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
              <circle cx="9" cy="13" r="0.8" fill="currentColor"/>
            </svg>
          </button>
        </div>
      </header>

      <div className="app-body">
        <div className={`app-panel app-panel--left ${leftPanelOpen ? 'app-panel--open' : ''}`}>
          <div className="app-panel__inner">
            <FloorPlanPanel />
          </div>
        </div>

        <div className="app-viewer-panel">
          <div className="app-viewer-container">
            <XeokitViewer />
          </div>
          <SpaceToolkit />
        </div>

        <div className={`app-panel app-panel--right ${rightPanelOpen ? 'app-panel--open' : ''}`}>
          <div className="app-panel__inner">
            <ChatPanel />
          </div>
        </div>
      </div>
    </div>
  );
}

