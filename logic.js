/* Runde – reine Logik (Punkte, Limits, Datum, Formatierung).
   Läuft im Browser (window.RundeLogic) und in Node (Tests). Kein Netzwerk, kein DOM. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.RundeLogic = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var POINT_DIVISOR = 5;
  var ALCOHOL_DENSITY = 0.789;
  var PARTY_DAY_CUTOFF_HOUR = 6;
  var DEFAULT_LIMIT_POINTS = 15;
  var DEFAULT_LIMIT_GRAMS = 100;
  var DELETE_WINDOW_MIN = 60;

  var CATEGORIES = [
    { key: 'bier', label: 'Bier', refMl: 500, sizes: [200, 330, 500, 1000], defaultSize: 500 },
    { key: 'radler', label: 'Radler', refMl: 2500, sizes: [330, 500, 1000], defaultSize: 500 },
    { key: 'wein', label: 'Wein', refMl: 200, sizes: [100, 200, 250], defaultSize: 200 },
    { key: 'sekt', label: 'Sekt', refMl: 100, sizes: [100, 150], defaultSize: 100 },
    { key: 'spirituose', label: 'Spirituose', refMl: 40, sizes: [20, 40], defaultSize: 40 },
    { key: 'cocktail', label: 'Cocktail', refMl: 300, sizes: [200, 300, 400], defaultSize: 300 }
  ];

  var PRESETS = [
    { key: 'pils', name: 'Pils', category: 'bier', abv: 4.9 },
    { key: 'helles', name: 'Helles', category: 'bier', abv: 5.0 },
    { key: 'weizen', name: 'Weizen', category: 'bier', abv: 5.4 },
    { key: 'alt', name: 'Alt', category: 'bier', abv: 4.8 },
    { key: 'koelsch', name: 'Kölsch', category: 'bier', abv: 4.8 },
    { key: 'radler', name: 'Radler', category: 'radler', abv: 2.5 },
    { key: 'alster', name: 'Alster', category: 'radler', abv: 2.5 },
    { key: 'weisswein', name: 'Weißwein', category: 'wein', abv: 11.5 },
    { key: 'rotwein', name: 'Rotwein', category: 'wein', abv: 13 },
    { key: 'sekt', name: 'Sekt', category: 'sekt', abv: 11 },
    { key: 'prosecco', name: 'Prosecco', category: 'sekt', abv: 11 },
    { key: 'vodka', name: 'Vodka', category: 'spirituose', abv: 40 },
    { key: 'jaeger', name: 'Jägermeister', category: 'spirituose', abv: 35 },
    { key: 'tequila', name: 'Tequila', category: 'spirituose', abv: 38 },
    { key: 'whiskey', name: 'Whiskey', category: 'spirituose', abv: 40 },
    { key: 'rum', name: 'Rum', category: 'spirituose', abv: 37.5 },
    { key: 'gin', name: 'Gin', category: 'spirituose', abv: 40 },
    { key: 'korn', name: 'Korn', category: 'spirituose', abv: 32 },
    { key: 'aperol', name: 'Aperol Spritz', category: 'cocktail', abv: 8 },
    { key: 'hugo', name: 'Hugo', category: 'cocktail', abv: 8 },
    { key: 'gintonic', name: 'Gin Tonic', category: 'cocktail', abv: 9 },
    { key: 'moscowmule', name: 'Moscow Mule', category: 'cocktail', abv: 10 },
    { key: 'mojito', name: 'Mojito', category: 'cocktail', abv: 11 },
    { key: 'caipi', name: 'Caipirinha', category: 'cocktail', abv: 15 },
    { key: 'cubalibre', name: 'Cuba Libre', category: 'cocktail', abv: 8 },
    { key: 'longisland', name: 'Long Island Iced Tea', category: 'cocktail', abv: 18 },
    { key: 'pinacolada', name: 'Piña Colada', category: 'cocktail', abv: 12 },
    { key: 'sexonthebeach', name: 'Sex on the Beach', category: 'cocktail', abv: 10 }
  ];

  var COLORS = ['#D4AF37', '#A78BFA', '#34D399', '#F87171', '#60A5FA', '#FB923C', '#F472B6', '#2DD4BF', '#A3E635', '#E879F9'];

  function categoryByKey(key) {
    for (var i = 0; i < CATEGORIES.length; i++) {
      if (CATEGORIES[i].key === key) return CATEGORIES[i];
    }
    return null;
  }

  function presetByKey(key) {
    for (var i = 0; i < PRESETS.length; i++) {
      if (PRESETS[i].key === key) return PRESETS[i];
    }
    return null;
  }

  function presetsOf(categoryKey) {
    return PRESETS.filter(function (p) { return p.category === categoryKey; });
  }

  function pad(n) { return n < 10 ? '0' + n : String(n); }

  function floor1(x) { return Math.floor(x * 10 + 1e-9) / 10; }

  /* Punkte = ABV / 5 pro Standardportion der Kategorie, anteilig nach Menge,
     auf 0,1 gerundet (halb auf). Reine Ganzzahl-Rechnung, damit das Ergebnis
     exakt dem SQL round(abv * ml / (5 * ref), 1) entspricht. */
  function pointsRaw(abv, volumeMl, refMl) {
    var abvT = Math.round(abv * 10);
    var tenths = Math.floor((2 * abvT * volumeMl + POINT_DIVISOR * refMl) / (10 * refMl));
    return tenths / 10;
  }

  function alcoholGrams(abv, volumeMl) {
    var abvT = Math.round(abv * 10) / 10;
    return Math.round(volumeMl * abvT / 100 * ALCOHOL_DENSITY * 1000) / 1000;
  }

  /* Wie viele Punkte zählen wirklich? Beide Grenzen gelten: Punkte-Limit und Alkohol-Obergrenze.
     Ein Limit von null/undefined bedeutet: kein Limit. */
  function awardPoints(o) {
    var raw = o.pointsRaw;
    var remP = o.limitPoints == null ? Infinity : Math.max(0, o.limitPoints - o.usedPoints);
    var remG = o.limitGrams == null ? Infinity : Math.max(0, o.limitGrams - o.usedGrams);
    var byG = remG === Infinity ? Infinity : (o.alcoholG > 0 ? raw * remG / o.alcoholG : 0);
    var award = floor1(Math.min(raw, remP, byG));
    if (award < 0) award = 0;
    var capped = award < raw - 1e-9;
    var reason = null;
    if (capped) reason = byG <= remP ? 'alkohol' : 'punkte';
    return {
      points: award,
      capped: capped,
      reason: reason,
      remainingPoints: remP === Infinity ? null : Math.max(0, floor1(remP - award)),
      remainingGrams: remG === Infinity ? null : Math.max(0, Math.round((remG - o.alcoholG) * 10) / 10)
    };
  }

  /* Abend-Tag: bis 06:00 Uhr Ortszeit zählt noch zum Vortag. */
  function partyDay(date, cutoffHour) {
    var h = cutoffHour == null ? PARTY_DAY_CUTOFF_HOUR : cutoffHour;
    var d = new Date(date.getTime() - h * 3600 * 1000);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function periodStart(period, now) {
    if (period === 'heute') return partyDay(now);
    if (period === 'woche') return partyDay(new Date(now.getTime() - 6 * 24 * 3600 * 1000));
    return null;
  }

  function fmt(n) {
    var v = Math.round(Number(n) * 10) / 10;
    if (!isFinite(v)) v = 0;
    return String(v).replace('.', ',');
  }

  function describeSize(ml) {
    if (ml < 100) return fmt(ml / 10) + ' cl';
    return String(Math.round(ml / 10) / 100).replace('.', ',') + ' l';
  }

  function drinkLabel(d) {
    return d.name + ' ' + describeSize(d.volume_ml);
  }

  function timeAgo(iso, now) {
    var t = new Date(iso).getTime();
    var diff = Math.max(0, (now.getTime() - t) / 1000);
    if (diff < 90) return 'gerade eben';
    if (diff < 3600) return 'vor ' + Math.round(diff / 60) + ' Min.';
    if (diff < 86400) return 'vor ' + Math.round(diff / 3600) + ' Std.';
    if (diff < 172800) return 'gestern';
    var d = new Date(t);
    return pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.';
  }

  function rankRows(rows) {
    var list = rows.map(function (r) {
      return { user_id: r.user_id, display_name: r.display_name, points: Number(r.points) || 0, drinks: Number(r.drinks) || 0 };
    });
    list.sort(function (a, b) {
      return (b.points - a.points) || (b.drinks - a.drinks) || a.display_name.localeCompare(b.display_name, 'de');
    });
    list.forEach(function (r) {
      var better = 0;
      list.forEach(function (o) { if (o.points > r.points + 1e-9) better++; });
      r.rank = better + 1;
    });
    return list;
  }

  function flagThreshold(memberCount) {
    return Math.max(1, Math.min(2, memberCount - 1));
  }

  function isDisputed(flagCount, memberCount) {
    return flagCount >= flagThreshold(memberCount);
  }

  function usageToday(drinks, userId, day) {
    var points = 0, grams = 0, count = 0;
    (drinks || []).forEach(function (d) {
      if (d.user_id === userId && d.party_day === day) {
        points += Number(d.points) || 0;
        grams += Number(d.alcohol_g) || 0;
        count++;
      }
    });
    return { points: Math.round(points * 10) / 10, grams: Math.round(grams * 10) / 10, count: count };
  }

  function validateDrink(d) {
    var name = String(d.name || '').trim();
    if (name.length < 1 || name.length > 40) return 'Name: 1 bis 40 Zeichen.';
    if (!categoryByKey(d.category)) return 'Kategorie wählen.';
    var abv = Number(d.abv);
    if (!isFinite(abv) || abv < 0.5 || abv > 96) return 'Alkoholgehalt: 0,5 bis 96 %.';
    if (Math.abs(abv * 10 - Math.round(abv * 10)) > 1e-9) return 'Alkoholgehalt: höchstens eine Nachkommastelle.';
    var ml = Number(d.volumeMl);
    if (!isFinite(ml) || ml < 10 || ml > 2000 || Math.round(ml) !== ml) return 'Menge: 10 bis 2000 ml.';
    return null;
  }

  function normalizeInviteCode(s) {
    return String(s || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function colorFor(id) {
    var h = 0, s = String(id || '');
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return COLORS[h % COLORS.length];
  }

  function initial(name) {
    var s = String(name || '?').trim();
    return s ? s.charAt(0).toUpperCase() : '?';
  }

  function canDelete(drink, userId, now) {
    if (drink.user_id !== userId) return false;
    return (now.getTime() - new Date(drink.created_at).getTime()) < DELETE_WINDOW_MIN * 60 * 1000;
  }

  /* Drinks mit Standort nach ca. 11 m Raster bündeln (z. B. alle Getränke an einem Tisch). */
  function clusterDrinks(drinks) {
    var map = {};
    var order = [];
    drinks.forEach(function (d) {
      if (d.lat == null || d.lng == null) return;
      var key = Number(d.lat).toFixed(4) + ',' + Number(d.lng).toFixed(4);
      if (!map[key]) {
        map[key] = { key: key, lat: Number(d.lat), lng: Number(d.lng), drinks: [] };
        order.push(key);
      }
      map[key].drinks.push(d);
    });
    return order.map(function (k) { return map[k]; });
  }

  function isNetworkError(e) {
    if (!e) return false;
    var m = String(e.message || e);
    if (/failed to fetch|networkerror|load failed|network request failed|fetch failed|timed? ?out|offline/i.test(m)) return true;
    return typeof navigator !== 'undefined' && navigator.onLine === false && !e.code;
  }

  function dayShift(day, n) {
    var p = String(day).split('-');
    var d = new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2]) + n));
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  }

  function round1(n) { return Math.round(n * 10) / 10; }

  function computeStats(drinks, uid, period, now, memberCount) {
    var from = periodStart(period, now);
    var today = partyDay(now);
    var valid = (drinks || []).filter(function (d) {
      return !isDisputed((d.drink_flags || []).length, memberCount || 1);
    });
    var inPeriod = valid.filter(function (d) { return !from || d.party_day >= from; });

    function summarize(list) {
      var points = 0, grams = 0, nights = {}, names = {}, cats = {};
      list.forEach(function (d) {
        points += Number(d.points) || 0;
        grams += Number(d.alcohol_g) || 0;
        nights[d.party_day] = true;
        var key = String(d.name || '').trim().toLowerCase();
        if (key) { names[key] = names[key] || { name: d.name, count: 0 }; names[key].count++; }
        cats[d.category] = (cats[d.category] || 0) + 1;
      });
      var fav = null;
      Object.keys(names).forEach(function (k) { if (!fav || names[k].count > fav.count) fav = names[k]; });
      var nightCount = Object.keys(nights).length;
      var byCategory = CATEGORIES.map(function (c) {
        return { key: c.key, label: c.label, count: cats[c.key] || 0, share: list.length ? (cats[c.key] || 0) / list.length : 0 };
      }).filter(function (c) { return c.count > 0; }).sort(function (a, b) { return b.count - a.count; });
      return {
        count: list.length, points: round1(points), grams: round1(grams), nights: nightCount,
        avgPointsPerNight: nightCount ? round1(points / nightCount) : 0,
        favorite: fav ? { name: fav.name, count: fav.count } : null,
        byCategory: byCategory
      };
    }

    var mine = inPeriod.filter(function (d) { return d.user_id === uid; });
    var me = summarize(mine);

    var perNight = [];
    for (var i = 13; i >= 0; i--) {
      var day = dayShift(today, -i);
      var pts = 0, g = 0, c = 0;
      valid.forEach(function (d) {
        if (d.user_id === uid && d.party_day === day) { pts += Number(d.points) || 0; g += Number(d.alcohol_g) || 0; c++; }
      });
      perNight.push({ day: day, points: round1(pts), grams: round1(g), count: c });
    }

    var perUserNight = {};
    inPeriod.forEach(function (d) {
      var k = d.user_id + '|' + d.party_day;
      var o = perUserNight[k] || (perUserNight[k] = { user_id: d.user_id, day: d.party_day, count: 0, points: 0, grams: 0 });
      o.count++; o.points += Number(d.points) || 0; o.grams += Number(d.alcohol_g) || 0;
    });
    var topCount = null, topPoints = null;
    Object.keys(perUserNight).forEach(function (k) {
      var o = perUserNight[k];
      o.points = round1(o.points); o.grams = round1(o.grams);
      if (!topCount || o.count > topCount.count) topCount = o;
      if (!topPoints || o.points > topPoints.points) topPoints = o;
    });

    return { me: me, group: summarize(inPeriod), perNight: perNight, records: { mostDrinks: topCount, mostPoints: topPoints } };
  }

  return {
    POINT_DIVISOR: POINT_DIVISOR,
    ALCOHOL_DENSITY: ALCOHOL_DENSITY,
    PARTY_DAY_CUTOFF_HOUR: PARTY_DAY_CUTOFF_HOUR,
    DEFAULT_LIMIT_POINTS: DEFAULT_LIMIT_POINTS,
    DEFAULT_LIMIT_GRAMS: DEFAULT_LIMIT_GRAMS,
    DELETE_WINDOW_MIN: DELETE_WINDOW_MIN,
    CATEGORIES: CATEGORIES,
    PRESETS: PRESETS,
    categoryByKey: categoryByKey,
    presetByKey: presetByKey,
    presetsOf: presetsOf,
    pointsRaw: pointsRaw,
    isNetworkError: isNetworkError,
    dayShift: dayShift,
    computeStats: computeStats,
    alcoholGrams: alcoholGrams,
    awardPoints: awardPoints,
    partyDay: partyDay,
    periodStart: periodStart,
    fmt: fmt,
    describeSize: describeSize,
    drinkLabel: drinkLabel,
    timeAgo: timeAgo,
    rankRows: rankRows,
    flagThreshold: flagThreshold,
    isDisputed: isDisputed,
    usageToday: usageToday,
    validateDrink: validateDrink,
    normalizeInviteCode: normalizeInviteCode,
    esc: esc,
    colorFor: colorFor,
    initial: initial,
    canDelete: canDelete,
    clusterDrinks: clusterDrinks
  };
});
