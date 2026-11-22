/* Runde – Ansichten als HTML-Text (ohne DOM-Zugriff, daher in Node testbar).
   Alles, was von Nutzern kommt (Namen, Getränke), läuft durch esc(). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./logic.js'));
  } else {
    root.RundeViews = factory(root.RundeLogic);
  }
})(typeof self !== 'undefined' ? self : this, function (Logic) {
  'use strict';

  var esc = Logic.esc;
  var fmt = Logic.fmt;

  function icon(name, cls) {
    return '<svg class="ic' + (cls ? ' ' + cls : '') + '" aria-hidden="true"><use href="#i-' + name + '"></use></svg>';
  }

  function seg(action, dataKey, options, current) {
    return '<div class="seg" role="group">' + options.map(function (o) {
      return '<button type="button" class="' + (o.value === current ? 'on' : '') + '" data-action="' + action + '" data-' + dataKey + '="' + esc(o.value) + '">' + esc(o.label) + '</button>';
    }).join('') + '</div>';
  }

  var PERIODS = [
    { value: 'heute', label: 'Heute' },
    { value: 'woche', label: 'Woche' },
    { value: 'gesamt', label: 'Gesamt' }
  ];

  /* ---------- Anmeldung ---------- */
  function authView(mode) {
    var signup = mode === 'signup';
    return '' +
      '<div class="auth-card">' +
        '<div class="logo-mark">' + icon('glass') + '</div>' +
        '<h1>Runde</h1>' +
        '<p class="muted center">Getränke tracken, Rangliste, Karte. Mit deinen Freunden.</p>' +
        seg('auth-mode', 'mode', [{ value: 'login', label: 'Anmelden' }, { value: 'signup', label: 'Registrieren' }], signup ? 'signup' : 'login') +
        '<form id="auth-form" data-mode="' + (signup ? 'signup' : 'login') + '" novalidate>' +
          (signup ? '<label>Name<input name="name" type="text" maxlength="24" autocomplete="nickname" placeholder="So sehen dich die anderen"></label>' : '') +
          '<label>E-Mail<input name="email" type="email" autocomplete="email" inputmode="email" placeholder="du@beispiel.de"></label>' +
          '<label>Passwort<input name="password" type="password" minlength="8" autocomplete="' + (signup ? 'new-password' : 'current-password') + '" placeholder="mindestens 8 Zeichen"></label>' +
          (signup ? '<label class="check"><input type="checkbox" name="adult"><span>Ich bin mindestens 18 Jahre alt.</span></label>' : '') +
          '<button class="btn primary wide" type="submit">' + (signup ? 'Konto erstellen' : 'Anmelden') + '</button>' +
          '<p class="msg" id="auth-msg" role="alert"></p>' +
        '</form>' +
      '</div>';
  }

  /* ---------- Noch keine Gruppe ---------- */
  function noGroupView() {
    return '' +
      '<div class="stack">' +
        '<div class="card">' +
          '<h2>Mit Code beitreten</h2>' +
          '<p class="muted">Ein Freund schickt dir den 6-stelligen Code aus seiner Gruppe.</p>' +
          '<form id="join-form" class="inline-form" novalidate>' +
            '<input name="code" type="text" maxlength="12" autocapitalize="characters" autocomplete="off" placeholder="CODE" aria-label="Einladungscode">' +
            '<button class="btn primary" type="submit">Beitreten</button>' +
          '</form>' +
        '</div>' +
        '<div class="card">' +
          '<h2>Neue Gruppe</h2>' +
          '<p class="muted">Du wirst Admin und bekommst einen Einladungscode für deine Freunde.</p>' +
          '<form id="create-form" class="inline-form" novalidate>' +
            '<input name="name" type="text" maxlength="40" placeholder="z. B. Mallorca 2027" aria-label="Gruppenname">' +
            '<button class="btn primary" type="submit">Erstellen</button>' +
          '</form>' +
        '</div>' +
        '<p class="msg" id="group-msg" role="alert"></p>' +
      '</div>';
  }

  /* ---------- Rangliste ---------- */
  function meter(label, used, limit, unit) {
    var pct = limit > 0 ? Math.min(100, Math.round(used / limit * 100)) : 0;
    var cls = pct >= 100 ? ' full' : (pct >= 80 ? ' warn' : '');
    return '<div class="meter' + cls + '">' +
      '<div class="meter-head"><span>' + esc(label) + '</span><b>' + fmt(used) + ' / ' + fmt(limit) + (unit ? ' ' + esc(unit) : '') + '</b></div>' +
      '<div class="bar"><i style="width:' + pct + '%"></i></div>' +
    '</div>';
  }

  function rankView(state) {
    var g = state.group;
    var rows = Logic.rankRows(state.board || []);
    var today = state.today || { points: 0, grams: 0, count: 0 };
    var html = '' +
      '<div class="stack">' +
        seg('period', 'period', PERIODS, state.period) +
        '<div class="card meters">' +
          '<div class="card-title">Dein Abend</div>' +
          meter('Punkte', today.points, Number(g.daily_limit), '') +
          meter('Alkohol', today.grams, Number(g.alcohol_limit_g), 'g') +
          '<p class="tiny muted">Ab Limit gibt es keine Punkte mehr. Wasser, Essen, Pausen.</p>' +
        '</div>';
    if (!rows.length) {
      html += '<div class="empty">Noch niemand in der Gruppe.</div>';
    } else if (rows.every(function (r) { return r.drinks === 0; })) {
      html += '<div class="empty">Noch keine Getränke in diesem Zeitraum.<br><span class="muted">Tippe unten auf das Plus.</span></div>';
    }
    html += '<ol class="board">' + rows.map(function (r) {
      var me = r.user_id === state.uid;
      return '<li class="row' + (me ? ' me' : '') + (r.rank === 1 && r.points > 0 ? ' first' : '') + '">' +
        '<span class="pos">' + r.rank + '</span>' +
        '<span class="av" style="--c:' + Logic.colorFor(r.user_id) + '">' + esc(Logic.initial(r.display_name)) + '</span>' +
        '<span class="who"><b>' + esc(r.display_name) + '</b>' + (me ? '<em>du</em>' : '') + '<small>' + r.drinks + (r.drinks === 1 ? ' Getränk' : ' Getränke') + '</small></span>' +
        '<span class="pts">' + fmt(r.points) + '</span>' +
      '</li>';
    }).join('') + '</ol></div>';
    return html;
  }

  /* ---------- Verlauf ---------- */
  function feedItem(d, state) {
    var me = d.user_id === state.uid;
    var flags = d.drink_flags || [];
    var flagCount = flags.length;
    var flaggedByMe = flags.some(function (f) { return f.user_id === state.uid; });
    var disputed = Logic.isDisputed(flagCount, (state.members || []).length || 1);
    var name = d.profiles && d.profiles.display_name ? d.profiles.display_name : '?';
    var now = state.now || new Date();
    var capped = Number(d.points) < Number(d.points_raw) - 1e-9;
    var actions = '';
    if (!me) {
      actions += flaggedByMe
        ? '<button class="icon-btn on" data-action="unflag" data-id="' + esc(d.id) + '" aria-label="Meldung zurücknehmen">' + icon('flag') + '</button>'
        : '<button class="icon-btn" data-action="flag" data-id="' + esc(d.id) + '" aria-label="Getränk anzweifeln">' + icon('flag') + '</button>';
    }
    if (Logic.canDelete(d, state.uid, now)) {
      actions += '<button class="icon-btn" data-action="delete" data-id="' + esc(d.id) + '" data-path="' + esc(d.photo_path) + '" aria-label="Löschen">' + icon('trash') + '</button>';
    }
    return '<article class="item' + (disputed ? ' disputed' : '') + '">' +
      '<button class="thumb" data-action="zoom" data-path="' + esc(d.photo_path) + '" aria-label="Foto groß"><img data-path="' + esc(d.photo_path) + '" alt="" loading="lazy"></button>' +
      '<div class="meta">' +
        '<div class="l1"><b>' + esc(name) + '</b>' + (me ? '<em>du</em>' : '') + '</div>' +
        '<div class="l2">' + esc(Logic.drinkLabel(d)) + ' · ' + fmt(d.abv) + ' %</div>' +
        '<div class="l3 muted">' + esc(Logic.timeAgo(d.created_at, now)) + (d.lat == null ? ' · ohne Ort' : '') + '</div>' +
        (disputed ? '<div class="badge bad">Angezweifelt, zählt nicht</div>' : (flagCount ? '<div class="badge warn">' + flagCount + 'x gemeldet</div>' : '')) +
      '</div>' +
      '<div class="side">' +
        '<div class="gain' + (capped ? ' capped' : '') + '">+' + fmt(d.points) + '</div>' +
        '<div class="acts">' + actions + '</div>' +
      '</div>' +
    '</article>';
  }

  function feedView(state) {
    var list = state.drinks || [];
    if (!list.length) {
      return '<div class="empty">Noch keine Getränke.<br><span class="muted">Das erste geht aufs Haus: Plus antippen.</span></div>';
    }
    return '<div class="stack feed">' + list.map(function (d) { return feedItem(d, state); }).join('') +
      '<p class="tiny muted center">Zweifelst du ein Foto an, tippe auf die Flagge. Mit genug Meldungen zählt das Getränk nicht.</p></div>';
  }

  /* ---------- Karte ---------- */
  function mapView(state) {
    var withLoc = 0, without = 0;
    (state.mapDrinks || []).forEach(function (d) { if (d.lat == null) without++; else withLoc++; });
    return '<div class="mapwrap">' +
      '<div class="maptools">' + seg('map-period', 'period', [{ value: 'heute', label: 'Heute' }, { value: 'woche', label: 'Woche' }, { value: 'gesamt', label: 'Alle' }], state.mapPeriod) + '</div>' +
      '<div id="map" class="map" role="region" aria-label="Karte"></div>' +
      '<p class="tiny muted center maphint">' + withLoc + ' Orte auf der Karte' + (without ? ' · ' + without + ' Getränke ohne Standort' : '') + '</p>' +
    '</div>';
  }

  function mapPopup(cluster, state) {
    var now = state.now || new Date();
    var shown = cluster.drinks.slice(0, 5);
    var more = cluster.drinks.length - shown.length;
    return '<div class="pop">' + shown.map(function (d) {
      var name = d.profiles && d.profiles.display_name ? d.profiles.display_name : '?';
      return '<div class="pop-row">' +
        '<img data-path="' + esc(d.photo_path) + '" alt="">' +
        '<div><b>' + esc(name) + '</b><br>' + esc(Logic.drinkLabel(d)) + '<br><span class="pop-sub">' + esc(Logic.timeAgo(d.created_at, now)) + ' · +' + fmt(d.points) + '</span></div>' +
      '</div>';
    }).join('') + (more > 0 ? '<div class="pop-more">+ ' + more + ' weitere</div>' : '') + '</div>';
  }

  /* ---------- Gruppe ---------- */
  function groupView(state) {
    var g = state.group;
    var isAdmin = g.role === 'admin';
    var members = (state.members || []).slice().sort(function (a, b) {
      var an = a.profiles ? a.profiles.display_name : '';
      var bn = b.profiles ? b.profiles.display_name : '';
      return an.localeCompare(bn, 'de');
    });
    var limits = isAdmin
      ? '<form id="limits-form" class="limits-form" novalidate>' +
          '<label>Punkte-Limit pro Abend<input name="points" type="number" inputmode="decimal" min="1" max="100" step="1" value="' + esc(fmt(g.daily_limit)) + '"></label>' +
          '<label>Alkohol-Obergrenze (g Reinalkohol)<input name="grams" type="number" inputmode="numeric" min="40" max="150" step="5" value="' + esc(fmt(g.alcohol_limit_g)) + '"></label>' +
          '<button class="btn" type="submit">Limits speichern</button>' +
        '</form>'
      : '<p class="muted">Punkte-Limit: ' + fmt(g.daily_limit) + ' pro Abend · Alkohol-Obergrenze: ' + fmt(g.alcohol_limit_g) + ' g. Nur Admins ändern das.</p>';
    return '' +
      '<div class="stack">' +
        '<div class="card">' +
          '<div class="card-title">Einladungscode</div>' +
          '<div class="code">' + esc(g.invite_code) + '</div>' +
          '<div class="row-btns">' +
            '<button class="btn" data-action="copy-code">' + icon('copy') + 'Kopieren</button>' +
            '<button class="btn" data-action="share-code">' + icon('share') + 'Teilen</button>' +
          '</div>' +
          '<p class="tiny muted">Wer den Code hat, kann beitreten und sieht Fotos und Orte der Gruppe. Gib ihn nur an Freunde.</p>' +
        '</div>' +
        '<div class="card">' +
          '<div class="card-title">Mitglieder (' + members.length + ')</div>' +
          '<ul class="members">' + members.map(function (m) {
            var n = m.profiles ? m.profiles.display_name : '?';
            return '<li><span class="av sm" style="--c:' + Logic.colorFor(m.user_id) + '">' + esc(Logic.initial(n)) + '</span><span>' + esc(n) + (m.user_id === state.uid ? ' <em>du</em>' : '') + '</span>' + (m.role === 'admin' ? '<span class="badge">Admin</span>' : '') + '</li>';
          }).join('') + '</ul>' +
        '</div>' +
        '<div class="card">' +
          '<div class="card-title">Limits</div>' + limits +
          '<p class="tiny muted">Punkte: ABV ÷ 5 pro Standardportion (Pils 0,5 l = 1, Vodka 4 cl = 8). Der Abend wechselt um 6 Uhr morgens.</p>' +
        '</div>' +
        '<div class="card">' +
          '<div class="card-title">Mein Name</div>' +
          '<form id="rename-form" class="inline-form" novalidate>' +
            '<input name="name" type="text" maxlength="24" value="' + esc(state.profile ? state.profile.display_name : '') + '" aria-label="Mein Name">' +
            '<button class="btn" type="submit">Ändern</button>' +
          '</form>' +
        '</div>' +
        '<details class="card more">' +
          '<summary>Weitere Gruppe</summary>' +
          '<form id="join-form" class="inline-form" novalidate>' +
            '<input name="code" type="text" maxlength="12" autocapitalize="characters" autocomplete="off" placeholder="CODE" aria-label="Einladungscode">' +
            '<button class="btn" type="submit">Beitreten</button>' +
          '</form>' +
          '<form id="create-form" class="inline-form" novalidate>' +
            '<input name="name" type="text" maxlength="40" placeholder="Neuer Gruppenname" aria-label="Gruppenname">' +
            '<button class="btn" type="submit">Erstellen</button>' +
          '</form>' +
        '</details>' +
        '<p class="msg" id="group-msg" role="alert"></p>' +
        '<button class="btn ghost wide" data-action="logout">Abmelden</button>' +
        '<p class="tiny muted center">Trinkt verantwortungsvoll. Im Notfall: 112.</p>' +
      '</div>';
  }

  /* ---------- Getränk loggen ---------- */
  function currentCategory(ls) {
    return Logic.categoryByKey(ls.category) || Logic.CATEGORIES[0];
  }

  function logDrinkValues(ls) {
    var cat = currentCategory(ls);
    return { name: ls.name, category: cat.key, abv: Number(ls.abv), volumeMl: Number(ls.sizeMl), refMl: cat.refMl };
  }

  function logPreview(ls, ctx) {
    var v = logDrinkValues(ls);
    var err = Logic.validateDrink(v);
    if (err) return '<div class="preview muted">' + esc(err) + '</div>';
    var raw = Logic.pointsRaw(v.abv, v.volumeMl, v.refMl);
    var g = Logic.alcoholGrams(v.abv, v.volumeMl);
    var res = Logic.awardPoints({
      pointsRaw: raw, alcoholG: g,
      usedPoints: ctx.usage.points, usedGrams: ctx.usage.grams,
      limitPoints: ctx.limits.points, limitGrams: ctx.limits.grams
    });
    var note = '';
    if (res.capped && res.points <= 0) {
      note = '<div class="note bad">' + (res.reason === 'alkohol' ? 'Alkohol-Obergrenze erreicht' : 'Punkte-Limit erreicht') + ': dieses Getränk gibt keine Punkte mehr. Wasser, Essen, Pause.</div>';
    } else if (res.capped) {
      note = '<div class="note warn">Es zählen nur ' + fmt(res.points) + ' Punkte (' + (res.reason === 'alkohol' ? 'Alkohol-Obergrenze' : 'Punkte-Limit') + ').</div>';
    }
    return '<div class="preview">' +
      '<div class="pv-pts"><b>' + fmt(res.capped ? res.points : raw) + '</b> ' + (Math.abs((res.capped ? res.points : raw) - 1) < 1e-9 ? 'Punkt' : 'Punkte') + '</div>' +
      '<div class="pv-sub muted">' + fmt(g) + ' g Alkohol · Vorschau</div>' + note +
    '</div>';
  }

  function geoLine(geo) {
    var s = geo && geo.status;
    if (s === 'ok') return '<span class="dot ok"></span>Standort erfasst';
    if (s === 'pending') return '<span class="dot wait"></span>Standort wird ermittelt…';
    if (s === 'denied') return '<span class="dot bad"></span>Standort nicht erlaubt. Das Getränk erscheint nicht auf der Karte.';
    return '<span class="dot bad"></span>Kein Standort verfügbar. Das Getränk erscheint nicht auf der Karte.';
  }

  function logPhoto(ls) {
    if (ls.previewUrl) {
      return '<div class="shot-wrap"><img class="shot" src="' + esc(ls.previewUrl) + '" alt="Dein Foto">' +
        '<button type="button" class="btn small" data-action="open-camera">Neu aufnehmen</button></div>';
    }
    return '<button type="button" class="photo-btn" data-action="open-camera">' + icon('camera') + '<span>Foto vom Getränk aufnehmen</span><small>Pflicht. Nur so zählt es.</small></button>';
  }

  function logSaveDisabled(ls) {
    return !ls.blob || ls.saving || !!Logic.validateDrink(logDrinkValues(ls));
  }

  function logSheetView(ls, ctx) {
    var cat = currentCategory(ls);
    var catButtons = Logic.CATEGORIES.map(function (c) {
      return '<button type="button" class="' + (!ls.custom && c.key === ls.category ? 'on' : '') + '" data-action="log-category" data-key="' + c.key + '">' + esc(c.label) + '</button>';
    }).join('') + '<button type="button" class="' + (ls.custom ? 'on' : '') + '" data-action="log-custom">Eigenes</button>';

    var body;
    if (ls.custom) {
      body = '<div class="custom">' +
        '<label>Name<input id="log-name" type="text" maxlength="40" value="' + esc(ls.name) + '" placeholder="z. B. Hugo"></label>' +
        '<div class="grid2">' +
          '<label>Alkohol in %<input id="log-abv" type="text" inputmode="decimal" value="' + esc(fmt(ls.abv)) + '"></label>' +
          '<label>Menge in ml<input id="log-ml" type="text" inputmode="numeric" value="' + esc(ls.sizeMl) + '"></label>' +
        '</div>' +
        '<label>Art<select id="log-cat">' + Logic.CATEGORIES.map(function (c) {
          return '<option value="' + c.key + '"' + (c.key === ls.category ? ' selected' : '') + '>' + esc(c.label) + ' (Bezug ' + esc(Logic.describeSize(c.refMl)) + ')</option>';
        }).join('') + '</select></label>' +
      '</div>';
    } else {
      body = '<div class="chips">' + Logic.presetsOf(cat.key).map(function (p) {
        return '<button type="button" class="chip' + (p.key === ls.presetKey ? ' on' : '') + '" data-action="log-preset" data-key="' + p.key + '">' + esc(p.name) + '<small>' + fmt(p.abv) + ' %</small></button>';
      }).join('') + '</div>' +
      '<div class="label">Größe</div>' +
      '<div class="chips">' + cat.sizes.map(function (ml) {
        return '<button type="button" class="chip' + (ml === Number(ls.sizeMl) ? ' on' : '') + '" data-action="log-size" data-ml="' + ml + '">' + esc(Logic.describeSize(ml)) + '</button>';
      }).join('') + '</div>';
    }

    return '' +
      '<div class="sheet-card" role="dialog" aria-modal="true" aria-label="Getränk loggen">' +
        '<header class="sheet-head"><h2>Getränk loggen</h2><button class="icon-btn" data-action="close-sheet" aria-label="Schließen">' + icon('x') + '</button></header>' +
        '<div class="sheet-body">' +
          '<div class="seg scroll">' + catButtons + '</div>' +
          body +
          '<div id="log-preview">' + logPreview(ls, ctx) + '</div>' +
          '<div id="log-photo">' + logPhoto(ls) + '</div>' +
          '<div class="geo" id="log-geo">' + geoLine(ls.geo) + '</div>' +
          '<p class="msg" id="log-msg" role="alert"></p>' +
        '</div>' +
        '<footer class="sheet-foot"><button id="log-save" class="btn primary wide" data-action="save-drink"' + (logSaveDisabled(ls) ? ' disabled' : '') + '>' + (ls.saving ? 'Speichere…' : 'Speichern') + '</button></footer>' +
      '</div>';
  }

  return {
    icon: icon,
    authView: authView,
    noGroupView: noGroupView,
    rankView: rankView,
    feedView: feedView,
    mapView: mapView,
    mapPopup: mapPopup,
    groupView: groupView,
    logSheetView: logSheetView,
    logPreview: logPreview,
    logPhoto: logPhoto,
    geoLine: geoLine,
    logSaveDisabled: logSaveDisabled
  };
});
