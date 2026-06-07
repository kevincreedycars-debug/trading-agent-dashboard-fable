const layer1Url = "./data/layer1.json";
const layer2Url = "./data/layer2.json";

const labels = {
  "24h": "24H",
  "3d": "3-Day",
  "current_week": "This Week",
  "next_week": "Next Week",
  "current_month": "Month"
};

const orderedAgents = ["USD", "EUR", "GOLD", "NQ", "BTC"];
let layer1Data = null;
let layer2Data = null;
let activeTab = "overview";

function updateClock() {
  const el = document.getElementById("currentTime");
  if (!el) return;
  const now = new Date();
  el.textContent = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short"
  }).format(now);
}

function normaliseDirection(direction = "") {
  return String(direction || "PENDING").replaceAll("_", " ");
}

function directionClass(direction = "") {
  const d = String(direction).toLowerCase();
  if (d.includes("pending")) return "pending";
  if (d.includes("bullish") || d.includes("long")) return d.includes("lean") ? "lean-bullish" : "bullish";
  if (d.includes("bearish") || d.includes("short")) return d.includes("lean") ? "lean-bearish" : "bearish";
  if (d.includes("neutral") || d.includes("no clear")) return "neutral";
  if (d.includes("lean")) return "lean";
  return "neutral";
}

function signalClass(signal = "") {
  const s = String(signal).toLowerCase();
  if (s.includes("bullish")) return "bullish";
  if (s.includes("bearish")) return "bearish";
  if (s.includes("missing")) return "pending";
  return "neutral";
}

function formatConviction(value) {
  return value === null || value === undefined || value === "" ? "--" : `${Number(value)}%`;
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function asObject(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch (e) { return fallback; }
}

function asArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [value];
    } catch (e) {
      return [value];
    }
  }
  return [];
}

function getCall(agent, timeframe = "24h") {
  return agent?.calls?.[timeframe] || { direction: "PENDING", conviction: null, reason: "Awaiting data" };
}

function getAgent(name) {
  return (layer1Data?.agents || []).find(agent => agent.agent === name);
}

function bestLiveAgent() {
  const live = (layer1Data?.agents || []).filter(agent => getCall(agent, "24h").conviction !== null && getCall(agent, "24h").direction !== "PENDING");
  return live.sort((a, b) => Number(getCall(b, "24h").conviction || 0) - Number(getCall(a, "24h").conviction || 0))[0] || null;
}

function renderOverviewStats() {
  const container = document.getElementById("overviewStats");
  if (!container) return;

  const strongest = bestLiveAgent();
  const liveCount = (layer1Data?.agents || []).filter(agent => agent.status === "live").length;
  const updated = layer1Data?.dashboard_meta?.last_updated_et || "pending";

  container.innerHTML = `
    <article class="metric-card hero-metric">
      <p class="eyebrow">Strongest 24H Signal</p>
      <h3>${strongest ? strongest.agent : "PENDING"}</h3>
      <strong class="direction ${directionClass(getCall(strongest, "24h").direction)}">
        ${strongest ? normaliseDirection(getCall(strongest, "24h").direction) : "PENDING"}
      </strong>
      <span>${strongest ? formatConviction(getCall(strongest, "24h").conviction) : "--"} conviction</span>
    </article>
    <article class="metric-card">
      <p class="eyebrow">Live Agents</p>
      <h3>${liveCount} / ${orderedAgents.length}</h3>
      <span>Layer 1 raw producers</span>
    </article>
    <article class="metric-card">
      <p class="eyebrow">Last Data Push</p>
      <h3>${updated === "pending" ? "Pending" : "Live"}</h3>
      <span>${escapeHtml(updated)}</span>
    </article>
  `;
}

function renderAgentCard(agent) {
  const call24 = getCall(agent, "24h");
  const calls = Object.entries(agent.calls || {}).map(([tf, call]) => {
    const direction = call.direction || "PENDING";
    return `
      <div class="call-row compact-call">
        <div class="call-row-head">
          <span class="timeframe">${labels[tf] || tf}</span>
          <span class="direction ${directionClass(direction)}">${normaliseDirection(direction)} ${formatConviction(call.conviction)}</span>
        </div>
      </div>
    `;
  }).join("");

  return `
    <article class="agent-card clickable-card" data-agent="${escapeHtml(agent.agent)}">
      <div class="agent-top">
        <div>
          <p class="eyebrow">Layer 1</p>
          <h3>${escapeHtml(agent.agent)}</h3>
        </div>
        <span class="badge">${escapeHtml(agent.status || "pending")}</span>
      </div>
      <div class="main-signal">
        <span class="direction ${directionClass(call24.direction)}">${normaliseDirection(call24.direction)}</span>
        <strong>${formatConviction(call24.conviction)}</strong>
      </div>
      <p class="summary">${escapeHtml(agent.summary || "")}</p>
      <div class="call-list">${calls}</div>
      <button class="inspect-button" data-agent="${escapeHtml(agent.agent)}">Inspect ${escapeHtml(agent.agent)} Engine</button>
    </article>
  `;
}

function renderLayer1(data) {
  document.getElementById("layer1Updated").textContent =
    `Last updated: ${data.dashboard_meta?.last_updated_et || "pending"}`;

  renderOverviewStats();
  const grid = document.getElementById("layer1Grid");
  grid.innerHTML = (data.agents || []).map(renderAgentCard).join("");

  grid.querySelectorAll("[data-agent]").forEach(el => {
    el.addEventListener("click", () => setTab(el.dataset.agent));
  });
}

function renderCallMatrix(agent) {
  return Object.entries(agent.calls || {}).map(([tf, call]) => `
    <div class="detail-call-card">
      <span class="timeframe">${labels[tf] || tf}</span>
      <strong class="direction ${directionClass(call.direction)}">${normaliseDirection(call.direction)}</strong>
      <b>${formatConviction(call.conviction)}</b>
      <p>${escapeHtml(call.reason || "No reason supplied.")}</p>
    </div>
  `).join("");
}

function renderFactorRows(agent) {
  const factorObj = asObject(agent.factor_breakdown, {});
  const entries = Object.entries(factorObj);

  if (!entries.length && Array.isArray(agent.key_factors)) {
    return agent.key_factors.map(f => `
      <div class="factor-row">
        <div><strong>${escapeHtml(f)}</strong></div>
        <span class="signal-pill neutral">INFO</span>
      </div>
    `).join("");
  }

  if (!entries.length) {
    return `<div class="empty-state">No factor breakdown available yet.</div>`;
  }

  return entries.map(([name, value]) => {
    const detail = typeof value === "object" && value !== null ? value : { signal: String(value) };
    const signal = detail.signal || "NEUTRAL";
    const evidence = detail.evidence || "";
    const reason = detail.reason || "";

    return `
      <div class="factor-row">
        <div>
          <strong>${escapeHtml(name)}</strong>
          ${evidence ? `<p>${escapeHtml(evidence)}</p>` : ""}
          ${reason ? `<small>${escapeHtml(reason)}</small>` : ""}
        </div>
        <span class="signal-pill ${signalClass(signal)}">${escapeHtml(signal)}</span>
      </div>
    `;
  }).join("");
}

function valueOrPending(value) {
  return value === null || value === undefined || value === "" ? "pending" : value;
}

function formatModelPercent(value) {
  if (value === null || value === undefined || value === "") return "pending";
  const n = Number(value);
  if (!Number.isFinite(n)) return escapeHtml(value);
  return `${n <= 1 ? Math.round(n * 100) : Math.round(n)}%`;
}

function renderScoreBreakdown(agent) {
  const output = asObject(agent.full_output || agent.raw_agent_output, {});
  const model = agent.conviction_model || output.conviction_model || {};

  const bullish = agent.score_bullish ?? output.score_bullish ?? "--";
  const bearish = agent.score_bearish ?? output.score_bearish ?? "--";
  const neutral = agent.score_neutral ?? output.score_neutral ?? "--";

  const bullCase = model.bullish_argument_pct;
  const bearCase = model.bearish_argument_pct;
  const neutralPct = model.neutral_pct;
  const netEdge = model.net_edge_pct;
  const conviction = model.final_conviction;
  const participation = model.directional_participation_pct;
  const winningSide = model.winning_side;
  const verdictStrength = model.verdict_strength;

  return `
    <div class="score-grid">
      <div class="score-box"><span>Bullish Factors</span><strong>${bullish}</strong></div>
      <div class="score-box"><span>Bearish Factors</span><strong>${bearish}</strong></div>
      <div class="score-box"><span>Neutral Factors</span><strong>${neutral}</strong></div>
      <div class="score-box"><span>Winning Side</span><strong>${winningSide || "--"}</strong></div>
    </div>

    <div class="conviction-model">
      <p><strong>Bull Case:</strong> ${formatModelPercent(bullCase)}</p>
      <p><strong>Bear Case:</strong> ${formatModelPercent(bearCase)}</p>
      <p><strong>Conviction:</strong> ${formatModelPercent(conviction)}</p>
      <p><strong>Net Edge:</strong> ${netEdge ?? "--"}%</p>
      <p><strong>Directional Participation:</strong> ${formatModelPercent(participation)}</p>
      <p><strong>Neutral / Inactive:</strong> ${formatModelPercent(neutralPct)}</p>
      <p><strong>Verdict Strength:</strong> ${verdictStrength || "--"}</p>
      <p><strong>Final Logic:</strong> ${escapeHtml(model.final_conviction_logic ?? "No conviction model supplied yet.")}</p>
    </div>
  `;
}

function renderAgentDetail(agentName) {
  const view = document.getElementById("agentView");
  const agent = getAgent(agentName);

  if (!agent) {
    view.innerHTML = `
      <section class="detail-shell">
        <div class="empty-state">No ${escapeHtml(agentName)} agent output available yet.</div>
      </section>
    `;
    return;
  }

  const call24 = getCall(agent, "24h");
  const warnings = asArray(agent.warnings).map(w => `<div class="warning-card">⚠ ${escapeHtml(w)}</div>`).join("") || `<div class="empty-state">No warnings reported.</div>`;

  view.innerHTML = `
    <section class="agent-detail-hero">
      <div>
        <p class="eyebrow">Layer 1 Independent Agent</p>
        <h2>${escapeHtml(agent.agent)} Direction Engine</h2>
        <p class="subcopy">${escapeHtml(agent.summary || "Raw directional agent output.")}</p>
      </div>
      <div class="signal-tower">
        <span>24H Primary Call</span>
        <strong class="direction ${directionClass(call24.direction)}">${normaliseDirection(call24.direction)}</strong>
        <b>${formatConviction(call24.conviction)}</b>
        <small>Last run: ${escapeHtml(agent.last_run_et || "pending")}</small>
      </div>
    </section>

    <section class="detail-grid">
      <article class="detail-panel wide-panel">
        <div class="panel-head">
          <p class="eyebrow">Timeframes</p>
          <h3>Directional Calls</h3>
        </div>
        <div class="detail-call-grid">${renderCallMatrix(agent)}</div>
      </article>

      <article class="detail-panel">
        <div class="panel-head">
          <p class="eyebrow">Factor Engine</p>
          <h3>Metrics Being Read</h3>
        </div>
        <div class="factor-table">${renderFactorRows(agent)}</div>
      </article>

      <article class="detail-panel">
        <div class="panel-head">
          <p class="eyebrow">Conviction</p>
          <h3>Score Breakdown</h3>
        </div>
        ${renderScoreBreakdown(agent)}
      </article>

      <article class="detail-panel wide-panel">
        <div class="panel-head">
          <p class="eyebrow">Interpretation</p>
          <h3>Why The Agent Reached This Outcome</h3>
        </div>
        <p class="long-reason">${escapeHtml(agent.reasoning_summary || call24.reason || "No reasoning supplied yet.")}</p>
      </article>

      <article class="detail-panel">
        <div class="panel-head">
          <p class="eyebrow">Warnings</p>
          <h3>Missing Inputs / Risk Flags</h3>
        </div>
        <div class="warning-list">${warnings}</div>
      </article>

      <article class="detail-panel">
        <div class="panel-head">
          <p class="eyebrow">Source of Truth</p>
          <h3>Logic Document</h3>
        </div>
        <div class="logic-box">
          <p><strong>Document:</strong> ${escapeHtml(agent.logic_document || "agent logic pending")}</p>
          <p><strong>Version:</strong> ${escapeHtml(agent.logic_document_version || "unknown")}</p>
          <p><strong>Isolation:</strong> Layer 1 raw call. No cross-agent contamination.</p>
        </div>
      </article>
    </section>
  `;
}

function renderLayer2(data) {
  document.getElementById("layer2Updated").textContent =
    `Last updated: ${data.dashboard_meta?.last_updated_et || "pending"}`;

  const panel = document.getElementById("layer2Panel");
  const agent = data.eco_events_agent || {};
  const adjusted = agent.adjusted_calls || {};

  const cards = Object.entries(adjusted).map(([asset, call]) => {
    const direction = call.direction || "PENDING";
    return `
      <div class="adjusted-card">
        <p class="eyebrow">${escapeHtml(asset)}</p>
        <h3 class="direction ${directionClass(direction)}">${normaliseDirection(direction)}</h3>
        <p class="summary">${formatConviction(call.conviction)} conviction</p>
        <p class="reason">${escapeHtml(call.adjustment || "")}</p>
      </div>
    `;
  }).join("");

  panel.innerHTML = `
    <div class="layer2-summary">
      <div>
        <p class="eyebrow">Eco Events Agent</p>
        <h3>${escapeHtml(agent.event_risk || "PENDING")} event risk</h3>
      </div>
      <p class="summary">${escapeHtml(agent.summary || "Awaiting event layer.")}</p>
    </div>
    <div class="adjusted-grid">${cards || `<div class="empty-state">Awaiting Layer 2 adjusted calls.</div>`}</div>
  `;
}

function setTab(tab) {
  activeTab = tab;
  document.querySelectorAll(".tab-button").forEach(btn => btn.classList.toggle("active", btn.dataset.tab === tab));
  document.getElementById("overviewView").classList.toggle("active-view", tab === "overview");
  document.getElementById("layer2View").classList.toggle("active-view", tab === "layer2");
  document.getElementById("agentView").classList.toggle("active-view", orderedAgents.includes(tab));

  if (orderedAgents.includes(tab)) renderAgentDetail(tab);
}

function setupTabs() {
  document.querySelectorAll(".tab-button").forEach(btn => {
    btn.addEventListener("click", () => setTab(btn.dataset.tab));
  });
}

async function loadDashboard() {
  try {
    const [layer1Res, layer2Res] = await Promise.all([
      fetch(layer1Url, { cache: "no-store" }),
      fetch(layer2Url, { cache: "no-store" })
    ]);

    layer1Data = await layer1Res.json();
    layer2Data = await layer2Res.json();

    renderLayer1(layer1Data);
    renderLayer2(layer2Data);
    if (orderedAgents.includes(activeTab)) renderAgentDetail(activeTab);
  } catch (err) {
    console.error(err);
    document.getElementById("layer1Grid").innerHTML = `<p class="warning">Could not load dashboard JSON.</p>`;
  }
}

setupTabs();
updateClock();
setInterval(updateClock, 1000);
loadDashboard();
setInterval(loadDashboard, 60000);
