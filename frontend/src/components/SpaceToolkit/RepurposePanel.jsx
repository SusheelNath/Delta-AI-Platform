import React, { useState } from 'react';
import ReactDOM from 'react-dom';
import useStore from '../../store/useStore';
import './RepurposePanel.css';

// Functions that cannot be repurposed — mirrors backend NON_REPURPOSABLE_FUNCTIONS
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
  return (
    <div className="rp__furn-delta">
      {keep.length > 0 && (
        <div className="rp__furn-group">
          <span className="rp__furn-tag rp__furn-tag--keep">Keep</span>
          {keep.map((f) => (
            <span key={f.item_type} className="rp__furn-item">
              {f.quantity}&times; {f.label}
            </span>
          ))}
        </div>
      )}
      {remove.length > 0 && (
        <div className="rp__furn-group">
          <span className="rp__furn-tag rp__furn-tag--remove">Remove</span>
          {remove.map((f) => (
            <span key={f.item_type} className="rp__furn-item">
              {f.quantity}&times; {f.label}
            </span>
          ))}
        </div>
      )}
      {add.length > 0 && (
        <div className="rp__furn-group">
          <span className="rp__furn-tag rp__furn-tag--add">Add</span>
          {add.map((f) => (
            <span key={f.item_type} className="rp__furn-item">
              {f.quantity}&times; {f.label}
              {f.unit_cost > 0 && (
                <span className="rp__furn-cost">
                  &euro;{(f.unit_cost * f.quantity).toLocaleString()}
                </span>
              )}
            </span>
          ))}
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

function CostSection({ label, data, keys }) {
  if (!data) return null;
  const hasLines = keys.some((k) => data[k] > 0);
  return (
    <div className="rp__cost-section">
      <div className="rp__cost-header">
        <span>{label}</span>
        <span>&euro;{(data.subtotal || 0).toLocaleString()}</span>
      </div>
      {hasLines && keys.map((k) => {
        const val = data[k];
        if (!val || val === 0) return null;
        return (
          <div key={k} className="rp__cost-line">
            <span>{COST_LABELS[k] || k.replace(/_/g, ' ')}</span>
            <span>&euro;{val.toLocaleString()}</span>
          </div>
        );
      })}
    </div>
  );
}

function CostBreakdown({ costs }) {
  if (!costs) return null;

  const infraKeys = Object.keys(costs.infrastructure || {}).filter(
    (k) => k !== 'subtotal'
  );
  const complianceKeys = Object.keys(costs.compliance || {}).filter(
    (k) => k !== 'subtotal'
  );

  return (
    <div className="rp__costs">
      <CostSection label="Renovation" data={costs.renovation}
        keys={['paint_flooring', 'ceiling_walls', 'mep_services']} />
      <CostSection label="Furnishings" data={costs.furnishing}
        keys={['removal', 'new_purchase', 'installation']} />
      <CostSection label="Infrastructure" data={costs.infrastructure}
        keys={infraKeys} />
      <CostSection label="Compliance & Permits" data={costs.compliance}
        keys={complianceKeys} />

      <div className="rp__cost-subtotal">
        <span>Capital Expenditure</span>
        <span>&euro;{(costs.total_capex || 0).toLocaleString()}</span>
      </div>

      {/* Additional project costs */}
      <div className="rp__cost-extras">
        <div className="rp__cost-line">
          <span>Design & professional fees (6%)</span>
          <span>&euro;{(costs.design_fees || 0).toLocaleString()}</span>
        </div>
        <div className="rp__cost-line">
          <span>Contingency (12%)</span>
          <span>&euro;{(costs.contingency || 0).toLocaleString()}</span>
        </div>
        {costs.downtime_cost > 0 && (
          <div className="rp__cost-line">
            <span>Revenue loss during works</span>
            <span>&euro;{(costs.downtime_cost || 0).toLocaleString()}</span>
          </div>
        )}
      </div>

      <div className="rp__cost-total">
        <span>Total Project Cost</span>
        <span>&euro;{(costs.total_project_cost || costs.total_capex || 0).toLocaleString()}</span>
      </div>

      {costs.cost_per_m2 > 0 && (
        <div className="rp__cost-unit">
          &euro;{costs.cost_per_m2?.toLocaleString()} / m&sup2;
        </div>
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

  const netPositive = (roi.net_annual_delta || 0) >= 0;
  const investmentLabel = costs?.total_project_cost
    ? `\u20AC${costs.total_project_cost.toLocaleString()}`
    : `\u20AC${(costs?.total_capex || 0).toLocaleString()}`;

  return (
    <div className="rp__roi">
      {/* Hero numbers */}
      <div className="rp__roi-hero">
        <div className="rp__roi-hero-item">
          <span className="rp__roi-hero-label">Net Annual Impact</span>
          <span className={`rp__roi-hero-value ${netPositive ? 'rp__pos' : 'rp__neg'}`}>
            {roi.net_annual_delta >= 0 ? '+' : '-'}{fmt(roi.net_annual_delta)}<span className="rp__roi-hero-unit">/yr</span>
          </span>
        </div>
        <div className="rp__roi-hero-item">
          <span className="rp__roi-hero-label">Total Investment</span>
          <span className="rp__roi-hero-value">{investmentLabel}</span>
        </div>
        <div className="rp__roi-hero-item">
          <span className="rp__roi-hero-label">Payback</span>
          <span className="rp__roi-hero-value">
            {roi.payback_months ? `${roi.payback_months} months` : 'Non-revenue'}
          </span>
        </div>
      </div>

      {/* Revenue comparison */}
      <div className="rp__section-title">Revenue Comparison</div>
      <div className="rp__roi-compare">
        <div className="rp__roi-compare-row">
          <span className="rp__roi-compare-label">Revenue / yr</span>
          <span className="rp__roi-compare-current">{fmt(roi.annual_revenue_current)}</span>
          <span className="rp__roi-compare-arrow">&rarr;</span>
          <span className="rp__roi-compare-projected">{fmt(roi.annual_revenue_target)}</span>
          <span className={roi.annual_revenue_delta >= 0 ? 'rp__pos' : 'rp__neg'}>
            {roi.annual_revenue_delta >= 0 ? '+' : '-'}{fmt(roi.annual_revenue_delta)}
          </span>
        </div>
        <div className="rp__roi-compare-row">
          <span className="rp__roi-compare-label">OPEX / yr</span>
          <span className="rp__roi-compare-current">{fmt(roi.annual_opex_current)}</span>
          <span className="rp__roi-compare-arrow">&rarr;</span>
          <span className="rp__roi-compare-projected">{fmt(roi.annual_opex_target)}</span>
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
                <span>5-year projected ROI</span>
                <span className={roi.roi_5yr_pct >= 0 ? 'rp__pos' : 'rp__neg'}>
                  {roi.roi_5yr_pct >= 0 ? '+' : ''}{roi.roi_5yr_pct}%
                </span>
              </div>
            )}
            {roi.downtime_cost > 0 && (
              <div className="rp__roi-returns-row">
                <span>Downtime revenue loss</span>
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
            <span><strong>Care capacity:</strong> {impact.care_capacity?.assessment}</span>
          </div>
          <div className="rp__impact-row">
            <span className={`rp__impact-dot rp__impact-dot--${impact.staffing?.delta_fte === 0 ? 'neutral' : 'neg'}`} />
            <span>
              <strong>Staffing:</strong> {impact.staffing?.delta_fte >= 0 ? '+' : ''}{impact.staffing?.delta_fte} FTE
              {impact.staffing?.annual_cost_delta !== 0 && ` (\u20AC${impact.staffing?.annual_cost_delta?.toLocaleString()}/yr)`}
            </span>
          </div>
          <div className="rp__impact-row">
            <span className={`rp__impact-dot rp__impact-dot--${impact.occupancy?.delta > 0 ? 'pos' : impact.occupancy?.delta === 0 ? 'neutral' : 'neg'}`} />
            <span>
              <strong>Occupancy:</strong> {impact.occupancy?.current} &rarr; {impact.occupancy?.projected} ({impact.occupancy?.delta >= 0 ? '+' : ''}{impact.occupancy?.delta})
            </span>
          </div>
          <div className="rp__impact-row">
            <span className={`rp__impact-dot rp__impact-dot--${impact.service_continuity?.risk_level === 'low' ? 'pos' : impact.service_continuity?.risk_level === 'moderate' ? 'neutral' : 'neg'}`} />
            <span>
              <strong>Service risk:</strong> {impact.service_continuity?.risk_level} &mdash; {impact.service_continuity?.assessment}
            </span>
          </div>
        </div>
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
            <span className="rp__pill">&euro;{(option.cost_breakdown?.total_project_cost || option.cost_breakdown?.total_capex)?.toLocaleString()}</span>
            <span className="rp__pill">{option.timeline?.total}</span>
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
