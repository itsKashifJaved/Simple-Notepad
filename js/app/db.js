var Db = {
    _db: null,
    _indexes: {
        notes: [
            { name: "last_modified", options: { unique: false } },
            { name: "dirty_since", options: { unique: false } },
        ],
    },
    _stores: ["notes"],
};
(function () {
    Db._store = function (store, readonly) {
        var mode = readonly === true ? "readonly" : "readwrite";
        return Db._db.transaction([store], mode).objectStore(store);
    };
    Db.clear = function (args, cbk) {
        async.each(
            Db._stores,
            function (n, go_on) {
                var req = Db._store(n).clear();
                req.onerror = function (e) {
                    go_on([500, "failed to clear", e]);
                };
                req.onsuccess = function () {
                    go_on();
                };
            },
            cbk
        );
    };
    Db.getRow = function (args, cbk) {
        if (!args.store || !args.key) {
            return cbk([0, "Expect args", args]);
        }
        if (Db._stores.indexOf(args.store) === -1) {
            return cbk([500, "Unknown store"]);
        }
        var req = Db._store(args.store, true).get(args.key);
        req.onerror = function (e) {
            cbk([500, "Indexeddb get error", e]);
        };
        req.onsuccess = function (e) {
            cbk(null, req.result);
        };
    };
    Db.init = function (args, cbk) {
        if (!window.indexedDB) {
            return cbk([0, "Database not supported"]);
        }
        if (!!Db._db) {
            return cbk();
        }
        var start = new Date();
        var version = 1;
        var req = indexedDB.open("notepad", version);
        if (!req) {
            return cbk([0, "IndexedDB database not supported"]);
        }
        req.onupgradeneeded = function (e) {
            var db = e.target.result;
            e.target.transaction.onerror = function (e) {
                Client.log({ err: e });
            };
            Db._stores.forEach(function (n) {
                if (db.objectStoreNames.contains(n)) {
                    db.deleteObjectStore(n);
                }
                var objectStore = db.createObjectStore(n, { keyPath: "id" });
                if (!Db._indexes[n]) {
                    return;
                }
                Db._indexes[n].forEach(function (i) {
                    objectStore.createIndex(i.name, i.name, i.options);
                });
            });
        };
        req.onsuccess = function (e) {
            Db._db = e.target.result;
            if (Db._db.objectStoreNames.length !== Db._stores.length) {
                Client.log({ err: { status: 0, statusText: "db store init failure" } });
            }
            Db._db.onversionchange = function (e) {
                Db._db.close();
                if (window && window.location && location.reload) {
                    location.reload();
                }
            };
            cbk();
        };
        req.onerror = function (e) {
            cbk([500, "Db open error", e.target.error.message]);
        };
    };
    Db.isReady = function (args) {
        return !!Db._db;
    };
    Db.query = function (args, cbk) {
        if (!args.store) {
            return cbk([0, "Expected store"]);
        }
        var range = null;
        if (args.range) {
            if (args.range[0] && !args.range[1]) {
                range = IDBKeyRange.lowerBound(args.range[0]);
            } else if (args.range[1] && !args.range[0]) {
                range = IDBKeyRange.upperBound(args.range[1]);
            } else {
                range = IDBKeyRange.bound(args.range[0], args.range[1]);
            }
        }
        if (Array.isArray(args.only)) {
            args.only.sort();
        }
        if (args.only !== undefined) {
            range = IDBKeyRange.only(args.only);
        }
        var aborted = false;
        var store = Db._store(args.store, true);
        var values = [];
        var queryAgainst = !args.index ? store : store.index(args.index);
        var cursor = queryAgainst.openCursor(range, args.sort || "prev");
        cursor.onsuccess = function (e) {
            var result = e.target.result;
            if (!result || !!aborted) {
                aborted = null;
                return cbk(null, values);
            }
            var value = result.value;
            if (!!args.filter && !args.filter(value)) {
                return result.continue();
            }
            if (!!args.attributes) {
                value = _(value).pick(args.attributes);
            }
            if (!!args.partial) {
                args.partial({ key: value.key, row: value, store: args.store });
            }
            values.push(value);
            if (!!args.limit && values.length === args.limit) {
                return cbk(null, values);
            }
            result.continue();
        };
        cursor.onerror = function (e) {
            cbk([500, "Indexeddb query error", e]);
        };
        return {
            abort: function () {
                aborted = true;
            },
        };
    };
    Db.write = function (args, cbk) {
        if (!args.store || !args.row || !args.key) {
            return cbk([500, "Invalid write arguments", args]);
        }
        if (!Db._db) {
            return cbk([503, "Db not ready"]);
        }
        var req = Db._store(args.store).put(_({ key: args.key }).extend(args.row));
        req.onerror = function (e) {
            cbk([500, "Db write error", e]);
        };
        req.onsuccess = function () {
            cbk(null, args.row);
        };
    };
    Db.removeRow = function (args, cbk) {
        if (!args.store || !args.key) {
            return cbk([0, "Invalid remove arguments", args]);
        }
        if (!Db._db) {
            return cbk([503, "Db not ready"]);
        }
        var req = Db._store(args.store).delete(args.key);
        req.onerror = function (e) {
            cbk([500, "Db delete error", e]);
        };
        req.onsuccess = function () {
            cbk();
        };
    };
    Db.update = function (args, cbk) {
        if (!args.store || !Array.isArray(args.rows)) {
            return cbk([0, "Invalid update arguments", args]);
        }
        var rows = _(args.rows).compact();
        if (!rows.length) {
            return cbk(null, []);
        }
        async.concat(
            rows,
            function (row, go_on) {
                Db.write({ key: row.id, row: row, store: args.store }, go_on);
            },
            cbk
        );
    };
})();
