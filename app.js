const C = window.LOVE_CONFIG;
const $ = (id) => document.getElementById(id);
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

// ---------- time helpers ----------
const dateIn = (tz, d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const clockIn = (tz, d = new Date()) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit" }).format(d);
const hourIn = (tz, d = new Date()) => +new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hourCycle: "h23" }).format(d);
const dayName = (tz, d = new Date()) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short", day: "numeric", month: "short" }).format(d);
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
const fmtDur = (ms) => { const m = Math.max(0, Math.round(ms / 6e4)); const h = Math.floor(m / 60); return h ? `${h}h ${m % 60}m` : `${m}m`; };
const ago = (iso) => { const s = (Date.now() - Date.parse(iso)) / 1000; if (s < 60) return "just now"; if (s < 3600) return `${Math.floor(s / 60)}m ago`; if (s < 86400) return `${Math.floor(s / 3600)}h ago`; return `${Math.floor(s / 86400)}d ago`; };
const prettyDate = (s) => new Date(s + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" });
function tzOffsetH(tz, d = new Date()) {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "shortOffset" }).formatToParts(d).find((x) => x.type === "timeZoneName").value;
  const m = p.match(/GMT([+-]\d+)(?::(\d+))?/); return m ? +m[1] + (m[2] ? Math.sign(+m[1]) * m[2] / 60 : 0) : 0;
}
function zoned(local, tz) {
  // "2026-11-20T18:30" in tz -> Date
  const guess = Date.parse(local + "Z");
  const off = tzOffsetH(tz, new Date(guess));
  return new Date(guess - off * 36e5);
}
const CODE_TZ = { SIN: "Asia/Singapore", DXB: "Asia/Dubai", HEL: "Europe/Helsinki", HKI: "Europe/Helsinki", ROI: "Europe/Helsinki", TOS: "Europe/Oslo" };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function haversine(a, b) {
  const R = 6371, r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(x)));
}

// ---------- identity ----------
let who = LS.get("who", null);            // "me" | "her"
let pairCode = LS.get("pair", "");         // shared secret both phones type in
const nameOf = (s) => (s === "her" ? C.her.name : C.me.name);
const otherName = () => nameOf(who === "her" ? "me" : "her");

// ---------- shared store (Supabase via secure functions) ----------
let sb = null, chan = null, roomId = "";
const configured = !!(C.supabaseUrl && C.supabaseAnonKey);
const synced = () => !!(sb && pairCode);
async function initStore() {
  if (!configured || !pairCode) return;
  try {
    if (!sb) {
      const { createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm");
      sb = createClient(C.supabaseUrl, C.supabaseAnonKey);
    }
    roomId = await sha("us:" + pairCode); // the raw code never leaves the phone
    if (chan) sb.removeChannel(chan);
    // Instant nudges between the two phones; data itself is fetched through the secure functions.
    chan = sb.channel("us-" + roomId.slice(0, 24), { config: { broadcast: { self: false } } })
      .on("broadcast", { event: "poke" }, () => { refreshPings(); renderFeed(); })
      .subscribe();
  } catch (e) { console.warn("Sync failed to start", e); }
}
async function sha(s) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
const poke = () => chan && chan.send({ type: "broadcast", event: "poke", payload: {} });
const store = {
  async addPing(kind, text = "") {
    if (synced()) {
      const { error } = await sb.rpc("add_ping", { p_room: roomId, p_sender: who, p_kind: kind, p_text: text });
      if (error) throw error; poke();
    } else {
      const a = LS.get("pings", []); a.unshift({ sender: who, kind, text, created_at: new Date().toISOString() }); LS.set("pings", a.slice(0, 300));
    }
  },
  async pings() {
    const sortDesc = (a) => [...a].sort((x, y) => Date.parse(y.created_at) - Date.parse(x.created_at));
    if (synced()) {
      const { data, error } = await sb.rpc("get_pings", { p_room: roomId });
      if (!error && data) { data.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)); LS.set("pingsCache", data); return data; }
      return LS.get("pingsCache", []);
    }
    return sortDesc(LS.get("pings", []));
  },
  async addPostcard(blob, caption) {
    if (synced()) {
      const path = `${roomId}/${Date.now()}-${who}.jpg`;
      const up = await sb.storage.from("postcards").upload(path, blob, { contentType: "image/jpeg" });
      if (up.error) throw up.error;
      const { error } = await sb.rpc("add_postcard", { p_room: roomId, p_sender: who, p_caption: caption, p_path: path });
      if (error) throw error; poke();
    } else {
      const url = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });
      const a = LS.get("postcards", []); a.unshift({ sender: who, caption, url, created_at: new Date().toISOString() });
      try { localStorage.setItem("postcards", JSON.stringify(a.slice(0, 12))); } catch { throw new Error("phone storage full, set up sync"); }
    }
  },
  async postcards() {
    if (synced()) {
      const { data, error } = await sb.rpc("get_postcards", { p_room: roomId });
      if (error || !data) return [];
      return data.map((r) => ({ ...r, url: sb.storage.from("postcards").getPublicUrl(r.path).data.publicUrl }));
    }
    return LS.get("postcards", []);
  },
};
let PINGS = [];

// ---------- weather ----------
const WX = {
  0: ["☀️", "Clear"], 1: ["🌤️", "Mostly clear"], 2: ["⛅", "Partly cloudy"], 3: ["☁️", "Overcast"], 45: ["🌫️", "Fog"], 48: ["🌫️", "Icy fog"],
  51: ["🌦️", "Light drizzle"], 53: ["🌦️", "Drizzle"], 55: ["🌧️", "Heavy drizzle"], 56: ["🌧️", "Freezing drizzle"], 57: ["🌧️", "Freezing drizzle"],
  61: ["🌧️", "Light rain"], 63: ["🌧️", "Rain"], 65: ["🌧️", "Heavy rain"], 66: ["🌨️", "Freezing rain"], 67: ["🌨️", "Freezing rain"],
  71: ["🌨️", "Light snow"], 73: ["❄️", "Snow"], 75: ["❄️", "Heavy snow"], 77: ["🌨️", "Snow grains"], 80: ["🌦️", "Showers"], 81: ["🌧️", "Showers"],
  82: ["⛈️", "Heavy showers"], 85: ["🌨️", "Snow showers"], 86: ["❄️", "Heavy snow showers"], 95: ["⛈️", "Thunderstorm"], 96: ["⛈️", "Thunder, hail"], 99: ["⛈️", "Thunder, hail"],
};
const wxCache = {};
async function weather(p) {
  const key = `${(+p.lat).toFixed(2)},${(+p.lon).toFixed(2)}`;
  const hit = wxCache[key];
  if (hit && Date.now() - hit.t < 10 * 6e4) return hit.d;
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${p.lat}&longitude=${p.lon}` +
    `&current=temperature_2m,apparent_temperature,weather_code,is_day,cloud_cover,wind_speed_10m` +
    `&daily=sunrise,sunset,daylight_duration,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=1`;
  try {
    const d = await (await fetch(url)).json();
    if (!d.current) throw new Error("no data");
    wxCache[key] = { t: Date.now(), d }; LS.set("wx:" + key, d); return d;
  } catch { return LS.get("wx:" + key, null); }
}
const hhmm = (iso) => (iso ? iso.slice(11, 16) : "–");
const daylight = (s) => (s == null ? "–" : `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m`);

// ---------- live location ----------
let watchId = null, lastSent = LS.get("lastLocSent", null);
function latestLoc(sender) {
  const p = PINGS.find((x) => x.kind === "loc" && x.sender === sender);
  if (!p) return null;
  try { const v = JSON.parse(p.text); return { ...v, at: p.created_at }; } catch { return null; }
}
async function placeName(lat, lon) {
  try {
    const r = await (await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`)).json();
    const city = (r.city || r.locality || r.principalSubdivision || "").replace(/^Kittila$/, "Kittilä");
    return { city, country: r.countryName || "", cc: r.countryCode || "" };
  } catch { return { city: "", country: "", cc: "" }; }
}
const flag = (cc) => (cc && cc.length === 2 ? String.fromCodePoint(...[...cc.toUpperCase()].map((c) => 127397 + c.charCodeAt(0))) : "📍");
async function onPosition(pos) {
  // About 100 m precision: her real spot, so the app can work out distances and arrival times.
  const lat = +pos.coords.latitude.toFixed(3), lon = +pos.coords.longitude.toFixed(3);
  const spd = pos.coords.speed != null && pos.coords.speed >= 0 ? +pos.coords.speed.toFixed(1) : null; // m/s
  LS.set("locBlocked", false);
  const moved = !lastSent || haversine(lastSent, { lat, lon }) >= 1;
  const stale = !lastSent || Date.now() - lastSent.t > 5 * 6e4;
  if (!moved && !stale) return;
  const n = await placeName(lat, lon);
  const atStop = snapStop({ lat, lon });
  if (atStop) { n.city = atStop.name; n.country = atStop.country || n.country; }
  lastSent = { lat, lon, t: Date.now() }; LS.set("lastLocSent", lastSent);
  await safe(() => store.addPing("loc", JSON.stringify({ lat, lon, spd, ...n })));
  if (n.city && n.city !== LS.get("lastCity", "")) { LS.set("lastCity", n.city); await safe(() => store.addPing("visit", JSON.stringify({ lat, lon, ...n }))); }
  $("locStatus").textContent = `On. Sharing ${n.city || "your spot"}, updated ${clockIn(C.home.tz)} SG time.`;
  await refreshPings(); renderSplit(); renderChips(); renderJourney(); renderCall(); renderLocBanner();
}
function startLoc() {
  if (!navigator.geolocation) { toast("Location isn't available on this browser"); return; }
  if (watchId != null) return;
  watchId = navigator.geolocation.watchPosition(onPosition, (e) => {
    if (e.code === 1) { LS.set("locBlocked", true); LS.set("shareLoc", false); stopLoc(); }
    renderLocToggle(); renderLocBanner();
    toast(e.code === 1 ? "iPhone is blocking location (see the note)" : "Couldn't get a location fix, still trying");
  }, { enableHighAccuracy: false, maximumAge: 5 * 6e4, timeout: 30e3 });
}
function stopLoc() { if (watchId != null) navigator.geolocation.clearWatch(watchId); watchId = null; }
function renderLocToggle() {
  const on = LS.get("shareLoc", false);
  $("locSwitch").classList.toggle("on", on);
  if (LS.get("locBlocked", false)) {
    $("locStatus").innerHTML = `<b style="color:var(--accent)">iPhone is blocking location.</b> Go to Settings → Privacy &amp; Security → Location Services → <b>Safari Websites</b> → <b>While Using the App</b>, then turn this on again.`;
    return;
  }
  if (!on) $("locStatus").textContent = "Off. Your side shows the planned location.";
  else if ($("locStatus").textContent.startsWith("Off")) $("locStatus").textContent = "On. Finding you…";
}

// ---------- where is everyone ----------
const legs = C.legs.map((l) => ({ ...l, depT: Date.parse(l.dep), arrT: Date.parse(l.arr) })).sort((a, b) => a.depT - b.depT);
const stopById = (id) => C.stops.find((s) => s.id === id);
function legPlace(l) {
  const s = C.stops.find((x) => x.name === l.to);
  return s || { id: "leg-" + l.id, name: l.to, flag: l.toCode === "DXB" ? "🇦🇪" : "📍", lat: l.toLat, lon: l.toLon, tz: CODE_TZ[l.toCode] || "UTC" };
}
function snapStop(pt, km = 6) {
  let best = null;
  for (const s of C.stops) { const d = haversine(pt, s); if (d <= km && (!best || d < best.d)) best = { s, d }; }
  return best && best.s;
}
const livePlace = (loc) => {
  const st = snapStop(loc);
  return { id: st ? st.id : "live", name: st ? st.name : (loc.city === "Kittila" ? "Kittilä" : loc.city) || "Somewhere", flag: st ? st.flag : flag(loc.cc), lat: loc.lat, lon: loc.lon, tz: st ? st.tz : null, live: loc.at, stay: st && st.stay };
};
function herNow(now = Date.now()) {
  const active = legs.find((l) => now >= l.depT && now < l.arrT);
  const fresh = latestLoc("her");
  const freshAge = fresh ? now - Date.parse(fresh.at) : Infinity;
  // Her real location beats the planned times whenever it's recent.
  if (active && fresh && freshAge < 45 * 6e4) return { mode: "live", place: livePlace(fresh), leg: active };
  if (active) return { mode: "moving", leg: active };
  if (dateIn(C.home.tz) > C.tripEnd) return { mode: "home", place: C.home };
  const lastDone = [...legs].reverse().find((l) => now >= l.arrT);
  const next = legs.find((l) => l.depT > now);
  const loc = latestLoc("her");
  const locT = loc ? Date.parse(loc.at) : 0;
  // Her real location wins, as long as it's newer than her last landing.
  const stayNow = C.stops.find((x) => x.stay && x.stayFrom && now >= Date.parse(x.stayFrom) && now < Date.parse(x.stayUntil));
  if (loc && (!lastDone || locT > lastDone.arrT) && now - locT > 6 * 36e5 && stayNow && !(snapStop(loc) && snapStop(loc).id === stayNow.id)) {
    return { mode: "live", place: { ...stayNow, live: loc.at, assumed: true } };
  }
  const nextStay = C.stops.find((x) => x.stayFrom && now < Date.parse(x.stayFrom));
  const prevStay = [...C.stops].reverse().find((x) => x.stayUntil && now >= Date.parse(x.stayUntil));
  if (loc && now - locT > 3 * 36e5 && !stayNow && nextStay && prevStay && Date.parse(nextStay.stayFrom) - Date.parse(prevStay.stayUntil) < 24 * 36e5) {
    return { mode: "travel", place: { ...nextStay, live: loc.at, travelling: true }, from: prevStay };
  }
  if (loc && (!lastDone || locT > lastDone.arrT)) {
    const here = livePlace(loc);
    if (loc.spd != null && loc.spd > 3) {
      const tgt = nextTarget({ place: here });
      if (tgt && tgt.kind === "road") {
        const e = eta(loc, tgt, "road", loc.spd);
        if (locT + e.ms <= now) {
          const stop = C.stops.find((x) => x.name === tgt.name) || tgt;
          return { mode: "live", place: { ...stop, id: stop.id || "est", live: loc.at, estimated: locT + e.ms } };
        }
      }
    }
    return { mode: "live", place: here };
  }
  if (legs.length && now < legs[0].depT) return { mode: "before", place: C.home };
  const checkin = PINGS.find((p) => p.sender === "her" && p.kind === "here");
  if (checkin && (!lastDone || Date.parse(checkin.created_at) > lastDone.arrT) && stopById(checkin.text)) return { mode: "stay", place: stopById(checkin.text) };
  if (lastDone && next && next.depT - now < 12 * 36e5 && next.from === lastDone.to) return { mode: "layover", place: legPlace(lastDone), next };
  return { mode: "stay", place: lastDone ? legPlace(lastDone) : C.stops[0] };
}
const SPEED = { flight: 780, train: 85, road: 70 }; // km/h, rough averages
const DETOUR = { flight: 1.0, train: 1.25, road: 1.3 }; // roads and rails aren't straight lines
function eta(from, to, kind, spdMs) {
  const km = haversine(from, to) * DETOUR[kind];
  const live = spdMs != null && spdMs > 3 ? spdMs * 3.6 : null; // she's moving: use her real speed
  const kmh = live ? Math.min(live, SPEED[kind] * 1.6) : SPEED[kind];
  return { km: Math.round(km), ms: (km / kmh) * 36e5, live: !!live };
}
function nextTarget(st) {
  if (st.leg) return { name: st.leg.to, lat: st.leg.toLat, lon: st.leg.toLon, kind: st.leg.kind === "flight" ? "flight" : "train", leg: st.leg };
  const here = st.place;
  if (!here || here.lat == null) return null;
  // Nearest planned stop; if she's already there, the one after it.
  const ranked = C.stops.map((s, i) => ({ s, i, d: haversine(here, s) })).sort((a, b) => a.d - b.d);
  const near = ranked[0];
  const s = near.d <= 6 ? C.stops[near.i + 1] : near.s;
  if (!s) return null;
  const nextLeg = legs.find((l) => l.depT > Date.now() && l.to === s.name);
  return { name: s.name, lat: s.lat, lon: s.lon, stay: s.stay, kind: nextLeg ? (nextLeg.kind === "flight" ? "flight" : "train") : "road" };
}
function meNow() {
  const loc = latestLoc("me");
  if (loc) return livePlace(loc);
  return C.home;
}

// ---------- header ----------
function renderHeader() {
  const today = dateIn(C.home.tz), total = daysBetween(C.tripStart, C.tripEnd) + 1, dayN = daysBetween(C.tripStart, today) + 1;
  let sub;
  if (dayN < 1) sub = `${total} days, starting tonight`;
  else if (dayN > total) sub = `Home`;
  else { const left = daysBetween(today, C.tripEnd); sub = `Day <b>${dayN}</b> of ${total} · ${left === 0 ? "<b>home today</b>" : `<b>${left}</b> day${left > 1 ? "s" : ""} to go`}`; }
  $("sub").innerHTML = sub;
  $("days").innerHTML = Array.from({ length: total }, (_, i) => `<i class="${i + 1 <= dayN ? "on" : ""} ${i + 1 === dayN ? "today" : ""}">♥</i>`).join("");
}

// ---------- arrival banner ----------
function renderBanner() {
  const p = PINGS.find((x) => x.sender === "her" && (x.kind === "landed" || x.kind === "visit"));
  const box = $("banner");
  if (!p || Date.now() - Date.parse(p.created_at) > 6 * 36e5 || LS.get("bannerSeen", "") === p.created_at) { box.innerHTML = ""; return; }
  let text = "";
  if (p.kind === "landed") { const l = legs.find((x) => x.id === p.text); text = `✓ ${esc(C.her.name)} ${l && l.kind === "train" ? "arrived" : "landed"} safe${l ? " in " + esc(l.to) : ""}`; }
  else { try { text = `📍 ${esc(C.her.name)} arrived in ${esc(JSON.parse(p.text).city)}`; } catch { return; } }
  box.innerHTML = `<div class="banner"><span>${text}</span><span class="muted" style="color:inherit;opacity:.7;font-weight:400">${ago(p.created_at)}</span><button class="x" id="bannerX" aria-label="Dismiss">×</button></div>`;
  $("bannerX").onclick = () => { LS.set("bannerSeen", p.created_at); box.innerHTML = ""; };
}

// ---------- "your location isn't updating" (her phone only) ----------
let locBannerHidden = false; // hidden until the app is opened again
function renderLocBanner() {
  const box = $("locBanner");
  if (who !== "her" || !synced() || locBannerHidden || dateIn(C.home.tz) > C.tripEnd) { box.innerHTML = ""; return; }
  const blocked = LS.get("locBlocked", false), on = LS.get("shareLoc", false);
  const mine = latestLoc("her"), age = mine ? Date.now() - Date.parse(mine.at) : Infinity;
  if (on && !blocked && age < 30 * 6e4) { box.innerHTML = ""; return; }
  if (on && !blocked && watchId != null && age === Infinity) { box.innerHTML = ""; return; } // still finding her first fix
  const msg = blocked
    ? `📍 Your location is blocked. Go to Settings → Privacy &amp; Security → Location Services → <b>Safari Websites</b> → <b>While Using the App</b>, then tap Try again.`
    : `📍 Your location isn't updating, so your side can't show where you really are.`;
  box.innerHTML = `<div class="banner warn"><span style="flex:1 1 200px">${msg}</span>
    <button class="go" id="locGo">${blocked ? "Try again" : "Turn on"}</button><button class="x" id="locX" aria-label="Hide">×</button></div>`;
  $("locGo").onclick = () => {
    LS.set("locBlocked", false); LS.set("shareLoc", true); stopLoc(); startLoc(); renderLocToggle();
    box.innerHTML = `<div class="banner warn"><span>📍 Finding you… tap <b>Allow</b> if your iPhone asks.</span></div>`;
    setTimeout(renderLocBanner, 15000);
  };
  $("locX").onclick = () => { locBannerHidden = true; box.innerHTML = ""; };
}

// ---------- journey banner ----------
function arcSVG(l, t) {
  const W = 320, H = 100, pad = 26;
  const minLon = Math.min(l.fromLon, l.toLon), maxLon = Math.max(l.fromLon, l.toLon), minLat = Math.min(l.fromLat, l.toLat), maxLat = Math.max(l.fromLat, l.toLat);
  const sx = (lon) => pad + ((lon - minLon) / (maxLon - minLon || 1)) * (W - 2 * pad);
  const sy = (lat) => H - 22 - ((lat - minLat) / (maxLat - minLat || 1)) * (H - 50);
  const x1 = sx(l.fromLon), y1 = sy(l.fromLat), x2 = sx(l.toLon), y2 = sy(l.toLat), cx = (x1 + x2) / 2, cy = Math.min(y1, y2) - 30;
  const bx = (1 - t) ** 2 * x1 + 2 * (1 - t) * t * cx + t * t * x2, by = (1 - t) ** 2 * y1 + 2 * (1 - t) * t * cy + t * t * y2;
  return `<svg class="arc" viewBox="0 0 ${W} ${H}">
    <path d="M${x1},${y1} Q${cx},${cy} ${x2},${y2}" fill="none" stroke="#d9d1c6" stroke-width="1.5" stroke-dasharray="3 5"/>
    <circle cx="${x1}" cy="${y1}" r="3.5" fill="#1f1d1b"/><circle cx="${x2}" cy="${y2}" r="3.5" fill="#1f1d1b"/>
    <text x="${x1}" y="${y1 + 18}" text-anchor="middle" font-size="11" font-weight="600" fill="#7b746c" letter-spacing="1">${l.fromCode}</text>
    <text x="${x2}" y="${y2 + 18}" text-anchor="middle" font-size="11" font-weight="600" fill="#7b746c" letter-spacing="1">${l.toCode}</text>
    <circle cx="${bx}" cy="${by}" r="6" fill="#b8505c"/><circle cx="${bx}" cy="${by}" r="11" fill="#b8505c" opacity=".18"/></svg>`;
}
function renderJourney() {
  const now = Date.now(), st = herNow(now), box = $("journey");
  if (st.mode === "travel") {
    box.innerHTML = `<div class="card"><span class="label">Travel day</span>
      <div class="big">${esc(st.from.name)} → ${esc(st.place.name)}</div>
      ${st.place.stay ? `<div class="hand" style="font-size:22px;color:var(--accent)">${esc(st.place.stay)}</div>` : ""}
      <div class="muted" style="margin-top:6px">On her way today. Her side will update when she opens the app.</div></div>`;
    return;
  }
  if (st.mode === "live" && dateIn(C.home.tz) <= C.tripEnd && st.place.stay && !st.leg) {
    // She's at a place she's staying (e.g. her Levi Airbnb): show that, no "next stop" yet.
    const tz = st.place.tz || C.home.tz;
    const since = st.place.assumed
      ? `Probably here · her last update was ${ago(st.place.live)}`
      : st.place.estimated
      ? `Probably arrived around ${clockIn(tz, new Date(st.place.estimated))} local · ${clockIn(C.home.tz, new Date(st.place.estimated))} Singapore`
      : `Here now · last update ${ago(st.place.live)}`;
    box.innerHTML = `<div class="card"><span class="label">Staying at</span>
      <div class="big">${esc(st.place.name)}</div>
      <div class="hand" style="font-size:22px;color:var(--accent)">${esc(st.place.stay)}</div>
      <div class="muted" style="margin-top:6px">${since}</div></div>`;
    return;
  }
  if (st.mode === "live" && dateIn(C.home.tz) <= C.tripEnd) {
    const raw = latestLoc("her"), tgt = nextTarget(st);
    // If we've assumed she arrived somewhere, plan the next leg from there, standing still.
    const loc = raw && st.place.estimated ? { ...raw, lat: st.place.lat, lon: st.place.lon, spd: 0, at: new Date(st.place.estimated).toISOString() } : raw;
    if (tgt && loc && haversine(loc, tgt) > 3) {
      const e = eta(loc, tgt, tgt.kind, loc.spd);
      const locT = Date.parse(loc.at);
      const movingNow = loc.spd != null && loc.spd > 3;
      // While she's travelling, the clock keeps running from her last update.
      const arrive = new Date((movingNow || st.leg ? locT : now) + e.ms);
      const left = arrive.getTime() - now;
      const tzT = (st.leg && CODE_TZ[st.leg.toCode]) || (C.stops.find((s) => s.name === tgt.name) || {}).tz || C.home.tz;
      let bar = "";
      if (st.leg) {
        const total = haversine({ lat: st.leg.fromLat, lon: st.leg.fromLon }, tgt) || 1;
        const t = Math.max(0, Math.min(1, 1 - haversine(loc, tgt) / total));
        bar = `${arcSVG(st.leg, t)}<div class="bar"><i style="width:${(t * 100).toFixed(1)}%"></i></div>`;
      }
      const how = tgt.kind === "flight" ? "by air" : tgt.kind === "train" ? "by train" : "by road";
      const moving = loc.spd != null && loc.spd > 3;
      box.innerHTML = `<div class="card"><span class="label">${st.leg ? "On the way · live" : moving ? "On the way · live" : "Next stop"}</span>
        <div class="big">${st.leg ? `${esc(st.place.name)} → ${esc(tgt.name)}` : esc(tgt.name)}</div>
        ${tgt.stay ? `<div class="hand" style="font-size:22px;color:var(--accent)">${esc(tgt.stay)}</div>` : ""}
        ${bar}
        <div class="row" style="margin-top:8px"><span><b>${e.km.toLocaleString()} km</b> <span class="muted">${how}</span></span><b>${movingNow || st.leg ? (left > 60e3 ? `about ${fmtDur(left)} left` : "arriving now") : `about ${fmtDur(e.ms)}`}</b></div>
        ${st.leg && arrive.getTime() <= st.leg.arrT
          ? `${Date.now() - locT > 10 * 6e4 ? `<div class="muted">Estimated from her last update ${ago(loc.at)}</div>` : ""}<div class="muted">On track for the scheduled ${clockIn(tzT, new Date(st.leg.arrT))} local · ${clockIn(C.home.tz, new Date(st.leg.arrT))} Singapore</div>`
          : `<div class="muted">${st.leg ? "Running late? Live estimate:" : moving ? "At her current speed she arrives" : "If she left now:"} around ${clockIn(tzT, arrive)} local · ${clockIn(C.home.tz, arrive)} Singapore${e.live && !moving ? " (her current speed)" : ""}</div>
             ${moving && Date.now() - locT > 10 * 6e4 ? `<div class="muted">Estimated from her last update ${ago(loc.at)}</div>` : ""}
             ${st.leg ? `<div class="muted">Scheduled: ${clockIn(tzT, new Date(st.leg.arrT))} local</div>` : ""}`}</div>`;
      return;
    }
  }
  if (st.mode === "moving") {
    const l = st.leg, t = Math.min(1, (now - l.depT) / (l.arrT - l.depT));
    box.innerHTML = `<div class="card"><span class="label">${l.kind === "train" ? "On the train" : "In the air"} · ${l.code}</span>
      <div class="big">${l.kind === "train" ? "Sleep well on the train." : "Safe flight."}</div>
      ${arcSVG(l, t)}<div class="bar"><i style="width:${(t * 100).toFixed(1)}%"></i></div>
      <div class="row muted" style="margin-top:8px"><span>${l.from} → ${l.to}</span><span>${fmtDur(l.arrT - now)} left</span></div>
      <div class="muted">Arrives ${clockIn(CODE_TZ[l.toCode] || "UTC", new Date(l.arrT))} local · ${clockIn(C.home.tz, new Date(l.arrT))} Singapore</div></div>`;
    return;
  }
  const next = legs.find((l) => l.depT > now);
  if (next && next.depT - now < 30 * 36e5) {
    const tz = CODE_TZ[next.fromCode] || C.home.tz;
    box.innerHTML = `<div class="card"><span class="label">Next · ${next.code}</span>
      <div class="big">${next.from} → ${next.to}</div><div class="hand" style="font-size:22px;color:var(--accent)">Safe ${next.kind === "train" ? "trip" : "flight"}.</div>
      ${arcSVG(next, 0)}
      <div class="row muted"><span>Departs ${clockIn(tz, new Date(next.depT))} local${tz !== C.home.tz ? ` · ${clockIn(C.home.tz, new Date(next.depT))} SG` : ""}</span><b style="color:var(--ink)">in ${fmtDur(next.depT - now)}</b></div></div>`;
    return;
  }
  box.innerHTML = "";
}

// ---------- the two sides ----------
async function fillHalf(el, sender, place, extra = "") {
  const d = await weather(place);
  const tz = place.tz || (d && d.timezone) || C.home.tz;
  const h = hourIn(tz);
  const status = h < 7 ? "Probably asleep" : h >= 23 ? "Late night" : h < 12 ? "Morning" : h < 18 ? "Afternoon" : "Evening";
  let wx = `<div class="sm" style="margin-top:14px">Weather unavailable</div>`;
  if (d) {
    const c = d.current, [ico, txt] = WX[c.weather_code] || ["", ""];
    el.className = `half ${c.is_day ? "day" : "night"} ${c.temperature_2m < 15 ? "cold" : "warm"}`;
    wx = `<div class="wxrow"><span class="temp">${Math.round(c.temperature_2m)}°</span><span class="ico">${ico}</span></div>
      <div class="sm">${txt} · feels ${Math.round(c.apparent_temperature)}°</div>
      <div class="meta">Sunrise ${hhmm(d.daily.sunrise[0])} · Sunset ${hhmm(d.daily.sunset[0])}<br>${daylight(d.daily.daylight_duration[0])} of daylight</div>`;
  }
  el.innerHTML = `<div class="label">${esc(nameOf(sender))}</div>
    <div class="place">${place.flag || ""} ${esc(place.name)}</div>
    ${place.stay && sender === "her" ? `<div class="sm">${esc(place.stay.split(" · ")[0])}</div>` : ""}
    ${place.live && sender === "her" ? `<a class="sm" style="color:inherit;text-decoration:underline" href="https://maps.apple.com/?ll=${place.lat},${place.lon}&q=${encodeURIComponent(nameOf("her"))}" target="_blank" rel="noopener">Open in Maps</a>` : ""}
    ${place.travelling ? `<div class="sm" style="margin-top:3px">On her way here today</div>` : ""}
    ${place.assumed ? `<div class="sm" style="margin-top:3px">Probably here · last update ${ago(place.live)}</div>` : ""}
    ${place.estimated ? `<div class="sm" style="margin-top:3px">Probably arrived around ${clockIn(place.tz || C.home.tz, new Date(place.estimated))} · last update ${ago(place.live)}</div>` : ""}
    ${place.live && !place.estimated && !place.assumed ? `<div class="live" ${Date.now() - Date.parse(place.live) > 20 * 6e4 ? 'style="opacity:.6"' : ""}>${Date.now() - Date.parse(place.live) > 20 * 6e4 ? "Last seen" : "Live"} · ${ago(place.live)}</div>` : ""}
    <div class="clock" data-tz="${tz}">${clockIn(tz)}</div><div class="sm">${dayName(tz)}</div>
    ${wx}${extra}<div class="status">${status}</div>`;
  return d ? { d, tz } : { d: null, tz };
}
async function renderSplit() {
  const st = herNow(), mine = meNow();
  const a = await fillHalf($("hMe"), "me", mine);
  let herPos, b = null;
  if (st.mode === "moving") {
    const l = st.leg, t = (Date.now() - l.depT) / (l.arrT - l.depT), el = $("hHer");
    el.className = "half night";
    el.innerHTML = `<div class="label">${esc(C.her.name)}</div><div class="place">${l.kind === "train" ? "On the night train" : "In the air"}</div>
      <div class="clock" data-tz="${CODE_TZ[l.toCode] || "UTC"}">${clockIn(CODE_TZ[l.toCode] || "UTC")}</div><div class="sm">${l.to} time</div>
      <div class="sm" style="margin-top:14px">${l.from} → ${l.to}</div><div class="status">${fmtDur(l.arrT - Date.now())} left</div>`;
    herPos = { lat: l.fromLat + (l.toLat - l.fromLat) * t, lon: l.fromLon + (l.toLon - l.fromLon) * t };
  } else {
    const extra = st.mode === "layover" ? `<div class="sm" style="margin-top:6px">Layover · next ${st.next.code}</div>` : "";
    b = await fillHalf($("hHer"), "her", st.place, extra);
    herPos = st.place;
  }
  const bits = [];
  const km = haversine(mine, herPos);
  if (km > 5) bits.push(`<span><b>${km.toLocaleString()}</b> km between us</span>`);
  if (a.d && b && b.d && km > 5) {
    const diff = Math.round(a.d.current.temperature_2m - b.d.current.temperature_2m);
    bits.push(`<span><b>${Math.abs(diff)}°</b> ${diff >= 0 ? "colder" : "warmer"} there</span>`);
    const tzd = tzOffsetH(a.tz) - tzOffsetH(b.tz);
    if (tzd) bits.push(`<span><b>${Math.abs(tzd)}h</b> ${tzd > 0 ? "behind" : "ahead"}</span>`);
  }
  $("between").innerHTML = bits.join("");
}

// ---------- places ----------
let selStop = null;
function visits() {
  // One entry per town her phone reported, oldest first.
  const seen = new Map();
  [...PINGS].reverse().filter((p) => p.sender === "her" && p.kind === "visit").forEach((p) => {
    try { const v = JSON.parse(p.text); const k = (v.city || "").toLowerCase(); if (k && !seen.has(k)) seen.set(k, { ...v, since: p.created_at }); } catch {}
  });
  return [...seen.values()].map((v, i) => ({ id: "v" + i, name: v.city === "Kittila" ? "Kittilä" : v.city, flag: flag(v.cc), lat: v.lat, lon: v.lon, tz: null, since: v.since }));
}
let PLACES = [];
function renderChips() {
  const st = herNow(), cur = st.place && st.place.name;
  // Places she's been: stops marked as visited in config, plus towns her phone reported, oldest first.
  const fromConfig = C.stops.filter((s) => s.visited).map((s) => ({ ...s, since: s.visited.includes("T") ? s.visited : s.visited + "T12:00:00Z" }));
  const merged = new Map();
  [...fromConfig, ...visits()].forEach((v) => { const k = v.name.toLowerCase(); if (!merged.has(k)) merged.set(k, v); });
  const been = [...merged.values()].sort((x, y) => Date.parse(x.since) - Date.parse(y.since));
  const beenNames = new Set(been.map((v) => v.name.toLowerCase()));
  const planned = C.stops.filter((s) => !beenNames.has(s.name.toLowerCase())).map((s) => ({ ...s, planned: true }));
  PLACES = [{ ...C.home, id: "home", homeChip: true }, ...been, ...planned];
  $("chips").innerHTML = PLACES.map((s) => `<button class="chip ${selStop === s.id ? "sel" : ""}" data-id="${s.id}" ${s.planned ? 'style="border-style:dashed"' : ""}>${s.flag} ${esc(s.name)}${!s.homeChip && s.name === cur ? '<span class="here">now</span>' : ""}
    <span class="d">${s.homeChip ? "Home" : s.since ? "Since " + new Date(s.since).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "Planned"}</span></button>`).join("");
  $("chips").querySelectorAll(".chip").forEach((b) => (b.onclick = () => showStop(b.dataset.id)));
}
async function showStop(id) {
  selStop = selStop === id ? null : id; renderChips();
  const box = $("stopInfo");
  if (!selStop) { box.innerHTML = ""; return; }
  const s = PLACES.find((p) => p.id === id);
  box.innerHTML = `<div class="muted" style="margin-top:12px">Loading…</div>`;
  const d = await weather(s);
  if (!d) { box.innerHTML = `<div class="muted" style="margin-top:12px">Couldn't get the weather right now.</div>`; return; }
  const tz = s.tz || d.timezone;
  const c = d.current, [ico, txt] = WX[c.weather_code] || ["", ""];
  box.innerHTML = `<div style="display:flex;gap:14px;align-items:center;margin-top:14px">
      <div class="serif" style="font-size:44px;line-height:1">${Math.round(c.temperature_2m)}°</div>
      <div><div>${ico} ${txt}</div>
      <div class="muted">High ${Math.round(d.daily.temperature_2m_max[0])}° · Low ${Math.round(d.daily.temperature_2m_min[0])}° · Wind ${Math.round(c.wind_speed_10m)} km/h</div>
      <div class="muted">${clockIn(tz)} local · ${daylight(d.daily.daylight_duration[0])} of daylight</div></div></div>
    ${s.note ? `<div class="muted" style="margin-top:10px">${s.note}</div>` : ""}
    ${who === "her" && s.planned && synced() ? `<button class="btn small ghost" style="margin-top:12px" id="hereBtn">I'm here now</button>` : ""}`;
  const hb = $("hereBtn");
  if (hb) hb.onclick = async () => { await safe(() => store.addPing("here", id)); toast(`Checked in: ${s.name}`); await refreshPings(); renderAll(); };
}

// ---------- aurora ----------
let kpCache = null;
async function kpNext12h() {
  if (kpCache && Date.now() - kpCache.t < 30 * 6e4) return kpCache.v;
  try {
    const rows = await (await fetch("https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json")).json();
    const now = Date.now();
    const vals = rows.filter((r) => (Array.isArray(r) ? r[0] !== "time_tag" : true))
      .map((r) => (Array.isArray(r) ? { t: Date.parse(r[0].replace(" ", "T") + "Z"), kp: +r[1] } : { t: Date.parse(r.time_tag + "Z"), kp: +r.kp }))
      .filter((x) => x.t > now - 3 * 36e5 && x.t < now + 12 * 36e5 && !isNaN(x.kp));
    const v = vals.length ? Math.max(...vals.map((x) => x.kp)) : null;
    kpCache = { t: Date.now(), v }; return v;
  } catch { return null; }
}
async function renderAurora() {
  const st = herNow(), box = $("auroraBox"), p = st.place || {};
  const nt = nextTarget(st);
  const target = p.lat >= 64 ? p : nt && nt.lat >= 64 ? nt : C.stops.find((s) => s.stay) || C.stops.find((s) => s.lat >= 64);
  if (!target) { box.innerHTML = ""; return; }
  const [kp, d] = await Promise.all([kpNext12h(), weather(target)]);
  const cloud = d ? d.current.cloud_cover : 50, dark = d ? !d.current.is_day : true;
  const kpF = kp == null ? 0.4 : Math.min(1, (kp + 1) / 5);
  const score = Math.round(kpF * (1 - cloud / 100) * (dark ? 1 : 0.35) * 100);
  const verdict = score > 55 ? "Strong chance. Look up ✨" : score > 30 ? "Decent chance tonight" : score > 12 ? "Low chance" : "Unlikely tonight. Cosy night in?";
  box.innerHTML = `<div class="card aurora"><span class="label">Aurora · ${esc(target.name)}</span>
    <div class="row"><span class="serif" style="font-size:40px;line-height:1">${score}%</span><span>${verdict}</span></div>
    <div class="meter"><i style="width:${score}%"></i></div>
    <div style="font-size:12px;opacity:.75">Kp ${kp == null ? "–" : kp.toFixed(1)} next 12h · ${cloud}% cloud · ${dark ? "dark now" : "daylight now"}. A rough estimate, not a forecast.</div></div>`;
}

// ---------- coming up ----------
function renderPlans() {
  const box = $("plansBox"), list = C.plans || [];
  const now = Date.now();
  const items = list.map((p) => {
    const a = zoned(p.start, p.tz), b = p.end ? zoned(p.end, p.tz) : new Date(a.getTime() + 2 * 36e5);
    return { ...p, a, b };
  }).filter((p) => p.b.getTime() > now).slice(0, 4);
  if (!items.length) { box.hidden = true; return; }
  box.hidden = false;
  const day = (d, tz) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short", day: "numeric", month: "short" }).format(d);
  $("plans").innerHTML = items.map((p) => {
    const nowOn = now >= p.a.getTime() && now < p.b.getTime();
    const herT = `${clockIn(p.tz, p.a)}${p.end ? "–" + clockIn(p.tz, p.b) : ""}`;
    const sgT = `${clockIn(C.home.tz, p.a)}${p.end ? "–" + clockIn(C.home.tz, p.b) : ""}`;
    return `<div class="plan ${nowOn ? "now" : ""}"><div class="when"><b>${nowOn ? "Now" : day(p.a, p.tz)}</b>${herT} her time</div>
      <div class="what"><div style="font-weight:500">${esc(p.title)}</div>
      <div class="muted">${p.sub ? esc(p.sub) + " · " : ""}${sgT} Singapore</div>
      ${p.free ? `<span class="free">Good time to call</span>` : ""}</div></div>`;
  }).join("");
}

// ---------- best time to call ----------
async function renderCall() {
  const st = herNow(), box = $("callWin");
  if (st.mode === "moving") { box.innerHTML = `<div class="muted">She's ${st.leg.kind === "train" ? "on the train" : "in the air"}. Call after she arrives.</div>`; return; }
  if (st.mode === "before" || st.mode === "home") { box.innerHTML = `<div class="muted">Same time zone.</div>`; return; }
  let tz = st.place.tz;
  if (!tz) { const d = await weather(st.place); tz = (d && d.timezone) || "UTC"; }
  const myTz = meNow().tz || C.home.tz;
  const start = new Date(); start.setMinutes(start.getMinutes() < 30 ? 0 : 30, 0, 0);
  const slots = Array.from({ length: 48 }, (_, i) => { const t = new Date(start.getTime() + i * 18e5); const ok = (z) => { const h = hourIn(z, t); return h >= 8; }; return { t, ok: ok(myTz) && ok(tz) }; });
  const runs = []; let cur = null;
  for (const s of slots) { if (s.ok && !cur) cur = { a: s.t }; if (!s.ok && cur) { cur.b = s.t; runs.push(cur); cur = null; } }
  if (cur) { cur.b = new Date(slots[slots.length - 1].t.getTime() + 18e5); runs.push(cur); }
  const r = runs[0];
  if (!r) { box.innerHTML = `<div class="muted">No overlap in the next 24 hours.</div>`; return; }
  const nowIn = Date.now() >= r.a.getTime();
  box.innerHTML = `<div style="font-weight:500">${nowIn ? "Now is good" : "Next good window"}</div>
    <div class="row" style="margin-top:8px"><span class="muted">${C.home.name}</span><span>${clockIn(myTz, r.a)} – ${clockIn(myTz, r.b)}</span></div>
    <div class="row"><span class="muted">${esc(st.place.name)}</span><span>${clockIn(tz, r.a)} – ${clockIn(tz, r.b)}</span></div>
    <div class="muted" style="margin-top:8px">When you're both awake (8 am to midnight).</div>`;
}

// ---------- notes ----------
function renderNotes() {
  const today = dateIn(C.home.tz), dayN = daysBetween(C.tripStart, today) + 1, total = C.notes.length, opened = LS.get("opened", []);
  const box = $("noteBox");
  if (dayN < 1) box.innerHTML = `<div class="muted">The first note opens on ${prettyDate(C.tripStart)}.</div>`;
  else {
    const i = Math.min(dayN, total) - 1;
    box.innerHTML = `<button class="note-btn" id="env"><span><span class="hand" style="font-size:28px;color:#4a2a33">A note for Day ${i + 1}</span><br><span class="muted">${opened.includes(i) ? "Read again" : "Unopened"}</span></span><span style="color:var(--accent);font-size:26px">💌</span></button>`;
    $("env").onclick = () => openNote(i);
  }
  $("past").innerHTML = C.notes.map((_, i) => `<button class="${i + 1 > dayN ? "locked" : opened.includes(i) ? "read" : ""}" data-i="${i}">${i + 1}</button>`).join("");
  $("past").querySelectorAll("button").forEach((b) => (b.onclick = () => {
    const i = +b.dataset.i;
    if (i + 1 > dayN) return toast(`Opens ${prettyDate(new Date(Date.parse(C.tripStart) + i * 864e5).toISOString().slice(0, 10))}`);
    openNote(i);
  }));
}
function openNote(i) {
  const opened = LS.get("opened", []); if (!opened.includes(i)) { opened.push(i); LS.set("opened", opened); }
  sheet(`<div class="label">Day ${i + 1}</div><div class="letter" style="margin-top:12px">${esc(C.notes[i])}</div>
    <button class="btn" style="width:100%;margin-top:20px" id="closeS">Close</button>`);
  $("closeS").onclick = closeSheet; for (let k = 0; k < 3; k++) setTimeout(() => float(innerWidth / 2 + (k - 1) * 40, innerHeight * 0.6), k * 150); renderNotes();
}

// ---------- between us ----------
const MOODS = [["🥰", "missing you"], ["😴", "sleepy"], ["🥶", "freezing"], ["🍜", "eating"], ["🎉", "having fun"], ["🥺", "need a hug"]];
function renderLove() {
  $("moods").innerHTML = MOODS.map(([e, t]) => `<button data-e="${e}" data-t="${t}" aria-label="${t}">${e}</button>`).join("");
  $("moods").querySelectorAll("button").forEach((b) => (b.onclick = async () => {
    await safe(() => store.addPing("mood", `${b.dataset.e} ${b.dataset.t}`)); toast(`Sent ${b.dataset.e}`); refreshPings();
  }));
  $("heartBtn").onclick = async (e) => {
    for (let k = 0; k < 3; k++) setTimeout(() => float(e.clientX + (k - 1) * 18, e.clientY), k * 120); if (navigator.vibrate) navigator.vibrate(20);
    await safe(() => store.addPing("heart")); toast(`♥ sent to ${otherName()}`); refreshPings();
  };
}
function evText(p) {
  const n = `<span class="who">${esc(nameOf(p.sender))}</span>`;
  if (p.kind === "heart") return `${n} sent a ♥`;
  if (p.kind === "mood") return `${n} is ${esc(p.text)}`;
  if (p.kind === "landed") { const l = legs.find((x) => x.id === p.text); return `${n} ${l && l.kind === "train" ? "arrived" : "landed"} safe${l ? " in " + esc(l.to) : ""}`; }
  if (p.kind === "here") { const s = stopById(p.text); return `${n} checked in at ${s ? esc(s.name) : "a new place"}`; }
  if (p.kind === "postcard") return `${n} sent a postcard`;
  if (p.kind === "visit") { try { return `${n} arrived in ${esc(JSON.parse(p.text).city)}`; } catch { return ""; } }
  return "";
}
let actPage = 0;
const PER_PAGE = 10;
function renderActivity() {
  const items = PINGS.filter((p) => p.kind !== "loc" && evText(p));
  const pages = Math.max(1, Math.ceil(items.length / PER_PAGE));
  if (actPage > pages - 1) actPage = pages - 1;
  const shown = items.slice(actPage * PER_PAGE, actPage * PER_PAGE + PER_PAGE);
  const list = shown.length
    ? shown.map((p) => `<div class="ev"><span>${evText(p)}</span><span class="t">${ago(p.created_at)}</span></div>`).join("")
    : `<div class="ev"><span class="muted">${synced() ? "Nothing yet." : "Not synced yet, so this only shows what happens on this phone."}</span></div>`;
  const nav = pages > 1
    ? `<div class="pager"><button class="btn small ghost" id="pgNewer" ${actPage === 0 ? "disabled" : ""}>← Newer</button>
        <span class="muted">Page ${actPage + 1} of ${pages}</span>
        <button class="btn small ghost" id="pgOlder" ${actPage >= pages - 1 ? "disabled" : ""}>Older →</button></div>`
    : "";
  $("activity").innerHTML = list + nav;
  if ($("pgNewer")) $("pgNewer").onclick = () => { actPage = Math.max(0, actPage - 1); renderActivity(); };
  if ($("pgOlder")) $("pgOlder").onclick = () => { actPage = Math.min(pages - 1, actPage + 1); renderActivity(); };
}

// ---------- postcards ----------
async function compress(file, max) {
  const img = await createImageBitmap(file).catch(() => null);
  if (!img) throw new Error("couldn't read that photo");
  const s = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement("canvas"); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return await new Promise((r) => c.toBlob(r, "image/jpeg", 0.82));
}
let PCS = [];
async function renderFeed() {
  PCS = await store.postcards();
  const feed = $("feed");
  if (!PCS.length) { feed.className = "feed"; feed.innerHTML = `<div class="muted">No postcards yet.</div>`; $("pcount").textContent = ""; return; }
  feed.className = "feed strip";
  feed.innerHTML = PCS.map((p, i) => `<div class="pc" data-i="${i}"><img src="${p.url}" loading="lazy" alt="">${p.caption ? `<div class="cap">${esc(p.caption)}</div>` : ""}
    <div class="by">${esc(nameOf(p.sender))} · ${ago(p.created_at)}</div></div>`).join("");
  const count = () => {
    const w = feed.firstElementChild ? feed.firstElementChild.getBoundingClientRect().width + 12 : 1;
    const i = Math.min(PCS.length - 1, Math.round(feed.scrollLeft / w));
    $("pcount").textContent = PCS.length > 1 ? `${i + 1} of ${PCS.length} · swipe for more` : "";
  };
  feed.onscroll = count; count();
  feed.querySelectorAll(".pc").forEach((el) => (el.onclick = () => {
    const p = PCS[+el.dataset.i];
    sheet(`<div class="pcfull"><img src="${p.url}" alt="">${p.caption ? `<div class="cap" style="font-family:Caveat,cursive;font-size:26px;margin-top:10px">${esc(p.caption)}</div>` : ""}
      <div class="muted" style="margin-top:4px">${esc(nameOf(p.sender))} · ${ago(p.created_at)}</div>
      <button class="btn" style="width:100%;margin-top:16px" id="closeS">Close</button></div>`);
    $("closeS").onclick = closeSheet;
  }));
}
function wireUpload() {
  $("file").onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    toast("Sending…");
    try {
      const blob = await compress(f, synced() ? 1400 : 800);
      await store.addPostcard(blob, $("cap").value.trim());
      await store.addPing("postcard");
      $("cap").value = ""; toast("Postcard sent"); renderFeed(); refreshPings();
    } catch (err) { toast("Couldn't send: " + (err.message || err)); }
    e.target.value = "";
  };
}

// ---------- journey legs ----------
function renderLegs() {
  const now = Date.now();
  $("legs").innerHTML = legs.map((l) => {
    const state = now >= l.arrT ? "done" : now >= l.depT ? "now" : "";
    const landed = PINGS.find((p) => p.kind === "landed" && p.text === l.id);
    const tzF = CODE_TZ[l.fromCode] || "UTC", tzT = CODE_TZ[l.toCode] || "UTC";
    let action = "";
    if (now >= l.arrT - 30 * 6e4) {
      if (landed) action = `<span class="ok">${l.kind === "train" ? "Arrived" : "Landed"} safe · ${ago(landed.created_at)}</span>`;
      else if (who === "her" && synced()) action = `<button class="btn small" style="margin-top:8px" data-land="${l.id}">${l.kind === "train" ? "I've arrived" : "I've landed"}</button>`;
    }
    return `<div class="leg ${state}"><div class="dot"></div><div style="flex:1">
      <div><b style="font-weight:600">${l.from} → ${l.to}</b> <span class="muted">${l.code}</span></div>
      <div class="muted">${dayName(tzF, new Date(l.depT))}, ${clockIn(tzF, new Date(l.depT))} → ${clockIn(tzT, new Date(l.arrT))} local${l.detail ? " · " + l.detail : ""}</div>
      ${tzF !== C.home.tz ? `<div class="muted">Singapore time ${clockIn(C.home.tz, new Date(l.depT))} → ${clockIn(C.home.tz, new Date(l.arrT))}</div>` : ""}${action}</div></div>`;
  }).join("");
  $("legs").querySelectorAll("[data-land]").forEach((b) => (b.onclick = async () => {
    if (b.disabled) return; b.disabled = true; b.textContent = "Sending… ✓";
    await safe(() => store.addPing("landed", b.dataset.land)); toast("Sent"); await refreshPings(); renderLegs();
  }));
}

// ---------- UI bits ----------
function toast(t) { const el = $("toast"); el.textContent = t; el.classList.add("show"); clearTimeout(toast.h); toast.h = setTimeout(() => el.classList.remove("show"), 2200); }
function float(x = innerWidth / 2, y = innerHeight / 2) {
  const s = document.createElement("div"); s.className = "floaty"; s.textContent = "♥";
  s.style.left = x - 8 + "px"; s.style.top = y - 20 + "px"; document.body.appendChild(s); setTimeout(() => s.remove(), 1700);
}
function sheet(html) { $("sheetIn").innerHTML = html; $("sheet").classList.add("open"); }
function closeSheet() { $("sheet").classList.remove("open"); }
$("sheet").onclick = (e) => { if (e.target.id === "sheet" && who) closeSheet(); };
async function safe(fn) { try { await fn(); } catch (e) { toast("That didn't send. Check your connection."); console.error(e); } }
function setup() {
  sheet(`<div class="center"><div class="heart serif" style="font-size:34px">♥</div>
      <div class="serif" style="font-size:26px;line-height:1.1;margin-top:6px">Set up this phone</div></div>
    <div style="margin-top:18px;font-weight:500;font-size:14px">Who's using this phone?</div>
    <div class="who2">
      <button class="btn ${who === "her" ? "" : "ghost"}" data-w="her">${esc(C.her.name)}</button>
      <button class="btn ${who === "me" ? "" : "ghost"}" data-w="me">${esc(C.me.name)}</button></div>
    ${configured ? `<div style="margin-top:18px;font-weight:500;font-size:14px">Pairing code</div>
    <div class="muted" style="font-size:12px">Type the same secret phrase on both phones to link them.</div>
    <input id="pairIn" placeholder="A phrase only you two know" value="${esc(pairCode)}" autocapitalize="off" autocomplete="off" autocorrect="off" spellcheck="false">` : ""}
    <button class="btn" style="width:100%;margin-top:20px" id="saveSetup">Done</button>`);
  let pick = who;
  $("sheetIn").querySelectorAll("[data-w]").forEach((b) => (b.onclick = () => {
    pick = b.dataset.w; $("sheetIn").querySelectorAll("[data-w]").forEach((x) => x.classList.toggle("ghost", x !== b));
  }));
  $("saveSetup").onclick = async () => {
    if (!pick) return toast("Choose who's using this phone");
    const code = $("pairIn") ? $("pairIn").value.trim() : "";
    if (configured && code.length < 8) return toast("Use a pairing code of 8+ characters");
    who = pick; LS.set("who", who);
    if (code !== pairCode) { pairCode = code; LS.set("pair", code); LS.set("lastSeen", 0); lastSeen = 0; await initStore(); }
    closeSheet(); await refreshPings(); renderAll(); renderFeed();
  };
}

// ---------- refresh ----------
let lastSeen = LS.get("lastSeen", 0);
async function refreshPings() {
  PINGS = await store.pings();
  const fresh = PINGS.filter((p) => p.sender !== who && Date.parse(p.created_at) > lastSeen && p.kind !== "loc");
  if (fresh.length && lastSeen) { const p = fresh[0]; toast(evText(p).replace(/<[^>]+>/g, "")); if (p.kind === "heart") float(); }
  if (PINGS[0]) { lastSeen = Math.max(lastSeen, Date.parse(PINGS[0].created_at)); LS.set("lastSeen", lastSeen); }
  renderActivity(); renderBanner(); renderLocBanner();
}
function tickClocks() { document.querySelectorAll(".clock[data-tz]").forEach((el) => (el.textContent = clockIn(el.dataset.tz))); }
function renderAll() {
  const two = synced();
  ["locCard", "loveCard", "pcCard"].forEach((id) => ($(id).hidden = !two));
  renderHeader(); renderBanner(); renderLocBanner(); renderJourney(); renderChips(); renderNotes(); renderLegs(); renderActivity(); renderLocToggle();
  $("mode").textContent = `${who ? "This phone: " + nameOf(who) : "Not set up"}${synced() ? " · synced ♡" : ""}`;
  renderSplit(); renderAurora(); renderCall(); renderPlans();
}

// ---------- refresh (button + swipe down) ----------
let refreshing = false;
async function hardRefresh() {
  if (refreshing) return; refreshing = true;
  const p = $("ptr"); p.classList.add("spin"); p.style.opacity = 1; p.style.transform = "translate(-50%,0)";
  try {
    const reg = navigator.serviceWorker && (await navigator.serviceWorker.getRegistration());
    if (reg) await reg.update().catch(() => {});
  } catch {}
  // A full reload always picks up the newest version and the newest data.
  setTimeout(() => location.reload(), 350);
}
function wirePullToRefresh() {
  $("refreshBtn").onclick = hardRefresh;
  let y0 = null, pulled = 0;
  const p = $("ptr");
  addEventListener("touchstart", (e) => { y0 = scrollY <= 0 && !$("sheet").classList.contains("open") ? e.touches[0].clientY : null; pulled = 0; }, { passive: true });
  addEventListener("touchmove", (e) => {
    if (y0 == null || refreshing) return;
    pulled = Math.max(0, e.touches[0].clientY - y0);
    const d = Math.min(pulled, 110);
    p.style.opacity = Math.min(1, d / 70);
    p.style.transform = `translate(-50%,${d * 0.6 - 60}px) rotate(${d * 3}deg)`;
  }, { passive: true });
  addEventListener("touchend", () => {
    if (y0 == null || refreshing) return;
    if (pulled > 80) hardRefresh();
    else { p.style.opacity = 0; p.style.transform = "translate(-50%,-60px)"; }
    y0 = null;
  });
}

// ---------- boot ----------
(async function boot() {
  await initStore();
  renderLove(); wireUpload(); wirePullToRefresh();
  $("whoBtn").onclick = setup;
  $("locSwitch").onclick = () => {
    const on = !LS.get("shareLoc", false); LS.set("shareLoc", on); LS.set("locBlocked", false);
    if (on) startLoc(); else stopLoc();
    renderLocToggle();
  };
  if (LS.get("shareLoc", false) && synced()) startLoc();
  await refreshPings().catch(() => {});
  renderAll(); renderFeed();
  if (!who || (configured && !pairCode)) setup();
  const standalone = navigator.standalone || matchMedia("(display-mode: standalone)").matches;
  if (/iphone|ipad|ipod/i.test(navigator.userAgent) && !standalone) $("installCard").hidden = false;
  setInterval(tickClocks, 15e3);
  setInterval(() => { if (!document.hidden) { renderHeader(); renderJourney(); } }, 30e3);
  setInterval(() => { if (!document.hidden) { refreshPings(); renderLegs(); } }, 60e3); // backup to the instant nudges
  setInterval(() => { if (!document.hidden) { renderSplit(); renderAurora(); renderCall(); } }, 10 * 6e4);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { locBannerHidden = false; refreshPings().then(() => { renderAll(); renderFeed(); }); } });
  if ("serviceWorker" in navigator) {
    // When a new version is published, swap to it automatically (once).
    let reloaded = false;
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener("controllerchange", () => { if (hadController && !reloaded) { reloaded = true; location.reload(); } });
    navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).then((reg) => {
      reg.update().catch(() => {});
      document.addEventListener("visibilitychange", () => { if (!document.hidden) reg.update().catch(() => {}); });
    }).catch(() => {});
  }
})();
