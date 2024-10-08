var App = {};
var _gaq = _gaq || [];
_gaq.push(["_setAccount", "UA-52361-15"]);
_gaq.push(["_trackPageview"]);
(function () {
    App._start = function (args, cbk) {
        async.auto(
            {
                getVersion: function (go_on) {
                    $.getJSON("/manifest.json", function (manifest) {
                        var v = null;
                        try {
                            v = manifest.version;
                        } catch (e) {}
                        if (!v) {
                            Client.log({ err: [0, "Expected version"] });
                        }
                        App.version = v;
                        go_on();
                    });
                },
                initClient: function (go_on) {
                    Client.init({}, go_on);
                },
                initDb: function (go_on) {
                    Data.start({}, go_on);
                },
                initEvents: function (go_on) {
                    Events.init({}, go_on);
                },
                initPage: [
                    "initDb",
                    function (go_on, res) {
                        Page.init({}, go_on);
                    },
                ],
                initSync: [
                    "initDb",
                    function (go_on, res) {
                        Sync.start({}, Client.reportErrors({}));
                        go_on();
                    },
                ],
            },
            cbk
        );
    };
})();
$(function () {
    App._start({}, function (err) {
        if (!!err) {
            return Page.showFatalStartError({ err: err });
        }
    });
});
