// Opening hours: parse the sheet's free Hebrew text and Google periods into one weekly shape,
// then answer "open now?" and "when does it change?".
// Shape: { periods: [{d, s, e}], approx: bool }  d = 0 (Sunday) .. 6, s/e = minutes from that day's midnight, e may exceed 1440.
(function (root) {
  const DAY_WORDS = { "ראשון": 0, "שני": 1, "שלישי": 2, "רביעי": 3, "חמישי": 4, "שישי": 5, "ששי": 5, "שבת": 6 };
  const DAY_LETTERS = { "א": 0, "ב": 1, "ג": 2, "ד": 3, "ה": 4, "ו": 5, "ש": 6 };
  const DAY = "(?:ו?(?:ראשון|שלישי|רביעי|חמישי|שישי|ששי|שני|שבת)|[אבגדהוש](?![\\u05D0-\\u05EA]))";
  const TIME = "(\\d{1,2})(?::(\\d{1,2}))?";
  const RE = new RegExp(
    "(כל יום|כל השבוע)" +                                   // 1 every day
    "|(" + DAY + ")\\s*(?:-|עד)\\s*(" + DAY + ")" +            // 2,3 day range
    "|" + TIME + "\\s*(?:-|עד)\\s*" + TIME +                    // 4,5,6,7 time range
    "|(" + DAY + ")" +                                          // 8 single day
    "|(בוקר|צהריים|צהרים|ערב|לילה)",                           // 9 part of day
    "g");
  const PART = { "בוקר": [480, 780], "צהריים": [720, 900], "צהרים": [720, 900], "ערב": [1080, 1320], "לילה": [1200, 1440] };

  function dayNum(tok) {
    tok = tok.replace(/^ו(?=[א-ת]{2})/, "");
    if (tok in DAY_WORDS) return DAY_WORDS[tok];
    return DAY_LETTERS[tok];
  }
  function range(a, b) { const out = []; for (let i = a; ; i = (i + 1) % 7) { out.push(i); if (i === b) break; } return out; }

  function parseSheet(text) {
    if (!text) return null;
    let t = String(text)
      .replace(/[–—־]/g, "-")
      .replace(/([א-ת])['׳]/g, "$1")
      .replace(/בשישי/g, "שישי").replace(/בבוקר/g, "בוקר").replace(/בערב/g, "ערב").replace(/בצהריים/g, "צהריים");
    const groups = [];            // {days:Set, times:[], parts:[]}
    let cur = null, lastWasDay = false;
    const newGroup = days => { cur = { days: new Set(days), times: [], parts: [] }; groups.push(cur); };
    let m;
    RE.lastIndex = 0;
    while ((m = RE.exec(t))) {
      if (m[1]) { newGroup([0, 1, 2, 3, 4, 5, 6]); lastWasDay = true; continue; }
      if (m[2]) {
        const a = dayNum(m[2]), b = dayNum(m[3]);
        if (a === undefined || b === undefined) continue;
        if (lastWasDay && cur && !cur.times.length && !cur.parts.length) range(a, b).forEach(d => cur.days.add(d));
        else newGroup(range(a, b));
        lastWasDay = true; continue;
      }
      if (m[4] !== undefined) {
        let s = +m[4] * 60 + (+m[5] || 0), e = +m[6] * 60 + (+m[7] || 0);
        if (+m[4] > 24 || +m[6] > 24) continue;
        if (e <= s && +m[6] < 12) e += 720;          // "9 עד 2" -> 14:00
        if (e <= s) e += 1440;                       // past midnight
        if (!cur) { newGroup([0, 1, 2, 3, 4]); cur.assumed = true; }  // hours with no days: assume Sunday to Thursday
        cur.times.push([s, e]); lastWasDay = false; continue;
      }
      if (m[8]) {
        const d = dayNum(m[8]); if (d === undefined) continue;
        if (lastWasDay && cur && !cur.times.length && !cur.parts.length) cur.days.add(d);
        else newGroup([d]);
        lastWasDay = true; continue;
      }
      if (m[9]) { if (cur) cur.parts.push(PART[m[9]]); lastWasDay = false; }
    }
    const byDay = {};  // later groups override earlier ones for the days they name
    let approx = false;
    for (const g of groups) {
      let spans = g.times.slice();
      if (!spans.length && g.parts.length) {
        spans = [[Math.min(...g.parts.map(p => p[0])), Math.max(...g.parts.map(p => p[1]))]];
        approx = true;
      }
      if (!spans.length) continue;
      if (g.assumed) approx = true;
      g.days.forEach(d => { byDay[d] = spans; });
    }
    const periods = [];
    Object.keys(byDay).forEach(d => byDay[d].forEach(([s, e]) => periods.push({ d: +d, s, e })));
    return periods.length ? { periods, approx } : null;
  }

  function fromGoogle(roh) {
    if (!roh || !roh.periods || !roh.periods.length) return null;
    const periods = [];
    for (const p of roh.periods) {
      if (!p.open) continue;
      if (!p.close) return { periods: [0, 1, 2, 3, 4, 5, 6].map(d => ({ d, s: 0, e: 1440 })), approx: false, always: true };
      const s = p.open.hour * 60 + (p.open.minute || 0);
      let e = p.close.hour * 60 + (p.close.minute || 0) + 1440 * ((p.close.day - p.open.day + 7) % 7);
      if (e <= s) e += 1440 * 7;
      periods.push({ d: p.open.day, s, e });
    }
    return periods.length ? { periods, approx: false } : null;
  }

  const DNAMES = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
  const hhmm = m => { m = ((m % 1440) + 1440) % 1440; return String(Math.floor(m / 60)).padStart(1, "0") + ":" + String(m % 60).padStart(2, "0"); };

  // -> {open:bool, until?:minutes-from-now label, next?:label}
  function state(h, now) {
    if (!h) return null;
    now = now || new Date();
    const day = now.getDay(), mins = now.getHours() * 60 + now.getMinutes();
    const abs = day * 1440 + mins, WEEK = 7 * 1440;
    let openUntil = null, nextOpen = null;
    for (const p of h.periods) {
      for (const shift of [-WEEK, 0, WEEK]) {
        const s = p.d * 1440 + p.s + shift, e = p.d * 1440 + p.e + shift;
        if (s <= abs && abs < e) openUntil = Math.max(openUntil || 0, e);
        if (s > abs && (nextOpen === null || s < nextOpen)) nextOpen = s;
      }
    }
    if (openUntil !== null) {
      if (h.always) return { open: true, label: "פתוח 24 שעות" };
      return { open: true, label: "פתוח עד " + hhmm(openUntil) };
    }
    if (nextOpen === null) return { open: false, label: "סגור" };
    const nd = Math.floor(((nextOpen % WEEK) + WEEK) % WEEK / 1440);
    const when = nd === day && nextOpen - abs < 1440 ? "היום" : (nd === (day + 1) % 7 ? "מחר" : "ביום " + DNAMES[nd]);
    return { open: false, label: "סגור · נפתח " + when + " ב-" + hhmm(nextOpen) };
  }

  function describe(h) {
    if (!h) return [];
    const out = [];
    for (let d = 0; d < 7; d++) {
      const ps = h.periods.filter(p => p.d === d).sort((a, b) => a.s - b.s);
      out.push(DNAMES[d] + ": " + (ps.length ? ps.map(p => hhmm(p.s) + "–" + hhmm(p.e)).join(", ") : "סגור"));
    }
    return out;
  }

  root.Hours = { parseSheet, fromGoogle, state, describe };
})(typeof window !== "undefined" ? window : globalThis);
