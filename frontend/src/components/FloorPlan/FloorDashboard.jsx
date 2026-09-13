import React, { useMemo } from 'react';
import useStore from '../../store/useStore';
import './FloorDashboard.css';

const EMPTY = [];

/**
 * Interactive floor-level KPI dashboard.
 * Shows occupancy, area utilization, and function breakdown as mini bars.
 */
export default function FloorDashboard() {
  const activeFloorId = useStore((s) => s.activeFloorId);
  const polygons = useStore((s) => s.activeFloorId ? (s.floorPolygons[s.activeFloorId] || EMPTY) : EMPTY);

  const stats = useMemo(() => {
    if (!polygons.length) return null;

    let totalArea = 0;
    let totalOcc = 0;
    let occupiableCount = 0;
    const funcMap = {};

    for (const p of polygons) {
      const area = p.area_m2 || 0;
      const occ = p.max_occupancy || 0;
      totalArea += area;
      totalOcc += occ;
      if (occ > 0) occupiableCount++;

      const fn = p.primary_function || 'Unassigned';
      if (!funcMap[fn]) funcMap[fn] = { count: 0, area: 0, occ: 0 };
      funcMap[fn].count++;
      funcMap[fn].area += area;
      funcMap[fn].occ += occ;
    }

    // Sort by area descending, take top 6
    const funcs = Object.entries(funcMap)
      .sort(([, a], [, b]) => b.area - a.area)
      .slice(0, 6)
      .map(([name, data]) => ({
        name,
        count: data.count,
        area: data.area,
        occ: data.occ,
        pct: totalArea > 0 ? (data.area / totalArea) * 100 : 0,
      }));

    return {
      totalSpaces: polygons.length,
      totalArea,
      totalOcc,
      occupiableCount,
      occupiablePct: polygons.length > 0 ? (occupiableCount / polygons.length) * 100 : 0,
      funcs,
    };
  }, [polygons]);

  if (!activeFloorId || !stats) return null;

  return (
    <div className="floor-dashboard">
      {/* KPI row */}
      <div className="floor-dashboard__kpis">
        <div className="floor-dashboard__kpi">
          <span className="floor-dashboard__kpi-value">{stats.totalSpaces}</span>
          <span className="floor-dashboard__kpi-label">Spaces</span>
        </div>
        <div className="floor-dashboard__kpi-divider" />
        <div className="floor-dashboard__kpi">
          <span className="floor-dashboard__kpi-value">{Number(stats.totalArea).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
          <span className="floor-dashboard__kpi-label">m²</span>
        </div>
        <div className="floor-dashboard__kpi-divider" />
        <div className="floor-dashboard__kpi">
          <span className="floor-dashboard__kpi-value">{stats.totalOcc.toLocaleString()}</span>
          <span className="floor-dashboard__kpi-label">Max Occ</span>
        </div>
        <div className="floor-dashboard__kpi-divider" />
        <div className="floor-dashboard__kpi">
          <span className="floor-dashboard__kpi-value">{stats.occupiablePct.toFixed(0)}%</span>
          <span className="floor-dashboard__kpi-label">Occupiable</span>
        </div>
      </div>

      {/* Function breakdown bars */}
      <div className="floor-dashboard__funcs">
        {stats.funcs.map((f) => (
          <div key={f.name} className="floor-dashboard__func-row">
            <span className="floor-dashboard__func-name" title={f.name}>{f.name}</span>
            <div className="floor-dashboard__func-bar-track">
              <div
                className="floor-dashboard__func-bar-fill"
                style={{ width: `${Math.max(f.pct, 2)}%` }}
              />
            </div>
            <span className="floor-dashboard__func-stat">{f.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
