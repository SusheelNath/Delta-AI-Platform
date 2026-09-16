import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  fetchFurnishingTypes,
  previewFurnishings,
  bulkModifyFurnishings,
} from '../../api/client';
import './FurnishingEditor.css';

const CATEGORY_ORDER = ['Beds', 'Seating', 'Storage', 'Equipment', 'Fixtures', 'Furniture'];

function capitalize(str) {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

export default function FurnishingEditor({
  ifcGuid,
  floorId,
  currentFurnishings,
  area_m2,
  onClose,
  onSaved,
}) {
  const [activeTab, setActiveTab] = useState('current');
  const [catalog, setCatalog] = useState([]);
  const [catalogLoading, setCatalogLoading] = useState(false);

  // Quantities for existing furnishings: { furnishing_id: quantity }
  const [currentQty, setCurrentQty] = useState({});
  // Quantities for new items from catalog: { item_type: quantity }
  const [newQty, setNewQty] = useState({});
  // Track original quantities for change detection
  const [originalQty, setOriginalQty] = useState({});

  // Collapsed category groups in "Add New" tab
  const [collapsedGroups, setCollapsedGroups] = useState({});

  // Preview state
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const previewTimer = useRef(null);

  // Remove-all flag
  const [removeAll, setRemoveAll] = useState(false);

  // Saving state
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // Initialize quantities from currentFurnishings
  useEffect(() => {
    const qty = {};
    const orig = {};
    (currentFurnishings || []).forEach((f) => {
      qty[f.id] = f.quantity;
      orig[f.id] = f.quantity;
    });
    setCurrentQty(qty);
    setOriginalQty(orig);
  }, [currentFurnishings]);

  // Fetch catalog on mount
  useEffect(() => {
    setCatalogLoading(true);
    fetchFurnishingTypes()
      .then((data) => {
        setCatalog(Array.isArray(data) ? data : []);
      })
      .catch(() => setCatalog([]))
      .finally(() => setCatalogLoading(false));
  }, []);

  // Group catalog by category
  const catalogGrouped = useMemo(() => {
    const groups = {};
    catalog.forEach((item) => {
      const cat = capitalize(item.category || 'Other');
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(item);
    });
    // Sort by CATEGORY_ORDER, then any extras
    const sorted = {};
    CATEGORY_ORDER.forEach((c) => {
      if (groups[c]) sorted[c] = groups[c];
    });
    Object.keys(groups).forEach((c) => {
      if (!sorted[c]) sorted[c] = groups[c];
    });
    return sorted;
  }, [catalog]);

  // Existing item_types so catalog "Add New" hides already-present items
  const existingItemTypes = useMemo(() => {
    const set = new Set();
    (currentFurnishings || []).forEach((f) => set.add(f.item_type));
    return set;
  }, [currentFurnishings]);

  // Build the combined furnishing list for preview
  const buildFurnishingList = useCallback(() => {
    if (removeAll) {
      // Only new items
      const items = [];
      Object.entries(newQty).forEach(([itemType, qty]) => {
        if (qty > 0) items.push({ item_type: itemType, quantity: qty });
      });
      return items;
    }
    const items = [];
    // Current items with updated quantities
    (currentFurnishings || []).forEach((f) => {
      const qty = currentQty[f.id] ?? f.quantity;
      if (qty > 0) items.push({ item_type: f.item_type, quantity: qty });
    });
    // New items
    Object.entries(newQty).forEach(([itemType, qty]) => {
      if (qty > 0) items.push({ item_type: itemType, quantity: qty });
    });
    return items;
  }, [removeAll, currentFurnishings, currentQty, newQty]);

  // Debounced preview
  useEffect(() => {
    if (previewTimer.current) clearTimeout(previewTimer.current);
    previewTimer.current = setTimeout(() => {
      const furnList = buildFurnishingList();
      setPreviewLoading(true);
      previewFurnishings(ifcGuid, floorId, furnList)
        .then((data) => {
          setPreview(data);
          setError(null);
        })
        .catch((err) => {
          setError(err.message || 'Preview failed');
        })
        .finally(() => setPreviewLoading(false));
    }, 300);
    return () => {
      if (previewTimer.current) clearTimeout(previewTimer.current);
    };
  }, [currentQty, newQty, removeAll, ifcGuid, floorId, buildFurnishingList]);

  // Handlers
  const updateCurrentQty = (id, delta) => {
    setCurrentQty((prev) => {
      const cur = prev[id] ?? 0;
      const next = Math.max(0, cur + delta);
      return { ...prev, [id]: next };
    });
    setRemoveAll(false);
  };

  const setCurrentQtyDirect = (id, val) => {
    const num = Math.max(0, parseInt(val, 10) || 0);
    setCurrentQty((prev) => ({ ...prev, [id]: num }));
    setRemoveAll(false);
  };

  const updateNewQty = (itemType, delta) => {
    setNewQty((prev) => {
      const cur = prev[itemType] ?? 0;
      const next = Math.max(0, cur + delta);
      return { ...prev, [itemType]: next };
    });
  };

  const setNewQtyDirect = (itemType, val) => {
    const num = Math.max(0, parseInt(val, 10) || 0);
    setNewQty((prev) => ({ ...prev, [itemType]: num }));
  };

  const toggleGroup = (cat) => {
    setCollapsedGroups((prev) => ({ ...prev, [cat]: !(prev[cat] ?? true) }));
  };

  const handleRemoveAll = () => {
    setRemoveAll(true);
    const cleared = {};
    Object.keys(currentQty).forEach((id) => { cleared[id] = 0; });
    setCurrentQty(cleared);
  };

  // Compile changes and save
  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const changes = [];

      if (removeAll) {
        changes.push({ action: 'remove_all' });
      } else {
        // Check existing items for updates and removals
        (currentFurnishings || []).forEach((f) => {
          const qty = currentQty[f.id] ?? f.quantity;
          if (qty === 0) {
            changes.push({ action: 'remove', furnishing_id: f.id });
          } else if (qty !== originalQty[f.id]) {
            changes.push({ action: 'update', furnishing_id: f.id, quantity: qty });
          }
        });
      }

      // New items
      Object.entries(newQty).forEach(([itemType, qty]) => {
        if (qty > 0) {
          changes.push({ action: 'add', item_type: itemType, quantity: qty });
        }
      });

      if (changes.length === 0) {
        onClose();
        return;
      }

      const result = await bulkModifyFurnishings(ifcGuid, floorId, changes);
      onSaved(result.furnishings, result.metrics);
    } catch (err) {
      setError(err.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  // Progress bar color
  const usedPct = preview?.used_pct ?? 0;
  const barColor = usedPct > 80 ? '#ef4444' : usedPct > 60 ? '#E77133' : '#16a34a';
  const overCapacity = preview?.over_capacity ?? false;

  // Check if there are any changes
  const hasChanges = useMemo(() => {
    if (removeAll) return true;
    const currentChanged = (currentFurnishings || []).some(
      (f) => (currentQty[f.id] ?? f.quantity) !== originalQty[f.id]
    );
    const newAdded = Object.values(newQty).some((q) => q > 0);
    return currentChanged || newAdded;
  }, [removeAll, currentFurnishings, currentQty, originalQty, newQty]);

  return (
    <div className="fe">
      {/* Tab bar */}
      <div className="fe__tabs">
        <button
          className={`fe__tab ${activeTab === 'current' ? 'fe__tab--active' : ''}`}
          onClick={() => setActiveTab('current')}
        >
          Current
          {(currentFurnishings || []).length > 0 && (
            <span className="fe__tab-count">{(currentFurnishings || []).length}</span>
          )}
        </button>
        <button
          className={`fe__tab ${activeTab === 'add' ? 'fe__tab--active' : ''}`}
          onClick={() => setActiveTab('add')}
        >
          Add New
        </button>
      </div>

      {/* Scrollable body */}
      <div className="fe__body">
        {/* Current tab */}
        {activeTab === 'current' && (
          <div className="fe__list">
            {(!currentFurnishings || currentFurnishings.length === 0) ? (
              <div className="fe__empty">No furnishings assigned</div>
            ) : (
              <>
                {currentFurnishings.map((f) => {
                  const qty = currentQty[f.id] ?? f.quantity;
                  const isRemoved = qty === 0;
                  return (
                    <div
                      key={f.id}
                      className={`fe__item ${isRemoved ? 'fe__item--removed' : ''}`}
                    >
                      <div className="fe__item-info">
                        <span className="fe__item-label">
                          {f.label || f.item_type}
                        </span>
                        <span className="fe__item-meta">
                          {f.footprint_m2 > 0 ? `${f.footprint_m2} m\u00B2` : ''}
                          {f.normal_occ > 0 ? ` \u00B7 ${f.normal_occ} occ` : ''}
                        </span>
                      </div>
                      <div className="fe__stepper">
                        <button
                          className="fe__stepper-btn"
                          onClick={() => updateCurrentQty(f.id, -1)}
                          disabled={isRemoved}
                        >
                          &minus;
                        </button>
                        <input
                          className="fe__stepper-val"
                          type="text"
                          value={qty}
                          onChange={(e) => setCurrentQtyDirect(f.id, e.target.value)}
                        />
                        <button
                          className="fe__stepper-btn"
                          onClick={() => updateCurrentQty(f.id, 1)}
                        >
                          +
                        </button>
                      </div>
                    </div>
                  );
                })}
                <button
                  className="fe__remove-all"
                  onClick={handleRemoveAll}
                  disabled={removeAll}
                >
                  Remove All
                </button>
              </>
            )}
          </div>
        )}

        {/* Add New tab */}
        {activeTab === 'add' && (
          <div className="fe__catalog">
            {catalogLoading ? (
              <div className="fe__empty">Loading catalog...</div>
            ) : Object.keys(catalogGrouped).length === 0 ? (
              <div className="fe__empty">No furnishing types available</div>
            ) : (
              Object.entries(catalogGrouped).map(([category, items]) => {
                const isCollapsed = collapsedGroups[category] ?? true;
                // Filter out items already in current furnishings
                const filteredItems = items.filter(
                  (item) => !existingItemTypes.has(item.item_type)
                );
                if (filteredItems.length === 0) return null;
                return (
                  <div key={category} className="fe__group">
                    <button
                      className="fe__group-header"
                      onClick={() => toggleGroup(category)}
                    >
                      <span className={`fe__group-arrow ${isCollapsed ? '' : 'fe__group-arrow--open'}`}>
                        &#9656;
                      </span>
                      <span className="fe__group-name">{category}</span>
                      <span className="fe__group-count">{filteredItems.length}</span>
                    </button>
                    <div className={`fe__group-body ${isCollapsed ? 'fe__group-body--collapsed' : ''}`}>
                      <div className="fe__group-items">
                        {filteredItems.map((item) => {
                          const qty = newQty[item.item_type] ?? 0;
                          return (
                            <div key={item.item_type} className="fe__item">
                              <div className="fe__item-info">
                                <span className="fe__item-label">{item.label || item.item_type}</span>
                                <span className="fe__item-meta">
                                  {item.footprint_m2 > 0 ? `${item.footprint_m2} m\u00B2` : ''}
                                  {item.normal_occ > 0 ? ` \u00B7 ${item.normal_occ} occ` : ''}
                                  {item.max_occ > 0 && item.max_occ !== item.normal_occ ? ` \u00B7 max ${item.max_occ}` : ''}
                                </span>
                              </div>
                              <div className="fe__stepper">
                                <button
                                  className="fe__stepper-btn"
                                  onClick={() => updateNewQty(item.item_type, -1)}
                                  disabled={qty === 0}
                                >
                                  &minus;
                                </button>
                                <input
                                  className="fe__stepper-val"
                                  type="text"
                                  value={qty}
                                  onChange={(e) => setNewQtyDirect(item.item_type, e.target.value)}
                                />
                                <button
                                  className="fe__stepper-btn"
                                  onClick={() => updateNewQty(item.item_type, 1)}
                                >
                                  +
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* Live validation bar */}
      <div className="fe__validation">
        <div className="fe__validation-row">
          <span className="fe__validation-label">
            Used: {preview ? `${Number(preview.used_area_m2).toFixed(1)} m\u00B2 / ${Number(preview.area_m2 ?? area_m2).toFixed(1)} m\u00B2` : '--'}
            {preview ? ` (${Math.round(usedPct)}%)` : ''}
          </span>
          {previewLoading && <span className="fe__validation-loading">\u2022\u2022\u2022</span>}
        </div>
        <div className="fe__bar-track">
          <div
            className="fe__bar-fill"
            style={{ width: `${Math.min(100, usedPct)}%`, backgroundColor: barColor }}
          />
        </div>
        {preview && (
          <div className="fe__validation-occ">
            Occupancy: {preview.normal_occupancy ?? 0} / {preview.max_occupancy ?? 0} / {preview.absolute_occupancy ?? 0}
          </div>
        )}
        {overCapacity && preview?.message && (
          <div className="fe__validation-error">{preview.message}</div>
        )}
        {error && (
          <div className="fe__validation-error">{error}</div>
        )}
      </div>

      {/* Action buttons */}
      <div className="fe__actions">
        <button
          className="fe__btn fe__btn--cancel"
          onClick={onClose}
          disabled={saving}
        >
          Cancel
        </button>
        <button
          className="fe__btn fe__btn--save"
          onClick={handleSave}
          disabled={overCapacity || saving || !hasChanges}
        >
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>
    </div>
  );
}
