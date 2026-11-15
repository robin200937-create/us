// ============================================================
//  EDIT THIS FILE — everything personal lives here.
// ============================================================
window.LOVE_CONFIG = {
  me:  { name: "Home", emoji: "🏠" },   // shown as "Home" on screen
  her: { name: "Diyanah", emoji: "👩🏽" },

  // Home base
  home: { name: "Singapore", lat: 1.3521, lon: 103.8198, tz: "Asia/Singapore", flag: "🇸🇬" },

  // Trip window (Singapore dates). 14 Nov → 25 Nov = 12 days.
  tripStart: "2026-11-14",
  tripEnd:   "2026-11-25",

  // ---- Places she's expected to visit (no dates needed).
  // Her side follows her phone's real location when she shares it; these are
  // only a fallback, and she can tap one and choose "I'm here now".
  stops: [
    { id: "hel", name: "Helsinki",  country: "Finland", flag: "🇫🇮", lat: 60.1699, lon: 24.9384, tz: "Europe/Helsinki", visited: "2026-11-14T11:55:00Z",
      note: "Lands 1:55 pm." },
    { id: "rov", name: "Rovaniemi", country: "Finland", flag: "🇫🇮", lat: 66.5039, lon: 25.7294, tz: "Europe/Helsinki", visited: "2026-11-15T05:20:00Z",
      note: "Night train from Helsinki, then the bus north. On the Arctic Circle." },
    { id: "lev", name: "Levi",      country: "Finland", flag: "🇫🇮", lat: 67.8058, lon: 24.8085, tz: "Europe/Helsinki",
      stay: "Her Airbnb · staying 5–6 nights", note: "Lapland fell resort near Kittilä. Her Airbnb for 5–6 nights, then on to Tromsø." },
    { id: "tos", name: "Tromsø",    country: "Norway",  flag: "🇳🇴", lat: 69.6496, lon: 18.9560, tz: "Europe/Oslo",
      note: "The villa, 5 km from the Fjellheisen cable car." },
  ],

  // ---- Travel legs (times include their local UTC offset).
  legs: [
    { id: "ek349", kind: "flight", code: "EK 349", from: "Singapore", fromCode: "SIN", to: "Dubai", toCode: "DXB",
      dep: "2026-11-14T02:30:00+08:00", arr: "2026-11-14T06:00:00+04:00",
      fromLat: 1.3644, fromLon: 103.9915, toLat: 25.2532, toLon: 55.3657, detail: "T1 → T3 · 7h 30m" },
    { id: "ek167", kind: "flight", code: "EK 167", from: "Dubai", fromCode: "DXB", to: "Helsinki", toCode: "HEL",
      dep: "2026-11-14T08:25:00+04:00", arr: "2026-11-14T13:55:00+02:00",
      fromLat: 25.2532, fromLon: 55.3657, toLat: 60.3172, toLon: 24.9633, detail: "A350 · 7h 30m (confirm on her booking)" },
    { id: "vr265", kind: "train", code: "Santa Claus Express", from: "Helsinki", fromCode: "HKI", to: "Rovaniemi", toCode: "ROI",
      dep: "2026-11-14T19:29:00+02:00", arr: "2026-11-15T07:20:00+02:00",
      fromLat: 60.1719, fromLon: 24.9414, toLat: 66.4987, toLon: 25.7123, detail: "Night sleeper · likely train (or the 23:13) — CONFIRM" },
    // Add the Rovaniemi → Tromsø leg and the flights home here once known, e.g.
    // { id: "home1", kind: "flight", code: "EK 168", from: "Helsinki", fromCode: "HEL", to: "Dubai", toCode: "DXB",
    //   dep: "2026-11-24T15:45:00+02:00", arr: "2026-11-25T00:20:00+04:00", fromLat: 60.3172, fromLon: 24.9633, toLat: 25.2532, toLon: 55.3657 },
  ],

  // ---- One note per day. Day 1 = 14 Nov. Unlocks at midnight Singapore time.
  notes: [
    "You're somewhere over the ocean right now and I'm already counting. Drink water, sleep a little, and message me when you land.",
    "You woke up above the Arctic Circle. Tell me what it looks like out the window.",
    "Can you please make sure that you wear your thermals and keep yourself warm? I miss you so much.",
    "If you see a reindeer, I need a photo. Non-negotiable.",
    "You're seeing real snow right now. Send me one photo of it and I'll send you one of the rain here.",
    "Look up tonight. Same sky, just a lot colder on your side.",
    "Halfway. Six more days.",
    "Take one photo of the view for me, then put the phone away and just be there.",
    "Hope today is the kind of day you'll still be talking about years from now.",
    "I miss the small stuff the most. Hearing your voice on FaceTime before we sleep.",
    "One more sleep, and we can finally FaceTime each other properly to sleep.",
    "Coming home today. Safe flight. I'll be at arrivals.",
  ],

  // ---- Sync between the two phones. See SETUP.md (about 10 minutes).
  // Safe to commit to GitHub: the data is only reachable with the pairing code
  // you both type into the app, and that code is never stored in this repo.
  supabaseUrl: "https://mvfcqkofudledaudkqmt.supabase.co",
  supabaseAnonKey: "sb_publishable_Kco4JuBc9coRFm27r1-NWw_7e32o0yj",
};
