import React, { useState } from 'react';
import ReactDOM from 'react-dom';
import useStore from '../../store/useStore';
import './RepurposePanel.css';

// Functions that cannot be repurposed - mirrors backend NON_REPURPOSABLE_FUNCTIONS
const NON_REPURPOSABLE = new Set([
  'corridor', 'corridor access', 'elevator', 'staircase', 'staircasse',
  'ramp', 'no access', 'no acccess', 'no infrastructure',
  'ventilation shaft', 'vent', 'technical', 'main hall',
  'ambulance', 'atrium', 'basement', 'waste',
]);

function isNonRepurposable(fn) {
  return NON_REPURPOSABLE.has((fn || '').toLowerCase());
}

const SCORE_META = {
  area_fit:            { label: 'Size Match',         meaning: 'How well the room\u2019s m\u00B2 fits the target function' },
  distribution_gap:    { label: 'Service Demand',     meaning: 'How urgently this floor needs this function' },
  adjacency:           { label: 'Location Synergy',   meaning: 'Benefit from being near complementary rooms' },
  zone_fit:            { label: 'Zone Fit',            meaning: 'Does the surrounding area match the target\u2019s category?' },
  infrastructure:      { label: 'Infrastructure',      meaning: 'Are required MEP systems already in place?' },
  regulatory:          { label: 'Regulatory',          meaning: 'Complexity of permits and compliance for this change' },
  furnishing_reuse:    { label: 'Asset Retention',     meaning: 'How much existing furniture carries over' },
  cost_efficiency:     { label: 'Cost Efficiency',     meaning: 'Lower conversion cost = higher score' },
  revenue_impact:      { label: 'Revenue Impact',      meaning: 'Financial upside of the conversion' },
  service_continuity:  { label: 'Service Continuity',  meaning: 'Risk of removing this function from the floor' },
  patient_flow:        { label: 'Patient Flow',        meaning: 'Impact on patient journey and care pathways' },
  operational_complexity: { label: 'Conversion Ease',  meaning: 'How disruptive and complex the conversion process is' },
  utilisation_potential:  { label: 'Utilisation',      meaning: 'Expected usage based on area, demand, and function type' },
};

function ScoreBar({ scoreKey, value, reason, onHover, onLeave }) {
  const meta = SCORE_META[scoreKey] || { label: scoreKey, meaning: '' };
  const color = value >= 75 ? '#16a34a' : value >= 50 ? '#E77133' : '#ef4444';

  return (
    <div
      className="rp__score-row"
      onMouseEnter={(e) => onHover(scoreKey, e)}
      onMouseMove={(e) => onHover(scoreKey, e)}
      onMouseLeave={onLeave}
    >
      <span className="rp__score-label">{meta.label}</span>
      <div className="rp__score-track">
        <div className="rp__score-fill" style={{ width: `${value}%`, background: color }} />
      </div>
      <span className="rp__score-val" style={{ color }}>{value}</span>
    </div>
  );
}

function ScoreBreakdown({ scores, scoreReasons }) {
  const [tip, setTip] = useState(null);
  const keys = Object.keys(scores || {});
  if (keys.length === 0) return null;

  const handleHover = (key, e) => {
    setTip({ key, x: e.clientX, y: e.clientY });
  };
  const handleLeave = () => setTip(null);

  const tipMeta = tip ? (SCORE_META[tip.key] || { label: tip.key }) : null;
  const tipVal = tip ? scores[tip.key] : 0;
  const tipReason = tip ? (scoreReasons?.[tip.key] || tipMeta?.meaning || '') : '';
  const tipColor = tipVal >= 75 ? '#16a34a' : tipVal >= 50 ? '#E77133' : '#ef4444';

  return (
    <div className="rp__scores">
      {keys.map((key) => (
        <ScoreBar key={key} scoreKey={key} value={scores[key]} reason={scoreReasons?.[key]}
          onHover={handleHover} onLeave={handleLeave} />
      ))}
      {tip && ReactDOM.createPortal(
        <div className="rp__score-tip" style={{ top: tip.y, left: tip.x + 48 }}>
          <div className="rp__score-tip-head">
            <span>{tipMeta.label}</span>
            <span style={{ color: tipColor }}>{tipVal}/100</span>
          </div>
          <div className="rp__score-tip-reason">{tipReason}</div>
        </div>,
        document.body
      )}
    </div>
  );
}

function FurnishingDelta({ delta }) {
  if (!delta) return null;
  const { keep, remove, add } = delta;

  const keepCount = keep?.length || 0;
  const removeCount = remove?.length || 0;
  const addCount = add?.length || 0;
  const totalItems = keepCount + removeCount + addCount;
  const reuseRate = totalItems > 0 ? Math.round((keepCount / totalItems) * 100) : 0;
  const addTotal = (add || []).reduce((s, f) => s + (f.unit_cost || 0) * (f.quantity || 0), 0);

  return (
    <div className="rp__furn-delta">
      {/* Reuse summary bar */}
      <div className="rp__furn-summary">
        <div className="rp__furn-summary-bar">
          {keepCount > 0 && <div className="rp__furn-seg rp__furn-seg--keep" style={{ flex: keepCount }} />}
          {removeCount > 0 && <div className="rp__furn-seg rp__furn-seg--remove" style={{ flex: removeCount }} />}
          {addCount > 0 && <div className="rp__furn-seg rp__furn-seg--add" style={{ flex: addCount }} />}
        </div>
        <div className="rp__furn-summary-text">
          {reuseRate}% reuse &middot; {keepCount} kept, {removeCount} removed, {addCount} new
          {addTotal > 0 && <> &middot; &euro;{addTotal.toLocaleString()} procurement</>}
        </div>
      </div>

      {/* Keep card */}
      {keepCount > 0 && (
        <div className="rp__furn-card rp__furn-card--keep">
          <div className="rp__furn-card-head">
            <span className="rp__furn-card-icon">&#10003;</span>
            <span className="rp__furn-card-title">Retain</span>
            <span className="rp__furn-card-count">{keepCount}</span>
          </div>
          <div className="rp__furn-card-list">
            {keep.map((f) => (
              <div key={f.item_type} className="rp__furn-row">
                <span className="rp__furn-row-qty">{f.quantity}&times;</span>
                <span className="rp__furn-row-name">{f.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Remove card */}
      {removeCount > 0 && (
        <div className="rp__furn-card rp__furn-card--remove">
          <div className="rp__furn-card-head">
            <span className="rp__furn-card-icon">&times;</span>
            <span className="rp__furn-card-title">Remove</span>
            <span className="rp__furn-card-count">{removeCount}</span>
          </div>
          <div className="rp__furn-card-list">
            {remove.map((f) => (
              <div key={f.item_type} className="rp__furn-row">
                <span className="rp__furn-row-qty">{f.quantity}&times;</span>
                <span className="rp__furn-row-name">{f.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Add card */}
      {addCount > 0 && (
        <div className="rp__furn-card rp__furn-card--add">
          <div className="rp__furn-card-head">
            <span className="rp__furn-card-icon">+</span>
            <span className="rp__furn-card-title">Procure</span>
            <span className="rp__furn-card-count">{addCount}</span>
          </div>
          <div className="rp__furn-card-list">
            {add.map((f) => {
              const cost = (f.unit_cost || 0) * (f.quantity || 0);
              return (
                <div key={f.item_type} className="rp__furn-row">
                  <span className="rp__furn-row-qty">{f.quantity}&times;</span>
                  <span className="rp__furn-row-name">{f.label}</span>
                  {cost > 0 && <span className="rp__furn-row-cost">&euro;{cost.toLocaleString()}</span>}
                </div>
              );
            })}
          </div>
          {addTotal > 0 && (
            <div className="rp__furn-card-total">
              <span>Total procurement</span>
              <span>&euro;{addTotal.toLocaleString()}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Costs Tab ── */

const COST_LABELS = {
  paint_flooring: 'Paint & flooring',
  ceiling_walls: 'Ceiling & walls',
  mep_services: 'MEP services',
  removal: 'Removal & disposal',
  new_purchase: 'New purchase',
  installation: 'Installation & fitting',
  fire_safety_review: 'Fire safety review',
  accessibility_audit: 'Accessibility audit',
  infection_control: 'Infection control review',
  permitting_fees: 'Permitting & approvals',
  environmental_review: 'Environmental assessment',
  medical_gas: 'Medical gas install',
  nurse_call: 'Nurse call install',
  hvac_upgrade: 'HVAC upgrade (surgical)',
  plumbing: 'Plumbing / new sink',
  data_cabling: 'Data cabling point',
};

const LABOUR_LABELS = {
  general_contractor: 'General contractor',
  specialist_trades: 'Specialist trades',
  medical_gas_installer: 'Medical gas installer',
  project_management: 'Project management',
  health_safety_officer: 'Health & safety officer',
  clerk_of_works: 'Clerk of works',
};

const PERMIT_LABELS = {
  building_permit: 'Building permit',
  change_of_use: 'Change of use permit',
  fire_inspection: 'Fire department inspection',
  health_authority: 'Health authority approval',
  occupation_certificate: 'Occupation certificate',
  environmental_clearance: 'Environmental clearance',
};

const CONCESSION_LABELS = {
  framework_discount: 'Framework agreement discount',
  trade_in_credit: 'Equipment trade-in credit',
  bulk_procurement: 'Volume procurement discount',
  warranty_transfer: 'Warranty transfer savings',
  reuse_savings: 'Asset reuse savings',
};

const DISRUPTION_LABELS = {
  temporary_relocation: 'Temporary relocation',
  wayfinding_signage: 'Wayfinding & signage',
  it_reconfiguration: 'IT system reconfiguration',
  staff_retraining: 'Staff retraining',
  adjacent_mitigation: 'Adjacent space mitigation',
  patient_scheduling: 'Patient scheduling loss',
  communication_plan: 'Communication plan',
};

const COMMISSIONING_LABELS = {
  systems_testing: 'Systems testing & commissioning',
  infection_control_clean: 'Infection control deep clean',
  snagging: 'Snagging / defects allowance',
  equipment_calibration: 'Equipment calibration',
  as_built_docs: 'As-built documentation',
  staff_orientation: 'Staff orientation',
};

const CONTINGENCY_LABELS = {
  base: 'Base contingency',
  complexity: 'Complexity premium',
  regulatory: 'Regulatory risk buffer',
  supply_chain: 'Supply chain buffer',
};

function CostSection({ label, data, keys, explanation, onTipEnter, onTipLeave }) {
  if (!data) return null;
  const hasLines = keys.some((k) => {
    const v = typeof data[k] === 'object' ? data[k]?.amount : data[k];
    return v && v !== 0;
  });
  return (
    <div className="rp__cost-section">
      <div className="rp__cost-header">
        <span>
          {label}
          {explanation && (
            <span
              className="rp__cost-info"
              onMouseEnter={(e) => onTipEnter?.(explanation, e)}
              onMouseMove={(e) => onTipEnter?.(explanation, e)}
              onMouseLeave={onTipLeave}
            >&#9432;</span>
          )}
        </span>
        <span>&euro;{(data.subtotal || 0).toLocaleString()}</span>
      </div>
      {hasLines && keys.map((k) => {
        const raw = data[k];
        const val = typeof raw === 'object' ? raw?.amount : raw;
        const itemExpl = typeof raw === 'object' ? raw?.explanation : null;
        if (!val || val === 0) return null;
        return (
          <div key={k} className="rp__cost-line">
            <span>
              {COST_LABELS[k] || k.replace(/_/g, ' ')}
              {itemExpl && (
                <span
                  className="rp__cost-info"
                  onMouseEnter={(e) => onTipEnter?.(itemExpl, e)}
                  onMouseMove={(e) => onTipEnter?.(itemExpl, e)}
                  onMouseLeave={onTipLeave}
                >&#9432;</span>
              )}
            </span>
            <span>&euro;{val.toLocaleString()}</span>
          </div>
        );
      })}
    </div>
  );
}

function CostBreakdown({ costs }) {
  if (!costs) return null;

  const [tip, setTip] = useState(null);

  const handleTipEnter = (text, e) => {
    setTip({ text, x: e.clientX, y: e.clientY });
  };
  const handleTipLeave = () => setTip(null);

  const infraKeys = Object.keys(costs.infrastructure || {}).filter(
    (k) => k !== 'subtotal' && k !== 'explanation'
  );
  const complianceKeys = Object.keys(costs.compliance || {}).filter(
    (k) => k !== 'subtotal' && k !== 'explanation'
  );

  // Helper to build tooltip text for labour detail
  const labourTipText = (detail) => {
    if (!detail) return '';
    const parts = [];
    if (detail.explanation) parts.push(detail.explanation);
    if (detail.workers) parts.push(`Workers: ${detail.workers}`);
    if (detail.weeks) parts.push(`Duration: ${detail.weeks} weeks`);
    if (detail.rate) parts.push(`Rate: \u20AC${detail.rate.toLocaleString()}`);
    return parts.join('\n');
  };

  // Helper to build tooltip text for permit detail
  const permitTipText = (detail) => {
    if (!detail) return '';
    const parts = [];
    if (detail.explanation) parts.push(detail.explanation);
    if (detail.required != null) parts.push(`Required: ${detail.required ? 'Yes' : 'No'}`);
    if (detail.processing_weeks) parts.push(`Processing: ${detail.processing_weeks} weeks`);
    return parts.join('\n');
  };

  // Vendor concessions: filter items with non-zero amount
  const concessionKeys = Object.keys(CONCESSION_LABELS).filter((k) => {
    const item = costs.vendor_concessions?.[k];
    return item && item.amount !== 0;
  });
  const hasConcessions = costs.vendor_concessions && concessionKeys.length > 0;

  // Contingency breakdown keys
  const contingencyKeys = Object.keys(CONTINGENCY_LABELS).filter((k) => {
    const item = costs.contingency_breakdown?.[k];
    return item && item.amount > 0;
  });
  const hasContingency = costs.contingency_breakdown && contingencyKeys.length > 0;

  // Labour keys
  const labourKeys = Object.keys(LABOUR_LABELS).filter((k) => {
    const item = costs.labour?.[k];
    return item && (typeof item === 'object' ? item.amount : item) > 0;
  });
  const hasLabour = costs.labour && labourKeys.length > 0;

  // Permit keys
  const permitKeys = Object.keys(PERMIT_LABELS).filter((k) => {
    const item = costs.commune_permits?.[k];
    return item && (typeof item === 'object' ? item.amount : item) > 0;
  });
  const hasPermits = costs.commune_permits && permitKeys.length > 0;

  // Commissioning keys
  const commissioningKeys = Object.keys(COMMISSIONING_LABELS).filter((k) => {
    const item = costs.commissioning?.[k];
    return item && (typeof item === 'object' ? item.amount : item) > 0;
  });
  const hasCommissioning = costs.commissioning && commissioningKeys.length > 0;

  // Disruption keys
  const disruptionKeys = Object.keys(DISRUPTION_LABELS).filter((k) => {
    const item = costs.disruption?.[k];
    return item && (typeof item === 'object' ? item.amount : item) > 0;
  });
  const hasDisruption = costs.disruption && disruptionKeys.length > 0;

  // Financial structure
  const fin = costs.financial_structure;

  return (
    <div className="rp__costs">

      {/* 1. Cost Drivers */}
      {costs.cost_drivers?.length > 0 && (
        <div className="rp__cost-drivers">
          {costs.cost_drivers.map((d, i) => (
            <div key={i} className="rp__cost-driver-item">
              <span className="rp__cost-driver-dot" />
              <span>{d}</span>
            </div>
          ))}
        </div>
      )}

      {/* 2. Renovation */}
      <CostSection label="Renovation" data={costs.renovation}
        keys={['paint_flooring', 'ceiling_walls', 'mep_services']}
        explanation={costs.renovation?.explanation}
        onTipEnter={handleTipEnter} onTipLeave={handleTipLeave} />

      {/* 3. Furnishings */}
      <CostSection label="Furnishings" data={costs.furnishing}
        keys={['removal', 'new_purchase', 'installation']}
        onTipEnter={handleTipEnter} onTipLeave={handleTipLeave} />

      {/* 4. Vendor Concessions & Savings */}
      {hasConcessions && (
        <div className="rp__savings">
          <div className="rp__savings-header">
            <span>Vendor Concessions &amp; Savings</span>
            <span>&euro;{(costs.vendor_concessions.subtotal || 0).toLocaleString()}</span>
          </div>
          <div className="rp__savings-cards">
            {concessionKeys.map((k) => {
              const item = costs.vendor_concessions[k];
              return (
                <div key={k} className="rp__savings-card">
                  <div className="rp__savings-card-top">
                    <span className="rp__savings-card-label">
                      {CONCESSION_LABELS[k]}
                      {item.explanation && (
                        <span
                          className="rp__cost-info"
                          onMouseEnter={(e) => handleTipEnter(item.explanation, e)}
                          onMouseMove={(e) => handleTipEnter(item.explanation, e)}
                          onMouseLeave={handleTipLeave}
                        >&#9432;</span>
                      )}
                    </span>
                    <span className="rp__savings-card-amount">&euro;{item.amount.toLocaleString()}</span>
                  </div>
                  {item.vendor && (
                    <div className="rp__savings-card-vendor">
                      {item.vendor}{item.vendor_status ? ` \u00B7 ${item.vendor_status}` : ''}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {costs.vendor_concessions.net_furnishing_cost != null && (
            <div className="rp__savings-net">
              <span>Net furnishing cost</span>
              <span>&euro;{costs.vendor_concessions.net_furnishing_cost.toLocaleString()}</span>
            </div>
          )}
        </div>
      )}

      {/* 5. Infrastructure */}
      <CostSection label="Infrastructure" data={costs.infrastructure}
        keys={infraKeys}
        explanation={costs.infrastructure?.explanation}
        onTipEnter={handleTipEnter} onTipLeave={handleTipLeave} />

      {/* 5b. Compliance */}
      <CostSection label="Compliance" data={costs.compliance}
        keys={complianceKeys}
        explanation={costs.compliance?.explanation}
        onTipEnter={handleTipEnter} onTipLeave={handleTipLeave} />

      {/* 6. Labour & Human Resources */}
      {hasLabour && (
        <div className="rp__cost-section">
          <div className="rp__cost-header">
            <span>Labour &amp; Human Resources</span>
            <span>&euro;{(costs.labour.subtotal || 0).toLocaleString()}</span>
          </div>
          {labourKeys.map((k) => {
            const item = costs.labour[k];
            const amount = typeof item === 'object' ? item.amount : item;
            const detail = typeof item === 'object' ? item.detail : null;
            const tipText = labourTipText(detail);
            return (
              <div key={k} className="rp__cost-line">
                <span>
                  {LABOUR_LABELS[k]}
                  {tipText && (
                    <span
                      className="rp__cost-info"
                      onMouseEnter={(e) => handleTipEnter(tipText, e)}
                      onMouseMove={(e) => handleTipEnter(tipText, e)}
                      onMouseLeave={handleTipLeave}
                    >&#9432;</span>
                  )}
                </span>
                <span>&euro;{amount.toLocaleString()}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* 7. Commune & Municipal Permits */}
      {hasPermits && (
        <div className="rp__cost-section">
          <div className="rp__cost-header">
            <span>Commune &amp; Municipal Permits</span>
            <span>&euro;{(costs.commune_permits.subtotal || 0).toLocaleString()}</span>
          </div>
          {permitKeys.map((k) => {
            const item = costs.commune_permits[k];
            const amount = typeof item === 'object' ? item.amount : item;
            const detail = typeof item === 'object' ? item.detail : null;
            const tipText = permitTipText(detail);
            return (
              <div key={k} className="rp__cost-line">
                <span>
                  {PERMIT_LABELS[k]}
                  {tipText && (
                    <span
                      className="rp__cost-info"
                      onMouseEnter={(e) => handleTipEnter(tipText, e)}
                      onMouseMove={(e) => handleTipEnter(tipText, e)}
                      onMouseLeave={handleTipLeave}
                    >&#9432;</span>
                  )}
                </span>
                <span>&euro;{amount.toLocaleString()}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* 8. Commissioning & Handover */}
      {hasCommissioning && (
        <div className="rp__cost-section">
          <div className="rp__cost-header">
            <span>Commissioning &amp; Handover</span>
            <span>&euro;{(costs.commissioning.subtotal || 0).toLocaleString()}</span>
          </div>
          {commissioningKeys.map((k) => {
            const item = costs.commissioning[k];
            const amount = typeof item === 'object' ? item.amount : item;
            const explanation = typeof item === 'object' ? item.explanation : null;
            return (
              <div key={k} className="rp__cost-line">
                <span>
                  {COMMISSIONING_LABELS[k]}
                  {explanation && (
                    <span
                      className="rp__cost-info"
                      onMouseEnter={(e) => handleTipEnter(explanation, e)}
                      onMouseMove={(e) => handleTipEnter(explanation, e)}
                      onMouseLeave={handleTipLeave}
                    >&#9432;</span>
                  )}
                </span>
                <span>&euro;{amount.toLocaleString()}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* 9. Operational Disruption */}
      {hasDisruption && (
        <div className="rp__disruption">
          <div className="rp__disruption-header">
            <span>Operational Disruption</span>
            <span>&euro;{(costs.disruption.subtotal || 0).toLocaleString()}</span>
          </div>
          <div className="rp__disruption-cards">
            {disruptionKeys.map((k) => {
              const item = costs.disruption[k];
              const amount = typeof item === 'object' ? item.amount : item;
              const explanation = typeof item === 'object' ? item.explanation : null;
              const justification = typeof item === 'object' ? item.justification : null;
              return (
                <div key={k} className="rp__disruption-card">
                  <div className="rp__disruption-card-top">
                    <span className="rp__disruption-card-label">
                      {DISRUPTION_LABELS[k]}
                      {justification && (
                        <span
                          className="rp__cost-info"
                          onMouseEnter={(e) => handleTipEnter(justification, e)}
                          onMouseMove={(e) => handleTipEnter(justification, e)}
                          onMouseLeave={handleTipLeave}
                        >&#9432;</span>
                      )}
                    </span>
                    <span className="rp__disruption-card-amount">&euro;{amount.toLocaleString()}</span>
                  </div>
                  {explanation && <div className="rp__disruption-card-desc">{explanation}</div>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 10. Contingency Breakdown */}
      {hasContingency ? (
        <div className="rp__cost-section">
          <div className="rp__cost-header">
            <span>Contingency ({Math.round((costs.contingency_breakdown.total_rate || 0) * 100)}%)</span>
            <span>&euro;{(costs.contingency_breakdown.total || 0).toLocaleString()}</span>
          </div>
          {contingencyKeys.map((k) => {
            const item = costs.contingency_breakdown[k];
            return (
              <div key={k} className="rp__cost-line">
                <span>
                  {CONTINGENCY_LABELS[k]} ({Math.round((item.rate || 0) * 100)}%)
                  {item.explanation && (
                    <span
                      className="rp__cost-info"
                      onMouseEnter={(e) => handleTipEnter(item.explanation, e)}
                      onMouseMove={(e) => handleTipEnter(item.explanation, e)}
                      onMouseLeave={handleTipLeave}
                    >&#9432;</span>
                  )}
                </span>
                <span>&euro;{item.amount.toLocaleString()}</span>
              </div>
            );
          })}
        </div>
      ) : costs.contingency > 0 && (
        <div className="rp__cost-extras">
          <div className="rp__cost-line">
            <span>Contingency (12%)</span>
            <span>&euro;{(costs.contingency || 0).toLocaleString()}</span>
          </div>
        </div>
      )}

      {/* 11. Capital Expenditure subtotal */}
      <div className="rp__cost-subtotal">
        <span>Capital Expenditure</span>
        <span>&euro;{(costs.total_capex || 0).toLocaleString()}</span>
      </div>

      {/* 12. Design & Professional Fees */}
      {costs.design_fees > 0 && (
        <div className="rp__cost-extras">
          <div className="rp__cost-line">
            <span>Design &amp; professional fees</span>
            <span>&euro;{(costs.design_fees || 0).toLocaleString()}</span>
          </div>
        </div>
      )}

      {/* 13. Total Project Cost */}
      <div className="rp__cost-total">
        <span>Total Project Cost</span>
        <span>&euro;{(costs.total_project_cost || costs.total_capex || 0).toLocaleString()}</span>
      </div>

      {/* 14. Cost per m2 */}
      {costs.cost_per_m2 > 0 && (
        <div className="rp__cost-unit">
          &euro;{costs.cost_per_m2?.toLocaleString()} / m&sup2;
        </div>
      )}

      {/* 15. Financial Structure */}
      {fin && (
        <div className="rp__fin">
          <div className="rp__section-title">Financial Structure</div>

          {/* Payment milestones - bar + tooltip only */}
          {fin.payment_milestones?.length > 0 && (
            <div className="rp__fin-milestones">
              <div className="rp__fin-bar">
                {fin.payment_milestones.map((m, i) => (
                  <div key={i} className="rp__fin-bar-seg" style={{ flex: m.pct }}
                    onMouseEnter={(e) => handleTipEnter(`${m.stage}\n${m.pct}% - \u20AC${(m.amount || 0).toLocaleString()}`, e)}
                    onMouseMove={(e) => handleTipEnter(`${m.stage}\n${m.pct}% - \u20AC${(m.amount || 0).toLocaleString()}`, e)}
                    onMouseLeave={handleTipLeave}>
                    {m.pct >= 20 && <span>{m.pct}%</span>}
                  </div>
                ))}
              </div>
              <div className="rp__fin-bar-caption">{fin.payment_milestones.length} payment stages</div>
            </div>
          )}

          {/* Key financial terms as compact grid */}
          <div className="rp__fin-grid">
            {fin.vat && (
              <div className="rp__fin-cell">
                <span className="rp__fin-cell-label">
                  VAT
                  {fin.vat.note && (
                    <span className="rp__cost-info"
                      onMouseEnter={(e) => handleTipEnter(fin.vat.note, e)}
                      onMouseMove={(e) => handleTipEnter(fin.vat.note, e)}
                      onMouseLeave={handleTipLeave}>&#9432;</span>
                  )}
                </span>
                <span className="rp__fin-cell-value">{fin.vat.rate}%</span>
                <span className="rp__fin-cell-sub">&euro;{(fin.vat.amount || 0).toLocaleString()}</span>
              </div>
            )}
            {fin.retention && (
              <div className="rp__fin-cell">
                <span className="rp__fin-cell-label">
                  Retention
                  {fin.retention.explanation && (
                    <span className="rp__cost-info"
                      onMouseEnter={(e) => handleTipEnter(fin.retention.explanation, e)}
                      onMouseMove={(e) => handleTipEnter(fin.retention.explanation, e)}
                      onMouseLeave={handleTipLeave}>&#9432;</span>
                  )}
                </span>
                <span className="rp__fin-cell-value">{fin.retention.pct}%</span>
                <span className="rp__fin-cell-sub">&euro;{(fin.retention.amount || 0).toLocaleString()} &middot; {fin.retention.period_months} mo</span>
              </div>
            )}
            {fin.capex_opex_split && (
              <div className="rp__fin-cell">
                <span className="rp__fin-cell-label">
                  CAPEX / OPEX
                  {fin.capex_opex_split.explanation && (
                    <span className="rp__cost-info"
                      onMouseEnter={(e) => handleTipEnter(fin.capex_opex_split.explanation, e)}
                      onMouseMove={(e) => handleTipEnter(fin.capex_opex_split.explanation, e)}
                      onMouseLeave={handleTipLeave}>&#9432;</span>
                  )}
                </span>
                <span className="rp__fin-cell-value">&euro;{(fin.capex_opex_split.capex || 0).toLocaleString()}</span>
                <span className="rp__fin-cell-sub">&euro;{(fin.capex_opex_split.opex || 0).toLocaleString()} OPEX</span>
              </div>
            )}
          </div>

          {/* Depreciation as inline pair */}
          {fin.depreciation && (
            <div className="rp__fin-depreciation">
              <span className="rp__fin-dep-label">
                Depreciation
                {fin.depreciation.explanation && (
                  <span className="rp__cost-info"
                    onMouseEnter={(e) => handleTipEnter(fin.depreciation.explanation, e)}
                    onMouseMove={(e) => handleTipEnter(fin.depreciation.explanation, e)}
                    onMouseLeave={handleTipLeave}>&#9432;</span>
                )}
              </span>
              <div className="rp__fin-dep-items">
                <span>Fit-out: &euro;{(fin.depreciation.fitout_annual || 0).toLocaleString()}/yr <em>({fin.depreciation.fitout_years}y)</em></span>
                {fin.depreciation.furnishing_annual > 0 && (
                  <span>Furn: &euro;{fin.depreciation.furnishing_annual.toLocaleString()}/yr <em>({fin.depreciation.furnishing_years}y)</em></span>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Portal tooltip */}
      {tip && ReactDOM.createPortal(
        <div className="rp__cost-tip" style={{ top: tip.y, left: tip.x + 48 }}>
          {tip.text.split('\n').map((line, i) => (
            <div key={i} className="rp__cost-tip-line">{line}</div>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}

/* ── ROI Tab ── */

function fmt(val) {
  if (val == null) return '\u2014';
  return `\u20AC${Math.abs(val).toLocaleString()}`;
}

function ROISection({ roi, impact, costs }) {
  if (!roi) return null;

  const [tip, setTip] = useState(null);
  const onTip = (text, e) => setTip({ text, x: e.clientX, y: e.clientY });
  const offTip = () => setTip(null);

  const netPositive = (roi.net_annual_delta || 0) >= 0;
  const totalInvestment = roi.total_investment || costs?.total_project_cost || costs?.total_capex || 0;
  const ib = roi.investment_breakdown;
  const expl = roi.explanations || {};

  // Helper to extract amount and explanation from breakdown items
  const ibVal = (k) => {
    const item = ib?.[k];
    if (!item) return { amount: 0, explanation: null };
    if (typeof item === 'object' && 'amount' in item) return item;
    return { amount: item, explanation: null };
  };

  // Inline info icon helper
  const Info = ({ text }) => text ? (
    <span className="rp__cost-info"
      onMouseEnter={(e) => onTip(text, e)}
      onMouseMove={(e) => onTip(text, e)}
      onMouseLeave={offTip}>&#9432;</span>
  ) : null;

  return (
    <div className="rp__roi">
      {/* Hero numbers */}
      <div className="rp__roi-hero">
        <div className={`rp__roi-hero-row rp__roi-hero-row--${netPositive ? 'green' : 'red'}`}>
          <span className="rp__roi-hero-label">Net Annual Impact <Info text={expl.net_annual_delta} /></span>
          <span className="rp__roi-hero-value">
            {roi.net_annual_delta >= 0 ? '+' : '-'}{fmt(roi.net_annual_delta)}<span className="rp__roi-hero-unit">/yr</span>
          </span>
        </div>
        <div className="rp__roi-hero-row rp__roi-hero-row--orange">
          <span className="rp__roi-hero-label">Total Investment <Info text={expl.total_investment} /></span>
          <span className="rp__roi-hero-value">&euro;{totalInvestment.toLocaleString()}</span>
        </div>
        <div className="rp__roi-hero-row rp__roi-hero-row--slate">
          <span className="rp__roi-hero-label">Payback <Info text={expl.payback} /></span>
          <span className="rp__roi-hero-value">
            {roi.payback_months ? `${roi.payback_months} mo` : 'Non-revenue'}
          </span>
        </div>
      </div>

      {/* Investment breakdown */}
      {ib && (
        <>
          <div className="rp__section-title">Investment Breakdown</div>
          <div className="rp__roi-returns">
            {['capex', 'design_fees', 'contingency', 'disruption', 'commune_permits'].map((k) => {
              const { amount, explanation } = ibVal(k);
              if (!amount || amount <= 0) return null;
              const labels = {
                capex: 'Capital expenditure',
                design_fees: 'Design & professional fees',
                contingency: 'Contingency reserve',
                disruption: 'Operational disruption',
                commune_permits: 'Commune & municipal permits',
              };
              return (
                <div key={k} className="rp__roi-returns-row">
                  <span>
                    {labels[k]}
                    {explanation && (
                      <span className="rp__cost-info"
                        onMouseEnter={(e) => onTip(explanation, e)}
                        onMouseMove={(e) => onTip(explanation, e)}
                        onMouseLeave={offTip}>&#9432;</span>
                    )}
                  </span>
                  <span>&euro;{amount.toLocaleString()}</span>
                </div>
              );
            })}
            {(() => {
              const { amount, explanation } = ibVal('vendor_concessions');
              if (!amount || amount >= 0) return null;
              return (
                <div className="rp__roi-returns-row">
                  <span>
                    Vendor concessions (savings)
                    {explanation && (
                      <span className="rp__cost-info"
                        onMouseEnter={(e) => onTip(explanation, e)}
                        onMouseMove={(e) => onTip(explanation, e)}
                        onMouseLeave={offTip}>&#9432;</span>
                    )}
                  </span>
                  <span className="rp__pos">&euro;{amount.toLocaleString()}</span>
                </div>
              );
            })()}
            <div className="rp__roi-returns-row" style={{ fontWeight: 700, borderTop: '1px solid #e5e2de', paddingTop: 4 }}>
              <span>Total project investment</span>
              <span>&euro;{totalInvestment.toLocaleString()}</span>
            </div>
          </div>
        </>
      )}

      {/* Revenue comparison */}
      <div className="rp__section-title">Revenue Comparison</div>
      <div className="rp__roi-compare">
        <div className="rp__roi-compare-row">
          <span className="rp__roi-compare-label">Revenue / yr <Info text={expl.revenue_delta} /></span>
          <span className="rp__roi-compare-current"
            onMouseEnter={(e) => expl.revenue_current && onTip(expl.revenue_current, e)}
            onMouseMove={(e) => expl.revenue_current && onTip(expl.revenue_current, e)}
            onMouseLeave={offTip}>{fmt(roi.annual_revenue_current)}</span>
          <span className="rp__roi-compare-arrow">&rarr;</span>
          <span className="rp__roi-compare-projected"
            onMouseEnter={(e) => expl.revenue_target && onTip(expl.revenue_target, e)}
            onMouseMove={(e) => expl.revenue_target && onTip(expl.revenue_target, e)}
            onMouseLeave={offTip}>{fmt(roi.annual_revenue_target)}</span>
          <span className={roi.annual_revenue_delta >= 0 ? 'rp__pos' : 'rp__neg'}>
            {roi.annual_revenue_delta >= 0 ? '+' : '-'}{fmt(roi.annual_revenue_delta)}
          </span>
        </div>
        <div className="rp__roi-compare-row">
          <span className="rp__roi-compare-label">OPEX / yr <Info text={expl.opex_delta} /></span>
          <span className="rp__roi-compare-current"
            onMouseEnter={(e) => expl.opex_current && onTip(expl.opex_current, e)}
            onMouseMove={(e) => expl.opex_current && onTip(expl.opex_current, e)}
            onMouseLeave={offTip}>{fmt(roi.annual_opex_current)}</span>
          <span className="rp__roi-compare-arrow">&rarr;</span>
          <span className="rp__roi-compare-projected"
            onMouseEnter={(e) => expl.opex_target && onTip(expl.opex_target, e)}
            onMouseMove={(e) => expl.opex_target && onTip(expl.opex_target, e)}
            onMouseLeave={offTip}>{fmt(roi.annual_opex_target)}</span>
          <span className={roi.annual_opex_delta <= 0 ? 'rp__pos' : 'rp__neg'}>
            {roi.annual_opex_delta >= 0 ? '+' : '-'}{fmt(roi.annual_opex_delta)}
          </span>
        </div>
      </div>

      {/* Investment returns */}
      {(roi.roi_5yr_pct != null || roi.downtime_cost > 0) && (
        <>
          <div className="rp__section-title">Investment Returns</div>
          <div className="rp__roi-returns">
            {roi.roi_5yr_pct != null && (
              <div className="rp__roi-returns-row">
                <span>5-year projected ROI <Info text={expl.roi_5yr} /></span>
                <span className={roi.roi_5yr_pct >= 0 ? 'rp__pos' : 'rp__neg'}>
                  {roi.roi_5yr_pct >= 0 ? '+' : ''}{roi.roi_5yr_pct}%
                </span>
              </div>
            )}
            {roi.downtime_cost > 0 && (
              <div className="rp__roi-returns-row">
                <span>Downtime revenue loss <Info text={expl.downtime_cost} /></span>
                <span className="rp__neg">&euro;{roi.downtime_cost.toLocaleString()}</span>
              </div>
            )}
          </div>
        </>
      )}

      {/* Narrative */}
      <div className="rp__roi-narrative">{roi.roi_narrative}</div>

      {/* Operational Impact */}
      {impact && (
        <div className="rp__impact">
          <div className="rp__section-title">Operational Impact</div>
          <div className="rp__impact-row">
            <span className={`rp__impact-dot rp__impact-dot--${impact.care_capacity?.delta === 0 ? 'neutral' : impact.care_capacity?.delta > 0 ? 'pos' : 'neg'}`} />
            <span>
              <strong>Care capacity:</strong> {impact.care_capacity?.assessment}
              <Info text={impact.care_capacity?.explanation} />
            </span>
          </div>
          <div className="rp__impact-row">
            <span className={`rp__impact-dot rp__impact-dot--${impact.staffing?.delta_fte === 0 ? 'neutral' : 'neg'}`} />
            <span>
              <strong>Staffing:</strong> {impact.staffing?.delta_fte >= 0 ? '+' : ''}{impact.staffing?.delta_fte} FTE
              {impact.staffing?.annual_cost_delta !== 0 && ` (\u20AC${impact.staffing?.annual_cost_delta?.toLocaleString()}/yr)`}
              <Info text={impact.staffing?.explanation} />
            </span>
          </div>
          <div className="rp__impact-row">
            <span className={`rp__impact-dot rp__impact-dot--${impact.occupancy?.delta > 0 ? 'pos' : impact.occupancy?.delta === 0 ? 'neutral' : 'neg'}`} />
            <span>
              <strong>Occupancy:</strong> {impact.occupancy?.current} &rarr; {impact.occupancy?.projected} ({impact.occupancy?.delta >= 0 ? '+' : ''}{impact.occupancy?.delta})
              <Info text={impact.occupancy?.explanation} />
            </span>
          </div>
          <div className="rp__impact-row">
            <span className={`rp__impact-dot rp__impact-dot--${impact.service_continuity?.risk_level === 'low' ? 'pos' : impact.service_continuity?.risk_level === 'moderate' ? 'neutral' : 'neg'}`} />
            <span>
              <strong>Service risk:</strong> {impact.service_continuity?.risk_level} - {impact.service_continuity?.assessment}
            </span>
          </div>
        </div>
      )}

      {/* Portal tooltip */}
      {tip && ReactDOM.createPortal(
        <div className="rp__cost-tip" style={{ top: tip.y, left: tip.x + 48 }}>
          {tip.text.split('\n').map((line, i) => (
            <div key={i} className="rp__cost-tip-line">{line}</div>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}

/* ── Timeline Tab ── */

function TimelineTab({ timeline }) {
  if (!timeline) return null;
  const phases = timeline.phases || [];
  const total = phases.length;

  return (
    <div className="rp__timeline">
      <div className="rp__timeline-header">
        <span className="rp__timeline-total-label">Estimated Duration</span>
        <span className="rp__timeline-total-value">{timeline.total}</span>
      </div>

      {timeline.reasons?.length > 0 && (
        <div className="rp__timeline-reasons">
          {timeline.reasons.map((r, i) => (
            <div key={i} className="rp__timeline-reason">
              <span className="rp__timeline-reason-dot" />
              <span>{r}</span>
            </div>
          ))}
        </div>
      )}

      <div className="rp__timeline-track">
        {phases.map((phase, i) => (
          <div key={i} className={`rp__tl-phase ${i === total - 1 ? 'rp__tl-phase--last' : ''}`}>
            {/* Vertical connector */}
            <div className="rp__tl-connector">
              <div className="rp__tl-dot" />
              {i < total - 1 && <div className="rp__tl-line" />}
            </div>

            {/* Phase card */}
            <div className="rp__tl-card">
              <div className="rp__tl-card-head">
                <span className="rp__tl-card-name">{phase.name}</span>
                <span className="rp__tl-card-days">{phase.weeks}</span>
              </div>
              {phase.description && (
                <div className="rp__tl-card-desc">{phase.description}</div>
              )}
              {phase.tasks?.length > 0 && (
                <ul className="rp__tl-card-tasks">
                  {phase.tasks.map((task, j) => (
                    <li key={j}>{task}</li>
                  ))}
                </ul>
              )}
              {phase.responsible && (
                <span className="rp__tl-card-tag">{phase.responsible}</span>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="rp__timeline-footer">
        Room unavailable for {timeline.weeks_min} to {timeline.weeks_max} weeks during conversion.
      </div>
    </div>
  );
}

/* ── Option Card ── */

const TAB_KEYS = ['overview', 'costs', 'roi', 'timeline', 'furnishings'];
const TAB_LABELS = { overview: 'Overview', costs: 'Costs', roi: 'ROI', timeline: 'Timeline', furnishings: 'Furn.' };

function OptionCard({ option, rank, isExpanded, onToggle, onInjectChat }) {
  const [activeTab, setActiveTab] = useState('overview');
  const score = option.overall_score;
  const scoreColor = score >= 75 ? '#16a34a' : score >= 50 ? '#E77133' : '#ef4444';

  return (
    <div className={`rp__card ${isExpanded ? 'rp__card--expanded' : ''}`}>
      <button className="rp__card-header" onClick={onToggle}>
        <div className="rp__card-rank">{rank}</div>
        <div className="rp__card-info">
          <span className="rp__card-fn">{option.target_label}</span>
          <div className="rp__card-pills">
            <span className="rp__pill">&euro;{Math.round(((option.cost_breakdown?.total_project_cost || option.cost_breakdown?.total_capex) || 0) / 1000)}k</span>
            <span className="rp__pill">{(option.timeline?.total || '').replace(/ weeks?/, ' wks').replace(/ to /g, '-')}</span>
            <span className="rp__pill">{option.operational_impact?.occupancy?.delta >= 0 ? '+' : ''}{option.operational_impact?.occupancy?.delta} occ</span>
          </div>
        </div>
        <div className="rp__card-score" style={{ color: scoreColor }}>
          {score}<span className="rp__card-score-pct">%</span>
        </div>
        <span className={`rp__card-arrow ${isExpanded ? 'rp__card-arrow--open' : ''}`}>&#9656;</span>
      </button>

      {isExpanded && (
        <div className="rp__card-body">
          <div className="rp__tabs">
            {TAB_KEYS.map((tab) => (
              <button
                key={tab}
                className={`rp__tab ${activeTab === tab ? 'rp__tab--active' : ''}`}
                onClick={() => setActiveTab(tab)}
              >
                {TAB_LABELS[tab]}
              </button>
            ))}
          </div>

          {activeTab === 'overview' && (
            <div className="rp__overview">
              <div className="rp__section-title">Score Breakdown</div>
              <ScoreBreakdown scores={option.scores} scoreReasons={option.score_reasons} />

              <div className="rp__section-title">Why This Works</div>
              <div className="rp__justification">
                {option.justification?.map((j, i) => (
                  <div key={i} className="rp__just-item">
                    <span className="rp__just-dot" />
                    <span>{j}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'costs' && (
            <CostBreakdown costs={option.cost_breakdown} />
          )}

          {activeTab === 'roi' && (
            <ROISection roi={option.roi} impact={option.operational_impact} costs={option.cost_breakdown} />
          )}

          {activeTab === 'timeline' && (
            <TimelineTab timeline={option.timeline} />
          )}

          {activeTab === 'furnishings' && (
            <div className="rp__furnishings-tab">
              <div className="rp__section-title">Furnishing Changes</div>
              <FurnishingDelta delta={option.furnishing_delta} />
            </div>
          )}

          <button className="rp__inject-btn" onClick={() => onInjectChat(option, activeTab)}>
            Inject to Chat
          </button>
        </div>
      )}
    </div>
  );
}

export default function RepurposePanel({ ifcGuid, spaceName, primaryFunction, floorId, area_m2, onClose, onInjectChat }) {
  const storeOptions = useStore((s) => s.repurposeOptions[ifcGuid]);
  const options = Array.isArray(storeOptions) ? storeOptions : [];
  const [expandedRank, setExpandedRank] = useState(1);

  const excluded = isNonRepurposable(primaryFunction);

  return (
    <div className="rp">
      <div className="rp__body">
        {excluded ? (
          <div className="rp__excluded">
            <div className="rp__excluded-icon">&#9888;</div>
            <div className="rp__excluded-title">Cannot Repurpose</div>
            <div className="rp__excluded-text">
              <strong>{primaryFunction}</strong> spaces are structural or
              circulation infrastructure and cannot be repurposed. These
              elements are essential to building operations, safety egress,
              and vertical/horizontal connectivity.
            </div>
          </div>
        ) : options.length === 0 ? (
          <div className="rp__empty">No viable repurpose options for this space.</div>
        ) : (
          options.map((opt, i) => (
            <OptionCard
              key={opt.rank}
              option={opt}
              rank={i + 1}
              isExpanded={expandedRank === opt.rank}
              onToggle={() => setExpandedRank(expandedRank === opt.rank ? null : opt.rank)}
              onInjectChat={onInjectChat}
            />
          ))
        )}
      </div>
    </div>
  );
}

export { isNonRepurposable };
