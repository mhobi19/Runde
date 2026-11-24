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
        tx.onerror = function () { reject(tx.error); };
        tx.onabort = function () { reject(tx.error || new Error('Speichern abgebrochen.')); };
      });
    });
  }

  var Queue = {
    add: function (item) { return run('readwrite', function (s) { return s.put(item); }); },
    update: function (item) { return run('readwrite', function (s) { return s.put(item); }); },
    remove: function (id) { return run('readwrite', function (s) { return s.delete(id); }); },
    all: function () {
      return run('readonly', function (s) { return s.getAll(); }).then(function (list) {
        return (list || []).sort(function (a, b) { return a.takenAt < b.takenAt ? -1 : a.takenAt > b.takenAt ? 1 : 0; });
      });
    }
  };

  root.RundeQueue = Queue;
})(typeof window !== 'undefined' ? window : this);
