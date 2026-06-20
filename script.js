const layer1Url = "./data/layer1.json";
const layer2Url = "./data/layer2.json";
const backtestUrl = "./data/backtest.json";
const workflowControlUrl = "./data/workflow-control.json";

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
let backtestData = null;
let workflowControl = null;
let workflowStatus = null;
let workflowPollTimer = null;
let workflowTriggerInFlight = false;
let activeTab = "overview";
let activeBacktestTab = "accuracy";

function updateClock() {
  const el = document.getElementById("currentTime");
  const topbarClock = document.getElementById("topbarClock");
  const currentDate = document.getElementById("currentDate");
  const now = new Date();
  const etTime = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short"
  }).format(now);

  if (el) el.textContent = etTime;
  if (topbarClock) topbarClock.textContent = etTime;
  if (currentDate) {
    currentDate.textContent = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric"
    }).format(now);
  }
}

function initMarketGlobe() {
  const canvas = document.getElementById("marketGlobeCanvas");
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const cx = width / 2;
  const cy = height / 2;
  const radius = 118;
  let rotation = 0;
  let tick = 0;

  const cities = [
    { lat: 51.5, lng: -0.1 },
    { lat: 40.7, lng: -74 },
    { lat: 35.7, lng: 139.7 },
    { lat: 1.3, lng: 103.8 },
    { lat: 25.2, lng: 55.3 },
    { lat: 22.3, lng: 114.2 },
    { lat: -33.9, lng: 151.2 }
  ];
  const routes = [[0, 1], [0, 2], [0, 3], [1, 2], [2, 3], [0, 4], [4, 3], [2, 5], [3, 6]];
  const travelers = routes.map((route, index) => ({
    route: index,
    progress: index / routes.length,
    speed: 0.0013 + (index % 4) * 0.00022
  }));

  function toPoint(lat, lng, r = radius) {
    const phi = (90 - lat) * Math.PI / 180;
    const theta = (lng + rotation * 180 / Math.PI) * Math.PI / 180;
    return {
      x: r * Math.sin(phi) * Math.cos(theta),
      y: r * Math.cos(phi),
      z: r * Math.sin(phi) * Math.sin(theta)
    };
  }

  function normalise(point) {
    const size = Math.sqrt(point.x ** 2 + point.y ** 2 + point.z ** 2);
    return { x: point.x / size, y: point.y / size, z: point.z / size };
  }

  function slerp(a, b, amount) {
    const dot = Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y + a.z * b.z));
    const omega = Math.acos(dot);
    if (Math.abs(omega) < 0.001) {
      return {
        x: a.x + (b.x - a.x) * amount,
        y: a.y + (b.y - a.y) * amount,
        z: a.z + (b.z - a.z) * amount
      };
    }

    const sin = Math.sin(omega);
    return {
      x: (Math.sin((1 - amount) * omega) / sin) * a.x + (Math.sin(amount * omega) / sin) * b.x,
      y: (Math.sin((1 - amount) * omega) / sin) * a.y + (Math.sin(amount * omega) / sin) * b.y,
      z: (Math.sin((1 - amount) * omega) / sin) * a.z + (Math.sin(amount * omega) / sin) * b.z
    };
  }

  function drawRoute(route) {
    const start = normalise(toPoint(cities[route[0]].lat, cities[route[0]].lng, 1));
    const end = normalise(toPoint(cities[route[1]].lat, cities[route[1]].lng, 1));
    let drawing = false;

    ctx.beginPath();
    for (let step = 0; step <= 44; step += 1) {
      const arc = slerp(start, end, step / 44);
      const x = cx + arc.x * radius * 1.03;
      const y = cy - arc.y * radius * 1.03;
      const visible = arc.z * radius > -radius * 0.04;
      if (!visible) {
        drawing = false;
      } else if (!drawing) {
        ctx.moveTo(x, y);
        drawing = true;
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.strokeStyle = "rgba(67, 200, 176, 0.18)";
    ctx.lineWidth = 0.9;
    ctx.stroke();
  }

  function draw() {
    ctx.clearRect(0, 0, width, height);

    for (let i = 0; i < 58; i += 1) {
      const sx = (Math.sin(i * 137.5) * 0.5 + 0.5) * width;
      const sy = (Math.cos(i * 97.3) * 0.5 + 0.5) * height;
      if (Math.hypot(sx - cx, sy - cy) > radius + 8) {
        const opacity = 0.08 + 0.32 * (Math.sin(tick * 0.4 + i) * 0.5 + 0.5);
        ctx.beginPath();
        ctx.arc(sx, sy, 0.7, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(200, 220, 255, ${opacity})`;
        ctx.fill();
      }
    }

    const atmosphere = ctx.createRadialGradient(cx, cy, radius - 4, cx, cy, radius + 20);
    atmosphere.addColorStop(0, "rgba(67, 200, 176, 0.16)");
    atmosphere.addColorStop(0.55, "rgba(209, 165, 58, 0.07)");
    atmosphere.addColorStop(1, "rgba(67, 200, 176, 0)");
    ctx.beginPath();
    ctx.arc(cx, cy, radius + 20, 0, Math.PI * 2);
    ctx.fillStyle = atmosphere;
    ctx.fill();

    const ocean = ctx.createRadialGradient(cx - 24, cy - 26, 8, cx, cy, radius);
    ocean.addColorStop(0, "#244777");
    ocean.addColorStop(0.55, "#142951");
    ocean.addColorStop(1, "#07101f");
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = ocean;
    ctx.fill();

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.clip();

    for (let lat = -60; lat <= 60; lat += 30) {
      const phi = (90 - lat) * Math.PI / 180;
      const rx = radius * Math.sin(phi);
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, rx * 0.15, 0, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(237, 243, 250, 0.09)";
      ctx.lineWidth = 0.5;
      ctx.stroke();
    }

    for (let line = 0; line < 12; line += 1) {
      const lng = rotation + line * Math.PI / 6;
      ctx.beginPath();
      let first = true;
      for (let step = 0; step <= 36; step += 1) {
        const lat = (step / 36) * Math.PI - Math.PI / 2;
        const x = cx + radius * Math.cos(lat) * Math.cos(lng);
        const y = cy - radius * Math.sin(lat);
        const visible = Math.cos(lat) * Math.cos(lng);
        ctx.globalAlpha = visible > 0 ? 0.12 : 0.03;
        if (first) {
          ctx.moveTo(x, y);
          first = false;
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.strokeStyle = "#edf3fa";
      ctx.lineWidth = 0.5;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    routes.forEach(drawRoute);

    travelers.forEach(traveler => {
      const route = routes[traveler.route];
      const start = normalise(toPoint(cities[route[0]].lat, cities[route[0]].lng, 1));
      const end = normalise(toPoint(cities[route[1]].lat, cities[route[1]].lng, 1));
      const arc = slerp(start, end, traveler.progress);
      const x = cx + arc.x * radius * 1.03;
      const y = cy - arc.y * radius * 1.03;

      if (arc.z * radius > -radius * 0.04) {
        const trail = slerp(start, end, Math.max(0, traveler.progress - 0.08));
        const tx = cx + trail.x * radius * 1.03;
        const ty = cy - trail.y * radius * 1.03;
        const gradient = ctx.createLinearGradient(tx, ty, x, y);
        gradient.addColorStop(0, "rgba(67, 200, 176, 0)");
        gradient.addColorStop(1, "rgba(67, 200, 176, 0.75)");
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(x, y);
        ctx.strokeStyle = gradient;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x, y, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = "#43c8b0";
        ctx.fill();
      }

      traveler.progress += traveler.speed;
      if (traveler.progress > 1) traveler.progress = 0;
    });

    cities.forEach((city, index) => {
      const point = toPoint(city.lat, city.lng);
      if (point.z < -radius * 0.04) return;

      const pulse = Math.sin(tick * 2 + index * 1.4) * 0.5 + 0.5;
      const x = cx + point.x;
      const y = cy - point.y;
      ctx.beginPath();
      ctx.arc(x, y, 4 + pulse * 3.5, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(67, 200, 176, ${0.12 + pulse * 0.14})`;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y, 2.4, 0, Math.PI * 2);
      ctx.fillStyle = "#43c8b0";
      ctx.fill();
    });

    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(237, 243, 250, 0.2)";
    ctx.lineWidth = 1;
    ctx.stroke();

    rotation += 0.006;
    tick += 0.028;
    requestAnimationFrame(draw);
  }

  draw();
}

function formatDashboardTime(value) {
  if (!value || value === "pending") return "Pending";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return escapeHtml(value);

  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    dateStyle: "medium",
    timeStyle: "medium"
  }).format(date);
}

function formatRelativeAge(value) {
  if (!value || value === "pending") return "Pending";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const diffMs = Date.now() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

function workflowStatusClass(status = "") {
  const value = String(status || "pending").toLowerCase();
  if (["success", "complete", "completed"].includes(value)) return "success";
  if (["failed", "failure", "error"].includes(value)) return "failed";
  if (["running", "started", "starting", "queued", "triggered"].includes(value)) return "running";
  if (["not_configured", "disabled", "missing_config"].includes(value)) return "not-configured";
  return "pending";
}

function workflowStatusLabel(status = "") {
  const value = String(status || "pending").replaceAll("_", " ");
  return value ? value.toUpperCase() : "PENDING";
}

function normaliseDirection(direction = "") {
  return String(direction || "PENDING").replaceAll("_", " ");
}

function directionClass(direction = "") {
  const d = String(direction).toLowerCase();
  if (d.includes("pending")) return "pending";
  if (d.includes("buy")) return "buy";
  if (d.includes("sell")) return "sell";
  if (d.includes("no trade")) return "no-trade";
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
  try {
    return JSON.parse(value);
  } catch (e) {
    return fallback;
  }
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
  return agent?.calls?.[timeframe] || {
    direction: "PENDING",
    conviction: null,
    reason: "Awaiting data"
  };
}

function getAgent(name) {
  return (layer1Data?.agents || []).find(agent => agent.agent === name);
}

function getDashboardUpdatedAt() {
  return layer1Data?.dashboard_meta?.last_updated_et || null;
}

function getAgentUpdatedAt(agent) {
  return agent?.last_run_et || agent?.created_at || null;
}

function bestLiveAgent() {
  const live = (layer1Data?.agents || []).filter(agent => {
    const call24 = getCall(agent, "24h");
    return call24.conviction !== null && call24.direction !== "PENDING";
  });

  return live.sort((a, b) => {
    return Number(getCall(b, "24h").conviction || 0) - Number(getCall(a, "24h").conviction || 0);
  })[0] || null;
}

function renderOverviewStats() {
  const container = document.getElementById("overviewStats");
  if (!container) return;

  const strongest = bestLiveAgent();
  const liveCount = (layer1Data?.agents || []).filter(agent => agent.status === "live").length;
  const heroLiveAgents = document.getElementById("heroLiveAgents");
  const heroStrongestSignal = document.getElementById("heroStrongestSignal");
  const heroLastRun = document.getElementById("heroLastRun");

  const dashboardUpdated = getDashboardUpdatedAt();
  const formattedDashboardUpdated = formatDashboardTime(dashboardUpdated);
  const dashboardAge = formatRelativeAge(dashboardUpdated);

  if (heroLiveAgents) heroLiveAgents.textContent = `${liveCount} / ${orderedAgents.length}`;
  if (heroStrongestSignal) {
    heroStrongestSignal.textContent = strongest
      ? `${strongest.agent} ${formatConviction(getCall(strongest, "24h").conviction)}`
      : "Pending";
  }
  if (heroLastRun) heroLastRun.textContent = dashboardAge || (dashboardUpdated ? "Live" : "Pending");

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
      <p class="eyebrow">Last n8n Ingest</p>
      <h3>${dashboardUpdated ? "Live" : "Pending"}</h3>
      <span>${escapeHtml(formattedDashboardUpdated)}${dashboardAge ? ` · ${escapeHtml(dashboardAge)}` : ""}</span>
    </article>
  `;
}

function renderAgentCard(agent) {
  const call24 = getCall(agent, "24h");
  const assetUpdated = getAgentUpdatedAt(agent);
  const formattedAssetUpdated = formatDashboardTime(assetUpdated);
  const assetAge = formatRelativeAge(assetUpdated);

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

      <p class="asset-update">
        <strong>Last asset update:</strong>
        ${escapeHtml(formattedAssetUpdated)}${assetAge ? ` · ${escapeHtml(assetAge)}` : ""}
      </p>

      <div class="call-list">${calls}</div>
      <button class="inspect-button" data-agent="${escapeHtml(agent.agent)}">Inspect ${escapeHtml(agent.agent)} Engine</button>
    </article>
  `;
}

function renderLayer1(data) {
  const layer1Updated = document.getElementById("layer1Updated");
  if (layer1Updated) {
    layer1Updated.textContent = `Last n8n ingest: ${formatDashboardTime(data.dashboard_meta?.last_updated_et)}`;
  }

  renderOverviewStats();

  const grid = document.getElementById("layer1Grid");
  if (!grid) return;

  grid.innerHTML = (data.agents || []).map(renderAgentCard).join("");

  grid.querySelectorAll("[data-agent]").forEach(el => {
    el.addEventListener("click", () => setTab(el.dataset.agent));
  });
}

function cleanDecisionReason(reason = "") {
  return String(reason || "")
    .replace(/\b\d{1,2}h\s+/ig, "")
    .replace(/\b(3d|current_week|next_week|current_month)\s+/ig, "")
    .replace(/deterministic\s+(?:score|model|verdict):?\s*/ig, "")
    .replace(/(?:bullish|bull)\s+(?:argument|case)\s+\d+(?:\.\d+)?(?:%| weight)?[,]?\s*/ig, "")
    .replace(/(?:bearish|bear)\s+(?:argument|case)\s+\d+(?:\.\d+)?(?:%| weight)?[,]?\s*/ig, "")
    .replace(/neutral(?:\/inactive| evidence)?\s+\d+(?:\.\d+)?(?:%| weight)?[,]?\s*/ig, "")
    .replace(/directional participation\s+\d+(?:\.\d+)?%?[,]?\s*/ig, "")
    .replace(/net edge\s+[+-]?\d+(?:\.\d+)?(?:%| bullish| bearish)?[,]?\.?/ig, "")
    .replace(/winning side\s+(?:bullish|bearish|tied)[,]?\s*/ig, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.])/g, "$1")
    .trim();
}

function firstSentence(value = "") {
  const text = String(value || "").trim();
  if (!text) return "";

  const match = text.match(/^(.+?[.!?])(?:\s|$)/);
  return (match ? match[1] : text).trim();
}

function factorEntriesFrom(value) {
  const factorObj = asObject(value, {});
  return Object.entries(factorObj)
    .map(([name, raw]) => {
      const detail = typeof raw === "object" && raw !== null ? raw : { signal: String(raw) };
      const signal = detail.signal || "NEUTRAL";
      return {
        name,
        signal,
        evidence: detail.evidence || "",
        reason: detail.reason || "",
        weight: Number.isFinite(Number(detail.weight)) ? Number(detail.weight) : null
      };
    })
    .sort((a, b) => Number(b.weight || 0) - Number(a.weight || 0));
}

function getTodayFactors(agent) {
  const today = getCall(agent, "24h");
  return factorEntriesFrom(today.factor_breakdown || agent.factor_breakdown || {});
}

function splitTodayDrivers(agent) {
  const factors = getTodayFactors(agent);

  return {
    bullish: factors.filter(f => signalClass(f.signal) === "bullish"),
    bearish: factors.filter(f => signalClass(f.signal) === "bearish"),
    neutral: factors.filter(f => !["bullish", "bearish"].includes(signalClass(f.signal)))
  };
}

function renderDriverList(drivers, emptyText) {
  if (!drivers.length) {
    return `<div class="empty-state">${escapeHtml(emptyText)}</div>`;
  }

  return drivers.map(driver => `
    <div class="driver-row">
      <div>
        <strong>${escapeHtml(driver.name)}</strong>
        ${driver.evidence ? `<p>${escapeHtml(driver.evidence)}</p>` : ""}
        ${driver.reason ? `<small>${escapeHtml(driver.reason)}</small>` : ""}
      </div>
      <span class="signal-pill ${signalClass(driver.signal)}">${escapeHtml(driver.signal)}</span>
    </div>
  `).join("");
}

function renderNeutralDrivers(drivers) {
  if (!drivers.length) return "";

  return `
    <details class="neutral-drivers">
      <summary>${drivers.length} neutral or inactive drivers</summary>
      <div class="driver-list muted-list">
        ${renderDriverList(drivers, "No neutral drivers.")}
      </div>
    </details>
  `;
}

function decisionFallbackSentence(agent) {
  const today = getCall(agent, "24h");
  const drivers = splitTodayDrivers(agent);
  const direction = normaliseDirection(today.direction).toLowerCase();
  const leading = today.direction && !String(today.direction).toLowerCase().includes("no clear")
    ? `${escapeHtml(agent.agent)} is ${escapeHtml(direction)} today`
    : `${escapeHtml(agent.agent)} has no clear 24H bias today`;

  const bullishNames = drivers.bullish.slice(0, 2).map(driver => driver.name).join(", ");
  const bearishNames = drivers.bearish.slice(0, 2).map(driver => driver.name).join(", ");

  if (bullishNames && bearishNames) {
    return `${leading} because ${escapeHtml(bullishNames)} outweighs or offsets ${escapeHtml(bearishNames)}.`;
  }
  if (bullishNames) return `${leading} because ${escapeHtml(bullishNames)} is supporting the 24H call.`;
  if (bearishNames) return `${leading} because ${escapeHtml(bearishNames)} is pressuring the 24H call.`;
  return `${leading}; no active 24H driver explanation was supplied.`;
}

function todayExplanation(agent) {
  const today = getCall(agent, "24h");
  const cleaned = firstSentence(cleanDecisionReason(today.reason));

  if (cleaned && cleaned.length > 32) return cleaned;
  return decisionFallbackSentence(agent);
}

function participationValue(call) {
  const model = call.conviction_model || {};
  return Number(
    model.directional_participation_pct ??
    model.active_participation_pct ??
    model.participation ??
    NaN
  );
}

function describeEventRisk(event) {
  if (!event) return "No explicit event risk supplied by Layer 1.";
  if (typeof event === "string") return firstSentence(event).slice(0, 220);

  const eventName = event.event || event.name || event.event_name || "event";
  const currency = event.currency ? `${event.currency} ` : "";
  const surprise = event.surprise ? `surprise: ${event.surprise}` : "";
  const signal = event.usd_signal || event.eur_signal || event.signal || "";
  const parts = [`${currency}${eventName}`, surprise, signal].filter(Boolean);

  return parts.length ? `Event context present: ${parts.join(" | ")}` : "Event context present.";
}

function renderTodayCall(agent) {
  const today = getCall(agent, "24h");
  const model = today.conviction_model || {};
  const assetUpdated = getAgentUpdatedAt(agent);
  const strength = model.verdict_strength || "Not supplied";

  return `
    <section class="today-call-panel">
      <div class="today-copy">
        <p class="eyebrow">Today's Trading Bias</p>
        <h2>${escapeHtml(agent.agent)}</h2>
        <div class="today-meta">
          <span><strong>Timeframe:</strong> 24H only</span>
          <span><strong>Strength:</strong> ${escapeHtml(strength)}</span>
          <span><strong>Last updated:</strong> ${escapeHtml(formatDashboardTime(assetUpdated))}${formatRelativeAge(assetUpdated) ? ` | ${escapeHtml(formatRelativeAge(assetUpdated))}` : ""}</span>
        </div>
      </div>

      <div class="today-signal-card">
        <span>24H only</span>
        <strong class="direction ${directionClass(today.direction)}">${normaliseDirection(today.direction)}</strong>
        <b>${formatConviction(today.conviction)}</b>
        <small>Current trading-session bias</small>
      </div>
    </section>
  `;
}

function renderExecutiveSummary(agent) {
  return `
    <article class="detail-panel wide-panel executive-summary-panel">
      <div class="panel-head">
        <p class="eyebrow">Executive Summary</p>
        <h3>Today, Is This Asset More Likely Bullish Or Bearish?</h3>
      </div>
      <p class="today-answer compact-answer">${escapeHtml(todayExplanation(agent))}</p>
    </article>
  `;
}

function renderTodayDrivers(agent) {
  const drivers = splitTodayDrivers(agent);

  return `
    <article class="detail-panel wide-panel today-drivers-panel">
      <div class="panel-head">
        <p class="eyebrow">Why Today's Call Was Made</p>
        <h3>Active 24H Drivers</h3>
      </div>

      <div class="driver-columns">
        <section>
          <h4>Bullish Drivers</h4>
          <div class="driver-list">${renderDriverList(drivers.bullish, "No bullish drivers affected today's call.")}</div>
        </section>
        <section>
          <h4>Bearish Drivers</h4>
          <div class="driver-list">${renderDriverList(drivers.bearish, "No bearish drivers affected today's call.")}</div>
        </section>
      </div>

      ${renderNeutralDrivers(drivers.neutral)}
    </article>
  `;
}

function renderInvalidationPanel(agent) {
  const today = getCall(agent, "24h");
  const output = asObject(agent.full_output || agent.raw_agent_output, {});
  const marketInputs = asObject(agent.market_inputs || output.market_inputs_seen_by_workflow, {});
  const warnings = [
    ...asArray(agent.warnings),
    ...asArray(today.warnings),
    ...asArray(output.risk_flags),
    ...asArray(output.missing_inputs).map(input => `Missing input: ${input}`)
  ].filter(Boolean);

  const participation = participationValue(today);
  if (Number.isFinite(participation) && participation < 35) {
    warnings.push(`Low 24H participation: only ${participation}% of weighted evidence is directional.`);
  }

  const latestEvent = marketInputs.latest_us_event || marketInputs.latest_ez_event || null;
  const eventText = describeEventRisk(latestEvent);

  return `
    <article class="detail-panel wide-panel invalidation-panel">
      <div class="panel-head">
        <p class="eyebrow">Today's Risks</p>
        <h3>What Could Invalidate Today's Call</h3>
      </div>
      <div class="warning-list">
        ${warnings.length
          ? warnings.map(w => `<div class="warning-card">${escapeHtml(w)}</div>`).join("")
          : `<div class="empty-state">No missing inputs or risk flags reported.</div>`}
        <div class="event-risk-note">${escapeHtml(eventText)}</div>
      </div>
    </article>
  `;
}

function renderSecondaryTimeframes(agent) {
  const timeframeKeys = ["3d", "current_week", "next_week", "current_month"];

  return timeframeKeys.map(tf => {
    const call = getCall(agent, tf);
    return `
      <div class="secondary-timeframe-card">
        <span class="timeframe">${labels[tf] || tf}</span>
        <strong class="direction ${directionClass(call.direction)}">${normaliseDirection(call.direction)}</strong>
        <b>${formatConviction(call.conviction)}</b>
        <p>${escapeHtml(firstSentence(cleanDecisionReason(call.reason)) || "No reason supplied.")}</p>
      </div>
    `;
  }).join("");
}

function renderRawModelDetails(agent) {
  const today = getCall(agent, "24h");
  const model = today.conviction_model || agent.conviction_model || {};
  const output = asObject(agent.full_output || agent.raw_agent_output, {});
  const bullish = agent.score_bullish ?? output.score_bullish ?? "--";
  const bearish = agent.score_bearish ?? output.score_bearish ?? "--";
  const neutral = agent.score_neutral ?? output.score_neutral ?? "--";

  return `
    <article class="detail-panel wide-panel raw-model-panel">
      <div class="panel-head">
        <p class="eyebrow">Raw Model Details</p>
        <h3>Source Values</h3>
      </div>
      <details class="raw-model-details">
        <summary>Show raw details</summary>
        <div class="raw-detail-grid">
          <p><strong>Bullish factors:</strong> ${escapeHtml(bullish)}</p>
          <p><strong>Bearish factors:</strong> ${escapeHtml(bearish)}</p>
          <p><strong>Neutral factors:</strong> ${escapeHtml(neutral)}</p>
          <p><strong>Winning side:</strong> ${escapeHtml(model.winning_side || "--")}</p>
          <p><strong>Directional participation:</strong> ${formatModelPercent(model.directional_participation_pct)}</p>
          <p><strong>Net edge:</strong> ${model.net_edge_pct ?? "--"}%</p>
        </div>
      </details>
    </article>
  `;
}

function renderCallMatrix(agent) {
  return renderSecondaryTimeframes(agent);
}

function renderFactorRows(agent) {
  const entries = getTodayFactors(agent);

  if (!entries.length && Array.isArray(agent.key_factors)) {
    return agent.key_factors.map(f => `
      <div class="factor-row">
        <div><strong>${escapeHtml(f)}</strong></div>
        <span class="signal-pill neutral">INFO</span>
      </div>
    `).join("");
  }

  return renderDriverList(entries, "No factor breakdown available yet.");
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
      <p><strong>Neutral factors:</strong> ${formatModelPercent(neutralPct)}</p>
      <p><strong>Verdict Strength:</strong> ${verdictStrength || "--"}</p>
      <p><strong>Final Logic:</strong> ${escapeHtml(model.final_conviction_logic ?? "No conviction model supplied yet.")}</p>
    </div>
  `;
}

function renderAgentDetailLegacy(agentName) {
  const view = document.getElementById("agentView");
  const agent = getAgent(agentName);

  if (!view) return;

  if (!agent) {
    view.innerHTML = `
      <section class="detail-shell">
        <div class="empty-state">No ${escapeHtml(agentName)} agent output available yet.</div>
      </section>
    `;
    return;
  }

  const call24 = getCall(agent, "24h");
  const dashboardUpdated = getDashboardUpdatedAt();
  const assetUpdated = getAgentUpdatedAt(agent);

  const warnings = asArray(agent.warnings)
    .map(w => `<div class="warning-card">⚠ ${escapeHtml(w)}</div>`)
    .join("") || `<div class="empty-state">No warnings reported.</div>`;

  view.innerHTML = `
    <section class="agent-detail-hero">
      <div>
        <p class="eyebrow">Layer 1 Independent Agent</p>
        <h2>${escapeHtml(agent.agent)} Direction Engine</h2>
        <p class="subcopy">${escapeHtml(agent.summary || "Raw directional agent output.")}</p>

        <div class="update-strip">
          <span><strong>Last asset update:</strong> ${escapeHtml(formatDashboardTime(assetUpdated))}${formatRelativeAge(assetUpdated) ? ` · ${escapeHtml(formatRelativeAge(assetUpdated))}` : ""}</span>
          <span><strong>Last n8n ingest:</strong> ${escapeHtml(formatDashboardTime(dashboardUpdated))}${formatRelativeAge(dashboardUpdated) ? ` · ${escapeHtml(formatRelativeAge(dashboardUpdated))}` : ""}</span>
        </div>
      </div>

      <div class="signal-tower">
        <span>24H Call</span>
        <strong class="direction ${directionClass(call24.direction)}">${normaliseDirection(call24.direction)}</strong>
        <b>${formatConviction(call24.conviction)}</b>
        <small>Last asset update: ${escapeHtml(formatDashboardTime(assetUpdated))}</small>
      </div>
    </section>

    <section class="detail-grid">
      <article class="detail-panel wide-panel">
        <div class="panel-head">
          <p class="eyebrow">Other Timeframes</p>
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
          <h3>Raw Model Details</h3>
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

function renderAgentDetail(agentName) {
  const view = document.getElementById("agentView");
  const agent = getAgent(agentName);

  if (!view) return;

  if (!agent) {
    view.innerHTML = `
      <section class="detail-shell">
        <div class="empty-state">No ${escapeHtml(agentName)} agent output available yet.</div>
      </section>
    `;
    return;
  }

  const dashboardUpdated = getDashboardUpdatedAt();
  const assetUpdated = getAgentUpdatedAt(agent);

  view.innerHTML = `
    ${renderTodayCall(agent)}

    <section class="detail-grid">
      ${renderExecutiveSummary(agent)}

      ${renderTodayDrivers(agent)}

      ${renderInvalidationPanel(agent)}

      <article class="detail-panel wide-panel">
        <div class="panel-head">
          <p class="eyebrow">Other Timeframes</p>
          <h3>Secondary Directional Context</h3>
        </div>
        <div class="secondary-timeframes">${renderCallMatrix(agent)}</div>
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
          <p><strong>Last n8n ingest:</strong> ${escapeHtml(formatDashboardTime(dashboardUpdated))}${formatRelativeAge(dashboardUpdated) ? ` | ${escapeHtml(formatRelativeAge(dashboardUpdated))}` : ""}</p>
          <p><strong>Last asset update:</strong> ${escapeHtml(formatDashboardTime(assetUpdated))}${formatRelativeAge(assetUpdated) ? ` | ${escapeHtml(formatRelativeAge(assetUpdated))}` : ""}</p>
        </div>
      </article>

      ${renderRawModelDetails(agent)}
    </section>
  `;
}

function confidenceLabel(value) {
  if (value >= 80) return "High confidence";
  if (value >= 65) return "Moderate confidence";
  return "Low confidence";
}

function rankLabel(rank) {
  if (rank === 1) return "#1 Best Trade Today";
  if (rank === 2) return "#2 Second Best";
  if (rank === 3) return "#3 Third Best";
  return rank ? `#${rank} Trade Setup` : "";
}

function renderTradeOpportunityCard(opportunity, label = "") {
  const direction = opportunity.direction || "NO TRADE";
  const confidence = opportunity.confidence ?? null;

  return `
    <article class="trade-opportunity-card ${directionClass(direction)}">
      <div class="trade-card-head">
        <div>
          ${label ? `<p class="eyebrow">${escapeHtml(label)}</p>` : ""}
          <h3>${escapeHtml(opportunity.instrument)}</h3>
        </div>
        <strong class="trade-direction ${directionClass(direction)}">${escapeHtml(direction)}</strong>
      </div>
      <div class="trade-confidence">
        <span>Confidence</span>
        <b>${formatConviction(confidence)}</b>
        <small>${confidence === null ? "Awaiting selection" : escapeHtml(confidenceLabel(Number(confidence)))}</small>
      </div>
      <p class="trade-reason">${escapeHtml(opportunity.reason || "No reason supplied.")}</p>
    </article>
  `;
}

function renderAvoidCard(item) {
  return `
    <article class="trade-opportunity-card no-trade">
      <div class="trade-card-head">
        <div>
          <h3>${escapeHtml(item.instrument || "Instrument")}</h3>
        </div>
        <strong class="trade-direction no-trade">NO TRADE</strong>
      </div>
      <p class="trade-reason">${escapeHtml(item.reason || "No clear Layer 2 trade selection.")}</p>
    </article>
  `;
}

function renderLayer2(data = {}) {
  const layer2Updated = document.getElementById("layer2Updated");
  if (layer2Updated) {
    layer2Updated.textContent = `Last updated: ${formatDashboardTime(data.dashboard_meta?.last_updated_et)}`;
  }

  const panel = document.getElementById("layer2Panel");
  if (!panel) return;

  const opportunities = Array.isArray(data.trade_opportunities) ? data.trade_opportunities : [];
  const avoided = Array.isArray(data.avoid_today) ? data.avoid_today : [];

  panel.innerHTML = `
    <div class="layer2-summary trade-layer-summary">
      <div>
        <p class="eyebrow">Today's Trade Opportunities</p>
        <h3>Layer 2 Trade Selection</h3>
      </div>
      <p class="summary">Layer 2 displays trade selections produced by the Layer 2 agent. The browser only renders the supplied output.</p>
    </div>
    <div class="trade-grid">
      ${opportunities.length
        ? opportunities
            .slice()
            .sort((a, b) => Number(a.rank || 999) - Number(b.rank || 999))
            .map(opportunity => renderTradeOpportunityCard(opportunity, rankLabel(Number(opportunity.rank)))).join("")
        : `<div class="empty-state">Awaiting Layer 2 Trade Selection Agent.</div>`}
    </div>
    <section class="avoid-section">
      <div class="panel-head">
        <p class="eyebrow">Avoid Today</p>
        <h3>No Trade Setups</h3>
      </div>
      <div class="avoid-grid">
        ${avoided.length
          ? avoided.map(renderAvoidCard).join("")
          : `<div class="empty-state">No instruments are currently flagged for avoidance.</div>`}
      </div>
    </section>
  `;
}

function resultClass(result = "") {
  const r = String(result).toLowerCase();
  if (r.includes("win")) return "success";
  if (r.includes("loss")) return "failed";
  if (r.includes("pending")) return "pending";
  if (r.includes("no call")) return "neutral";
  return "neutral";
}

function percentValue(value) {
  return value === null || value === undefined || value === "" ? "--" : `${Number(value)}%`;
}

function renderBacktestEmptyStates() {
  return `
    <div class="backtest-empty-strip">
      <span>Backtest data not connected yet</span>
      <span>Waiting for historical snapshots</span>
      <span>Database engine to be added in next phase</span>
    </div>
  `;
}

function renderBacktestMetric(label, value, detail = "") {
  return `
    <article class="backtest-metric-card">
      <p class="eyebrow">${escapeHtml(label)}</p>
      <h3>${escapeHtml(value)}</h3>
      ${detail ? `<span>${escapeHtml(detail)}</span>` : ""}
    </article>
  `;
}

function renderAccuracyBars(items = [], labelKey) {
  if (!items.length) return `<div class="empty-state">Backtest data not connected yet.</div>`;

  return items.map(item => {
    const label = item[labelKey] || item.asset || item.timeframe || "Item";
    const value = Number(item.accuracy || 0);
    return `
      <div class="accuracy-bar-row">
        <div>
          <strong>${escapeHtml(label)}</strong>
          <small>${escapeHtml(item.sample_size || 0)} mock samples</small>
        </div>
        <div class="accuracy-bar-track" aria-hidden="true">
          <span style="width: ${Math.max(0, Math.min(value, 100))}%"></span>
        </div>
        <b>${percentValue(value)}</b>
      </div>
    `;
  }).join("");
}

function renderRecentCallsTable(calls = []) {
  if (!calls.length) return `<div class="empty-state">Waiting for historical snapshots.</div>`;

  return `
    <div class="table-scroll">
      <table class="dashboard-table">
        <thead>
          <tr>
            <th>Date/time call made</th>
            <th>Asset</th>
            <th>Timeframe</th>
            <th>Agent call</th>
            <th>Entry/reference price</th>
            <th>Exit/settlement price</th>
            <th>Actual direction</th>
            <th>Result</th>
            <th>Conviction</th>
            <th>Strength</th>
          </tr>
        </thead>
        <tbody>
          ${calls.map(call => `
            <tr>
              <td>${escapeHtml(call.called_at)}</td>
              <td>${escapeHtml(call.asset)}</td>
              <td>${escapeHtml(call.timeframe)}</td>
              <td><span class="direction ${directionClass(call.agent_call)}">${escapeHtml(call.agent_call)}</span></td>
              <td>${escapeHtml(call.entry_price)}</td>
              <td>${escapeHtml(call.exit_price)}</td>
              <td>${escapeHtml(call.actual_direction)}</td>
              <td><span class="result-pill ${resultClass(call.result)}">${escapeHtml(call.result)}</span></td>
              <td>${percentValue(call.conviction)}</td>
              <td>${escapeHtml(call.strength)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderNextBuildPhase(phases = []) {
  return `
    <article class="detail-panel next-phase-card">
      <div class="panel-head">
        <p class="eyebrow">Next Build Phase</p>
        <h3>Backtest Engine Roadmap</h3>
      </div>
      <ol class="phase-list">
        ${phases.map(phase => `<li>${escapeHtml(phase)}</li>`).join("")}
      </ol>
    </article>
  `;
}

function renderAccuracyBacktest(data = {}) {
  const accuracy = data.accuracy || {};

  return `
    ${renderBacktestEmptyStates()}

    <section class="backtest-metric-grid">
      ${renderBacktestMetric("Overall Accuracy", percentValue(accuracy.overall_accuracy), "All assets and tracked timeframes")}
      ${renderBacktestMetric("Bullish Call Accuracy", percentValue(accuracy.bullish_accuracy), "Mock directional outcomes")}
      ${renderBacktestMetric("Bearish Call Accuracy", percentValue(accuracy.bearish_accuracy), "Mock directional outcomes")}
      ${renderBacktestMetric("No-call Count", String(accuracy.no_call_count ?? "--"), "Filtered or avoided calls")}
      ${renderBacktestMetric("Current Streak", accuracy.current_streak || "--", "Completed calls only")}
      ${renderBacktestMetric("Best Asset", accuracy.best_asset || "--", "Highest mock hit rate")}
      ${renderBacktestMetric("Weakest Asset", accuracy.weakest_asset || "--", "Lowest mock hit rate")}
    </section>

    <section class="backtest-grid two-column">
      <article class="detail-panel">
        <div class="panel-head">
          <p class="eyebrow">Accuracy By Asset</p>
          <h3>Asset Direction Calls</h3>
        </div>
        ${renderAccuracyBars(accuracy.asset_accuracy, "asset")}
      </article>

      <article class="detail-panel">
        <div class="panel-head">
          <p class="eyebrow">Accuracy By Timeframe</p>
          <h3>Time Horizon Hit Rate</h3>
        </div>
        ${renderAccuracyBars(accuracy.timeframe_accuracy, "timeframe")}
      </article>
    </section>

    <article class="detail-panel wide-panel">
      <div class="panel-head">
        <p class="eyebrow">Recent Completed Calls</p>
        <h3>Mock Direction Accuracy Ledger</h3>
      </div>
      ${renderRecentCallsTable(accuracy.recent_completed_calls)}
    </article>

    ${renderNextBuildPhase(data.next_build_phase || [])}
  `;
}

function renderMiniLeaderboard(items = [], valueKey, suffix = "%") {
  if (!items.length) return `<div class="empty-state">Database engine to be added in next phase.</div>`;

  return items.map((item, index) => {
    const value = item[valueKey] ?? item.correlation ?? item.hit_rate ?? item.confidence ?? "--";
    return `
      <div class="leaderboard-row">
        <span>${index + 1}</span>
        <div>
          <strong>${escapeHtml(item.factor)}</strong>
          <small>${escapeHtml(item.asset || item.timeframe || "")}</small>
        </div>
        <b>${escapeHtml(value)}${value === "--" ? "" : suffix}</b>
      </div>
    `;
  }).join("");
}

function renderCorrelationByTimeframe(items = []) {
  if (!items.length) return `<div class="empty-state">Waiting for historical snapshots.</div>`;

  return items.map(item => `
    <div class="correlation-chip">
      <span>${escapeHtml(item.timeframe)}</span>
      <strong>${percentValue(item.correlation)}</strong>
    </div>
  `).join("");
}

function renderFactorHitRateTable(rows = []) {
  if (!rows.length) return `<div class="empty-state">Backtest data not connected yet.</div>`;

  return `
    <div class="table-scroll">
      <table class="dashboard-table">
        <thead>
          <tr>
            <th>Asset</th>
            <th>Variable / factor</th>
            <th>Signal direction</th>
            <th>Timeframe</th>
            <th>Sample size</th>
            <th>Bullish outcome %</th>
            <th>Bearish outcome %</th>
            <th>Neutral / mixed %</th>
            <th>Confidence score</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(row => `
            <tr>
              <td>${escapeHtml(row.asset)}</td>
              <td>${escapeHtml(row.factor)}</td>
              <td>${escapeHtml(row.signal_direction)}</td>
              <td>${escapeHtml(row.timeframe)}</td>
              <td>${escapeHtml(row.sample_size)}</td>
              <td>${percentValue(row.bullish_outcome_pct)}</td>
              <td>${percentValue(row.bearish_outcome_pct)}</td>
              <td>${percentValue(row.neutral_mixed_pct)}</td>
              <td>${percentValue(row.confidence_score)}</td>
              <td>${escapeHtml(row.notes)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderCorrelationBacktest(data = {}) {
  const correlation = data.correlation || {};

  return `
    ${renderBacktestEmptyStates()}

    <article class="detail-panel wide-panel explanation-card">
      <p class="eyebrow">Example Question</p>
      <h3>${escapeHtml(correlation.example_question || "If CPI surprise is bullish USD, how often did USD/DXY rise over each timeframe?")}</h3>
      <p>Placeholder only. Historical snapshots, settlement prices, and factor outcomes will be connected in a later phase.</p>
    </article>

    <section class="backtest-grid three-column">
      <article class="detail-panel">
        <div class="panel-head">
          <p class="eyebrow">Variable Leaderboard</p>
          <h3>Top Mock Factors</h3>
        </div>
        ${renderMiniLeaderboard(correlation.leaderboard, "correlation")}
      </article>

      <article class="detail-panel">
        <div class="panel-head">
          <p class="eyebrow">Best Bullish Predictors</p>
          <h3>Positive Outcomes</h3>
        </div>
        ${renderMiniLeaderboard(correlation.best_bullish_predictors, "hit_rate")}
      </article>

      <article class="detail-panel">
        <div class="panel-head">
          <p class="eyebrow">Best Bearish Predictors</p>
          <h3>Negative Outcomes</h3>
        </div>
        ${renderMiniLeaderboard(correlation.best_bearish_predictors, "hit_rate")}
      </article>
    </section>

    <section class="backtest-grid two-column">
      <article class="detail-panel">
        <div class="panel-head">
          <p class="eyebrow">Weak / Unreliable Variables</p>
          <h3>Low Confidence Factors</h3>
        </div>
        ${renderMiniLeaderboard(correlation.weak_variables, "confidence")}
      </article>

      <article class="detail-panel">
        <div class="panel-head">
          <p class="eyebrow">Correlation By Timeframe</p>
          <h3>Historical Window Fit</h3>
        </div>
        <div class="correlation-chip-grid">${renderCorrelationByTimeframe(correlation.timeframe_correlation)}</div>
      </article>
    </section>

    <article class="detail-panel wide-panel">
      <div class="panel-head">
        <p class="eyebrow">Factor Hit-rate Table</p>
        <h3>Mock Variable Outcome Matrix</h3>
      </div>
      ${renderFactorHitRateTable(correlation.factor_hit_rates)}
    </article>

    ${renderNextBuildPhase(data.next_build_phase || [])}
  `;
}

function renderBacktest(data = {}) {
  const updated = document.getElementById("backtestUpdated");
  if (updated) {
    const marker = data.meta?.placeholder ? "Placeholder mock data" : `Last updated: ${formatDashboardTime(data.meta?.last_updated)}`;
    updated.textContent = marker;
  }

  const panel = document.getElementById("backtestPanel");
  if (!panel) return;

  panel.innerHTML = activeBacktestTab === "correlation"
    ? renderCorrelationBacktest(data)
    : renderAccuracyBacktest(data);
}

function workflowErrorText(error) {
  if (!error) return "";
  if (typeof error === "string") return error;

  const step = error.step || error.workflow || error.node || "";
  const reason = error.reason || error.message || error.error || "";

  return [step, reason].filter(Boolean).join(": ");
}

function renderWorkflowSteps(steps = []) {
  const container = document.getElementById("workflowStepReport");
  if (!container) return;

  if (!Array.isArray(steps) || !steps.length) {
    container.innerHTML = "";
    return;
  }

  container.innerHTML = `
    <div class="workflow-step-grid">
      ${steps.map(step => {
        const status = workflowStatusClass(step.status);
        const error = workflowErrorText(step.error || step.reason || step.message);
        return `
          <div class="workflow-step ${status}">
            <span>${escapeHtml(step.name || step.workflow || "Workflow step")}</span>
            <strong>${escapeHtml(workflowStatusLabel(step.status))}</strong>
            ${error && status === "failed" ? `<small>${escapeHtml(error)}</small>` : ""}
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function renderWorkflowStatus(status = workflowStatus) {
  const summary = document.getElementById("workflowStatusSummary");
  const badge = document.getElementById("workflowStatusBadge");
  const button = document.getElementById("runWorkflowButton");
  const errorReport = document.getElementById("workflowErrorReport");

  const configured = Boolean(workflowControl?.enabled && workflowControl?.webhook_url);
  const currentStatus = status?.status || (configured ? "pending" : "not_configured");
  const statusClass = workflowStatusClass(currentStatus);
  const started = status?.last_run_started_at ? formatDashboardTime(status.last_run_started_at) : null;
  const finished = status?.last_run_finished_at ? formatDashboardTime(status.last_run_finished_at) : null;
  const age = status?.last_run_finished_at ? formatRelativeAge(status.last_run_finished_at) : "";
  const message = status?.message || "";

  if (badge) {
    badge.className = `workflow-status-badge ${statusClass}`;
    badge.textContent = workflowStatusLabel(currentStatus);
  }

  if (button) {
    button.disabled = workflowTriggerInFlight || !configured;
    button.textContent = workflowTriggerInFlight ? "Starting..." : "Run Full Refresh";
    button.title = configured
      ? "Trigger the n8n Master Orchestrator"
      : "Add the n8n webhook URL to data/workflow-control.json";
  }

  if (summary) {
    if (!configured) {
      summary.textContent = "Dashboard trigger is waiting for the Master Orchestrator webhook URL.";
    } else if (statusClass === "running") {
      summary.textContent = `Workflow run is in progress${started ? `, started ${started}` : ""}.`;
    } else if (statusClass === "success") {
      summary.textContent = `Last run completed${finished ? ` ${finished}` : ""}${age ? ` (${age})` : ""}.`;
    } else if (statusClass === "failed") {
      summary.textContent = `Last run failed${finished ? ` ${finished}` : ""}.`;
    } else {
      summary.textContent = message || "Ready to run the Master Orchestrator.";
    }
  }

  const errorText = workflowErrorText(status?.error);
  if (errorReport) {
    if (statusClass === "failed" || errorText) {
      errorReport.hidden = false;
      errorReport.innerHTML = `
        <p class="eyebrow">Error Report</p>
        <h3>${escapeHtml(status?.failed_step || status?.error?.step || "Workflow run failed")}</h3>
        <p>${escapeHtml(errorText || message || "No error reason was supplied by n8n.")}</p>
      `;
    } else {
      errorReport.hidden = true;
      errorReport.innerHTML = "";
    }
  }

  renderWorkflowSteps(status?.steps || []);
}

async function loadWorkflowControl() {
  try {
    const response = await fetch(workflowControlUrl, { cache: "no-store" });
    if (!response.ok) throw new Error(`workflow-control ${response.status}`);
    workflowControl = await response.json();
  } catch (err) {
    console.warn("Could not load workflow control config", err);
    workflowControl = {
      enabled: false,
      webhook_url: "",
      status_url: "./data/workflow-status.json",
      poll_interval_ms: 10000,
      poll_after_trigger_ms: 180000
    };
  }

  renderWorkflowStatus();
}

async function loadWorkflowStatus() {
  const statusUrl = workflowControl?.status_url || "./data/workflow-status.json";

  try {
    const response = await fetch(statusUrl, { cache: "no-store" });
    if (!response.ok) throw new Error(`workflow-status ${response.status}`);
    workflowStatus = await response.json();
  } catch (err) {
    console.warn("Could not load workflow status", err);
    workflowStatus = {
      status: workflowControl?.enabled ? "pending" : "not_configured",
      message: "Workflow status has not been published yet.",
      steps: [],
      error: null
    };
  }

  renderWorkflowStatus(workflowStatus);
}

function startWorkflowStatusPolling(durationMs) {
  if (workflowPollTimer) {
    clearInterval(workflowPollTimer);
    workflowPollTimer = null;
  }

  const intervalMs = Number(workflowControl?.poll_interval_ms || 10000);
  workflowPollTimer = setInterval(loadWorkflowStatus, intervalMs);

  if (durationMs) {
    setTimeout(() => {
      if (workflowPollTimer) {
        clearInterval(workflowPollTimer);
        workflowPollTimer = null;
      }
    }, durationMs);
  }
}

async function triggerWorkflowRun() {
  if (workflowTriggerInFlight) return;

  if (!workflowControl?.enabled || !workflowControl?.webhook_url) {
    renderWorkflowStatus({
      status: "not_configured",
      message: "Add the Master Orchestrator webhook URL before running from the dashboard.",
      steps: [],
      error: null
    });
    return;
  }

  workflowTriggerInFlight = true;
  renderWorkflowStatus({
    status: "starting",
    last_run_started_at: new Date().toISOString(),
    message: "Dashboard requested a Master Orchestrator run.",
    steps: [],
    error: null
  });

  try {
    const method = workflowControl.method || "POST";
    const requestMode = workflowControl.request_mode || "cors";
    const payload = {
      source: "dashboard",
      requested_at: new Date().toISOString()
    };

    await fetch(workflowControl.webhook_url, {
      method,
      mode: requestMode,
      headers: requestMode === "no-cors" ? undefined : { "content-type": "application/json" },
      body: method.toUpperCase() === "GET" ? undefined : JSON.stringify(payload)
    });

    workflowStatus = {
      status: "running",
      last_run_started_at: payload.requested_at,
      message: "Master Orchestrator trigger sent. Waiting for n8n to publish status.",
      steps: [],
      error: null
    };
    renderWorkflowStatus(workflowStatus);
    startWorkflowStatusPolling(Number(workflowControl.poll_after_trigger_ms || 180000));
  } catch (err) {
    workflowStatus = {
      status: "failed",
      last_run_started_at: new Date().toISOString(),
      last_run_finished_at: new Date().toISOString(),
      failed_step: "Dashboard trigger",
      message: "The dashboard could not call the n8n webhook.",
      steps: [],
      error: {
        step: "Dashboard trigger",
        reason: err.message || String(err)
      }
    };
    renderWorkflowStatus(workflowStatus);
  } finally {
    workflowTriggerInFlight = false;
    renderWorkflowStatus(workflowStatus);
  }
}

function setupWorkflowControls() {
  const button = document.getElementById("runWorkflowButton");
  if (button) {
    button.addEventListener("click", triggerWorkflowRun);
  }
}

function setTab(tab) {
  activeTab = tab;

  document.querySelectorAll(".tab-button").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.tab === tab);
  });

  const overviewView = document.getElementById("overviewView");
  const layer2View = document.getElementById("layer2View");
  const backtestView = document.getElementById("backtestView");
  const agentView = document.getElementById("agentView");

  if (overviewView) overviewView.classList.toggle("active-view", tab === "overview");
  if (layer2View) layer2View.classList.toggle("active-view", tab === "layer2");
  if (backtestView) backtestView.classList.toggle("active-view", tab === "backtest");
  if (agentView) agentView.classList.toggle("active-view", orderedAgents.includes(tab));

  if (orderedAgents.includes(tab)) renderAgentDetail(tab);
  if (tab === "backtest") renderBacktest(backtestData || {});
}

function setupTabs() {
  document.querySelectorAll(".tab-button").forEach(btn => {
    btn.addEventListener("click", () => setTab(btn.dataset.tab));
  });

  document.querySelectorAll(".subtab-button").forEach(btn => {
    btn.addEventListener("click", () => {
      activeBacktestTab = btn.dataset.backtestTab || "accuracy";
      document.querySelectorAll(".subtab-button").forEach(item => {
        item.classList.toggle("active", item === btn);
      });
      renderBacktest(backtestData || {});
    });
  });
}

async function loadDashboard() {
  try {
    const [layer1Res, layer2Res, backtestRes] = await Promise.all([
      fetch(layer1Url, { cache: "no-store" }),
      fetch(layer2Url, { cache: "no-store" }),
      fetch(backtestUrl, { cache: "no-store" })
    ]);

    layer1Data = await layer1Res.json();
    layer2Data = await layer2Res.json();
    backtestData = await backtestRes.json();

    renderLayer1(layer1Data);
    renderLayer2(layer2Data);
    renderBacktest(backtestData);

    if (orderedAgents.includes(activeTab)) {
      renderAgentDetail(activeTab);
    }
  } catch (err) {
    console.error(err);

    const grid = document.getElementById("layer1Grid");
    if (grid) {
      grid.innerHTML = `<p class="warning">Could not load dashboard JSON.</p>`;
    }
  }
}

setupTabs();
setupWorkflowControls();
initMarketGlobe();
updateClock();
setInterval(updateClock, 1000);

loadWorkflowControl().then(loadWorkflowStatus);
loadDashboard();
setInterval(loadDashboard, 60000);
setInterval(loadWorkflowStatus, 60000);
