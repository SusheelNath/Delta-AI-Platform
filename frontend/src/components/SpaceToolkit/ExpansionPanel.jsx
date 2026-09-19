import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import useStore from '../../store/useStore';
import './ExpansionPanel.css';

const TAB_KEYS = ['overview', 'construction', 'costs', 'timeline', 'risk'];
const TAB_LABELS = {
  overview: 'Overview',
  construction: 'Construction',
  costs: 'Costs',
  timeline: 'Timeline',
  risk: 'Risk',
};

/* ── Score bar (reusable) ── */

const SCORE_META = {
  wall_removability:    { label: 'Wall Removability',    meaning: 'Ease of removing the shared wall' },
  mep_complexity:       { label: 'MEP Simplicity',       meaning: 'Complexity of rerouting mechanical/electrical/plumbing' },
  structural_impact:    { label: 'Structural Safety',     meaning: 'Degree of structural intervention required' },
  service_continuity:   { label: 'Service Continuity',    meaning: 'Impact of losing the candidate room on hospital operations' },
  construction_access:  { label: 'Construction Access',   meaning: 'Ease of contractor access during works' },
  noise_sensitivity:    { label: 'Noise Tolerance',       meaning: 'How much noise the surrounding area can tolerate' },
  infection_control:    { label: 'Infection Control',     meaning: 'ICRA containment level required' },
  egress_compliance:    { label: 'Egress Safety',         meaning: 'Impact on emergency evacuation routes' },
  utility_capacity:     { label: 'Utility Capacity',      meaning: 'Sufficiency of existing utility infrastructure' },
  phasing_feasibility:  { label: 'Phasing Feasibility',   meaning: 'Can the commercial space stay partially open?' },
  adjacency_quality:    { label: 'Adjacency Quality',     meaning: 'Synergy between candidate and commercial function' },
  area_gain_efficiency: { label: 'Area Gain',             meaning: 'How much useful space the expansion adds' },
};

function ScoreBar({ scoreKey, value, reason, onHover, onLeave }) {
  const meta = SCORE_META[scoreKey] || { label: scoreKey, meaning: '' };
  const color = value >= 75 ? '#16a34a' : value >= 50 ? '#E77133' : '#ef4444';
  return (
    <div className="exp__score-row" onMouseEnter={(e) => onHover(scoreKey, e)}
      onMouseMove={(e) => onHover(scoreKey, e)} onMouseLeave={onLeave}>
      <span className="exp__score-label">{meta.label}</span>
      <div className="exp__score-track">
        <div className="exp__score-fill" style={{ width: `${value}%`, background: color }} />
      </div>
      <span className="exp__score-val" style={{ color }}>{value}</span>
    </div>
  );
}

function ScoreBreakdown({ scoring }) {
  const [tip, setTip] = useState(null);
  const dims = scoring?.dimensions || {};
  const keys = Object.keys(dims);
  if (!keys.length) return null;

  const handleHover = (key, e) => setTip({ key, x: e.clientX, y: e.clientY });
  const handleLeave = () => setTip(null);

  const tipMeta = tip ? (SCORE_META[tip.key] || { label: tip.key }) : null;
  const tipVal = tip ? dims[tip.key]?.score : 0;
  const tipReason = tip ? (dims[tip.key]?.reason || tipMeta?.meaning || '') : '';
  const tipColor = tipVal >= 75 ? '#16a34a' : tipVal >= 50 ? '#E77133' : '#ef4444';

  return (
    <div className="exp__scores">
      {keys.map((key) => (
        <ScoreBar key={key} scoreKey={key} value={dims[key]?.score || 0}
          reason={dims[key]?.reason} onHover={handleHover} onLeave={handleLeave} />
      ))}
      {tip && ReactDOM.createPortal(
        <div className="exp__score-tip" style={{ top: tip.y, left: tip.x + 48 }}>
          <div className="exp__score-tip-head">
            <span>{tipMeta.label}</span>
            <span style={{ color: tipColor }}>{tipVal}/100</span>
          </div>
          <div className="exp__score-tip-reason">{tipReason}</div>
        </div>,
        document.body
      )}
    </div>
  );
}

/* ── Overview Tab ── */

function OverviewTab({ candidate }) {
  const merged = candidate.merged_projection;
  const roi = candidate.roi;
  const scoring = candidate.scoring;
  const wall = candidate.construction?.wall_classification;

  return (
    <div className="exp__tab-content">
      {/* Hero KPIs */}
      <div className="exp__hero-grid">
        <div className="exp__hero-card exp__hero-card--green">
          <span className="exp__hero-label">Area Gain</span>
          <span className="exp__hero-value">+{merged?.candidate_area || 0} m²</span>
          <span className="exp__hero-sub">{merged?.area_increase_pct || 0}% increase</span>
        </div>
        <div className="exp__hero-card exp__hero-card--green">
          <span className="exp__hero-label">Revenue Uplift</span>
          <span className="exp__hero-value">&euro;{(merged?.revenue?.additional_annual || 0).toLocaleString()}/yr</span>
          <span className="exp__hero-sub">{merged?.revenue?.revenue_uplift_pct || 0}% lift</span>
        </div>
        <div className="exp__hero-card exp__hero-card--orange">
          <span className="exp__hero-label">Investment</span>
          <span className="exp__hero-value">&euro;{(candidate.costs?.total_project_cost || 0).toLocaleString()}</span>
          <span className="exp__hero-sub">&euro;{(candidate.costs?.cost_per_m2_gained || 0).toLocaleString()}/m²</span>
        </div>
        <div className={`exp__hero-card ${roi?.payback_months ? 'exp__hero-card--green' : 'exp__hero-card--slate'}`}>
          <span className="exp__hero-label">Payback</span>
          <span className="exp__hero-value">{roi?.payback_months ? `${roi.payback_months} mo` : 'N/A'}</span>
          <span className="exp__hero-sub">5yr ROI: {roi?.roi_5yr_pct ?? 'N/A'}%</span>
        </div>
      </div>

      {/* Wall classification card */}
      <div className="exp__info-card">
        <div className="exp__info-card-header">Wall Classification</div>
        <div className="exp__info-card-body">
          <span className={`exp__wall-badge exp__wall-badge--${wall?.risk_level || 'low'}`}>
            {wall?.label || 'Unknown'}
          </span>
          <p className="exp__info-text">{wall?.description || ''}</p>
        </div>
      </div>

      {/* Merged projection */}
      {merged && (
        <div className="exp__info-card">
          <div className="exp__info-card-header">Merged Space</div>
          <div className="exp__info-card-body">
            <div className="exp__stat-row">
              <span>Current</span><span>{merged.current_area} m2</span>
            </div>
            <div className="exp__stat-row">
              <span>+ Candidate</span><span>{merged.candidate_area} m2</span>
            </div>
            <div className="exp__stat-row exp__stat-row--total">
              <span>Merged Total</span><span>{merged.merged_area} m2</span>
            </div>
            <p className="exp__info-text">{merged.area_assessment}</p>
            {merged.seating && (
              <div className="exp__stat-row">
                <span>Seating</span>
                <span>{merged.seating.current} &rarr; {merged.seating.merged} (+{merged.seating.additional})</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Score breakdown */}
      <div className="exp__section-head">Viability Score: {scoring?.total_score || 0}/100</div>
      <ScoreBreakdown scoring={scoring} />
    </div>
  );
}

/* ── Construction Tab (Layer 5 - PRIORITY) ── */

function ConstructionTab({ candidate }) {
  const c = candidate.construction;
  if (!c) return <div className="exp__empty">No construction data</div>;

  const wall = c.wall_classification;
  const mep = c.mep_impact;
  const service = c.service_continuity;
  const seq = c.construction_sequence;

  return (
    <div className="exp__tab-content">
      {/* Wall Classification */}
      <div className="exp__const-section">
        <div className="exp__const-header">Wall Classification</div>
        <div className="exp__const-card">
          <div className="exp__const-card-top">
            <span className={`exp__wall-badge exp__wall-badge--${wall?.risk_level || 'low'}`}>
              {wall?.label || 'Unknown'}
            </span>
            <span className="exp__const-detail">
              {wall?.typical_thickness_m ? `${(wall.typical_thickness_m * 100).toFixed(0)}cm thick` : ''}
            </span>
          </div>
          <p className="exp__const-desc">{wall?.description || ''}</p>
          <div className="exp__const-flags">
            {wall?.structural_engineer_required && (
              <span className="exp__flag exp__flag--red">Structural engineer required</span>
            )}
            {wall?.shoring_required && (
              <span className="exp__flag exp__flag--red">Temporary shoring required</span>
            )}
            {wall?.removable && !wall?.structural_engineer_required && (
              <span className="exp__flag exp__flag--green">Wall is removable</span>
            )}
          </div>
        </div>
      </div>

      {/* MEP Impact */}
      <div className="exp__const-section">
        <div className="exp__const-header">
          MEP Impact
          <span className={`exp__complexity-badge exp__complexity-badge--${mep?.complexity || 'low'}`}>
            {mep?.complexity || 'low'}
          </span>
        </div>
        <p className="exp__const-narrative">{mep?.complexity_narrative || ''}</p>
        {(mep?.affected_systems || []).map((sys, i) => (
          <div key={i} className={`exp__mep-card exp__mep-card--${sys.impact}`}>
            <div className="exp__mep-card-top">
              <span className="exp__mep-label">{sys.label}</span>
              <span className={`exp__impact-badge exp__impact-badge--${sys.impact}`}>
                {sys.impact}
              </span>
              <span className="exp__mep-cost">&euro;{(sys.reroute_cost || 0).toLocaleString()}</span>
            </div>
            <p className="exp__mep-action">{sys.action}</p>
          </div>
        ))}
        <div className="exp__mep-total">
          <span>Total MEP Rerouting</span>
          <span>&euro;{(mep?.total_reroute_cost || 0).toLocaleString()}</span>
        </div>
      </div>

      {/* Service Continuity */}
      <div className="exp__const-section">
        <div className="exp__const-header">Service Continuity</div>

        <div className="exp__continuity-card">
          <div className="exp__continuity-label">Commercial Space</div>
          <div className="exp__continuity-body">
            <div className="exp__stat-row">
              <span>Downtime</span>
              <span>{service?.commercial_continuity?.downtime_weeks || 0} weeks</span>
            </div>
            <div className="exp__stat-row">
              <span>Partial Operation</span>
              <span>{service?.commercial_continuity?.partial_operation ? 'Yes' : 'No'}</span>
            </div>
            <p className="exp__const-desc">{service?.commercial_continuity?.strategy || ''}</p>
          </div>
        </div>

        <div className={`exp__continuity-card exp__continuity-card--${service?.candidate_impact?.impact_level || 'low'}`}>
          <div className="exp__continuity-label">
            Candidate Room Impact
            <span className={`exp__impact-badge exp__impact-badge--${service?.candidate_impact?.impact_level || 'low'}`}>
              {service?.candidate_impact?.impact_level || 'low'}
            </span>
          </div>
          <div className="exp__continuity-body">
            <p className="exp__const-desc">{service?.candidate_impact?.strategy || ''}</p>
            {service?.candidate_impact?.relocation_required && (
              <div className="exp__stat-row">
                <span>Relocation Cost</span>
                <span>&euro;{(service?.candidate_impact?.relocation_cost || 0).toLocaleString()}</span>
              </div>
            )}
          </div>
        </div>

        {/* Interim Provisions */}
        {(service?.interim_provisions || []).length > 0 && (
          <div className="exp__interim">
            <div className="exp__interim-header">Interim Provisions</div>
            {service.interim_provisions.map((prov, i) => (
              <div key={i} className="exp__interim-item">
                <div className="exp__interim-top">
                  <span className="exp__interim-name">{prov.provision}</span>
                  <span className="exp__interim-cost">&euro;{(prov.estimated_cost || 0).toLocaleString()}</span>
                </div>
                <p className="exp__interim-desc">{prov.description}</p>
              </div>
            ))}
            <div className="exp__mep-total">
              <span>Total Interim Costs</span>
              <span>&euro;{(service?.interim_total_cost || 0).toLocaleString()}</span>
            </div>
          </div>
        )}
      </div>

      {/* Construction Sequence */}
      <div className="exp__const-section">
        <div className="exp__const-header">
          Construction Sequence
          <span className="exp__weeks-badge">{seq?.total_weeks || 0} weeks</span>
        </div>

        {(seq?.phases || []).map((phase, i) => (
          <div key={i} className="exp__phase-card">
            <div className="exp__phase-header">
              <span className="exp__phase-num">Phase {phase.phase}</span>
              <span className="exp__phase-name">{phase.name}</span>
              <span className="exp__phase-dur">{phase.duration_weeks}w</span>
            </div>
            <ul className="exp__phase-tasks">
              {(phase.tasks || []).map((task, j) => (
                <li key={j}>{task}</li>
              ))}
            </ul>
            {phase.decision_gate && (
              <div className="exp__phase-gate">
                <span className="exp__gate-icon">&#9888;</span>
                <span>{phase.decision_gate}</span>
              </div>
            )}
            {phase.hospital_constraints && (
              <div className="exp__phase-constraint">
                <span className="exp__constraint-icon">&#127975;</span>
                <span>{phase.hospital_constraints}</span>
              </div>
            )}
          </div>
        ))}

        {seq?.scheduling && (
          <div className="exp__scheduling">
            {seq.scheduling.night_work_recommended && (
              <div className="exp__schedule-flag">
                <span className="exp__flag exp__flag--amber">Night work recommended</span>
                <span className="exp__schedule-reason">{seq.scheduling.night_work_reason}</span>
              </div>
            )}
            {seq.scheduling.weekend_work_recommended && (
              <div className="exp__schedule-flag">
                <span className="exp__flag exp__flag--amber">Weekend work recommended</span>
                <span className="exp__schedule-reason">{seq.scheduling.weekend_work_reason}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Costs Tab ── */

function CostsTab({ candidate }) {
  const costs = candidate.costs;
  if (!costs) return <div className="exp__empty">No cost data</div>;

  const sections = [
    { key: 'wall_modification', label: 'Wall Modification', data: costs.wall_modification },
    { key: 'mep_rerouting', label: 'MEP Rerouting', data: costs.mep_rerouting },
    { key: 'fitout', label: 'Commercial Fit-Out', data: costs.fitout },
    { key: 'service_continuity', label: 'Service Continuity', data: costs.service_continuity },
    { key: 'compliance', label: 'Compliance & Permits', data: costs.compliance },
    { key: 'labour', label: 'Labour', data: costs.labour },
    { key: 'commissioning', label: 'Commissioning', data: costs.commissioning },
  ];

  return (
    <div className="exp__tab-content">
      {sections.map(({ key, label, data }) => {
        if (!data) return null;
        const sub = data.subtotal || data.total || 0;
        return (
          <div key={key} className="exp__cost-section">
            <div className="exp__cost-header">
              <span>{label}</span>
              <span className="exp__cost-subtotal">&euro;{sub.toLocaleString()}</span>
            </div>
            <div className="exp__cost-lines">
              {Object.entries(data).filter(([k, v]) =>
                k !== 'subtotal' && k !== 'total' && k !== 'explanation' &&
                k !== 'breakdown' && typeof v === 'object' && v !== null && 'amount' in v
              ).map(([k, v]) => (
                <div key={k} className="exp__cost-line">
                  <span className="exp__cost-line-label">
                    {k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                  </span>
                  <span className="exp__cost-line-amt">&euro;{(v.amount || 0).toLocaleString()}</span>
                </div>
              ))}
              {/* MEP breakdown */}
              {data.breakdown && data.breakdown.map((item, i) => (
                <div key={i} className="exp__cost-line">
                  <span className="exp__cost-line-label">{item.system}</span>
                  <span className="exp__cost-line-amt">&euro;{(item.cost || 0).toLocaleString()}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {/* Contingency */}
      {costs.contingency && (
        <div className="exp__cost-section">
          <div className="exp__cost-header">
            <span>Contingency ({((costs.contingency.rate || 0) * 100).toFixed(0)}%)</span>
            <span className="exp__cost-subtotal">&euro;{(costs.contingency.amount || 0).toLocaleString()}</span>
          </div>
        </div>
      )}

      {/* Total */}
      <div className="exp__cost-total">
        <span>Total Project Cost</span>
        <span>&euro;{(costs.total_project_cost || 0).toLocaleString()}</span>
      </div>
      <div className="exp__cost-per-m2">
        &euro;{(costs.cost_per_m2_gained || 0).toLocaleString()} per m² gained
      </div>

      {/* Financial Summary */}
      {candidate.roi && (
        <div className="exp__info-card">
          <div className="exp__info-card-header">Financial Summary</div>
          <div className="exp__info-card-body">
            <div className="exp__stat-row">
              <span>Additional Revenue</span>
              <span className="exp__val--green">&euro;{(candidate.roi.additional_revenue || 0).toLocaleString()}/yr</span>
            </div>
            <div className="exp__stat-row">
              <span>OPEX Increase</span>
              <span className="exp__val--red">&euro;{(candidate.roi.opex_delta || 0).toLocaleString()}/yr</span>
            </div>
            <div className="exp__stat-row exp__stat-row--total">
              <span>Net Annual Gain</span>
              <span className={candidate.roi.net_annual_gain >= 0 ? 'exp__val--green' : 'exp__val--red'}>
                &euro;{(candidate.roi.net_annual_gain || 0).toLocaleString()}/yr
              </span>
            </div>
            <div className="exp__stat-row">
              <span>Payback</span>
              <span>{candidate.roi.payback_months ? `${candidate.roi.payback_months} months` : 'N/A'}</span>
            </div>
            <div className="exp__stat-row">
              <span>5-Year ROI</span>
              <span className={candidate.roi.roi_5yr_pct >= 0 ? 'exp__val--green' : 'exp__val--red'}>
                {candidate.roi.roi_5yr_pct ?? 'N/A'}%
              </span>
            </div>
            <p className="exp__roi-narrative">{candidate.roi.roi_narrative || ''}</p>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Timeline Tab ── */

function TimelineRibbon({ phases, totalWeeks, parallelNote }) {
  const [tip, setTip] = useState(null);

  const rawSpan = phases.reduce((s, p) => s + p.duration_weeks, 0);
  const overlap = phases.filter(p => p.parallel).length;
  const span = rawSpan - overlap;
  const opacities = phases.map((_, i) => 1 - (i / phases.length) * 0.55);

  return (
    <div className="exp__ribbon">
      <div className="exp__ribbon-label">Programme Overview</div>
      <div className="exp__ribbon-bar">
        {phases.map((p, i) => {
          const widthPct = (p.duration_weeks / span) * 100;
          return (
            <div
              key={i}
              className="exp__ribbon-seg"
              style={{ width: `${widthPct}%`, background: `rgba(231, 113, 51, ${opacities[i]})` }}
              onMouseEnter={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                setTip({ name: p.name, weeks: p.duration_weeks, x: rect.left + rect.width / 2, y: rect.top });
              }}
              onMouseMove={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                setTip({ name: p.name, weeks: p.duration_weeks, x: rect.left + rect.width / 2, y: rect.top });
              }}
              onMouseLeave={() => setTip(null)}
            >
              <span className="exp__ribbon-weeks">{p.duration_weeks}w</span>
            </div>
          );
        })}
      </div>
      <div className="exp__ribbon-scale">
        <span>0</span>
        <span>{Math.round(span / 2)}w</span>
        <span>{span}w</span>
      </div>
      {parallelNote && (
        <p className="exp__ribbon-caption">{parallelNote}</p>
      )}
      {tip && ReactDOM.createPortal(
        <div className="exp__ribbon-tip" style={{ top: tip.y, left: tip.x }}>
          <strong>{tip.name}</strong>
          <span>{tip.weeks} weeks</span>
        </div>,
        document.body
      )}
    </div>
  );
}

function TimelineTab({ candidate }) {
  const seq = candidate.construction?.construction_sequence;
  if (!seq) return <div className="exp__empty">No timeline data</div>;

  const phases = seq.phases || [];
  const totalWeeks = seq.total_weeks || 0;
  const total = phases.length;

  return (
    <div className="exp__tab-content">
      {/* Header */}
      <div className="exp__tl-header">
        <span className="exp__tl-header-label">Estimated Duration</span>
        <span className="exp__tl-header-value">{totalWeeks} weeks</span>
      </div>

      {/* Vertical phase track */}
      <div className="exp__tl-track">
        {phases.map((phase, i) => (
          <div key={i} className={`exp__tl-phase ${i === total - 1 ? 'exp__tl-phase--last' : ''}`}>
            {/* Connector */}
            <div className="exp__tl-connector">
              <div className="exp__tl-dot" />
              {i < total - 1 && <div className="exp__tl-line" />}
            </div>

            {/* Phase card */}
            <div className="exp__tl-card">
              <div className="exp__tl-card-head">
                <span className="exp__tl-card-name">{phase.name}</span>
                <span className="exp__tl-card-weeks">{phase.duration_weeks}w</span>
              </div>

              {/* Tasks */}
              {phase.tasks?.length > 0 && (
                <ul className="exp__tl-tasks">
                  {phase.tasks.map((task, j) => (
                    <li key={j}>{task}</li>
                  ))}
                </ul>
              )}

              {/* Decision gate */}
              {phase.decision_gate && (
                <div className="exp__tl-gate">
                  <span className="exp__tl-gate-icon">&#9432;</span>
                  <span>{phase.decision_gate}</span>
                </div>
              )}

              {/* Hospital constraints */}
              {phase.hospital_constraints && (
                <div className="exp__tl-constraint">
                  <span className="exp__tl-constraint-icon">&#9888;</span>
                  <span>{phase.hospital_constraints}</span>
                </div>
              )}

              {/* Parallel flag */}
              {phase.parallel && (
                <span className="exp__tl-tag">Can overlap with previous phase</span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Timeline Ribbon */}
      <TimelineRibbon phases={phases} totalWeeks={totalWeeks} parallelNote={seq.parallel_opportunities} />
    </div>
  );
}

/* ── Risk Tab ── */

function RiskTab({ candidate }) {
  const risk = candidate.construction?.risk_assessment;
  if (!risk) return <div className="exp__empty">No risk data</div>;

  const ratingColor = {
    low: '#16a34a', medium: '#E77133', high: '#ef4444',
  };

  return (
    <div className="exp__tab-content">
      {/* Overall Rating */}
      <div className="exp__risk-hero" style={{ borderLeftColor: ratingColor[risk.overall_rating] || '#9ca3af' }}>
        <div className="exp__risk-hero-head">
          <span className="exp__risk-rating" style={{ color: ratingColor[risk.overall_rating] }}>
            {(risk.overall_rating || 'unknown').toUpperCase()} RISK
          </span>
          <span className="exp__risk-score">Avg: {risk.avg_risk_score}/10</span>
        </div>
        <p className="exp__risk-summary">{risk.overall_summary || ''}</p>
        <div className="exp__risk-exposure">
          Total Risk Exposure: &euro;{(risk.total_risk_cost_exposure || 0).toLocaleString()}
        </div>
      </div>

      {/* Individual Risks */}
      {(risk.risks || []).map((r, i) => {
        const probColor = {
          very_low: '#16a34a', low: '#16a34a', medium: '#E77133', high: '#ef4444', certain: '#ef4444',
        };
        const impactColor = {
          low: '#16a34a', medium: '#E77133', high: '#ef4444',
        };
        return (
          <div key={i} className="exp__risk-card">
            <div className="exp__risk-card-top">
              <span className="exp__risk-category">{r.category}</span>
              <span className="exp__risk-score-badge">{r.risk_score}/10</span>
            </div>
            <div className="exp__risk-name">{r.risk}</div>
            <div className="exp__risk-badges">
              <span className="exp__risk-prob" style={{ color: probColor[r.probability] || '#9ca3af' }}>
                P: {(r.probability || '').replace('_', ' ')}
              </span>
              <span className="exp__risk-impact" style={{ color: impactColor[r.impact] || '#9ca3af' }}>
                I: {r.impact}
              </span>
              {r.cost_impact > 0 && (
                <span className="exp__risk-cost">&euro;{r.cost_impact.toLocaleString()}</span>
              )}
            </div>
            <div className="exp__risk-mitigation">
              <span className="exp__risk-mit-label">Mitigation</span>
              <p>{r.mitigation}</p>
            </div>
          </div>
        );
      })}

      {/* Regulatory */}
      {candidate.regulatory && (
        <div className="exp__const-section">
          <div className="exp__const-header">
            Regulatory Requirements
            <span className="exp__weeks-badge">{candidate.regulatory.critical_path_weeks}w lead</span>
          </div>
          <p className="exp__const-narrative">{candidate.regulatory.summary}</p>
          {(candidate.regulatory.requirements || []).map((req, i) => (
            <div key={i} className="exp__reg-item">
              <div className="exp__reg-top">
                <span className="exp__reg-name">{req.requirement}</span>
                <span className={`exp__reg-status exp__reg-status--${req.status || 'required'}`}>
                  {req.status || 'required'}
                </span>
              </div>
              <div className="exp__reg-detail">
                <span>{req.authority}</span>
                <span>{req.processing_weeks}w</span>
              </div>
              <p className="exp__reg-desc">{req.description}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Candidate Card ── */

function CandidateCard({ candidate, isOpen, onToggle, onHoverCandidate, onLeaveCandidate }) {
  const [activeTab, setActiveTab] = useState('overview');
  const score = candidate.score || 0;
  const scoreColor = score >= 70 ? '#16a34a' : score >= 45 ? '#E77133' : '#ef4444';
  const wall = candidate.construction?.wall_classification;
  const merged = candidate.merged_projection;
  const seq = candidate.construction?.construction_sequence;

  return (
    <div className={`exp__candidate ${isOpen ? 'exp__candidate--open' : ''}`}
      onMouseEnter={() => onHoverCandidate(candidate.candidate_guid)}
      onMouseLeave={onLeaveCandidate}>
      <div className="exp__candidate-header" onClick={onToggle}>
        <div className="exp__candidate-left">
          <span className="exp__candidate-score" style={{ background: scoreColor }}>{score}</span>
          <div className="exp__candidate-info">
            <span className="exp__candidate-name">{candidate.candidate_name}</span>
            <span className="exp__candidate-fn">{candidate.candidate_function}</span>
          </div>
        </div>
        <span className={`exp__chevron ${isOpen ? 'exp__chevron--open' : ''}`}>&#9660;</span>
      </div>

      {isOpen && (
        <div className="exp__candidate-body">
          <div className="exp__tabs">
            {TAB_KEYS.map((k) => (
              <button key={k} className={`exp__tab ${activeTab === k ? 'exp__tab--active' : ''}`}
                onClick={() => setActiveTab(k)}>
                {TAB_LABELS[k]}
              </button>
            ))}
          </div>
          {activeTab === 'overview' && <OverviewTab candidate={candidate} />}
          {activeTab === 'construction' && <ConstructionTab candidate={candidate} />}
          {activeTab === 'costs' && <CostsTab candidate={candidate} />}
          {activeTab === 'timeline' && <TimelineTab candidate={candidate} />}
          {activeTab === 'risk' && <RiskTab candidate={candidate} />}
        </div>
      )}
    </div>
  );
}

/* ── Main ExpansionPanel ── */

export default function ExpansionPanel() {
  const selectedSpace = useStore((s) => s.selectedSpace);
  const expansionOptions = useStore((s) => s.expansionOptions);
  const setExpansionGuids = useStore((s) => s.setExpansionGuids);

  const [openIndex, setOpenIndex] = useState(0);

  const guid = selectedSpace?.ifc_guid || selectedSpace?.id;
  const candidates = guid ? (expansionOptions[guid] || []) : [];

  // Highlight all candidate rooms on the floor plan
  useEffect(() => {
    if (candidates.length > 0) {
      setExpansionGuids(candidates.map((c) => c.candidate_guid));
    }
    return () => setExpansionGuids([]);
  }, [guid, candidates.length]);

  if (!candidates.length) {
    return (
      <div className="exp">
        <div className="exp__empty-state">
          <p>No expansion candidates found for this space.</p>
          <p className="exp__empty-sub">Adjacent rooms may be infrastructure (corridors, stairs) or too small to absorb.</p>
        </div>
      </div>
    );
  }

  const handleHoverCandidate = (candidateGuid) => {
    setExpansionGuids([candidateGuid]);
  };

  const handleLeaveCandidate = () => {
    setExpansionGuids(candidates.map((c) => c.candidate_guid));
  };

  return (
    <div className="exp">
      <div className="exp__summary">
        {candidates.length} expansion candidate{candidates.length !== 1 ? 's' : ''} - adjacent rooms that could be absorbed
      </div>
      {candidates.map((c, i) => (
        <CandidateCard
          key={c.candidate_guid}
          candidate={c}
          isOpen={openIndex === i}
          onToggle={() => setOpenIndex(openIndex === i ? -1 : i)}
          onHoverCandidate={handleHoverCandidate}
          onLeaveCandidate={handleLeaveCandidate}
        />
      ))}
    </div>
  );
}
