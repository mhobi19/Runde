'use strict';
const test = require('node:test');
const assert = require('node:assert');
const Logic = require('../logic.js');
const Views = require('../views.js');

const pils = { name: 'Pils', category: 'bier', abv: 4.9, volume_ml: 500 };
const vodka = { name: 'Vodka', category: 'spirituose', abv: 40, volume_ml: 40 };

function ls(extra) {
  return Object.assign({ category: 'bier', presetKey: 'pils', custom: false, name: 'Pils', abv: 4.9, sizeMl: 500, blob: null, previewUrl: null, geo: { status: 'pending' }, saving: false }, extra || {});
}
function ctx(recent) {
  return { recent: recent, usage: { points: 0, grams: 0, count: 0 }, limits: { points: 15, grams: 100 } };
}

test('rememberDrink: neueste zuerst, ohne Doppelte', () => {
  let l = Logic.rememberDrink([], pils);
  l = Logic.rememberDrink(l, vodka);
  l = Logic.rememberDrink(l, pils);
  assert.deepStrictEqual(l.map(d => d.name), ['Pils', 'Vodka']);
});

test('rememberDrink: gleiche Art, anderer Prozentwert oder andere Menge sind verschieden', () => {
  let l = Logic.rememberDrink([], pils);
  l = Logic.rememberDrink(l, Object.assign({}, pils, { volume_ml: 330 }));
  l = Logic.rememberDrink(l, Object.assign({}, pils, { abv: 5.0 }));
  assert.strictEqual(l.length, 3);
});

test('rememberDrink: höchstens 8 Einträge, ändert die alte Liste nicht', () => {
  let l = [];
  for (let i = 0; i < 12; i++) l = Logic.rememberDrink(l, { name: 'Drink' + i, category: 'cocktail', abv: 8, volume_ml: 300 });
  assert.strictEqual(l.length, 8);
  assert.strictEqual(l[0].name, 'Drink11');
  const old = [pils];
  Logic.rememberDrink(old, vodka);
  assert.strictEqual(old.length, 1);
});

test('sanitizeRecent: wirft kaputte und manipulierte Einträge raus', () => {
  const bad = [null, 5, {}, { name: '', category: 'bier', abv: 5, volume_ml: 500 },
    { name: 'X', category: 'gibtsnicht', abv: 5, volume_ml: 500 },
    { name: 'X', category: 'bier', abv: 500, volume_ml: 500 },
    { name: 'X', category: 'bier', abv: 5, volume_ml: 99999 }, pils];
  const out = Logic.sanitizeRecent(bad);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].name, 'Pils');
  assert.deepStrictEqual(Logic.sanitizeRecent('kein array'), []);
  assert.deepStrictEqual(Logic.sanitizeRecent(null), []);
});

test('logFromRecent: Voreinstellung mit Standardgröße bleibt Standard', () => {
  const f = Logic.logFromRecent(pils);
  assert.strictEqual(f.custom, false);
  assert.strictEqual(f.presetKey, 'pils');
  assert.strictEqual(f.sizeMl, 500);
  const v = Logic.logFromRecent(vodka);
  assert.strictEqual(v.custom, false);
  assert.strictEqual(v.presetKey, 'vodka');
});

test('logFromRecent: eigene Getränke und krumme Mengen landen in "Eigenes"', () => {
  const own = Logic.logFromRecent({ name: 'Hausmarke', category: 'bier', abv: 5.2, volume_ml: 500 });
  assert.strictEqual(own.custom, true);
  assert.strictEqual(own.presetKey, null);
  assert.strictEqual(own.name, 'Hausmarke');
  assert.strictEqual(own.abv, 5.2);
  const odd = Logic.logFromRecent({ name: 'Pils', category: 'bier', abv: 4.9, volume_ml: 450 });
  assert.strictEqual(odd.custom, true);
  assert.strictEqual(odd.sizeMl, 450);
  assert.strictEqual(Logic.logFromRecent({ name: 'X', category: 'nix', abv: 5, volume_ml: 100 }), null);
  assert.strictEqual(Logic.logFromRecent(undefined), null);
});

test('logFromRecent: Ergebnis rechnet dieselben Punkte wie vorher', () => {
  const f = Logic.logFromRecent(pils);
  const cat = Logic.categoryByKey(f.category);
  assert.strictEqual(Logic.pointsRaw(f.abv, f.sizeMl, cat.refMl), 1);
  const v = Logic.logFromRecent(vodka);
  assert.strictEqual(Logic.pointsRaw(v.abv, v.sizeMl, Logic.categoryByKey(v.category).refMl), 8);
});

test('Ansicht: Zuletzt-Chips erscheinen mit Index, höchstens 4', () => {
  const list = [];
  for (let i = 0; i < 6; i++) list.push({ name: 'Drink' + i, category: 'cocktail', abv: 8, volume_ml: 300 });
  const html = Views.logSheetView(ls(), ctx(list));
  assert.ok(html.indexOf('Zuletzt getrunken') !== -1);
  assert.strictEqual((html.match(/data-action="log-recent"/g) || []).length, 4);
  assert.ok(html.indexOf('data-i="3"') !== -1 && html.indexOf('data-i="4"') === -1);
});

test('Ansicht: ohne Verlauf keine Zuletzt-Zeile, Fenster funktioniert wie vorher', () => {
  const html = Views.logSheetView(ls(), ctx([]));
  assert.strictEqual(html.indexOf('Zuletzt getrunken'), -1);
  assert.ok(html.indexOf('data-action="log-category"') !== -1);
  assert.ok(html.indexOf('data-action="save-drink"') !== -1);
  const noCtxRecent = Views.logSheetView(ls(), { usage: { points: 0, grams: 0, count: 0 }, limits: { points: null, grams: null } });
  assert.strictEqual(noCtxRecent.indexOf('Zuletzt getrunken'), -1);
});

test('Ansicht: Namen werden maskiert (keine Skript-Einschleusung)', () => {
  const evil = [{ name: '<img src=x onerror=alert(1)>', category: 'bier', abv: 5, volume_ml: 500 }];
  const html = Views.logSheetView(ls(), ctx(evil));
  assert.strictEqual(html.indexOf('<img src=x'), -1);
  assert.ok(html.indexOf('&lt;img') !== -1);
});

test('Ansicht: Speichern bleibt ohne Foto gesperrt, auch nach Vorauswahl', () => {
  const f = Logic.logFromRecent(vodka);
  const state = ls({ category: f.category, custom: f.custom, presetKey: f.presetKey, name: f.name, abv: f.abv, sizeMl: f.sizeMl });
  assert.strictEqual(Views.logSaveDisabled(state), true);
  state.blob = {};
  assert.strictEqual(Views.logSaveDisabled(state), false);
});

test('Sambuca: Voreinstellung bei Spirituose, 38 %, 4 cl = 7,6 Punkte', () => {
  const p = Logic.presetByKey('sambuca');
  assert.strictEqual(p.name, 'Sambuca');
  assert.strictEqual(p.category, 'spirituose');
  assert.ok(Logic.presetsOf('spirituose').some(x => x.key === 'sambuca'));
  assert.strictEqual(Logic.pointsRaw(p.abv, 40, 40), 7.6);
  assert.ok(Views.logSheetView(ls({ category: 'spirituose', presetKey: 'vodka', name: 'Vodka', abv: 40, sizeMl: 40 }), ctx([])).indexOf('Sambuca') !== -1);
  const keys = Logic.PRESETS.map(x => x.key);
  assert.strictEqual(new Set(keys).size, keys.length);
});
