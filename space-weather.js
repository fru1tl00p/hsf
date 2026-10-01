document.addEventListener("DOMContentLoaded", function () {
  document.getElementById("refresh-button").addEventListener("click", fetchSpaceWeatherData);
  document.getElementById("copy-summary").addEventListener("click", copySummary);
  document.getElementById("copy-detailed").addEventListener("click", copyDetailedStats);
});

// The 6-hour products this file used to call now 404.
// RTSW is the live feed. It is reshaped into the old header + rows
// so the cards and the copy text below stay as they were.
const MAG_URL = "https://services.swpc.noaa.gov/json/rtsw/rtsw_mag_1m.json";
const WIND_URL = "https://services.swpc.noaa.gov/json/rtsw/rtsw_wind_1m.json";
const SENTINEL = 9999;
const SIX_H = 6 * 60 * 60 * 1000;

let processedData = {
  current: {},
  stats: {},
};

async function fetchSpaceWeatherData() {
  const loadingIndicator = document.getElementById("loading-indicator");
  loadingIndicator.style.display = "inline";

  try {
    const [magRaw, plasmaRaw] = await Promise.all([
      readFeed(MAG_URL, "mag"),
      readFeed(WIND_URL, "plasma"),
    ]);
    processData(asMagTable(magRaw), asPlasmaTable(plasmaRaw));
  } catch (error) {
    console.error("Error fetching space weather data:", error);
    document.getElementById("bt-current").textContent = "Error loading data";
    document.getElementById("bz-current").textContent = "Error loading data";
    document.getElementById("speed-current").textContent = "Error loading data";
    document.getElementById("density-current").textContent = "Error loading data";
    document.getElementById("last-update").textContent = "Failed to load data: " + error.message;
  } finally {
    loadingIndicator.style.display = "none";
  }
}

async function readFeed(url, name) {
  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(25000) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "network";
    throw new Error(name + " fetch failed: " + message);
  }
  if (!response.ok) throw new Error(name + " HTTP " + response.status);
  try {
    return await response.json();
  } catch {
    throw new Error("unable to parse JSON (" + name + ")");
  }
}

function asMagTable(payload) {
  const rows = lastSixHours(activeRows(payload, "mag"));
  return [
    ["time_tag", "bt", "bz_gsm"],
    ...rows.map((row) => [row.time_tag, finite(row.bt), finite(row.bz_gsm)]),
  ];
}

function asPlasmaTable(payload) {
  const rows = lastSixHours(activeRows(payload, "plasma"));
  return [
    ["time_tag", "speed", "density", "temperature"],
    ...rows.map((row) => [
      row.time_tag,
      finite(row.proton_speed),
      finite(row.proton_density),
      temperature(row.proton_temperature),
    ]),
  ];
}

function activeRows(payload, name) {
  if (!Array.isArray(payload)) throw new Error("unable to parse JSON (" + name + ")");
  return payload
    .filter((row) => row && row.active === true && timeOf(row.time_tag) != null)
    .sort((a, b) => timeOf(a.time_tag) - timeOf(b.time_tag));
}

function lastSixHours(rows) {
  if (!rows.length) return rows;
  const end = timeOf(rows[rows.length - 1].time_tag);
  return rows.filter((row) => timeOf(row.time_tag) >= end - SIX_H);
}

function timeOf(value) {
  if (typeof value !== "string" || value.length < 19) return null;
  const t = Date.parse(value.endsWith("Z") ? value : value + "Z");
  return Number.isNaN(t) ? null : t;
}

function finite(value) {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n) || Math.abs(n) >= SENTINEL) return "";
  return n;
}

// Kelvin. Quiet wind is already ~50,000, so the 9999 fill test used for nT and km/s does not apply.
function temperature(value) {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n) || n <= 0 || n >= 1e7) return "";
  return n;
}

function processData(magData, plasmaData) {
  if (magData.length < 2 || plasmaData.length < 2) {
    console.error("Insufficient data received");
    document.getElementById("last-update").textContent = "Insufficient data received from SWPC API";
    return;
  }

  const magHeaders = magData[0];
  const plasmaHeaders = plasmaData[0];

  const btIndex = magHeaders.indexOf("bt");
  const bzIndex = magHeaders.indexOf("bz_gsm");
  const timeIndex = magHeaders.indexOf("time_tag");

  const speedIndex = plasmaHeaders.indexOf("speed");
  const densityIndex = plasmaHeaders.indexOf("density");

  if (btIndex === -1 || bzIndex === -1 || timeIndex === -1) {
    console.error("Could not find required magnetic field parameters in data");
    document.getElementById("last-update").textContent = "Error: Missing magnetic field parameters in data";
    return;
  }

  if (speedIndex === -1 || densityIndex === -1) {
    console.error("Could not find required plasma parameters in data");
    document.getElementById("last-update").textContent = "Error: Missing plasma parameters in data";
    return;
  }

  const magDataValues = magData.slice(1);
  const plasmaDataValues = plasmaData.slice(1);

  const validMagData = magDataValues.filter(
    (row) =>
      row.length > Math.max(btIndex, bzIndex, timeIndex) &&
      !isNaN(parseFloat(row[btIndex])) &&
      !isNaN(parseFloat(row[bzIndex])),
  );

  const validPlasmaData = plasmaDataValues.filter(
    (row) =>
      row.length > Math.max(speedIndex, densityIndex) &&
      !isNaN(parseFloat(row[speedIndex])) &&
      !isNaN(parseFloat(row[densityIndex])),
  );

  if (validMagData.length === 0 || validPlasmaData.length === 0) {
    console.error("No valid data points found");
    document.getElementById("last-update").textContent = "Error: No valid data points found";
    return;
  }

  const latestMag = validMagData[validMagData.length - 1];
  const latestPlasma = validPlasmaData[validPlasmaData.length - 1];

  const currentBt = parseFloat(latestMag[btIndex]);
  const currentBz = parseFloat(latestMag[bzIndex]);
  const currentSpeed = parseFloat(latestPlasma[speedIndex]);
  const densityValue = parseFloat(latestPlasma[densityIndex]);
  const currentDensity = isNaN(densityValue) ? 0 : densityValue;
  const lastUpdateTime = latestMag[timeIndex];

  const btValues = validMagData.map((row) => parseFloat(row[btIndex])).filter((val) => !isNaN(val));
  const btStats = calculateStats(btValues);

  const bzValues = validMagData.map((row) => parseFloat(row[bzIndex])).filter((val) => !isNaN(val));
  const bzStats = calculateStats(bzValues);
  const bzSouthPercent = ((bzValues.filter((val) => val < 0).length / bzValues.length) * 100).toFixed(1);

  const speedValues = validPlasmaData.map((row) => parseFloat(row[speedIndex])).filter((val) => !isNaN(val));
  const speedStats = calculateStats(speedValues);

  const densityValues = validPlasmaData.map((row) => parseFloat(row[densityIndex])).filter((val) => !isNaN(val));
  const densityStats = calculateStats(densityValues);

  processedData.current = {
    bt: currentBt,
    bz: currentBz,
    speed: currentSpeed,
    density: currentDensity,
    time: lastUpdateTime,
  };

  processedData.stats = {
    bt: btStats,
    bz: bzStats,
    bzSouthPercent: bzSouthPercent,
    speed: speedStats,
    density: densityStats,
  };

  const tempIndex = plasmaHeaders.indexOf("temperature");
  if (tempIndex === -1) {
    console.error("Could not find temperature parameter in data");
  }

  const currentTemp = parseFloat(latestPlasma[tempIndex]) / 1000;

  const protonMass = 1.6726e-27;
  const conversionFactor = 1e9;
  const currentDensitySI = currentDensity * 1e6;
  const currentSpeedSI = currentSpeed * 1000;
  const currentPressure = currentDensitySI * protonMass * Math.pow(currentSpeedSI, 2) * conversionFactor;

  const tempValues = validPlasmaData
    .map((row) => parseFloat(row[tempIndex]) / 1000)
    .filter((val) => !isNaN(val));
  const tempStats = calculateStats(tempValues);

  const pressureValues = validPlasmaData
    .map((row) => {
      const density = parseFloat(row[densityIndex]);
      const speed = parseFloat(row[speedIndex]);
      if (isNaN(density) || isNaN(speed)) return NaN;
      const densitySI = density * 1e6;
      const speedSI = speed * 1000;
      return densitySI * protonMass * Math.pow(speedSI, 2) * conversionFactor;
    })
    .filter((val) => !isNaN(val));
  const pressureStats = calculateStats(pressureValues);

  processedData.current.temperature = currentTemp;
  processedData.current.pressure = currentPressure;
  processedData.stats.temperature = tempStats;
  processedData.stats.pressure = pressureStats;

  updateUI();
}

function calculateStats(values) {
  if (values.length === 0) return { avg: 0, min: 0, max: 0, std: 0 };

  const sum = values.reduce((a, b) => a + b, 0);
  const avg = sum / values.length;
  const min = Math.min(...values);
  const max = Math.max(...values);

  const squareDiffs = values.map((value) => {
    const diff = value - avg;
    return diff * diff;
  });
  const avgSquareDiff = squareDiffs.reduce((a, b) => a + b, 0) / squareDiffs.length;
  const std = Math.sqrt(avgSquareDiff);

  return { avg: avg, min: min, max: max, std: std };
}

function updateUI() {
  document.getElementById("bt-current").textContent = `${processedData.current.bt.toFixed(1)} nT`;

  const bzElement = document.getElementById("bz-current");
  bzElement.textContent = `${processedData.current.bz.toFixed(1)} nT`;

  if (processedData.current.bz <= -5) {
    bzElement.style.color = "red";
  } else if (processedData.current.bz < 0) {
    bzElement.style.color = "orange";
  } else if (processedData.current.bz >= 5) {
    bzElement.style.color = "green";
  } else {
    bzElement.style.color = "black";
  }

  document.getElementById("speed-current").textContent = `${processedData.current.speed.toFixed(0)} km/s`;
  const densityDisplay =
    processedData.current.density < 0.1
      ? `${processedData.current.density.toFixed(2)} p/cm³`
      : `${processedData.current.density.toFixed(1)} p/cm³`;
  document.getElementById("density-current").textContent = densityDisplay;

  document.getElementById("bt-avg").textContent = `${processedData.stats.bt.avg.toFixed(1)} nT`;
  document.getElementById("bt-min").textContent = `${processedData.stats.bt.min.toFixed(1)} nT`;
  document.getElementById("bt-max").textContent = `${processedData.stats.bt.max.toFixed(1)} nT`;
  document.getElementById("bt-std").textContent = `${processedData.stats.bt.std.toFixed(1)} nT`;

  document.getElementById("bz-avg").textContent = `${processedData.stats.bz.avg.toFixed(1)} nT`;
  document.getElementById("bz-min").textContent = `${processedData.stats.bz.min.toFixed(1)} nT`;
  document.getElementById("bz-max").textContent = `${processedData.stats.bz.max.toFixed(1)} nT`;
  document.getElementById("bz-south-pct").textContent = `${processedData.stats.bzSouthPercent}%`;

  document.getElementById("speed-avg").textContent = `${processedData.stats.speed.avg.toFixed(0)} km/s`;
  document.getElementById("speed-max").textContent = `${processedData.stats.speed.max.toFixed(0)} km/s`;
  document.getElementById("density-avg").textContent = `${processedData.stats.density.avg.toFixed(1)} p/cm³`;
  document.getElementById("density-max").textContent = `${processedData.stats.density.max.toFixed(1)} p/cm³`;

  document.getElementById("temp-current").textContent = `${processedData.current.temperature.toFixed(0)} × 10³ K`;
  document.getElementById("temp-avg").textContent = `${processedData.stats.temperature.avg.toFixed(0)} × 10³ K`;
  document.getElementById("temp-max").textContent = `${processedData.stats.temperature.max.toFixed(0)} × 10³ K`;

  document.getElementById("pressure-current").textContent = `${processedData.current.pressure.toFixed(2)} nPa`;
  document.getElementById("pressure-avg").textContent = `${processedData.stats.pressure.avg.toFixed(2)} nPa`;
  document.getElementById("pressure-max").textContent = `${processedData.stats.pressure.max.toFixed(2)} nPa`;

  const now = new Date();
  document.getElementById("last-update").textContent =
    `Last updated: ${now.toLocaleString()} (data timestamp: ${processedData.current.time})`;
}

function copySummary() {
  if (!processedData.current.time) {
    alert("Please load data first before copying.");
    return;
  }

  const text = `Space Weather Summary (${processedData.current.time}):
- Bt: ${processedData.current.bt.toFixed(1)} nT (6h avg: ${processedData.stats.bt.avg.toFixed(1)} nT)
- Bz: ${processedData.current.bz.toFixed(1)} nT (${processedData.stats.bzSouthPercent}% southward last 6h)
- Solar Wind: ${processedData.current.speed.toFixed(0)} km/s (6h avg: ${processedData.stats.speed.avg.toFixed(0)} km/s)
- Proton Density: ${processedData.current.density < 0.1 ? processedData.current.density.toFixed(2) : processedData.current.density.toFixed(1)} p/cm³
- Temperature: ${processedData.current.temperature.toFixed(0)} × 10³ K
- Dynamic Pressure: ${processedData.current.pressure.toFixed(2)} nPa`;

  copyToClipboard(text, "copy-summary");
}

function copyDetailedStats() {
  if (!processedData.current.time) {
    alert("Please load data first before copying.");
    return;
  }

  const text = `Detailed Space Weather Statistics (${processedData.current.time}):
MAGNETIC FIELD:
- Bt (current): ${processedData.current.bt.toFixed(1)} nT
- Bt 6-hour: avg ${processedData.stats.bt.avg.toFixed(1)} nT, range ${processedData.stats.bt.min.toFixed(1)}-${processedData.stats.bt.max.toFixed(1)} nT, σ ${processedData.stats.bt.std.toFixed(1)} nT

- Bz (current): ${processedData.current.bz.toFixed(1)} nT
- Bz 6-hour: avg ${processedData.stats.bz.avg.toFixed(1)} nT, range ${processedData.stats.bz.min.toFixed(1)}-${processedData.stats.bz.max.toFixed(1)} nT
- Southward orientation: ${processedData.stats.bzSouthPercent}% of last 6 hours

SOLAR WIND:
- Speed (current): ${processedData.current.speed.toFixed(0)} km/s
- Speed 6-hour: avg ${processedData.stats.speed.avg.toFixed(0)} km/s, max ${processedData.stats.speed.max.toFixed(0)} km/s

- Density (current): ${processedData.current.density < 0.1 ? processedData.current.density.toFixed(2) : processedData.current.density.toFixed(1)} p/cm³
- Density 6-hour: avg ${processedData.stats.density.avg < 0.1 ? processedData.stats.density.avg.toFixed(2) : processedData.stats.density.avg.toFixed(1)} p/cm³, max ${processedData.stats.density.max.toFixed(1)} p/cm³

ADDITIONAL PARAMETERS:
- Temperature (current): ${processedData.current.temperature.toFixed(0)} × 10³ K
- Temperature 6-hour: avg ${processedData.stats.temperature.avg.toFixed(0)} × 10³ K, max ${processedData.stats.temperature.max.toFixed(0)} × 10³ K

- Dynamic Pressure (current): ${processedData.current.pressure.toFixed(2)} nPa
- Dynamic Pressure 6-hour: avg ${processedData.stats.pressure.avg.toFixed(2)} nPa, max ${processedData.stats.pressure.max.toFixed(2)} nPa`;

  copyToClipboard(text, "copy-detailed");
}

function copyToClipboard(text, buttonId) {
  navigator.clipboard
    .writeText(text)
    .then(() => {
      const button = document.getElementById(buttonId);
      const originalText = button.textContent;
      button.textContent = "Copied!";
      setTimeout(() => {
        button.textContent = originalText;
      }, 2000);
    })
    .catch((err) => {
      console.error("Failed to copy: ", err);
      alert("Could not copy to clipboard. Please try again or copy manually.");
    });
}
