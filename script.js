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

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
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
    confidence: null,
    conviction: null,
    reason: "Awaiting data"
  };
}

function getOutput(agent) {
  return asObject(agent?.full_output || agent?.raw_agent_output, {});
}

function getTimeframeModel(agent, timeframe = "24h") {
  const output = getOutput(agent);
  return asObject(output.timeframe_models?.[timeframe], {});
}

const FALLBACK_ELIGIBLE_SNAPSHOT_INPUTS = new Set([
  "gold_d5_pct",
  "gold_d20_pct",
  "nq_d5_pct",
  "nq_d20_pct",
  "btc_d5_pct",
  "btc_d20_pct",
  "us_10y_d20_bps",
  "us_10y_real_yield_d20_bps"
]);

const ALWAYS_VISIBLE_SNAPSHOT_GAPS = new Set([
  "latest_us_event",
  "latest_ez_event",
  "geopolitical_risk_flag",
  "btc_dominance_d5",
  "btc_dominance_d20",
  "total_crypto_market_cap_d5_pct",
  "total_crypto_market_cap_d20_pct",
  "stablecoin_supply",
  "stablecoin_supply_d5_pct",
  "stablecoin_supply_d20_pct"
]);

const CONTEXTUAL_FACTOR_LABELS = new Set([
  "US Economic Surprise Direction",
  "EZ Economic Surprise Direction",
  "Stablecoin / Crypto Liquidity",
  "BTC Dominance / Crypto Structure"
]);

const FACTOR_ROLE_BY_ASSET = {
  USD: {
    F7: "contextual",
    F9: "contextual",
    F10: "contextual"
  },
  EUR: {
    F7: "contextual",
    F8: "contextual",
    F9: "contextual",
    F10: "contextual"
  },
  GOLD: {
    F7: "contextual",
    F8: "contextual",
    F9: "contextual",
    F10: "contextual"
  },
  NQ: {
    F7: "contextual",
    F9: "contextual",
    F10: "contextual"
  },
  BTC: {
    F6: "contextual",
    F7: "contextual",
    F9: "contextual",
    F10: "contextual"
  }
};

const MISSING_NEUTRAL_WARNING_PREFIX = `Missing/neutral${" "}input:`;

function factorLabelFromWarning(value = "") {
  const text = String(value || "");
  const index = text.toLowerCase().indexOf(MISSING_NEUTRAL_WARNING_PREFIX.toLowerCase());
  if (index === -1) return "";
  return text.slice(index + MISSING_NEUTRAL_WARNING_PREFIX.length).trim();
}

function factorLabelFromKey(key = "") {
  return String(key || "")
    .replace(/^[A-Z0-9]+\s+/, "")
    .trim();
}

function factorHasMissingInputSignal(factor = {}) {
  const reason = String(factor.reason || "").toLowerCase();
  const evidence = String(factor.evidence || "").toLowerCase();
  return reason.includes("missing input") || evidence.startsWith("missing ");
}

function uniqueStrings(values = []) {
  return [...new Set(values.filter(Boolean).map(value => String(value)))];
}

function factorRole(agentName = "", factorKey = "", factorLabel = "") {
  if (CONTEXTUAL_FACTOR_LABELS.has(factorLabel)) return "contextual";
  return FACTOR_ROLE_BY_ASSET[agentName]?.[factorKey] || "mandatory";
}

function factorEntriesForDiagnostics(call, agent, timeframe = "24h") {
  const timeframeModel = getTimeframeModel(agent, timeframe);
  const factorBreakdown = asObject(
    timeframeModel.factor_breakdown || call?.factor_breakdown,
    {}
  );

  return Object.entries(factorBreakdown).map(([key, factor]) => {
    const label = factorLabelFromKey(key) || key;
    return {
      key: String(key || ""),
      label,
      factor: asObject(factor, {}),
      role: factorRole(agent?.agent, String(key || "").split(" ")[0], label)
    };
  });
}

function snapshotFieldLabel(field = "", options = {}) {
  const noQualifyingEvent = options.noQualifyingEvent === true;
  const labels = {
    latest_us_event: noQualifyingEvent ? "No qualifying US event found" : "US event context unavailable",
    latest_ez_event: noQualifyingEvent ? "No qualifying Eurozone event found" : "Eurozone event context unavailable",
    geopolitical_risk_flag: "Geopolitical risk flag unavailable",
    stablecoin_supply: "Stablecoin supply unavailable",
    stablecoin_supply_d5_pct: "Stablecoin supply 5D delta unavailable",
    stablecoin_supply_d20_pct: "Stablecoin supply 20D delta unavailable",
    btc_dominance_d5: "BTC dominance 5D delta unavailable",
    btc_dominance_d20: "BTC dominance 20D delta unavailable",
    total_crypto_market_cap_d5_pct: "Total crypto market cap 5D delta unavailable",
    total_crypto_market_cap_d20_pct: "Total crypto market cap 20D delta unavailable",
    gold_d5_pct: "Gold 5D delta unavailable",
    gold_d20_pct: "Gold 20D delta unavailable",
    nq_d5_pct: "NQ 5D delta unavailable",
    nq_d20_pct: "NQ 20D delta unavailable",
    btc_d5_pct: "BTC 5D delta unavailable",
    btc_d20_pct: "BTC 20D delta unavailable",
    us_10y_d20_bps: "US 10Y 20D delta unavailable",
    us_10y_real_yield_d20_bps: "US 10Y real yield 20D delta unavailable"
  };

  return labels[field] || `${String(field || "").replaceAll("_", " ")} unavailable`;
}

function factorDiagnosticLabel(entry = {}) {
  const label = entry.label || entry.key || "Factor";
  const evidence = String(entry.factor?.evidence || "");

  if (label === "US Economic Surprise Direction" && evidence.toLowerCase().includes("no recent us event")) {
    return "No qualifying US event found";
  }

  if (label === "EZ Economic Surprise Direction" && evidence.toLowerCase().includes("no recent ez event")) {
    return "No qualifying Eurozone event found";
  }

  if (label === "Stablecoin / Crypto Liquidity") {
    return "Stablecoin and crypto-liquidity context unavailable";
  }

  if (label === "BTC Dominance / Crypto Structure") {
    return "BTC dominance structure context unavailable";
  }

  return `${label} unavailable`;
}

function eventWasSimplyAbsent(agent, timeframe = "24h", field = "") {
  if (!["latest_us_event", "latest_ez_event"].includes(field)) return false;

  return factorEntriesForDiagnostics(getCall(agent, timeframe), agent, timeframe).some(entry => {
    if (field === "latest_us_event" && entry.label !== "US Economic Surprise Direction") return false;
    if (field === "latest_ez_event" && entry.label !== "EZ Economic Surprise Direction") return false;

    const evidence = String(entry.factor?.evidence || "").toLowerCase();
    const reason = String(entry.factor?.reason || "").toLowerCase();
    return evidence.includes("no recent") || reason.includes("no confirmed");
  });
}

function fallbackMessageForField(field = "", timeframe = "24h") {
  const messages = {
    "24h": {
      gold_d5_pct: "Gold 5D delta unavailable — using 1D delta",
      nq_d5_pct: "NQ 5D delta unavailable — using 1D delta",
      btc_d5_pct: "BTC 5D delta unavailable — using 1D delta"
    },
    "3d": {
      gold_d20_pct: "Gold 20D delta unavailable — using 5D delta",
      nq_d20_pct: "NQ 20D delta unavailable — using 5D delta",
      btc_d20_pct: "BTC 20D delta unavailable — using 5D delta",
      us_10y_d20_bps: "US 10Y 20D delta unavailable — using 5D delta",
      us_10y_real_yield_d20_bps: "US 10Y real yield 20D unavailable — using 5D delta"
    },
    current_week: {
      gold_d20_pct: "Gold 20D delta unavailable — using 5D delta",
      nq_d20_pct: "NQ 20D delta unavailable — using 5D delta",
      btc_d20_pct: "BTC 20D delta unavailable — using 5D delta",
      us_10y_d20_bps: "US 10Y 20D delta unavailable — using 5D delta",
      us_10y_real_yield_d20_bps: "US 10Y real yield 20D unavailable — using 5D delta"
    },
    next_week: {
      gold_d20_pct: "Gold 20D delta unavailable — using 5D delta",
      nq_d20_pct: "NQ 20D delta unavailable — using 5D delta",
      btc_d20_pct: "BTC 20D delta unavailable — using 5D delta",
      us_10y_d20_bps: "US 10Y 20D delta unavailable — using 5D delta",
      us_10y_real_yield_d20_bps: "US 10Y real yield 20D unavailable — using 5D delta"
    },
    current_month: {
      gold_d20_pct: "Gold 20D delta unavailable — using 5D delta",
      nq_d20_pct: "NQ 20D delta unavailable — using 5D delta",
      btc_d20_pct: "BTC 20D delta unavailable — using 5D delta",
      us_10y_d20_bps: "US 10Y 20D delta unavailable — using 5D delta",
      us_10y_real_yield_d20_bps: "US 10Y real yield 20D unavailable — using 5D delta"
    }
  };

  return messages[timeframe]?.[field] || "";
}

function classifyDiagnostics(call, agent, timeframe = "24h") {
  const output = getOutput(agent);
  const factorEntries = factorEntriesForDiagnostics(call, agent, timeframe);
  const timeframeModel = getTimeframeModel(agent, timeframe);
  const model = call?.conviction_model || timeframeModel.conviction_model || {};
  const criticalMissing = [];
  const fallbacksUsed = [];
  const collectorHealth = [];

  for (const entry of factorEntries) {
    if (!factorHasMissingInputSignal(entry.factor)) continue;

    if (entry.role === "contextual") {
      collectorHealth.push(factorDiagnosticLabel(entry));
    } else {
      criticalMissing.push(entry.label);
    }
  }

  for (const field of asArray(output.missing_inputs)) {
    const name = String(field || "");
    if (!name) continue;

    if (ALWAYS_VISIBLE_SNAPSHOT_GAPS.has(name)) {
      collectorHealth.push(snapshotFieldLabel(name, {
        noQualifyingEvent: eventWasSimplyAbsent(agent, timeframe, name)
      }));
      continue;
    }

    if (FALLBACK_ELIGIBLE_SNAPSHOT_INPUTS.has(name)) {
      const fallback = fallbackMessageForField(name, timeframe);
      if (fallback) {
        fallbacksUsed.push(fallback);
      }
      continue;
    }
  }

  const confidenceCalculated = [
    call?.confidence,
    call?.conviction,
    model.final_conviction,
    model.bullish_argument_pct,
    model.bearish_argument_pct,
    model.net_edge_pct
  ].some(value => numberOrNull(value) !== null);
  const analysisCompleted = call?.direction && call.direction !== "PENDING";

  return {
    analysisStatus: {
      mandatoryOk: criticalMissing.length === 0,
      analysisCompleted,
      confidenceCalculated,
      criticalMissing: uniqueStrings(criticalMissing)
    },
    fallbacksUsed: uniqueStrings(fallbacksUsed),
    collectorHealth: uniqueStrings(collectorHealth)
  };
}

function liveMissingInputs(call, agent, timeframe = "24h") {
  return classifyDiagnostics(call, agent, timeframe).analysisStatus.criticalMissing;
}

function combinedConfidenceFlags(call, agent, timeframe = "24h") {
  const output = getOutput(agent);
  const timeframeModel = getTimeframeModel(agent, timeframe);

  return [
    ...asArray(agent?.warnings),
    ...asArray(call?.warnings),
    ...asArray(output.risk_flags),
    ...asArray(output.warnings),
    ...asArray(timeframeModel.risk_flags),
    ...asArray(timeframeModel.warnings),
    ...asArray(call?.conviction_model?.audit_warnings),
    ...asArray(timeframeModel.conviction_audit_warnings)
  ]
    .filter(Boolean)
    .map(value => String(value));
}

function missingInputsCount(call, agent, timeframe = "24h") {
  return liveMissingInputs(call, agent, timeframe).length;
}

function getWeeklyCandleStatus(call, agent, timeframe = "24h") {
  const output = getOutput(agent);
  const timeframeModel = getTimeframeModel(agent, timeframe);
  const model = call?.conviction_model || {};

  return (
    model.weekly_candle_status ||
    timeframeModel.weekly_candle_status ||
    output.weekly_candle_status ||
    ""
  );
}

function deriveConfidenceStrength(confidence, netEdge, participation, direction) {
  if (direction === "NO_CALL" || direction === "NO 24H CALL") return "NO_CALL";
  if (confidence === null || confidence === undefined) return "PENDING";

  const edge = Math.abs(Number(netEdge) || 0);
  const active = Number(participation) || 0;

  if (confidence >= 80 && edge >= 25 && active >= 50) return "VERY_STRONG";
  if (confidence >= 65 && edge >= 18 && active >= 35) return "STRONG";
  if (confidence >= 50 && edge >= 10 && active >= 25) return "MODERATE";
  if (confidence > 0) return "WEAK";
  return "NO_CALL";
}

function confidenceData(call, agent, timeframe = "24h") {
  const model = call?.conviction_model || {};
  const direction = call?.direction || "PENDING";
  const bullCase = numberOrNull(model.bullish_argument_pct);
  const bearCase = numberOrNull(model.bearish_argument_pct);
  const participation = numberOrNull(
    model.directional_participation_pct ??
    model.active_participation_pct ??
    model.participation
  );
  const netEdge = numberOrNull(model.net_edge_pct);

  const hasInputs = [bullCase, bearCase, participation, netEdge].every(Number.isFinite);
  if (!hasInputs) {
    const fallback = numberOrNull(model.final_confidence ?? call?.confidence);
    return {
      value: Number.isFinite(fallback) ? fallback : call?.conviction ?? null,
      strength: deriveConfidenceStrength(fallback, netEdge, participation, direction),
      evidenceDominance: null,
      participation,
      netEdge,
      missingInputsCount: missingInputsCount(call, agent, timeframe)
    };
  }

  let confidence =
    ((Math.max(bullCase, bearCase) / 100) * 0.45) +
    ((participation / 100) * 0.35) +
    ((Math.abs(netEdge) / 100) * 0.20);

  if (participation < 40) confidence -= 0.10;
  if (participation < 25) confidence -= 0.20;
  if (Math.abs(netEdge) < 20) confidence -= 0.10;

  const missingCount = missingInputsCount(call, agent, timeframe);
  if (missingCount >= 3) confidence -= 0.05;
  if (missingCount >= 6) confidence -= 0.10;

  const flags = combinedConfidenceFlags(call, agent, timeframe);
  const weeklyStatus = String(getWeeklyCandleStatus(call, agent, timeframe)).toLowerCase();
  const flagText = flags.join(" ").toLowerCase();

  if (
    flagText.includes("event risk") ||
    flagText.includes("high impact event") ||
    flagText.includes("tier 1 event")
  ) {
    confidence -= 0.10;
  }

  if (weeklyStatus === "consolidating" || flagText.includes("weekly consolidation")) {
    confidence -= 0.05;
  }

  if (
    flagText.includes("conviction audit") ||
    flagText.includes("audit flag") ||
    flagText.includes("audit warning")
  ) {
    confidence -= 0.05;
  }

  if (flagText.includes("o layer")) confidence -= 0.05;
  if (flagText.includes("adr warning") || flagText.includes("session warning")) confidence -= 0.05;

  const finalConfidence = Math.round(clamp(confidence, 0, 1) * 100);

  return {
    value: finalConfidence,
    strength: model.confidence_strength || deriveConfidenceStrength(finalConfidence, netEdge, participation, direction),
    evidenceDominance: Math.max(bullCase, bearCase),
    participation,
    netEdge,
    missingInputsCount: missingCount
  };
}

function confidenceValue(call, agent, timeframe = "24h") {
  return confidenceData(call, agent, timeframe).value;
}

function confidenceStrength(call, agent, timeframe = "24h") {
  return confidenceData(call, agent, timeframe).strength;
}

function deriveEvidenceSummary(call, agent, timeframe = "24h") {
  const timeframeModel = getTimeframeModel(agent, timeframe);
  const model = call?.conviction_model || timeframeModel.conviction_model || {};
  const bullCase = numberOrNull(model.bullish_argument_pct);
  const bearCase = numberOrNull(model.bearish_argument_pct);
  const netEdge = numberOrNull(model.net_edge_pct);
  const participation = numberOrNull(
    model.directional_participation_pct ??
    model.active_participation_pct ??
    model.participation
  );

  if (
    !Number.isFinite(bullCase) ||
    !Number.isFinite(bearCase) ||
    !Number.isFinite(netEdge) ||
    !Number.isFinite(participation)
  ) {
    return "";
  }

  return `Derived from evidence split: Bull Case ${Math.round(bullCase)}%, Bear Case ${Math.round(bearCase)}%, Net Edge ${netEdge > 0 ? "+" : ""}${Math.round(netEdge)}%, Participation ${Math.round(participation)}%.`;
}

function displayMetricValue(value) {
  return value === null || value === undefined || value === "" ? "--" : `${Math.round(Number(value))}%`;
}

function isNoCallDirection(direction = "") {
  const normalized = String(direction || "").toUpperCase();
  return normalized === "NO CALL" || normalized === "NO 24H CALL" || normalized === "PENDING";
}

function hasUsableDirection(call) {
  return !!call && !isNoCallDirection(call.direction);
}

function formatLondonDate(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);

  const lookup = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${lookup.year}-${lookup.month}-${lookup.day}`;
}

function formatLondonDay(date) {
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    timeZone: "Europe/London"
  });
}

function isWeekendDate(date) {
  const weekday = date.toLocaleDateString("en-US", {
    weekday: "long",
    timeZone: "Europe/London"
  });

  return weekday === "Saturday" || weekday === "Sunday";
}

function marketOpenForDate(agentName, date) {
  return agentName === "BTC" || !isWeekendDate(date);
}

function metricSourceTimeframe(agent) {
  const ordered = ["24h", "3d", "current_week", "next_week", "current_month"];
  return ordered.find(tf => {
    const call = getCall(agent, tf);
    return hasUsableDirection(call) && confidenceValue(call, agent, tf) !== null;
  }) || "24h";
}

function buildDisplayMetrics(agent, timeframe) {
  const call = getCall(agent, timeframe);
  const model = call.conviction_model || {};
  return {
    bull_case: numberOrNull(model.bullish_argument_pct),
    bear_case: numberOrNull(model.bearish_argument_pct),
    winning_side: model.winning_side || null,
    confidence: confidenceValue(call, agent, timeframe),
    conviction: numberOrNull(call.conviction ?? model.final_conviction),
    net_edge: numberOrNull(model.net_edge_pct),
    participation: numberOrNull(
      model.directional_participation_pct ??
      model.active_participation_pct ??
      model.participation
    ),
    directional_participation: numberOrNull(
      model.directional_participation_pct ??
      model.active_participation_pct ??
      model.participation
    ),
    neutral: numberOrNull(model.neutral_evidence_pct ?? model.neutral_pct),
    verdict_strength: confidenceStrength(call, agent, timeframe),
    bull_case_weight: numberOrNull(model.bull_case_weight),
    bear_case_weight: numberOrNull(model.bear_case_weight),
    source_timeframe: timeframe
  };
}

function normaliseAgentCalls(agent) {
  const calls = Object.fromEntries(
    Object.entries(agent.calls || {}).map(([timeframe, call]) => {
      const metrics = buildDisplayMetrics(agent, timeframe);
      return [timeframe, {
        ...call,
        confidence: metrics.confidence,
        bull_case: metrics.bull_case,
        bear_case: metrics.bear_case,
        net_edge: metrics.net_edge,
        participation: metrics.participation,
        strength: metrics.verdict_strength
      }];
    })
  );

  return calls;
}

function outlookSourceTimeframes(dayOffset) {
  if (dayOffset === 0) return ["24h"];
  if (dayOffset === 1) return ["24h", "3d"];
  if (dayOffset === 2 || dayOffset === 3) return ["3d"];
  if (dayOffset === 4 || dayOffset === 5) return ["current_week"];
  return ["next_week"];
}

function buildNoCallOutlookEntry(date, sourceTimeframe = "weekend_rule") {
  return {
    date: formatLondonDate(date),
    day: formatLondonDay(date),
    source_timeframe: sourceTimeframe,
    direction: "NO CALL",
    confidence: null
  };
}

function buildSevenDayOutlook(agent) {
  const baseDate = new Date();
  baseDate.setHours(12, 0, 0, 0);

  return Array.from({ length: 7 }, (_, dayOffset) => {
    const date = new Date(baseDate);
    date.setDate(baseDate.getDate() + dayOffset);

    if (!marketOpenForDate(agent.agent, date)) {
      return buildNoCallOutlookEntry(date);
    }

    const sourceTimeframe = outlookSourceTimeframes(dayOffset).find(timeframe => {
      const call = getCall(agent, timeframe);
      return hasUsableDirection(call);
    });

    if (!sourceTimeframe) {
      return buildNoCallOutlookEntry(date, outlookSourceTimeframes(dayOffset)[0]);
    }

    const call = getCall(agent, sourceTimeframe);
    return {
      date: formatLondonDate(date),
      day: formatLondonDay(date),
      source_timeframe: sourceTimeframe,
      direction: call.direction || "NO CALL",
      confidence: confidenceValue(call, agent, sourceTimeframe)
    };
  });
}

function normaliseLayer1Data(data = {}) {
  const agents = (data.agents || []).map(rawAgent => {
    const provisionalAgent = {
      ...rawAgent,
      calls: rawAgent.calls || {}
    };

    const calls = normaliseAgentCalls(provisionalAgent);
    const agent = {
      ...provisionalAgent,
      calls
    };

    const sourceTimeframe = metricSourceTimeframe(agent);
    const displayMetrics = buildDisplayMetrics(agent, sourceTimeframe);

    return {
      ...agent,
      display_metrics: {
        ...(agent.display_metrics || {}),
        ...displayMetrics
      },
      seven_day_outlook: buildSevenDayOutlook(agent)
    };
  });

  return {
    ...data,
    agents
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
    return confidenceValue(call24, agent, "24h") !== null && call24.direction !== "PENDING";
  });

  return live.sort((a, b) => {
    return Number(confidenceValue(getCall(b, "24h"), b, "24h") || 0) - Number(confidenceValue(getCall(a, "24h"), a, "24h") || 0);
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
      ? `${strongest.agent} ${formatConviction(confidenceValue(getCall(strongest, "24h"), strongest, "24h"))}`
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
      <span>${strongest ? formatConviction(confidenceValue(getCall(strongest, "24h"), strongest, "24h")) : "--"} confidence</span>
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
  const call24Confidence = confidenceValue(call24, agent, "24h");
  const metrics = agent.display_metrics || {};
  const assetUpdated = getAgentUpdatedAt(agent);
  const formattedAssetUpdated = formatDashboardTime(assetUpdated);
  const assetAge = formatRelativeAge(assetUpdated);

  const calls = Object.entries(agent.calls || {}).map(([tf, call]) => {
    const direction = call.direction || "PENDING";
    const metric = confidenceValue(call, agent, tf);

    return `
      <div class="call-row compact-call">
        <div class="call-row-head">
          <span class="timeframe">${labels[tf] || tf}</span>
          <span class="direction ${directionClass(direction)}">${normaliseDirection(direction)} ${formatConviction(metric)}</span>
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
        <strong>${formatConviction(call24Confidence)}</strong>
      </div>

      <p class="summary">${escapeHtml(agent.summary || "")}</p>

      <div class="agent-metrics">
        <div class="agent-metric-chip">
          <span>Confidence</span>
          <strong>${displayMetricValue(metrics.confidence)}</strong>
        </div>
        <div class="agent-metric-chip">
          <span>Bull Case</span>
          <strong>${displayMetricValue(metrics.bull_case)}</strong>
        </div>
        <div class="agent-metric-chip">
          <span>Bear Case</span>
          <strong>${displayMetricValue(metrics.bear_case)}</strong>
        </div>
        <div class="agent-metric-chip">
          <span>Net Edge</span>
          <strong>${displayMetricValue(metrics.net_edge)}</strong>
        </div>
        <div class="agent-metric-chip">
          <span>Participation</span>
          <strong>${displayMetricValue(metrics.participation)}</strong>
        </div>
        <div class="agent-metric-chip">
          <span>Strength</span>
          <strong>${escapeHtml(metrics.verdict_strength || "--")}</strong>
        </div>
      </div>

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
  renderSevenDayOutlook(data);

  const grid = document.getElementById("layer1Grid");
  if (!grid) return;

  grid.innerHTML = (data.agents || []).map(renderAgentCard).join("");

  grid.querySelectorAll("[data-agent]").forEach(el => {
    el.addEventListener("click", () => setTab(el.dataset.agent));
  });
}

function renderSevenDayOutlook(data) {
  const container = document.getElementById("overviewOutlook");
  if (!container) return;

  container.innerHTML = (data?.agents || []).map(agent => `
    <article class="detail-panel outlook-card">
      <div class="panel-head compact-panel-head">
        <div>
          <p class="eyebrow">Layer 1 Outlook</p>
          <h3>${escapeHtml(agent.agent)}</h3>
        </div>
      </div>
      <div class="outlook-list">
        ${(agent.seven_day_outlook || []).map(entry => `
          <div class="outlook-row">
            <span class="outlook-day">${escapeHtml(entry.day)}</span>
            <span class="direction ${directionClass(entry.direction)}">${escapeHtml(normaliseDirection(entry.direction))}</span>
            <span class="outlook-confidence">${displayMetricValue(entry.confidence)}</span>
          </div>
        `).join("")}
      </div>
    </article>
  `).join("");
}

function cleanDecisionReason(reason = "") {
  return String(reason || "")
    .replaceAll("_", " ")
    .replace(/^(24h|3d|current week|next week|current month)\s+/i, "")
    .replace(/\s+/g, " ")
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

function getTodayFactors(agent, options = {}) {
  const includeMissing = options.includeMissing === true;
  const today = getCall(agent, "24h");
  const entries = factorEntriesFrom(today.factor_breakdown || agent.factor_breakdown || {});
  return includeMissing ? entries : entries.filter(entry => !factorHasMissingInputSignal(entry));
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
  const confidence = confidenceValue(today, agent, "24h");
  const assetUpdated = getAgentUpdatedAt(agent);
  const strength = confidenceStrength(today, agent, "24h") || "Not supplied";

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
        <b>${formatConviction(confidence)}</b>
        <small>Confidence in the current trading-session bias</small>
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
  return renderStructuredDiagnostics(agent, "24h");
}

function renderStructuredDiagnostics(agent, timeframe = "24h") {
  const call = getCall(agent, timeframe);
  const output = asObject(agent.full_output || agent.raw_agent_output, {});
  const marketInputs = asObject(agent.market_inputs || output.market_inputs_seen_by_workflow, {});
  const diagnostics = classifyDiagnostics(call, agent, timeframe);

  const participation = participationValue(call);
  const latestEvent = marketInputs.latest_us_event || marketInputs.latest_ez_event || null;
  const eventText = describeEventRisk(latestEvent);
  const statusLines = [
    diagnostics.analysisStatus.analysisCompleted ? "Analysis completed" : "Analysis pending",
    diagnostics.analysisStatus.confidenceCalculated ? "Confidence calculated" : "Confidence not available",
    diagnostics.analysisStatus.mandatoryOk ? "All mandatory inputs available" : "Critical inputs missing",
    diagnostics.analysisStatus.criticalMissing.length ? `Critical inputs missing: ${diagnostics.analysisStatus.criticalMissing.join(", ")}` : "No critical missing inputs"
  ];

  if (Number.isFinite(participation) && participation < 35) {
    statusLines.push(`Low ${String(timeframe).replaceAll("_", " ").toUpperCase()} participation: only ${participation}% of weighted evidence is directional.`);
  }

  const sectionHtml = (title, items, emptyText, variant = "") => `
    <section class="diagnostic-section ${variant}">
      <h4>${escapeHtml(title)}</h4>
      ${items.length
        ? `<div class="diagnostic-list">${items.map(item => `<div class="diagnostic-item">${escapeHtml(item)}</div>`).join("")}</div>`
        : `<div class="empty-state">${escapeHtml(emptyText)}</div>`}
    </section>
  `;

  return `
    <article class="detail-panel wide-panel invalidation-panel">
      <div class="panel-head">
        <p class="eyebrow">Analysis Diagnostics</p>
        <h3>What This Call Used</h3>
      </div>
      <div class="diagnostic-sections">
        ${sectionHtml("Analysis Status", statusLines, "No analysis status available.", "diagnostic-status")}
        ${sectionHtml("Fallbacks Used", diagnostics.fallbacksUsed, "No fallbacks used in today's 24H analysis.")}
        ${sectionHtml("Collector Health", diagnostics.collectorHealth, "No collector health gaps surfaced for today's 24H view.")}
        <div class="event-risk-note">${escapeHtml(eventText)}</div>
      </div>
    </article>
  `;
}

function renderSecondaryTimeframes(agent) {
  const timeframeKeys = ["3d", "current_week", "next_week", "current_month"];

  return timeframeKeys.map(tf => {
    const call = getCall(agent, tf);
    const confidence = confidenceValue(call, agent, tf);
    const timeframeModel = getTimeframeModel(agent, tf);
    const explicitReason = [
      call.reason,
      timeframeModel.reason,
      call?.conviction_model?.final_conviction_logic,
      timeframeModel?.conviction_model?.final_conviction_logic
    ]
      .map(value => cleanDecisionReason(value))
      .find(Boolean);
    const fallbackReason = explicitReason || deriveEvidenceSummary(call, agent, tf);
    return `
      <div class="secondary-timeframe-card">
        <span class="timeframe">${labels[tf] || tf}</span>
        <strong class="direction ${directionClass(call.direction)}">${normaliseDirection(call.direction)}</strong>
        <b>${formatConviction(confidence)}</b>
        <p>${escapeHtml(firstSentence(fallbackReason) || "No reason supplied.")}</p>
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
          <p><strong>Participation:</strong> ${formatModelPercent(model.directional_participation_pct)}</p>
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
  const output = getOutput(agent);
  const today = getCall(agent, "24h");
  const model = agent.conviction_model || output.conviction_model || {};

  const bullish = agent.score_bullish ?? output.score_bullish ?? "--";
  const bearish = agent.score_bearish ?? output.score_bearish ?? "--";
  const neutral = agent.score_neutral ?? output.score_neutral ?? "--";

  const bullCase = model.bullish_argument_pct;
  const bearCase = model.bearish_argument_pct;
  const neutralPct = model.neutral_pct;
  const netEdge = model.net_edge_pct;
  const confidence = confidenceValue(today, agent, "24h");
  const participation = model.directional_participation_pct;
  const winningSide = model.winning_side;
  const verdictStrength = confidenceStrength(today, agent, "24h");

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
      <p><strong>Confidence:</strong> ${formatModelPercent(confidence)}</p>
      <p><strong>Net Edge:</strong> ${netEdge ?? "--"}%</p>
      <p><strong>Participation:</strong> ${formatModelPercent(participation)}</p>
      <p><strong>Neutral factors:</strong> ${formatModelPercent(neutralPct)}</p>
      <p><strong>Strength:</strong> ${verdictStrength || "--"}</p>
      <p><strong>Model Logic:</strong> ${escapeHtml(model.final_conviction_logic ?? "No confidence model supplied yet.")}</p>
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
        <b>${formatConviction(confidenceValue(call24, agent, "24h"))}</b>
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
          <p class="eyebrow">Confidence</p>
          <h3>Evidence Split And Call Quality</h3>
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
  const overviewLayer2Updated = document.getElementById("overviewLayer2Updated");
  if (overviewLayer2Updated) {
    overviewLayer2Updated.textContent = `Last updated: ${formatDashboardTime(data.dashboard_meta?.last_updated_et)}`;
  }

  const opportunities = Array.isArray(data.trade_opportunities) ? data.trade_opportunities : [];
  const avoided = Array.isArray(data.avoid_today) ? data.avoid_today : [];
  const html = `
    <div class="layer2-summary trade-layer-summary">
      <div>
        <p class="eyebrow">Pair Analysis</p>
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

  ["layer2Panel", "overviewLayer2Panel"].forEach(id => {
    const panel = document.getElementById(id);
    if (panel) panel.innerHTML = html;
  });
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
            <th>Confidence</th>
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
              <td>${percentValue(call.confidence ?? call.conviction)}</td>
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

function workflowEtaText(status, statusClass) {
  if (status?.eta) return status.eta;
  if (status?.eta_seconds !== undefined) return `${Math.max(0, Math.ceil(Number(status.eta_seconds) / 60))}m ETA`;
  if (statusClass === "running" && status?.last_run_started_at) {
    const startedAt = new Date(status.last_run_started_at).getTime();
    const windowMs = Number(workflowControl?.poll_after_trigger_ms || 180000);
    if (!Number.isNaN(startedAt)) {
      const remainingMs = Math.max(0, startedAt + windowMs - Date.now());
      return remainingMs > 0 ? `~${Math.ceil(remainingMs / 60000)}m ETA` : "Checking completion";
    }
  }
  if (statusClass === "success") return status?.last_run_finished_at ? `Completed ${formatRelativeAge(status.last_run_finished_at)}` : "Completed";
  if (statusClass === "failed") return "Needs review";
  if (statusClass === "not-configured") return "Not configured";
  return "Ready";
}

function renderWorkflowStatus(status = workflowStatus) {
  const summary = document.getElementById("workflowStatusSummary");
  const badge = document.getElementById("workflowStatusBadge");
  const button = document.getElementById("runWorkflowButton");
  const errorReport = document.getElementById("workflowErrorReport");
  const eta = document.getElementById("workflowEta");

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
    button.textContent = workflowTriggerInFlight ? "Starting..." : "Run Refresh";
    button.title = configured
      ? "Trigger the n8n Master Orchestrator"
      : "Add the n8n webhook URL to data/workflow-control.json";
  }

  if (eta) {
    eta.textContent = workflowEtaText(status, statusClass);
    eta.className = `workflow-eta ${statusClass}`;
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

    layer1Data = normaliseLayer1Data(await layer1Res.json());
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
