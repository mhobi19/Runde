/* Runde – App-Logik (Anmeldung, Daten laden, Kamera, Karte, Speichern). */
(function () {
  'use strict';

  var Logic = window.RundeLogic;
  var Views = window.RundeViews;
  var cfg = window.RUNDE_CONFIG || {};

  var BUCKET = 'drink-photos';
  var REFRESH_MS = 30000;
  var PHOTO_TTL_MS = 50 * 60 * 1000;
  var TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  var DRINK_COLS = 'id,user_id,category,name,abv,volume_ml,alcohol_g,points,points_raw,party_day,photo_path,lat,lng,created_at,profiles!drinks_user_id_fkey(display_name),drink_flags(user_id)';

  var sb = null;
  var state = {
    session: null, uid: null, profile: null,
    groups: [], group: null, members: [], drinks: [], board: [], mapDrinks: [],
    today: { points: 0, grams: 0, count: 0 },
    tab: 'rank', period: 'heute', mapPeriod: 'woche',
    now: new Date(), authMode: 'login', log: null, loadToken: 0, prefs: null, adminOpen: false, manageOpen: false,
    pending: [], offline: false, rankMode: 'board', statsDrinks: null, statsError: null
  };
  var CACHE_KEY = 'runde_cache';
  var flushing = false;
  var PREF_KEY = 'runde_device';
  var photoCache = {};
  var lastGeo = null;

  function loadPrefs() {
    var d = { camera: 'auto', geo: 'auto' };
    try {
      var raw = localStorage.getItem(PREF_KEY);
      if (raw) {
        var o = JSON.parse(raw);
        if (o.camera === 'system') d.camera = 'system';
        if (o.geo === 'off') d.geo = 'off';
      }
    } catch (e) { logError('Geräte-Einstellungen lesen', e); }
    return d;
  }

  function savePrefs() {
    try { localStorage.setItem(PREF_KEY, JSON.stringify(state.prefs)); }
    catch (e) { logError('Geräte-Einstellungen speichern', e); }
  }

  function permState(name) {
    if (!navigator.permissions || !navigator.permissions.query) return Promise.resolve('unknown');
    return navigator.permissions.query({ name: name }).then(function (r) { return r.state; }, function () { return 'unknown'; });
  }
  var map = null, mapEl = null, markerLayer = null, mapFitted = false;
  var cam = { stream: null };
  var toastTimer = null;

  function $(id) { return document.getElementById(id); }
  function pad(n) { return n < 10 ? '0' + n : String(n); }

  /* ---------- kleine Helfer ---------- */
  function bootMessage(text) {
    var b = $('boot');
    b.textContent = text;
    b.hidden = false;
  }

  function toast(msg, kind, ms) {
    var t = $('toast');
    t.textContent = msg;
    t.className = 'toast' + (kind ? ' ' + kind : '');
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, ms || 3200);
  }

  function setMsg(id, text, ok) {
    var el = $(id);
    if (!el) return;
    el.textContent = text || '';
    el.className = 'msg' + (ok ? ' ok' : '');
  }

  function humanError(e) {
    var m = (e && e.message) ? String(e.message) : String(e || 'Unbekannter Fehler');
    if (/invalid login credentials/i.test(m)) return 'E-Mail oder Passwort falsch.';
    if (/already registered|already been registered/i.test(m)) return 'Diese E-Mail ist schon registriert. Bitte anmelden.';
    if (/password should be|weak password/i.test(m)) return 'Passwort zu schwach. Mindestens 8 Zeichen.';
    if (/unable to validate email|invalid email/i.test(m)) return 'Diese E-Mail-Adresse ist ungültig.';
    if (/email rate limit|rate limit|too many/i.test(m)) return 'Zu viele Versuche. Bitte kurz warten.';
    if (/row-level security|violates row/i.test(m)) return 'Keine Berechtigung (Foto-Speicher oder Gruppe). Prüfe die Datenbank-Einrichtung.';
    if (/failed to fetch|networkerror|load failed/i.test(m)) return 'Keine Verbindung. Bitte Internet prüfen.';
    if (/jwt expired/i.test(m)) return 'Sitzung abgelaufen. Bitte neu anmelden.';
    return m;
  }

  function uuid() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    var b = new Uint8Array(16);
    window.crypto.getRandomValues(b);
    b[6] = (b[6] & 15) | 64;
    b[8] = (b[8] & 63) | 128;
    var h = Array.prototype.map.call(b, function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }

  function configured() {
    return !!cfg.SUPABASE_URL && !!cfg.SUPABASE_ANON_KEY &&
      cfg.SUPABASE_URL.indexOf('DEIN-PROJEKT') === -1 && cfg.SUPABASE_ANON_KEY.indexOf('DEIN-') === -1;
  }

  function logError(where, e) {
    console.error('[Runde] ' + where + ':', e);
  }

  /* ---------- Start ---------- */
  async function init() {
    state.prefs = loadPrefs();
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
      navigator.serviceWorker.register('sw.js').catch(function (e) { logError('Service Worker', e); });
    }
    if (!configured()) {
      bootMessage('Einrichtung fehlt: Trage in config.js deine Supabase-URL und den Key ein (siehe SETUP.md).');
      return;
    }
    var cache = readCache();
    var libOk = !!(window.supabase && window.supabase.createClient);
    if (!libOk && !cache) {
      bootMessage('Eine Bibliothek konnte nicht geladen werden. Bitte Internet prüfen und neu laden.');
      return;
    }
    bindEvents();
    if (libOk) {
      sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
      });
      sb.auth.onAuthStateChange(function (event, session) {
        state.session = session;
        if (event === 'SIGNED_OUT') { clearCache(); setTimeout(showAuth, 0); }
      });
    }
    try {
      if (cache && (!libOk || navigator.onLine === false)) {
        await enterOffline(cache);
      } else {
        var res = await Promise.race([
          sb.auth.getSession(),
          new Promise(function (_, rej) { setTimeout(function () { rej(new Error('Failed to fetch (Zeitüberschreitung)')); }, 6000); })
        ]);
        state.session = res.data && res.data.session;
        if (state.session) { await enterApp(); }
        else { showAuth(); }
      }
    } catch (e) {
      logError('init', e);
      var c2 = readCache();
      if (c2 && Logic.isNetworkError(e)) { await enterOffline(c2); }
      else { showAuth(); setMsg('auth-msg', humanError(e)); }
    }
    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      deferredInstall = e;
      if (state.group && state.tab === 'rank' && !state.log) render(true);
    });
    window.addEventListener('appinstalled', function () { deferredInstall = null; dismissInstall(); if (state.group) render(true); });
    window.addEventListener('online', function () {
      if (state.offline) leaveOffline().then(function () { flushQueue(false); });
      else flushQueue(false);
    });
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && state.pending.length) { if (state.offline) leaveOffline(); else flushQueue(false); }
    });
    $('boot').hidden = true;
    setInterval(function () {
      if (document.hidden || !state.session || !state.group || state.log || !$('camera').hidden) return;
      refreshGroupData(true);
    }, REFRESH_MS);
    setInterval(function () {
      if (state.pending.some(function (i) { return !i.failed; })) {
        if (state.offline && navigator.onLine !== false) leaveOffline(); else flushQueue(false);
      }
    }, 45000);
  }

  /* ---------- Anmeldung ---------- */
  function showAuth() {
    $('screen-app').hidden = true;
    document.body.setAttribute('data-scene', 'auth');
    var a = $('screen-auth');
    a.innerHTML = Views.authView(state.authMode);
    a.hidden = false;
    closeSheet();
  }

  async function onAuthSubmit(form) {
    var mode = form.getAttribute('data-mode');
    var fd = new FormData(form);
    var email = String(fd.get('email') || '').trim();
    var pw = String(fd.get('password') || '');
    var btn = form.querySelector('button[type=submit]');
    setMsg('auth-msg', '');
    if (!email || !pw) { setMsg('auth-msg', 'Bitte E-Mail und Passwort eingeben.'); return; }
    if (mode === 'signup') {
      var name = String(fd.get('name') || '').trim();
      if (name.length < 2 || name.length > 24) { setMsg('auth-msg', 'Name: 2 bis 24 Zeichen.'); return; }
      if (pw.length < 8) { setMsg('auth-msg', 'Passwort: mindestens 8 Zeichen.'); return; }
      if (!fd.get('adult')) { setMsg('auth-msg', 'Die App ist nur für Personen ab 18.'); return; }
    }
    btn.disabled = true;
    try {
      var r;
      if (mode === 'signup') {
        r = await sb.auth.signUp({ email: email, password: pw, options: { data: { display_name: String(fd.get('name')).trim() } } });
        if (r.error) throw r.error;
        if (!r.data.session) {
          setMsg('auth-msg', 'Fast geschafft: Bestätige deine E-Mail über den Link, den wir dir geschickt haben, und melde dich dann an.', true);
          return;
        }
      } else {
        r = await sb.auth.signInWithPassword({ email: email, password: pw });
        if (r.error) throw r.error;
      }
      state.session = r.data.session;
      await enterApp();
    } catch (e) {
      logError('Anmeldung', e);
      setMsg('auth-msg', humanError(e));
    } finally {
      btn.disabled = false;
    }
  }

  async function enterApp() {
    state.uid = state.session.user.id;
    var p = await sb.from('profiles').select('id,display_name').eq('id', state.uid).maybeSingle();
    if (p.error) throw p.error;
    if (!p.data) throw new Error('Profil nicht gefunden. Prüfe, ob schema.sql komplett gelaufen ist.');
    state.profile = p.data;
    await loadGroups();
    var saved = null;
    try { saved = localStorage.getItem('runde_group'); } catch (e) { logError('localStorage lesen', e); }
    state.group = state.groups.filter(function (g) { return g.id === saved; })[0] || state.groups[0] || null;
    state.tab = 'rank';
    $('screen-auth').hidden = true;
    $('screen-app').hidden = false;
    renderGroupSelect();
    await refreshPending();
    render(false);
    await refreshGroupData(false);
    flushQueue(false);
  }

  async function loadGroups() {
    var r = await sb.from('group_members')
      .select('role,groups(id,name,invite_code,daily_limit,alcohol_limit_g)')
      .eq('user_id', state.uid);
    if (r.error) throw r.error;
    state.groups = (r.data || []).filter(function (x) { return x.groups; }).map(function (x) {
      var g = x.groups;
      return { id: g.id, name: g.name, invite_code: g.invite_code, daily_limit: g.daily_limit, alcohol_limit_g: g.alcohol_limit_g, role: x.role };
    });
    state.groups.sort(function (a, b) { return a.name.localeCompare(b.name, 'de'); });
    if (state.group) {
      state.group = state.groups.filter(function (g) { return g.id === state.group.id; })[0] || null;
    }
    saveCache();
  }

  function saveCache() {
    if (!state.uid || !state.profile) return;
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ uid: state.uid, name: state.profile.display_name, groups: state.groups }));
    } catch (e) { logError('Cache speichern', e); }
  }

  function readCache() {
    try {
      var raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      var c = JSON.parse(raw);
      return c && c.uid && Array.isArray(c.groups) ? c : null;
    } catch (e) { logError('Cache lesen', e); return null; }
  }

  function clearCache() {
    try { localStorage.removeItem(CACHE_KEY); } catch (e) { logError('Cache löschen', e); }
  }

  async function enterOffline(c) {
    state.uid = c.uid;
    state.profile = { id: c.uid, display_name: c.name };
    state.groups = c.groups;
    var saved = null;
    try { saved = localStorage.getItem('runde_group'); } catch (e) { logError('localStorage lesen', e); }
    state.group = state.groups.filter(function (g) { return g.id === saved; })[0] || state.groups[0] || null;
    state.tab = 'rank';
    state.offline = true;
    $('screen-auth').hidden = true;
    $('screen-app').hidden = false;
    renderGroupSelect();
    await refreshPending();
    render(false);
  }

  async function leaveOffline() {
    if (!sb) { state.offline = true; return; }
    try {
      var r = await sb.auth.getSession();
      state.session = r.data && r.data.session;
      state.offline = false;
      if (!state.session) { showAuth(); return; }
      await enterApp();
    } catch (e) {
      logError('Wieder online', e);
      state.offline = true;
    }
  }

  /* ---------- Offline-Warteschlange ---------- */
  async function refreshPending() {
    var list = [];
    try { list = await window.RundeQueue.all(); } catch (e) { logError('Warteschlange lesen', e); }
    (state.pending || []).forEach(function (i) { if (i.thumb) URL.revokeObjectURL(i.thumb); });
    state.pending = list.filter(function (i) { return i.userId === state.uid; }).map(function (i) {
      return { id: i.id, groupId: i.groupId, drink: i.drink, failed: i.failed || null, thumb: i.blob ? URL.createObjectURL(i.blob) : null };
    });
  }

  async function sendDrink(item) {
    var up = await sb.storage.from(BUCKET).upload(item.path, item.blob, { contentType: 'image/jpeg', upsert: false, cacheControl: '3600' });
    if (up.error && String(up.error.statusCode) !== '409' && !/already exists|duplicate/i.test(String(up.error.message))) throw up.error;
    var r = await sb.rpc('log_drink', {
      p_group: item.groupId,
      p_category: item.drink.category,
      p_name: item.drink.name,
      p_abv: item.drink.abv,
      p_volume_ml: item.drink.volume_ml,
      p_party_day: item.partyDay,
      p_photo_path: item.path,
      p_lat: item.lat,
      p_lng: item.lng,
      p_taken_at: item.takenAt
    });
    if (r.error) throw r.error;
    return r.data || {};
  }

  async function flushQueue(manual) {
    if (flushing || !sb || !state.session || state.offline) return;
    if (navigator.onLine === false) { if (manual) toast('Noch kein Netz.', 'bad'); return; }
    flushing = true;
    var sent = 0, pts = 0, capped = 0;
    try {
      var list = await window.RundeQueue.all();
      for (var i = 0; i < list.length; i++) {
        var item = list[i];
        if (item.userId !== state.uid || item.failed) continue;
        try {
          var res = await sendDrink(item);
          await window.RundeQueue.remove(item.id);
          sent++;
          pts += Number(res.points) || 0;
          if (res.capped) capped++;
        } catch (e) {
          if (Logic.isNetworkError(e)) { logError('Warteschlange: kein Netz', e); break; }
          if (/could not find the function|schema cache|PGRST20/i.test(String((e && e.message) || '') + String((e && e.code) || ''))) {
            logError('Warteschlange: Datenbank-Update fehlt', e);
            if (manual) toast('Die Datenbank ist noch nicht aktualisiert (migration_paket3.sql). Das Getränk bleibt gespeichert.', 'bad', 6000);
            break;
          }
          logError('Warteschlange: Getränk abgelehnt', e);
          item.failed = humanError(e);
          await window.RundeQueue.update(item);
        }
      }
    } catch (e) {
      logError('Warteschlange', e);
    } finally {
      flushing = false;
    }
    await refreshPending();
    if (sent) {
      toast(sent + (sent === 1 ? ' Getränk' : ' Getränke') + ' hochgeladen, +' + Logic.fmt(pts) + ' Punkte' + (capped ? ' (Limit erreicht)' : ''), 'good', 4800);
      await refreshGroupData(false);
    } else {
      render(true);
    }
  }

  /* ---------- Heimweg-Check ---------- */
  var HEIMWEG_KEY = 'runde_heimweg';
  var INSTALL_KEY = 'runde_install';
  var deferredInstall = null;

  function refreshInstall() {
    var standalone = false;
    try { standalone = navigator.standalone === true || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches); }
    catch (e) { logError('Installations-Check', e); }
    state.installMode = Logic.installMode({
      standalone: standalone, ua: navigator.userAgent, platform: navigator.platform,
      touchPoints: navigator.maxTouchPoints, hasPrompt: !!deferredInstall
    });
    var dismissed = false;
    try { dismissed = localStorage.getItem(INSTALL_KEY) === 'dismissed'; } catch (e) { logError('Installations-Hinweis lesen', e); }
    state.installBanner = state.installMode !== 'none' && !dismissed;
  }

  function dismissInstall() {
    try { localStorage.setItem(INSTALL_KEY, 'dismissed'); } catch (e) { logError('Installations-Hinweis speichern', e); }
  }

  async function tonightGrams() {
    var day = Logic.partyDay(new Date());
    var g = null;
    if (!state.offline && sb) {
      try {
        var r = await sb.from('drinks').select('alcohol_g,party_day,user_id').eq('user_id', state.uid).eq('party_day', day);
        if (r.error) throw r.error;
        g = Logic.usageToday(r.data || [], state.uid, day).grams;
      } catch (e) { logError('Heimweg-Check: Alkohol heute', e); }
    }
    if (g == null) g = state.today ? state.today.grams : 0;
    (state.pending || []).forEach(function (i) {
      if (i.userId === state.uid && i.partyDay === day && !i.failed) g += Logic.alcoholGrams(i.drink.abv, i.drink.volume_ml);
    });
    return Math.round(g * 10) / 10;
  }

  function showHeimweg(grams, level) {
    state.log = null;
    var s = $('sheet');
    s.innerHTML = Views.heimwegView({ grams: grams, level: level });
    s.hidden = false;
    document.body.style.overflow = 'hidden';
  }

  async function maybeHeimweg() {
    if (!state.group || state.log) return;
    var grams = await tonightGrams();
    var level = Logic.heimwegLevel(grams, state.group.alcohol_limit_g);
    if (!level) return;
    var day = Logic.partyDay(new Date());
    var seen = 0;
    try {
      var raw = localStorage.getItem(HEIMWEG_KEY);
      var o = raw ? JSON.parse(raw) : null;
      if (o && o.day === day) seen = Number(o.level) || 0;
    } catch (e) { logError('Heimweg-Check lesen', e); }
    if (level <= seen) return;
    try { localStorage.setItem(HEIMWEG_KEY, JSON.stringify({ day: day, level: level })); }
    catch (e) { logError('Heimweg-Check speichern', e); }
    if (state.log) return;
    showHeimweg(grams, level);
  }

  async function openHeimweg() {
    var grams = await tonightGrams();
    showHeimweg(grams, Math.max(1, Logic.heimwegLevel(grams, state.group && state.group.alcohol_limit_g)));
  }

  /* ---------- Statistik ---------- */
  async function loadStats() {
    if (!state.group || state.offline) return;
    var gid = state.group.id;
    var all = [];
    state.statsError = null;
    try {
      for (var from = 0; from < 5000; from += 1000) {
        var r = await sb.from('drinks').select('user_id,party_day,category,name,points,alcohol_g,created_at,lat,lng,drink_flags(user_id)')
          .eq('group_id', gid).order('created_at', { ascending: false }).range(from, from + 999);
        if (r.error) throw r.error;
        all = all.concat(r.data || []);
        if ((r.data || []).length < 1000) break;
      }
      if (!state.group || state.group.id !== gid) return;
      state.statsDrinks = all;
    } catch (e) {
      logError('Statistik laden', e);
      state.statsError = humanError(e);
    }
    if (state.tab === 'rank' && state.rankMode === 'stats') render(true);
  }

  function renderGroupSelect() {
    var sel = $('group-select');
    if (!state.groups.length) {
      sel.innerHTML = '<option>Runde</option>';
      sel.disabled = true;
      return;
    }
    sel.disabled = false;
    sel.innerHTML = state.groups.map(function (g) {
      return '<option value="' + Logic.esc(g.id) + '"' + (state.group && g.id === state.group.id ? ' selected' : '') + '>' + Logic.esc(g.name) + '</option>';
    }).join('');
  }

  async function setGroup(id) {
    var g = state.groups.filter(function (x) { return x.id === id; })[0];
    if (!g) return;
    state.group = g;
    try { localStorage.setItem('runde_group', g.id); } catch (e) { logError('localStorage schreiben', e); }
    state.members = []; state.drinks = []; state.board = []; state.mapDrinks = [];
    state.statsDrinks = null; state.statsError = null;
    state.today = { points: 0, grams: 0, count: 0 };
    renderGroupSelect();
    render(false);
    await refreshGroupData(false);
  }

  /* ---------- Daten laden ---------- */
  async function refreshGroupData(soft) {
    if (state.offline) return;
    if (!state.group) { render(false); return; }
    var token = ++state.loadToken;
    var gid = state.group.id;
    var now = new Date();
    var day = Logic.partyDay(now);
    var mapFrom = Logic.periodStart(state.mapPeriod, now);
    var mapQuery = sb.from('drinks').select(DRINK_COLS).eq('group_id', gid).not('lat', 'is', null)
      .order('created_at', { ascending: false }).limit(500);
    if (mapFrom) mapQuery = mapQuery.gte('party_day', mapFrom);
    try {
      var res = await Promise.all([
        sb.from('group_members').select('user_id,role,profiles!group_members_user_id_fkey(display_name)').eq('group_id', gid),
        sb.from('drinks').select(DRINK_COLS).eq('group_id', gid).order('created_at', { ascending: false }).limit(60),
        sb.rpc('leaderboard', { p_group: gid, p_from: Logic.periodStart(state.period, now) }),
        mapQuery,
        sb.from('drinks').select('points,alcohol_g,party_day,user_id').eq('group_id', gid).eq('user_id', state.uid).eq('party_day', day)
      ]);
      for (var i = 0; i < res.length; i++) { if (res[i].error) throw res[i].error; }
      if (token !== state.loadToken || !state.group || state.group.id !== gid) return;
      state.members = res[0].data || [];
      state.drinks = res[1].data || [];
      state.board = res[2].data || [];
      state.mapDrinks = res[3].data || [];
      state.today = Logic.usageToday(res[4].data || [], state.uid, day);
      state.now = now;
      render(!!soft);
      if (state.rankMode === 'stats' && !soft) loadStats();
    } catch (e) {
      logError('Daten laden', e);
      if (!soft) toast(humanError(e), 'bad');
    }
  }

  async function loadBoard() {
    if (!state.group) return;
    var gid = state.group.id;
    var r = await sb.rpc('leaderboard', { p_group: gid, p_from: Logic.periodStart(state.period, new Date()) });
    if (r.error) { logError('Rangliste', r.error); toast(humanError(r.error), 'bad'); return; }
    if (!state.group || state.group.id !== gid) return;
    state.board = r.data || [];
    render(false);
  }

  async function loadMapData() {
    if (!state.group) return;
    var gid = state.group.id;
    var from = Logic.periodStart(state.mapPeriod, new Date());
    var q = sb.from('drinks').select(DRINK_COLS).eq('group_id', gid).not('lat', 'is', null)
      .order('created_at', { ascending: false }).limit(500);
    if (from) q = q.gte('party_day', from);
    var r = await q;
    if (r.error) { logError('Kartendaten', r.error); toast(humanError(r.error), 'bad'); return; }
    if (!state.group || state.group.id !== gid) return;
    state.mapDrinks = r.data || [];
    state.now = new Date();
    mapFitted = false;
    render(false);
  }

  async function loadToday() {
    if (!state.group) return;
    var day = Logic.partyDay(new Date());
    var r = await sb.from('drinks').select('points,alcohol_g,party_day,user_id')
      .eq('group_id', state.group.id).eq('user_id', state.uid).eq('party_day', day);
    if (r.error) { logError('Heute geladen', r.error); return; }
    state.today = Logic.usageToday(r.data || [], state.uid, day);
  }

  /* ---------- Anzeige ---------- */
  function updateNav() {
    document.body.setAttribute('data-scene', state.group ? state.tab : 'group');
    Array.prototype.forEach.call(document.querySelectorAll('.tabs [data-tab]'), function (b) {
      b.classList.toggle('on', b.getAttribute('data-tab') === state.tab);
    });
  }

  function render(soft) {
    var view = $('view');
    refreshInstall();
    updateNav();
    if (!state.group) {
      leaveMap();
      view.classList.remove('flush');
      if (!(soft && view.querySelector('#join-form'))) view.innerHTML = Views.noGroupView();
      return;
    }
    if (state.tab === 'map') {
      view.classList.add('flush');
      if (soft && map && mapEl && document.body.contains(mapEl)) {
        updateMarkers();
        return;
      }
      leaveMap();
      view.innerHTML = Views.mapView(state);
      initMap();
      return;
    }
    leaveMap();
    view.classList.remove('flush');
    if (soft && state.tab === 'group') return;
    var scroll = view.scrollTop;
    var html = '';
    if (state.tab === 'feed') html = Views.feedView(state);
    else if (state.tab === 'group') html = Views.groupView(state);
    else html = Views.rankView(state);
    if (state.tab !== 'map') html = Views.pendingBar(state) + (state.tab === 'rank' ? Views.installBanner(state) : '') + html;
    view.classList.toggle('anim', !soft);
    view.innerHTML = html;
    view.scrollTop = soft ? scroll : 0;
    hydratePhotos(view);
  }

  function leaveMap() {
    if (map) {
      try { map.remove(); } catch (e) { logError('Karte entfernen', e); }
    }
    map = null; mapEl = null; markerLayer = null;
  }

  function switchTab(tab) {
    state.tab = tab;
    render(false);
  }

  /* ---------- Fotos (signierte Links) ---------- */
  async function hydratePhotos(root) {
    if (!root || !sb) return;
    var imgs = Array.prototype.slice.call(root.querySelectorAll('img[data-path]'));
    var now = Date.now();
    var need = [];
    imgs.forEach(function (img) {
      var p = img.getAttribute('data-path');
      var c = photoCache[p];
      if ((!c || now - c.t > PHOTO_TTL_MS) && need.indexOf(p) === -1) need.push(p);
    });
    if (need.length) {
      try {
        var r = await sb.storage.from(BUCKET).createSignedUrls(need, 3600);
        if (r.error) throw r.error;
        (r.data || []).forEach(function (o) {
          if (o.signedUrl) photoCache[o.path] = { url: o.signedUrl, t: Date.now() };
        });
      } catch (e) {
        logError('Foto-Links', e);
      }
    }
    imgs.forEach(function (img) {
      var c = photoCache[img.getAttribute('data-path')];
      if (c && img.getAttribute('src') !== c.url) img.src = c.url;
    });
  }

  /* ---------- Karte ---------- */
  function initMap() {
    var el = $('map');
    if (!el) return;
    if (!window.L) {
      el.innerHTML = '<div class="empty">Die Karte konnte nicht geladen werden.<br><span class="muted">Internet prüfen und neu laden.</span></div>';
      return;
    }
    mapEl = el;
    mapFitted = false;
    map = window.L.map(el, { zoomControl: false, worldCopyJump: true }).setView([51.1, 10.4], 5);
    window.L.control.zoom({ position: 'topright' }).addTo(map);
    window.L.tileLayer(TILES, { maxZoom: 19, attribution: '&copy; OpenStreetMap-Mitwirkende' }).addTo(map);
    markerLayer = window.L.layerGroup().addTo(map);
    updateMarkers();
    setTimeout(function () { if (map) map.invalidateSize(); }, 120);
  }

  function updateMarkers() {
    if (!map || !markerLayer) return;
    markerLayer.clearLayers();
    var members = state.members.length || 1;
    var visible = state.mapDrinks.filter(function (d) {
      return d.lat != null && !Logic.isDisputed((d.drink_flags || []).length, members);
    });
    var points = [];
    Logic.clusterDrinks(visible).forEach(function (c) {
      var latest = c.drinks[0];
      var nm = latest.profiles && latest.profiles.display_name ? latest.profiles.display_name : '?';
      var html = '<div class="mk" style="--c:' + Logic.colorFor(latest.user_id) + '">' +
        '<img data-path="' + Logic.esc(latest.photo_path) + '" alt="">' +
        '<span class="mk-i">' + Logic.esc(Logic.initial(nm)) + '</span>' +
        (c.drinks.length > 1 ? '<i>' + c.drinks.length + '</i>' : '') + '</div>';
      var marker = window.L.marker([c.lat, c.lng], {
        icon: window.L.divIcon({ className: '', html: html, iconSize: [56, 56], iconAnchor: [28, 28], popupAnchor: [0, -30] })
      });
      marker.bindPopup(Views.mapPopup(c, state), { maxWidth: 300 });
      marker.on('popupopen', function (e) { hydratePhotos(e.popup.getElement()); });
      marker.addTo(markerLayer);
      points.push([c.lat, c.lng]);
    });
    if (mapEl) hydratePhotos(mapEl);
    if (!mapFitted && points.length) {
      map.fitBounds(points, { padding: [50, 50], maxZoom: 16 });
      mapFitted = true;
    }
  }

  /* ---------- Getränk loggen ---------- */
  function logCtx() {
    return {
      usage: state.today,
      limits: { points: state.group.daily_limit == null ? null : Number(state.group.daily_limit), grams: state.group.alcohol_limit_g == null ? null : Number(state.group.alcohol_limit_g) }
    };
  }

  function openLog() {
    if (!state.group) { toast('Erst eine Gruppe erstellen oder beitreten.'); return; }
    var p = Logic.presetByKey('pils');
    state.log = {
      category: 'bier', presetKey: p.key, custom: false, name: p.name, abv: p.abv, sizeMl: 500,
      blob: null, previewUrl: null, geo: { status: 'pending' }, saving: false
    };
    renderSheet();
    startGeo();
    var ls = state.log;
    loadToday().then(function () { if (state.log === ls) updateLogUI(); });
  }

  function renderSheet() {
    var s = $('sheet');
    var body = s.querySelector('.sheet-body');
    var scroll = body ? body.scrollTop : 0;
    s.innerHTML = Views.logSheetView(state.log, logCtx());
    s.hidden = false;
    document.body.style.overflow = 'hidden';
    var nb = s.querySelector('.sheet-body');
    if (nb) nb.scrollTop = scroll;
  }

  function closeSheet() {
    if (state.log && state.log.previewUrl) URL.revokeObjectURL(state.log.previewUrl);
    state.log = null;
    var s = $('sheet');
    s.hidden = true;
    s.innerHTML = '';
    document.body.style.overflow = '';
    closeCameraOverlay();
  }

  function updateLogUI() {
    if (!state.log) return;
    var pv = $('log-preview');
    if (pv) pv.innerHTML = Views.logPreview(state.log, logCtx());
    updateSaveBtn();
  }

  function updateSaveBtn() {
    var b = $('log-save');
    if (b && state.log) b.disabled = Views.logSaveDisabled(state.log);
  }

  function setGeo(ls, geo) {
    if (state.log !== ls) return;
    ls.geo = geo;
    var el = $('log-geo'); if (el) el.innerHTML = Views.geoLine(geo);
  }

  async function startGeo() {
    var ls = state.log;
    if (!navigator.geolocation) { setGeo(ls, { status: 'unavailable' }); return; }
    if (state.prefs.geo === 'off') { setGeo(ls, { status: 'off' }); return; }
    if (lastGeo && Date.now() - lastGeo.t < 120000) { setGeo(ls, { status: 'ok', lat: lastGeo.lat, lng: lastGeo.lng }); return; }
    var perm = await permState('geolocation');
    if (state.log !== ls) return;
    if (perm === 'denied') { setGeo(ls, { status: 'off' }); return; }
    navigator.geolocation.getCurrentPosition(function (pos) {
      lastGeo = { lat: pos.coords.latitude, lng: pos.coords.longitude, t: Date.now() };
      setGeo(ls, { status: 'ok', lat: lastGeo.lat, lng: lastGeo.lng });
    }, function (err) {
      logError('Standort', err);
      if (err && err.code === 1) {
        state.prefs.geo = 'off';
        savePrefs();
        setGeo(ls, { status: 'off' });
        return;
      }
      setGeo(ls, { status: 'error' });
    }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 });
  }

  function pickCategory(key) {
    var ls = state.log;
    var cat = Logic.categoryByKey(key);
    var p = Logic.presetsOf(key)[0];
    ls.custom = false;
    ls.category = key;
    ls.presetKey = p.key; ls.name = p.name; ls.abv = p.abv;
    ls.sizeMl = cat.defaultSize;
    renderSheet();
  }

  function pickPreset(key) {
    var ls = state.log;
    var p = Logic.presetByKey(key);
    if (!p) return;
    ls.custom = false;
    ls.presetKey = p.key; ls.name = p.name; ls.abv = p.abv;
    renderSheet();
  }

  /* ---------- Kamera ---------- */
  async function openCamera() {
    if (state.prefs.camera === 'system') { $('file-fallback').click(); return; }
    var perm = await permState('camera');
    if (perm === 'denied') {
      toast('Kamera im Browser gesperrt. Es wird die Systemkamera genutzt.');
      $('file-fallback').click();
      return;
    }
    var overlay = $('camera'), video = $('cam-video'), msg = $('cam-msg');
    msg.hidden = true;
    overlay.hidden = false;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      msg.textContent = 'Live-Kamera nicht verfügbar. Tippe unten links auf „Systemkamera nutzen“.';
      msg.hidden = false;
      return;
    }
    try {
      cam.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 960 } },
        audio: false
      });
      video.srcObject = cam.stream;
      video.play().catch(function (e) { logError('Video starten', e); });
    } catch (e) {
      logError('Kamera', e);
      if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) {
        state.prefs.camera = 'system';
        savePrefs();
        overlay.hidden = true;
        toast('Live-Kamera abgelehnt. Ab jetzt Systemkamera, ohne erneute Abfrage. Änderbar unter Gruppe.');
        $('file-fallback').click();
        return;
      }
      msg.textContent = 'Kamera nicht verfügbar. Tippe unten links auf „Systemkamera nutzen“.';
      msg.hidden = false;
    }
  }

  function stopCamera() {
    if (cam.stream) {
      cam.stream.getTracks().forEach(function (t) { t.stop(); });
      cam.stream = null;
    }
    var v = $('cam-video');
    if (v) v.srcObject = null;
  }

  function closeCameraOverlay() {
    stopCamera();
    $('camera').hidden = true;
  }

  function stamp(ctx, w, h) {
    var d = new Date();
    var txt = pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.' + d.getFullYear() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    var fs = Math.max(16, Math.round(h * 0.04));
    ctx.font = 'bold ' + fs + 'px sans-serif';
    ctx.textBaseline = 'bottom';
    ctx.lineWidth = Math.max(3, fs / 6);
    ctx.strokeStyle = 'rgba(0,0,0,.75)';
    ctx.fillStyle = '#ffffff';
    ctx.strokeText(txt, fs * 0.6, h - fs * 0.5);
    ctx.fillText(txt, fs * 0.6, h - fs * 0.5);
  }

  function drawToBlob(src, w, h) {
    var max = 1280;
    var scale = Math.min(1, max / Math.max(w, h));
    var cw = Math.round(w * scale), ch = Math.round(h * scale);
    var c = document.createElement('canvas');
    c.width = cw; c.height = ch;
    var ctx = c.getContext('2d');
    ctx.drawImage(src, 0, 0, cw, ch);
    stamp(ctx, cw, ch);
    return new Promise(function (resolve, reject) {
      c.toBlob(function (b) { b ? resolve(b) : reject(new Error('Foto konnte nicht erstellt werden.')); }, 'image/jpeg', 0.72);
    });
  }

  function capture() {
    var v = $('cam-video');
    if (!v.videoWidth) { toast('Kamera ist noch nicht bereit.'); return; }
    drawToBlob(v, v.videoWidth, v.videoHeight).then(setPhoto).catch(function (e) {
      logError('Foto aufnehmen', e);
      toast(humanError(e), 'bad');
    });
  }

  function loadImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve({ src: img, w: img.naturalWidth, h: img.naturalHeight }); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('Das Bild konnte nicht gelesen werden.')); };
      img.src = url;
    });
  }

  async function handleFile(file) {
    if (!file || !state.log) return;
    try {
      var src = null;
      if (window.createImageBitmap) {
        try {
          var bmp = await window.createImageBitmap(file, { imageOrientation: 'from-image' });
          src = { src: bmp, w: bmp.width, h: bmp.height };
        } catch (e) { logError('createImageBitmap', e); }
      }
      if (!src) src = await loadImage(file);
      setPhoto(await drawToBlob(src.src, src.w, src.h));
    } catch (e) {
      logError('Foto-Datei', e);
      toast(humanError(e), 'bad');
    }
  }

  function setPhoto(blob) {
    var ls = state.log;
    if (!ls) return;
    if (ls.previewUrl) URL.revokeObjectURL(ls.previewUrl);
    ls.blob = blob;
    ls.previewUrl = URL.createObjectURL(blob);
    closeCameraOverlay();
    var el = $('log-photo');
    if (el) el.innerHTML = Views.logPhoto(ls);
    updateSaveBtn();
  }

  /* ---------- Speichern ---------- */
  async function saveDrink() {
    var ls = state.log;
    if (!ls || ls.saving) return;
    var cat = Logic.categoryByKey(ls.category);
    var err = Logic.validateDrink({ name: ls.name, category: ls.category, abv: ls.abv, volumeMl: ls.sizeMl });
    if (err) { setMsg('log-msg', err); return; }
    if (!ls.blob) { setMsg('log-msg', 'Ohne Foto zählt das Getränk nicht.'); return; }
    ls.saving = true;
    var btn = $('log-save');
    btn.disabled = true;
    btn.textContent = 'Speichere…';
    setMsg('log-msg', '');
    var gid = state.group.id;
    var geo = ls.geo && ls.geo.status === 'ok' ? ls.geo : null;
    var taken = new Date();
    var item = {
      id: uuid(),
      groupId: gid,
      userId: state.uid,
      path: gid + '/' + state.uid + '/' + uuid() + '.jpg',
      drink: { name: String(ls.name).trim(), category: cat.key, abv: Number(ls.abv), volume_ml: Number(ls.sizeMl) },
      partyDay: Logic.partyDay(taken),
      takenAt: taken.toISOString(),
      lat: geo ? geo.lat : null,
      lng: geo ? geo.lng : null,
      blob: ls.blob
    };
    try {
      if (navigator.onLine === false || state.offline) throw new Error('offline');
      var res = await sendDrink(item);
      closeSheet();
      if (res.capped && Number(res.points) <= 0) {
        toast((res.reason === 'alkohol' ? 'Alkohol-Obergrenze erreicht' : 'Punkte-Limit erreicht') + ': keine Punkte mehr heute. Wasser, Essen, Pause.', 'bad', 5200);
      } else if (res.capped) {
        toast('+' + Logic.fmt(res.points) + ' Punkte gezählt (' + (res.reason === 'alkohol' ? 'Alkohol-Obergrenze' : 'Punkte-Limit') + ' erreicht).', 'good', 4600);
      } else {
        toast('+' + Logic.fmt(res.points) + ' Punkte', 'good');
      }
      await refreshGroupData(false);
      maybeHeimweg();
    } catch (e) {
      if (Logic.isNetworkError(e)) {
        try {
          await window.RundeQueue.add(item);
          closeSheet();
          await refreshPending();
          render(false);
          toast('Kein Netz. Das Getränk ist auf deinem Gerät gespeichert und wird gesendet, sobald du online bist.', 'good', 6000);
          maybeHeimweg();
          return;
        } catch (qe) {
          logError('Offline speichern', qe);
          e = new Error('Offline-Speicher fehlgeschlagen: ' + (qe && qe.name ? qe.name + ' ' : '') + (qe && qe.message ? qe.message : 'unbekannt'));
        }
      } else if (e && e.code) {
        sb.storage.from(BUCKET).remove([item.path]).then(function (x) { if (x.error) logError('Foto aufräumen', x.error); });
      }
      logError('Getränk speichern', e);
      if (state.log === ls) {
        ls.saving = false;
        var b2 = $('log-save');
        if (b2) { b2.textContent = 'Speichern'; updateSaveBtn(); }
        setMsg('log-msg', humanError(e));
      } else {
        toast(humanError(e), 'bad');
      }
    }
  }

  /* ---------- Aktionen ---------- */
  async function rpcAndRefresh(name, args, okMsg) {
    var r = await sb.rpc(name, args);
    if (r.error) { logError(name, r.error); toast(humanError(r.error), 'bad'); return null; }
    if (okMsg) toast(okMsg);
    await refreshGroupData(false);
    return r;
  }

  async function removePhotos(gid, uid) {
    var paths = [];
    for (var from = 0; ; from += 1000) {
      var q = sb.from('drinks').select('photo_path').eq('group_id', gid);
      if (uid) q = q.eq('user_id', uid);
      var r = await q.range(from, from + 999);
      if (r.error) { logError('Fotos suchen', r.error); toast(humanError(r.error), 'bad'); return false; }
      (r.data || []).forEach(function (d) { if (d.photo_path) paths.push(d.photo_path); });
      if ((r.data || []).length < 1000) break;
    }
    for (var i = 0; i < paths.length; i += 100) {
      var x = await sb.storage.from(BUCKET).remove(paths.slice(i, i + 100));
      if (x.error) { logError('Fotos löschen', x.error); toast('Fotos konnten nicht gelöscht werden. Nichts geändert.', 'bad'); return false; }
    }
    return true;
  }

  async function afterGroupGone(msg) {
    try { localStorage.removeItem('runde_group'); } catch (e) { logError('localStorage entfernen', e); }
    state.members = []; state.drinks = []; state.board = []; state.mapDrinks = [];
    state.today = { points: 0, grams: 0, count: 0 };
    state.group = null;
    await loadGroups();
    state.group = state.groups[0] || null;
    state.tab = state.group ? 'rank' : 'group';
    renderGroupSelect();
    render(false);
    await refreshGroupData(false);
    toast(msg, 'good');
  }

  function copyText(text, okMsg) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast(okMsg); }, function (e) {
        logError('Kopieren', e);
        toast('Kopieren nicht möglich. Code: ' + text);
      });
    } else {
      toast('Code: ' + text, null, 6000);
    }
  }

  var actions = {
    'auth-mode': function (t) { state.authMode = t.getAttribute('data-mode'); showAuth(); },
    'refresh': function () { toast('Aktualisiere…', null, 900); refreshGroupData(false); },
    'rankmode': function (t) {
      state.rankMode = t.getAttribute('data-mode') === 'stats' ? 'stats' : 'board';
      render(false);
      if (state.rankMode === 'stats') loadStats();
    },
    'reload-stats': function () { state.statsError = null; state.statsDrinks = null; render(true); loadStats(); },
    'flush-queue': function () { flushQueue(true); },
    'open-heimweg': function () { openHeimweg(); },
    'open-install': async function () {
      if (deferredInstall) {
        var ev = deferredInstall;
        deferredInstall = null;
        try {
          ev.prompt();
          var choice = await ev.userChoice;
          if (choice && choice.outcome === 'accepted') dismissInstall();
        } catch (e) { logError('Installieren', e); toast('Installieren hat nicht geklappt.', 'bad'); }
        closeSheet();
        render(true);
        return;
      }
      state.log = null;
      var s = $('sheet');
      s.innerHTML = Views.installSheet(state.installMode);
      s.hidden = false;
      document.body.style.overflow = 'hidden';
    },
    'dismiss-install': function () { dismissInstall(); render(true); },
    'retry-pending': async function (t) {
      var id = t.getAttribute('data-id');
      try {
        var all = await window.RundeQueue.all();
        var it = all.filter(function (x) { return x.id === id; })[0];
        if (it) { delete it.failed; await window.RundeQueue.update(it); }
      } catch (e) { logError('Erneut senden', e); toast('Konnte nicht erneut gesendet werden.', 'bad'); return; }
      await refreshPending();
      await flushQueue(true);
    },
    'discard-pending': async function (t) {
      if (!window.confirm('Dieses Getränk samt Foto verwerfen? Es zählt dann nicht.')) return;
      try { await window.RundeQueue.remove(t.getAttribute('data-id')); }
      catch (e) { logError('Verwerfen', e); toast('Konnte nicht verworfen werden.', 'bad'); return; }
      await refreshPending();
      render(true);
    },
    'period': function (t) { state.period = t.getAttribute('data-period'); loadBoard(); },
    'map-period': function (t) { state.mapPeriod = t.getAttribute('data-period'); loadMapData(); },
    'open-log': openLog,
    'close-sheet': closeSheet,
    'log-category': function (t) { pickCategory(t.getAttribute('data-key')); },
    'log-preset': function (t) { pickPreset(t.getAttribute('data-key')); },
    'log-size': function (t) { state.log.sizeMl = parseInt(t.getAttribute('data-ml'), 10); renderSheet(); },
    'log-custom': function () { state.log.custom = true; state.log.presetKey = null; state.log.name = ''; renderSheet(); },
    'open-camera': openCamera,
    'cam-capture': capture,
    'cam-close': closeCameraOverlay,
    'cam-file': function () { $('file-fallback').click(); },
    'save-drink': saveDrink,
    'zoom': function (t) {
      var c = photoCache[t.getAttribute('data-path')];
      if (!c) return;
      $('lightbox').querySelector('img').src = c.url;
      $('lightbox').hidden = false;
    },
    'zoom-close': function () { $('lightbox').hidden = true; },
    'flag': function (t) {
      if (!window.confirm('Dieses Getränk anzweifeln? Mit genug Meldungen zählt es nicht mehr.')) return;
      rpcAndRefresh('flag_drink', { p_id: t.getAttribute('data-id') }, 'Gemeldet.');
    },
    'unflag': function (t) {
      rpcAndRefresh('unflag_drink', { p_id: t.getAttribute('data-id') }, 'Meldung zurückgenommen.');
    },
    'delete': async function (t) {
      if (!window.confirm('Dieses Getränk löschen?')) return;
      var path = t.getAttribute('data-path');
      var r = await rpcAndRefresh('delete_drink', { p_id: t.getAttribute('data-id') }, 'Gelöscht.');
      if (r && path) {
        sb.storage.from(BUCKET).remove([path]).then(function (x) { if (x.error) logError('Foto löschen', x.error); });
      }
    },
    'kick': async function (t) {
      var uid = t.getAttribute('data-user'), nm = t.getAttribute('data-name');
      if (!window.confirm(nm + ' aus der Gruppe entfernen? Alle Getränke und Fotos von ' + nm + ' in dieser Gruppe werden gelöscht.')) return;
      var gid = state.group.id;
      if (!(await removePhotos(gid, uid))) return;
      var r = await sb.rpc('kick_member', { p_group: gid, p_user: uid });
      if (r.error) { logError('kick_member', r.error); toast(humanError(r.error), 'bad'); return; }
      toast(nm + ' wurde entfernt.', 'good');
      await refreshGroupData(false);
    },
    'reset-code': async function () {
      if (!window.confirm('Neuen Code erzeugen? Der alte Code funktioniert danach nicht mehr.')) return;
      var r = await sb.rpc('reset_invite_code', { p_group: state.group.id });
      if (r.error) { logError('reset_invite_code', r.error); toast(humanError(r.error), 'bad'); return; }
      await loadGroups();
      toast('Neuer Code: ' + r.data, 'good');
      render(false);
    },
    'leave-group': async function () {
      if (!window.confirm('Gruppe "' + state.group.name + '" verlassen? Deine Getränke und Fotos dort werden gelöscht.')) return;
      var gid = state.group.id;
      if (!(await removePhotos(gid, state.uid))) return;
      var r = await sb.rpc('leave_group', { p_group: gid });
      if (r.error) { logError('leave_group', r.error); toast(humanError(r.error), 'bad'); return; }
      await afterGroupGone('Du hast die Gruppe verlassen.');
    },
    'delete-group': async function () {
      var name = state.group.name;
      var typed = window.prompt('Gruppe "' + name + '" und ALLE Getränke und Fotos darin endgültig löschen?\nZur Bestätigung den Gruppennamen eintippen:');
      if (typed === null) return;
      if (typed.trim() !== name) { toast('Name stimmt nicht. Nichts gelöscht.', 'bad'); return; }
      var gid = state.group.id;
      if (!(await removePhotos(gid, null))) return;
      var r = await sb.rpc('delete_group', { p_group: gid });
      if (r.error) { logError('delete_group', r.error); toast(humanError(r.error), 'bad'); return; }
      await afterGroupGone('Gruppe gelöscht.');
    },
    'copy-code': function () { copyText(state.group.invite_code, 'Code kopiert.'); },
    'share-code': function () {
      var url = location.origin + location.pathname.replace(/index\.html$/, '');
      var text = 'Tritt meiner Runde bei. Code: ' + state.group.invite_code + ' – ' + url;
      if (navigator.share) {
        navigator.share({ title: 'Runde', text: text }).catch(function (e) { if (e && e.name !== 'AbortError') logError('Teilen', e); });
      } else {
        copyText(text, 'Einladung kopiert.');
      }
    },
    'logout': async function () {
      var r = await sb.auth.signOut();
      if (r.error) logError('Abmelden', r.error);
      state.session = null; state.uid = null; state.group = null; state.groups = []; state.pending = []; state.statsDrinks = null;
      clearCache();
      showAuth();
    }
  };

  async function onGroupForm(form, rpcName, argName, errId) {
    var fd = new FormData(form);
    var val = String(fd.get(argName === 'p_code' ? 'code' : 'name') || '').trim();
    if (!val) { setMsg(errId, argName === 'p_code' ? 'Bitte Code eingeben.' : 'Bitte Namen eingeben.'); return; }
    if (argName === 'p_code') val = Logic.normalizeInviteCode(val);
    var args = {}; args[argName] = val;
    setMsg(errId, '');
    var r = await sb.rpc(rpcName, args);
    if (r.error) { logError(rpcName, r.error); setMsg(errId, humanError(r.error)); return; }
    var id = r.data;
    try {
      await loadGroups();
      state.tab = rpcName === 'create_group' ? 'group' : 'rank';
      try { localStorage.setItem('runde_group', id); } catch (e) { logError('localStorage schreiben', e); }
      state.group = state.groups.filter(function (g) { return g.id === id; })[0] || state.groups[0] || null;
      renderGroupSelect();
      render(false);
      await refreshGroupData(false);
      toast(rpcName === 'create_group' ? 'Gruppe erstellt. Schick deinen Freunden den Code.' : 'Du bist dabei.', 'good');
    } catch (e) {
      logError('Gruppen laden', e);
      setMsg(errId, humanError(e));
    }
  }

  function parseLimit(raw) {
    var t = String(raw == null ? '' : raw).trim().replace(',', '.');
    if (t === '') return null;
    var n = Number(t);
    if (!isFinite(n) || n <= 0) return NaN;
    return n;
  }

  async function onSubmit(form) {
    switch (form.id) {
      case 'auth-form': return onAuthSubmit(form);
      case 'join-form': return onGroupForm(form, 'join_group', 'p_code', 'group-msg');
      case 'create-form': return onGroupForm(form, 'create_group', 'p_name', 'group-msg');
      case 'limits-form': {
        var fd = new FormData(form);
        var pts = parseLimit(fd.get('points'));
        var gr = parseLimit(fd.get('grams'));
        if (Number.isNaN(pts) || Number.isNaN(gr)) { setMsg('group-msg', 'Bitte eine Zahl größer 0 eintragen oder das Feld leer lassen.'); return; }
        var r = await sb.rpc('set_limits', { p_group: state.group.id, p_points: pts, p_grams: gr });
        if (r.error) { logError('Limits', r.error); setMsg('group-msg', humanError(r.error)); return; }
        await loadGroups();
        renderGroupSelect();
        render(false);
        toast('Limits gespeichert.', 'good');
        return;
      }
      case 'rename-form': {
        var name = String(new FormData(form).get('name') || '').trim();
        if (name.length < 2 || name.length > 24) { setMsg('group-msg', 'Name: 2 bis 24 Zeichen.'); return; }
        var u = await sb.from('profiles').update({ display_name: name }).eq('id', state.uid);
        if (u.error) { logError('Name ändern', u.error); setMsg('group-msg', humanError(u.error)); return; }
        state.profile.display_name = name;
        toast('Name geändert.', 'good');
        await refreshGroupData(false);
        return;
      }
    }
  }

  /* ---------- Ereignisse ---------- */
  function bindEvents() {
    document.addEventListener('toggle', function (e) {
      if (e.target && e.target.id === 'admin-fold') state.adminOpen = e.target.open;
      if (e.target && e.target.id === 'manage-fold') state.manageOpen = e.target.open;
    }, true);
    document.addEventListener('click', function (e) {
      var t = e.target.closest ? e.target.closest('[data-action],[data-tab]') : null;
      if (!t) return;
      if (t.hasAttribute('data-tab')) { switchTab(t.getAttribute('data-tab')); return; }
      var fn = actions[t.getAttribute('data-action')];
      if (fn) {
        Promise.resolve(fn(t, e)).catch(function (err) {
          logError('Aktion ' + t.getAttribute('data-action'), err);
          toast(humanError(err), 'bad');
        });
      }
    });

    document.addEventListener('submit', function (e) {
      e.preventDefault();
      onSubmit(e.target).catch(function (err) {
        logError('Formular ' + e.target.id, err);
        toast(humanError(err), 'bad');
      });
    });

    function onLogField(e) {
      var ls = state.log;
      if (!ls || !ls.custom) return;
      var id = e.target.id;
      if (id === 'log-name') ls.name = e.target.value;
      else if (id === 'log-abv') ls.abv = parseFloat(String(e.target.value).replace(',', '.'));
      else if (id === 'log-ml') ls.sizeMl = parseInt(e.target.value, 10);
      else if (id === 'log-cat') ls.category = e.target.value;
      else return;
      updateLogUI();
    }
    document.addEventListener('input', onLogField);
    document.addEventListener('change', function (e) {
      if (e.target.id === 'group-select') { setGroup(e.target.value); return; }
      if (e.target.getAttribute && e.target.getAttribute('data-pref')) {
        var k = e.target.getAttribute('data-pref');
        state.prefs[k] = e.target.value;
        savePrefs();
        toast('Gespeichert.', 'good');
        return;
      }
      if (e.target.id === 'file-fallback') {
        var f = e.target.files && e.target.files[0];
        e.target.value = '';
        handleFile(f);
        return;
      }
      onLogField(e);
    });

    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && state.session && state.group && !state.log) refreshGroupData(true);
    });

    window.addEventListener('unhandledrejection', function (e) {
      logError('Unbehandelter Fehler', e.reason);
    });
  }

  init().catch(function (e) {
    logError('Start', e);
    bootMessage('Start fehlgeschlagen: ' + humanError(e));
  });
})();
