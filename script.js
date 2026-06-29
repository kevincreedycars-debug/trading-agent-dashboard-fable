const layer1Url = "./data/layer1.json";
const layer2Url = "./data/layer2.json";
const workflowControlUrl = "./data/workflow-control.json";
const checkerDataUrl = "./data/backtester-checker-usd-24h-2024-01.json?v=20260629-usd-flatband-010";
const researchSupabaseUrl = "https://eaolqbrlywczinfordvg.supabase.co/rest/v1";
const researchSupabaseKey = "sb_publishable_k6YbEuuk3GyB9GVTQDtNVA_J1gCRYaY";

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
let activeCheckerRowId = null;
const navigationStateKey = "dashboard-navigation-state";

function storageAvailable() {
  try {
    return typeof window !== "undefined" && !!window.localStorage;
  } catch (err) {
    return false;
  }
}

function getAvailableTopLevelTabs() {
  return Array.from(document.querySelectorAll(".tab-button"))
    .map(btn => btn.dataset.tab)
    .filter(Boolean);
}

function getAvailableBacktestTabs() {
  return Array.from(document.querySelectorAll(".subtab-button"))
    .map(btn => btn.dataset.backtestTab)
    .filter(Boolean);
}

function saveNavigationState() {
  if (!storageAvailable()) return;
  try {
    window.localStorage.setItem(navigationStateKey, JSON.stringify({
      activeTab,
      activeBacktestTab
    }));
  } catch (err) {
    console.warn("Could not save dashboard navigation state", err);
  }
}

function restoreNavigationState() {
  const availableTabs = getAvailableTopLevelTabs();
  const availableBacktestTabs = getAvailableBacktestTabs();

  if (!storageAvailable()) {
    activeTab = availableTabs.includes("overview") ? "overview" : (availableTabs[0] || "overview");
    activeBacktestTab = availableBacktestTabs.includes("accuracy") ? "accuracy" : (availableBacktestTabs[0] || "accuracy");
    return;
  }

  try {
    const parsed = JSON.parse(window.localStorage.getItem(navigationStateKey) || "{}");
    const savedTopLevelTab = String(parsed.activeTab || "").trim();
    const savedBacktestTab = String(parsed.activeBacktestTab || "").trim();

    activeTab = availableTabs.includes(savedTopLevelTab)
      ? savedTopLevelTab
      : (availableTabs.includes("overview") ? "overview" : (availableTabs[0] || "overview"));

    activeBacktestTab = availableBacktestTabs.includes(savedBacktestTab)
      ? savedBacktestTab
      : (availableBacktestTabs.includes("accuracy") ? "accuracy" : (availableBacktestTabs[0] || "accuracy"));
  } catch (err) {
    console.warn("Could not restore dashboard navigation state", err);
    activeTab = availableTabs.includes("overview") ? "overview" : (availableTabs[0] || "overview");
    activeBacktestTab = availableBacktestTabs.includes("accuracy") ? "accuracy" : (availableBacktestTabs[0] || "accuracy");
  }
}

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
  renderAgentDetail(agentName);
  return;

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

function displayDash() {
  return "—";
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

function renderBacktestKpiMetric(label, primary, secondary = "", detail = "") {
  return `
    <article class="backtest-metric-card backtest-kpi-card">
      <p class="eyebrow">${escapeHtml(label)}</p>
      <h3>${escapeHtml(primary)}</h3>
      ${secondary ? `<strong class="backtest-kpi-secondary">${escapeHtml(secondary)}</strong>` : ""}
      ${detail ? `<span>${escapeHtml(detail)}</span>` : ""}
    </article>
  `;
}

function renderProgressPill(label = "", value = "") {
  return `
    <div class="progress-pill">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `;
}

function formatDateValue(value) {
  if (!value) return "Not yet available";
  return escapeHtml(String(value));
}

function metricAvailable(value) {
  return value !== null && value !== undefined && value !== "";
}

function renderUnavailableMetric(label, detail) {
  return renderBacktestMetric(label, "Not yet available", detail);
}

function renderResearchBreakdownTable(title, subtitle, rows, columns, options = {}) {
  const panelClass = ["detail-panel", "research-table-panel", options.panelClass || ""].filter(Boolean).join(" ");
  const tableClass = ["dashboard-table", "research-table", options.tableClass || ""].filter(Boolean).join(" ");

  if (!rows.length) {
    return `
      <article class="${panelClass}">
        <div class="panel-head">
          <p class="eyebrow">${escapeHtml(subtitle)}</p>
          <h3>${escapeHtml(title)}</h3>
        </div>
        <div class="empty-state">Not yet available from the research layer.</div>
      </article>
    `;
  }

  return `
    <article class="${panelClass}">
      <div class="panel-head">
        <p class="eyebrow">${escapeHtml(subtitle)}</p>
        <h3>${escapeHtml(title)}</h3>
      </div>
      ${options.description ? `<p class="research-panel-copy">${escapeHtml(options.description)}</p>` : ""}
      <div class="table-scroll research-table-scroll">
        <table class="${tableClass}">
          <thead>
            <tr>${columns.map(column => `<th>${escapeHtml(column.label)}</th>`).join("")}</tr>
          </thead>
          <tbody>
            ${rows.map(row => `
              <tr>${columns.map(column => `<td>${column.render(row)}</td>`).join("")}</tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </article>
  `;
}

function researchDataCell(primary, secondary = "") {
  return `
    <div class="research-cell">
      <strong>${escapeHtml(metricAvailable(primary) ? String(primary) : "Not yet available")}</strong>
      ${secondary ? `<span>${escapeHtml(secondary)}</span>` : ""}
    </div>
  `;
}

function researchPairCell(primary, secondary) {
  return `
    <div class="research-cell">
      <strong>${escapeHtml(primary || "Unknown")}</strong>
      <span>${escapeHtml(secondary || "Unknown")}</span>
    </div>
  `;
}

function computeResearchNotEvaluable(overall = {}, infrastructure = {}) {
  const predictionCount = numberOrNull(infrastructure.prediction_count);
  const evaluated = numberOrNull(overall.evaluated_predictions);
  if (predictionCount === null || evaluated === null) return null;
  return Math.max(0, predictionCount - evaluated);
}

function renderResearchStatusHeader(data = {}) {
  const overall = data.accuracy?.overall || {};
  const infrastructure = data.infrastructure || {};
  const lastSynced = data.meta?.error ? "Unavailable" : formatDashboardTime(data.meta?.last_updated);
  const replayCoverage = infrastructure.replay_coverage || "Not yet available";
  const evaluatedRows = metricAvailable(overall.evaluated_predictions) ? String(overall.evaluated_predictions) : "Not yet available";

  return `
    <section class="research-status-hero">
      <article class="detail-panel wide-panel research-status-strip">
        <div class="research-status-label">
          <p class="eyebrow">Research Status</p>
          <strong>USD historical benchmark dashboard</strong>
        </div>
        <div class="research-status-grid">
          ${renderProgressPill("Last Synced", lastSynced)}
          ${renderProgressPill("Benchmark Market", "DXY")}
          ${renderProgressPill("Replay Coverage", replayCoverage)}
          ${renderProgressPill("Rows Evaluated", evaluatedRows)}
          ${renderProgressPill("Research Mode", "Read-only")}
        </div>
      </article>
    </section>
  `;
}

function renderResearchInfrastructureSummary(data = {}) {
  const infrastructure = data.infrastructure || {};

  return `
    <section class="research-section">
      <div class="research-section-head">
        <div>
          <p class="eyebrow">Infrastructure</p>
          <h3>Pipeline status</h3>
        </div>
        <p class="research-panel-copy">The research warehouse, replay engine, and evaluation pipeline feed this page. This section stays secondary to the headline USD benchmark result.</p>
      </div>
      <section class="backtest-metric-grid research-progress-grid research-infra-grid">
        ${renderBacktestMetric("Historical Warehouse", infrastructure.historical_warehouse_status || "Not yet available", "Historical source tables populated")}
        ${renderBacktestMetric("Snapshot Builder", infrastructure.snapshot_builder_status || "Not yet available", "Historical USD market snapshots available")}
        ${renderBacktestMetric("Replay Engine", infrastructure.replay_engine_status || "Not yet available", "Research observations and predictions written")}
        ${renderBacktestMetric("Outcome Evaluation", infrastructure.outcome_evaluation_status || "Not yet available", "Predictions evaluated against realised outcomes")}
        ${renderBacktestMetric("Research SQL", infrastructure.research_sql_status || "Not yet available", "Dashboard reads research views only")}
      </section>
    </section>
  `;
}

const matrixStrengthBuckets = [
  {
    key: "weak",
    label: "Weak",
    rangeLabel: "0-49%",
    definition: "Live dashboard confidence band."
  },
  {
    key: "moderate",
    label: "Moderate",
    rangeLabel: "50-64%",
    definition: "Live dashboard confidence band."
  },
  {
    key: "strong",
    label: "Strong",
    rangeLabel: "65-79%",
    definition: "Live dashboard confidence band."
  },
  {
    key: "very_strong",
    label: "Very Strong",
    rangeLabel: "80-100%",
    definition: "Live dashboard confidence band."
  }
];

const matrixDirectionBuckets = [
  { key: "bullish", label: "Bullish" },
  { key: "bearish", label: "Bearish" },
  { key: "neutral", label: "Neutral / Flat" }
];

function normalizeResearchMatrixDirection(value = "") {
  const normalized = String(value || "").trim().toUpperCase();

  if (normalized.startsWith("BULLISH")) return "bullish";
  if (normalized.startsWith("BEARISH")) return "bearish";
  if (["NO_CLEAR_BIAS", "NO CALL", "NO_CALL", "NEUTRAL", "FLAT"].includes(normalized)) return "neutral";
  return null;
}

function confidenceBandStrengthKey(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  if (numeric >= 80) return "very_strong";
  if (numeric >= 65) return "strong";
  if (numeric >= 50) return "moderate";
  if (numeric >= 0) return "weak";
  return null;
}

function parseConfidenceCandidate(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const normalized = trimmed.replace(/%/g, "").replace(/,/g, "");
    const numeric = Number(normalized);
    return Number.isFinite(numeric) ? numeric : null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function deriveHeadlineConfidencePercent(source = {}) {
  const bullCase = parseConfidenceCandidate(source.bull_case_pct ?? source.bullCase);
  const bearCase = parseConfidenceCandidate(source.bear_case_pct ?? source.bearCase);
  const participation = parseConfidenceCandidate(source.participation_pct ?? source.participation);
  const netEdge = parseConfidenceCandidate(source.net_edge_pct ?? source.netEdge);

  if (![bullCase, bearCase, participation, netEdge].every(Number.isFinite)) {
    return null;
  }

  let confidence =
    ((Math.max(bullCase, bearCase) / 100) * 0.45) +
    ((participation / 100) * 0.35) +
    ((Math.abs(netEdge) / 100) * 0.20);

  if (participation < 40) confidence -= 0.10;
  if (participation < 25) confidence -= 0.20;
  if (Math.abs(netEdge) < 20) confidence -= 0.10;

  return roundTo(clamp(confidence, 0, 1) * 100, 1);
}

function normalizeConfidencePercent(row = {}) {
  const derivedHeadline = deriveHeadlineConfidencePercent(row);
  const candidates = [
    row.headline_confidence_pct,
    derivedHeadline,
    row.predicted_conviction,
    row.agent_conviction,
    row.confidence,
    row.conviction
  ];

  for (const candidate of candidates) {
    const numeric = parseConfidenceCandidate(candidate);
    if (!Number.isFinite(numeric)) continue;

    if (numeric >= 0.5 && numeric <= 1) {
      return roundTo(numeric * 100, 1);
    }

    if (numeric >= 0 && numeric <= 100) {
      return roundTo(numeric, 1);
    }
  }

  return null;
}

function normalizeResearchMatrixStrength(row = {}) {
  const confidencePct = normalizeConfidencePercent(row);
  return confidenceBandStrengthKey(confidencePct);
}

function normaliseResearchRows(rows) {
  return Array.isArray(rows) ? rows.filter(row => row && typeof row === "object") : [];
}

function roundTo(value, decimals = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  const factor = 10 ** Math.max(0, Number(decimals) || 0);
  return Math.round(numeric * factor) / factor;
}

function computeResearchMatrix(rows = [], options = {}) {
  const assetCode = options.assetCode || "USD";
  const timeframe = options.timeframe || "following 24hrs";
  const safeRows = normaliseResearchRows(rows);
  const filteredRows = safeRows.filter(row =>
    (!assetCode || row.asset_code === assetCode) &&
    (!timeframe || row.timeframe === timeframe)
  );
  const matrix = {};
  let usableRowCount = 0;
  const exclusionCounts = {};

  const trackExclusion = (reason) => {
    exclusionCounts[reason] = (exclusionCounts[reason] || 0) + 1;
  };

  matrixDirectionBuckets.forEach(direction => {
    matrix[direction.key] = {};
    matrixStrengthBuckets.forEach(strength => {
      matrix[direction.key][strength.key] = {
        callCount: 0,
        accurateCount: 0,
        wrongCount: 0,
        flatCount: 0,
        exFlatAccuracyPct: null,
        flatRatePct: null
      };
    });
  });

  filteredRows.forEach(row => {
      const directionKey = normalizeResearchMatrixDirection(row.predicted_direction || row.agent_direction);
      const strengthKey = normalizeResearchMatrixStrength(row);
      const result = String(row.combined_result || "").trim().toUpperCase();

      if (!["CORRECT", "WRONG", "FLAT"].includes(result)) {
        trackExclusion("unsupported_result");
        return;
      }
      if (!directionKey) {
        trackExclusion("unsupported_direction");
        return;
      }
      if (!metricAvailable(normalizeConfidencePercent(row))) {
        trackExclusion("missing_confidence");
        return;
      }
      if (!strengthKey) {
        trackExclusion("unsupported_confidence_band");
        return;
      }

      const bucket = matrix[directionKey][strengthKey];
      usableRowCount += 1;
      bucket.callCount += 1;

      if (result === "CORRECT") {
        bucket.accurateCount += 1;
      } else if (result === "WRONG") {
        bucket.wrongCount += 1;
      } else if (result === "FLAT") {
        bucket.flatCount += 1;
      }
    });

  matrixDirectionBuckets.forEach(direction => {
    matrixStrengthBuckets.forEach(strength => {
      const bucket = matrix[direction.key][strength.key];
      const exFlatCalls = bucket.accurateCount + bucket.wrongCount;
      bucket.exFlatAccuracyPct = exFlatCalls
        ? roundTo((bucket.accurateCount / exFlatCalls) * 100, 1)
        : null;
      bucket.flatRatePct = bucket.callCount
        ? roundTo((bucket.flatCount / bucket.callCount) * 100, 1)
        : null;
    });
  });

  const mostCommonExclusionReason = Object.entries(exclusionCounts)
    .sort((a, b) => b[1] - a[1])[0]?.[0] || "none";

  return {
    matrix,
    sourceRowCount: filteredRows.length,
    usableRowCount,
    excludedRowCount: Math.max(0, filteredRows.length - usableRowCount),
    mostCommonExclusionReason,
    exclusionCounts
  };
}

function getResearchRowIdentifier(row = {}) {
  return row.prediction_id || row.research_id || row.id || row.prediction_uuid || null;
}

function getResearchRowExclusionReason(row = {}) {
  const directionKey = normalizeResearchMatrixDirection(row.predicted_direction || row.agent_direction);
  const confidencePct = normalizeConfidencePercent(row);
  const strengthKey = confidenceBandStrengthKey(confidencePct);
  const result = String(row.combined_result || "").trim().toUpperCase();

  if (!["CORRECT", "WRONG", "FLAT"].includes(result)) return "unsupported_result";
  if (!directionKey) return "unsupported_direction";
  if (!metricAvailable(confidencePct)) return "missing_confidence";
  if (!strengthKey) return "unsupported_confidence_band";
  return null;
}

function formatMatrixAccuracy(value) {
  if (!metricAvailable(value)) return `${displayDash()} ex-flat`;
  const numeric = Number(value);
  const rounded = Math.abs(numeric - Math.round(numeric)) < 0.05
    ? Math.round(numeric)
    : roundTo(numeric, 1);
  return `${rounded}% ex-flat`;
}

function matrixCellTone(callCount, accuracyPct) {
  if (!callCount || !metricAvailable(accuracyPct)) return "empty";
  if (accuracyPct >= 65) return "high";
  if (accuracyPct >= 50) return "medium";
  return "low";
}

function matrixDirectionLabel(key = "") {
  const entry = matrixDirectionBuckets.find(item => item.key === key);
  return entry?.label || "Unknown";
}

function matrixStrengthLabel(key = "") {
  const entry = matrixStrengthBuckets.find(item => item.key === key);
  return entry?.label || "Unknown";
}

function titleCaseWords(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .split(/[\s_]+/)
    .filter(Boolean)
    .map(token => token.charAt(0).toUpperCase() + token.slice(1))
    .join(" ");
}

function formatMatrixCorrectCount(value) {
  return metricAvailable(value) ? `${value} correct` : `${displayDash()} correct`;
}

function formatResearchTimeframeLabel(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "following 24hrs") return "24H";
  if (normalized === "3d from call") return "3D";
  return String(value || "Unknown");
}

function formatBenchmarkMove(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return displayDash();
  const rounded = roundTo(numeric, 2);
  const sign = rounded > 0 ? "+" : "";
  return `${sign}${rounded}%`;
}

function formatEvaluationResult(value = "") {
  const normalized = String(value || "").trim().toUpperCase();
  if (!normalized) return "Unknown";
  if (normalized === "CORRECT") return "Correct";
  if (normalized === "WRONG") return "Wrong";
  if (normalized === "FLAT") return "Flat";
  if (normalized === "NOT_EVALUABLE") return "Not evaluable";
  return normalized.replaceAll("_", " ");
}

function formatConvictionPercent(value) {
  const numeric = parseConfidenceCandidate(value);
  if (!Number.isFinite(numeric)) return displayDash();
  const normalized = numeric >= 0.5 && numeric <= 1 ? numeric * 100 : numeric;
  const rounded = roundTo(normalized, 1);
  const display = Math.abs(rounded - Math.round(rounded)) < 0.05 ? Math.round(rounded) : rounded;
  return `${display}%`;
}

function formatProductionStrength(value = "") {
  const key = confidenceBandStrengthKey(value);
  return key ? matrixStrengthLabel(key) : "Unknown";
}

function formatBenchmarkPrice(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return displayDash();
  return String(roundTo(numeric, 4));
}

function formatFallbackCell(value) {
  if (value === null || value === undefined) return displayDash();
  const text = String(value).trim();
  return text ? escapeHtml(text) : displayDash();
}

function buildResearchEvidenceAudit(rows = [], options = {}) {
  const assetCode = options.assetCode || "USD";
  const timeframe = options.timeframe || "following 24hrs";
  const sourceView = options.sourceView || "research_prediction_usd_benchmark_summary";
  const filteredRows = normaliseResearchRows(rows).filter(row =>
    (!assetCode || row.asset_code === assetCode) &&
    (!timeframe || row.timeframe === timeframe)
  );

  const matrixComputation = computeResearchMatrix(filteredRows, {
    assetCode: "",
    timeframe: ""
  });
  const includedRows = [];
  const excludedRows = [];
  const directionCounts = {};
  const strengthCounts = {};
  const matrixCellCounts = {};
  const resultCounts = {
    correct: 0,
    wrong: 0,
    flat: 0
  };

  filteredRows.forEach(row => {
    const directionKey = normalizeResearchMatrixDirection(row.predicted_direction || row.agent_direction);
    const confidencePct = normalizeConfidencePercent(row);
    const strengthKey = confidenceBandStrengthKey(confidencePct);
    const resultRaw = String(row.combined_result || "").trim().toUpperCase();
    const exclusionReason = getResearchRowExclusionReason(row);
    const rowEvidence = {
      snapshotDate: row.snapshot_date || row.call_date || "",
      assetCode: row.asset_code || assetCode || "",
      timeframe: formatResearchTimeframeLabel(row.timeframe),
      directionKey,
      directionLabel: directionKey ? matrixDirectionLabel(directionKey) : titleCaseWords(normaliseDirection(row.agent_direction || row.predicted_direction || "Unknown")),
      convictionPctValue: confidencePct,
      convictionPct: formatConvictionPercent(confidencePct),
      strengthKey,
      strengthBucket: strengthKey ? matrixStrengthLabel(strengthKey) : "Unknown",
      benchmark: row.benchmark_market || "",
      startPrice: formatBenchmarkPrice(row.open_price),
      endPrice: formatBenchmarkPrice(row.close_price),
      benchmarkMove: formatBenchmarkMove(row.pct_change),
      resultKey: resultRaw,
      result: formatEvaluationResult(resultRaw),
      matrixCell: directionKey && strengthKey
        ? `${matrixDirectionLabel(directionKey)} / ${matrixStrengthLabel(strengthKey)}`
        : "Unmapped",
      matrixCellKey: directionKey && strengthKey ? `${directionKey}__${strengthKey}` : "unmapped",
      predictionId: getResearchRowIdentifier(row),
      predictionIdDisplay: getResearchRowIdentifier(row) ? escapeHtml(String(getResearchRowIdentifier(row))) : displayDash(),
      exclusionReasonKey: exclusionReason,
      exclusionReason: exclusionReason ? titleCaseWords(exclusionReason) : "Included"
    };

    if (exclusionReason) {
      excludedRows.push(rowEvidence);
      return;
    }

    includedRows.push(rowEvidence);
    directionCounts[directionKey] = (directionCounts[directionKey] || 0) + 1;
    strengthCounts[strengthKey] = (strengthCounts[strengthKey] || 0) + 1;
    matrixCellCounts[rowEvidence.matrixCell] = (matrixCellCounts[rowEvidence.matrixCell] || 0) + 1;
    if (resultRaw === "CORRECT") resultCounts.correct += 1;
    if (resultRaw === "WRONG") resultCounts.wrong += 1;
    if (resultRaw === "FLAT") resultCounts.flat += 1;
  });

  includedRows.sort((a, b) => String(b.snapshotDate).localeCompare(String(a.snapshotDate)));
  excludedRows.sort((a, b) => String(b.snapshotDate).localeCompare(String(a.snapshotDate)));

  const totals = computeMatrixTotals(matrixComputation.matrix);
  const evidenceRowsTotal = includedRows.length;
  const matrixTotal = totals.evaluatedCalls;
  const difference = matrixTotal - evidenceRowsTotal;
  const directionalDecisions = resultCounts.correct + resultCounts.wrong;
  const overallAccuracyPct = evidenceRowsTotal ? roundTo((totals.correctCalls / evidenceRowsTotal) * 100, 1) : null;
  const decisionWinRateExFlatPct = directionalDecisions ? roundTo((totals.correctCalls / directionalDecisions) * 100, 1) : null;
  const flatOutcomePct = evidenceRowsTotal ? roundTo((resultCounts.flat / evidenceRowsTotal) * 100, 1) : null;

  return {
    sourceView,
    sourceRowCount: filteredRows.length,
    includedRows,
    excludedRows,
    exclusionCounts: matrixComputation.exclusionCounts || {},
    directionCounts,
    strengthCounts,
    matrixCellCounts,
    resultCounts,
    matrix: matrixComputation.matrix,
    matrixTotal,
    evidenceRowsTotal,
    difference,
    reconciliationPassed: difference === 0,
    totalCorrect: totals.correctCalls,
    totalWrong: resultCounts.wrong,
    totalFlat: resultCounts.flat,
    overallAccuracyPct,
    decisionWinRateExFlatPct,
    flatOutcomePct,
    directionalDecisions
  };
}

function computeMatrixTotals(matrix = {}) {
  let evaluatedCalls = 0;
  let correctCalls = 0;
  let wrongCalls = 0;
  let flatCalls = 0;

  matrixDirectionBuckets.forEach(direction => {
    matrixStrengthBuckets.forEach(strength => {
      const cell = matrix?.[direction.key]?.[strength.key];
      evaluatedCalls += Number(cell?.callCount || 0);
      correctCalls += Number(cell?.accurateCount || 0);
      wrongCalls += Number(cell?.wrongCount || 0);
      flatCalls += Number(cell?.flatCount || 0);
    });
  });

  return { evaluatedCalls, correctCalls, wrongCalls, flatCalls };
}

function computeMatrixSummary(rows = [], options = {}) {
  const assetCode = options.assetCode || "USD";
  const timeframe = options.timeframe || "following 24hrs";
  const directionTotals = {
    bullish: { total: 0, correct: 0, wrong: 0, flat: 0 },
    bearish: { total: 0, correct: 0, wrong: 0, flat: 0 },
    neutral: { total: 0, correct: 0, wrong: 0, flat: 0 }
  };
  const resultTotals = {
    evaluated: 0,
    correct: 0,
    wrong: 0,
    flat: 0
  };

  normaliseResearchRows(rows)
    .filter(row =>
      (!assetCode || row.asset_code === assetCode) &&
      (!timeframe || row.timeframe === timeframe)
    )
    .forEach(row => {
      const directionKey = normalizeResearchMatrixDirection(row.predicted_direction || row.agent_direction);
      const strengthKey = normalizeResearchMatrixStrength(row);
      const result = String(row.combined_result || "").trim().toUpperCase();

      if (!directionKey || !strengthKey) return;
      if (!["CORRECT", "WRONG", "FLAT"].includes(result)) return;

      resultTotals.evaluated += 1;
      if (result === "CORRECT") resultTotals.correct += 1;
      if (result === "WRONG") resultTotals.wrong += 1;
      if (result === "FLAT") resultTotals.flat += 1;

      const bucket = directionTotals[directionKey];
      bucket.total += 1;
      if (result === "WRONG") bucket.wrong += 1;
      if (result === "FLAT") bucket.flat += 1;
      if (result === "CORRECT") {
        bucket.correct += 1;
      }
    });

  return { directionTotals, resultTotals };
}

function formatAccuracyWithCounts(correct, total) {
  const safeCorrect = Number(correct || 0);
  const safeTotal = Number(total || 0);
  const accuracyPct = safeTotal ? roundTo((safeCorrect / safeTotal) * 100, 1) : null;
  return {
    countLine: `${safeCorrect} / ${safeTotal} correct`,
    accuracyLine: metricAvailable(accuracyPct) ? `${formatMatrixAccuracy(accuracyPct)}` : `${displayDash()} accuracy`
  };
}

function formatRateLine(numerator, denominator, label) {
  const safeNumerator = Number(numerator || 0);
  const safeDenominator = Number(denominator || 0);
  if (!safeDenominator) return `${label}: ${displayDash()}`;
  const pct = roundTo((safeNumerator / safeDenominator) * 100, 1);
  return `${label}: ${safeNumerator} / ${safeDenominator} = ${percentValue(pct)}`;
}

function formatCompactRateMetric(numerator, denominator, options = {}) {
  const safeNumerator = Number(numerator || 0);
  const safeDenominator = Number(denominator || 0);
  const numeratorLabel = options.numeratorLabel || null;
  const countSuffix = options.countSuffix || "";

  if (!safeDenominator) {
    return {
      primary: displayDash(),
      secondary: numeratorLabel ? `${safeNumerator} / ${safeDenominator} ${numeratorLabel}`.trim() : `${safeNumerator} / ${safeDenominator}`.trim(),
      detail: options.emptyDetail || "No evaluated rows"
    };
  }

  const pct = roundTo((safeNumerator / safeDenominator) * 100, 1);
  const secondaryBase = numeratorLabel
    ? `${safeNumerator} / ${safeDenominator} ${numeratorLabel}`.trim()
    : `${safeNumerator} / ${safeDenominator}`;

  return {
    primary: percentValue(pct),
    secondary: `${secondaryBase}${countSuffix}`.trim(),
    detail: options.detail || ""
  };
}

function formatMatrixRateBundle(correct, wrong, flat, total) {
  const safeCorrect = Number(correct || 0);
  const safeWrong = Number(wrong || 0);
  const safeFlat = Number(flat || 0);
  const safeTotal = Number(total || 0);
  const exFlatDenominator = safeCorrect + safeWrong;

  return {
    includingFlat: formatRateLine(safeCorrect, safeTotal, "Accuracy Including Flat"),
    exFlat: formatRateLine(safeCorrect, exFlatDenominator, "Decision Win Rate Ex-Flat"),
    flat: formatRateLine(safeFlat, safeTotal, "Flat Outcomes")
  };
}

function buildMatrixSummaryCards(directionTotals = {}, resultTotals = {}) {
  const overallIncludingFlat = formatCompactRateMetric(resultTotals.correct, resultTotals.evaluated, {
    numeratorLabel: "correct"
  });
  const overallExFlat = formatCompactRateMetric(resultTotals.correct, resultTotals.correct + resultTotals.wrong, {
    detail: "(excludes flat)"
  });
  const overallFlat = formatCompactRateMetric(resultTotals.flat, resultTotals.evaluated);

  const buildDirectionCard = (label, totals) => {
    const exFlat = formatCompactRateMetric(totals.correct, totals.correct + totals.wrong, {
      emptyDetail: "Ex-flat: —"
    });
    return renderBacktestKpiMetric(
      label,
      exFlat.primary,
      `${totals.correct} win / ${totals.wrong} loss / ${totals.flat} flat`,
      `Ex-flat: ${exFlat.primary} · Flat: ${totals.flat} / ${totals.total}`
    );
  };

  return `
    ${renderBacktestKpiMetric("Total Evaluated", String(resultTotals.evaluated), "Included matrix rows")}
    ${renderBacktestKpiMetric("Correct", String(resultTotals.correct), "Directional wins")}
    ${renderBacktestKpiMetric("Wrong", String(resultTotals.wrong), "Directional misses")}
    ${renderBacktestKpiMetric("Flat", String(resultTotals.flat), "Flat benchmark outcomes")}
    ${renderBacktestKpiMetric("Accuracy (Incl. Flat)", overallIncludingFlat.primary, overallIncludingFlat.secondary, "Secondary diagnostic only")}
    ${renderBacktestKpiMetric("Decision Win Rate", overallExFlat.primary, overallExFlat.secondary, "Primary directional metric")}
    ${renderBacktestKpiMetric("Flat Outcomes", overallFlat.primary, overallFlat.secondary, "Neutral market outcomes")}
    ${buildDirectionCard("Bullish", directionTotals.bullish)}
    ${buildDirectionCard("Bearish", directionTotals.bearish)}
    ${buildDirectionCard("Neutral", directionTotals.neutral)}
  `;
}

function buildResearchEvidenceRows(rows = [], options = {}) {
  return buildResearchEvidenceAudit(rows, options).includedRows.map(row => ({
    snapshotDate: row.snapshotDate,
    assetCode: row.assetCode,
    timeframe: row.timeframe,
    direction: row.directionLabel,
    convictionPct: row.convictionPct,
    strengthBucket: row.strengthBucket,
    benchmark: row.benchmark,
    startPrice: row.startPrice,
    endPrice: row.endPrice,
    benchmarkMove: row.benchmarkMove,
    result: row.result,
    matrixCell: row.matrixCell,
    predictionId: row.predictionId
  }));
}

function renderResearch24hContext(summary = null) {
  const benchmark = summary?.benchmark_market || "DXY";

  return `
    <article class="detail-panel wide-panel research-matrix-panel">
      <div class="research-matrix-meta">
        <span><strong>Asset:</strong> USD</span>
        <span><strong>Timeframe:</strong> 24H</span>
        <span><strong>Benchmark:</strong> ${escapeHtml(benchmark)}</span>
      </div>
      <p class="research-panel-copy research-matrix-rule">
        <strong>Evaluation rule:</strong> USD bullish is correct when ${escapeHtml(benchmark)} rises over the following 24hrs; USD bearish is correct when ${escapeHtml(benchmark)} falls; flat is a neutral market outcome when ${escapeHtml(benchmark)} remains inside the flat threshold.
      </p>
    </article>
  `;
}

function renderMatrixEvidenceCountItems(counts = {}, orderedLabels = []) {
  const entries = orderedLabels.length
    ? orderedLabels
      .map(([key, label]) => [label, Number(counts[key] || 0)])
      .filter(([, count]) => count > 0)
    : Object.entries(counts)
      .map(([label, count]) => [label, Number(count || 0)])
      .filter(([, count]) => count > 0);

  if (!entries.length) {
    return `<span class="matrix-evidence-count empty">None</span>`;
  }

  return entries
    .map(([label, count]) => `<span class="matrix-evidence-count"><strong>${count}</strong> ${escapeHtml(label)}</span>`)
    .join("");
}

function renderMatrixEvidenceSummaryGrid(audit = {}) {
  const exclusionReasonCounts = Object.fromEntries(
    Object.entries(audit.exclusionCounts || {}).map(([key, count]) => [titleCaseWords(key), count])
  );
  const rateBundle = formatMatrixRateBundle(
    audit.totalCorrect,
    audit.totalWrong,
    audit.totalFlat,
    audit.includedRows?.length || 0
  );

  return `
    <div class="matrix-evidence-summary-grid">
      <div class="matrix-evidence-summary-card">
        <span>Source View</span>
        <strong>${escapeHtml(audit.sourceView || "research_prediction_usd_benchmark_summary")}</strong>
      </div>
      <div class="matrix-evidence-summary-card">
        <span>Total Rows Fetched</span>
        <strong>${audit.sourceRowCount ?? 0}</strong>
      </div>
      <div class="matrix-evidence-summary-card">
        <span>Included In Matrix</span>
        <strong>${audit.includedRows?.length ?? 0}</strong>
      </div>
      <div class="matrix-evidence-summary-card">
        <span>Excluded</span>
        <strong>${audit.excludedRows?.length ?? 0}</strong>
      </div>
      <div class="matrix-evidence-summary-card">
        <span>Total Correct</span>
        <strong>${audit.totalCorrect ?? 0}</strong>
      </div>
      <div class="matrix-evidence-summary-card">
        <span>Total Wrong</span>
        <strong>${audit.totalWrong ?? 0}</strong>
      </div>
      <div class="matrix-evidence-summary-card">
        <span>Total Flat</span>
        <strong>${audit.totalFlat ?? 0}</strong>
      </div>
      <div class="matrix-evidence-summary-card">
        <span>Accuracy Including Flat</span>
        <strong>${metricAvailable(audit.overallAccuracyPct) ? percentValue(audit.overallAccuracyPct) : displayDash()}</strong>
        <small>${rateBundle.includingFlat}</small>
      </div>
      <div class="matrix-evidence-summary-card">
        <span>Decision Win Rate Ex-Flat</span>
        <strong>${metricAvailable(audit.decisionWinRateExFlatPct) ? percentValue(audit.decisionWinRateExFlatPct) : displayDash()}</strong>
        <small>${rateBundle.exFlat}</small>
      </div>
      <div class="matrix-evidence-summary-card">
        <span>Flat Outcomes</span>
        <strong>${metricAvailable(audit.flatOutcomePct) ? percentValue(audit.flatOutcomePct) : displayDash()}</strong>
        <small>${rateBundle.flat}</small>
      </div>
    </div>
    <p class="matrix-evidence-note">Flat outcomes are not counted as wins or losses in the ex-flat decision win rate. They remain visible as a separate bucket because they matter for evaluating whether the call produced tradable directional movement.</p>
    <div class="matrix-evidence-breakdown-grid">
      <div class="matrix-evidence-breakdown-card">
        <span>Exclusion Reasons</span>
        <div class="matrix-evidence-count-list">${renderMatrixEvidenceCountItems(exclusionReasonCounts)}</div>
      </div>
      <div class="matrix-evidence-breakdown-card">
        <span>Counts By Direction</span>
        <div class="matrix-evidence-count-list">${renderMatrixEvidenceCountItems(audit.directionCounts, [
          ["bullish", "Bullish"],
          ["bearish", "Bearish"],
          ["neutral", "Neutral / Flat"]
        ])}</div>
      </div>
      <div class="matrix-evidence-breakdown-card">
        <span>Counts By Strength Bucket</span>
        <div class="matrix-evidence-count-list">${renderMatrixEvidenceCountItems(audit.strengthCounts, matrixStrengthBuckets.map(bucket => [bucket.key, bucket.label]))}</div>
      </div>
      <div class="matrix-evidence-breakdown-card matrix-evidence-breakdown-card-wide">
        <span>Counts By Matrix Cell</span>
        <div class="matrix-evidence-count-list">${renderMatrixEvidenceCountItems(audit.matrixCellCounts)}</div>
      </div>
    </div>
  `;
}

function renderMatrixEvidenceRows(rows = [], kind = "included") {
  if (!rows.length) {
    return `<div class="empty-state matrix-evidence-empty">${kind === "excluded" ? "No excluded rows for this matrix." : "No evidence rows available for this matrix."}</div>`;
  }

  return `
    <div class="matrix-evidence-table-scroll">
      <table class="dashboard-table research-evidence-table matrix-evidence-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Asset</th>
            <th>Timeframe</th>
            <th>Direction</th>
            <th>Conviction %</th>
            <th>Strength Bucket</th>
            <th>Benchmark</th>
            <th>Benchmark Start</th>
            <th>Benchmark End</th>
            <th>Benchmark Move</th>
            <th>Evaluation Result</th>
            <th>Matrix Cell</th>
            <th>Prediction / Research ID</th>
            ${kind === "excluded" ? "<th>Exclusion Reason</th>" : ""}
          </tr>
        </thead>
        <tbody>
          ${rows.map(row => `
            <tr data-evidence-result="${escapeHtml((row.resultKey || "").toLowerCase())}" data-evidence-direction="${escapeHtml(row.directionKey || "")}" data-evidence-strength="${escapeHtml(row.strengthKey || "")}">
              <td>${formatFallbackCell(row.snapshotDate)}</td>
              <td>${formatFallbackCell(row.assetCode)}</td>
              <td>${formatFallbackCell(row.timeframe)}</td>
              <td>${formatFallbackCell(row.directionLabel)}</td>
              <td>${row.convictionPct || displayDash()}</td>
              <td>${formatFallbackCell(row.strengthBucket)}</td>
              <td>${formatFallbackCell(row.benchmark)}</td>
              <td>${row.startPrice || displayDash()}</td>
              <td>${row.endPrice || displayDash()}</td>
              <td>${row.benchmarkMove || displayDash()}</td>
              <td>${formatFallbackCell(row.result)}</td>
              <td>${formatFallbackCell(row.matrixCell)}</td>
              <td>${row.predictionIdDisplay || displayDash()}</td>
              ${kind === "excluded" ? `<td>${formatFallbackCell(row.exclusionReason)}</td>` : ""}
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderMatrixEvidenceAccordion(rows = [], options = {}) {
  const audit = buildResearchEvidenceAudit(rows, options);
  const filterButtons = [
    { key: "all", label: "All" },
    { key: "correct", label: "Correct" },
    { key: "wrong", label: "Wrong" },
    { key: "flat", label: "Flat" },
    { key: "bullish", label: "Bullish" },
    { key: "bearish", label: "Bearish" },
    { key: "weak", label: "Weak" },
    { key: "moderate", label: "Moderate" },
    { key: "strong", label: "Strong" },
    { key: "very_strong", label: "Very Strong" }
  ];

  return `
    <details class="matrix-evidence-accordion">
      <summary>Show rows behind this matrix</summary>
      <div class="matrix-evidence-body">
        <div class="matrix-evidence-reconciliation ${audit.reconciliationPassed ? "pass" : "fail"}">
          <div class="matrix-evidence-reconciliation-grid">
            <div><span>Matrix Total</span><strong>${audit.matrixTotal}</strong></div>
            <div><span>Evidence Rows Total</span><strong>${audit.evidenceRowsTotal}</strong></div>
            <div><span>Difference</span><strong>${audit.difference}</strong></div>
            <div><span>Reconciliation</span><strong>${audit.reconciliationPassed ? "PASS" : "FAIL"}</strong></div>
          </div>
        </div>
        ${renderMatrixEvidenceSummaryGrid(audit)}
        <div class="matrix-evidence-toolbar">
          <div class="matrix-evidence-filter-group" role="group" aria-label="Matrix evidence filters">
            ${filterButtons.map(button => `
              <button class="matrix-evidence-filter-button${button.key === "all" ? " active" : ""}" type="button" data-matrix-evidence-filter="${button.key}">
                ${escapeHtml(button.label)}
              </button>
            `).join("")}
          </div>
          <button class="matrix-evidence-export-button" type="button" data-export-matrix-evidence="usd-24h">Export Matrix Evidence CSV</button>
        </div>
        <div class="matrix-evidence-table-wrap">
          ${renderMatrixEvidenceRows(audit.includedRows, "included")}
        </div>
        ${audit.excludedRows.length ? `
          <div class="matrix-evidence-excluded-block">
            <p class="research-panel-copy">Excluded rows were fetched from the same source view but did not qualify for the matrix. They are listed here with the exclusion reason for auditability.</p>
            ${renderMatrixEvidenceRows(audit.excludedRows, "excluded")}
          </div>
        ` : ""}
      </div>
    </details>
  `;
}

function renderResearchEvidenceAudit(rows = [], totals = {}, sourceView = "research_prediction_usd_benchmark_summary") {
  const evidenceRows = buildResearchEvidenceRows(rows, {
    assetCode: "USD",
    timeframe: "following 24hrs"
  });
  const shownRows = evidenceRows.slice(0, 10);

  return `
    <section class="research-section">
      <div class="research-section-head">
        <div>
          <p class="eyebrow">Backtest Data Checker</p>
          <h3>Recent evaluated 24H rows</h3>
        </div>
        <p class="research-panel-copy">These are real benchmark evaluation rows from the research layer. They prove the dated calls that feed the 24H matrix buckets.</p>
      </div>
      ${renderResearchBreakdownTable("Backtest Data Checker", "Evidence Audit", shownRows, [
        { label: "Date", render: row => researchDataCell(row.snapshotDate || "Unknown") },
        { label: "Asset", render: row => researchDataCell(row.assetCode) },
        { label: "Timeframe", render: row => researchDataCell(row.timeframe) },
        { label: "Direction", render: row => researchDataCell(row.direction) },
        { label: "Conviction %", render: row => researchDataCell(row.convictionPct) },
        { label: "Strength Bucket", render: row => researchDataCell(row.strengthBucket) },
        { label: "Benchmark", render: row => researchDataCell(row.benchmark) },
        { label: "Start", render: row => researchDataCell(row.startPrice) },
        { label: "End", render: row => researchDataCell(row.endPrice) },
        { label: "Move", render: row => researchDataCell(row.benchmarkMove) },
        { label: "Result", render: row => researchDataCell(row.result) },
        { label: "Matrix Cell", render: row => researchDataCell(row.matrixCell) }
      ], {
        description: "Latest evaluated USD following-24hrs rows only. Conviction % is the original recorded confidence score. Matrix Cell uses the same direction and strength mapping as the table above.",
        panelClass: "research-evidence-panel",
        tableClass: "research-evidence-table"
      })}
      <article class="detail-panel research-secondary-panel">
        <p class="research-audit-line">
          <strong>Matrix evaluated calls:</strong> ${totals.evaluatedCalls ?? 0}
          <span>Evidence rows shown: latest ${shownRows.length} of ${evidenceRows.length}</span>
          <span>Source view: ${escapeHtml(sourceView)}</span>
        </p>
      </article>
    </section>
  `;
}

function renderResearch24hEvidenceSummary(summary = null, data = {}) {
  const overall = data.accuracy?.overall || null;
  const infrastructure = data.infrastructure || {};
  const replayCoverage = infrastructure.replay_coverage || "Not yet available";
  const evaluatedRows = metricAvailable(summary?.evaluated_calls)
    ? String(summary.evaluated_calls)
    : (metricAvailable(overall?.evaluated_predictions) ? String(overall.evaluated_predictions) : "Not yet available");

  return `
    <section class="research-section">
      <div class="research-section-head">
        <div>
          <p class="eyebrow">Supporting Evidence</p>
          <h3>24H benchmark context</h3>
        </div>
        <p class="research-panel-copy">The matrix is the headline view. These supporting cards show the current replay scope and the record behind the 24H result. Incl-flat accuracy is secondary context; ex-flat win rate is the main directional read.</p>
      </div>
      <section class="backtest-metric-grid research-summary-grid">
        ${summary
          ? renderBacktestMetric("Overall 24H Accuracy (Incl. Flat)", percentValue(summary.overall_accuracy_pct), "Secondary diagnostic only; directional read should use ex-flat win rate")
          : renderUnavailableMetric("Overall 24H Accuracy (Incl. Flat)", "Waiting for populated research views")}
        ${renderBacktestMetric("Replay Coverage", replayCoverage, "Current warehouse-backed USD replay window")}
        ${renderBacktestMetric("Rows Evaluated", evaluatedRows, "CORRECT, WRONG, or FLAT rows used in 24H benchmark totals")}
        ${summary
          ? renderBacktestMetric("Wins / Losses / Flats", `${summary.wins ?? "--"} / ${summary.losses ?? "--"} / ${summary.flats ?? "--"}`, "Benchmark record behind the 24H matrix")
          : renderUnavailableMetric("Wins / Losses / Flats", "Waiting for populated research views")}
      </section>
    </section>
  `;
}

function checkerStatusBadge(status = "") {
  const normalized = String(status || "").trim().toUpperCase();
  const tone = normalized === "PASS"
    ? "pass"
    : normalized === "TOLERANCE_PASS"
      ? "tolerance"
      : normalized === "FAIL"
        ? "fail"
        : "missing";
  const label = normalized === "TOLERANCE_PASS"
    ? "Tolerance Pass"
    : normalized === "MISSING_DATA"
      ? "Missing Data"
      : (normalized || "Unknown");
  return `<span class="checker-status-badge ${tone}">${escapeHtml(label)}</span>`;
}

function formatCheckerValue(value) {
  if (value === null || value === undefined || value === "") return displayDash();
  if (typeof value === "number") {
    return Number.isInteger(value) ? String(value) : String(roundTo(value, 3));
  }
  return escapeHtml(String(value));
}

function formatCheckerDifference(value) {
  if (value === null || value === undefined || value === "") return displayDash();
  if (typeof value === "number") {
    const rounded = roundTo(value, 3);
    return `${rounded > 0 ? "+" : ""}${rounded}`;
  }
  return escapeHtml(String(value));
}

function displayDash() {
  return "—";
}

function checkerRowItems(row = {}) {
  return [
    ...(Array.isArray(row.differences) ? row.differences : []),
    ...(Array.isArray(row.factor_comparisons)
      ? row.factor_comparisons.flatMap(item => [item.signal, item.weight].filter(Boolean))
      : [])
  ];
}

function checkerMismatchCount(row = {}) {
  return checkerRowItems(row).filter(item => {
    const status = String(item?.status || "").trim().toUpperCase();
    return status && status !== "PASS";
  }).length;
}

function checkerRowTone(status = "") {
  const normalized = String(status || "").trim().toUpperCase();
  if (normalized === "FAIL") return "fail";
  if (normalized === "TOLERANCE_PASS") return "tolerance";
  if (normalized === "MISSING_DATA") return "missing";
  return "pass";
}

function renderCheckerWorkspaceHeader(checker = {}, summary = {}) {
  return `
    <section class="research-section">
      <article class="detail-panel wide-panel research-secondary-panel checker-workspace-panel">
        <div class="checker-workspace-copy">
          <p class="eyebrow">Backtest Checker</p>
          <h3>Backtest Checker Workspace</h3>
          <p class="checker-status-line">Deterministic replay validation</p>
        </div>
      </article>
    </section>
  `;
}

function checkerFilenameFromPath(value = "") {
  const text = String(value || "").trim();
  if (!text) return "Unknown";
  const parts = text.split(/[\\/]/);
  return parts[parts.length - 1] || text;
}

function checkerScopeLabelLegacy(checker = {}) {
  const asset = checker?.meta?.asset || "USD";
  const timeframe = checker?.meta?.timeframe === "following 24hrs" ? "24H" : (checker?.meta?.timeframe || "24H");
  const dateRange = checker?.meta?.date_range || {};

  if (dateRange.start === "2024-01-01" && dateRange.end === "2024-01-31") {
    return `${asset} • ${timeframe} • 2024-01-02 to 2026-04-30`;
  }

  return `${asset} • ${timeframe}`;
}

function checkerScopeLabel(checker = {}) {
  const asset = checker?.meta?.asset || "USD";
  const timeframe = checker?.meta?.timeframe === "following 24hrs" ? "24H" : (checker?.meta?.timeframe || "24H");
  const dateRange = checker?.meta?.date_range || {};

  if (dateRange.start === "2024-01-01" && dateRange.end === "2024-01-31") {
    return `${asset} ${timeframe} 2024-01-02 to 2026-04-30`;
  }

  return `${asset} ${timeframe}`;
}

function checkerComparedFieldsLabel(fieldsCompared = []) {
  const fieldMap = {
    direction: "direction",
    headline_confidence_pct: "headline_confidence_pct",
    strength_bucket: "strength_bucket",
    bull_case_pct: "bull_case_pct",
    bear_case_pct: "bear_case_pct",
    net_edge_pct: "net_edge_pct",
    participation_pct: "participation_pct",
    active_directional_weight: "active_directional_weight",
    bull_weighted_total: "bull_weighted_total",
    bear_weighted_total: "bear_weighted_total",
    factor_scores: "factor_scores",
    evaluation_result: "evaluation"
  };

  const labels = [];
  for (const field of fieldsCompared) {
    const mapped = fieldMap[field] ?? field;
    if (mapped && !labels.includes(mapped)) {
      labels.push(mapped);
    }
  }

  return labels.join(", ") || "None listed";
}

function renderCheckerSummaryCard(label, value, detail = "", options = {}) {
  const tone = options.tone ? ` ${options.tone}` : "";
  const wide = options.wide ? " wide" : "";
  const compactValue = options.compactValue ? " compact-value" : "";
  const tooltip = options.tooltip ? ` title="${escapeHtml(options.tooltip)}"` : "";
  return `
    <article class="checker-summary-card${tone}${wide}${compactValue}"${tooltip}>
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      ${detail ? `<small>${escapeHtml(detail)}</small>` : ""}
    </article>
  `;
}

function renderCheckerSummaryBlock(checker = {}, summary = {}, fieldsCompared = []) {
  return `
    <article class="detail-panel wide-panel research-secondary-panel checker-summary-panel">
      <div class="checker-summary-card-grid">
        ${renderCheckerSummaryCard("Rows Checked", String(summary.rows_checked ?? 0))}
        ${renderCheckerSummaryCard("Pass", String(summary.pass ?? 0), "", { tone: "pass" })}
        ${renderCheckerSummaryCard("Tolerance Pass", String(summary.tolerance_pass ?? 0), "", { tone: "tolerance" })}
        ${renderCheckerSummaryCard("Fail", String(summary.fail ?? 0), "", { tone: "fail" })}
        ${renderCheckerSummaryCard("Missing Data", String(summary.missing_data ?? 0), "", { tone: "missing" })}
        ${renderCheckerSummaryCard("Scope", checkerScopeLabel(checker))}
        ${renderCheckerSummaryCard("Generated", formatDashboardTime(checker.meta?.generated_at))}
        ${renderCheckerSummaryCard("Replay Core", checkerFilenameFromPath(checker.meta?.replay_logic_source), "", {
          tooltip: checker.meta?.replay_logic_source || ""
        })}
        ${renderCheckerSummaryCard("Evaluator", checkerFilenameFromPath(checker.meta?.evaluation_logic_source), "", {
          tooltip: checker.meta?.evaluation_logic_source || ""
        })}
        ${renderCheckerSummaryCard("Compared Fields", checkerComparedFieldsLabel(fieldsCompared), "", {
          wide: true,
          compactValue: true
        })}
      </div>
    </article>
  `;
}

function renderCheckerTriageTable(checker = null, selectedRowId = null) {
  const rows = checker?.rows || [];
  if (!rows.length) {
    return "";
  }

  return `
    <section class="research-section">
      <div class="research-section-head">
        <div>
          <p class="eyebrow">Triage Queue</p>
          <h3>Row-level mismatch triage</h3>
        </div>
        <p class="research-panel-copy">Scan every checked replay row before drilling into field-level or factor-level detail. Non-pass rows are intentionally louder than pass rows.</p>
      </div>
      <article class="detail-panel wide-panel research-secondary-panel checker-triage-panel">
        <div class="table-scroll checker-table-scroll">
          <table class="dashboard-table research-evidence-table checker-comparison-table checker-triage-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Status</th>
                <th>Stored Direction</th>
                <th>Checker Direction</th>
                <th>Evaluation Result</th>
                <th>Mismatch Count</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map(row => {
                const isSelected = row.prediction_id === selectedRowId;
                const tone = checkerRowTone(row.status);
                return `
                  <tr class="checker-triage-row ${tone}${isSelected ? " selected" : ""}" data-checker-row-id="${escapeHtml(row.prediction_id || "")}">
                    <td>${formatFallbackCell(row.snapshot_date)}</td>
                    <td>${checkerStatusBadge(row.status)}</td>
                    <td>${formatFallbackCell(row.stored?.direction)}</td>
                    <td>${formatFallbackCell(row.checker?.direction)}</td>
                    <td>${formatFallbackCell(row.stored?.evaluation_result || row.checker?.evaluation_result)}</td>
                    <td><strong class="checker-mismatch-count">${escapeHtml(String(checkerMismatchCount(row)))}</strong></td>
                  </tr>
                `;
              }).join("")}
            </tbody>
          </table>
        </div>
      </article>
    </section>
  `;
}

function renderCheckerComparisonTable(comparisons = []) {
  if (!comparisons.length) {
    return `<div class="empty-state matrix-evidence-empty">No checker comparisons available.</div>`;
  }

  return `
    <div class="table-scroll checker-table-scroll">
      <table class="dashboard-table research-evidence-table checker-comparison-table">
        <thead>
          <tr>
            <th>Field</th>
            <th>Stored Output</th>
            <th>Checker Re-run Output</th>
            <th>Difference</th>
            <th>PASS / FAIL</th>
          </tr>
        </thead>
        <tbody>
          ${comparisons.map(item => `
            <tr>
              <td>${escapeHtml(item.label || item.key || "Field")}</td>
              <td>${formatCheckerValue(item.stored)}</td>
              <td>${formatCheckerValue(item.rerun)}</td>
              <td>${formatCheckerDifference(item.difference)}</td>
              <td>${checkerStatusBadge(item.status)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function checkerDetailComparisons(row = {}) {
  const comparisons = Array.isArray(row.differences) ? row.differences : [];
  return comparisons.map((item) => {
    if (item?.label !== "Headline Confidence %") {
      return item;
    }

    return {
      ...item,
      stored: row?.stored?.headline_confidence_pct ?? null,
      rerun: row?.checker?.headline_confidence_pct ?? null
    };
  });
}

function renderCheckerFactorTable(factorComparisons = []) {
  if (!factorComparisons.length) {
    return "";
  }

  return `
    <div class="table-scroll checker-table-scroll">
      <table class="dashboard-table research-evidence-table checker-comparison-table">
        <thead>
          <tr>
            <th>Factor</th>
            <th>Stored Signal</th>
            <th>Checker Signal</th>
            <th>Signal Status</th>
            <th>Stored Weight</th>
            <th>Checker Weight</th>
            <th>Weight Diff</th>
            <th>PASS / FAIL</th>
          </tr>
        </thead>
        <tbody>
          ${factorComparisons.map(item => `
            <tr>
              <td>${escapeHtml(item.factor_key || "Factor")}</td>
              <td>${formatCheckerValue(item.signal?.stored)}</td>
              <td>${formatCheckerValue(item.signal?.rerun)}</td>
              <td>${checkerStatusBadge(item.signal?.status || "MISSING_DATA")}</td>
              <td>${formatCheckerValue(item.weight?.stored)}</td>
              <td>${formatCheckerValue(item.weight?.rerun)}</td>
              <td>${formatCheckerDifference(item.weight?.difference)}</td>
              <td>${checkerStatusBadge(item.status || "MISSING_DATA")}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderCheckerRowDetailLegacy(checker = null) {
  const rows = checker?.rows || [];
  if (!rows.length) {
    return `
      <article class="detail-panel wide-panel research-secondary-panel">
        <div class="empty-state matrix-evidence-empty">No checker rows available for USD 24H 2024-01-02 to 2026-04-30.</div>
      </article>
    `;
  }

  const selectedId = activeCheckerRowId && rows.some(row => row.prediction_id === activeCheckerRowId)
    ? activeCheckerRowId
    : (checker.selected_row_id || rows[0].prediction_id);
  const selectedRow = rows.find(row => row.prediction_id === selectedId) || rows[0];
  activeCheckerRowId = selectedRow.prediction_id;

  const options = rows.map(row => `
    <option value="${escapeHtml(row.prediction_id)}"${row.prediction_id === selectedRow.prediction_id ? " selected" : ""}>
      ${escapeHtml(`${row.snapshot_date} • ${row.status}`)}
    </option>
  `).join("");

  return `
    <section class="research-section">
      <div class="research-section-head">
        <div>
          <p class="eyebrow">Checker Detail</p>
          <h3>Stored vs checker re-run output</h3>
        </div>
        <p class="research-panel-copy">This panel independently re-runs the USD replay from the historical snapshot, then compares it against the stored 24H backtester output and stored DXY evaluation row.</p>
      </div>
      <article class="detail-panel wide-panel research-secondary-panel checker-detail-panel">
        <div class="checker-toolbar">
          <label class="checker-select-label" for="checkerRowSelect">Selected row</label>
          <select id="checkerRowSelect" class="checker-row-select" data-checker-row-select>
            ${options}
          </select>
          ${checkerStatusBadge(selectedRow.status)}
        </div>
        <p class="research-audit-line">
          <span><strong>Date:</strong> ${escapeHtml(selectedRow.snapshot_date || "Unknown")}</span>
          <span><strong>Prediction ID:</strong> ${escapeHtml(selectedRow.prediction_id || "Unknown")}</span>
          <span><strong>Timeframe:</strong> ${escapeHtml(selectedRow.timeframe || "following 24hrs")}</span>
          <span><strong>Evaluation Close:</strong> ${escapeHtml(String(selectedRow.evaluation_inputs?.close_date || displayDash()))}</span>
        </p>
        ${renderCheckerComparisonTable(selectedRow.differences || [])}
        ${renderCheckerFactorTable(selectedRow.factor_comparisons || [])}
      </article>
    </section>
  `;
}

function renderResearchDataCheckerLegacy(data = {}) {
  const checker = data.checker || null;
  const summary = checker?.summary || null;
  const fieldsCompared = checker?.fields_compared || [];

  if (!checker || !summary) {
    return `
      <div class="backtest-report">
        <article class="detail-panel wide-panel research-secondary-panel">
          <p class="eyebrow">Backtest Data Checker</p>
          <h3>Checker data unavailable</h3>
          <div class="empty-state matrix-evidence-empty">The generated checker artifact could not be loaded for this tab.</div>
        </article>
      </div>
    `;
  }

  return `
    <div class="backtest-report">
      <section class="research-section">
        <div class="research-section-head">
          <div>
            <p class="eyebrow">Backtest Data Checker</p>
            <h3>Independent replay reproducibility check</h3>
          </div>
          <p class="research-panel-copy">Phase 1 checker scope is USD only and 24H only, with current validation coverage from 2024-01-02 to 2026-04-30. It loads stored replay rows, re-runs the same USD replay core from the historical snapshot, and compares stored vs checker output with exact and tolerance rules. Current result: 604 checked / 604 pass / 0 tolerance / 0 fail / 0 missing.</p>
        </div>
        <section class="backtest-metric-grid research-summary-grid checker-summary-grid">
          ${renderBacktestKpiMetric("Rows Checked", String(summary.rows_checked ?? 0), "USD 24H 2024-01-02 to 2026-04-30")}
          ${renderBacktestKpiMetric("Pass", String(summary.pass ?? 0), "Exact matches")}
          ${renderBacktestKpiMetric("Tolerance Pass", String(summary.tolerance_pass ?? 0), `±${checker.meta?.tolerance_percentage_points ?? 0.5}pp numeric tolerance`)}
          ${renderBacktestKpiMetric("Fail", String(summary.fail ?? 0), "Mismatch requires investigation")}
          ${renderBacktestKpiMetric("Missing Data", String(summary.missing_data ?? 0), "Snapshot or evaluation missing")}
        </section>
        <article class="detail-panel wide-panel research-secondary-panel checker-meta-panel">
          <p class="research-audit-line">
            <span><strong>Generated:</strong> ${escapeHtml(formatDashboardTime(checker.meta?.generated_at))}</span>
            <span><strong>Replay Core:</strong> ${escapeHtml(checker.meta?.replay_logic_source || "Unknown")}</span>
            <span><strong>Evaluator:</strong> ${escapeHtml(checker.meta?.evaluation_logic_source || "Unknown")}</span>
          </p>
          <p class="research-panel-copy">Compared fields: ${escapeHtml(fieldsCompared.join(", "))}.</p>
        </article>
      </section>
      ${renderCheckerRowDetail(checker)}
    </div>
  `;
}

function renderCheckerRowDetail(checker = null) {
  const rows = checker?.rows || [];
  if (!rows.length) {
    return `
      <article class="detail-panel wide-panel research-secondary-panel">
        <div class="empty-state matrix-evidence-empty">No checker rows available for USD 24H 2024-01-02 to 2026-04-30.</div>
      </article>
    `;
  }

  const selectedId = activeCheckerRowId && rows.some(row => row.prediction_id === activeCheckerRowId)
    ? activeCheckerRowId
    : (checker.selected_row_id || rows[0].prediction_id);
  const selectedRow = rows.find(row => row.prediction_id === selectedId) || rows[0];
  activeCheckerRowId = selectedRow.prediction_id;

  const options = rows.map(row => `
    <option value="${escapeHtml(row.prediction_id)}"${row.prediction_id === selectedRow.prediction_id ? " selected" : ""}>
      ${escapeHtml(`${row.snapshot_date} - ${row.status}`)}
    </option>
  `).join("");

  return `
    <section class="research-section">
      <div class="research-section-head">
        <div>
          <p class="eyebrow">Checker Detail</p>
          <h3>Stored vs checker re-run output</h3>
        </div>
        <p class="research-panel-copy">This panel independently re-runs the USD replay from the historical snapshot, then compares it against the stored 24H backtester output and stored DXY evaluation row.</p>
      </div>
      <article class="detail-panel wide-panel research-secondary-panel checker-detail-panel">
        <div class="checker-toolbar">
          <label class="checker-select-label" for="checkerRowSelect">Selected row</label>
          <select id="checkerRowSelect" class="checker-row-select" data-checker-row-select>
            ${options}
          </select>
          ${checkerStatusBadge(selectedRow.status)}
        </div>
        <p class="research-audit-line">
          <span><strong>Date:</strong> ${escapeHtml(selectedRow.snapshot_date || "Unknown")}</span>
          <span><strong>Prediction ID:</strong> ${escapeHtml(selectedRow.prediction_id || "Unknown")}</span>
          <span><strong>Timeframe:</strong> ${escapeHtml(selectedRow.timeframe || "following 24hrs")}</span>
          <span><strong>Evaluation Open:</strong> ${formatCheckerValue(selectedRow.evaluation_inputs?.open_price)}</span>
          <span><strong>Evaluation Close:</strong> ${formatCheckerValue(selectedRow.evaluation_inputs?.close_price)}</span>
          <span><strong>Evaluation Close Date:</strong> ${escapeHtml(String(selectedRow.evaluation_inputs?.close_date || displayDash()))}</span>
          <span><strong>Mismatch Count:</strong> ${escapeHtml(String(checkerMismatchCount(selectedRow)))}</span>
        </p>
        ${renderCheckerComparisonTable(checkerDetailComparisons(selectedRow))}
        ${renderCheckerFactorTable(selectedRow.factor_comparisons || [])}
      </article>
    </section>
  `;
}

function renderResearchDataChecker(data = {}) {
  const checker = data.checker || null;
  const summary = checker?.summary || null;
  const fieldsCompared = checker?.fields_compared || [];

  if (!checker || !summary) {
    return `
      <div class="backtest-report">
        <article class="detail-panel wide-panel research-secondary-panel">
          <p class="eyebrow">Backtest Data Checker</p>
          <h3>Checker data unavailable</h3>
          <div class="empty-state matrix-evidence-empty">The generated checker artifact could not be loaded for this tab.</div>
        </article>
      </div>
    `;
  }

  const selectedRowId = activeCheckerRowId && checker.rows.some(row => row.prediction_id === activeCheckerRowId)
    ? activeCheckerRowId
    : (checker.selected_row_id || checker.rows?.[0]?.prediction_id);

  return `
    <div class="backtest-report">
      ${renderCheckerWorkspaceHeader(checker, summary)}
      <section class="research-section">
        ${renderCheckerSummaryBlock(checker, summary, fieldsCompared)}
      </section>
      ${renderCheckerTriageTable(checker, selectedRowId)}
      ${renderCheckerRowDetail(checker)}
    </div>
  `;
}

function renderMatrixSummary(rows = [], options = {}) {
  const { directionTotals, resultTotals } = computeMatrixSummary(rows, options);
  return `
    <section class="research-section">
      <div class="research-section-head">
        <div>
          <p class="eyebrow">Matrix Summary</p>
          <h3>24H totals derived from the matrix rows</h3>
        </div>
        <p class="research-panel-copy">Compact totals from the same evaluated USD 24H matrix rows above. Flat outcomes remain separate from directional wins and losses, so ex-flat win rate is the primary directional read.</p>
      </div>
      <section class="backtest-metric-grid research-summary-grid matrix-summary-grid matrix-summary-grid-compact">
        ${buildMatrixSummaryCards(directionTotals, resultTotals)}
      </section>
    </section>
  `;
}

function renderResearchDefinitions() {
  return `
    <section class="research-section">
      <div class="research-section-head">
        <div>
          <p class="eyebrow">Research Notes</p>
          <h3>Definitions and strength mapping</h3>
        </div>
        <p class="research-panel-copy">Conviction and strength are related but not interchangeable. This matrix keeps each prediction's stored headline confidence %, then groups rows using the same live dashboard confidence-band thresholds the production UI uses.</p>
      </div>
      <article class="detail-panel wide-panel research-secondary-panel research-notes-panel">
        <div class="research-definition-list">
          <div class="research-definition-item">
            <strong>Conviction %</strong>
            <p>The model's original headline confidence score for that prediction.</p>
          </div>
          <div class="research-definition-item">
            <strong>Strength Bucket</strong>
            <p>The grouping derived from the same live dashboard confidence % thresholds used for production call strength labels. Historical accuracy is measured using those live-style bands, not legacy replay-only strength labels.</p>
          </div>
        </div>
        <div class="research-threshold-list">
          ${matrixStrengthBuckets.map(bucket => `
            <div class="research-threshold-item">
              <strong>${escapeHtml(bucket.label)}</strong>
              <span>${escapeHtml(bucket.rangeLabel)}</span>
              <p>${escapeHtml(bucket.definition)}</p>
            </div>
          `).join("")}
        </div>
        <ul class="read-only-list">
          <li>Each historical prediction retains its original conviction percentage.</li>
          <li>The prediction is then grouped into the appropriate live confidence strength bucket for historical accuracy analysis.</li>
          <li>The matrix uses the same headline confidence-band logic as the live dashboard call labels.</li>
          <li>Flat is a neutral benchmark outcome, not a directional win or loss.</li>
          <li>Ex-flat win rate is the main directional accuracy metric. Incl-flat accuracy is secondary diagnostic context only.</li>
          <li>If many rows cluster at 50%, that indicates the replay engine may still be using a legacy confidence floor and should be checked in the Backtester Checker.</li>
          <li>NOT_EVALUABLE, MIXED, NO_CALL, and unsupported strength labels do not create fake matrix accuracy.</li>
          <li>Infrastructure details remain available in the separate Infrastructure Status tab.</li>
        </ul>
      </article>
    </section>
  `;
}

function renderResearch24hAccuracyMatrix(rows = [], options = {}) {
  const assetLabel = options.assetLabel || "USD";
  const timeframeLabel = options.timeframeLabel || "24H";
  const {
    matrix,
    sourceRowCount,
    usableRowCount,
    excludedRowCount,
    mostCommonExclusionReason
  } = computeResearchMatrix(rows, options);

  const showWarning = !sourceRowCount || !usableRowCount;
  const hasDiagnostic = sourceRowCount > 0;
  const exclusionReasonText = mostCommonExclusionReason === "none"
    ? "none"
    : titleCaseWords(mostCommonExclusionReason);

  return `
    <section class="research-section">
      <div class="research-section-head">
        <div>
          <p class="eyebrow">24H Accuracy Matrix</p>
          <h3>${escapeHtml(assetLabel)} ${escapeHtml(timeframeLabel)} direction by strength</h3>
        </div>
        <p class="research-panel-copy">Each historical prediction retains its original conviction percentage, then the matrix groups it using the same headline confidence-band thresholds as the live dashboard so each row is judged the way a live-style agent output would be displayed. Each cell uses live research rows only and shows directional wins/losses separately from flat neutral outcomes.</p>
      </div>
      <article class="detail-panel wide-panel research-matrix-panel">
        <div class="research-matrix-meta">
          <span><strong>Asset:</strong> ${escapeHtml(assetLabel)}</span>
          <span><strong>Timeframe:</strong> ${escapeHtml(timeframeLabel)}</span>
        </div>
        <div class="research-table-scroll research-matrix-scroll">
          <table class="dashboard-table research-matrix-table">
            <thead>
              <tr>
                <th>Direction</th>
                ${matrixStrengthBuckets.map(strength => `
                  <th>
                    <div class="research-matrix-heading">
                      <strong>${escapeHtml(strength.label)}</strong>
                      <span>${escapeHtml(strength.rangeLabel)}</span>
                    </div>
                  </th>
                `).join("")}
              </tr>
            </thead>
            <tbody>
              ${matrixDirectionBuckets.map(direction => `
                <tr>
                  <th>${escapeHtml(direction.label)}</th>
                  ${matrixStrengthBuckets.map(strength => {
                    const cell = matrix[direction.key][strength.key];
                    const tone = matrixCellTone(cell.callCount, cell.exFlatAccuracyPct);
                    return `
                      <td>
                        <div class="research-matrix-cell ${tone}">
                          <strong>${cell.callCount} calls</strong>
                          <span>${cell.accurateCount} win / ${cell.wrongCount} loss / ${cell.flatCount} flat</span>
                          <span>${formatMatrixAccuracy(cell.exFlatAccuracyPct)}</span>
                          <span>${metricAvailable(cell.flatRatePct) ? `${percentValue(cell.flatRatePct)} flat` : `${displayDash()} flat`}</span>
                        </div>
                      </td>
                    `;
                  }).join("")}
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
        ${showWarning ? `<p class="research-matrix-warning">No evaluated 24H USD benchmark rows available from research view.</p>` : ""}
        ${hasDiagnostic ? `
          <p class="research-matrix-diagnostic">
            Fetched research rows: ${sourceRowCount}
            <span>&bull;</span>
            Rows included in matrix: ${usableRowCount}
            <span>&bull;</span>
            Rows excluded: ${excludedRowCount}
            <span>&bull;</span>
            Most common exclusion reason: ${escapeHtml(exclusionReasonText)}
          </p>
        ` : ""}
        <p class="research-matrix-note">Empty buckets stay empty. No mock accuracy is shown when the live research layer has no evaluated calls for that bucket.</p>
      </article>
      ${renderMatrixEvidenceAccordion(rows, {
        assetCode: options.assetCode,
        timeframe: options.timeframe,
        sourceView: options.sourceView || "research_prediction_usd_benchmark_summary"
      })}
    </section>
  `;
}

function renderResearchVerdictQuality(data = {}) {
  const byVerdictStrength = data.accuracy?.by_verdict_strength || [];
  const byConfidenceBucket = data.accuracy?.by_confidence_bucket || [];
  const strength24h = byVerdictStrength.filter(row => row.timeframe === "following 24hrs");
  const strengthRows = strength24h.length ? strength24h : byVerdictStrength;
  const confidence24h = byConfidenceBucket.filter(row => row.timeframe === "following 24hrs");
  const confidenceRows = confidence24h.length ? confidence24h : byConfidenceBucket;

  return `
    <section class="research-section">
      <div class="research-section-head">
        <div>
          <p class="eyebrow">Verdict Quality</p>
          <h3>Accuracy by Signal Strength</h3>
        </div>
        <p class="research-panel-copy">Overall accuracy answers: "Was the model directionally right?" Strength accuracy qualifies that headline by answering: "Were stronger verdicts actually more reliable?" Direction, confidence, and strength are one verdict-quality system, not separate side metrics.</p>
      </div>
      <section class="backtest-grid research-regime-grid">
        ${renderResearchBreakdownTable("Accuracy by Signal Strength", "Verdict Quality", strengthRows, [
          { label: "Strength", render: row => researchDataCell(row.verdict_strength, `${row.benchmark_market} • ${row.timeframe}`) },
          { label: "Evaluated", render: row => researchDataCell(row.evaluated_calls, `${row.wins} wins / ${row.losses} losses`) },
          { label: "Win Rate", render: row => researchDataCell(percentValue(row.win_rate_pct), `${row.flats} flat`) },
          { label: "Avg Confidence", render: row => researchDataCell(percentValue(row.avg_predicted_confidence), metricAvailable(row.avg_abs_move_pct) ? `${row.avg_abs_move_pct}% abs move` : "Abs move n/a") }
        ], {
          description: "DXY-only benchmark rows. Low overall accuracy does not automatically mean the agent is unusable if high-confidence or VERY_STRONG calls are materially more accurate. Conversely, high overall accuracy is less useful if high-confidence calls are not better than weak calls."
        })}
      </section>
    </section>

    <section class="research-section">
      <div class="research-section-head">
        <div>
          <p class="eyebrow">Verdict Quality</p>
          <h3>Confidence Calibration</h3>
        </div>
        <p class="research-panel-copy">Confidence calibration qualifies headline accuracy by answering: "Did the confidence % match realised accuracy?" This 24H-priority view tests whether higher-confidence calls were actually more reliable, and whether the model was overconfident or underconfident by confidence band.</p>
      </div>
      <section class="backtest-grid research-regime-grid">
        ${renderResearchBreakdownTable("Confidence Calibration", "Verdict Quality", confidenceRows, [
          { label: "Confidence", render: row => researchDataCell(row.confidence_bucket, `${row.benchmark_market} • ${row.timeframe}`) },
          { label: "Evaluated", render: row => researchDataCell(row.evaluated_calls, `${row.wins} wins / ${row.losses} losses`) },
          { label: "Predicted", render: row => researchDataCell(percentValue(row.avg_predicted_confidence), `${row.flats} flat`) },
          { label: "Actual", render: row => researchDataCell(percentValue(row.actual_win_rate_pct), metricAvailable(row.calibration_gap_pct) ? `${row.calibration_gap_pct > 0 ? "+" : ""}${row.calibration_gap_pct}% gap` : "Gap n/a") }
        ], {
          description: "Positive calibration gap means the bucket outperformed its average predicted confidence. Negative gap means the model was overconfident. Confidence is useful only if higher predicted confidence is matched by higher realised accuracy."
        })}
      </section>
    </section>
  `;
}

function renderResearchTradeQuality(data = {}) {
  const tradeQuality = data.accuracy?.trade_quality || [];
  const tradeQuality24h = tradeQuality.filter(row => row.timeframe === "following 24hrs");
  const tradeQualityRows = tradeQuality24h.length ? tradeQuality24h : tradeQuality;

  return `
    <section class="research-section">
      <div class="research-section-head">
        <div>
          <p class="eyebrow">Trade Quality</p>
          <h3>Which subsets may have been worth taking</h3>
        </div>
        <p class="research-panel-copy">Overall accuracy treats every prediction equally. Trade Quality asks what would have happened if only higher-confidence or stronger verdicts were considered tradeable.</p>
      </div>
      <section class="backtest-grid research-regime-grid">
        ${renderResearchBreakdownTable("Trade Quality", "Filtered Thresholds", tradeQualityRows, [
          { label: "Threshold", render: row => researchDataCell(row.threshold_label, `${row.benchmark_market} • ${row.timeframe}`) },
          { label: "Coverage", render: row => researchDataCell(percentValue(row.coverage_pct), `${row.tradeable_predictions} of ${row.total_available_predictions}`) },
          { label: "Evaluated", render: row => researchDataCell(row.evaluated_calls, `${row.wins} wins / ${row.losses} losses`) },
          { label: "Win Rate", render: row => researchDataCell(percentValue(row.win_rate_pct), `${row.flats} flat`) },
          { label: "Avg Confidence", render: row => researchDataCell(percentValue(row.avg_predicted_confidence), metricAvailable(row.avg_abs_move_pct) ? `${row.avg_abs_move_pct}% abs move` : "Abs move n/a") }
        ], {
          description: "A lower overall win rate may still hide high-quality tradeable subsets. A high threshold with strong accuracy but tiny coverage means rare edge. A broad threshold with weaker accuracy may not be useful as a trade filter."
        })}
      </section>
    </section>
  `;
}

function renderResearchAccuracy(data = {}) {
  const summary24h = data.accuracy?.summary_24h || null;
  const matrix24hRows = data.accuracy?.matrix_24h_rows || [];
  const { matrix } = computeResearchMatrix(matrix24hRows, {
    assetCode: "USD",
    timeframe: "following 24hrs"
  });
  const totals = computeMatrixTotals(matrix);

  if (data.meta?.error) {
    return `
      <article class="detail-panel wide-panel research-matrix-panel">
        <p class="eyebrow">Backtest / Accuracy</p>
        <h3>Research view unavailable</h3>
        <div class="empty-state research-matrix-empty">The research layer could not be loaded for this tab.</div>
      </article>
    `;
  }

  return `
    <div class="backtest-report">
      ${renderResearchStatusHeader(data)}
      ${renderResearch24hContext(summary24h)}
      ${renderResearch24hAccuracyMatrix(matrix24hRows, {
        assetCode: "USD",
        assetLabel: "USD",
        timeframe: "following 24hrs",
        timeframeLabel: "24H",
        sourceView: "research_prediction_usd_benchmark_summary"
      })}
      ${renderMatrixSummary(matrix24hRows, {
        assetCode: "USD",
        timeframe: "following 24hrs"
      })}
      ${renderResearchDefinitions()}
    </div>
  `;
}

function renderResearchInfrastructure(data = {}) {
  const infrastructure = data.infrastructure || {};

  return `
    <article class="detail-panel wide-panel explanation-card">
      <p class="eyebrow">Infrastructure Status</p>
      <h3>USD historical research pipeline state</h3>
      <p>The dashboard reads infrastructure state from research SQL views only. This section is downstream-only and cannot feed back into live Layer 1 outputs.</p>
    </article>

    <section class="backtest-metric-grid research-progress-grid">
      ${renderBacktestMetric("Historical Warehouse", infrastructure.historical_warehouse_status || "Not yet available", "Historical source tables populated")}
      ${renderBacktestMetric("Snapshot Builder", infrastructure.snapshot_builder_status || "Not yet available", "Historical USD market snapshots available")}
      ${renderBacktestMetric("Replay Engine", infrastructure.replay_engine_status || "Not yet available", "Research observations and predictions written")}
      ${renderBacktestMetric("Outcome Evaluation", infrastructure.outcome_evaluation_status || "Not yet available", "Predictions evaluated against realised outcomes")}
      ${renderBacktestMetric("Research SQL", infrastructure.research_sql_status || "Not yet available", "Dashboard reads research views only")}
      ${renderBacktestMetric("Last Replay Date", formatDateValue(infrastructure.last_replay_date), "Most recent replayed snapshot date")}
      ${renderBacktestMetric("Replay Coverage", infrastructure.replay_coverage || "Not yet available", "Full currently available USD replay range")}
      ${renderBacktestMetric("Observations", String(infrastructure.observation_count ?? "Not yet available"), "Research observations written")}
      ${renderBacktestMetric("Predictions", String(infrastructure.prediction_count ?? "Not yet available"), "Research timeframe predictions written")}
      ${renderBacktestMetric("Evaluation Rows", String(infrastructure.evaluation_row_count ?? "Not yet available"), "Prediction evaluation rows written")}
    </section>
  `;
}

function renderBacktest(data = {}) {
  const updated = document.getElementById("backtestUpdated");
  if (updated) {
    const marker = data.meta?.error
      ? `Research data unavailable: ${data.meta.error}`
      : `Last synced: ${formatDashboardTime(data.meta?.last_updated)}`;
    updated.textContent = marker;
  }

  const panel = document.getElementById("backtestPanel");
  if (!panel) return;
  try {
    panel.innerHTML = activeBacktestTab === "infrastructure"
      ? renderResearchInfrastructure(data)
      : (activeBacktestTab === "checker" ? renderResearchDataChecker(data) : renderResearchAccuracy(data));
    applyMatrixEvidenceFilter("all");
  } catch (err) {
    console.error("Backtest render failed", err);
    panel.innerHTML = `
      <article class="detail-panel wide-panel research-matrix-panel">
        <p class="eyebrow">Backtest / Accuracy</p>
        <h3>Research view unavailable</h3>
        <div class="empty-state research-matrix-empty">The Backtest / Accuracy panel could not render cleanly. Reload the page or inspect the research layer response.</div>
      </article>
    `;
  }
}

function applyMatrixEvidenceFilter(filterKey = "all") {
  const panel = document.getElementById("backtestPanel");
  if (!panel) return;

  const normalizedFilter = String(filterKey || "all").trim().toLowerCase();
  panel.querySelectorAll("[data-matrix-evidence-filter]").forEach(button => {
    button.classList.toggle("active", button.dataset.matrixEvidenceFilter === normalizedFilter);
  });

  panel.querySelectorAll(".matrix-evidence-table-wrap tbody tr").forEach(row => {
    const result = String(row.dataset.evidenceResult || "").toLowerCase();
    const direction = String(row.dataset.evidenceDirection || "").toLowerCase();
    const strength = String(row.dataset.evidenceStrength || "").toLowerCase();
    const matches = normalizedFilter === "all"
      || result === normalizedFilter
      || direction === normalizedFilter
      || strength === normalizedFilter;
    row.hidden = !matches;
  });
}

function escapeCsvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  const escaped = text.replace(/"/g, "\"\"");
  return /[",\n]/.test(escaped) ? `"${escaped}"` : escaped;
}

function exportMatrixEvidenceCsv() {
  const matrix24hRows = backtestData?.accuracy?.matrix_24h_rows || [];
  const audit = buildResearchEvidenceAudit(matrix24hRows, {
    assetCode: "USD",
    timeframe: "following 24hrs",
    sourceView: "research_prediction_usd_benchmark_summary"
  });

  if (!audit.includedRows.length) {
    console.warn("No matrix evidence rows available to export");
    return;
  }

  const headers = [
    "Date",
    "Asset",
    "Timeframe",
    "Direction",
    "Conviction %",
    "Strength Bucket",
    "Benchmark",
    "Benchmark Start",
    "Benchmark End",
    "Benchmark Move",
    "Evaluation Result",
    "Matrix Cell",
    "Prediction / Research ID"
  ];
  const lines = [
    headers.join(","),
    ...audit.includedRows.map(row => [
      row.snapshotDate || "",
      row.assetCode || "",
      row.timeframe || "",
      row.directionLabel || "",
      row.convictionPctValue ?? "",
      row.strengthBucket || "",
      row.benchmark || "",
      row.startPrice === displayDash() ? "" : row.startPrice,
      row.endPrice === displayDash() ? "" : row.endPrice,
      row.benchmarkMove === displayDash() ? "" : row.benchmarkMove,
      row.result || "",
      row.matrixCell || "",
      row.predictionId || ""
    ].map(escapeCsvCell).join(","))
  ];

  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "usd-24h-matrix-evidence.csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
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
  const availableTabs = getAvailableTopLevelTabs();
  const fallbackTab = availableTabs.includes("overview") ? "overview" : (availableTabs[0] || "overview");
  activeTab = availableTabs.includes(tab) ? tab : fallbackTab;
  saveNavigationState();

  document.querySelectorAll(".tab-button").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.tab === activeTab);
  });

  const overviewView = document.getElementById("overviewView");
  const layer2View = document.getElementById("layer2View");
  const backtestView = document.getElementById("backtestView");
  const agentView = document.getElementById("agentView");

  if (overviewView) overviewView.classList.toggle("active-view", activeTab === "overview");
  if (layer2View) layer2View.classList.toggle("active-view", activeTab === "layer2");
  if (backtestView) backtestView.classList.toggle("active-view", activeTab === "backtest");
  if (agentView) agentView.classList.toggle("active-view", orderedAgents.includes(activeTab));

  if (orderedAgents.includes(activeTab)) renderAgentDetail(activeTab);
  if (activeTab === "backtest") renderBacktest(backtestData || {});
}

function setBacktestTab(tab, options = {}) {
  const availableTabs = getAvailableBacktestTabs();
  const fallbackTab = availableTabs.includes("accuracy") ? "accuracy" : (availableTabs[0] || "accuracy");
  activeBacktestTab = availableTabs.includes(tab) ? tab : fallbackTab;

  document.querySelectorAll(".subtab-button").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.backtestTab === activeBacktestTab);
  });

  saveNavigationState();

  if (!options.skipRender) {
    renderBacktest(backtestData || {});
  }
}

function setupTabs() {
  document.querySelectorAll(".tab-button").forEach(btn => {
    btn.addEventListener("click", () => setTab(btn.dataset.tab));
  });

  document.querySelectorAll(".subtab-button").forEach(btn => {
    btn.addEventListener("click", () => setBacktestTab(btn.dataset.backtestTab || "accuracy"));
  });
}

function setupBacktestEvidenceControls() {
  const panel = document.getElementById("backtestPanel");
  if (!panel) return;

  panel.addEventListener("click", event => {
    const checkerRow = event.target.closest("[data-checker-row-id]");
    if (checkerRow) {
      activeCheckerRowId = checkerRow.dataset.checkerRowId || null;
      renderBacktest(backtestData || {});
      return;
    }

    const filterButton = event.target.closest("[data-matrix-evidence-filter]");
    if (filterButton) {
      applyMatrixEvidenceFilter(filterButton.dataset.matrixEvidenceFilter || "all");
      return;
    }

    const exportButton = event.target.closest("[data-export-matrix-evidence]");
    if (exportButton) {
      exportMatrixEvidenceCsv();
    }
  });

  panel.addEventListener("change", event => {
    const checkerSelect = event.target.closest("[data-checker-row-select]");
    if (checkerSelect) {
      activeCheckerRowId = checkerSelect.value || null;
      renderBacktest(backtestData || {});
    }
  });
}

async function fetchLocalJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`${url} ${response.status}`);
  }
  return response.json();
}

async function fetchResearchView(viewName, options = {}) {
  const url = new URL(`${researchSupabaseUrl}/${viewName}`);
  url.searchParams.set("select", options.select || "*");

  if (options.order) url.searchParams.set("order", options.order);
  if (metricAvailable(options.limit)) url.searchParams.set("limit", String(options.limit));
  if (options.filters) {
    Object.entries(options.filters).forEach(([field, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(field, value);
      }
    });
  }

  const response = await fetch(url.toString(), {
    cache: "no-store",
    headers: {
      apikey: researchSupabaseKey,
      Authorization: `Bearer ${researchSupabaseKey}`
    }
  });

  if (!response.ok) {
    throw new Error(`${viewName} ${response.status}`);
  }

  return response.json();
}

async function fetchResearchDashboardData() {
  const matrix24hRowsPromise = fetchResearchView("research_prediction_usd_benchmark_summary", {
    select: "snapshot_date,asset_code,timeframe,predicted_direction,agent_direction,agent_conviction,predicted_conviction,headline_confidence_pct,bull_case_pct,bear_case_pct,net_edge_pct,participation_pct,verdict_strength,combined_result,benchmark_market,open_price,close_price,pct_change",
    order: "timeframe.asc,predicted_direction.asc,verdict_strength.asc",
    filters: {
      timeframe: "eq.following 24hrs"
    }
  }).catch(err => {
    console.warn("Could not load 24H benchmark matrix rows", err);
    return [];
  });
  const checkerDataPromise = fetchLocalJson(checkerDataUrl).catch(err => {
    console.warn("Could not load backtester checker data", err);
    return null;
  });

  const [
    overallRows,
    summary24hRows,
    matrix24hRows,
    verdictStrengthRows,
    confidenceBucketRows,
    tradeQualityRows,
    timeframeRows,
    convictionRows,
    weekdayRows,
    magnitudeRows,
    regimeRows,
    factorReliabilityRows,
    factorContributionRows,
    factorComboRows,
    infrastructureRows,
    checkerData
  ] = await Promise.all([
    fetchResearchView("research_overall_win_rate"),
    fetchResearchView("research_usd_24h_direction_accuracy"),
    matrix24hRowsPromise,
    fetchResearchView("research_accuracy_by_verdict_strength", { order: "timeframe.asc,strength_rank.asc" }),
    fetchResearchView("research_accuracy_by_confidence_bucket", { order: "timeframe.asc,confidence_bucket_rank.asc" }),
    fetchResearchView("research_trade_quality_thresholds", { order: "timeframe.asc,threshold_rank.asc" }),
    fetchResearchView("research_win_rate_by_timeframe", { order: "timeframe.asc" }),
    fetchResearchView("research_win_rate_by_conviction_bucket"),
    fetchResearchView("research_win_rate_by_weekday"),
    fetchResearchView("research_win_rate_by_magnitude_bucket"),
    fetchResearchView("research_win_rate_by_market_regime"),
    fetchResearchView("research_factor_reliability", {
      order: "win_rate_pct.desc,factor_occurrences.desc,avg_factor_weight.desc",
      limit: 8
    }),
    fetchResearchView("research_factor_contribution", {
      order: "weighted_contribution_score.desc,contribution_score.desc,factor_occurrences.desc",
      limit: 8
    }),
    fetchResearchView("research_best_factor_combinations", {
      order: "win_rate_pct.desc,combo_occurrences.desc,avg_combined_weight.desc",
      limit: 8
    }),
    fetchResearchView("research_dashboard_infrastructure_status"),
    checkerDataPromise
  ]);

  return {
    meta: {
      last_updated: new Date().toISOString(),
      source: "supabase_research_views",
      read_only: true
    },
    accuracy: {
      overall: overallRows[0] || null,
      summary_24h: summary24hRows[0] || null,
      matrix_24h_rows: matrix24hRows,
      by_verdict_strength: verdictStrengthRows,
      by_confidence_bucket: confidenceBucketRows,
      trade_quality: tradeQualityRows,
      by_timeframe: timeframeRows,
      by_conviction_bucket: convictionRows,
      by_weekday: weekdayRows,
      by_magnitude_bucket: magnitudeRows,
      by_market_regime: regimeRows,
      top_factor_reliability: factorReliabilityRows,
      top_factor_contribution: factorContributionRows,
      best_factor_combinations: factorComboRows
    },
    infrastructure: infrastructureRows[0] || {},
    checker: checkerData
  };
}

async function loadDashboard() {
  const [layer1Result, layer2Result, researchResult] = await Promise.allSettled([
    fetch(layer1Url, { cache: "no-store" }),
    fetch(layer2Url, { cache: "no-store" }),
    fetchResearchDashboardData()
  ]);

  try {
    if (layer1Result.status === "fulfilled") {
      layer1Data = normaliseLayer1Data(await layer1Result.value.json());
      renderLayer1(layer1Data);
    } else {
      throw layer1Result.reason;
    }

    if (layer2Result.status === "fulfilled") {
      layer2Data = await layer2Result.value.json();
      renderLayer2(layer2Data);
    } else {
      throw layer2Result.reason;
    }
  } catch (err) {
    console.error(err);
    const grid = document.getElementById("layer1Grid");
    if (grid) {
      grid.innerHTML = `<p class="warning">Could not load dashboard JSON.</p>`;
    }
  }

  if (researchResult.status === "fulfilled") {
    backtestData = researchResult.value;
  } else {
    console.error(researchResult.reason);
    backtestData = {
      meta: {
        last_updated: new Date().toISOString(),
        error: researchResult.reason?.message || String(researchResult.reason)
      },
      accuracy: {},
      infrastructure: {}
    };
  }

  renderBacktest(backtestData);

  if (orderedAgents.includes(activeTab) && layer1Data) {
    renderAgentDetail(activeTab);
  }
}

setupTabs();
setupBacktestEvidenceControls();
restoreNavigationState();
setBacktestTab(activeBacktestTab, { skipRender: true });
setTab(activeTab);
setupWorkflowControls();
initMarketGlobe();
updateClock();
setInterval(updateClock, 1000);

loadWorkflowControl().then(loadWorkflowStatus);
loadDashboard();
setInterval(loadDashboard, 60000);
setInterval(loadWorkflowStatus, 60000);
