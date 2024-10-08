var Sync = {};
(function () {
    var _BOOLEAN_NOTE_ATTRIBUTES = ["deleted", "locked"];
    var _JSON_CONTENT_TYPE = "application/json; encoding=UTF-8";
    var _MAXIMUM_SIMULTANEOUS_UPDATES = 8;
    var _MIN_PUSH_CHANGES_TIME_MS = 2000;
    var _PUSHER_KEY = "e663aa758dc0ddfbaba2";
    var _REMOTE_SERVICE_AUTH_TIMEOUT_MS = 1000 * 60 * 15;
    var _REMOTE_SYNC_SERVICES = [["google", "drive"], ["dropbox"]];
    var _SERVICES = {
        account: "https://tasks-api.adylitica.com",
        auth: "https://auth-api.adylitica.com",
        messages: "https://messages-api.adylitica.com",
        notes: "https://notes-api.adylitica.com",
        notices: "https://notices-api.adylitica.com",
        streams: "https://streams-api.adylitica.com",
    };
    var _TOKEN_KEYS = {
        account_id: "account_id",
        account_privs: "account_privs",
        auth_block: "authBlock",
        enabled_remote_sync_services: "enabled_remote_sync_services",
        notes_current_path: "notes_current_path",
        personal_stream_current_path: "personal_stream_current_path",
        selected_note_id: "selected_note_id",
    };
    var _requested_anonymous_notice = false;
    var _requests = [];
    var _tokens = {};
    Sync._authXHR = function (args) {
        if (!args) {
            return Client.log({ err: [0, "Expected args"] });
        }
        return function (xhr) {
            var headers = { Authorization: "Basic " + args.auth_block, "X-User-Profile": JSON.stringify(Client.profile({})) };
            if (!args.omit_date) {
                headers["X-Date"] = new Date().toISOString();
            }
            Object.keys(headers).forEach(function (header) {
                xhr.setRequestHeader(header, headers[header]);
            });
        };
    };
    Sync._chunkedArrayFromArray = function (args) {
        var chunked = [];
        var maxUpdates = args.max_chunk_size;
        var arrSize = args.array.length;
        for (var i = 0, chunk = args.max_chunk_size; i < arrSize; i += chunk) {
            chunked.push(args.array.slice(i, i + chunk));
        }
        return chunked;
    };
    Sync._cleanRequests = function (args) {
        _requests = _requests.filter(function (r) {
            return !!r && r.status === undefined;
        });
    };
    Sync._dataNotesFromSyncNotes = function (args) {
        return args.sync_notes.map(function (note) {
            note.last_modified = note.text_last_modified;
            _BOOLEAN_NOTE_ATTRIBUTES
                .filter(function (attr) {
                    return note[attr] !== undefined;
                })
                .forEach(function (attr) {
                    note[attr] = !note[attr] ? 0 : 1;
                });
            return note;
        });
    };
    Sync._getAccountId = function (args, cbk) {
        async.auto(
            {
                getCachedId: function (go_on) {
                    return Sync.getToken({ key: _TOKEN_KEYS.account_id }, go_on);
                },
                getAccount: [
                    "getCachedId",
                    function (go_on, res) {
                        if (!!res.getCachedId) {
                            return go_on();
                        }
                        return Sync.getAccount({}, go_on);
                    },
                ],
                getFreshId: [
                    "getAccount",
                    function (go_on, res) {
                        if (!res.getAccount) {
                            return go_on();
                        }
                        if (!res.getAccount.id) {
                            return go_on([0, "Expected id"]);
                        }
                        return go_on(null, res.getAccount.id);
                    },
                ],
                cacheFreshId: [
                    "getFreshId",
                    function (go_on, res) {
                        if (!res.getFreshId) {
                            return go_on();
                        }
                        return Sync.setSingleToken({ key: _TOKEN_KEYS.account_id, value: res.getFreshId }, go_on);
                    },
                ],
                id: [
                    "getCachedId",
                    "getFreshId",
                    function (go_on, res) {
                        var id = res.getCachedId || res.getFreshId;
                        if (!id) {
                            return go_on([0, "Expected account id", res]);
                        }
                        return go_on(null, id);
                    },
                ],
            },
            function (err, res) {
                if (!!err) {
                    return cbk(err);
                }
                return cbk(null, res.id);
            }
        );
    };
    Sync._getLinksFromHeader = function (args) {
        if (!args.link) {
            return {};
        }
        var currentLinkPattern = /<([^<]*)>; rel=.current./;
        var link = args.link;
        var links = {};
        var nextLinkPattern = /<([^<]*)>; rel=.next./;
        var current = !!link ? link.match(currentLinkPattern) : null;
        var next = !!link ? link.match(nextLinkPattern) : null;
        if (!!next && next.length === 2) {
            links.next = next[1];
        }
        if (!!current && current.length === 2) {
            links.current = current[1];
        }
        return links;
    };
    Sync._getNotesPageFromPath = function (args, cbk) {
        if (!args.path) {
            return cbk([0, "Expected path"]);
        }
        async.auto(
            {
                getNotes: function (go_on) {
                    Sync._makeRequest({ url: _SERVICES.notes + args.path }, function (err, results, status, xhr) {
                        if (!!err) {
                            return go_on(err);
                        }
                        return go_on(null, { results: results, xhr: xhr });
                    });
                },
                refreshState: [
                    "getNotes",
                    function (go_on, res) {
                        var links = Sync._getLinksFromHeader({ link: res.getNotes.xhr.getResponseHeader("Link") });
                        var noUpdate = !res.getNotes.results && !links.next;
                        if (noUpdate) {
                            return go_on(null, { currentPath: args.path });
                        }
                        return go_on(null, { currentPath: links.current, nextPath: links.next });
                    },
                ],
                showAuthenticated: [
                    "getNotes",
                    function (go_on, res) {
                        Page.authorized({ force: true }, go_on);
                    },
                ],
                updateLocalNotes: [
                    "getNotes",
                    function (go_on, res) {
                        if (!res.getNotes.results) {
                            return go_on();
                        }
                        Sync._updateLocalNotes({ notes: res.getNotes.results }, go_on);
                    },
                ],
            },
            function (err, res) {
                if (!!err) {
                    return cbk(err);
                }
                cbk(null, res.refreshState);
            }
        );
    };
    Sync._getPersonalStreamPath = function (args, cbk) {
        async.auto(
            {
                getCachedCurrentPath: function (go_on) {
                    Sync.getToken({ key: _TOKEN_KEYS.personal_stream_current_path }, go_on);
                },
                getAccountId: [
                    "getCachedCurrentPath",
                    function (go_on, res) {
                        if (!!res.getCachedCurrentPath) {
                            return go_on();
                        }
                        Sync._getAccountId({}, go_on);
                    },
                ],
                streamId: [
                    "getAccountId",
                    function (go_on, res) {
                        if (!!res.getCachedCurrentPath) {
                            return go_on();
                        }
                        if (!res.getAccountId) {
                            return go_on([0, "Expected id"]);
                        }
                        var streamId = [res.getAccountId, res.getAccountId].join(":");
                        go_on(null, streamId);
                    },
                ],
                hasPersonalStream: [
                    "streamId",
                    function (go_on, res) {
                        if (!!res.getCachedCurrentPath) {
                            return go_on(null, true);
                        }
                        Sync._hasStream({ stream_id: res.streamId }, go_on);
                    },
                ],
                personalPath: [
                    "hasPersonalStream",
                    function (go_on, res) {
                        if (!!res.getCachedCurrentPath || !res.hasPersonalStream) {
                            return go_on();
                        }
                        go_on(null, "/v0/objects/" + res.streamId + "/");
                    },
                ],
            },
            function (err, res) {
                if (!!err) {
                    return cbk(err);
                }
                cbk(null, res.getCachedCurrentPath || res.personalPath);
            }
        );
    };
    Sync._hasStream = function (args, cbk) {
        if (!args.stream_id) {
            return cbk([0, "Expected stream id"]);
        }
        Sync._makeRequest({ url: _SERVICES.streams + "/v0/streams/by_id?ids[0]=" + args.stream_id }, function (err, _body, _status, xhr) {
            if (!!err) {
                return cbk(err);
            }
            if (!xhr || !xhr.status) {
                return cbk([0, "Expected status"]);
            }
            var hasStream = xhr.status === 200;
            return cbk(null, hasStream);
        });
    };
    Sync._makeRequest = function (args, cbk) {
        async.auto(
            {
                getCachedAuth: function (go_on) {
                    Sync.getToken({ key: _TOKEN_KEYS.auth_block }, go_on);
                },
                getAuthBlock: [
                    "getCachedAuth",
                    function (go_on, res) {
                        if (!!res.getCachedAuth) {
                            return go_on(null, res.getCachedAuth);
                        }
                        var credentials = Page.getCredentials({});
                        if (!credentials.email || !credentials.password) {
                            return go_on([401, "Expected credentials"]);
                        }
                        go_on(null, btoa(credentials.email + ":" + credentials.password));
                    },
                ],
                sendRequest: [
                    "getAuthBlock",
                    function (go_on, res) {
                        if (!res.getAuthBlock) {
                            return go_on([0, "Expected auth"]);
                        }
                        var body = !!args.json ? JSON.stringify(args.json) : args.body;
                        var req = $.ajax({
                            beforeSend: Sync._authXHR({ auth_block: res.getAuthBlock, omit_date: args.omit_date }),
                            contentType: !!body ? _JSON_CONTENT_TYPE : undefined,
                            data: body || null,
                            type: args.method || "GET",
                            url: args.url,
                        })
                            .fail(function (xhr) {
                                if (xhr.status === 401) {
                                    return go_on([401, "No auth"]);
                                }
                                return go_on(xhr);
                            })
                            .success(function (r, s, xhr) {
                                return go_on(null, { results: r, status: s, xhr: xhr });
                            });
                        _requests.push(req);
                    },
                ],
                persistAuthBlock: [
                    "sendRequest",
                    function (go_on, res) {
                        if (!!res.getCachedAuth) {
                            return go_on();
                        }
                        Sync.setSingleToken({ key: _TOKEN_KEYS.auth_block, value: res.getAuthBlock }, go_on);
                    },
                ],
                blankPassword: [
                    "persistAuthBlock",
                    function (go_on, res) {
                        $("#account .password").val("");
                        go_on();
                    },
                ],
            },
            function (err, res) {
                if (!!err) {
                    return cbk(err);
                }
                var r = res.sendRequest;
                return cbk(null, r.results, r.status, r.xhr);
            }
        );
    };
    Sync._makeSimpleRequest = function (args, cbk) {
        Sync._makeRequest({ body: args.body, json: args.json, method: args.method, url: args.url }, function (err, results) {
            if (!!err) {
                return cbk(err);
            }
            return cbk(null, results);
        });
    };
    Sync._nextRefreshType = function (args) {
        var refreshAgainType = args.current_type;
        if (refreshAgainType === "all") {
            return "all";
        }
        if (args.requested_type === "notes" && refreshAgainType === "stream") {
            return "all";
        }
        if (args.requested_type === "stream" && refreshAgainType === "notes") {
            return "all";
        }
        if (!!args.requested_type) {
            return args.requested_type;
        }
        return "all";
    };
    Sync._processServiceError = function (args, cbk) {
        if (!args.err) {
            return cbk([0, "Expected error"]);
        }
        var err = args.err;
        var code = (Array.isArray(err) ? err[0] : err.status) || 0;
        switch (code) {
            case 400:
                Page.showError({ err: err });
                return Page.logout({}, cbk);
            case 401:
                return Page.logout({ keep_notes: true }, cbk);
            case 403:
                return Page.logout({ keep_notes: true }, function () {
                    Page.showError({ err: err });
                    cbk();
                });
            case 404:
                return cbk();
            default:
                Page.showError({ err: err });
                return cbk();
        }
    };
    Sync._pushUpdates = function (args, cbk) {
        if (!Array.isArray(args.notes) || !args.url) {
            return cbk([0, "Expected notes and URL"]);
        }
        var updates = Sync._updatesFromNotes({ notes: args.notes });
        if (!updates.length) {
            return cbk();
        }
        var chunked = Sync._chunkedArrayFromArray({ array: updates, max_chunk_size: _MAXIMUM_SIMULTANEOUS_UPDATES });
        async.concat(
            chunked,
            function (updateChunk, go_on) {
                Sync._makeRequest({ body: JSON.stringify(updateChunk), method: "POST", omit_date: args.omit_date, url: args.url }, function (err, results) {
                    if (!!err) {
                        return go_on(err);
                    }
                    go_on(null, results || []);
                });
            },
            cbk
        );
    };
    Sync._refreshNotesFromPath = function (args, cbk) {
        if (!args.path) {
            return cbk([0, "Expected sync path"]);
        }
        var currentPath;
        var path = args.path;
        async.until(
            function () {
                return !path;
            },
            function (go_on) {
                Sync._getNotesPageFromPath({ path: path }, function (err, state) {
                    if (!!err) {
                        return go_on(err);
                    }
                    path = state.nextPath;
                    if (!currentPath) {
                        currentPath = state.currentPath;
                    }
                    go_on();
                });
            },
            function (err) {
                if (!!err) {
                    Sync._processServiceError({ err: err }, function (processErr) {
                        cbk(processErr || err);
                    });
                    return;
                }
                Page.resetError({});
                if (!currentPath) {
                    return cbk();
                }
                Sync.setSingleToken({ key: _TOKEN_KEYS.notes_current_path, value: currentPath }, cbk);
            }
        );
    };
    Sync._refreshSyncObjectsFromPath = function (args, cbk) {
        if (!args.path) {
            return cbk([0, "Expected path"]);
        }
        var currentPath;
        var path = args.path;
        async.until(
            function () {
                return !path;
            },
            function (go_on) {
                Sync._makeRequest({ url: _SERVICES.streams + path }, function (err, body, _status, xhr) {
                    if (!!err) {
                        return go_on(err);
                    }
                    var links = Sync._getLinksFromHeader({ link: xhr.getResponseHeader("Link") });
                    path = links.next;
                    if (!currentPath && xhr.status !== 204) {
                        currentPath = links.current;
                    }
                    var notes = Sync._syncObjectsAsNotes({ objects: body || [] });
                    Sync._updateLocalNotes({ notes: notes }, go_on);
                });
            },
            function (err) {
                if (!!err) {
                    return cbk(err);
                }
                if (!currentPath) {
                    return cbk();
                }
                Sync.setSingleToken({ key: _TOKEN_KEYS.personal_stream_current_path, value: currentPath }, cbk);
            }
        );
    };
    Sync._startPusher = function (args, cbk) {
        if (!window.Pusher || !!window.Background) {
            return cbk();
        }
        async.auto(
            {
                getAccountId: function (go_on) {
                    Sync._getAccountId({}, go_on);
                },
                getAuthBlock: function (go_on) {
                    Sync.getToken({ key: _TOKEN_KEYS.auth_block }, go_on);
                },
                pusherAlreadyConnected: function (go_on) {
                    var pusher = Sync._pusher;
                    if (!pusher || !pusher.connection) {
                        return go_on();
                    }
                    return go_on(null, pusher.connection !== "disconnected");
                },
                startPusher: [
                    "getAuthBlock",
                    "getAccountId",
                    "pusherAlreadyConnected",
                    function (go_on, res) {
                        if (!!res.pusherAlreadyConnected || !res.getAuthBlock) {
                            return go_on();
                        }
                        var userId = res.getAccountId;
                        if (!userId) {
                            return go_on([0, "Expected user id"]);
                        }
                        var pusher = new Pusher(_PUSHER_KEY, {
                            auth: { headers: { Authorization: "Basic " + res.getAuthBlock, "X-Date": new Date().toISOString() } },
                            authEndpoint: _SERVICES.streams + "/v0/pusher/auth",
                            disableFlash: true,
                            disableStats: true,
                            encrypted: true,
                        });
                        var channel = pusher.subscribe("private-" + userId);
                        ["notes", "stream"].forEach(function (type) {
                            channel.bind(type + "_activity", Events.notifySyncActivity({ type: type }));
                        });
                        pusher.connection.bind("error", Events.receivePusherError);
                        Sync._pusher = pusher;
                        go_on();
                    },
                ],
            },
            cbk
        );
    };
    Sync._syncObjectsAsNotes = function (args) {
        return _(args.objects || [])
            .chain()
            .where({ type: "note" })
            .map(function (n) {
                return _(n).extend({ id: [n.stream_id, n.id].join(":"), object_id: n.id });
            })
            .value();
    };
    Sync._updateLocalNotes = function (args, cbk) {
        if (!Array.isArray(args.notes)) {
            return cbk([0, "Expected notes"]);
        }
        async.each(
            Sync._dataNotesFromSyncNotes({ sync_notes: args.notes }),
            function (note, go_on) {
                Data.updateNote({ note: note }, go_on);
            },
            cbk
        );
    };
    Sync._updateRevsForLocalNotes = function (args, cbk) {
        if (!Array.isArray(args.notes)) {
            return cbk([0, "Expected notes"]);
        }
        async.each(args.notes, Data.updateNoteRev, cbk);
    };
    Sync._updatesFromNotes = function (args) {
        var allowed = { created_at: true, deleted: true, deleted_last_modified: true, id: true, locked: true, locked_last_modified: true, rev: true, stream_id: true, text: true, text_last_modified: true };
        return args.notes.map(function (note) {
            var update = {};
            if (note.text && note.text.length > Data.MAX_NOTE_LENGTH) {
                note.text = note.text.substring(0, Data.MAX_NOTE_LENGTH);
            }
            Object.keys(note).forEach(function (attr) {
                if (!allowed[attr]) {
                    return;
                }
                update[attr] = note[attr];
            });
            _BOOLEAN_NOTE_ATTRIBUTES.forEach(function (attr) {
                if (note[attr] !== undefined) {
                    update[attr] = !!note[attr];
                }
            });
            if (!!note.rev) {
                update.id = note.object_id;
                update.type = "note";
                delete update.created_at;
                delete update.locked;
                delete update.locked_last_modified;
            }
            return update;
        });
    };
    Sync.abortRequests = function (args) {
        _requests.forEach(function (req) {
            if (!!req) {
                req.abort();
            }
        });
    };
    Sync.getAccount = function (args, cbk) {
        async.auto(
            {
                hasAuth: function (go_on) {
                    Sync.getToken({ key: _TOKEN_KEYS.auth_block }, go_on);
                },
                getAccount: [
                    "hasAuth",
                    function (go_on, res) {
                        if (!res.hasAuth) {
                            return go_on();
                        }
                        Sync._makeSimpleRequest({ url: _SERVICES.notes + "/v0/account/" }, go_on);
                    },
                ],
                getStyle: function (go_on) {
                    Client.getSetting({ setting: "style" }, go_on);
                },
                setTokens: [
                    "getAccount",
                    function (go_on, res) {
                        if (!res.getAccount) {
                            return go_on();
                        }
                        var tokens = {};
                        tokens[_TOKEN_KEYS.account_id] = res.getAccount.id;
                        if (Array.isArray(res.getAccount.privs)) {
                            var privsString = res.getAccount.privs.join(" ");
                            tokens[_TOKEN_KEYS.account_privs] = privsString;
                        }
                        Sync.setTokens({ tokens: tokens }, go_on);
                    },
                ],
                updateRemoteSyncOptions: [
                    "setTokens",
                    function (go_on, res) {
                        if (!res.getAccount) {
                            return go_on();
                        }
                        var enabledServices = [];
                        $("#account").data("cached_privs", res.getAccount.privs);
                        $(".style .change_background").removeClass("hidden");
                        _REMOTE_SYNC_SERVICES.forEach(function (service) {
                            var hasService = res.getAccount[service[0]];
                            var serviceOn = !!hasService && hasService.notes_sync;
                            if (serviceOn) {
                                enabledServices.push(service[0]);
                            }
                            Page.setRemoteSync({ service: service, on: serviceOn });
                        });
                        Sync.setSingleToken({ key: _TOKEN_KEYS.enabled_remote_sync_services, value: enabledServices.join(" ") }, go_on);
                    },
                ],
                disablePremiumTheme: [
                    "getAccount",
                    "getStyle",
                    function (go_on, res) {
                        var showingSettings = $("#account").hasClass("options");
                        if (!!showingSettings) {
                            return go_on();
                        }
                        var account = res.getAccount;
                        if (!account) {
                            return go_on();
                        }
                        var privs = account.privs || [];
                        return go_on(null, !_(privs).contains("premium"));
                    },
                ],
                resetBackground: [
                    "disablePremiumTheme",
                    function (go_on, res) {
                        if (!res.disablePremiumTheme) {
                            return go_on();
                        }
                        Page.setBackgroundTheme({ style: res.getStyle, theme: "standard" }, go_on);
                    },
                ],
                resetSavedTheme: [
                    "disablePremiumTheme",
                    function (go_on, res) {
                        if (!res.disablePremiumTheme) {
                            return go_on();
                        }
                        Client.setSetting({ setting: "background_theme", value: "" }, go_on);
                    },
                ],
            },
            function (err, res) {
                if (!!err) {
                    return cbk(err);
                }
                return cbk(null, res.getAccount);
            }
        );
    };
    Sync.getAnonNotice = function (args, cbk) {
        async.auto(
            {
                hasAuth: function (go_on) {
                    if (!!Client.wasLoggedIn) {
                        return go_on(null, true);
                    }
                    Sync.hasAuthIncludingCredentials({}, go_on);
                },
                profile: async.constant(JSON.stringify(Client.profile({}))),
                getUUID: [
                    "hasAuth",
                    function (go_on, res) {
                        if (!!res.hasAuth) {
                            return go_on();
                        }
                        Client.registerUUID({}, go_on);
                    },
                ],
                getNotice: [
                    "getUUID",
                    "hasAuth",
                    "profile",
                    function (go_on, res) {
                        if (!res.getUUID || !!res.hasAuth || !res.profile) {
                            return go_on();
                        }
                        if (!!window.Background) {
                            return go_on();
                        }
                        if (!!_requested_anonymous_notice) {
                            return go_on();
                        }
                        _requested_anonymous_notice = true;
                        $.ajax({
                            beforeSend: function (xhr) {
                                xhr.setRequestHeader("X-User-Profile", res.profile);
                            },
                            dataType: "json",
                            fail: function (xhr) {
                                go_on(xhr);
                            },
                            success: function (notice) {
                                go_on(null, notice);
                            },
                            url: _SERVICES.notices + "/sync/v2/notices/" + res.getUUID,
                        });
                    },
                ],
                registerReceipt: [
                    "getNotice",
                    function (go_on, res) {
                        if (!!res.hasAuth || !res.getNotice || !res.getNotice.id) {
                            return go_on();
                        }
                        $.ajax({
                            accept: "application/json",
                            beforeSend: function (xhr) {
                                xhr.setRequestHeader("X-User-Profile", res.profile);
                            },
                            contentType: "application/json",
                            data: JSON.stringify({ seen: res.getNotice.id }),
                            dataType: "json",
                            fail: function (xhr) {
                                go_on(xhr);
                            },
                            processData: false,
                            statusCode: {
                                "201": function () {
                                    go_on(null, res.getNotice);
                                },
                            },
                            success: function () {
                                go_on();
                            },
                            timeout: 60 * 1000,
                            type: "POST",
                            url: _SERVICES.notices + "/sync/v2/notices/" + res.getUUID,
                        });
                    },
                ],
                alreadyReceivedNotice: [
                    "registerReceipt",
                    function (go_on, res) {
                        if (!res.getNotice || !res.getNotice.id) {
                            return go_on();
                        }
                        Sync.getToken({ key: "notice:" + res.getNotice.id }, go_on);
                    },
                ],
                addNotice: [
                    "alreadyReceivedNotice",
                    function (go_on, res) {
                        if (!!res.hasAuth || !res.registerReceipt) {
                            return go_on();
                        }
                        Page.addAnonNotice(res.registerReceipt, go_on);
                    },
                ],
                cacheNoticeReceived: [
                    "addNotice",
                    function (go_on, res) {
                        if (!res.getNotice || !res.getNotice.id) {
                            return go_on();
                        }
                        Sync.setSingleToken({ key: "notice:" + res.getNotice.id, value: new Date().toISOString() }, go_on);
                    },
                ],
            },
            cbk
        );
    };
    Sync.getAuthenticatingEmailAddress = function (args, cbk) {
        Sync.getToken({ key: _TOKEN_KEYS.auth_block }, function (err, block) {
            if (!!err) {
                return cbk(err);
            }
            if (!block) {
                return cbk(null, "");
            }
            return cbk(null, atob(block).split(":")[0]);
        });
    };
    Sync.getCachedAccountPrivs = function (args, cbk) {
        Sync.getToken({ key: _TOKEN_KEYS.account_privs }, function (err, cachedPrivs) {
            if (!!err) {
                return cbk(err);
            }
            var privs = cachedPrivs || "";
            cbk(
                null,
                privs.split(" ").filter(function (n) {
                    return !!n;
                })
            );
        });
    };
    Sync.getLastSelectedNoteId = function (args, cbk) {
        Sync.getToken({ key: _TOKEN_KEYS.selected_note_id }, cbk);
    };
    Sync.getServiceAuthUrl = function (args, cbk) {
        async.auto(
            {
                getAccountId: function (go_on) {
                    Sync._getAccountId({}, go_on);
                },
                getServiceKey: [
                    "getAccountId",
                    function (go_on, res) {
                        if (!res.getAccountId) {
                            return go_on([0, "Expected id"]);
                        }
                        if (!args.service || !args.service[0]) {
                            return go_on([0, "Expected service"]);
                        }
                        var key = res.getAccountId + ":" + args.service[0] + ":auth_url";
                        go_on(null, key);
                    },
                ],
                getCached: [
                    "getServiceKey",
                    function (go_on, res) {
                        Sync.getToken({ key: res.getServiceKey }, go_on);
                    },
                ],
                getFresh: [
                    "getCached",
                    function (go_on, res) {
                        if (!!res.getCached) {
                            return go_on();
                        }
                        var service = args.service[0];
                        Sync._makeSimpleRequest({ url: _SERVICES.notes + "/v0/authenticate/" + service + "/url" }, go_on);
                    },
                ],
                getFreshURL: [
                    "getFresh",
                    function (go_on, res) {
                        if (!!res.getCached) {
                            return go_on();
                        }
                        if (!res.getFresh || !res.getFresh.url) {
                            return go_on([500, "Expected auth URL from service"]);
                        }
                        return go_on(null, res.getFresh.url);
                    },
                ],
                setCached: [
                    "getFreshURL",
                    function (go_on, res) {
                        if (!res.getFreshURL) {
                            return go_on();
                        }
                        Sync.setSingleToken({ key: res.getServiceKey, expires_ms: _REMOTE_SERVICE_AUTH_TIMEOUT_MS, value: res.getFreshURL }, go_on);
                    },
                ],
            },
            function (err, res) {
                if (!!err) {
                    return cbk(err);
                }
                cbk(null, res.getCached || res.getFreshURL);
            }
        );
    };
    Sync.getToken = function (args, cbk) {
        async.auto(
            {
                getTokenFromChromeStorage: function (go_on) {
                    if (!args.key) {
                        return go_on([0, "Expected key"]);
                    }
                    if (!window.chrome || !chrome.storage) {
                        return go_on();
                    }
                    var storage = chrome.storage[args.store || "local"];
                    if (!storage || !storage.get) {
                        return go_on();
                    }
                    storage.get(args.key, function (items) {
                        return go_on(null, items[args.key]);
                    });
                },
                getLocalToken: [
                    "getTokenFromChromeStorage",
                    function (go_on, res) {
                        if (!!res.getTokenFromChromeStorage) {
                            return go_on();
                        }
                        go_on(null, _tokens[args.key] || localStorage[args.key]);
                    },
                ],
                token: [
                    "getLocalToken",
                    function (go_on, res) {
                        var tok = res.getTokenFromChromeStorage || res.getLocalToken;
                        return go_on(null, tok || null);
                    },
                ],
            },
            function (err, res) {
                if (!!err) {
                    return cbk(err);
                }
                cbk(null, res.token);
            }
        );
    };
    Sync.hasAuthIncludingCredentials = function (args, cbk) {
        var auth = Page.getCredentials({});
        if (!!auth.email && !!auth.password) {
            return cbk(null, true);
        }
        Sync.getToken({ key: _TOKEN_KEYS.auth_block }, function (err, block) {
            if (!!err) {
                return cbk(err);
            }
            return cbk(null, !!block);
        });
    };
    Sync.hasSavedAuth = function (args, cbk) {
        async.auto(
            {
                getAuth: function (go_on) {
                    Sync.getToken({ key: _TOKEN_KEYS.auth_block }, go_on);
                },
            },
            function (err, res) {
                if (!!err) {
                    return cbk(err);
                }
                return cbk(null, !!res.getAuth);
            }
        );
    };
    Sync.isAccountRemoteSyncEnabled = function (args, cbk) {
        Sync.getToken({ key: _TOKEN_KEYS.enabled_remote_sync_services }, function (err, services) {
            if (!!err) {
                return cbk(err);
            }
            var enabledServices = (services || "").split(" ");
            if (!args.service) {
                return cbk([0, "Expected service name"]);
            }
            var isEnabled = _(enabledServices).contains(args.service);
            cbk(null, isEnabled);
        });
    };
    Sync.isValidEmail = function (args) {
        var emailMatch = /^(([^<>()[\]\\.,;:\s@\"]+(\.[^<>()[\]\\.,;:\s@\"]+)*)|(\".+\"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
        return emailMatch.test(args.email);
    };
    Sync.logout = function (args, cbk) {
        async.auto(
            {
                getDirtyNotes: function (go_on) {
                    Data.getDirtyNotes({ limit: 1 }, go_on);
                },
                checkForDataLoss: [
                    "getDirtyNotes",
                    function (go_on, res) {
                        if (!res.getDirtyNotes.length) {
                            return go_on();
                        }
                        Page.showError({ err: { status: "lose_data_warning" } });
                        Sync.pushChanges({}, go_on);
                    },
                ],
                commitLogout: [
                    "getDirtyNotes",
                    function (go_on, res) {
                        if (!!res.getDirtyNotes.length) {
                            return go_on();
                        }
                        Page.logout({}, go_on);
                    },
                ],
            },
            cbk
        );
    };
    Sync.makeStripePurchase = function (args, cbk) {
        async.auto(
            {
                hasSavedAuth: function (go_on) {
                    Sync.hasSavedAuth({}, go_on);
                },
                makePurchase: [
                    "hasSavedAuth",
                    function (go_on, res) {
                        if (!res.hasSavedAuth) {
                            return go_on([401, "Not authed"]);
                        }
                        var card = args.card_token;
                        var priv = args.priv;
                        var path = "/v0/stripe/purchase/" + priv + "/with_card/" + card;
                        Sync._makeRequest({ method: "PUT", url: _SERVICES.auth + path }, go_on);
                    },
                ],
            },
            cbk
        );
    };
    Sync.processPusherError = function (args) {
        var err = args.err;
        if (!err) {
            return Client.log({ err: [0, "Expected pusher error"] });
        }
        var hasCode = !!err.error && !!err.error.data;
        var code = hasCode ? err.error.data.code : null;
        if (!code) {
            return Client.log({ err: err });
        }
        switch (code) {
            case 1006:
                break;
            case 4004:
                Sync._pusher.disconnect();
                Sync._pusher = null;
                break;
            case 4200:
                Sync._pusher.disconnect();
                Sync._pusher = null;
                Sync._startPusher({}, Client.reportErrors({}));
                break;
            default:
                break;
        }
    };
    Sync.purchaseStripeSubscription = function (args, cbk) {
        async.auto(
            {
                validateArguments: function (go_on) {
                    if (!args.card_token || !args.plan) {
                        return go_on([0, "Expected card token, and plan"]);
                    }
                    go_on();
                },
                hasSavedAuth: [
                    "validateArguments",
                    function (go_on, res) {
                        Sync.hasSavedAuth({}, go_on);
                    },
                ],
                makePurchase: [
                    "hasSavedAuth",
                    function (go_on, res) {
                        if (!res.hasSavedAuth) {
                            return go_on([401, "Not authed"]);
                        }
                        var card = args.card_token;
                        var plan = args.plan;
                        var path = "/v0/stripe/subscribe/" + plan + "/with_card/" + card;
                        Sync._makeRequest({ method: "PUT", url: _SERVICES.auth + path }, go_on);
                    },
                ],
            },
            cbk
        );
    };
    Sync.pushChanges = function (args, cbk) {
        var start = new Date().toISOString();
        if (!!Sync._pushingChanges) {
            return cbk();
        }
        Sync._cleanRequests({});
        Sync._pushingChanges = true;
        async.auto(
            {
                hasSavedAuth: function (go_on) {
                    Sync.hasSavedAuth({}, go_on);
                },
                rateLimit: function (go_on) {
                    _(go_on).delay(_MIN_PUSH_CHANGES_TIME_MS);
                },
                getDirtyNotes: [
                    "hasSavedAuth",
                    function (go_on, res) {
                        if (!res.hasSavedAuth) {
                            return go_on(null, []);
                        }
                        if (!!args.rows) {
                            return go_on(null, args.rows);
                        }
                        Data.getDirtyNotes({ before: start }, go_on);
                    },
                ],
                cleanSyncObjects: [
                    "getDirtyNotes",
                    function (go_on, res) {
                        var notes = res.getDirtyNotes || [];
                        Sync._pushUpdates(
                            {
                                notes: notes.filter(function (n) {
                                    return !!n.rev;
                                }),
                                url: _SERVICES.streams + "/v0/activity/",
                            },
                            function (err, results) {
                                var is409 = !!err && err.status === 409;
                                if (is409 && Array.isArray(err.responseJSON)) {
                                    var rows = err.responseJSON;
                                    return go_on(null, { conflict: true, rows: rows });
                                }
                                if (!!err) {
                                    return go_on(err);
                                }
                                return go_on(null, { rows: results || [] });
                            }
                        );
                    },
                ],
                sendDirtyNotes: [
                    "getDirtyNotes",
                    function (go_on, res) {
                        var notes = res.getDirtyNotes || [];
                        Sync._pushUpdates(
                            {
                                notes: notes.filter(function (n) {
                                    return !n.rev;
                                }),
                                omit_date: true,
                                url: _SERVICES.notes + "/v0/notes/",
                            },
                            go_on
                        );
                    },
                ],
                markSyncObjectsClean: [
                    "cleanSyncObjects",
                    function (go_on, res) {
                        if (!!res.cleanSyncObjects.conflict) {
                            return go_on();
                        }
                        var notes = (res.getDirtyNotes || []).filter(function (n) {
                            return !!n.rev;
                        });
                        Data.markAsClean({ dirty_before: start, notes: notes }, go_on);
                    },
                ],
                updateSyncObjects: [
                    "markSyncObjectsClean",
                    function (go_on, res) {
                        var rows = res.cleanSyncObjects.rows;
                        if (!Array.isArray(rows)) {
                            return go_on([0, "Expect rows"]);
                        }
                        var notes = Sync._syncObjectsAsNotes({ objects: rows });
                        if (!res.cleanSyncObjects.conflict) {
                            return Sync._updateLocalNotes({ notes: notes }, go_on);
                        }
                        Sync._updateRevsForLocalNotes({ notes: notes }, go_on);
                    },
                ],
                markDirtyNotesClean: [
                    "updateSyncObjects",
                    "sendDirtyNotes",
                    function (go_on, res) {
                        var notes = (res.getDirtyNotes || []).filter(function (n) {
                            return !n.rev;
                        });
                        if (!notes.length) {
                            return go_on();
                        }
                        Data.markAsClean({ dirty_before: start, notes: notes }, go_on);
                    },
                ],
                getStillDirtyNotes: [
                    "markDirtyNotesClean",
                    function (go_on, res) {
                        Data.getDirtyNotes({ limit: 1 }, go_on);
                    },
                ],
            },
            function (err, res) {
                Sync._pushingChanges = false;
                Sync._cleanRequests({});
                if (!!err) {
                    Sync._processServiceError({ err: err }, function (processErr) {
                        return cbk(processErr || err);
                    });
                    return;
                }
                Page.resetError({});
                if (!!res.getStillDirtyNotes.length) {
                    _(function () {
                        Sync.pushChanges({}, cbk);
                    }).delay(2000);
                    return;
                }
                cbk();
            }
        );
    };
    Sync.refresh = function (args, cbk) {
        if (!!window.Background || !!Sync._freezeRefreshing) {
            return cbk();
        }
        if (!!args.avoid_forced_refresh && !!Sync._refreshing) {
            Sync._refreshAgain = Sync._nextRefreshType({ current_type: Sync._refreshAgain, requested_type: args.type });
            return cbk();
        }
        Sync._refreshing = args.type || "all";
        async.auto(
            {
                skipNotes: async.constant(args.type === "stream"),
                skipStream: async.constant(args.type === "notes"),
                hasAuth: [
                    "skipNotes",
                    "skipStream",
                    function (go_on, res) {
                        Sync.hasAuthIncludingCredentials({}, go_on);
                    },
                ],
                getCurrentNotesPath: [
                    "hasAuth",
                    function (go_on, res) {
                        if (!res.hasAuth || !!res.skipNotes) {
                            return go_on();
                        }
                        Sync.getToken({ key: _TOKEN_KEYS.notes_current_path }, go_on);
                    },
                ],
                setAuthorizing: [
                    "hasAuth",
                    function (go_on, res) {
                        if (!res.hasAuth) {
                            return go_on();
                        }
                        Page.showAuthorizingIndicator({}, go_on);
                    },
                ],
                getNotes: [
                    "getCurrentNotesPath",
                    function (go_on, res) {
                        if (!res.hasAuth || !!res.skipNotes) {
                            return go_on();
                        }
                        Sync._refreshNotesFromPath({ path: res.getCurrentNotesPath || "/v0/notes/" }, go_on);
                    },
                ],
                getCurrentPersonalStreamPath: [
                    "getNotes",
                    function (go_on, res) {
                        if (!res.hasAuth || !!res.skipStream) {
                            return go_on();
                        }
                        Sync.getToken({ key: _TOKEN_KEYS.personal_stream_current_path }, go_on);
                    },
                ],
                getPersonalStreamPath: [
                    "getCurrentPersonalStreamPath",
                    function (go_on, res) {
                        if (!res.hasAuth || !!res.skipStream) {
                            return go_on();
                        }
                        var current = res.getCurrentPersonalStreamPath;
                        if (!!current) {
                            return go_on(null, current);
                        }
                        Sync._getPersonalStreamPath({}, go_on);
                    },
                ],
                getSyncObjectsFromPersonalStream: [
                    "getPersonalStreamPath",
                    function (go_on, res) {
                        if (!res.hasAuth || !!res.skipStream) {
                            return go_on();
                        }
                        var path = res.getPersonalStreamPath;
                        if (!path) {
                            return go_on();
                        }
                        Sync._refreshSyncObjectsFromPath({ path: path }, go_on);
                    },
                ],
            },
            function (err) {
                Sync._refreshing = "";
                var refreshAgainType = Sync._refreshAgain;
                Sync._refreshAgain = null;
                if (!!err) {
                    return cbk(err);
                }
                if (!!refreshAgainType) {
                    setTimeout(function () {
                        Sync.refresh({ type: refreshAgainType }, cbk);
                    }, 1000);
                    return;
                }
                cbk();
            }
        );
    };
    Sync.remoteAuth = function (args, cbk) {
        async.auto(
            {
                getAccountId: function (go_on) {
                    Sync._getAccountId({}, go_on);
                },
                openAuthWindow: function (go_on) {
                    var oauth = args.window || window.open();
                    go_on(null, oauth);
                },
                getAuthURL: [
                    "openAuthWindow",
                    function (go_on, res) {
                        Sync.getServiceAuthUrl({ service: args.service }, go_on);
                    },
                ],
                waitForAuthCompletion: [
                    "getAccountId",
                    "getAuthURL",
                    function (go_on, res) {
                        if (!res.getAuthURL) {
                            return go_on([500, "Expected URL"]);
                        }
                        res.openAuthWindow.location = res.getAuthURL;
                        var checkOAuth = setInterval(function () {
                            if (!res.openAuthWindow.closed) {
                                return;
                            }
                            clearInterval(checkOAuth);
                            var key = res.getAccountId + ":" + args.service[0] + ":auth_url";
                            Sync.setSingleToken({ key: key, value: "" }, go_on);
                        }, 150);
                    },
                ],
            },
            function (err, res) {
                if (!!err) {
                    res.openAuthWindow.close();
                    return cbk(err);
                }
                cbk();
            }
        );
    };
    Sync.reset = function (args, cbk) {
        Sync._freezeRefreshing = false;
        Sync.abortRequests({});
        _tokens = {};
        if (!!Sync._pusher) {
            Sync._pusher.disconnect();
            Sync._pusher = null;
        }
        cbk();
    };
    Sync.resetUserDetails = function (args, cbk) {
        var tokens = {};
        Object.keys(_TOKEN_KEYS).forEach(function (key) {
            tokens[_TOKEN_KEYS[key]] = "";
        });
        Sync.setTokens({ tokens: tokens }, cbk);
    };
    Sync.setLastSelectedNoteId = function (args, cbk) {
        if (!args.id) {
            return cbk([0, "Expected selected note id"]);
        }
        Sync.setSingleToken({ key: _TOKEN_KEYS.selected_note_id, value: args.id }, cbk);
    };
    Sync.setSingleToken = function (args, cbk) {
        if (!args.key) {
            return cbk([0, "Expected key"]);
        }
        var tokens = {};
        tokens[args.key] = args.value;
        if (!!args.expires_ms) {
            _(function () {
                Sync.setSingleToken({ key: args.key, value: "" }, Client.reportErrors({}));
            }).delay(args.expires_ms);
        }
        Sync.setTokens({ tokens: tokens }, cbk);
    };
    Sync.setTokens = function (args, cbk) {
        cbk = cbk || function () {};
        if (!args.tokens) {
            return cbk([0, "Invalid arguments", args]);
        }
        if (!Client.isChromeApp()) {
            Object.keys(args.tokens).forEach(function (key) {
                _tokens[key] = args.tokens[key];
                try {
                    localStorage[key] = args.tokens[key];
                } catch (e) {
                    return cbk(e);
                }
            });
            return cbk();
        }
        chrome.storage[args.store || "local"].set(args.tokens, function () {
            var chromeErr = chrome.runtime.lastError;
            if (!!chromeErr) {
                return cbk(chromeErr);
            }
            cbk();
        });
    };
    Sync.shareNoteByEmail = function (args, cbk) {
        async.auto(
            {
                hasSavedAuth: function (go_on) {
                    Sync.hasSavedAuth({}, go_on);
                },
                sendMessage: [
                    "hasSavedAuth",
                    function (go_on, res) {
                        if (!res.hasSavedAuth) {
                            return go_on([401, "Not authed"]);
                        }
                        Sync._makeRequest({ json: { app: "mn", object: { text: args.text, type: "note" }, send_to: args.send_to }, method: "POST", url: _SERVICES.messages + "/v0/email/share_object/" }, go_on);
                    },
                ],
            },
            cbk
        );
    };
    Sync.start = function (args, cbk) {
        async.auto(
            {
                hasAuthCredentials: function (go_on) {
                    Sync.hasAuthIncludingCredentials({}, go_on);
                },
                showAuthorizing: [
                    "hasAuthCredentials",
                    function (go_on, res) {
                        if (!res.hasAuthCredentials) {
                            return go_on();
                        }
                        Page.showAuthorizingIndicator({}, go_on);
                    },
                ],
                register: [
                    "hasAuthCredentials",
                    function (go_on, res) {
                        if (!args.register || !res.hasAuthCredentials) {
                            return go_on();
                        }
                        Sync._makeRequest({ body: "[]", method: "POST", url: _SERVICES.notes + "/v0/notes/" }, go_on);
                    },
                ],
                getAccount: [
                    "register",
                    function (go_on, res) {
                        if (!res.hasAuthCredentials) {
                            return go_on();
                        }
                        Sync.getAccount({}, go_on);
                    },
                ],
                getNotes: [
                    "register",
                    function (go_on, res) {
                        if (!res.hasAuthCredentials) {
                            return go_on();
                        }
                        Sync.refresh({}, go_on);
                    },
                ],
                pushChanges: [
                    "getNotes",
                    function (go_on, res) {
                        if (!res.hasAuthCredentials) {
                            return go_on();
                        }
                        Sync.pushChanges({}, go_on);
                    },
                ],
                connectToPusher: [
                    "pushChanges",
                    function (go_on, res) {
                        if (!res.hasAuthCredentials) {
                            return go_on();
                        }
                        Sync._startPusher({}, go_on);
                    },
                ],
            },
            cbk
        );
    };
    Sync.startRemoteSync = function (args, cbk) {
        if (!Array.isArray(args.service)) {
            return cbk([0, "Expected arr"]);
        }
        async.auto(
            {
                abortReqs: function (go_on) {
                    Sync.abortRequests({});
                    go_on();
                },
                path: async.constant("/v0/" + args.service.join("/") + "/notes"),
                updateRemoteSyncStatus: function (go_on) {
                    Page.setRemoteSync({ service: args.service }, go_on);
                },
                enableRemoteSync: [
                    "abortReqs",
                    "path",
                    function (go_on, res) {
                        Sync._freezeRefreshing = true;
                        Sync._makeSimpleRequest({ method: "PUT", url: _SERVICES.notes + res.path }, go_on);
                    },
                ],
                showRemoteSyncOn: [
                    "enableRemoteSync",
                    function (go_on, res) {
                        Page.setRemoteSync({ on: true, service: args.service });
                        go_on();
                    },
                ],
                refreshAccount: [
                    "showRemoteSyncOn",
                    function (go_on, res) {
                        Sync.getAccount({}, go_on);
                    },
                ],
                delayForSync: [
                    "enableRemoteSync",
                    function (go_on, res) {
                        _(go_on).delay(30 * 1000);
                    },
                ],
                refreshNotes: [
                    "refreshAccount",
                    function (go_on, res) {
                        Sync._freezeRefreshing = false;
                        Sync.refresh({ type: "notes" }, go_on);
                    },
                ],
            },
            function (err) {
                if (!!err) {
                    Sync._freezeRefreshing = false;
                    Page.setRemoteSync({ on: false, service: args.service });
                    return cbk();
                }
                cbk();
            }
        );
    };
    Sync.stopRemoteSync = function (args) {
        Page.setRemoteSync({ service: args.service });
        Client.track({ path: "account/" + args.service.join("_") + "/off" });
        Sync.abortRequests();
        Sync._makeRequest({ method: "DELETE", url: _SERVICES.notes + "/v0/" + args.service.join("/") + "/notes" }, function (err) {
            Page.setRemoteSync({ on: !!err, service: args.service });
            Sync.getAccount({}, Client.reportErrors({}));
        });
    };
    Sync.toggleRemoteSync = function (args) {
        if (!args.on) {
            return Sync.stopRemoteSync({ service: args.service });
        }
        Sync.remoteAuth({ service: args.service, window: args.window }, function (err) {
            if (!!err) {
                return Client.log({ err: err });
            }
            Sync.startRemoteSync({ service: args.service }, Client.reportErrors({}));
        });
    };
    Sync.triggerPasswordReset = function (args) {
        var email = $("#email .email").val();
        if (!Sync.isValidEmail({ email: email })) {
            return;
        }
        var url = _SERVICES.account + "/sync/v2/reset_password";
        $.get(url + "?email=" + encodeURIComponent(email));
        Page.showError({ err: { status: "password_reset_sent" } });
        Client.track({ path: "account/authenticate/reset" });
    };
    Sync.updateLocalToken = function (args, cbk) {
        _tokens = {};
        cbk();
    };
})();
