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
    now: new Date(), authMode: 'login', log: null, loadToken: 0
  };
  var photoCache = {};
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
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
      navigator.serviceWorker.register('sw.js').catch(function (e) { logError('Service Worker', e); });
    }
    if (!configured()) {
      bootMessage('Einrichtung fehlt: Trage in config.js deine Supabase-URL und den Key ein (siehe SETUP.md).');
      return;
    }
    if (!window.supabase || !window.supabase.createClient) {
      bootMessage('Eine Bibliothek konnte nicht geladen werden. Bitte Internet prüfen und neu laden.');
      return;
    }
    sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
    });
    bindEvents();
    try {
      var res = await sb.auth.getSession();
      state.session = res.data && res.data.session;
      sb.auth.onAuthStateChange(function (event, session) {
        state.session = session;
        if (event === 'SIGNED_OUT') { setTimeout(showAuth, 0); }
      });
      if (state.session) { await enterApp(); } else { showAuth(); }
    } catch (e) {
      logError('init', e);
      showAuth();
      setMsg('auth-msg', humanError(e));
    }
    $('boot').hidden = true;
    setInterval(function () {
      if (document.hidden || !state.session || !state.group || state.log || !$('camera').hidden) return;
      refreshGroupData(true);
    }, REFRESH_MS);
  }

  /* ---------- Anmeldung ---------- */
  function showAuth() {
    $('screen-app').hidden = true;
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
    render(false);
    await refreshGroupData(false);
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
    state.today = { points: 0, grams: 0, count: 0 };
    renderGroupSelect();
    render(false);
    await refreshGroupData(false);
  }

  /* ---------- Daten laden ---------- */
  async function refreshGroupData(soft) {
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
        sb.from('drinks').select(DRINK_COLS).eq('group_id', gid).order('created_at', { ascending: false }).limit(150),
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
    Array.prototype.forEach.call(document.querySelectorAll('.tabs [data-tab]'), function (b) {
      b.classList.toggle('on', b.getAttribute('data-tab') === state.tab);
    });
  }

  function render(soft) {
    var view = $('view');
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
      var html = '<div class="mk" style="--c:' + Logic.colorFor(latest.user_id) + '">' + Logic.esc(Logic.initial(nm)) +
        (c.drinks.length > 1 ? '<i>' + c.drinks.length + '</i>' : '') + '</div>';
      var marker = window.L.marker([c.lat, c.lng], {
        icon: window.L.divIcon({ className: '', html: html, iconSize: [34, 34], iconAnchor: [17, 17], popupAnchor: [0, -18] })
      });
      marker.bindPopup(Views.mapPopup(c, state), { maxWidth: 280 });
      marker.on('popupopen', function (e) { hydratePhotos(e.popup.getElement()); });
      marker.addTo(markerLayer);
      points.push([c.lat, c.lng]);
    });
    if (!mapFitted && points.length) {
      map.fitBounds(points, { padding: [50, 50], maxZoom: 16 });
      mapFitted = true;
    }
  }

  /* ---------- Getränk loggen ---------- */
  function logCtx() {
    return {
      usage: state.today,
      limits: { points: Number(state.group.daily_limit), grams: Number(state.group.alcohol_limit_g) }
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

  function startGeo() {
    var ls = state.log;
    if (!navigator.geolocation) { ls.geo = { status: 'unavailable' }; return; }
    navigator.geolocation.getCurrentPosition(function (pos) {
      if (state.log !== ls) return;
      ls.geo = { status: 'ok', lat: pos.coords.latitude, lng: pos.coords.longitude };
      var el = $('log-geo'); if (el) el.innerHTML = Views.geoLine(ls.geo);
    }, function (err) {
      if (state.log !== ls) return;
      logError('Standort', err);
      ls.geo = { status: err && err.code === 1 ? 'denied' : 'error' };
      var el = $('log-geo'); if (el) el.innerHTML = Views.geoLine(ls.geo);
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
      msg.textContent = 'Kamera nicht erlaubt oder nicht verfügbar. Tippe unten links auf „Systemkamera nutzen“.';
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
    var path = gid + '/' + state.uid + '/' + uuid() + '.jpg';
    var geo = ls.geo && ls.geo.status === 'ok' ? ls.geo : null;
    try {
      var up = await sb.storage.from(BUCKET).upload(path, ls.blob, { contentType: 'image/jpeg', upsert: false, cacheControl: '3600' });
      if (up.error) throw up.error;
      var r = await sb.rpc('log_drink', {
        p_group: gid,
        p_category: cat.key,
        p_name: String(ls.name).trim(),
        p_abv: Number(ls.abv),
        p_volume_ml: Number(ls.sizeMl),
        p_party_day: Logic.partyDay(new Date()),
        p_photo_path: path,
        p_lat: geo ? geo.lat : null,
        p_lng: geo ? geo.lng : null
      });
      if (r.error) {
        sb.storage.from(BUCKET).remove([path]).then(function (x) { if (x.error) logError('Foto aufräumen', x.error); });
        throw r.error;
      }
      var res = r.data || {};
      closeSheet();
      if (res.capped && Number(res.points) <= 0) {
        toast((res.reason === 'alkohol' ? 'Alkohol-Obergrenze erreicht' : 'Punkte-Limit erreicht') + ': keine Punkte mehr heute. Wasser, Essen, Pause.', 'bad', 5200);
      } else if (res.capped) {
        toast('+' + Logic.fmt(res.points) + ' Punkte gezählt (' + (res.reason === 'alkohol' ? 'Alkohol-Obergrenze' : 'Punkte-Limit') + ' erreicht).', 'good', 4600);
      } else {
        toast('+' + Logic.fmt(res.points) + ' Punkte', 'good');
      }
      await refreshGroupData(false);
    } catch (e) {
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
      state.session = null; state.uid = null; state.group = null; state.groups = [];
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

  async function onSubmit(form) {
    switch (form.id) {
      case 'auth-form': return onAuthSubmit(form);
      case 'join-form': return onGroupForm(form, 'join_group', 'p_code', 'group-msg');
      case 'create-form': return onGroupForm(form, 'create_group', 'p_name', 'group-msg');
      case 'limits-form': {
        var fd = new FormData(form);
        var pts = Number(String(fd.get('points')).replace(',', '.'));
        var gr = Number(String(fd.get('grams')).replace(',', '.'));
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
