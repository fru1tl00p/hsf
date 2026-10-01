// src/lib/rtsw.ts
var MAG_URL = "https://services.swpc.noaa.gov/json/rtsw/rtsw_mag_1m.json";
var WIND_URL = "https://services.swpc.noaa.gov/json/rtsw/rtsw_wind_1m.json";
var SPIKE_DENSITY = 10;
var BZ_DEADBAND = 0.5;
var SENTINEL = 9999;
var L1_DEBUG = true;
function l1Log(message, detail) {
  if (!L1_DEBUG) return;
  if (detail === void 0) console.log("[L1]", message);
  else console.log("[L1]", message, detail);
}
var MAX_GAP_MS = 3 * 60 * 1e3;
var BIN_MS = 30 * 60 * 1e3;
function parseMag(payload) {
  return parseRows(rowsOf(payload, "mag"), (row) => {
    const r = row;
    const t = timeOf(r.time_tag);
    if (t == null) return "drop";
    const bt = readValue(r.bt);
    const bz = readValue(r.bz_gsm);
    const filled = bt.filled || bz.filled;
    return { point: { t, bt: bt.n, bz: bz.n, filled }, filled };
  });
}
function parseWind(payload) {
  return parseRows(rowsOf(payload, "plasma"), (row) => {
    const r = row;
    const t = timeOf(r.time_tag);
    if (t == null) return "drop";
    const speed = readValue(r.proton_speed);
    const density = readValue(r.proton_density);
    const filled = speed.filled || density.filled;
    return { point: { t, speed: speed.n, density: density.n, filled }, filled };
  });
}
function ingest(magPayload, windPayload, fetchedAt) {
  return { fetchedAt, mag: parseMag(magPayload), wind: parseWind(windPayload) };
}
function latestMag(points) {
  return points.length ? points[points.length - 1] : null;
}
function latestWind(points) {
  return points.length ? points[points.length - 1] : null;
}
function dataEnd(pull) {
  const m = latestMag(pull.mag.points)?.t ?? null;
  const w = latestWind(pull.wind.points)?.t ?? null;
  if (m == null) return w;
  if (w == null) return m;
  return Math.max(m, w);
}
function ageMinutes(sample, now) {
  return Math.max(0, Math.round((now - sample) / 6e4));
}
function auditLines(pull) {
  const lines = [`fetch ok     ${stamp(pull.fetchedAt)}`];
  lines.push(seriesLine("mag", pull.mag, latestMag(pull.mag.points)?.t ?? null));
  for (const p of pull.mag.points.slice(-3).reverse()) {
    lines.push(
      `             ${clock(p.t)}  Bt ${p.bt.toFixed(2)}  Bz ${p.bz.toFixed(2)}${p.filled ? "  FILLED" : ""}`
    );
  }
  lines.push(seriesLine("plasma", pull.wind, latestWind(pull.wind.points)?.t ?? null));
  for (const p of pull.wind.points.slice(-3).reverse()) {
    lines.push(
      `             ${clock(p.t)}  speed ${p.speed.toFixed(1)}  dens ${p.density.toFixed(2)}${p.filled ? "  FILLED" : ""}`
    );
  }
  return lines;
}
function shareText(pull, note, now, part) {
  const end = dataEnd(pull);
  const lines = ["Space weather share", `Generated: ${stamp(pull.fetchedAt)}`];
  lines.push(sourceLine(pull, now));
  const trimmed = note.trim();
  if (trimmed) lines.push(`Note: ${trimmed}`);
  lines.push("", "Now");
  const wind = latestWind(pull.wind.points);
  const mag = latestMag(pull.mag.points);
  lines.push(wind ? `speed    ${Math.round(wind.speed)} km/s` : "speed    missing");
  lines.push(wind ? `density  ${fmtDens(wind.density)} p/cm\xB3` : "density  missing");
  lines.push(mag ? `Bt       ${mag.bt.toFixed(1)} nT` : "Bt       missing");
  lines.push(mag ? `Bz       ${fmtBz(mag.bz)}` : "Bz       missing");
  if ((part === "6h" || part === "both") && end != null) {
    lines.push("", "Last 6 h (UTC, 30-min steps)");
    lines.push("time      speed  dens   Bt    Bz");
    for (const row of tableRows(pull, end, 6)) lines.push(row);
  } else if (part === "6h") {
    lines.push("", "Last 6 h", "missing");
  }
  if (part === "24h" || part === "both") {
    lines.push("", "Last 24 h summary");
    lines.push(...summaryLines(pull, end));
  }
  return lines.join("\n");
}
function summaryLines(pull, end) {
  if (end == null) return ["missing"];
  const start = end - 24 * 36e5;
  const mag = pull.mag.points.filter((p) => p.t >= start && p.t <= end);
  const wind = pull.wind.points.filter((p) => p.t >= start && p.t <= end);
  const out = [];
  if (wind.length) {
    const speeds = wind.map((p) => p.speed);
    const dens = wind.map((p) => p.density);
    const now = wind[wind.length - 1];
    const maxD = Math.max(...dens);
    const spikes = dens.filter((d) => d >= SPIKE_DENSITY).length;
    const spike = spikes === 0 ? "" : spikes === 1 ? " (spike)" : ` (spike x${spikes})`;
    const minSpeed = Math.round(Math.min(...speeds));
    const minDens = Math.min(...dens);
    out.push(
      `speed    min ${minSpeed}${minSpeed === 0 ? " (gap)" : ""} / max ${Math.round(Math.max(...speeds))} / now ${Math.round(now.speed)}`
    );
    out.push(
      `density  min ${fmtDens(minDens)}${fmtDens(minDens) === "0.0" ? " (gap)" : ""} / max ${fmtDens(maxD)}${spike} / now ${fmtDens(now.density)}`
    );
  } else {
    out.push("speed    missing", "density  missing");
  }
  if (mag.length) {
    const bts = mag.map((p) => p.bt);
    const bzs = mag.map((p) => p.bz);
    const now = mag[mag.length - 1];
    const hours = bzHours(mag);
    const flips = bzFlips(mag);
    out.push(
      `Bt       min ${Math.min(...bts).toFixed(1)} / max ${Math.max(...bts).toFixed(1)} / now ${now.bt.toFixed(1)}`
    );
    out.push(
      `Bz       south ${hours.south.toFixed(1)} h / north ${hours.north.toFixed(1)} h / deepest ${fmtBz(Math.min(...bzs))} / now ${fmtBz(now.bz)}`
    );
    out.push(flips.text);
  } else {
    out.push("Bt       missing", "Bz       missing", "flips    missing");
  }
  return out;
}
function tableRows(pull, end, hours) {
  const start = end - hours * 36e5;
  const rows = [];
  for (let bin = floorHalf(start); bin <= end; bin += BIN_MS) {
    const mag = pull.mag.points.filter((p) => p.t >= bin && p.t < bin + BIN_MS && p.t >= start);
    const wind = pull.wind.points.filter((p) => p.t >= bin && p.t < bin + BIN_MS && p.t >= start);
    if (!mag.length && !wind.length) continue;
    const speed = wind.length ? String(Math.round(mean(wind.map((p) => p.speed)))) : "\u2014";
    const densVals = wind.map((p) => p.density);
    const spiked = densVals.some((d) => d >= SPIKE_DENSITY);
    const dens = wind.length ? `${fmtDens(mean(densVals))}${spiked ? "*" : ""}` : "\u2014";
    const bt = mag.length ? mean(mag.map((p) => p.bt)).toFixed(1) : "\u2014";
    const bz = mag.length ? fmtBzCell(mean(mag.map((p) => p.bz))) : "\u2014";
    rows.push(
      `${pad(binLabel(bin), 8)}  ${pad(speed, 5)}  ${pad(dens, 5)}  ${pad(bt, 4)}  ${bz}`
    );
  }
  return rows.length ? rows : ["no samples in window"];
}
function bzHours(points) {
  let south = 0;
  let north = 0;
  for (let i = 0; i < points.length; i++) {
    const gap = i + 1 < points.length ? points[i + 1].t - points[i].t : 6e4;
    const dt = Math.min(Math.max(gap, 0), MAX_GAP_MS);
    const bz = points[i].bz;
    if (bz <= -BZ_DEADBAND) south += dt;
    else if (bz >= BZ_DEADBAND) north += dt;
  }
  return { south: south / 36e5, north: north / 36e5 };
}
function bzFlips(points) {
  let state = null;
  let count = 0;
  let last = "";
  for (const p of points) {
    const next = p.bz <= -BZ_DEADBAND ? "S" : p.bz >= BZ_DEADBAND ? "N" : null;
    if (!next) continue;
    if (state && next !== state) {
      count += 1;
      last = `${clock(p.t)} UTC, ${state}\u2192${next}`;
    }
    state = next;
  }
  return { count, text: count ? `flips    ${count} raw (last ${last})` : "flips    0 raw" };
}
function sourceLine(pull, now) {
  return `Source: SWPC RTSW  |  ${feedBit("mag", pull.mag.source, latestMag(pull.mag.points)?.t ?? null, now)}  |  ${feedBit("plasma", pull.wind.source, latestWind(pull.wind.points)?.t ?? null, now)}`;
}
function feedBit(name, source, t, now) {
  if (t == null) return `${name} missing`;
  return `${name} ${source ?? "?"} ${clock(t)} UTC (${ageMinutes(t, now)} min)`;
}
function seriesLine(name, series, latest) {
  const src = (series.source ?? "none").padEnd(8, " ");
  const when = latest == null ? "no samples" : `latest ${clock(latest)} UTC`;
  return `${name.padEnd(12, " ")}${src} active ${series.active} / ${series.rows}   filled ${series.filled}   dropped ${series.dropped}   ${when}`;
}
function parseRows(rows, map) {
  const points = [];
  let active = 0;
  let filled = 0;
  let dropped = 0;
  let source = null;
  let sourceAt = -Infinity;
  for (const row of rows) {
    if (!isActive(row)) continue;
    active += 1;
    const mapped = map(row);
    if (mapped === "drop") {
      dropped += 1;
      continue;
    }
    points.push(mapped.point);
    if (mapped.filled) filled += 1;
    const src = typeof row.source === "string" ? row.source : null;
    if (src && mapped.point.t >= sourceAt) {
      source = src;
      sourceAt = mapped.point.t;
    }
  }
  points.sort((a, b) => a.t - b.t);
  return { points, rows: rows.length, active, source, filled, dropped };
}
function rowsOf(payload, name) {
  if (!Array.isArray(payload)) throw new Error(`unable to parse JSON (${name})`);
  return payload;
}
function isActive(row) {
  return !!row && typeof row === "object" && row.active === true;
}
function timeOf(value) {
  if (typeof value !== "string" || value.length < 19) return null;
  const t = Date.parse(value.endsWith("Z") ? value : `${value}Z`);
  return Number.isNaN(t) ? null : t;
}
function readValue(value) {
  if (typeof value === "number" && Number.isFinite(value) && Math.abs(value) < SENTINEL) {
    return { n: value, filled: false };
  }
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n) && Math.abs(n) < SENTINEL) return { n, filled: false };
  }
  return { n: 0, filled: true };
}
function mean(values) {
  return values.reduce((s, n) => s + n, 0) / values.length;
}
function floorHalf(t) {
  const d = new Date(t);
  const m = d.getUTCMinutes();
  d.setUTCMinutes(m < 30 ? 0 : 30, 0, 0);
  return d.getTime();
}
function binLabel(t) {
  const d = new Date(t);
  const day = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${day} ${hh}:${mm}`;
}
function stamp(t) {
  const d = new Date(t);
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${mo}-${day} ${clock(t)} UTC`;
}
function clock(t) {
  const d = new Date(t);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}
function fmtDens(n) {
  return n.toFixed(1);
}
function fmtBz(n) {
  const rounded = Math.round(n * 10) / 10;
  const body = `${rounded < 0 ? "-" : rounded > 0 ? "+" : ""}${Math.abs(rounded).toFixed(1)} nT`;
  if (rounded < 0) return `${body} South`;
  if (rounded > 0) return `${body} North`;
  return `${body}`;
}
function fmtBzCell(n) {
  const rounded = Math.round(n * 10) / 10;
  const body = `${rounded < 0 ? "-" : rounded > 0 ? "+" : ""}${Math.abs(rounded).toFixed(1)}`;
  if (rounded < 0) return `${body} S`;
  if (rounded > 0) return `${body} N`;
  return body;
}
function pad(value, width) {
  return value.length >= width ? value : value + " ".repeat(width - value.length);
}
export {
  BZ_DEADBAND,
  L1_DEBUG,
  MAG_URL,
  SPIKE_DENSITY,
  WIND_URL,
  ageMinutes,
  auditLines,
  clock,
  dataEnd,
  ingest,
  l1Log,
  latestMag,
  latestWind,
  parseMag,
  parseWind,
  shareText,
  stamp
};
