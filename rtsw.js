// src/lib/rtsw.ts
var MAG_URL = "https://services.swpc.noaa.gov/json/rtsw/rtsw_mag_1m.json";
var WIND_URL = "https://services.swpc.noaa.gov/json/rtsw/rtsw_wind_1m.json";
var BZ_DEADBAND = 0.5;
var SENTINEL = 9999;
var PRESSURE = 16726e-10;
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
    const bt = readMeas(r.bt);
    const bz = readMeas(r.bz_gsm);
    const phi = readPhi(r);
    const bx = readMeas(r.bx_gsm);
    const filled = bt.filled || bz.filled || phi.filled;
    return { point: { t, bt: bt.n, bz: bz.n, phi: phi.n, bx: bx.n, filled }, filled };
  });
}
function parseWind(payload) {
  return parseRows(rowsOf(payload, "plasma"), (row) => {
    const r = row;
    const t = timeOf(r.time_tag);
    if (t == null) return "drop";
    const speed = readMeas(r.proton_speed);
    const density = readMeas(r.proton_density);
    const temp = readTemp(r.proton_temperature);
    const filled = speed.filled || density.filled || temp.filled;
    return {
      point: { t, speed: speed.n, density: density.n, temp: temp.n, filled },
      filled
    };
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
      `             ${clock(p.t)}  Bt ${fmtAudit(p.bt, 2)}  Bz ${fmtAudit(p.bz, 2)}  phi ${fmtAudit(p.phi, 0)}${p.filled ? "  FILLED" : ""}`
    );
  }
  lines.push(seriesLine("plasma", pull.wind, latestWind(pull.wind.points)?.t ?? null));
  for (const p of pull.wind.points.slice(-3).reverse()) {
    lines.push(
      `             ${clock(p.t)}  speed ${fmtAudit(p.speed, 1)}  dens ${fmtAudit(p.density, 2)}  temp ${p.temp == null ? "gap" : String(Math.round(p.temp))}${p.filled ? "  FILLED" : ""}`
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
  const speedNow = lastSample(pull.wind.points, (p) => p.speed != null && p.speed > 0 ? p.speed : null);
  const densNow = lastSample(pull.wind.points, (p) => p.density != null && p.density > 0 ? p.density : null);
  const tempNow = lastSample(pull.wind.points, (p) => p.temp != null && p.temp > 0 ? p.temp : null);
  const btNow = lastSample(pull.mag.points, (p) => p.bt);
  const bzNow = lastSample(pull.mag.points, (p) => p.bz);
  const pressureNow = lastSample(pull.wind.points, (p) => pressureOf(p.speed, p.density));
  const phiNow = lastPhi(pull.mag.points);
  lines.push(speedNow == null ? "speed    gap" : `speed    ${Math.round(speedNow.n)} km/s   ${clock(speedNow.t)} UTC`);
  lines.push(densNow == null ? "density  gap" : `density  ${fmtDens(densNow.n)} p/cm\xB3   ${clock(densNow.t)} UTC`);
  lines.push(btNow == null ? "Bt       gap" : `Bt       ${btNow.n.toFixed(1)} nT   ${clock(btNow.t)} UTC`);
  lines.push(bzNow == null ? "Bz       gap" : `Bz       ${fmtBz(bzNow.n)}   ${clock(bzNow.t)} UTC`);
  lines.push(tempNow == null ? "temp     gap" : `temp     ${Math.round(tempNow.n / 1e3)} \xD710\xB3 K   ${clock(tempNow.t)} UTC`);
  lines.push(pressureNow == null ? "pressure gap" : `pressure ${fmtPressure(pressureNow.n)} nPa   ${clock(pressureNow.t)} UTC`);
  lines.push(phiNow == null ? "phi      gap" : fmtPhiLine(phiNow));
  lines.push("rule     GSM. Away only if phi is 90-180 and Bx < 0. Toward only if phi is 270-360 and Bx > 0.");
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
function lastSample(points, pick) {
  for (let i = points.length - 1; i >= 0; i--) {
    const n = pick(points[i]);
    if (n != null && Number.isFinite(n)) return { n, t: points[i].t };
  }
  return null;
}
function lastPhi(points) {
  for (let i = points.length - 1; i >= 0; i--) {
    if (points[i].phi != null) return points[i];
  }
  return null;
}
function summaryLines(pull, end) {
  if (end == null) return ["missing"];
  const start = end - 24 * 36e5;
  const mag = pull.mag.points.filter((p) => p.t >= start && p.t <= end);
  const wind = pull.wind.points.filter((p) => p.t >= start && p.t <= end);
  const out = [];
  const speeds = wind.map((p) => p.speed).filter((n) => n != null && n > 0);
  const dens = wind.map((p) => p.density).filter((n) => n != null && n > 0);
  const pressures = wind.map((p) => pressureOf(p.speed, p.density)).filter((n) => n != null);
  if (speeds.length) {
    const now = speeds[speeds.length - 1];
    out.push(`speed    min ${Math.round(Math.min(...speeds))} / max ${Math.round(Math.max(...speeds))} / now ${Math.round(now)}`);
  } else {
    out.push("speed    gap");
  }
  if (dens.length) {
    const now = dens[dens.length - 1];
    out.push(`density  min ${fmtDens(Math.min(...dens))} / max ${fmtDens(Math.max(...dens))} / now ${fmtDens(now)}`);
  } else {
    out.push("density  gap");
  }
  if (pressures.length) {
    out.push(`pressure 24 h max ${fmtPressure(Math.max(...pressures))} nPa / now ${fmtPressure(pressures[pressures.length - 1])}`);
  } else {
    out.push("pressure gap");
  }
  const bts = mag.map((p) => p.bt).filter((n) => n != null);
  const bzs = mag.map((p) => p.bz).filter((n) => n != null);
  if (bts.length && bzs.length) {
    const hours = bzBudget(mag, start, end);
    const flips = bzFlips(mag);
    const h = (ms) => (ms / 36e5).toFixed(1);
    out.push(`Bt       min ${Math.min(...bts).toFixed(1)} / max ${Math.max(...bts).toFixed(1)} / now ${bts[bts.length - 1].toFixed(1)}`);
    out.push(
      `Bz       south ${h(hours.south)} h / north ${h(hours.north)} h / near-zero ${h(hours.near)} h / gap ${h(hours.gap)} h / deepest ${fmtBz(Math.min(...bzs))} / now ${fmtBz(bzs[bzs.length - 1])}`
    );
    out.push("hours    24 h window. near-zero = |Bz| < 0.5 nT. gap = no sample. south + north is not the whole day.");
    out.push(flips.text);
    out.push(`south    ${southPercent(mag, end)}% of last 6 h`);
  } else {
    out.push("Bt       gap", "Bz       gap", "flips    gap", "south    gap");
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
    const speeds = wind.map((p) => p.speed).filter((n) => n != null && n > 0);
    const densVals = wind.map((p) => p.density).filter((n) => n != null && n > 0);
    const bts = mag.map((p) => p.bt).filter((n) => n != null);
    const bzs = mag.map((p) => p.bz).filter((n) => n != null);
    const speed = speeds.length ? String(Math.round(mean(speeds))) : "\u2014";
    const dens = densVals.length ? fmtDens(mean(densVals)) : "\u2014";
    const bt = bts.length ? mean(bts).toFixed(1) : "\u2014";
    const bz = bzs.length ? fmtBzCell(mean(bzs)) : "\u2014";
    rows.push(`${pad(binLabel(bin), 8)}  ${pad(speed, 5)}  ${pad(dens, 5)}  ${pad(bt, 4)}  ${bz}`);
  }
  return rows.length ? rows : ["no samples in window"];
}
function bzBudget(points, start, end) {
  let south = 0;
  let north = 0;
  let near = 0;
  let gap = 0;
  if (end <= start) return { south, north, near, gap };
  if (!points.length) return { south, north, near, gap: end - start };
  if (points[0].t > start) gap += points[0].t - start;
  for (let i = 0; i < points.length; i++) {
    const nextT = i + 1 < points.length ? points[i + 1].t : end;
    const raw = Math.max(0, nextT - points[i].t);
    const counted = Math.min(raw, MAX_GAP_MS);
    gap += raw - counted;
    const bz = points[i].bz;
    if (bz == null) gap += counted;
    else if (bz <= -BZ_DEADBAND) south += counted;
    else if (bz >= BZ_DEADBAND) north += counted;
    else near += counted;
  }
  return { south, north, near, gap };
}
function southPercent(points, end) {
  const start = end - 6 * 36e5;
  const sample = points.filter((p) => p.t >= start && p.t <= end && p.bz != null);
  if (!sample.length) return "gap";
  const south = sample.filter((p) => p.bz < 0).length;
  return (south / sample.length * 100).toFixed(1);
}
function bzFlips(points) {
  let state = null;
  let count = 0;
  let last = "";
  for (const p of points) {
    if (p.bz == null) continue;
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
function pressureOf(speed, density) {
  if (speed == null || density == null || speed <= 0 || density <= 0) return null;
  return PRESSURE * density * speed * speed;
}
function fmtPressure(n) {
  return n.toFixed(2);
}
function fmtPhiLine(point) {
  const phi = point.phi;
  const bx = point.bx;
  const bxText = bx == null ? "Bx gap" : `Bx ${fmtSigned(bx)}`;
  return `phi      ${Math.round(phi)}\xB0 GSM  ${bxText}  ${sectorName(phi, bx)}   ${clock(point.t)} UTC`;
}
function sectorName(phi, bx) {
  if (bx == null || bx === 0) return "no sector";
  const p = (phi % 360 + 360) % 360;
  if (bx < 0 && p >= 90 && p <= 180) return "Away";
  if (bx > 0 && p >= 270 && p < 360) return "Toward";
  return "no sector";
}
function fmtSigned(n) {
  const body = Math.abs(n).toFixed(1);
  if (n > 0) return `+${body}`;
  if (n < 0) return `-${body}`;
  return body;
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
function readMeas(value) {
  const n = asFinite(value);
  if (n == null || Math.abs(n) >= SENTINEL) return { n: null, filled: true };
  return { n, filled: false };
}
function readTemp(value) {
  const n = asFinite(value);
  if (n == null || n <= 0 || n >= 1e7) return { n: null, filled: true };
  return { n, filled: false };
}
function readPhi(row) {
  const packet = asFinite(row.phi_gsm);
  if (packet != null && packet >= 0 && packet < 360) return { n: packet, filled: false };
  const bx = asFinite(row.bx_gsm);
  const by = asFinite(row.by_gsm);
  if (bx == null || by == null || Math.abs(bx) >= SENTINEL || Math.abs(by) >= SENTINEL) {
    return { n: null, filled: true };
  }
  let deg = Math.atan2(by, bx) * 180 / Math.PI;
  if (deg < 0) deg += 360;
  return { n: deg, filled: false };
}
function asFinite(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
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
function fmtAudit(n, digits) {
  return n == null ? "gap" : n.toFixed(digits);
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
