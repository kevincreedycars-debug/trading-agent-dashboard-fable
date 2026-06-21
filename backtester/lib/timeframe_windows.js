const PHASE1_TIMEFRAME_MAP = Object.freeze({
  following_24hrs: "following 24hrs",
  "following 24hrs": "following 24hrs",
  following24hrs: "following 24hrs",
  "3d_from_call": "3d from call",
  "3d from call": "3d from call",
  current_week: "current week",
  "current week": "current week",
  current_month: "current month",
  "current month": "current month"
});

const WEEKDAY_NAMES = Object.freeze([
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday"
]);

function normalizePhase1Timeframe(timeframe) {
  const key = String(timeframe || "").trim();
  const normalized = PHASE1_TIMEFRAME_MAP[key];
  if (!normalized) {
    throw new Error(`Unsupported Phase 1 timeframe: ${timeframe}`);
  }
  return normalized;
}

function assertDateLiteral(value, label) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${label} must be YYYY-MM-DD. Received: ${value}`);
  }
}

function assertTimeLiteral(value, label) {
  if (!/^\d{2}:\d{2}(:\d{2})?$/.test(value)) {
    throw new Error(`${label} must be HH:MM or HH:MM:SS. Received: ${value}`);
  }
}

function parseDateParts(dateLiteral) {
  assertDateLiteral(dateLiteral, "dateLiteral");
  const [year, month, day] = dateLiteral.split("-").map(Number);
  return { year, month, day };
}

function buildUtcDateFromNyParts(dateLiteral, timeLiteral) {
  assertTimeLiteral(timeLiteral, "timeLiteral");
  const { year, month, day } = parseDateParts(dateLiteral);
  const [hours, minutes, seconds = "00"] = timeLiteral.split(":");

  const middayUtc = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  const offsetMinutes = getNyOffsetMinutesForDate(middayUtc);
  const utcMillis = Date.UTC(
    year,
    month - 1,
    day,
    Number(hours),
    Number(minutes),
    Number(seconds),
    0
  ) - (offsetMinutes * 60 * 1000);

  return new Date(utcMillis);
}

function formatLocalEt(dateLiteral, timeLiteral) {
  const normalizedTime = String(timeLiteral).length === 5
    ? `${timeLiteral}:00`
    : String(timeLiteral);
  return `${dateLiteral}T${normalizedTime}`;
}

function nthWeekdayOfMonthUtc(year, monthIndexZeroBased, weekday, occurrence) {
  const date = new Date(Date.UTC(year, monthIndexZeroBased, 1, 12, 0, 0));
  const firstDay = date.getUTCDay();
  const delta = (weekday - firstDay + 7) % 7;
  return 1 + delta + ((occurrence - 1) * 7);
}

function getNyOffsetMinutesForDate(utcDate) {
  const year = utcDate.getUTCFullYear();
  const dstStartDay = nthWeekdayOfMonthUtc(year, 2, 0, 2);
  const dstEndDay = nthWeekdayOfMonthUtc(year, 10, 0, 1);

  const dstStartUtc = Date.UTC(year, 2, dstStartDay, 7, 0, 0);
  const dstEndUtc = Date.UTC(year, 10, dstEndDay, 6, 0, 0);
  const instant = utcDate.getTime();

  return instant >= dstStartUtc && instant < dstEndUtc ? -240 : -300;
}

function shiftDate(dateLiteral, days) {
  const date = new Date(`${dateLiteral}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function getDayOfWeek(dateLiteral) {
  const date = new Date(`${dateLiteral}T00:00:00Z`);
  return WEEKDAY_NAMES[date.getUTCDay()];
}

function isValidTradingSessionDay(dateLiteral) {
  const day = getDayOfWeek(dateLiteral);
  return day !== "Saturday" && day !== "Sunday";
}

function nextValidTradingSessionDay(dateLiteral, steps = 1) {
  let current = dateLiteral;
  let remaining = steps;

  while (remaining > 0) {
    current = shiftDate(current, 1);
    if (isValidTradingSessionDay(current)) {
      remaining -= 1;
    }
  }

  return current;
}

function finalTradingSessionDayOfMonth(dateLiteral) {
  const { year, month } = parseDateParts(dateLiteral);
  const firstOfNextMonth = month === 12
    ? `${year + 1}-01-01`
    : `${year}-${String(month + 1).padStart(2, "0")}-01`;

  let candidate = shiftDate(firstOfNextMonth, -1);
  while (!isValidTradingSessionDay(candidate)) {
    candidate = shiftDate(candidate, -1);
  }
  return candidate;
}

function fridayOfWeek(dateLiteral) {
  let candidate = dateLiteral;
  while (getDayOfWeek(candidate) !== "Friday") {
    candidate = shiftDate(candidate, 1);
  }
  return candidate;
}

function compareEtLocalTimes(dateLiteral, timeLiteral, comparisonDateLiteral, comparisonTimeLiteral) {
  const left = `${dateLiteral}T${String(timeLiteral).slice(0, 5)}`;
  const right = `${comparisonDateLiteral}T${String(comparisonTimeLiteral).slice(0, 5)}`;
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function buildWindow(dateLiteral, openDate, closeDate, callTimeLiteral, timeframe) {
  const openTimeLiteral = "09:30:00";
  const closeTimeLiteral = "16:00:00";
  const callDayOfWeek = getDayOfWeek(dateLiteral);

  if (!isValidTradingSessionDay(dateLiteral)) {
    return {
      evaluable: false,
      timeframe,
      call_date: dateLiteral,
      call_day_of_week: callDayOfWeek,
      call_time_et_local: formatLocalEt(dateLiteral, callTimeLiteral),
      open_time_et_local: null,
      close_time_et_local: null,
      call_time_et: buildUtcDateFromNyParts(dateLiteral, callTimeLiteral).toISOString(),
      open_time_et: null,
      close_time_et: null,
      not_evaluable_reason: "call_date_not_valid_trading_session_day"
    };
  }

  const callVsClose = compareEtLocalTimes(dateLiteral, callTimeLiteral, closeDate, closeTimeLiteral);
  if (callVsClose >= 0) {
    return {
      evaluable: false,
      timeframe,
      call_date: dateLiteral,
      call_day_of_week: callDayOfWeek,
      call_time_et_local: formatLocalEt(dateLiteral, callTimeLiteral),
      open_time_et_local: formatLocalEt(openDate, openTimeLiteral),
      close_time_et_local: formatLocalEt(closeDate, closeTimeLiteral),
      call_time_et: buildUtcDateFromNyParts(dateLiteral, callTimeLiteral).toISOString(),
      open_time_et: buildUtcDateFromNyParts(openDate, openTimeLiteral).toISOString(),
      close_time_et: buildUtcDateFromNyParts(closeDate, closeTimeLiteral).toISOString(),
      not_evaluable_reason: "call_after_or_at_evaluation_close"
    };
  }

  return {
    evaluable: true,
    timeframe,
    call_date: dateLiteral,
    call_day_of_week: callDayOfWeek,
    call_time_et_local: formatLocalEt(dateLiteral, callTimeLiteral),
    open_time_et_local: formatLocalEt(openDate, openTimeLiteral),
    close_time_et_local: formatLocalEt(closeDate, closeTimeLiteral),
    call_time_et: buildUtcDateFromNyParts(dateLiteral, callTimeLiteral).toISOString(),
    open_time_et: buildUtcDateFromNyParts(openDate, openTimeLiteral).toISOString(),
    close_time_et: buildUtcDateFromNyParts(closeDate, closeTimeLiteral).toISOString(),
    not_evaluable_reason: null
  };
}

function addHoursEt(dateLiteral, timeLiteral, hoursToAdd) {
  const baseUtc = buildUtcDateFromNyParts(dateLiteral, timeLiteral);
  const targetUtc = new Date(baseUtc.getTime() + (hoursToAdd * 60 * 60 * 1000));
  return utcToEtParts(targetUtc);
}

function utcToEtParts(utcDate) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });

  const parts = Object.fromEntries(
    formatter.formatToParts(utcDate).filter((part) => part.type !== "literal").map((part) => [part.type, part.value])
  );

  const dateLiteral = `${parts.year}-${parts.month}-${parts.day}`;
  const timeLiteral = `${parts.hour}:${parts.minute}:${parts.second}`;

  return {
    dateLiteral,
    timeLiteral,
    isoLocal: formatLocalEt(dateLiteral, timeLiteral),
    isoUtc: utcDate.toISOString()
  };
}

function endOfCryptoWeek(callDate) {
  let candidate = callDate;
  while (getDayOfWeek(candidate) !== "Sunday") {
    candidate = shiftDate(candidate, 1);
  }
  return candidate;
}

function endOfCalendarMonth(dateLiteral) {
  const { year, month } = parseDateParts(dateLiteral);
  const firstOfNextMonth = month === 12
    ? `${year + 1}-01-01`
    : `${year}-${String(month + 1).padStart(2, "0")}-01`;
  return shiftDate(firstOfNextMonth, -1);
}

function buildCryptoWindow(callDate, callTimeEt, closeDate, closeTimeEt, timeframe) {
  const callUtc = buildUtcDateFromNyParts(callDate, callTimeEt);
  const closeUtc = buildUtcDateFromNyParts(closeDate, closeTimeEt);
  const callDayOfWeek = getDayOfWeek(callDate);

  if (callUtc.getTime() >= closeUtc.getTime()) {
    return {
      evaluable: false,
      timeframe,
      call_date: callDate,
      call_day_of_week: callDayOfWeek,
      call_time_et_local: formatLocalEt(callDate, callTimeEt),
      open_time_et_local: formatLocalEt(callDate, callTimeEt),
      close_time_et_local: formatLocalEt(closeDate, closeTimeEt),
      call_time_et: callUtc.toISOString(),
      open_time_et: callUtc.toISOString(),
      close_time_et: closeUtc.toISOString(),
      not_evaluable_reason: "call_after_or_at_evaluation_close"
    };
  }

  return {
    evaluable: true,
    timeframe,
    call_date: callDate,
    call_day_of_week: callDayOfWeek,
    call_time_et_local: formatLocalEt(callDate, callTimeEt),
    open_time_et_local: formatLocalEt(callDate, callTimeEt),
    close_time_et_local: formatLocalEt(closeDate, closeTimeEt),
    call_time_et: callUtc.toISOString(),
    open_time_et: callUtc.toISOString(),
    close_time_et: closeUtc.toISOString(),
    not_evaluable_reason: null
  };
}

function getPhase1OutcomeWindow({ assetCode = null, timeframe, callDate, callTimeEt = "09:30:00" }) {
  assertDateLiteral(callDate, "callDate");
  assertTimeLiteral(callTimeEt, "callTimeEt");
  const normalizedTimeframe = normalizePhase1Timeframe(timeframe);
  const normalizedAsset = String(assetCode || "").trim().toUpperCase();

  if (normalizedAsset === "BTC") {
    if (normalizedTimeframe === "following 24hrs") {
      const close = addHoursEt(callDate, callTimeEt, 24);
      return buildCryptoWindow(callDate, callTimeEt, close.dateLiteral, close.timeLiteral, normalizedTimeframe);
    }

    if (normalizedTimeframe === "3d from call") {
      const close = addHoursEt(callDate, callTimeEt, 72);
      return buildCryptoWindow(callDate, callTimeEt, close.dateLiteral, close.timeLiteral, normalizedTimeframe);
    }

    if (normalizedTimeframe === "current week") {
      return buildCryptoWindow(callDate, callTimeEt, endOfCryptoWeek(callDate), "23:59:59", normalizedTimeframe);
    }

    if (normalizedTimeframe === "current month") {
      return buildCryptoWindow(callDate, callTimeEt, endOfCalendarMonth(callDate), "23:59:59", normalizedTimeframe);
    }
  }

  if (normalizedTimeframe === "following 24hrs") {
    return buildWindow(
      callDate,
      callDate,
      nextValidTradingSessionDay(callDate, 1),
      callTimeEt,
      normalizedTimeframe
    );
  }

  if (normalizedTimeframe === "3d from call") {
    return buildWindow(
      callDate,
      callDate,
      nextValidTradingSessionDay(callDate, 3),
      callTimeEt,
      normalizedTimeframe
    );
  }

  if (normalizedTimeframe === "current week") {
    return buildWindow(
      callDate,
      callDate,
      fridayOfWeek(callDate),
      callTimeEt,
      normalizedTimeframe
    );
  }

  if (normalizedTimeframe === "current month") {
    return buildWindow(
      callDate,
      callDate,
      finalTradingSessionDayOfMonth(callDate),
      callTimeEt,
      normalizedTimeframe
    );
  }

  throw new Error(`Unhandled Phase 1 timeframe: ${timeframe}`);
}

module.exports = {
  PHASE1_TIMEFRAME_MAP,
  buildUtcDateFromNyParts,
  endOfCalendarMonth,
  endOfCryptoWeek,
  finalTradingSessionDayOfMonth,
  formatLocalEt,
  fridayOfWeek,
  getDayOfWeek,
  getPhase1OutcomeWindow,
  isValidTradingSessionDay,
  nextValidTradingSessionDay,
  normalizePhase1Timeframe,
  shiftDate
};
