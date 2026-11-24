import React from 'react';
import useStore from '../../store/useStore';
import './LayerPanel.css';

const LAYERS = [
  { key: 'walls',       label: 'Walls' },
  { key: 'slabs',       label: 'Floors & Slabs' },
  { key: 'roofs',       label: 'Roofs' },
  { key: 'windows',     label: 'Windows & Glazing' },
  { key: 'doors',       label: 'Doors' },
  { key: 'structure',   label: 'Structure' },
  { key: 'stairs',      label: 'Stairs & Ramps' },
  { key: 'furnishings', label: 'Furnishings' },
  { key: 'coverings',   label: 'Coverings' },
  { key: 'mep',         label: 'MEP Systems' },
  { key: 'spaces',      label: 'Spaces' },
  { key: 'other',       label: 'Other' },
];

export default function LayerPanel() {
  const open = useStore((s) => s.layerPanelOpen);
  const visibility = useStore((s) => s.layerVisibility);
  const counts = useStore((s) => s.layerCounts);
  const toggleLayer = useStore((s) => s.toggleLayer);
  const togglePanel = useStore((s) => s.toggleLayerPanel);
  const setAllVisible = useStore((s) => s.setAllLayersVisible);

  const allOn = Object.values(visibility).every(Boolean);
  const allOff = Object.values(visibility).every((v) => !v);

  if (!open) {
    return (
      <button className="layer-panel__toggle-btn" onClick={togglePanel}>
        <svg width="22" height="22" viewBox="0 0 18 18" fill="none">
          <path d="M9 2L2 6l7 4 7-4-7-4z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
          <path d="M2 9l7 4 7-4" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
          <path d="M2 12l7 4 7-4" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
        </svg>
      </button>
    );
  }

  return (
    <div className="layer-panel">
      <div className="layer-panel__header">
        <span className="layer-panel__title">Layers</span>
        <button className="layer-panel__close" onClick={togglePanel} title="Close layers">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <div className="layer-panel__list">
        {LAYERS.map(({ key, label }) => {
          const count = counts[key] || 0;
          if (count === 0 && key !== 'other') return null;
          return (
            <label key={key} className="layer-panel__row">
              <input
                type="checkbox"
                checked={visibility[key] !== false}
                onChange={() => toggleLayer(key)}
                className="layer-panel__checkbox"
              />
              <span className="layer-panel__label">{label}</span>
              {count > 0 && (
                <span className="layer-panel__count">{count.toLocaleString()}</span>
              )}
            </label>
          );
        })}
      </div>

      <div className="layer-panel__footer">
        <button
          className="layer-panel__bulk-btn"
          onClick={() => setAllVisible(!allOn)}
        >
          {allOn ? 'Hide All' : 'Show All'}
        </button>
      </div>
    </div>
  );
}
