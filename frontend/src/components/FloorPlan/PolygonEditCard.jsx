import React, { useCallback, useEffect, useState } from 'react';
import useStore from '../../store/useStore';
import { savePolygon } from '../../api/client';

export default function PolygonEditCard() {
  const editingPolygon = useStore((s) => s.editingPolygon);
  const setEditingPolygon = useStore((s) => s.setEditingPolygon);
  const updatePolygonInFloor = useStore((s) => s.updatePolygonInFloor);
  const floorPolygons = useStore((s) => s.floorPolygons);

  const [editName, setEditName] = useState('');
  const [editFunction, setEditFunction] = useState('');
  const [saving, setSaving] = useState(false);

  // Load current values when editing polygon changes
  useEffect(() => {
    if (!editingPolygon) return;
    const polys = floorPolygons[editingPolygon.floor_id] || [];
    const poly = polys.find((p) => p.ifc_guid === editingPolygon.ifc_guid);
    if (poly) {
      setEditName(poly.space_name || '');
      setEditFunction(poly.primary_function || '');
    }
  }, [editingPolygon?.ifc_guid]);

  const handleAccept = useCallback(async () => {
    if (!editingPolygon) return;
    setSaving(true);

    const { ifc_guid, floor_id } = editingPolygon;
    const polys = floorPolygons[floor_id] || [];
    const poly = polys.find((p) => p.ifc_guid === ifc_guid);

    const newName = editName.trim() || 'Unassigned';
    const newFn = editFunction.trim() || 'Unassigned';

    // Update in local store (marks edited: true)
    updatePolygonInFloor(floor_id, ifc_guid, {
      space_name: newName,
      primary_function: newFn,
    });

    // Persist to backend
    if (poly?.vertices) {
      savePolygon(ifc_guid, poly.vertices, floor_id, poly.area_m2 ?? null, poly.perimeter_cm ?? null, newName, newFn)
        .catch((err) => console.error('[Delta] Failed to save polygon edit:', err));
    }

    setSaving(false);
    setEditingPolygon(null);
  }, [editingPolygon, editName, editFunction, floorPolygons, updatePolygonInFloor, setEditingPolygon]);

  const handleCancel = useCallback(() => {
    setEditingPolygon(null);
  }, [setEditingPolygon]);

  // Escape to cancel
  useEffect(() => {
    if (!editingPolygon) return;
    const handleKey = (e) => {
      if (e.key === 'Escape') setEditingPolygon(null);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [editingPolygon, setEditingPolygon]);

  if (!editingPolygon) return null;

  const polys = floorPolygons[editingPolygon.floor_id] || [];
  const poly = polys.find((p) => p.ifc_guid === editingPolygon.ifc_guid);
  if (!poly) return null;

  return (
    <div className="match-confirm-card">
      {/* Header */}
      <div className="match-confirm-card__header">
        <span className="match-confirm-card__badge">EDIT ROOM</span>
      </div>

      {/* Editable name */}
      <div className="match-confirm-card__field">
        <label className="match-confirm-card__field-label">Room Name</label>
        <input
          className="match-confirm-card__input"
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          placeholder="Room name..."
          autoFocus
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
        <Row label="Floor" value={editingPolygon.floor_id} />
        <Row label="Area" value={poly.area_m2 != null ? `${Number(poly.area_m2).toFixed(1)} m\u00B2` : null} />
        <Row label="GUID" value={poly.ifc_guid} mono />
      </div>

      {/* Actions */}
      <div className="match-confirm-card__actions">
        <button
          className="match-confirm-card__btn match-confirm-card__btn--accept"
          onClick={handleAccept}
          disabled={saving}
        >
          {saving ? 'Saving...' : 'Accept'}
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
