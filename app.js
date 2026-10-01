import { MAG_URL, WIND_URL, auditLines, ingest, l1Log, shareText, stamp } from "./rtsw.js";

const STORE = "l1-glance-v1";

const fetchBtn = document.querySelector("#fetch");
const noteInput = document.querySelector("#note");
const logEl = document.querySelector("#log");
const shareEl = document.querySelector("#share");
const storageEl = document.querySelector("#storage");
const copyButtons = [...document.querySelectorAll("[data-part]")];

let pull = null;
let log = [];
let busy = false;
let ready = false;
let copied = null;

function storageError(message) {
  storageEl.hidden = !message;
  storageEl.textContent = message ?? "";
}

function load() {
  try {
    const raw = localStorage.getItem(STORE);
    if (!raw) {
      l1Log("cache read", "empty");
    } else {
      const saved = JSON.parse(raw);
      if (saved.pull) pull = saved.pull;
      if (typeof saved.note === "string") noteInput.value = saved.note;
      if (Array.isArray(saved.log)) log = saved.log.slice(0, 8);
      l1Log("cache read", "hit");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "localStorage read failed";
    storageError(`localStorage read failed: ${message}`);
    console.error("[L1] localStorage read failed", error);
  }
  ready = true;
  render();
}

function save() {
  if (!ready) return;
  try {
    localStorage.setItem(STORE, JSON.stringify({ pull, note: noteInput.value, log: log.slice(0, 8) }));
    storageError(null);
  } catch (error) {
    const message = error instanceof Error ? error.message : "localStorage write failed";
    storageError(`localStorage write failed: ${message}`);
    console.error("[L1] localStorage write failed", error);
  }
}

function render() {
  fetchBtn.disabled = busy;
  fetchBtn.textContent = busy ? "Fetching…" : "Fetch";
  for (const button of copyButtons) {
    button.disabled = !pull || busy;
    const part = button.dataset.part;
    const label = part === "6h" ? "Copy 6 h" : part === "24h" ? "Copy 24 h" : "Copy both";
    button.textContent = copied === part ? "Copied" : label;
  }
  if (!log.length) {
    logEl.innerHTML = '<p class="muted">No pull yet.</p>';
  } else {
    const items = log
      .map(
        (entry) =>
          `<li><pre class="${entry.ok ? "ok" : "bad"}">${escapeHtml(entry.text)}</pre></li>`,
      )
      .join("");
    logEl.innerHTML = `<ul class="log-list">${items}</ul>`;
  }
  shareEl.textContent = pull
    ? shareText(pull, noteInput.value, Date.now(), "both")
    : "Fetch once. This is the text the copy buttons use.";
}

async function readFeed(url, name) {
  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(25_000) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "network";
    throw new Error(`${name} fetch failed: ${message}`);
  }
  if (!response.ok) throw new Error(`${name} HTTP ${response.status}`);
  try {
    return await response.json();
  } catch {
    throw new Error(`unable to parse JSON (${name})`);
  }
}

async function fetchNow() {
  busy = true;
  render();
  try {
    const [mag, wind] = await Promise.all([readFeed(MAG_URL, "mag"), readFeed(WIND_URL, "plasma")]);
    const next = ingest(mag, wind, Date.now());
    if (!next.mag.points.length && !next.wind.points.length) throw new Error("no active samples");
    l1Log("fetch ok", {
      at: stamp(next.fetchedAt),
      magFilled: next.mag.filled,
      magDropped: next.mag.dropped,
      plasmaFilled: next.wind.filled,
      plasmaDropped: next.wind.dropped,
    });
    pull = next;
    log = [{ at: next.fetchedAt, ok: true, text: auditLines(next).join("\n") }, ...log].slice(0, 8);
  } catch (error) {
    const at = Date.now();
    const message = error instanceof Error ? error.message : "fetch failed";
    console.error("[L1] fetch failed", error);
    const kept = pull ? `\nkept previous pull from ${stamp(pull.fetchedAt)}` : "";
    log = [{ at, ok: false, text: `fetch failed  ${stamp(at)}\n${message}${kept}` }, ...log].slice(0, 8);
  } finally {
    busy = false;
    save();
    render();
  }
}

async function copy(part) {
  if (!pull) return;
  const text = shareText(pull, noteInput.value, Date.now(), part);
  try {
    await navigator.clipboard.writeText(text);
    copied = part;
    render();
    window.setTimeout(() => {
      if (copied === part) {
        copied = null;
        render();
      }
    }, 1600);
  } catch {
    window.prompt("Clipboard blocked. Copy this:", text);
  }
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&")
    .replaceAll("<", "<")
    .replaceAll(">", ">");
}

fetchBtn.addEventListener("click", fetchNow);
noteInput.addEventListener("input", () => {
  save();
  render();
});
for (const button of copyButtons) {
  button.addEventListener("click", () => copy(button.dataset.part));
}

load();
window.setInterval(render, 30_000);
