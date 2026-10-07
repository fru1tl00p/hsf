const SRS_URL = "https://services.swpc.noaa.gov/text/srs.txt";
const FLARE_URL = "https://services.swpc.noaa.gov/json/goes/primary/xray-flares-7-day.json";
const BG_URL = "https://services.swpc.noaa.gov/json/goes/primary/xray-background-7-day.json";
const XRAY_URL = "https://services.swpc.noaa.gov/json/goes/primary/xrays-6-hour.json";
const KP_URL = "https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json";

async function readJson(url, name) {
  const response = await fetch(url, { signal: AbortSignal.timeout(25_000) });
  if (!response.ok) throw new Error(`${name} HTTP ${response.status}`);
  return response.json();
}

async function readText(url, name) {
  const response = await fetch(url, { signal: AbortSignal.timeout(25_000) });
  if (!response.ok) throw new Error(`${name} HTTP ${response.status}`);
  return response.text();
}

function utcStamp(value) {
  const match = String(value).match(/(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/);
  return match ? `${match[1]} ${match[2]} UTC` : String(value);
}

function fluxClass(watts) {
  if (!Number.isFinite(watts) || watts <= 0) return "below A";
  const labels = [
    [1e-4, "X"],
    [1e-5, "M"],
    [1e-6, "C"],
    [1e-7, "B"],
    [1e-8, "A"],
  ];
  for (const [threshold, name] of labels) {
    if (watts >= threshold) return name + (watts / threshold).toFixed(1);
  }
  return "A" + (watts / 1e-8).toFixed(1);
}

function fmtKp(value) {
  const rounded = Math.round(value * 100) / 100;
  if (Number.isInteger(rounded)) return String(rounded);
  return rounded.toFixed(2).replace(/0$/, "");
}

function parseSrs(text) {
  let issued = "";
  const regions = [];
  let on = false;
  for (const line of String(text).split("\n")) {
    if (line.startsWith(":Issued:")) issued = line.slice(8).trim();
    if (line.startsWith("I.  Regions")) {
      on = true;
      continue;
    }
    if (on && line.startsWith("IA.")) break;
    if (!on || line.startsWith("Nmbr") || !line.trim()) continue;
    const parts = line.trim().split(/\s+/);
    if (parts.length < 7 || !/^\d+$/.test(parts[0])) continue;
    const loc = parts[1].length > 3 ? parts[1].slice(3) : parts[1];
    const spots = Number.parseInt(parts[6], 10);
    const mag = parts.length > 7 ? parts.slice(7).join(" ").toLowerCase() : "mag gap";
    regions.push(`${parts[0]} at ${loc}, area ${Number.parseInt(parts[3], 10)}, ${parts[4]}, ${mag}, ${spots} ${spots === 1 ? "spot" : "spots"}`);
  }
  return { issued, regions };
}

function latestFlare(flares, now) {
  const cut = now - 24 * 60 * 60 * 1000;
  let best = null;
  for (const flare of Array.isArray(flares) ? flares : []) {
    const time = Date.parse(flare?.max_time ?? "");
    if (!Number.isFinite(time) || time < cut || !flare.max_class) continue;
    if (!best || time > best.time) best = { time, klass: flare.max_class, stamp: flare.max_time };
  }
  return best;
}

function backgroundNow(rows) {
  const list = Array.isArray(rows) ? rows : [];
  for (let i = list.length - 1; i >= 0; i--) {
    const value = Number(list[i]?.background);
    if (Number.isFinite(value) && value > 0) return { watts: value, time: list[i].time_tag };
  }
  return null;
}

function risingHour(rows) {
  const long = (Array.isArray(rows) ? rows : []).filter(
    (row) => row?.energy === "0.1-0.8nm" && Number.isFinite(row.flux) && row.flux > 0,
  );
  if (long.length < 2) return "unknown";
  const last = long[long.length - 1];
  const end = Date.parse(last.time_tag);
  if (!Number.isFinite(end)) return "unknown";
  const target = end - 60 * 60 * 1000;
  let best = null;
  let bestDistance = Infinity;
  for (const row of long) {
    const time = Date.parse(row.time_tag);
    const distance = Math.abs(time - target);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = row;
    }
  }
  if (!best || best === last || bestDistance > 15 * 60 * 1000) return "unknown";
  return last.flux > best.flux ? "rising" : "not rising";
}

function xrayLine(flares, background, xray, now, feeds) {
  let flareText = "flare list unavailable";
  if (feeds.flares) {
    const flare = latestFlare(flares, now);
    flareText = flare ? `latest ${flare.klass} peak ${utcStamp(flare.stamp)}` : "no flare in the last 24 h";
  }
  const bg = feeds.background ? backgroundNow(background) : null;
  const bgText = bg ? `background ${fluxClass(bg.watts)} at ${utcStamp(bg.time)}` : "background unavailable";
  const trend = feeds.xray ? risingHour(xray) : "unknown";
  return `X-ray    ${flareText}, ${bgText}, last hour ${trend}`;
}

function kpLine(rows) {
  const points = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || row.Kp == null || row.time_tag == null) continue;
    const tag = String(row.time_tag);
    const time = Date.parse(tag.endsWith("Z") ? tag : `${tag}Z`);
    const kp = Number(row.Kp);
    if (!Number.isFinite(time) || !Number.isFinite(kp)) continue;
    points.push({ time, kp });
  }
  if (!points.length) return "Kp       unavailable";
  points.sort((a, b) => a.time - b.time);
  const current = points[points.length - 1];
  const cut = current.time - 24 * 60 * 60 * 1000;
  let max = current.kp;
  for (const point of points) if (point.time >= cut) max = Math.max(max, point.kp);
  return `Kp       current ${fmtKp(current.kp)} at ${utcStamp(new Date(current.time).toISOString())}, max last 24h ${fmtKp(max)}`;
}

function srsLines(parsed, error) {
  if (error) return [`SRS      unavailable: ${error}`];
  const lines = [`SRS      issued ${parsed.issued || "unknown"}`];
  if (!parsed.regions.length) lines.push("         none");
  parsed.regions.forEach((region, index) => {
    lines.push(index === 0 ? `regions  ${region}` : `         ${region}`);
  });
  return lines;
}

async function caught(name, task) {
  try {
    return { ok: true, value: await task };
  } catch (error) {
    const message = error instanceof Error ? error.message : `${name} fetch failed`;
    return { ok: false, error: message };
  }
}

async function loadBrief(now = Date.now()) {
  const [srs, flares, background, xray, kp] = await Promise.all([
    caught("SRS", readText(SRS_URL, "SRS")),
    caught("X-ray", readJson(FLARE_URL, "X-ray")),
    caught("background", readJson(BG_URL, "background")),
    caught("xray", readJson(XRAY_URL, "xray")),
    caught("Kp", readJson(KP_URL, "Kp")),
  ]);
  const lines = srsLines(srs.ok ? parseSrs(srs.value) : { issued: "", regions: [] }, srs.ok ? null : srs.error);
  if (!flares.ok && !background.ok && !xray.ok) {
    lines.push(`X-ray    unavailable: ${flares.error || background.error || xray.error}`);
  } else {
    lines.push(
      xrayLine(
        flares.ok ? flares.value : [],
        background.ok ? background.value : [],
        xray.ok ? xray.value : [],
        now,
        { flares: flares.ok, background: background.ok, xray: xray.ok },
      ),
    );
    const missing = [flares, background, xray].filter((item) => !item.ok).map((item) => item.error);
    if (missing.length) lines.push(`         partial: ${missing.join("; ")}`);
  }
  lines.push(kp.ok ? kpLine(kp.value) : `Kp       unavailable: ${kp.error}`);
  return lines;
}

export { loadBrief, parseSrs, xrayLine, kpLine, fluxClass };
