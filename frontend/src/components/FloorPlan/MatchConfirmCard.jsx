import React, { useCallback, useEffect, useState } from 'react';
import useStore from '../../store/useStore';
import { savePolygon, updateSpace, fetchSpaceByGuid } from '../../api/client';
import { computePolygonMetrics } from '../../utils/unprojectPolygon';

export default function MatchConfirmCard() {
  const activeFloorId = useStore((s) => s.activeFloorId);
  const candidates = useStore((s) => s.matchCandidateList);
  const index = useStore((s) => s.matchCandidateIndex);
  const nextMatchCandidate = useStore((s) => s.nextMatchCandidate);
  const clearPendingPolygon = useStore((s) => s.clearPendingPolygon);
  const addPolygonToFloor = useStore((s) => s.addPolygonToFloor);

  const candidate = candidates[index] || null;

  // Full space data fetched from API
  const [spaceData, setSpaceData] = useState(null);
  const [loading, setLoading] = useState(false);

  // Editable fields
  const [editName, setEditName] = useState('');
  const [editFunction, setEditFunction] = useState('');
  const [saving, setSaving] = useState(false);
  const [previewMetrics, setPreviewMetrics] = useState(null); // { area_m2, perimeter_m }

  // Compute polygon metrics from drawn vertices for preview
  useEffect(() => {
    const verts = useStore.getState().pendingPolygonVertices;
    const floorId = useStore.getState().activeFloorId;
    const snapshot = useStore.getState().floorSnapshots[floorId];
    if (!verts || verts.length < 3 || !snapshot?.viewMatrix || !snapshot?.projMatrix) {
      setPreviewMetrics(null);
      return;
    }
    const geom = useStore.getState().floorSpaceGeometry?.[floorId] || [];
    const avgY = geom.length > 0
      ? geom.reduce((sum, s) => sum + (s.y || 0), 0) / geom.length
      : 0;
    const m = computePolygonMetrics(verts, snapshot.viewMatrix, snapshot.projMatrix, avgY);
    setPreviewMetrics(m ? { area_m2: Math.round(m.area_m2 * 100) / 100, perimeter_m: m.perimeter_m } : null);
  }, [candidate?.id]);

  // Fetch full space data whenever candidate changes
  useEffect(() => {
    if (!candidate) { setSpaceData(null); return; }
    setLoading(true);
    fetchSpaceByGuid(candidate.id)
      .then((data) => {
        setSpaceData(data);
        setEditName(data.space_name || candidate.name || '');
        setEditFunction(data.primary_function || '');
      })
      .catch(() => {
        setSpaceData(null);
        setEditName(candidate.name || '');
        setEditFunction('');
      })
      .finally(() => setLoading(false));
  }, [candidate?.id]);

  const handleAccept = useCallback(async () => {
    if (!candidate) return;

    // Read vertices fresh from store
    const verts = useStore.getState().pendingPolygonVertices;
    const floorId = useStore.getState().activeFloorId;

    // Compute real-world metrics from polygon geometry using snapshot matrices
    const snapshot = useStore.getState().floorSnapshots[floorId];
    let metrics = null;
    if (snapshot?.viewMatrix && snapshot?.projMatrix) {
      const geom = useStore.getState().floorSpaceGeometry?.[floorId] || [];
      const avgY = geom.length > 0
        ? geom.reduce((sum, s) => sum + (s.y || 0), 0) / geom.length
        : 0;
      metrics = computePolygonMetrics(verts, snapshot.viewMatrix, snapshot.projMatrix, avgY);
    }

    const areaM2 = metrics ? Math.round(metrics.area_m2 * 100) / 100 : (spaceData?.area_m2 ?? null);
    const perimeterCm = metrics ? Math.round(metrics.perimeter_m * 100) : null;

    // Add polygon to store (immediately persisted to localStorage)
    const localPolygon = {
      ifc_guid: candidate.id,
      floor_id: floorId,
      vertices: verts,
      space_name: editName.trim() || candidate.name,
      primary_function: editFunction.trim() || null,
      area_m2: areaM2,
    };
    addPolygonToFloor(floorId, localPolygon);

    // Close card and let user draw next room immediately
    clearPendingPolygon();

    // Also save to backend (non-blocking, localStorage is the source of truth)
    savePolygon(candidate.id, verts, floorId, metrics?.area_m2 ?? null, perimeterCm).catch((err) => {
      console.error('[Delta] Failed to save polygon to server:', err);
    });

    // Update space name/function if changed
    const origName = spaceData?.space_name || candidate.name || '';
    const origFn = spaceData?.primary_function || '';
    const updates = {};
    if (editName.trim() && editName.trim() !== origName) updates.space_name = editName.trim();
    if (editFunction.trim() !== origFn) updates.primary_function = editFunction.trim();
    if (Object.keys(updates).length > 0) {
      updateSpace(candidate.id, updates).catch(() => {});
    }
  }, [candidate, addPolygonToFloor, clearPendingPolygon, spaceData, editName, editFunction]);

  const handleNext = useCallback(() => {
    if (index < candidates.length - 1) nextMatchCandidate();
  }, [index, candidates.length, nextMatchCandidate]);

  const handleCancel = useCallback(() => {
    clearPendingPolygon();
  }, [clearPendingPolygon]);

  if (!candidate) return null;

  const s = spaceData || {};
  const isLast = index >= candidates.length - 1;

  return (
    <div className="match-confirm-card">
      {/* Header */}
      <div className="match-confirm-card__header">
        <span className="match-confirm-card__badge">MATCH ROOM</span>
        <span className="match-confirm-card__count">{index + 1} / {candidates.length}</span>
      </div>

      {loading ? (
        <div className="match-confirm-card__loading">Loading space data...</div>
      ) : (
        <>
          {/* Editable name */}
          <div className="match-confirm-card__field">
            <label className="match-confirm-card__field-label">Room Name</label>
            <input
              className="match-confirm-card__input"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              placeholder="Room name..."
            />
          </div>

          {/* Editable function */}
          <div className="match-confirm-card__field">
            <label className="match-confirm-card__field-label">Function</label>
            <input
              className="match-confirm-card__input match-confirm-card__input--fn"
              value={editFunction}
              onChange={(e) => setEditFunction(e.target.value)}
              placeholder="Assign function..."
            />
          </div>

          {/* Data rows */}
          <div className="match-confirm-card__data">
            <Row label="Match" value={candidate.inside ? 'Center inside polygon' : `${candidate.distance.toFixed(1)}% away`} />
            <Row label="Floor" value={s.floor_name || s.floor_id || activeFloorId} />
            <Row label="Zone" value={s.functional_zone} />
            <Row label="Area" value={previewMetrics ? `${previewMetrics.area_m2.toFixed(1)} m\u00B2` : (s.area_m2 != null ? `${Number(s.area_m2).toFixed(1)} m\u00B2` : null)} />
            <Row label="Perimeter" value={previewMetrics ? `${Math.round(previewMetrics.perimeter_m * 100)} cm` : (s.perimeter_cm ? `${Number(s.perimeter_cm).toFixed(0)} cm` : null)} />
            <Row label="Occupancy" value={s.normal_occupancy} />
            <Row label="Max Occupancy" value={s.max_occupancy} />
            <Row label="Patient Capacity" value={s.patient_capacity} />
            <Row label="Space Class" value={s.space_class} />
            <Row label="Accessible" value={s.accessible} />
            <Row label="Bookable" value={s.bookable} />
            <Row label="Privacy" value={s.privacy_level} />
            <Row label="Noise Sensitivity" value={s.noise_sensitivity} />
            <Row label="Room #" value={s.room_number} />
            <Row label="IFC GUID" value={s.ifc_guid} mono />
          </div>
        </>
      )}

      {/* Actions */}
      <div className="match-confirm-card__actions">
        <button
          className="match-confirm-card__btn match-confirm-card__btn--accept"
          onClick={handleAccept}
          disabled={saving}
        >
          {saving ? 'Saving...' : 'Accept'}
        </button>
        <button
          className="match-confirm-card__btn match-confirm-card__btn--next"
          onClick={handleNext}
          disabled={isLast}
        >
          Try Next
        </button>
        <button className="match-confirm-card__btn match-confirm-card__btn--cancel" onClick={handleCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function Row({ label, value, mono }) {
  if (!value || value === '--') return null;
  return (
    <div className="match-confirm-card__row">
      <span className="match-confirm-card__row-label">{label}</span>
      <span className={`match-confirm-card__row-value ${mono ? 'match-confirm-card__row-value--mono' : ''}`}>{value}</span>
    </div>
  );
}
