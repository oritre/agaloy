"use strict";
/* ---------- storage ---------- */
const store = {
  get(k, d) { try { const v = localStorage.getItem("ak_" + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem("ak_" + k, JSON.stringify(v)); } catch (e) { } }
};
const DAY = 864e5;
const now = () => Date.now();
const $ = s => document.querySelector(s);
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const k in attrs || {}) {
    const v = attrs[k];
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : String(c));
  return el;
}
const norm = s => String(s || "").toLowerCase().replace(/["'׳״`.,\-–—()/\\:!?]/g, "").replace(/\s+/g, "").replace(/תקוה/g, "תקווה");
const strip = s => String(s || "").replace(/\s*-\s*נסגר\s*$/, "").trim();

/* ---------- geometry ---------- */
function km(a, b) {
  const R = 6371, r = Math.PI / 180, dl = (b.lat - a.lat) * r, dn = (b.lng - a.lng) * r;
  const x = Math.sin(dl / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dn / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
function inWestBank(lat, lng) {
  const poly = WESTBANK; let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > lat) !== (yj > lat) && lng < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside;
  }
  if (inside) return true;
  // allow ~2.5 km outside the line (settlements right on the line, Dead Sea shore)
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [x1, y1] = poly[j], [x2, y2] = poly[i];
    const dx = x2 - x1, dy = y2 - y1, t = Math.max(0, Math.min(1, ((lng - x1) * dx + (lat - y1) * dy) / (dx * dx + dy * dy || 1)));
    if (km({ lat, lng }, { lat: y1 + t * dy, lng: x1 + t * dx }) < 2.5) return true;
  }
  return false;
}
function regionOf(lat, lng) {
  if (lat == null) return "";
  if (lng > 35.38) return "בקעה וים המלח";
  if (lat < 31.75) return "גוש עציון והר חברון";
  if (lat > 32.055) return "שומרון";
  return "בנימין";
}
function nameSimilar(a, b) {
  a = norm(a).replace(/^(קפה|עגלת?קפה|cafe|coffee)/, ""); b = norm(b).replace(/^(קפה|עגלת?קפה|cafe|coffee)/, "");
  if (!a || !b) return false;
  return a.includes(b) || b.includes(a);
}

/* ---------- phones ---------- */
function phoneFmt(p) {
  if (!p) return "";
  let d = String(p).replace(/\D/g, "");
  if (d.startsWith("972")) d = "0" + d.slice(3);
  if (d.length === 9 && d[0] === "5") d = "0" + d;
  if (d.length === 10 && d[0] === "0") return d.slice(0, 3) + "-" + d.slice(3);
  if (d.length === 9 && d[0] === "0") return d.slice(0, 2) + "-" + d.slice(2);
  return String(p).trim();
}

/* ---------- sheet ---------- */
function parseCSV(text) {
  const rows = []; let row = [], f = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(f); f = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(f); rows.push(row); row = []; f = ""; }
    else f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows;
}
function rowsFromCSV(text) {
  const all = parseCSV(text);
  const hi = all.findIndex(r => r.some(c => c.trim() === "שם המקום"));
  if (hi < 0) throw new Error("no header");
  const H = all[hi].map(c => c.trim());
  const col = test => H.findIndex(test);
  const ci = {
    loc: col(c => c === "מיקום"), name: col(c => c === "שם המקום"), waze: col(c => c.includes("וויז")),
    council: col(c => c.includes("מועצה")), phone: col(c => c.includes("טלפון")), kosher: col(c => c.includes("כשרות")),
    kind: col(c => c.includes("חלבי")), hours: col(c => c.includes("שעות")), special: col(c => c.includes("מיוחד"))
  };
  const out = [];
  for (const r of all.slice(hi + 1)) {
    const g = k => ci[k] >= 0 ? (r[ci[k]] || "").trim() : "";
    if (!g("name")) continue;
    const extra = r.slice(Math.max(...Object.values(ci)) + 1).map(s => s.trim()).filter(Boolean).join(" ");
    out.push([g("loc"), g("name"), g("waze"), g("council"), g("phone"), g("kosher"), g("kind"), g("hours"), g("special"), extra]);
  }
  if (out.length < 5) throw new Error("too few rows");
  return out;
}
async function fetchSheet() {
  const id = CONFIG.SHEET_ID, t = now();
  const urls = [
    `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv&headers=0&t=${t}`,
    `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&t=${t}`
  ];
  let err;
  for (const u of urls) {
    try {
      const r = await fetch(u, { cache: "no-store" });
      if (!r.ok) throw new Error("HTTP " + r.status);
      return rowsFromCSV(await r.text());
    } catch (e) { err = e; }
  }
  throw err;
}

/* ---------- Google Places (New) ---------- */
const gkey = () => store.get("gkey", "") || CONFIG.GOOGLE_KEY;
const DETAIL_FIELDS = "id,displayName,formattedAddress,location,businessStatus,regularOpeningHours,nationalPhoneNumber,rating,userRatingCount,googleMapsUri";
async function gFetch(url, opt) {
  const r = await fetch(url, opt);
  if (!r.ok) {
    let msg = "HTTP " + r.status;
    try { const j = await r.json(); msg = (j.error && j.error.message) || msg; } catch (e) { }
    const e = new Error(msg); e.status = r.status; throw e;
  }
  return r.json();
}
const gDetails = id => gFetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(id)}?languageCode=he&regionCode=IL`,
  { headers: { "X-Goog-Api-Key": gkey(), "X-Goog-FieldMask": DETAIL_FIELDS } });
const gSearch = body => gFetch("https://places.googleapis.com/v1/places:searchText", {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-Goog-Api-Key": gkey(), "X-Goog-FieldMask": "places.id,places.displayName,places.location,places.businessStatus,places.formattedAddress,places.types" },
  body: JSON.stringify(Object.assign({ languageCode: "he", regionCode: "IL" }, body))
}).then(j => j.places || []);
async function pool(items, n, fn) {
  const q = items.slice(); const run = async () => { while (q.length) { const it = q.shift(); try { await fn(it); } catch (e) { if (e.status === 400 || e.status === 403 || e.status === 401) { q.length = 0; throw e; } } } };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, run));
}

/* ---------- build the model ---------- */
let PLACES = [];
function indexKey(ix) { return "i:" + norm(ix.m[0][0]) + "|" + norm(ix.m[0][1]); }
function findIndex(name, loc) {
  const n = norm(name), l = norm(loc);
  let hit = PLACES_INDEX.find(ix => ix.m.some(([a, b]) => norm(a) === n && norm(b) === l));
  if (hit) return hit;
  const byName = PLACES_INDEX.filter(ix => ix.m.some(([a]) => norm(a) === n));
  return byName.length === 1 ? byName[0] : null;
}
function settlementCoords(loc) {
  const l = String(loc || "");
  let best = null;
  for (const s in SETTLEMENTS) if (l.includes(s) && (!best || s.length > best.length)) best = s;
  return best ? { lat: SETTLEMENTS[best][0], lng: SETTLEMENTS[best][1] } : null;
}
function build() {
  const rows = store.get("sheet", null)?.rows || SEED_ROWS;
  const gdet = store.get("gdet", {}), gmatch = store.get("gmatch", {}), gdisc = store.get("gdisc", { places: [] });
  const byKey = new Map();
  for (const r0 of rows) {
    const r = Array.from({ length: 10 }, (_, i) => (r0[i] || "").trim());
    const [loc, name] = r; if (!name) continue;
    const ix = findIndex(name, loc);
    const key = ix ? indexKey(ix) : "s:" + norm(name) + "|" + norm(loc);
    let p = byKey.get(key);
    if (!p) {
      p = { key, src: "sheet", name: strip(name), loc: strip(loc), waze: "", council: "", phone: "", kosher: "", kind: "", hoursText: "", special: [], idx: ix };
      byKey.set(key, p);
    }
    const fill = (f, v) => { if (v && !p[f]) p[f] = v; };
    fill("waze", r[2]); fill("council", r[3]); fill("phone", r[4]); fill("kosher", r[5]); fill("kind", r[6]); fill("hoursText", r[7]);
    [r[8], r[9]].forEach(s => { if (s && !p.special.includes(s)) p.special.push(s); });
    if (/נסגר/.test(name) || /נסגר/.test(loc)) p.sheetClosed = true;
  }
  const out = [...byKey.values()];
  for (const p of out) {
    const ix = p.idx, m = gmatch[p.key];
    p.gid = (ix && ix.g) || (m && m.id) || null;
    if (ix) { p.lat = ix.lat; p.lng = ix.lng; p.approx = !!ix.a; }
    else {
      const wz = /ll=([\d.]+)%2C([\d.]+)/.exec(p.waze || "");
      const c = wz ? { lat: +wz[1], lng: +wz[2] } : settlementCoords(p.loc) || settlementCoords(p.name);
      if (c) { p.lat = c.lat; p.lng = c.lng; p.approx = !wz; }
      if (m && m.lat) { p.lat = m.lat; p.lng = m.lng; p.approx = !m.id; }
    }
  }
  // places Google Maps knows about that the sheet does not
  const known = new Set(out.map(p => p.gid).filter(Boolean));
  for (const d of gdisc.places || []) {
    if (known.has(d.id)) continue;
    if (out.some(p => p.lat != null && km(p, d) < 1.5 && nameSimilar(p.name, d.name))) continue;
    out.push({ key: "g:" + d.id, src: "google", name: d.name, loc: d.addr || "", gid: d.id, lat: d.lat, lng: d.lng, approx: false, special: [], phone: "", kosher: "", kind: "", hoursText: "", waze: "" });
  }
  for (const p of out) {
    const g = p.gid && gdet[p.gid] && gdet[p.gid].data;
    p.g = g || null;
    if (g && g.location) { p.lat = g.location.latitude; p.lng = g.location.longitude; p.approx = false; }
    if (!p.phone && g && g.nationalPhoneNumber) p.phone = g.nationalPhoneNumber;
    p.phone = phoneFmt(p.phone);
    p.gHours = g ? Hours.fromGoogle(g.regularOpeningHours) : null;
    p.sHours = Hours.parseSheet(p.hoursText);
    p.hours = p.gHours || p.sHours;
    p.region = regionOf(p.lat, p.lng);
    p.closure = p.sheetClosed || (g && g.businessStatus === "CLOSED_PERMANENTLY") ? "perm" : (g && g.businessStatus === "CLOSED_TEMPORARILY" ? "temp" : "");
  }
  PLACES = out;
  computeStatus();
}
function computeStatus() {
  const t = new Date();
  for (const p of PLACES) {
    if (p.closure) { p.status = p.closure; p.stateLabel = p.closure === "perm" ? "נסגר לצמיתות" : "סגור זמנית"; continue; }
    const st = Hours.state(p.hours, t);
    if (!st) { p.status = "unknown"; p.stateLabel = "שעות לא ידועות"; continue; }
    p.status = st.open ? "open" : "closed";
    p.stateLabel = st.label + (p.hours.approx ? " (משוער)" : "");
  }
}

/* ---------- change log ---------- */
function snapshot() {
  const s = {};
  for (const p of PLACES) s[p.key] = {
    n: p.name, src: p.src, p: p.phone, sh: p.hoursText || "",
    gh: p.g && p.g.regularOpeningHours ? (p.g.regularOpeningHours.weekdayDescriptions || []).join("|") : "",
    c: p.closure || ""
  };
  return s;
}
function diffAndLog(reason) {
  const prev = store.get("snap", null), cur = snapshot();
  store.set("snap", cur);
  if (!prev) return 0;
  const log = store.get("log", []), t = now(), add = (type, key, name, text) => log.unshift({ t, type, key, name, text });
  for (const k in cur) {
    const a = prev[k], b = cur[k];
    if (!a) { add(b.src === "google" ? "gnew" : "new", k, b.n, b.src === "google" ? "נמצא בגוגל מפות ולא מופיע בגיליון" : "נוסף לגיליון"); continue; }
    if (a.c !== b.c) add(b.c ? b.c : "reopen", k, b.n, b.c === "perm" ? "מסומן כסגור לצמיתות" : b.c === "temp" ? "סגור זמנית לפי גוגל מפות" : "חזר לפעול");
    if (a.sh && b.sh && a.sh !== b.sh) add("hours", k, b.n, "השעות בגיליון השתנו: " + b.sh);
    if (a.gh && b.gh && a.gh !== b.gh) add("hours", k, b.n, "השעות בגוגל מפות השתנו");
    if (a.p && b.p && a.p !== b.p) add("phone", k, b.n, "טלפון חדש: " + b.p);
  }
  for (const k in prev) if (!cur[k] && prev[k].src === "sheet") add("removed", k, prev[k].n, "הוסר מהגיליון");
  store.set("log", log.slice(0, 200));
  return log.length;
}

/* ---------- sync ---------- */
const sync = store.get("sync", {});
function setSync(k, v) { sync[k] = v; store.set("sync", sync); }
function status(msg) { $("#status").textContent = msg || ""; }
async function syncSheet() {
  status("מעדכן מהגיליון…");
  try {
    const rows = await fetchSheet();
    store.set("sheet", { rows, at: now() }); setSync("sheet", now()); setSync("sheetErr", "");
    return true;
  } catch (e) { setSync("sheetErr", String(e.message || e)); return false; }
}
async function syncGoogle(force) {
  if (!gkey()) return;
  const gdet = store.get("gdet", {}), gmatch = store.get("gmatch", {});
  const ttl = CONFIG.DETAILS_TTL_DAYS * DAY;
  try {
    // 1. find Google listings for sheet places without one
    const toMatch = PLACES.filter(p => p.src === "sheet" && !p.gid && !p.sheetClosed && (force || !gmatch[p.key] || now() - gmatch[p.key].at > CONFIG.MATCH_TTL_DAYS * DAY));
    if (toMatch.length) status("מחפש בגוגל מפות מקומות בלי מיקום מדויק…");
    await pool(toMatch, 3, async p => {
      const body = { textQuery: p.name + " " + p.loc, pageSize: 5 };
      if (p.lat != null) body.locationBias = { circle: { center: { latitude: p.lat, longitude: p.lng }, radius: 8000 } };
      const res = await gSearch(body);
      const hit = res.find(r => r.location && nameSimilar(r.displayName && r.displayName.text, p.name) && (p.lat == null || km(p, { lat: r.location.latitude, lng: r.location.longitude }) < 8));
      gmatch[p.key] = hit ? { id: hit.id, lat: hit.location.latitude, lng: hit.location.longitude, at: now() } : { id: null, at: now() };
      store.set("gmatch", gmatch);
    });
    // 2. look for new carts on Google Maps
    const disc = store.get("gdisc", { at: 0, places: [] });
    if (force || now() - disc.at > CONFIG.DISCOVERY_TTL_DAYS * DAY) {
      status("מחפש עגלות חדשות בגוגל מפות…");
      const rect = { rectangle: { low: { latitude: 31.33, longitude: 34.88 }, high: { latitude: 32.56, longitude: 35.60 } } };
      const found = new Map();
      for (const q of ["עגלת קפה", "פודטראק", "coffee cart", "קפה בטבע"]) {
        const res = await gSearch({ textQuery: q, pageSize: 20, locationRestriction: rect });
        for (const r of res) {
          if (!r.location) continue;
          const lat = r.location.latitude, lng = r.location.longitude;
          if (!inWestBank(lat, lng)) continue;
          found.set(r.id, { id: r.id, name: r.displayName ? r.displayName.text : "", lat, lng, addr: r.formattedAddress || "" });
        }
      }
      store.set("gdisc", { at: now(), places: [...found.values()].slice(0, 40) });
    }
    build();
    // 3. refresh details (hours, phone, open / closed for good)
    const ids = [...new Set(PLACES.map(p => p.gid).filter(Boolean))].filter(id => force || !gdet[id] || now() - gdet[id].at > ttl);
    if (ids.length) status(`מעדכן פרטים מגוגל מפות (${ids.length})…`);
    await pool(ids, 4, async id => {
      try { gdet[id] = { data: await gDetails(id), at: now() }; }
      catch (e) { if (e.status === 404) gdet[id] = { data: null, at: now() }; else throw e; }
      store.set("gdet", gdet);
    });
    setSync("google", now()); setSync("googleErr", "");
  } catch (e) {
    setSync("googleErr", String(e.message || e));
  }
}

/* ---------- map ---------- */
const map = L.map("map", { zoomControl: false, preferCanvas: true, attributionControl: true }).setView([31.9, 35.2], 9);
L.control.zoom({ position: "topleft" }).addTo(map);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(map);
const layer = L.layerGroup().addTo(map);
const COLORS = { open: "#2f8a4c", closed: "#c98a1a", unknown: "#8a948a", temp: "#7b5ea7", perm: "#3b3b3b" };
let markers = new Map(), selKey = null, fitted = false;

/* ---------- my location ---------- */
let me = store.get("me", null), meMarker = null, meAcc = null, watchId = null;
function showMe() {
  if (!me) return;
  if (!meMarker) {
    meAcc = L.circle([me.lat, me.lng], { radius: me.acc || 50, color: "#2f5f8a", weight: 1, fillOpacity: .12, interactive: false }).addTo(map);
    meMarker = L.circleMarker([me.lat, me.lng], { radius: 8, color: "#fff", weight: 3, fillColor: "#2f5f8a", fillOpacity: 1, interactive: false }).addTo(map);
  } else { meMarker.setLatLng([me.lat, me.lng]); meAcc.setLatLng([me.lat, me.lng]).setRadius(me.acc || 50); }
}
function startLocate(fly) {
  if (!navigator.geolocation) { status("המכשיר לא תומך באיתור מיקום"); return; }
  if (watchId !== null) { if (me) map.flyTo([me.lat, me.lng], Math.max(map.getZoom(), 12)); return; }
  status("מאתר מיקום…");
  let first = true;
  watchId = navigator.geolocation.watchPosition(pos => {
    me = { lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy, at: now() };
    store.set("me", me); showMe(); $("#locBtn").classList.add("on");
    if (first) { first = false; status(""); if (fly) map.flyTo([me.lat, me.lng], 12); render(); }
  }, err => {
    watchId = null;
    status(err.code === 1 ? "אין הרשאת מיקום. אפשר לאשר אותה בהגדרות האתר בכרום." : "לא הצלחתי לאתר מיקום");
  }, { enableHighAccuracy: true, maximumAge: 30000, timeout: 20000 });
}
$("#locBtn").onclick = () => startLocate(true);
if (navigator.permissions) navigator.permissions.query({ name: "geolocation" }).then(p => { if (p.state === "granted") startLocate(false); }).catch(() => { });
if (me) showMe();

/* ---------- filters & list ---------- */
const prefs = Object.assign({ mode: "open", closed: false, reg: "", kind: "", q: "" }, store.get("prefs", {}));
prefs.q = "";
function savePrefs() { store.set("prefs", { mode: prefs.mode, closed: prefs.closed, reg: prefs.reg, kind: prefs.kind }); }
document.querySelectorAll("[data-mode]").forEach(b => b.onclick = () => { prefs.mode = b.dataset.mode; savePrefs(); render(); });
$("#closedBtn").onclick = () => { prefs.closed = !prefs.closed; savePrefs(); render(); };
$("#regSel").onchange = e => { prefs.reg = e.target.value; savePrefs(); render(true); };
$("#kindSel").onchange = e => { prefs.kind = e.target.value; savePrefs(); render(); };
$("#q").oninput = e => { prefs.q = e.target.value.trim(); render(); };

function visible(p) {
  const okStatus = p.status === "open" || (prefs.mode === "active" && (p.status === "closed" || p.status === "unknown")) || (prefs.closed && (p.status === "temp" || p.status === "perm"));
  if (!okStatus) return false;
  if (prefs.reg && p.region !== prefs.reg) return false;
  if (prefs.kind && p.kind !== prefs.kind) return false;
  if (prefs.q && !(p.name + " " + p.loc).includes(prefs.q)) return false;
  return true;
}
const distText = d => d < 10 ? d.toFixed(1) + " ק\"מ" : Math.round(d) + " ק\"מ";
function render(refit) {
  computeStatus();
  document.querySelectorAll("[data-mode]").forEach(b => b.setAttribute("aria-pressed", b.dataset.mode === prefs.mode));
  $("#closedBtn").setAttribute("aria-pressed", prefs.closed);
  $("#regSel").value = prefs.reg; $("#kindSel").value = prefs.kind;

  let vis = PLACES.filter(visible);
  vis.forEach(p => p._d = me && p.lat != null ? km(me, p) : null);
  const rank = { open: 0, closed: 1, unknown: 2, temp: 3, perm: 4 };
  vis.sort((a, b) => me ? ((a._d ?? 1e9) - (b._d ?? 1e9)) : (rank[a.status] - rank[b.status] || a.name.localeCompare(b.name, "he")));

  // markers
  layer.clearLayers(); markers = new Map();
  for (const p of vis) {
    if (p.lat == null) continue;
    const sel = p.key === selKey;
    const m = L.circleMarker([p.lat, p.lng], {
      radius: sel ? 11 : 8, weight: sel ? 4 : (p.src === "google" ? 3 : 2),
      color: sel ? "#1f2a21" : (p.src === "google" ? "#b0471c" : "#fff"),
      dashArray: p.approx ? "3 3" : null, fillColor: COLORS[p.status], fillOpacity: p.approx ? .55 : .95
    }).bindTooltip(p.name, { direction: "top", offset: [0, -6] }).on("click", () => openPlace(p.key));
    m.addTo(layer); markers.set(p.key, m);
  }
  if ((!fitted || refit) && vis.some(p => p.lat != null)) {
    const pts = vis.filter(p => p.lat != null).map(p => [p.lat, p.lng]);
    if (me && !refit) map.setView([me.lat, me.lng], 11); else map.fitBounds(pts, { padding: [30, 30], maxZoom: 12 });
    fitted = true;
  }

  // summary
  const all = PLACES.filter(p => (!prefs.reg || p.region === prefs.reg) && (!prefs.kind || p.kind === prefs.kind));
  const cnt = s => all.filter(p => p.status === s).length;
  const sum = $("#summary"); sum.innerHTML = "";
  if (prefs.mode === "open") {
    sum.append(`${cnt("open")} פתוחים עכשיו`);
    const rest = cnt("closed") + cnt("unknown");
    if (rest) sum.append(" · ", h("button", { class: "linkBtn", onclick: () => { prefs.mode = "active"; savePrefs(); render(); } }, `עוד ${rest} סגורים עכשיו או בלי שעות ידועות`));
  } else sum.append(`${vis.length} מקומות · ${cnt("open")} פתוחים עכשיו`);
  if (me) sum.append(" · ממוין לפי מרחק ממך");

  // list
  const list = $("#list"); list.innerHTML = "";
  if (!vis.length) list.append(h("li", { class: "empty" }, prefs.mode === "open" ? "אין מקום פתוח עכשיו לפי הסינון. נסה \"כל הפעילים\"." : "לא נמצאו מקומות לפי הסינון."));
  for (const p of vis) {
    list.append(h("li", { class: "item" + (p.key === selKey ? " sel" : ""), tabindex: 0, onclick: () => openPlace(p.key, true), onkeydown: e => { if (e.key === "Enter") openPlace(p.key, true); } },
      h("span", { class: "dot", style: `background:${COLORS[p.status]}` }),
      h("span", { class: "itMain" },
        h("b", {}, p.name, p.src === "google" ? h("span", { class: "newTag" }, "חדש בגוגל") : null),
        h("span", { class: "sub" }, [p.loc, p.stateLabel].filter(Boolean).join(" · "))),
      h("span", { class: "itSide" }, p._d != null ? h("span", { class: "dist" }, distText(p._d)) : null,
        p.kind ? h("span", { class: "tag " + (p.kind === "בשרי" ? "m" : "d") }, p.kind) : null)));
  }
}

/* ---------- place sheet ---------- */
function openSheet(id) { const el = $(id); el.hidden = false; document.body.classList.add("noScroll"); }
function closeSheets() { document.querySelectorAll(".sheet").forEach(s => s.hidden = true); document.body.classList.remove("noScroll"); }
document.addEventListener("click", e => { if (e.target.matches("[data-close]") || e.target.classList.contains("sheet")) closeSheets(); });
document.addEventListener("keydown", e => { if (e.key === "Escape") closeSheets(); });

function openPlace(key, fly) {
  const p = PLACES.find(x => x.key === key); if (!p) return;
  selKey = key; render();
  if (fly && p.lat != null) map.flyTo([p.lat, p.lng], Math.max(map.getZoom(), 13));
  const g = p.g;
  const exact = p.lat != null && !p.approx;
  const waze = exact ? `https://waze.com/ul?ll=${p.lat},${p.lng}&navigate=yes`
    : `https://waze.com/ul?q=${encodeURIComponent(p.waze && !/^https?:/.test(p.waze) ? p.waze : p.name + " " + p.loc)}&navigate=yes`;
  const gmaps = (g && g.googleMapsUri) || (exact ? `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}` : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.name + " " + p.loc)}`);
  const hoursLines = g && g.regularOpeningHours && g.regularOpeningHours.weekdayDescriptions ? g.regularOpeningHours.weekdayDescriptions : (p.sHours ? Hours.describe(p.sHours) : []);
  const pill = h("span", { class: "pill", style: `background:${COLORS[p.status]}` }, p.stateLabel);
  const body = $("#sheetBody"); body.innerHTML = "";
  body.append(...[
    h("h2", { id: "dName" }, p.name),
    h("p", { class: "where" }, [p.loc, p.region].filter(Boolean).join(" · "), p._d != null ? " · " + distText(p._d) + " ממך" : ""),
    h("p", {}, pill, p.src === "google" ? h("span", { class: "newTag" }, "נמצא בגוגל מפות, לא בגיליון") : null),
    h("div", { class: "actions" },
      h("a", { class: "btn primary", href: waze, target: "_blank", rel: "noopener" }, "נווט בוויז"),
      h("a", { class: "btn", href: gmaps, target: "_blank", rel: "noopener" }, "גוגל מפות"),
      p.phone ? h("a", { class: "btn", href: "tel:" + p.phone.replace(/[^\d+]/g, "") }, "חייג " + p.phone) : null),
    h("dl", { class: "facts" },
      hoursLines.length ? [h("dt", {}, "שעות" + (g && g.regularOpeningHours ? " (גוגל מפות)" : p.sHours && p.sHours.approx ? " (משוער מהגיליון)" : " (מהגיליון)")), h("dd", {}, h("ul", { class: "hours" }, hoursLines.map(hoursLine)))] : null,
      p.hoursText && g && g.regularOpeningHours ? [h("dt", {}, "בגיליון כתוב"), h("dd", {}, p.hoursText)] : null,
      p.hoursText && !hoursLines.length ? [h("dt", {}, "שעות"), h("dd", {}, p.hoursText)] : null,
      p.kosher ? [h("dt", {}, "כשרות"), h("dd", {}, p.kosher)] : null,
      p.kind ? [h("dt", {}, "סוג"), h("dd", {}, h("span", { class: "tag " + (p.kind === "בשרי" ? "m" : "d") }, p.kind))] : null,
      p.special.length ? [h("dt", {}, "מה מיוחד"), h("dd", {}, p.special.join(" · "))] : null,
      g && g.rating ? [h("dt", {}, "דירוג בגוגל"), h("dd", {}, `${g.rating} ★ (${g.userRatingCount || 0} ביקורות)`)] : null,
      g && g.formattedAddress ? [h("dt", {}, "כתובת"), h("dd", {}, g.formattedAddress)] : null),
    p.approx ? h("p", { class: "muted" }, "המיקום במפה משוער לפי היישוב. כפתור הוויז מחפש לפי השם.") : null,
    p.lat == null ? h("p", { class: "muted" }, "אין מיקום למקום הזה. כפתור הוויז מחפש לפי השם.") : null,
    !p.hours && !p.closure ? h("p", { class: "muted" }, "אין שעות פתיחה בגיליון או בגוגל, לכן לא ידוע אם פתוח עכשיו. כדאי להתקשר.") : null,
    placeHistory(p.key)
  ].filter(Boolean));
  openSheet("#sheet");
}
function hoursLine(l) {
  const i = l.indexOf(":");
  if (i < 0 || !/\d/.test(l.slice(i + 1))) return h("li", {}, l);
  return h("li", {}, l.slice(0, i + 1) + " ", h("span", { dir: "ltr", class: "ltr" }, l.slice(i + 1).replace(/[\u200e\u200f\u202f]/g, " ").trim()));
}
function placeHistory(key) {
  const ev = store.get("log", []).filter(e => e.key === key).slice(0, 5);
  if (!ev.length) return null;
  return h("div", { class: "hist" }, h("h3", {}, "שינויים אחרונים"), h("ul", {}, ev.map(e => h("li", {}, fmtDate(e.t) + " · " + e.text))));
}
const fmtDate = t => new Date(t).toLocaleDateString("he-IL", { day: "numeric", month: "numeric" }) + " " + new Date(t).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });

/* ---------- news ---------- */
const EV_LABEL = { new: "חדש בגיליון", gnew: "חדש בגוגל מפות", removed: "הוסר", hours: "שעות", phone: "טלפון", perm: "נסגר לצמיתות", temp: "סגור זמנית", reopen: "חזר לפעול" };
function updateBadge() {
  const seen = store.get("seen", 0), n = store.get("log", []).filter(e => e.t > seen).length;
  const b = $("#newsBadge"); b.hidden = !n; b.textContent = n > 99 ? "99+" : n;
}
$("#newsBtn").onclick = () => {
  const log = store.get("log", []), seen = store.get("seen", 0), ul = $("#newsList"); ul.innerHTML = "";
  if (!log.length) ul.append(h("li", { class: "muted" }, "עדיין אין שינויים. בכל פתיחה האפליקציה בודקת את הגיליון, ופעם בכמה ימים גם את גוגל מפות."));
  for (const e of log.slice(0, 80)) {
    const p = PLACES.find(x => x.key === e.key);
    ul.append(h("li", { class: e.t > seen ? "unseen" : "" },
      h("span", { class: "evTag ev-" + e.type }, EV_LABEL[e.type] || e.type),
      h("b", {}, e.name), h("span", { class: "sub" }, e.text + " · " + fmtDate(e.t)),
      p ? h("button", { class: "linkBtn", onclick: () => { closeSheets(); openPlace(p.key, true); } }, "הצג") : null));
  }
  store.set("seen", now()); updateBadge(); openSheet("#news");
};

/* ---------- settings ---------- */
function fillSettings() {
  $("#keyIn").value = store.get("gkey", "") || "";
  $("#keyNote").textContent = CONFIG.GOOGLE_KEY ? "מוגדר מפתח באפליקציה. מפתח שתכתוב כאן יחליף אותו במכשיר הזה בלבד." : (gkey() ? "המפתח שמור במכשיר הזה." : "בלי מפתח האפליקציה עובדת מהגיליון בלבד: בלי שעות מגוגל, בלי זיהוי סגירה ובלי עגלות חדשות מגוגל.");
  const dl = $("#syncInfo"); dl.innerHTML = "";
  const row = (k, v) => dl.append(h("dt", {}, k), h("dd", {}, v));
  row("גיליון", sync.sheet ? "עודכן " + fmtDate(sync.sheet) : "עוד לא עודכן");
  if (sync.sheetErr) row("שגיאת גיליון", sync.sheetErr);
  row("גוגל מפות", !gkey() ? "אין מפתח" : sync.google ? "עודכן " + fmtDate(sync.google) : "עוד לא עודכן");
  if (sync.googleErr && gkey()) row("שגיאת גוגל", sync.googleErr);
  row("מקומות", `${PLACES.filter(p => p.src === "sheet").length} מהגיליון, ${PLACES.filter(p => p.src === "google").length} חדשים מגוגל, ${PLACES.filter(p => p.g).length} עם פרטים מגוגל`);
}
$("#setBtn").onclick = () => { fillSettings(); openSheet("#settings"); };
$("#keySave").onclick = async () => { store.set("gkey", $("#keyIn").value.trim()); fillSettings(); await refreshGoogle(true); fillSettings(); };
$("#refreshBtn").onclick = async () => { await syncSheet(); build(); await refreshGoogle(true); fillSettings(); };
async function refreshGoogle(force) {
  if (!gkey()) return;
  await syncGoogle(force); build(); diffAndLog(); render(); updateBadge(); footer();
}
function footer() {
  const parts = [];
  if (sync.sheet) parts.push("גיליון: " + fmtDate(sync.sheet));
  if (sync.sheetErr && !navigator.onLine) parts.push("אין חיבור, מוצג המידע האחרון");
  else if (sync.sheetErr) parts.push("הגיליון לא נטען, מוצג המידע האחרון");
  if (gkey() && sync.googleErr) parts.push("גוגל מפות: שגיאה (ראה הגדרות)");
  else if (gkey() && sync.google) parts.push("גוגל: " + fmtDate(sync.google));
  status(parts.join(" · "));
}

/* ---------- install ---------- */
let deferred = null;
window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); deferred = e; $("#installBtn").hidden = false; });
$("#installBtn").onclick = async () => { if (!deferred) return; deferred.prompt(); await deferred.userChoice; deferred = null; $("#installBtn").hidden = true; };
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => { });

/* ---------- start ---------- */
(async function start() {
  build(); render(); updateBadge(); footer();
  const firstRun = !store.get("snap", null);
  if (await syncSheet()) { build(); }
  diffAndLog(); render(); updateBadge(); footer();
  if (gkey()) await refreshGoogle(false);
  if (firstRun) store.set("seen", now());
  setInterval(() => render(), 60000);   // keep "open now" current while the app stays open
  document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState !== "visible") return;
    if (now() - (sync.sheet || 0) > 10 * 60000 && await syncSheet()) { build(); diffAndLog(); updateBadge(); }
    render(); footer();
  });
})();
