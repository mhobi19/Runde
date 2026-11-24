/* Runde – Offline-Warteschlange: Getränke samt Foto lokal in IndexedDB halten, bis sie hochgeladen sind. */
(function (root) {
  'use strict';
  var DB_NAME = 'runde-queue';
  var STORE = 'drinks';
  var dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      if (!root.indexedDB) { reject(new Error('Dieser Browser kann keine Offline-Daten speichern.')); return; }
      var req = root.indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function () { req.result.createObjectStore(STORE, { keyPath: 'id' }); };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('Offline-Speicher nicht verfügbar.')); };
    });
    dbPromise.catch(function () { dbPromise = null; });
    return dbPromise;
  }

  function run(mode, fn) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, mode);
        var store = tx.objectStore(STORE);
        var out = fn(store);
        tx.oncomplete = function () { resolve(out && out.result !== undefined ? out.result : undefined); };
        tx.onerror = function () { reject(tx.error || new Error('Offline-Speicher: Fehler beim Schreiben.')); };
        tx.onabort = function () { reject(tx.error || new Error('Offline-Speicher: Schreiben abgebrochen.')); };
      });
    });
  }

  function readBuffer(blob) {
    if (blob.arrayBuffer) return blob.arrayBuffer();
    return new Promise(function (resolve, reject) {
      var fr = new root.FileReader();
      fr.onload = function () { resolve(fr.result); };
      fr.onerror = function () { reject(fr.error || new Error('Foto konnte nicht gelesen werden.')); };
      fr.readAsArrayBuffer(blob);
    });
  }

  function pack(item) {
    var copy = {};
    Object.keys(item).forEach(function (k) { if (k !== 'blob') copy[k] = item[k]; });
    if (!item.blob) return Promise.resolve(copy);
    return readBuffer(item.blob).then(function (buf) {
      copy.buf = buf;
      copy.type = item.blob.type || 'image/jpeg';
      return copy;
    });
  }

  function unpack(rec) {
    var item = {};
    Object.keys(rec).forEach(function (k) { if (k !== 'buf' && k !== 'type') item[k] = rec[k]; });
    if (rec.buf) item.blob = new root.Blob([rec.buf], { type: rec.type || 'image/jpeg' });
    else if (rec.blob) item.blob = rec.blob;
    return item;
  }

  function put(item) {
    return pack(item).then(function (rec) { return run('readwrite', function (s) { return s.put(rec); }); });
  }

  var Queue = {
    add: put,
    update: put,
    remove: function (id) { return run('readwrite', function (s) { return s.delete(id); }); },
    all: function () {
      return run('readonly', function (s) { return s.getAll(); }).then(function (list) {
        return (list || []).map(unpack).sort(function (a, b) { return a.takenAt < b.takenAt ? -1 : a.takenAt > b.takenAt ? 1 : 0; });
      });
    }
  };

  root.RundeQueue = Queue;
})(typeof window !== 'undefined' ? window : this);
