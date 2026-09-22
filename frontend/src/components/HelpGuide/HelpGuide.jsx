import React, { useEffect } from 'react';
import './HelpGuide.css';

const VOICE_COMMANDS = [
  { say: '"Hello Delta"',      result: 'Wakes the microphone — Delta greets you',             alt: 'Hey Delta, Hi Delta' },
  { say: '"Submit"',           result: 'Sends your spoken prompt to Delta',                    alt: 'Send Delta, Submitted' },
  { say: '"Stop Delta"',      result: 'Cancels the current AI response (stays listening)',     alt: 'Stopped Delta' },
  { say: '"Thank you Delta"', result: 'Closes the microphone entirely',                        alt: 'Thanks Delta' },
  { say: '"Clear Delta"',     result: 'Clears the text input',                                 alt: 'Cancel Delta, Clean Delta' },
  { say: '"Close repurpose analysis"', result: 'Closes only the repurpose dropdown',           alt: 'Hide repurpose analysis' },
  { say: '"Close expansion analysis"', result: 'Closes only the expansion dropdown',           alt: 'Hide expansion analysis' },
  { say: '"Close the panel"', result: 'Closes the entire toolkit drawer',                      alt: 'Hide the toolkit, Dismiss the drawer' },
];

const PROMPT_SECTIONS = [
  {
    title: 'Navigate the Hospital',
    prompts: [
      { cmd: 'Go to Floor 2',                         desc: 'Navigates the 3D viewer to Floor +2' },
      { cmd: 'Take me to the Ground Floor',            desc: 'Navigates to Level 0' },
      { cmd: 'Show me Basement 1',                     desc: 'Navigates to Level -1' },
    ],
  },
  {
    title: 'Find & Search Rooms',
    prompts: [
      { cmd: 'Show me all patient rooms',              desc: 'Lists patient rooms on the current floor' },
      { cmd: 'Find all operating rooms on Floor 2',    desc: 'Searches a specific floor and function' },
      { cmd: 'Where are the conference rooms?',        desc: 'Locates and lists matching spaces' },
      { cmd: 'Find a bookable room',                   desc: 'Filters rooms by bookability' },
      { cmd: 'List all toilets on this floor',         desc: 'Function-based search on active floor' },
    ],
  },
  {
    title: 'Room Intelligence',
    prompts: [
      { cmd: 'Tell me about this room',                desc: 'Full details of the selected room' },
      { cmd: 'What\u2019s the occupancy?',             desc: 'Capacity data for the selected room' },
      { cmd: 'What furnishings are in this room?',     desc: 'Lists all furnishing items' },
      { cmd: 'Is this room accessible?',               desc: 'Accessibility and step-free info' },
      { cmd: 'What are the adjacent spaces?',          desc: 'Shows neighboring rooms' },
    ],
  },
  {
    title: 'Capacity Planning',
    prompts: [
      { cmd: 'Find a room for 20 people',              desc: 'Searches by capacity, ranked by suitability' },
      { cmd: 'Where can I hold a meeting for 15?',     desc: 'Capacity + bookability search' },
      { cmd: 'Show rooms with high occupancy',         desc: 'Occupancy-based filtering' },
    ],
  },
  {
    title: 'Wayfinding & Routing',
    prompts: [
      { cmd: 'Where\u2019s the nearest lift?',         desc: 'Shows closest elevator and distance' },
      { cmd: 'Find the closest staircase',             desc: 'Shows closest stairs and distance' },
      { cmd: 'Show adjacent rooms',                    desc: 'Highlights neighboring spaces' },
    ],
  },
  {
    title: 'Space Analysis',
    prompts: [
      { cmd: 'I\u2019d like to repurpose this room',   desc: 'Opens Repurpose Analysis with scored alternatives' },
      { cmd: 'Can I expand this room?',                desc: 'Opens Expansion Analysis (commercial rooms)' },
      { cmd: 'Show evacuation points on this floor',   desc: 'Top collection points ranked by capacity' },
    ],
  },
  {
    title: 'Directory Browsing',
    prompts: [
      { cmd: 'Open the offices group',                 desc: 'Expands that function group in the directory' },
      { cmd: 'Select room 3',                          desc: 'Selects the 3rd room in the expanded group' },
      { cmd: 'Next room / Previous room',              desc: 'Steps through the group sequentially' },
      { cmd: 'Select the last room',                   desc: 'Jumps to the last room in the group' },
    ],
  },
];

const HEATMAP_MODES = [
  { mode: 'Function',          desc: 'Default view. Each room is coloured by its primary function (e.g. Patient Care, Offices, Circulation). Quickly identify which departments occupy which areas.' },
  { mode: 'Area',              desc: 'Colours rooms by total floor area (m\u00B2). Larger rooms appear red, smaller rooms green. Useful for spotting oversized or undersized spaces.' },
  { mode: 'Occupancy',         desc: 'Based on maximum occupancy count. Highlights rooms that hold the most people, helping with crowd management and fire-safety audits.' },
  { mode: 'Occupancy Density', desc: 'Persons per square metre (max occupancy \u00F7 area). Flags rooms that may be over-packed relative to their size.' },
  { mode: 'Area per Bed',      desc: 'Square metres per bed (area \u00F7 normal occupancy). Only meaningful for rooms with beds. Helps ensure patient rooms meet minimum space standards.' },
  { mode: 'Utilisation',       desc: 'Binary indicator \u2014 shows whether a room has any assigned capacity. Green = has occupancy potential, red = no capacity assigned. Quick way to find vacant or unallocated spaces.' },
  { mode: 'Evacuation',        desc: 'Based on absolute occupancy. Highlights rooms that require the most evacuation time. Critical for emergency planning and fire-warden assignments.' },
  { mode: 'Status',            desc: 'Operational state of each room: green = operational, amber = maintenance, red = closed, grey = unknown. Essential for daily facilities checks.' },
];

const REPURPOSE_SCORES = [
  { label: 'Size Match',            desc: 'How well the room\u2019s area fits the target function\u2019s typical range.' },
  { label: 'Service Demand',        desc: 'How urgently the floor needs more of this function based on current distribution gaps.' },
  { label: 'Location Synergy',      desc: 'Benefit from complementary rooms nearby (e.g. a recovery room near operating theatres).' },
  { label: 'Zone Fit',              desc: 'Whether the surrounding area\u2019s category matches the proposed use.' },
  { label: 'Infrastructure',        desc: 'Availability of required MEP systems (water, gas, power, ventilation) already in place.' },
  { label: 'Regulatory',            desc: 'Permit and compliance complexity \u2014 higher score means fewer hurdles.' },
  { label: 'Asset Retention',       desc: 'Percentage of existing furniture and fixtures that can be reused.' },
  { label: 'Cost Efficiency',       desc: 'Inverse of conversion cost \u2014 cheaper conversions score higher.' },
  { label: 'Revenue Impact',        desc: 'Expected financial upside from the new function.' },
  { label: 'Service Continuity',    desc: 'Risk level of removing the room\u2019s current function from the floor.' },
  { label: 'Patient Flow',          desc: 'Impact on care pathways and patient routing (healthcare-specific).' },
  { label: 'Conversion Ease',       desc: 'How disruptive the physical conversion work would be.' },
  { label: 'Utilisation Potential',  desc: 'Expected usage rate of the room after conversion.' },
];

const EXPANSION_SCORES = [
  { label: 'Wall Removability',     desc: 'How feasible it is to remove the shared wall (partition vs. structural).' },
  { label: 'MEP Complexity',        desc: 'How many mechanical/electrical/plumbing systems would need rerouting.' },
  { label: 'Structural Impact',     desc: 'Load-bearing considerations and whether a structural engineer is needed.' },
  { label: 'Service Continuity',    desc: 'Risk of disrupting the adjacent room\u2019s current service.' },
  { label: 'Construction Access',   desc: 'Ease of getting construction teams and materials to the site.' },
  { label: 'Noise Sensitivity',     desc: 'Whether nearby rooms are noise-sensitive (e.g. patient wards, theatres).' },
  { label: 'Infection Control',     desc: 'Contamination risk during construction in a clinical environment.' },
  { label: 'Egress Compliance',     desc: 'Impact on emergency exit routes and fire-safety compliance.' },
  { label: 'Utility Capacity',      desc: 'Whether existing utility feeds can handle the expanded room.' },
  { label: 'Phasing Feasibility',   desc: 'Whether construction can be staged to keep adjacent spaces operational.' },
  { label: 'Adjacency Quality',     desc: 'How well the merged space works with its new neighbours.' },
  { label: 'Area Gain Efficiency',  desc: 'Ratio of usable area gained versus total disruption.' },
];

export default function HelpGuide({ open, onClose }) {
  useEffect(() => {
    if (!open) return;
    const handleKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="help-guide__backdrop" onClick={onClose}>
      <div className="help-guide__modal" onClick={(e) => e.stopPropagation()}>
        <button className="help-guide__close" onClick={onClose} title="Close guide">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M15 5L5 15M5 5l10 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </button>

        <div className="help-guide__scroll">
          {/* Header */}
          <div className="help-guide__header">
            <span className="help-guide__icon">&#9651;</span>
            <div>
              <h1 className="help-guide__title">How to Use Delta</h1>
              <p className="help-guide__subtitle">CHIREC Delta Hospital Intelligence Platform</p>
            </div>
          </div>

          {/* ─── Section 1: Platform Layout ─── */}
          <section className="help-guide__section">
            <h2 className="help-guide__section-title">Platform Layout</h2>
            <p className="help-guide__text">
              The platform is divided into three panels that work together. All three are always visible
              so you can navigate, inspect, and query simultaneously.
            </p>
            <div className="help-guide__panel-cards">
              <div className="help-guide__panel-card">
                <div className="help-guide__panel-card-header">
                  <span className="help-guide__panel-card-icon">
                    <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><rect x="2" y="2" width="14" height="14" rx="2" stroke="currentColor" strokeWidth="1.3"/><line x1="2" y1="7" x2="16" y2="7" stroke="currentColor" strokeWidth="1.3"/><line x1="2" y1="12" x2="16" y2="12" stroke="currentColor" strokeWidth="1.3"/></svg>
                  </span>
                  <strong>Left Panel &mdash; Floor Directory</strong>
                </div>
                <p>Browse all floors via the dropdown at the top. Below it, every room on the selected floor
                   is grouped by function (e.g. Patient Care, Offices, Circulation). Click a group to expand it and
                   see individual rooms. Click a room to select it in the 3D viewer and open the Space Toolkit.</p>
                <ul className="help-guide__panel-card-list">
                  <li>Floor selector dropdown at top</li>
                  <li>Search bar to filter rooms by name or function</li>
                  <li>Each group shows: unit count, total area (m&sup2;), total occupancy</li>
                  <li>Heatmap toggle to colour-code the floor plan</li>
                </ul>
              </div>

              <div className="help-guide__panel-card">
                <div className="help-guide__panel-card-header">
                  <span className="help-guide__panel-card-icon">
                    <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M2 4l7-2 7 2v10l-7 2-7-2V4z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/><line x1="9" y1="2" x2="9" y2="16" stroke="currentColor" strokeWidth="1.3"/></svg>
                  </span>
                  <strong>Centre Panel &mdash; 3D Viewer</strong>
                </div>
                <p>Interactive 3D model of the hospital, powered by xeokit. Rooms are colour-coded
                   by the active heatmap mode. Click any room to select it, double-click to fly in close.
                   The Space Toolkit drawer opens at the bottom of this panel when a room is selected.</p>
                <ul className="help-guide__panel-card-list">
                  <li>Scroll to zoom, left-drag to orbit, right-drag to pan</li>
                  <li>Selected room highlights in orange</li>
                  <li>Floor switching re-renders the model automatically</li>
                </ul>
              </div>

              <div className="help-guide__panel-card">
                <div className="help-guide__panel-card-header">
                  <span className="help-guide__panel-card-icon">
                    <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><rect x="2" y="3" width="14" height="12" rx="2" stroke="currentColor" strokeWidth="1.3"/><path d="M5 8h8M5 11h5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
                  </span>
                  <strong>Right Panel &mdash; Chat with Delta AI</strong>
                </div>
                <p>Type or speak natural-language questions. Delta understands floor navigation, room searches,
                   capacity queries, wayfinding, and analysis commands. Responses stream in real time and can
                   trigger actions like selecting rooms, changing floors, or opening analysis panels.</p>
                <ul className="help-guide__panel-card-list">
                  <li>Text input at the bottom with send button</li>
                  <li>Microphone button for voice mode</li>
                  <li>Conversation history scrolls up</li>
                </ul>
              </div>
            </div>
          </section>

          {/* ─── Section 2: Quick Start ─── */}
          <section className="help-guide__section">
            <h2 className="help-guide__section-title">Quick Start</h2>
            <div className="help-guide__quickstart">
              <div className="help-guide__qs-item">
                <span className="help-guide__qs-num">1</span>
                <div>
                  <strong>Navigate floors</strong> using the dropdown on the left panel. The 3D model and
                  directory update instantly.
                </div>
              </div>
              <div className="help-guide__qs-item">
                <span className="help-guide__qs-num">2</span>
                <div>
                  <strong>Click any room</strong> in the 3D viewer or left directory to select it. The Space
                  Toolkit opens with full room intelligence.
                </div>
              </div>
              <div className="help-guide__qs-item">
                <span className="help-guide__qs-num">3</span>
                <div>
                  <strong>Ask Delta</strong> anything via text or voice &mdash; room details, capacity searches,
                  wayfinding, repurpose analysis, and more.
                </div>
              </div>
            </div>
          </section>

          {/* ─── Section 3: Floor Directory ─── */}
          <section className="help-guide__section">
            <h2 className="help-guide__section-title">Understanding the Floor Directory</h2>
            <p className="help-guide__text">
              The left panel organises every room on the selected floor into function groups. Each group
              header shows three key metrics at a glance:
            </p>
            <div className="help-guide__def-list">
              <div className="help-guide__def-item">
                <span className="help-guide__def-term">Unit Count</span>
                <span className="help-guide__def-desc">Number of rooms in the group</span>
              </div>
              <div className="help-guide__def-item">
                <span className="help-guide__def-term">Total Area</span>
                <span className="help-guide__def-desc">Combined floor area of all rooms in the group (m&sup2;)</span>
              </div>
              <div className="help-guide__def-item">
                <span className="help-guide__def-term">Total Occupancy</span>
                <span className="help-guide__def-desc">Sum of max occupancy across the group, or &ldquo;&ndash;&rdquo; if zero</span>
              </div>
            </div>
            <p className="help-guide__text">
              Click a group header to expand it and reveal individual room cards. Each card shows the
              room&rsquo;s name and area. Click a room card to select it in the 3D viewer and open the
              Space Toolkit. Groups are sorted alphabetically, with &ldquo;Unassigned&rdquo; rooms at the bottom.
            </p>
            <p className="help-guide__text">
              Use the <strong>search bar</strong> at the top to filter rooms by name or function. The
              results update instantly as you type.
            </p>
          </section>

          {/* ─── Section 4: Room Data ─── */}
          <section className="help-guide__section">
            <h2 className="help-guide__section-title">Understanding Room Data</h2>
            <p className="help-guide__text">
              When you select a room, the Space Toolkit shows detailed intelligence across several
              collapsible sections. Here is what each field means:
            </p>

            <h3 className="help-guide__subsection-title">Description</h3>
            <div className="help-guide__def-list">
              <div className="help-guide__def-item">
                <span className="help-guide__def-term">Primary Function</span>
                <span className="help-guide__def-desc">The room&rsquo;s assigned department or use (e.g. Patient Care, Offices, Storage)</span>
              </div>
              <div className="help-guide__def-item">
                <span className="help-guide__def-term">Room Number</span>
                <span className="help-guide__def-desc">The room&rsquo;s identifier from the building plans</span>
              </div>
              <div className="help-guide__def-item">
                <span className="help-guide__def-term">IFC GUID</span>
                <span className="help-guide__def-desc">Unique ID from the BIM model &mdash; useful for cross-referencing with architectural drawings</span>
              </div>
            </div>

            <h3 className="help-guide__subsection-title">Metrics</h3>
            <div className="help-guide__def-list">
              <div className="help-guide__def-item">
                <span className="help-guide__def-term">Area (m&sup2;)</span>
                <span className="help-guide__def-desc">Total floor area of the room</span>
              </div>
              <div className="help-guide__def-item">
                <span className="help-guide__def-term">Perimeter (m)</span>
                <span className="help-guide__def-desc">Total wall perimeter length</span>
              </div>
              <div className="help-guide__def-item">
                <span className="help-guide__def-term">Used Area</span>
                <span className="help-guide__def-desc">Floor space occupied by furnishings, shown as m&sup2; and as a percentage of total area</span>
              </div>
              <div className="help-guide__def-item">
                <span className="help-guide__def-term">Free Area</span>
                <span className="help-guide__def-desc">Remaining unoccupied floor space</span>
              </div>
              <div className="help-guide__def-item">
                <span className="help-guide__def-term">Normal Occupancy</span>
                <span className="help-guide__def-desc">Typical day-to-day capacity &mdash; the number of people the room is designed to hold during standard operation</span>
              </div>
              <div className="help-guide__def-item">
                <span className="help-guide__def-term">Max Occupancy</span>
                <span className="help-guide__def-desc">Maximum safe capacity &mdash; the upper limit including temporary overflow or surge scenarios</span>
              </div>
              <div className="help-guide__def-item">
                <span className="help-guide__def-term">Absolute Occupancy</span>
                <span className="help-guide__def-desc">Current or real-time occupancy count (shown only when greater than zero). Used for evacuation time calculations</span>
              </div>
            </div>

            <h3 className="help-guide__subsection-title">Furnishings</h3>
            <p className="help-guide__text">
              Lists every item in the room, grouped into six categories: <strong>Beds</strong>, <strong>Seating</strong>,
              <strong>Storage</strong>, <strong>Equipment</strong>, <strong>Fixtures</strong>,
              and <strong>Furniture</strong>. Each item shows its quantity, total footprint (m&sup2;),
              and occupancy contribution.
            </p>

            <h3 className="help-guide__subsection-title">Routing</h3>
            <p className="help-guide__text">
              Shows the nearest elevator and staircase to the selected room, with distance in metres and
              estimated walking time. Essential for accessibility checks and evacuation route planning.
            </p>
          </section>

          {/* ─── Section 5: Heatmaps ─── */}
          <section className="help-guide__section">
            <h2 className="help-guide__section-title">Heatmap Modes</h2>
            <p className="help-guide__text">
              The heatmap toggle in the floor directory lets you colour-code every room on the floor by
              different metrics. Use heatmaps to quickly spot patterns, outliers, and problem areas.
              Colours range from <span className="help-guide__color-chip help-guide__color-chip--green">green (low)</span> to
              <span className="help-guide__color-chip help-guide__color-chip--red"> red (high)</span> on
              a continuous gradient.
            </p>
            <div className="help-guide__heatmap-list">
              {HEATMAP_MODES.map((h, i) => (
                <div key={i} className="help-guide__heatmap-item">
                  <span className="help-guide__heatmap-mode">{h.mode}</span>
                  <span className="help-guide__heatmap-desc">{h.desc}</span>
                </div>
              ))}
            </div>
            <div className="help-guide__tip">
              <strong>Tip for Facilities Managers:</strong> Start with <em>Status</em> heatmap for your daily
              walkthrough, then switch to <em>Occupancy Density</em> to flag rooms that may need crowd
              management attention.
            </div>
          </section>

          {/* ─── Section 6: Repurpose Analysis ─── */}
          <section className="help-guide__section">
            <h2 className="help-guide__section-title">Repurpose Analysis</h2>
            <p className="help-guide__text">
              Select a room and ask Delta <em>&ldquo;I&rsquo;d like to repurpose this room&rdquo;</em> or open the
              Repurpose Analysis section in the Space Toolkit. Delta evaluates every possible alternative function
              and ranks them by an overall score (0&ndash;100). Each option is assessed across 13 dimensions:
            </p>
            <div className="help-guide__score-grid">
              {REPURPOSE_SCORES.map((s, i) => (
                <div key={i} className="help-guide__score-item">
                  <span className="help-guide__score-label">{s.label}</span>
                  <span className="help-guide__score-desc">{s.desc}</span>
                </div>
              ))}
            </div>
            <div className="help-guide__score-legend">
              <span>Score colours: </span>
              <span className="help-guide__score-chip help-guide__score-chip--green">75&ndash;100 Strong fit</span>
              <span className="help-guide__score-chip help-guide__score-chip--orange">50&ndash;74 Moderate</span>
              <span className="help-guide__score-chip help-guide__score-chip--red">0&ndash;49 Weak fit</span>
            </div>

            <h3 className="help-guide__subsection-title">Cost Breakdown</h3>
            <p className="help-guide__text">
              Each repurpose option includes a full cost estimate organised into categories:
              <strong> Renovation</strong> (paint, flooring, ceiling, MEP),
              <strong> Furnishings</strong> (removal, purchase, installation),
              <strong> Infrastructure</strong> (MEP rerouting by system),
              <strong> Labour</strong> (contractor, specialist trades, project management),
              <strong> Permits</strong> (building, change-of-use, fire, health authority), and
              <strong> Contingency</strong> (base, complexity, regulatory, supply chain). The total includes
              VAT, retention, and a CAPEX/OPEX split with depreciation schedules.
            </p>

            <h3 className="help-guide__subsection-title">Timeline</h3>
            <p className="help-guide__text">
              Each option shows an estimated conversion timeline in weeks, broken into phases with
              specific tasks and decision gates. Use this to plan around operational constraints and
              minimise service disruption.
            </p>

            <div className="help-guide__tip">
              <strong>Tip:</strong> Focus on options with high <em>Service Continuity</em> and
              <em> Conversion Ease</em> scores first &mdash; these are the least disruptive changes and
              the fastest to deliver.
            </div>
          </section>

          {/* ─── Section 7: Expansion Analysis ─── */}
          <section className="help-guide__section">
            <h2 className="help-guide__section-title">Expansion Analysis</h2>
            <p className="help-guide__text">
              For commercial and clinical spaces, ask Delta <em>&ldquo;Can I expand this room?&rdquo;</em>
              Delta identifies adjacent candidate rooms that could be merged and evaluates each option.
            </p>

            <h3 className="help-guide__subsection-title">Overview Metrics</h3>
            <div className="help-guide__def-list">
              <div className="help-guide__def-item">
                <span className="help-guide__def-term">Area Gain</span>
                <span className="help-guide__def-desc">Additional m&sup2; gained and percentage increase over current room size</span>
              </div>
              <div className="help-guide__def-item">
                <span className="help-guide__def-term">Revenue Uplift</span>
                <span className="help-guide__def-desc">Estimated additional annual revenue (EUR/yr) and percentage uplift</span>
              </div>
              <div className="help-guide__def-item">
                <span className="help-guide__def-term">Investment</span>
                <span className="help-guide__def-desc">Total project cost (EUR) and cost per m&sup2; gained</span>
              </div>
              <div className="help-guide__def-item">
                <span className="help-guide__def-term">Payback Period</span>
                <span className="help-guide__def-desc">Months until the investment is recovered through additional revenue</span>
              </div>
            </div>

            <h3 className="help-guide__subsection-title">Wall Classification</h3>
            <p className="help-guide__text">
              Each candidate wall is classified by type (partition, structural, etc.) with a risk level
              (low / medium / high), thickness, and flags indicating whether structural engineering or
              shoring is required.
            </p>

            <h3 className="help-guide__subsection-title">MEP Impact</h3>
            <p className="help-guide__text">
              Shows which building systems (HVAC, plumbing, electrical, fire, medical gas) would be
              affected, their impact level, estimated reroute cost, and required action. A complexity
              badge summarises the overall MEP difficulty.
            </p>

            <h3 className="help-guide__subsection-title">Scoring Dimensions (12)</h3>
            <div className="help-guide__score-grid">
              {EXPANSION_SCORES.map((s, i) => (
                <div key={i} className="help-guide__score-item">
                  <span className="help-guide__score-label">{s.label}</span>
                  <span className="help-guide__score-desc">{s.desc}</span>
                </div>
              ))}
            </div>

            <div className="help-guide__tip">
              <strong>Tip:</strong> Pay close attention to <em>Infection Control</em> and
              <em> Noise Sensitivity</em> scores when expanding clinical spaces &mdash; these are the
              most common causes of project delays in hospital environments.
            </div>
          </section>

          {/* ─── Section 8: Voice Commands ─── */}
          <section className="help-guide__section">
            <h2 className="help-guide__section-title">Voice Commands</h2>
            <p className="help-guide__text">
              Click the microphone icon in the chat panel to activate voice mode. Speak naturally &mdash;
              Delta listens continuously until you close the mic. The following trigger phrases are
              recognised instantly (no AI processing delay):
            </p>
            <table className="help-guide__table">
              <thead>
                <tr>
                  <th>Say this</th>
                  <th>What happens</th>
                  <th>Also works</th>
                </tr>
              </thead>
              <tbody>
                {VOICE_COMMANDS.map((v, i) => (
                  <tr key={i}>
                    <td className="help-guide__cmd">{v.say}</td>
                    <td>{v.result}</td>
                    <td className="help-guide__alt">{v.alt}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="help-guide__text" style={{ marginTop: 12 }}>
              Any other spoken text is treated as a regular prompt and sent to the AI for processing. You
              can mix voice trigger phrases with conversational queries in the same session.
            </p>
          </section>

          {/* ─── Section 9: What You Can Ask ─── */}
          <section className="help-guide__section">
            <h2 className="help-guide__section-title">What You Can Ask Delta</h2>
            <p className="help-guide__text">
              Type or speak any of these prompts. Delta executes actions instantly and responds with
              relevant data. These are examples &mdash; Delta understands natural variations of each.
            </p>
            {PROMPT_SECTIONS.map((sec, si) => (
              <div key={si} className="help-guide__prompt-group">
                <h3 className="help-guide__prompt-group-title">{sec.title}</h3>
                <div className="help-guide__prompt-list">
                  {sec.prompts.map((p, pi) => (
                    <div key={pi} className="help-guide__prompt-row">
                      <span className="help-guide__prompt-cmd">{p.cmd}</span>
                      <span className="help-guide__prompt-desc">{p.desc}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </section>

          {/* ─── Section 10: 3D Controls ─── */}
          <section className="help-guide__section">
            <h2 className="help-guide__section-title">3D Viewer Controls</h2>
            <div className="help-guide__controls-grid">
              <div className="help-guide__control">
                <span className="help-guide__control-key">Scroll</span>
                <span>Zoom in / out</span>
              </div>
              <div className="help-guide__control">
                <span className="help-guide__control-key">Left drag</span>
                <span>Rotate the view</span>
              </div>
              <div className="help-guide__control">
                <span className="help-guide__control-key">Right drag</span>
                <span>Pan the view</span>
              </div>
              <div className="help-guide__control">
                <span className="help-guide__control-key">Click room</span>
                <span>Select and inspect</span>
              </div>
              <div className="help-guide__control">
                <span className="help-guide__control-key">Double-click</span>
                <span>Fly to room</span>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
