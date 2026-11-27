'use strict';
const test = require('node:test');
const assert = require('node:assert');
const Logic = require('../logic.js');
const Views = require('../views.js');

const members = [
  { user_id: 'u1', role: 'admin', profiles: { display_name: 'Max' } },
  { user_id: 'u2', role: 'member', profiles: { display_name: 'Lena' } }
];
function group(role, name) {
  return { id: 'g1', name: name || 'Malle 2027', invite_code: 'K7X2QP', daily_limit: 15, alcohol_limit_g: 100, role: role };
}
function gstate(role, name) {
  return { group: group(role, name), members: members, uid: 'u1', prefs: { camera: 'auto', geo: 'auto' }, profile: { display_name: 'Max' }, installMode: 'none' };
}
function drink(id, day, uid) {
  return { id: id, user_id: uid || 'u2', category: 'bier', name: 'Pils', abv: 4.9, volume_ml: 500, alcohol_g: 19.3, points: 1, points_raw: 1,
    party_day: day, photo_path: 'g1/u2/' + id + '.jpg', lat: 51, lng: 7, created_at: '2026-11-27T10:00:00Z', profiles: { display_name: 'Lena' }, drink_flags: [] };
}

test('dayLabel: Heute, Gestern, sonst Wochentag mit Datum', () => {
  assert.strictEqual(Logic.dayLabel('2026-11-27', '2026-11-27'), 'Heute');
  assert.strictEqual(Logic.dayLabel('2026-11-26', '2026-11-27'), 'Gestern');
  assert.strictEqual(Logic.dayLabel('2026-11-22', '2026-11-27'), 'Sonntag, 22.11.');
  assert.strictEqual(Logic.dayLabel('2026-03-01', '2026-11-27'), 'Sonntag, 01.03.');
});

test('validGroupName: 2 bis 40 Zeichen, getrimmt', () => {
  assert.strictEqual(Logic.validGroupName('  Malle 2028  '), 'Malle 2028');
  assert.strictEqual(Logic.validGroupName('a'), null);
  assert.strictEqual(Logic.validGroupName('   '), null);
  assert.strictEqual(Logic.validGroupName(null), null);
  assert.strictEqual(Logic.validGroupName('x'.repeat(40)).length, 40);
  assert.strictEqual(Logic.validGroupName('x'.repeat(41)), null);
});

test('myRank: findet den eigenen Platz, null wenn nicht in der Liste', () => {
  const rows = Logic.rankRows([
    { user_id: 'u1', display_name: 'Max', points: 3, drinks: 3 },
    { user_id: 'u2', display_name: 'Lena', points: 5, drinks: 2 }
  ]);
  assert.deepStrictEqual(Logic.myRank(rows, 'u1'), { rank: 2, total: 2, points: 3 });
  assert.strictEqual(Logic.myRank(rows, 'u9'), null);
  assert.strictEqual(Logic.myRank(undefined, 'u1'), null);
});

test('Gruppen-Seite: Admin sieht das Umbenennen-Formular, Mitglied nicht', () => {
  const admin = Views.groupView(gstate('admin'));
  assert.ok(admin.indexOf('id="groupname-form"') !== -1);
  assert.ok(admin.indexOf('id="rename-msg"') !== -1);
  assert.ok(admin.indexOf('du bist Admin') !== -1);
  const member = Views.groupView(gstate('member'));
  assert.strictEqual(member.indexOf('groupname-form'), -1);
  assert.strictEqual(member.indexOf('du bist Admin'), -1);
  assert.ok(member.indexOf('Malle 2027') !== -1);
});

test('Gruppen-Seite: Gruppenname wird maskiert', () => {
  const html = Views.groupView(gstate('admin', '<script>alert(1)</script>'));
  assert.strictEqual(html.indexOf('<script>alert'), -1);
  assert.ok(html.indexOf('&lt;script&gt;') !== -1);
});

test('Gruppen-Seite: bestehende Bereiche bleiben', () => {
  const html = Views.groupView(gstate('admin'));
  ['id="limits-form"', 'id="rename-form"', 'data-action="copy-code"', 'data-action="reset-code"', 'data-action="delete-group"', 'data-action="logout"', 'id="join-form"']
    .forEach(s => assert.ok(html.indexOf(s) !== -1, s));
  const m = Views.groupView(gstate('member'));
  assert.ok(m.indexOf('data-action="leave-group"') !== -1);
});

test('Verlauf: Tageskopf nur beim Tageswechsel, Aktionen bleiben', () => {
  const state = { uid: 'u1', members: members, now: new Date('2026-11-27T12:00:00Z'), group: group('admin'),
    drinks: [drink('a', '2026-11-27'), drink('b', '2026-11-27'), drink('c', '2026-11-26'), drink('d', '2026-11-22', 'u1')], pending: [] };
  const html = Views.feedView(state);
  assert.strictEqual((html.match(/class="dh"/g) || []).length, 3);
  assert.ok(html.indexOf('<span>Heute</span>') !== -1 && html.indexOf('<span>Gestern</span>') !== -1);
  assert.ok(html.indexOf('data-action="flag"') !== -1);
  assert.ok(html.indexOf('data-action="zoom"') !== -1);
  assert.ok(html.indexOf('class="shot-by"') !== -1);
  assert.ok(html.indexOf('Pils 0,5 l') !== -1);
});

test('Verlauf: leer bleibt leer, Namen maskiert', () => {
  assert.ok(Views.feedView({ uid: 'u1', members: members, drinks: [], pending: [], group: group('admin') }).indexOf('Noch keine Getränke') !== -1);
  const evil = drink('e', '2026-11-27'); evil.profiles = { display_name: '<b onmouseover=x>' };
  const html = Views.feedView({ uid: 'u1', members: members, now: new Date('2026-11-27T12:00:00Z'), drinks: [evil], pending: [], group: group('admin') });
  assert.strictEqual(html.indexOf('<b onmouseover'), -1);
});

test('Rangliste: Krone nur bei Platz 1, Platzzeile nur mit Punkten', () => {
  const board = [
    { user_id: 'u1', display_name: 'Max', points: 4, drinks: 4 },
    { user_id: 'u2', display_name: 'Lena', points: 6, drinks: 3 },
    { user_id: 'u3', display_name: 'Tom', points: 2, drinks: 2 },
    { user_id: 'u4', display_name: 'Eva', points: 1, drinks: 1 }
  ];
  const html = Views.rankView({ uid: 'u1', board: board, period: 'heute', group: group('admin'), today: { points: 4, grams: 70, count: 4 }, members: members });
  assert.strictEqual((html.match(/class="pod-crown"/g) || []).length, 1);
  assert.ok(html.indexOf('Du bist auf Platz <b>2</b> von 4') !== -1);
  const none = Views.rankView({ uid: 'u1', board: board.map(r => Object.assign({}, r, { points: 0, drinks: 0 })), period: 'heute', group: group('admin'), today: { points: 0, grams: 0, count: 0 }, members: members });
  assert.strictEqual(none.indexOf('rankline'), -1);
  assert.strictEqual(none.indexOf('pod-crown'), -1);
});

test('Anmeldung: Orbit-Logo, Formular und Umschalter vorhanden', () => {
  const login = Views.authView('login');
  ['lg-orbit', 'lg-dot', 'id="auth-form"', 'name="keep"', 'data-action="auth-mode"', 'Rangliste', 'Fotobeweis'].forEach(s => assert.ok(login.indexOf(s) !== -1, s));
  assert.strictEqual(login.indexOf('name="adult"'), -1);
  assert.ok(Views.authView('signup').indexOf('name="adult"') !== -1);
});

test('Log-Fenster und Karte: Markup unverändert nutzbar', () => {
  const ls = { category: 'bier', presetKey: 'pils', custom: false, name: 'Pils', abv: 4.9, sizeMl: 500, blob: null, previewUrl: null, geo: { status: 'pending' }, saving: false };
  const sheet = Views.logSheetView(ls, { recent: [], usage: { points: 0, grams: 0, count: 0 }, limits: { points: 15, grams: 100 } });
  assert.ok(sheet.indexOf('Vorschau') !== -1 && sheet.indexOf('id="log-save"') !== -1 && sheet.indexOf('Foto vom Getränk aufnehmen') !== -1);
  const map = Views.mapView({ mapDrinks: [drink('a', '2026-11-27')], mapPeriod: 'woche' });
  assert.ok(map.indexOf('id="map"') !== -1 && map.indexOf('maptools') !== -1 && map.indexOf('maphint') !== -1);
});
