var Client = {};
(function () {
    var _IGNORE_STATUSES = ["abort", "error", "updating"];
    Client._ANALYTICS_SERVICE = "memo_notepad";
    Client._ANALYTICS_TRACKER = "UA-52361-15";
    Client._ANALYTICS_URL = "https://ssl.google-analytics.com/ga.js";
    Client.SAVE_TYPING_TIMEOUT_MS = 100;
    Client.saveTyping = null;
    Client._getChromeStorageValue = function (args, cbk) {
        if (!args.key) {
            return cbk([0, "Expected key for chrome storage"]);
        }
        if (!window.chrome) {
            return cbk();
        }
        if (!chrome.storage || !chrome.storage.sync) {
            return cbk();
        }
        chrome.storage.sync.get(args.key, function (res) {
            if (!res) {
                return cbk();
            }
            cbk(null, res.uuid || null);
        });
    };
    Client._hasChromeStorage = function (args) {
        return !!window.chrome && !!chrome.storage;
    };
    Client._registerValue = function (args, cbk) {
        if (!Client.isChromeApp({})) {
            try {
                localStorage[args.key] = args.value;
            } catch (e) {
                return cbk();
            }
        }
        if (Client._hasChromeStorage({})) {
            var items = {};
            items[args.key] = args.value;
            chrome.storage.sync.set(items, function () {
                var chromeErr = chrome.runtime.lastError;
                if (!!chromeErr) {
                    return cbk(chromeErr);
                }
                cbk(null, args.value);
            });
            return;
        }
        cbk(null, args.value);
    };
    Client.analytics = function (args) {
        if (!!window.Background) {
            return;
        }
        if (Client.isChromeApp({}) && !!window.analytics) {
            Client._tracker = analytics.getService(Client._ANALYTICS_SERVICE).getTracker(Client._ANALYTICS_TRACKER);
            return;
        }
        Page.addScript({ url: Client._ANALYTICS_URL });
    };
    Client.clearStorage = function (args, cbk) {
        async.auto(
            {
                getUUID: function (go_on) {
                    var domId = $("#account").data("client-uuid");
                    if (!!domId) {
                        return go_on(null, domId);
                    }
                    Sync.getToken({ key: "uuid" }, go_on);
                },
                clearLocalStorage: [
                    "getUUID",
                    function (go_on, res) {
                        if (!!Client.isChromeApp({})) {
                            return go_on();
                        }
                        localStorage.clear();
                        return go_on();
                    },
                ],
                clearChromeLocalStorage: [
                    "getUUID",
                    function (go_on, res) {
                        if (!window.chrome || !chrome.storage) {
                            return go_on();
                        }
                        chrome.storage.local.clear(go_on);
                    },
                ],
                clearChromeSyncStorage: [
                    "getUUID",
                    function (go_on, res) {
                        if (!window.chrome || !chrome.storage) {
                            return go_on();
                        }
                        chrome.storage.sync.clear(go_on);
                    },
                ],
                reinstateUUID: [
                    "clearChromeLocalStorage",
                    "clearChromeSyncStorage",
                    "clearLocalStorage",
                    function (go_on, res) {
                        if (!res.getUUID || !!args.clear_uuid) {
                            return go_on();
                        }
                        Sync.setSingleToken({ key: "uuid", value: res.getUUID }, go_on);
                    },
                ],
            },
            function (err) {
                if (!!err) {
                    Client.log({ err: err });
                }
                cbk(err);
            }
        );
    };
    Client.getSetting = function (args, cbk) {
        if (!args.setting) {
            return cbk([0, "Expected setting"]);
        }
        if (Client._hasChromeStorage({})) {
            chrome.storage.sync.get(args.setting, function (res) {
                cbk(null, res[args.setting]);
            });
            return;
        } else if (!Client.isChromeApp({})) {
            return cbk(null, localStorage[args.setting]);
        }
        return cbk();
    };
    Client.hasChromeAppDetails = function (args) {
        return !!window && !!window.chrome && !!window.chrome.app && !!window.chrome.app.getDetails && !!window.chrome.app.getDetails();
    };
    Client.init = function (args, cbk) {
        async.auto(
            {
                getBackground: function (go_on) {
                    Client.getSetting({ setting: "background_theme" }, go_on);
                },
                getSize: function (go_on) {
                    Client.getSetting({ setting: "font_size" }, go_on);
                },
                getStyle: function (go_on) {
                    Client.getSetting({ setting: "style" }, go_on);
                },
                startAnalytics: function (go_on) {
                    go_on(null, Client.analytics());
                },
                setBackground: [
                    "getBackground",
                    function (go_on, res) {
                        Page.setBackgroundTheme({ theme: res.getBackground || "standard" }, go_on);
                    },
                ],
                setSize: [
                    "getSize",
                    function (go_on, res) {
                        go_on(null, Page.setFontSize({ size: res.getSize }));
                    },
                ],
                setStyle: [
                    "getStyle",
                    "setBackground",
                    function (go_on, res) {
                        go_on(null, Page.setStyle({ style: res.getStyle }));
                    },
                ],
            },
            cbk
        );
    };
    Client.isChromeApp = function (args) {
        return !!(window.chrome && chrome.app && chrome.app.runtime && chrome.app.runtime.onLaunched);
    };
    Client.log = function (args) {
        var supportsConsole = !!window.console && !!window.console.log;
        if (!supportsConsole) {
            return;
        }
        var err = args.err || {};
        var statusCode = err.status || 0;
        var statusText = err.statusText || "";
        if (statusCode === 0 && _(_IGNORE_STATUSES).contains(statusText)) {
            return;
        }
        if (!!args.err) {
            console.log(args.err);
        }
        if (!!args.err && !!args.err.status) {
            var path = ["error", args.path || "unknown", args.err.status, args.err.statusText || ""];
            return console.log(path.join("/"));
        }
        if (!!args.path) {
            console.log(args.path);
        }
        if (!!args.err) {
            var e = new Error();
            console.log(e.stack);
        }
    };
    Client.profile = function (args) {
        var platform = !!Client.hasChromeAppDetails() ? "Chrome" : "Web";
        var profile = { app: "mn", count: {} };
        profile.version = "MN_" + platform + "/" + (App.version || "0");
        var notes = $("#stacks .stack").not(".notice").not(".empty");
        profile.count.notes_visible = notes.length;
        return profile;
    };
    Client.registerUUID = function (args, cbk) {
        var domUUID = $("#account").data("client-uuid");
        if (domUUID) {
            return cbk(null, domUUID);
        }
        async.auto(
            {
                getChromeStorageValue: function (go_on) {
                    Client._getChromeStorageValue({ key: "uuid" }, go_on);
                },
                getLocalValue: function (go_on) {
                    if (Client.isChromeApp({})) {
                        return go_on();
                    }
                    return go_on(null, localStorage.uuid || null);
                },
                registerUUID: [
                    "getChromeStorageValue",
                    "getLocalValue",
                    function (go_on, res) {
                        var id = res.getChromeStorageValue || res.getLocalValue;
                        if (!!id && id !== "undefined") {
                            return go_on(null, id);
                        }
                        var key = "uuid";
                        Client._registerValue({ key: key, value: Data.uuid() }, go_on);
                    },
                ],
            },
            function (err, res) {
                $("#account").data("client-uuid", res.registerUUID);
                return !!err ? cbk(err) : cbk(null, res.registerUUID);
            }
        );
    };
    Client.reportErrors = function (args) {
        return function (err) {
            if (!!err) {
                return Client.log({ err: err });
            }
        };
    };
    Client.setSetting = function (args, cbk) {
        if (!args.setting) {
            return cbk([0, "Expected setting"]);
        }
        var val = args.value;
        if (!!window.chrome && !!chrome.storage && !!chrome.storage.sync) {
            var item = {};
            item[args.setting] = val;
            chrome.storage.sync.set(item, function () {
                var chromeErr = chrome.runtime.lastError;
                if (!!chromeErr) {
                    return cbk(chromeErr);
                }
                cbk(null, val);
            });
            return;
        }
        if (!Client.isChromeApp()) {
            try {
                localStorage[args.setting] = val;
                cbk(null, val);
                return;
            } catch (e) {}
        }
        cbk();
    };
    Client.track = function (args) {
        try {
            var e = ["_trackEvent"].concat(args.path.split("/"));
            if (!Client._tracker) {
                return _gaq.push(e);
            }
            Client._tracker.sendEvent(e[0], e[1], e[2]);
        } catch (e) {
            Client.log({ err: e });
        }
    };
})();
