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
  function limitOrNull(v) { return v == null ? null : Number(v); }

  function bar(used, limit) {
    var pct = limit > 0 ? Math.min(100, Math.round(used / limit * 100)) : 0;
    var cls = pct >= 100 ? ' full' : (pct >= 80 ? ' warn' : '');
    return '<div class="bar' + cls + '"><i style="width:' + pct + '%"></i></div>';
  }

  function ring(used, limit) {
    var C = 2 * Math.PI * 52;
    var has = limit != null && limit > 0;
    var pct = has ? Math.min(1, used / limit) : 0;
    var cls = !has ? ' none' : (pct >= 1 ? ' full' : (pct >= 0.8 ? ' warn' : ''));
    var sub = has ? 'von ' + fmt(limit) + ' Punkten' : 'Punkte · kein Limit';
    return '<div class="ring-wrap' + cls + '">' +
      '<svg class="ring" viewBox="0 0 120 120" aria-hidden="true"><circle class="r-bg" cx="60" cy="60" r="52"></circle>' +
      (has ? '<circle class="r-fg" cx="60" cy="60" r="52" stroke-dasharray="' + C.toFixed(1) + '" stroke-dashoffset="' + (C * (1 - pct)).toFixed(1) + '" transform="rotate(-90 60 60)"></circle>' : '') +
      '</svg><div class="ring-num"><b>' + fmt(used) + '</b><small>' + esc(sub) + '</small></div></div>';
  }

  function tonightCard(state) {
    var g = state.group;
    var t = state.today || { points: 0, grams: 0, count: 0 };
    var lp = limitOrNull(g.daily_limit), lg = limitOrNull(g.alcohol_limit_g);
    var alc = '<div class="stat"><span class="stat-l">Alkohol</span><span class="stat-v">' + fmt(t.grams) + ' g</span>' +
      (lg == null ? '<span class="stat-s">kein Limit</span>' : bar(t.grams, lg) + '<span class="stat-s">von ' + fmt(lg) + ' g</span>') + '</div>';
    var cnt = '<div class="stat"><span class="stat-l">Getränke</span><span class="stat-v">' + t.count + '</span><span class="stat-s">heute</span></div>';
    return '<div class="card tonight">' +
      '<div class="card-title">Dein Abend</div>' +
      '<div class="tonight-body">' + ring(t.points, lp) + '<div class="tonight-side">' + alc + cnt + '</div></div>' +
      ((lp != null || lg != null) ? '<p class="tiny muted">Ab Limit gibt es keine Punkte mehr. Wasser, Essen, Pausen.</p>' : '') +
      '<button type="button" class="linkbtn" data-action="open-heimweg">' + icon('map') + 'Heimweg-Check</button>' +
    '</div>';
  }

  var RANK_MODES = [{ value: 'board', label: 'Rangliste' }, { value: 'stats', label: 'Statistik' }];

  function rankView(state) {
    if (state.rankMode === 'stats') return statsView(state);
    var rows = Logic.rankRows(state.board || []);
    var html = '<div class="stack">' + seg('rankmode', 'mode', RANK_MODES, 'board') + seg('period', 'period', PERIODS, state.period) + tonightCard(state);
    if (!rows.length) {
      html += '<div class="empty">Noch niemand in der Gruppe.</div>';
    } else if (rows.every(function (r) { return r.drinks === 0; })) {
      html += '<div class="empty">Noch keine Getränke in diesem Zeitraum.<br><span class="muted">Tippe unten auf das Plus.</span></div>';
    }
    var podium = rows.length >= 3 && rows[2].points > 0;
    var listRows = podium ? rows.slice(3) : rows;
    if (podium) {
      var order = [rows[1], rows[0], rows[2]];
      html += '<div class="podium">' + order.map(function (r) {
        var me = r.user_id === state.uid;
        return '<div class="pod p' + r.rank + (me ? ' me' : '') + '">' +
          '<span class="av" style="--c:' + Logic.colorFor(r.user_id) + '">' + esc(Logic.initial(r.display_name)) + '</span>' +
          '<span class="pod-name">' + esc(r.display_name) + (me ? '<em>du</em>' : '') + '</span>' +
          '<span class="pod-pts">' + fmt(r.points) + '</span>' +
          '<small>' + r.drinks + (r.drinks === 1 ? ' Getränk' : ' Getränke') + '</small>' +
          '<span class="pod-step">' + r.rank + '</span>' +
        '</div>';
      }).join('') + '</div>';
    }
    html += '<ol class="board">' + listRows.map(function (r) {
      var me = r.user_id === state.uid;
      var medal = r.points > 0 && r.rank <= 3 ? ' p' + r.rank : '';
      return '<li class="row' + (me ? ' me' : '') + (r.rank === 1 && r.points > 0 ? ' first' : '') + '">' +
        '<span class="pos' + medal + '">' + r.rank + '</span>' +
        '<span class="av" style="--c:' + Logic.colorFor(r.user_id) + '">' + esc(Logic.initial(r.display_name)) + '</span>' +
        '<span class="who"><b>' + esc(r.display_name) + (me ? '<em>du</em>' : '') + '</b><small>' + r.drinks + (r.drinks === 1 ? ' Getränk' : ' Getränke') + '</small></span>' +
        '<span class="pts">' + fmt(r.points) + '</span>' +
      '</li>';
    }).join('') + '</ol></div>';
    return html;
  }

  /* ---------- Statistik ---------- */
  function shortDay(day) { return String(day).slice(8) + '.' + String(day).slice(5, 7) + '.'; }

  function nameOf(state, uid) {
    var m = (state.members || []).filter(function (x) { return x.user_id === uid; })[0];
    return m && m.profiles ? m.profiles.display_name : '?';
  }

  function tile(label, value, unit) {
    return '<div class="tile"><span class="tile-v">' + esc(value) + (unit ? '<small>' + esc(unit) + '</small>' : '') + '</span><span class="tile-l">' + esc(label) + '</span></div>';
  }

  function nightChart(perNight) {
    var max = 0;
    perNight.forEach(function (n) { if (n.points > max) max = n.points; });
    if (max <= 0) return '<p class="tiny muted">In den letzten 14 Abenden noch nichts eingetragen.</p>';
    var W = 280, H = 96, bw = 14, gap = (W - bw * perNight.length) / (perNight.length - 1);
    var bars = perNight.map(function (n, i) {
      var h = n.points > 0 ? Math.max(3, Math.round(n.points / max * (H - 10))) : 2;
      var x = (i * (bw + gap)).toFixed(1);
      var last = i === perNight.length - 1;
      return '<rect class="nbar' + (last ? ' now' : '') + (n.points > 0 ? '' : ' zero') + '" x="' + x + '" y="' + (H - h) + '" width="' + bw + '" height="' + h + '" rx="4"><title>' + esc(shortDay(n.day) + ': ' + fmt(n.points) + ' Punkte, ' + n.count + ' Getränke') + '</title></rect>';
    }).join('');
    return '<svg class="nchart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Punkte der letzten 14 Abende">' + bars + '</svg>' +
      '<div class="nchart-axis"><span>' + esc(shortDay(perNight[0].day)) + '</span><span>Höchster Abend: ' + esc(fmt(max)) + ' Punkte</span><span>heute</span></div>';
  }

  function statsView(state) {
    var head = '<div class="stack">' + seg('rankmode', 'mode', RANK_MODES, 'stats') + seg('period', 'period', PERIODS, state.period);
    if (state.statsError) return head + '<div class="empty">' + esc(state.statsError) + '<br><button class="btn" data-action="reload-stats">Erneut laden</button></div></div>';
    if (!state.statsDrinks) return head + '<div class="empty">Lade Statistik…</div></div>';
    var st = Logic.computeStats(state.statsDrinks, state.uid, state.period, state.now || new Date(), (state.members || []).length || 1);
    var me = st.me;
    var html = head;
    html += '<section class="sec"><h3>Deine Zahlen</h3>' +
      (me.count
        ? '<div class="tiles">' + tile('Getränke', String(me.count)) + tile('Punkte', fmt(me.points)) + tile('Alkohol', fmt(me.grams), ' g') + tile('Abende', String(me.nights)) + '</div>' +
          (me.favorite ? '<p class="fav"><span class="muted">Lieblingsgetränk</span><b>' + esc(me.favorite.name) + '</b><span class="muted">' + me.favorite.count + 'x</span></p>' : '') +
          '<p class="tiny muted">Im Schnitt ' + esc(fmt(me.avgPointsPerNight)) + ' Punkte pro Abend.</p>'
        : '<p class="muted">In diesem Zeitraum hast du noch nichts eingetragen.</p>') +
      '</section>';
    if (me.byCategory.length) {
      html += '<section class="sec"><h3>Was du trinkst</h3><ul class="cats-bars">' + me.byCategory.map(function (c) {
        return '<li><span class="cb-l">' + esc(c.label) + '</span><span class="cb-bar"><i style="width:' + Math.max(4, Math.round(c.share * 100)) + '%"></i></span><span class="cb-n">' + c.count + '</span></li>';
      }).join('') + '</ul></section>';
    }
    html += '<section class="sec"><h3>Deine letzten 14 Abende</h3>' + nightChart(st.perNight) + '</section>';
    var g = st.group;
    html += '<section class="sec"><h3>Die ganze Gruppe</h3>' +
      (g.count
        ? '<div class="tiles three">' + tile('Getränke', String(g.count)) + tile('Punkte', fmt(g.points)) + tile('Alkohol', fmt(g.grams), ' g') + '</div>' +
          (st.records.mostDrinks ? '<p class="rec"><span class="muted">Meiste Getränke an einem Abend</span><b>' + esc(nameOf(state, st.records.mostDrinks.user_id)) + ': ' + st.records.mostDrinks.count + '</b><span class="muted">am ' + esc(shortDay(st.records.mostDrinks.day)) + '</span></p>' : '') +
          (st.records.mostPoints ? '<p class="rec"><span class="muted">Meiste Punkte an einem Abend</span><b>' + esc(nameOf(state, st.records.mostPoints.user_id)) + ': ' + esc(fmt(st.records.mostPoints.points)) + '</b><span class="muted">am ' + esc(shortDay(st.records.mostPoints.day)) + '</span></p>' : '') +
          (g.favorite ? '<p class="rec"><span class="muted">Beliebtestes Getränk</span><b>' + esc(g.favorite.name) + '</b><span class="muted">' + g.favorite.count + 'x</span></p>' : '')
        : '<p class="muted">In diesem Zeitraum gibt es noch keine Getränke.</p>') +
      '</section>';
    html += badgesView(Logic.computeBadges(state.statsDrinks, state.uid, (state.members || []).length || 1, state.now || new Date()));
    return html + '</div>';
  }

  function badgesView(list) {
    var got = list.filter(function (b) { return b.earned; }).length;
    return '<section class="sec"><h3>Abzeichen</h3><p class="tiny muted">' + got + ' von ' + list.length + ' geholt</p><ul class="achs">' + list.map(function (b) {
      var prog = b.earned ? 'Geholt' : (b.target > 1 ? fmt(b.value) + ' von ' + b.target + (b.unit ? ' ' + b.unit : '') : 'Noch offen');
      return '<li class="ach ' + (b.earned ? 'on' : 'off') + '"><span class="ach-ic">' + icon('b-' + b.key) + '</span>' +
        '<b>' + esc(b.label) + '</b><span class="ach-d">' + esc(b.desc) + '</span><span class="ach-p">' + esc(prog) + '</span></li>';
    }).join('') + '</ul></section>';
  }

  /* ---------- Heimweg-Check ---------- */
  function heimwegView(info) {
    var g = Number(info.grams) || 0;
    var lead = g > 0 ? 'Du hast heute ' + fmt(g) + ' g reinen Alkohol getrunken.' : 'Heute ist noch kein Alkohol eingetragen.';
    var items = [
      ['glass', 'Trink ein Glas Wasser und iss etwas.'],
      ['map', 'Kläre deinen Heimweg: Taxi, Bahn oder jemand holt dich. Kein Auto, kein Fahrrad.'],
      ['users', 'Sag jemandem aus der Gruppe, dass du losgehst.']
    ];
    var html = '<div class="sheet-card" role="dialog" aria-label="Heimweg-Check">' +
      '<header class="sheet-head"><h2>Heimweg-Check</h2><button class="icon-btn" data-action="close-sheet" aria-label="Schließen">' + icon('x') + '</button></header>' +
      '<div class="sheet-body"><p class="lead">' + esc(lead) + '</p>' +
      '<ul class="checks">' + items.map(function (i) { return '<li>' + icon(i[0]) + '<span>' + esc(i[1]) + '</span></li>'; }).join('') + '</ul>';
    if (info.level >= 2) {
      html += '<div class="alert"><b>Das ist sehr viel Alkohol.</b><span>Bleib nicht allein und lass dich nicht allein nach Hause gehen. Bei Bewusstlosigkeit oder Atemproblemen: sofort 112 rufen, stabile Seitenlage.</span></div>';
    } else {
      html += '<p class="tiny muted">Bei Bewusstlosigkeit oder Atemproblemen: sofort 112 rufen, stabile Seitenlage.</p>';
    }
    html += '<p class="tiny muted">Das ist keine Promille-Messung und kein Freibrief zum Fahren.</p></div>' +
      '<footer class="sheet-foot row-btns"><a class="btn danger" href="tel:112">Notruf 112</a><button class="btn primary" data-action="close-sheet">Alles klar</button></footer></div>';
    return html;
  }

  /* ---------- Offline-Warteschlange ---------- */
  function pendingBar(state) {
    var items = state.pending || [];
    var waiting = items.filter(function (i) { return !i.failed; });
    var failed = items.filter(function (i) { return i.failed; });
    var html = '';
    if (state.offline) {
      html += '<div class="pbar"><div><b>Offline</b><small>Rangliste und Karte kommen wieder mit Netz. Eintragen geht trotzdem.</small></div></div>';
    }
    if (waiting.length) {
      html += '<div class="pbar"><div><b>' + waiting.length + (waiting.length === 1 ? ' Getränk wartet' : ' Getränke warten') + ' auf Netz</b><small>Wird automatisch gesendet, sobald du online bist.</small></div>' +
        '<button type="button" class="btn sm" data-action="flush-queue">Jetzt senden</button></div>';
    }
    failed.forEach(function (i) {
      html += '<div class="pbar bad"><div><b>' + esc(i.drink.name) + ' konnte nicht gesendet werden</b><small>' + esc(i.failed) + '</small></div>' +
        '<div class="pbtns"><button type="button" class="btn sm" data-action="retry-pending" data-id="' + esc(i.id) + '">Erneut senden</button>' +
        '<button type="button" class="btn sm" data-action="discard-pending" data-id="' + esc(i.id) + '">Verwerfen</button></div></div>';
    });
    return html;
  }

  function pendingCard(i) {
    return '<article class="post pending">' +
      '<div class="shot-btn">' + (i.thumb ? '<img src="' + esc(i.thumb) + '" alt="">' : '') + '<span class="gain-chip wait">wartet</span></div>' +
      '<div class="post-body"><div class="post-drink"><b>' + esc(Logic.drinkLabel(i.drink)) + '</b><span>' + fmt(i.drink.abv) + ' % · Foto liegt auf deinem Gerät</span></div></div>' +
    '</article>';
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
    return '<article class="post' + (disputed ? ' disputed' : '') + '">' +
      '<button class="shot-btn" data-action="zoom" data-path="' + esc(d.photo_path) + '" aria-label="Foto groß">' +
        '<img data-path="' + esc(d.photo_path) + '" alt="" loading="lazy">' +
        '<span class="gain-chip' + (capped ? ' capped' : '') + '">+' + fmt(d.points) + '</span>' +
        (disputed ? '<span class="dispute-flag">Angezweifelt, zählt nicht</span>' : '') +
      '</button>' +
      '<div class="post-body">' +
        '<div class="post-head">' +
          '<span class="av sm" style="--c:' + Logic.colorFor(d.user_id) + '">' + esc(Logic.initial(name)) + '</span>' +
          '<div class="post-who"><b>' + esc(name) + (me ? '<em>du</em>' : '') + '</b><small>' + esc(Logic.timeAgo(d.created_at, now)) + (d.lat == null ? ' · ohne Ort' : '') + '</small></div>' +
          '<div class="acts">' + actions + '</div>' +
        '</div>' +
        '<div class="post-drink"><b>' + esc(Logic.drinkLabel(d)) + '</b><span>' + fmt(d.abv) + ' % · ' + fmt(d.alcohol_g) + ' g Alkohol</span></div>' +
        (!disputed && flagCount ? '<div class="badge warn">' + flagCount + 'x gemeldet</div>' : '') +
      '</div>' +
    '</article>';
  }

  function feedView(state) {
    var list = state.drinks || [];
    var gidNow = state.group ? state.group.id : null;
    var pend = (state.pending || []).filter(function (i) { return !i.failed && i.groupId === gidNow; });
    if (!list.length && !pend.length) {
      return '<div class="empty">Noch keine Getränke.<br><span class="muted">Das erste geht aufs Haus: Plus antippen.</span></div>';
    }
    return '<div class="stack feed">' + pend.map(pendingCard).join('') + list.map(function (d) { return feedItem(d, state); }).join('') +
      '<p class="tiny muted center">Zweifelst du ein Foto an, tippe auf die Flagge. Mit genug Meldungen zählt das Getränk nicht.</p></div>';
  }

  /* ---------- Karte ---------- */
  function mapView(state) {
    var withLoc = 0, without = 0;
    (state.mapDrinks || []).forEach(function (d) { if (d.lat == null) without++; else withLoc++; });
    return '<div class="mapwrap">' +
      '<div class="maptools">' + seg('map-period', 'period', [{ value: 'heute', label: 'Heute' }, { value: 'woche', label: 'Woche' }, { value: 'gesamt', label: 'Alle' }], state.mapPeriod) + '</div>' +
      '<div id="map" class="map" role="region" aria-label="Karte"></div>' +
      '<p class="tiny muted center maphint">' + withLoc + (withLoc === 1 ? ' Ort' : ' Orte') + ' auf der Karte' + (without ? ' · ' + without + (without === 1 ? ' Getränk' : ' Getränke') + ' ohne Standort' : '') + '</p>' +
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
        '<div class="pop-info">' +
          '<b>' + esc(name) + '</b>' +
          '<span class="pop-drink">' + esc(Logic.drinkLabel(d)) + '</span>' +
          '<span class="pop-sub">' + fmt(d.abv) + ' % · ' + fmt(d.alcohol_g) + ' g Alkohol</span>' +
          '<span class="pop-sub">' + esc(Logic.timeAgo(d.created_at, now)) + ' · <em class="pop-pts">+' + fmt(d.points) + ' Punkte</em></span>' +
        '</div>' +
      '</div>';
    }).join('') + (more > 0 ? '<div class="pop-more">+ ' + more + ' weitere an diesem Ort</div>' : '') + '</div>';
  }

  /* ---------- Gruppe ---------- */
  function ruleTile(label, value, unit) {
    return '<div class="tile">' + (value === '' ? '<span class="tile-v off">Kein Limit</span>' : '<span class="tile-v">' + esc(value) + (unit ? '<small>' + esc(unit) + '</small>' : '') + '</span>') +
      '<span class="tile-l">' + esc(label) + '</span></div>';
  }

  function groupView(state) {
    var g = state.group;
    var isAdmin = g.role === 'admin';
    var members = (state.members || []).slice().sort(function (a, b) {
      var an = a.profiles ? a.profiles.display_name : '';
      var bn = b.profiles ? b.profiles.display_name : '';
      return an.localeCompare(bn, 'de');
    });
    var lpTxt = g.daily_limit == null ? '' : fmt(g.daily_limit);
    var lgTxt = g.alcohol_limit_g == null ? '' : fmt(g.alcohol_limit_g);
    var prefs = state.prefs || { camera: 'auto', geo: 'auto' };

    var code = '<div class="ticket">' +
      '<div class="ticket-l">Einladungscode</div>' +
      '<div class="code">' + String(g.invite_code).split('').map(function (c) { return '<span>' + esc(c) + '</span>'; }).join('') + '</div>' +
      '<div class="row-btns">' +
        '<button class="btn" data-action="copy-code">' + icon('copy') + 'Kopieren</button>' +
        '<button class="btn" data-action="share-code">' + icon('share') + 'Teilen</button>' +
      '</div>' +
      '<p class="tiny muted">Wer den Code hat, sieht Fotos und Orte der Gruppe. Gib ihn nur an Freunde.</p>' +
    '</div>';

    var memberList = '<div class="mcard"><ul class="members">' + members.map(function (m) {
      var n = m.profiles ? m.profiles.display_name : '?';
      return '<li><span class="av sm" style="--c:' + Logic.colorFor(m.user_id) + '">' + esc(Logic.initial(n)) + '</span>' +
        '<span class="m-name">' + esc(n) + (m.user_id === state.uid ? ' <em>du</em>' : '') + '</span>' +
        (m.role === 'admin' ? '<span class="badge admin">' + icon('b-sieger') + 'Admin</span>' : '') +
        (isAdmin && m.user_id !== state.uid ? '<button class="icon-btn" data-action="kick" data-user="' + esc(m.user_id) + '" data-name="' + esc(n) + '" aria-label="' + esc(n) + ' entfernen">' + icon('x') + '</button>' : '') + '</li>';
    }).join('') + '</ul></div>';

    var rules = '<div class="tiles">' + ruleTile('Punkte pro Abend', lpTxt) + ruleTile('Alkohol pro Abend', lgTxt, lgTxt ? 'g' : '') + '</div>';
    var rulesBody = rules;
    if (isAdmin) {
      rulesBody += '<details class="fold" id="admin-fold"' + (state.adminOpen ? ' open' : '') + '><summary>Limits ändern</summary>' +
        '<form id="limits-form" class="limits-form" novalidate>' +
          '<label>Punkte-Limit pro Abend<input name="points" type="text" inputmode="decimal" value="' + esc(lpTxt) + '" placeholder="kein Limit"></label>' +
          '<label>Alkohol-Obergrenze in g Reinalkohol<input name="grams" type="text" inputmode="decimal" value="' + esc(lgTxt) + '" placeholder="kein Limit"></label>' +
          '<p class="tiny muted">Frei wählbar. Feld leer lassen = kein Limit.</p>' +
          '<button class="btn" type="submit">Limits speichern</button>' +
        '</form></details>';
    } else {
      rulesBody += '<p class="tiny muted">Nur Admins ändern die Limits.</p>';
    }
    rulesBody += '<details class="fold"><summary>So zählen die Punkte</summary>' +
      '<p class="tiny muted">Alkoholgehalt geteilt durch 5, pro Standardportion: Pils 0,5 l = 1, Vodka 4 cl = 8, Radler 0,5 l = 0,1. Ab Limit gibt es keine Punkte mehr. Der Abend wechselt um 6 Uhr morgens.</p></details>';

    var manage = isAdmin
      ? '<details class="fold danger-zone" id="manage-fold"' + (state.manageOpen ? ' open' : '') + '><summary>Gruppe verwalten</summary>' +
          '<p class="tiny muted">Nur du kannst Mitglieder entfernen und die Gruppe löschen. Nach einem Rauswurf: neuen Code erzeugen, sonst kommt die Person mit dem alten Code wieder rein.</p>' +
          '<button class="btn wide" data-action="reset-code">Neuen Einladungscode erzeugen</button>' +
          '<button class="btn danger wide" data-action="delete-group">Gruppe löschen</button>' +
        '</details>'
      : '<div class="leave"><button class="btn danger wide" data-action="leave-group">Gruppe verlassen</button>' +
          '<p class="tiny muted">Beim Austreten werden deine Getränke und Fotos in dieser Gruppe gelöscht.</p></div>';

    return '' +
      '<div class="stack group-view">' +
        code +
        '<section class="gsec"><h3>Mitglieder <span class="count">' + members.length + '</span></h3>' + memberList + '</section>' +
        '<section class="gsec"><h3>Limits für den Abend</h3>' + rulesBody + '</section>' +
        '<section class="gsec"><h3>Dein Profil</h3>' +
          '<form id="rename-form" class="inline-form" novalidate>' +
            '<input name="name" type="text" maxlength="24" value="' + esc(state.profile ? state.profile.display_name : '') + '" aria-label="Mein Name">' +
            '<button class="btn" type="submit">Ändern</button>' +
          '</form>' +
          '<details class="fold"><summary>Dieses Gerät</summary>' +
            '<label>Kamera<select data-pref="camera"><option value="auto"' + (prefs.camera === 'system' ? '' : ' selected') + '>Live-Kamera in der App</option><option value="system"' + (prefs.camera === 'system' ? ' selected' : '') + '>Systemkamera, ohne Abfrage</option></select></label>' +
            '<label>Standort<select data-pref="geo"><option value="auto"' + (prefs.geo === 'off' ? '' : ' selected') + '>Automatisch erfassen</option><option value="off"' + (prefs.geo === 'off' ? ' selected' : '') + '>Aus</option></select></label>' +
            '<p class="tiny muted">Bei der Abfrage „Erlauben“ wählen, nicht „Einmal“. Dann merkt sich der Browser es. iPhone: Einstellungen → Safari → Kamera und Standort → Erlauben. Wurde abgelehnt, nutzt die App die Systemkamera.</p>' +
          '</details>' +
        '</section>' +
        '<section class="gsec"><h3>Weitere Gruppen</h3>' +
          '<details class="fold"><summary>Beitreten oder erstellen</summary>' +
            '<form id="join-form" class="inline-form" novalidate>' +
              '<input name="code" type="text" maxlength="12" autocapitalize="characters" autocomplete="off" placeholder="Code" aria-label="Einladungscode">' +
              '<button class="btn" type="submit">Beitreten</button>' +
            '</form>' +
            '<form id="create-form" class="inline-form" novalidate>' +
              '<input name="name" type="text" maxlength="40" placeholder="Neuer Gruppenname" aria-label="Gruppenname">' +
              '<button class="btn" type="submit">Erstellen</button>' +
            '</form>' +
          '</details>' +
        '</section>' +
        manage +
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
    if (s === 'off') return '<span class="dot bad"></span>Standort aus. Das Getränk erscheint nicht auf der Karte. Einstellung unter Gruppe.';
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
      return '<button type="button" class="cat' + (!ls.custom && c.key === ls.category ? ' on' : '') + '" data-action="log-category" data-key="' + c.key + '"><span class="cat-disc">' + icon(c.key) + '</span><span class="cat-name">' + esc(c.label) + '</span></button>';
    }).join('') + '<button type="button" class="cat' + (ls.custom ? ' on' : '') + '" data-action="log-custom"><span class="cat-disc">' + icon('edit') + '</span><span class="cat-name">Eigenes</span></button>';

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
          '<div class="cats">' + catButtons + '</div>' +
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
    statsView: statsView,
    badgesView: badgesView,
    heimwegView: heimwegView,
    pendingBar: pendingBar,
    pendingCard: pendingCard,
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
