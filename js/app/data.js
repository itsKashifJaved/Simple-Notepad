var Data = {};
(function () {
    var _STORE = "notes";
    var _UPDATING = {};
    var MUTABLE_NOTE_ATTRIBUTES = ["deleted", "locked", "reminder_at_time", "text"];
    var SYNC_OBJECT_IMMUTABLE_ATTRIBUTES = ["created_by", "stream_id"];
    var SYNC_OBJECT_MARKER_ATTRIBUTES = ["invite_updates_count", "response_updates_count", "rev"];
    Data.MAX_NOTE_LENGTH = 300000;
    var _add = function (args, cbk) {
        if (!args.row.id) {
            return cbk([0, "Expected id"]);
        }
        Db.write({ key: args.row.id, row: args.row, store: _STORE }, cbk);
    };
    var _delete = function (args, cbk) {
        if (!args.key) {
            return cbk([0, "Expected note key to delete"]);
        }
        Db.removeRow({ key: args.key, store: _STORE }, cbk);
    };
    var _get = function (args, cbk) {
        if (!args.key) {
            return cbk([0, "Expected key for note"]);
        }
        if (_UPDATING[args.key] === true) {
            return cbk({ status: 0, statusText: "updating" });
        }
        Db.getRow({ key: args.key, store: _STORE }, cbk);
    };
    var _update = function (args, cbk) {
        if (!args.row || !args.row.id) {
            return cbk([0, "Expected Row"]);
        }
        _UPDATING[args.row.id] = true;
        Db.write({ key: args.row.id, row: args.row, store: _STORE }, function (err, row) {
            delete _UPDATING[args.row.id];
            return !!err ? cbk(err) : cbk(null, row);
        });
    };
    Data._emptyNoteIdsFromNoteRows = function (args, cbk) {
        if (!Array.isArray(args.notes)) {
            return cbk([0, "Expected notes array", args.notes]);
        }
        var emptyNotes = args.notes.filter(function (n) {
            var hasText = !!n.text;
            var isDirty = !!n.dirty_since;
            var isEmpty = !hasText || n.deleted === 1;
            return isEmpty && !isDirty;
        });
        cbk(null, _(emptyNotes).pluck("id"));
    };
    Data._shouldUpdateDirtyRow = function (args) {
        var currentNote = args.current_note;
        var dirty = !!currentNote && !!currentNote.dirty_since;
        if (!dirty) {
            return false;
        }
        var cleanAt = args.cleaned_after;
        var dirtyAt = currentNote.dirty_since;
        var madeDirtyAfterCleanStart = !!cleanAt && dirtyAt > cleanAt;
        if (madeDirtyAfterCleanStart) {
            return false;
        }
        return true;
    };
    Data._newNoteWithAttributes = function (args, cbk) {
        var start = new Date().toISOString();
        var row = { created_at: start, dirty_since: start, id: args.id || Data.uuid(), last_modified: start, text: args.text || "", text_last_modified: start };
        if (!!args.destination && !!args.destination_icon) {
            row.destination = args.destination;
            row.destination_last_modified = start;
            row.destination_icon = args.destination_icon;
            row.destination_icon_last_modified = start;
        }
        return cbk(null, row);
    };
    Data._rowWithLocalNoteModifications = function (args, cbk) {
        var modified;
        var row = _(args.existingRow).clone();
        var start = new Date().toISOString();
        MUTABLE_NOTE_ATTRIBUTES.filter(function hasModification(type) {
            if (args[type] === undefined) {
                return false;
            }
            if (row[type] === args[type] && args.force !== true) {
                return false;
            }
            return true;
        }).forEach(function applyModification(type) {
            modified = modified || start;
            row[type] = args[type];
            row[type + "_last_modified"] = start;
            var valueLength = row[type].length;
            if (!!valueLength && valueLength > Data.MAX_NOTE_LENGTH) {
                row[type] = row[type].substring(0, Data.MAX_NOTE_LENGTH);
            }
            if (!row.dirty_since || modified > row.dirty_since) {
                row.dirty_since = modified;
            }
        });
        if (!modified) {
            return cbk();
        }
        row.last_modified = row.text_last_modified;
        cbk(null, row);
    };
    Data._updatedNoteWithChanges = function (args, cbk) {
        if (!args.existing || !args.updated) {
            return cbk([0, "Expected Existing and Updated"]);
        }
        var modified = false;
        var changed = args.updated;
        var row = _(args.existing).clone();
        SYNC_OBJECT_MARKER_ATTRIBUTES.filter(function didChangeAttribute(attr) {
            return !!changed[attr] && changed[attr] !== row[attr];
        }).forEach(function adjustFinalAttribute(attr) {
            modified = modified || true;
            row[attr] = changed[attr];
        });
        MUTABLE_NOTE_ATTRIBUTES.filter(function didChangeAttribute(attr) {
            return row[attr] !== changed[attr];
        })
            .filter(function hasLastModified(attr) {
                return !!changed[attr + "_last_modified"];
            })
            .filter(function didMutateAttribute(attr) {
                var lastModified = attr + "_last_modified";
                var newAttribute = row[attr] === undefined;
                if (newAttribute) {
                    return true;
                }
                return row[lastModified] < changed[lastModified];
            })
            .forEach(function applyMutationsToRowForAttribute(attr) {
                if (attr === "text") {
                    changed.text = changed.text || "";
                    row.text = row.text || "";
                }
                modified = modified || true;
                row[attr] = changed[attr];
                row[attr + "_last_modified"] = changed[attr + "_last_modified"];
            });
        if (modified === false) {
            return cbk();
        }
        row.last_modified = changed.text_last_modified;
        return cbk(null, row);
    };
    Data._updateNoteAttributes = function (args, cbk) {
        async.auto(
            {
                getUpdatedRow: function (go_on) {
                    Data._updatedNoteWithChanges({ existing: args.existing, updated: args.updated }, go_on);
                },
                writeChanges: [
                    "getUpdatedRow",
                    function (go_on, res) {
                        if (!res.getUpdatedRow) {
                            return go_on();
                        }
                        _update({ row: res.getUpdatedRow }, go_on);
                    },
                ],
                updateVisibleNote: [
                    "writeChanges",
                    function (go_on, res) {
                        if (!res.writeChanges) {
                            return go_on();
                        }
                        Page.updateCurrentNote({ id: res.writeChanges.id }, go_on);
                    },
                ],
            },
            cbk
        );
    };
    Data.addNote = function (args, cbk) {
        Data._newNoteWithAttributes({ destination: args.destination, destination_icon: args.destination_icon, id: args.id, text: args.text }, function (err, row) {
            if (!!err) {
                return cbk(err);
            }
            _add({ row: row }, cbk);
        });
    };
    Data.adjustNoteRevs = function (args, cbk) {
        if (!Array.isArray(args.revs)) {
            return cbk([0, "Expected array"]);
        }
        if (!args.revs.length) {
            return cbk();
        }
        async.each(
            args.revs,
            function (note, adjustedRevs) {
                var id = note[0];
                var rev = note[1];
                async.auto(
                    {
                        getNote: function (go_on) {
                            Data.getNote({ id: id }, go_on);
                        },
                        updateNote: [
                            "getNote",
                            function (go_on, res) {
                                if (!res.getNote) {
                                    return go_on();
                                }
                                _update({ row: _(res.getNote).extend({ rev: rev }) }, go_on);
                            },
                        ],
                    },
                    adjustedRevs
                );
            },
            cbk
        );
    };
    Data.clearEmptyNotes = function (args, cbk) {
        async.auto(
            {
                dbIsReady: function (go_on) {
                    if (!Db.isReady) {
                        return go_on([0, "Expected db ready"]);
                    }
                    go_on();
                },
                getLastModifiedNotes: [
                    "dbIsReady",
                    function (go_on, res) {
                        Db.query({ index: "last_modified", store: _STORE }, go_on);
                    },
                ],
                getEmptyNoteIds: [
                    "getLastModifiedNotes",
                    function (go_on, res) {
                        Data._emptyNoteIdsFromNoteRows({ notes: res.getLastModifiedNotes }, go_on);
                    },
                ],
                eliminateEmptyNotes: [
                    "getEmptyNoteIds",
                    function (go_on, res) {
                        async.each(
                            res.getEmptyNoteIds,
                            function (key, deleted) {
                                _delete({ key: key }, deleted);
                            },
                            go_on
                        );
                    },
                ],
            },
            cbk
        );
    };
    Data.deleteNoteById = function (args, cbk) {
        async.auto(
            {
                hasAuth: function (go_on) {
                    Sync.hasAuthIncludingCredentials({}, go_on);
                },
                eliminateNote: [
                    "hasAuth",
                    function (go_on, res) {
                        if (!args.id) {
                            return go_on([0, "Expected id"]);
                        }
                        if (!res.hasAuth) {
                            return _delete({ key: args.id }, go_on);
                        }
                        Data.editNote({ deleted: 1, id: args.id, text: "" }, go_on);
                    },
                ],
            },
            cbk
        );
    };
    Data.editNote = function (args, cbk) {
        cbk = cbk || function () {};
        if (!args.id) {
            return cbk([0, "Expected id to edit note"]);
        }
        async.auto(
            {
                getExistingNote: function (go_on) {
                    _get({ key: args.id }, go_on);
                },
                noteWithModifications: [
                    "getExistingNote",
                    function (go_on, res) {
                        if (res.getExistingNote === undefined) {
                            return go_on({ status: 0, statusText: "Expected note" });
                        }
                        Data._rowWithLocalNoteModifications({ deleted: args.deleted, existingRow: res.getExistingNote, force: args.force, id: args.id, text: args.text }, go_on);
                    },
                ],
                updateNote: [
                    "noteWithModifications",
                    function (go_on, res) {
                        if (!res.noteWithModifications) {
                            return go_on();
                        }
                        _update({ row: res.noteWithModifications }, go_on);
                    },
                ],
                pushChanges: [
                    "updateNote",
                    function (go_on, res) {
                        if (!res.noteWithModifications) {
                            return go_on();
                        }
                        setTimeout(function () {
                            Sync.pushChanges({ rows: [res.noteWithModifications] }, Client.reportErrors({}));
                        }, Math.random() * 1000);
                        go_on();
                    },
                ],
            },
            function (err, res) {
                if (!!err) {
                    return cbk(err);
                }
                cbk(null, res.noteWithModifications || res.getExistingNote);
            }
        );
    };
    Data.getDirtyNotes = function (args, cbk) {
        var range;
        if (!!args.before) {
            range = ["", args.before];
        }
        Db.query({ index: "dirty_since", limit: args.limit, range: range, store: _STORE }, function (err, notes) {
            if (!!err) {
                return cbk(err);
            }
            var dirtyNotes = notes.filter(function (n) {
                var isHolder = n.text === "" && n.created_at === n.dirty_since;
                return !isHolder;
            });
            return cbk(null, dirtyNotes);
        });
    };
    Data.getFirstVisibleNote = function (args, cbk) {
        if (!Array.isArray(args.notes)) {
            return cbk([0, "Expected arr"]);
        }
        async.detectSeries(
            args.notes,
            function (note, go_on) {
                var excluded = note.id === args.exclude_id;
                go_on(!Data.isHiddenNote({ note: note }) && !excluded);
            },
            function (note) {
                cbk(null, note);
            }
        );
    };
    Data.getNextNote = function (args, cbk) {
        Data.getRecentNotes(
            {
                after: args.after,
                before: args.before,
                direction: !!args.after ? "next" : "prev",
                filter: function (note) {
                    if (args.exclude_id === note.id) {
                        return false;
                    }
                    if (Data.isHiddenNote({ note: note })) {
                        return false;
                    }
                    return true;
                },
                limit: 1,
            },
            function (err, notes) {
                if (!!err) {
                    return cbk(err);
                }
                if (!notes.length) {
                    return cbk();
                }
                return cbk(null, notes[0]);
            }
        );
    };
    Data.getNote = function (args, cbk) {
        if (!args.id) {
            return cbk([0, "Expected id for note"]);
        }
        _get({ key: args.id }, cbk);
    };
    Data.getRecentNotes = function (args, cbk) {
        var range = null;
        if (!!args.before) {
            range = ["", args.before];
        } else if (!!args.after) {
            range = [args.after, new Date().toISOString()];
        }
        Db.query({ filter: args.filter, index: "last_modified", limit: args.limit, partial: args.partial, range: range, sort: args.direction || "prev", store: _STORE }, cbk);
    };
    Data.isHiddenNote = function (args) {
        return args.note.text === "" || !!args.note.deleted;
    };
    Data.logout = function (args, cbk) {
        async.auto(
            {
                clearClientStorage: function (go_on) {
                    Client.clearStorage({}, go_on);
                },
                clearDatabase: function (go_on) {
                    Db.clear({}, go_on);
                },
            },
            cbk
        );
    };
    Data.markAsClean = function (args, cbk) {
        cbk = cbk || function () {};
        if (!args.dirty_before) {
            return cbk([0, "Expected dirty date"]);
        }
        if (!args.notes.length) {
            return cbk();
        }
        var ids = _(args.notes).pluck("id");
        async.each(
            ids,
            function (id, go_on) {
                Data.getNote({ id: id }, function (err, note) {
                    if (!!err) {
                        return go_on(err);
                    }
                    if (!note.dirty_since) {
                        return go_on();
                    }
                    var dirtyEpochTime = Date.parse(note.dirty_since) + 1000;
                    var dirtySince = new Date(dirtyEpochTime).toISOString();
                    if (dirtySince > args.dirty_before) {
                        return go_on();
                    }
                    _update({ row: _(note).omit("dirty_since") }, go_on);
                });
            },
            cbk
        );
    };
    Data.search = function (args, cbk) {
        var matchesQuery = function (row) {
            if (args.q == "") {
                return true;
            }
            var qx = new RegExp(args.q.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), "im");
            return qx.test(row.text);
        };
        Data.getRecentNotes(
            {
                partial: function (note) {
                    if (!args.partial || !matchesQuery(note)) {
                        return;
                    }
                    return args.partial(note);
                },
            },
            function (err, notes) {
                if (!!err) {
                    return cbk(err);
                }
                cbk(null, notes.filter(matchesQuery));
            }
        );
    };
    Data.start = function (args, cbk) {
        async.auto(
            {
                startDb: function (go_on) {
                    Db.init({}, go_on);
                },
                delayCompletion: [
                    "startDb",
                    function (go_on, res) {
                        _(go_on).delay(100);
                    },
                ],
            },
            cbk
        );
    };
    Data.updateNote = function (args, cbk) {
        if (!args.note) {
            return cbk([0, "Expected note"]);
        }
        if (!args.note.id) {
            return cbk([0, "Expected note id"]);
        }
        var note = args.note;
        async.auto(
            {
                getExisting: function (go_on) {
                    _get({ key: note.id }, go_on);
                },
                addNote: [
                    "getExisting",
                    function (go_on, res) {
                        if (!!res.getExisting) {
                            return go_on();
                        }
                        if (Data.isHiddenNote({ note: note })) {
                            return go_on();
                        }
                        _add({ row: note }, go_on);
                    },
                ],
                updateNote: [
                    "addNote",
                    function (go_on, res) {
                        if (!res.getExisting || !!res.getExisting.dirty_since) {
                            return go_on();
                        }
                        Data._updateNoteAttributes({ existing: res.getExisting, updated: note }, go_on);
                    },
                ],
                updateListing: [
                    "updateNote",
                    function (go_on, res) {
                        Page.updateCurrentNote({ id: note.id }, go_on);
                    },
                ],
            },
            cbk
        );
    };
    Data.updateNoteRev = function (args, cbk) {
        if (!args.id || !args.rev) {
            return cbk([0, "Expected id and rev"]);
        }
        async.auto(
            {
                getNote: function (go_on) {
                    Data.getNote({ id: args.id }, go_on);
                },
                updateRow: [
                    "getNote",
                    function (go_on, res) {
                        if (!res.getNote) {
                            return go_on();
                        }
                        _update({ row: _(res.getNote).extend({ rev: args.rev }) }, go_on);
                    },
                ],
            },
            cbk
        );
    };
    Data.uuid = function (args) {
        var random;
        var uuid = "";
        for (var i = 0; i < 32; i++) {
            random = (Math.random() * 16) | 0;
            if (i == 8 || i == 12 || i == 16 || i == 20) {
                uuid += "-";
            }
            uuid += (i == 12 ? 4 : i == 16 ? (random & 3) | 8 : random).toString(16);
        }
        return uuid;
    };
    Data.wipeSyncObjects = function (args, cbk) {
        async.auto(
            {
                getSyncObjects: function (go_on) {
                    Data.getRecentNotes(
                        {
                            filter: function (n) {
                                return !!n.rev;
                            },
                        },
                        go_on
                    );
                },
                removeSyncObjects: [
                    "getSyncObjects",
                    function (go_on, res) {
                        var keys = _(res.getSyncObjects).pluck("id");
                        async.forEach(
                            keys,
                            function (k, removed) {
                                Db.removeRow({ key: k, store: _STORE }, removed);
                            },
                            go_on
                        );
                    },
                ],
            },
            cbk
        );
    };
})();
