var Page = {};
(function () {
    var _DEFAULT_FONT_STYLE = "standard";
    var _FONT_SIZES = [0, 1, 2];
    var _STRIPE_CHECKOUT_LIBRARY = "https://checkout.stripe.com/checkout.js";
    Page._authFail = function (args) {
        Page._syncStop({});
        Page.setAuthError({ code: args.code });
    };
    Page._createOrUpdateListingForNote = function (args, cbk) {
        if (!args.id) {
            return cbk([0, "Expected note id for listing"]);
        }
        async.auto(
            {
                getNote: function (go_on) {
                    Data.getNote({ id: args.id }, go_on);
                },
                createOrUpdateListing: [
                    "getNote",
                    function (go_on, res) {
                        var id = args.id;
                        var note = res.getNote;
                        if (!note) {
                            return go_on();
                        }
                        var existing;
                        var existingNodes = Page._noteListingElementsById({ id: id });
                        var isHidden = Data.isHiddenNote({ note: note });
                        var isNotice = note.destination !== undefined;
                        var isSelected = id === Page.getSelectedNoteId({});
                        var listingTitle;
                        var noteText = isSelected ? Page.getNoteText({}) : note.text;
                        var titleText = Page.titleFromNoteText({ text: noteText || "" });
                        if (!isSelected && isHidden) {
                            return go_on();
                        }
                        if (!!existingNodes.length) {
                            existing = $(existingNodes[0]);
                        }
                        var listing = existing || $('<li class="row"></li>');
                        if (!existing) {
                            listingTitle = $('<span class="span12 title"></span>');
                            listing.append(listingTitle);
                        } else {
                            listingTitle = listing.find(".title");
                        }
                        listingTitle.text(titleText);
                        listing.addClass("stack").data("id", id).data("lm", note.text_last_modified).removeClass("highlight").toggleClass("empty", isHidden).toggleClass("notice", isNotice).toggleClass("selected", isSelected);
                        if (!!existing) {
                            return go_on();
                        }
                        return go_on(null, listing);
                    },
                ],
                insertListing: [
                    "createOrUpdateListing",
                    function (go_on, res) {
                        var note = res.getNote;
                        if (!res.createOrUpdateListing || !note) {
                            return go_on();
                        }
                        var id = args.id;
                        var listing = res.createOrUpdateListing;
                        if (!!Page._noteListingElementsById({ id: id }).length) {
                            return go_on();
                        }
                        listing.click(Events.clickNoteStack);
                        var isSelected = id === Page.getSelectedNoteId({});
                        if (!isSelected && !!Data.isHiddenNote({ note: note })) {
                            return go_on();
                        }
                        Page._insertListingInSortedList({ listing: listing, note: note });
                        if (!!args.skip_animation) {
                            listing.addClass("added");
                        }
                        setTimeout(function () {
                            listing.addClass("added");
                        }, 20);
                        go_on();
                    },
                ],
            },
            cbk
        );
    };
    Page._insertListingInSortedList = function (args) {
        var olderNode;
        $("#stacks .stack").each(function () {
            if (!!olderNode) {
                return;
            }
            if (args.note.text_last_modified < $(this).data("lm")) {
                return;
            }
            olderNode = $(this);
        });
        if (!olderNode) {
            return $("#stacks").append(args.listing);
        }
        if (!!args.adjust_position && Math.abs(args.listing.index() - olderNode.index()) < 2) {
            return;
        }
        $(args.listing).insertBefore(olderNode);
        if (Page.getSelectedNoteId({}) === args.note.id) {
            return;
        }
        $(args.listing).removeClass("added");
        setTimeout(function () {
            args.listing.addClass("added");
        }, 20);
    };
    Page._linkify = function (args) {
        return linkify(args.text).replace(/\n/gim, "<br>");
    };
    Page._loadTests = function (args) {
        Page.addScript({ url: "/js/tests/tests.js" });
    };
    Page._logoutRestart = function (args, cbk) {
        async.auto(
            {
                resetSync: function (go_on) {
                    Sync.reset({}, go_on);
                },
                clearDatabase: [
                    "resetSync",
                    function (go_on, res) {
                        Data.logout({}, go_on);
                    },
                ],
                restartDatabase: [
                    "clearDatabase",
                    function (go_on, res) {
                        Data.start({}, go_on);
                    },
                ],
                restartPage: [
                    "restartDatabase",
                    function (go_on, res) {
                        Page.start({ restart: true }, go_on);
                    },
                ],
            },
            cbk
        );
    };
    Page._noteListingElementsById = function (args) {
        return $("#stacks .stack").filter(function (i, n) {
            return $(n).data("id") === args.id;
        });
    };
    Page._noteTime = function (args, cbk) {
        cbk = cbk || function () {};
        var display = $("#metadata .date .value");
        if (args.text === "") {
            display.text("");
            return cbk();
        }
        var language = navigator.language.toLowerCase();
        try {
            moment.lang(language);
        } catch (e) {
            try {
                moment.lang(language.split("-")[0]);
            } catch (e) {
                moment.lang("en");
            }
        }
        moment.calendar = { lastDay: "dddd LT", lastWeek: "dddd", nextDay: "LT", nextWeek: "LT", sameDay: "LT", sameElse: "MMM D" };
        display.text(moment(args.text_last_modified).calendar());
        return cbk();
    };
    Page._purchasePremiumSubscriptionWithCardToken = function (args) {
        async.auto(
            {
                validateArguments: function (go_on) {
                    if (!args.card_token || !args.plan || !args.purchase_button) {
                        return go_on([0, "Expected card, plan, purchase button"]);
                    }
                    go_on();
                },
                indicateLoading: [
                    "validateArguments",
                    function (go_on, res) {
                        args.purchase_button.button("loading");
                        go_on();
                    },
                ],
                initiatePurchase: [
                    "indicateLoading",
                    function (go_on, res) {
                        Sync.purchaseStripeSubscription({ card_token: args.card_token, plan: args.plan }, go_on);
                    },
                ],
                refreshAccount: [
                    "initiatePurchase",
                    function (go_on, res) {
                        Page._trackPurchaseState({ state: "success" });
                        Sync.getAccount({}, go_on);
                    },
                ],
            },
            function (err, res) {
                if (!!err && !!args.purchase_button) {
                    args.purchase_button.button("error");
                }
                if (!!err) {
                    Page._trackPurchaseState({ state: "fail" });
                    return Client.log({ err: err });
                }
                $("#account").removeClass("dropbox_sync_info google_drive_sync_info");
                Page._togglePurchasePremiumBackgroundButton({ on: false });
                $("#premium").modal("hide");
            }
        );
    };
    Page._scrollIntoView = function (args) {
        if (!args.element || !args.element.scrollIntoView) {
            return;
        }
        var container = $(args.container);
        var element = $(args.element);
        var bottomOfContainer = container.offset().top + container.height();
        var bottomOfElement = element.offset().top + element.height();
        var elementHiddenAbove = container.scrollTop() > bottomOfElement;
        var elementHiddenBelow = bottomOfElement > bottomOfContainer;
        if (elementHiddenAbove || elementHiddenBelow) {
            var previousScrollTop = container.scrollTop();
            args.element.scrollIntoView();
            var finalScrollTop = container.scrollTop();
            container.scrollTop(previousScrollTop);
            container.animate({ scrollTop: finalScrollTop }, 200);
        }
    };
    Page._selectedNoteListing = function (args) {
        return Page._noteListingElementsById({ id: Page.getSelectedNoteId({}) });
    };
    Page._selectNextListing = function (args) {
        var listing = Page._selectedNoteListing({});
        var next = listing.next(".stack:not(.empty)");
        if (!!next.length) {
            return next.click();
        }
        var prev = listing.prev(".stack:not(.empty)");
        if (!!prev.length) {
            return prev.click();
        }
        return;
    };
    Page._showSearchResults = function (args, cbk) {
        var miss = "searchMiss";
        if (!!args.show_all) {
            return cbk(null, $("#stacks ." + miss).removeClass(miss));
        }
        if (!!args.show_single) {
            $("#stacks .stack").each(function (i, n) {
                var id = $(n).data("id");
                if (id !== args.show_single) {
                    return;
                }
                $(n).removeClass(miss);
            });
            return cbk();
        }
        var notesById = _(args.notes).indexBy("id");
        $("#stacks .stack").each(function (i, n) {
            var id = $(n).data("id");
            var isEmpty = $(n).is(".empty");
            var isSearchMiss = !notesById[id] && !isEmpty;
            $(n).toggleClass(miss, isSearchMiss);
        });
        cbk();
    };
    Page._softLogoutRestart = function (args, cbk) {
        async.auto(
            {
                resetSync: function (go_on) {
                    Sync.reset({}, go_on);
                },
                resetSyncObjects: function (go_on) {
                    Data.wipeSyncObjects({}, go_on);
                },
                restartPage: [
                    "resetSync",
                    "resetSyncObjects",
                    function (go_on, res) {
                        Page.start({}, go_on);
                    },
                ],
            },
            cbk
        );
    };
    Page._syncStop = function (args) {
        $("#account, #user").removeClass("authorized authorizing error");
    };
    Page._togglePurchasePremiumBackgroundButton = function (args) {
        var borderWidth = !!args.on ? "1px" : "0";
        var height = !!args.on ? "40px" : "0";
        var marginTop = !!args.on ? "6px" : "0";
        $("#premium_background").css({ "border-width": borderWidth, height: height, "margin-top": marginTop });
    };
    Page._trackPurchaseState = function (args) {
        Client.track({ path: ["purchase", args.product_key, args.state].join("/") });
    };
    Page._trashNote = function (args, cbk) {
        async.auto(
            {
                selectedNoteId: async.constant(Page.getSelectedNoteId({})),
                getNote: [
                    "selectedNoteId",
                    function (go_on, res) {
                        if (!res.selectedNoteId) {
                            return go_on([0, "Expected id"]);
                        }
                        Data.getNote({ id: res.selectedNoteId }, go_on);
                    },
                ],
                getOlderNote: [
                    "getNote",
                    function (go_on, res) {
                        if (!res.getNote) {
                            return go_on([0, "Expected note"]);
                        }
                        Data.getNextNote({ before: res.getNote.text_last_modified, exclude_id: Page.getSelectedNoteId({}) }, go_on);
                    },
                ],
                getNewerNote: [
                    "getNote",
                    "getOlderNote",
                    function (go_on, res) {
                        if (res.getOlderNote !== undefined) {
                            return go_on();
                        }
                        Data.getNextNote({ after: res.getNote.text_last_modified, exclude_id: Page.getSelectedNoteId({}) }, go_on);
                    },
                ],
                createNewNote: [
                    "getNewerNote",
                    "getNote",
                    "getOlderNote",
                    function (go_on, res) {
                        if (!!res.getOlderNote || !!res.getNewerNote) {
                            return go_on();
                        }
                        if (res.getNote.text === "" && !res.getNote.deleted) {
                            return go_on();
                        }
                        Data.addNote({}, go_on);
                    },
                ],
                noteToSwitchTo: [
                    "createNewNote",
                    "getNewerNote",
                    "getNote",
                    "getOlderNote",
                    function (go_on, res) {
                        var next = res.getOlderNote || res.getNewerNote;
                        return go_on(null, next || res.createNewNote || res.getNote);
                    },
                ],
                animateSelection: [
                    "noteToSwitchTo",
                    function (go_on, res) {
                        if (!!res.createNewNote) {
                            return go_on();
                        }
                        Page._noteListingElementsById({ id: res.selectedNoteId }).addClass("removed");
                        Page._noteListingElementsById({ id: res.noteToSwitchTo.id }).addClass("selected");
                        setTimeout(go_on, 200);
                    },
                ],
                reuseExisting: [
                    "getNote",
                    "noteToSwitchTo",
                    function (go_on, res) {
                        var reusedExisting = res.noteToSwitchTo.id === res.getNote.id;
                        go_on(null, reusedExisting);
                    },
                ],
                eliminateRemoved: [
                    "animateSelection",
                    function (go_on, res) {
                        if (!!res.reuseExisting) {
                            return go_on();
                        }
                        Page._noteListingElementsById({ id: res.selectedNoteId }).remove();
                        go_on();
                    },
                ],
                commitDeletion: [
                    "animateSelection",
                    "reuseExisting",
                    function (go_on, res) {
                        if (!!res.reuseExisting) {
                            return go_on();
                        }
                        Data.deleteNoteById({ id: res.getNote.id }, go_on);
                    },
                ],
                showNewNote: [
                    "animateSelection",
                    "reuseExisting",
                    function (go_on, res) {
                        if (!!res.reuseExisting) {
                            return go_on();
                        }
                        Page.selectNote({ id: res.noteToSwitchTo.id }, go_on);
                    },
                ],
            },
            cbk
        );
    };
    Page._typedRecentlyInNotes = function (args) {
        var lastTyped = $("#notes").data("last_typing");
        var msSinceLastTyped = new Date().getTime() - Date.parse(lastTyped);
        return msSinceLastTyped < Client.SAVE_TYPING_TIMEOUT_MS * 50;
    };
    Page.addAnonNotice = function (args, cbk) {
        cbk = cbk || function () {};
        if (!args.id || !args.content) {
            return cbk();
        }
        async.auto(
            {
                addNotice: function (go_on) {
                    Data.addNote({ destination: args.destination, destination_icon: args.destination_icon, id: Data.uuid({}), text: args.content }, go_on);
                },
                updateStacks: [
                    "addNotice",
                    function (go_on, res) {
                        if (!!res.getExistingNote) {
                            return go_on();
                        }
                        Client.track({ path: "notices/received/" + args.id });
                        Page._createOrUpdateListingForNote({ id: res.addNotice.id }, go_on);
                    },
                ],
            },
            cbk
        );
    };
    Page.addNewNote = function (args, cbk) {
        async.auto(
            {
                hideSearch: function (go_on) {
                    Page.hideSearch({}, go_on);
                },
                save: function (go_on) {
                    Page.save({}, go_on);
                },
                scrollNoteListingToTop: function (go_on) {
                    $("#stacks").animate({ scrollTop: 0 }, 200);
                    go_on();
                },
                stopSaving: function (go_on) {
                    clearTimeout(Client.saveTyping);
                    go_on();
                },
                addNote: [
                    "save",
                    function (go_on, res) {
                        $("#stacks .selected").removeClass("selected");
                        $("#stacks .highlight").removeClass("highlight");
                        Data.addNote({ text: args.text }, go_on);
                    },
                ],
                showNote: [
                    "addNote",
                    function (go_on, res) {
                        Client.track({ path: "stacks/new" });
                        Page.selectNote({ id: res.addNote.id }, go_on);
                    },
                ],
                showNoteListing: [
                    "showNote",
                    function (go_on, res) {
                        Page._createOrUpdateListingForNote({ id: res.addNote.id }, go_on);
                    },
                ],
            },
            cbk
        );
    };
    Page.addRemoteSyncInfoNote = function (args, cbk) {
        if (!args.service) {
            return cbk([0, "Expected remote sync service"]);
        }
        async.auto(
            {
                dropbox: async.constant([
                    "Memo Notepad: Dropbox Sync",
                    "",
                    "Dropbox sync keeps your notes in sync with your Dropbox.",
                    "",
                    "Every time you add or edit a note on Memo Notepad, it will sync to Dropbox.",
                    "",
                    "If you add or edit a note on Dropbox, it will also sync back to Memo Notepad.",
                    "",
                    "Tips:",
                    "1. You can save txt files in your Memo Notepad director to add new notes.",
                    "2. All notes are saved to your Dropbox folder as plain .txt files.",
                    "3. You can view and take your notes mobile using Dropbox iOS/Android.",
                ]),
                google: async.constant([
                    "Memo Notepad: Google Drive Sync",
                    "",
                    "Google Drive sync keeps your notes in sync with your Google Drive.",
                    "",
                    "Every time you add or edit a note on Memo Notepad, it will sync to GDrive.",
                    "",
                    "If you edit a note on Google Drive, it will also sync back to Memo Notepad.",
                    "",
                    "Tips:",
                    "1. Memo Notepad will create a new folder for your notes in your GDrive",
                    "2. Notes are saved to your Google Drive as plain .txt files",
                    "3. Google may not allow you to view plain .txt, but many apps support .txt",
                ]),
                addNote: [
                    "dropbox",
                    "google",
                    function (go_on, res) {
                        var text = res[args.service];
                        if (!text) {
                            return go_on([0, "Expected known service"]);
                        }
                        Page.addNewNote({ text: text.join("\n") }, go_on);
                    },
                ],
            },
            cbk
        );
    };
    Page.addScript = function (args) {
        var ga = document.createElement("script");
        ga.async = true;
        ga.src = args.url;
        ga.type = "text/javascript";
        var s = document.getElementsByTagName("script")[0];
        setTimeout(function () {
            s.parentNode.insertBefore(ga, s);
        }, 500);
    };
    Page.adjustFontSize = function (args, cbk) {
        async.auto(
            {
                getAdjustedSize: function (go_on) {
                    var currentSize = $("#paper").data().size || 0;
                    var adjustedSize = currentSize + (args.increase_size ? 1 : -1);
                    if (!_(_FONT_SIZES).contains(adjustedSize)) {
                        return go_on();
                    }
                    go_on(null, adjustedSize);
                },
                adjustFontSize: [
                    "getAdjustedSize",
                    function (go_on, res) {
                        if (res.getAdjustedSize === undefined) {
                            return go_on();
                        }
                        Client.track({ path: "account/font_size/" + res.getAdjustedSize });
                        Page.setFontSize({ size: res.getAdjustedSize });
                        go_on();
                    },
                ],
                saveFontSize: [
                    "getAdjustedSize",
                    function (go_on, res) {
                        if (res.getAdjustedSize === undefined) {
                            return go_on();
                        }
                        Client.setSetting({ setting: "font_size", value: res.getAdjustedSize }, go_on);
                    },
                ],
            },
            cbk
        );
    };
    Page.adjustFontStyle = function (args, cbk) {
        if (!args.style) {
            return cbk([0, "Expected style"]);
        }
        Page.setStyle({ style: args.style });
        Client.track({ path: "account/style/" + args.style });
        Client.setSetting({ setting: "style", value: args.style }, cbk);
    };
    Page.adjustSizeToWindowHeight = function (args) {
        if (!!window.Background) {
            return;
        }
        $("body").addClass("loaded");
        var paper = $("#paper");
        var windowHeight = $(window).height();
        var height = windowHeight - paper.offset().top * 2 - 7;
        $("#paper, #notes").animate({ "min-height": height }, 50);
        $("#stacks").css({ height: windowHeight - $("#stacks").offset().top - 50 });
    };
    Page.advanceRegistration = function (args, cbk) {
        if (!args.register_button) {
            return cbk([0, "Expected button"]);
        }
        Client.clearStorage({}, function (err) {
            if (!!err) {
                return Client.log({ err: err });
            }
            Page.setAuthError({});
            var account = $("#account");
            if (account.is(".registering")) {
                return account.submit();
            }
            var completeRegistrationTitle = $(args.register_button).data("complete_registration_title");
            $(args.register_button).text(completeRegistrationTitle);
            account.addClass("registering");
            Client.track({ path: "account/register" });
        });
    };
    Page.authenticate = function (args) {
        var email = $("#account .email").val();
        var password = $("#account .password").val();
        if (!email) {
            return Page._authFail({ code: "missing_email" });
        }
        if (!password) {
            return Page._authFail({ code: "missing_password" });
        }
        var isValidEmail = Sync.isValidEmail({ email: email });
        if ($("#account").is(".registering") && !isValidEmail) {
            return Page._authFail({ code: "invalid_email" });
        }
        Page.setAuthError({});
        Sync.start({ register: $("#account").is(".registering") }, function (err) {
            if (!!err) {
                return Page.showError({ err: err });
            }
        });
        var isRegistering = $("#account").hasClass("registering");
        var authType = isRegistering ? "register" : "login";
        Client.track({ path: "account/authenticate/" + authType });
    };
    Page.authorized = function (args, cbk) {
        async.auto(
            {
                hasAuth: function (go_on) {
                    Sync.hasSavedAuth({}, go_on);
                },
                getEmail: function (go_on) {
                    Sync.getAuthenticatingEmailAddress({}, go_on);
                },
                showAuthenticated: [
                    "hasAuth",
                    "getEmail",
                    function (go_on, res) {
                        if (!res.hasAuth && !args.force) {
                            return go_on();
                        }
                        if (!res.getEmail) {
                            return go_on();
                        }
                        Client.wasLoggedIn = true;
                        $("#account").removeClass("authorizing registering");
                        $("#account .email").prop("disabled", true).val(res.getEmail);
                        $("#account .error").text("");
                        $("#user").addClass("authorized");
                        go_on();
                    },
                ],
            },
            cbk
        );
    };
    Page.changeBackground = function (args, cbk) {
        async.auto(
            {
                backgroundType: function (go_on) {
                    var type = $("body").hasClass("dark") ? "standard" : "dark";
                    go_on(null, type);
                },
                getStyle: function (go_on) {
                    Client.getSetting({ setting: "style" }, go_on);
                },
                hasPremium: function (go_on) {
                    var privs = $("#account").data().cached_privs || [];
                    return go_on(null, _(privs).contains("premium"));
                },
                removePremiumButtons: function (go_on) {
                    $("#account").removeClass("google_drive_sync_info dropbox_sync_info");
                    go_on();
                },
                setBackground: [
                    "backgroundType",
                    function (go_on, res) {
                        $("body").removeClass("dark standard").addClass(res.backgroundType);
                        return go_on();
                    },
                ],
                saveBackground: [
                    "setBackground",
                    function (go_on, res) {
                        Client.track({ path: "account/background/" + res.backgroundType });
                        Client.setSetting({ setting: "background_theme", value: res.backgroundType }, go_on);
                    },
                ],
                setStyle: [
                    "getStyle",
                    "setBackground",
                    function (go_on, res) {
                        Page.setStyle({ style: res.getStyle });
                        return go_on();
                    },
                ],
                togglePurchaseButton: [
                    "hasPremium",
                    "setBackground",
                    function (go_on, res) {
                        if (!!res.hasPremium) {
                            return go_on();
                        }
                        Page._togglePurchasePremiumBackgroundButton({ on: res.backgroundType !== "standard" });
                        go_on();
                    },
                ],
            },
            cbk
        );
    };
    Page.getCredentials = function (args) {
        return { email: $("#account .email").val(), password: $("#account .password").val() };
    };
    Page.getSelectedNoteId = function (args) {
        return $("#notes").data("id");
    };
    Page.getNoteText = function (args) {
        var content = "";
        var pieces = $("<div>" + $("#notes").html() + "</div>").contents();
        var numPieces = pieces.length;
        pieces.each(function (i, piece) {
            var text = $(piece).text();
            if (piece.nodeType === 3) {
                if (numPieces === 1 || i !== numPieces - 1) {
                    content += text;
                } else if (text !== "") {
                    content += text;
                }
            }
            if (piece.nodeType === 1 && text) {
                if (i !== 0 && piece.nodeName === "DIV") {
                    content += "\n";
                }
                if (text === "" && piece.nodeName === "DIV") {
                    content = "\n" + content + "\n";
                }
                content += text;
                if (piece.nodeName === "A") {
                    var numBrs = $(piece).find("br").length;
                    for (var j = 0; j < numBrs; j++) {
                        content += "\n";
                    }
                }
            }
            if (piece.nodeType === 1 && text === "" && i !== numPieces - 1) {
                content += "\n";
            }
        });
        if (content === "\n") {
            content = "";
        }
        return content.replace(/\u00a0/gim, " ");
    };
    Page.hideSearch = function (args, cbk) {
        async.auto(
            {
                hideSearch: function (go_on) {
                    $("#action_search, #action_search i, #search").removeClass("active btn-primary icon-white");
                    $("#search input").val("");
                    Page.searchNotes({ q: "" }, go_on);
                },
                delayForAnimation: [
                    "hideSearch",
                    function (go_on, res) {
                        _(go_on).delay(200);
                    },
                ],
                scrollToNote: [
                    "delayForAnimation",
                    function (go_on, res) {
                        Page._scrollIntoView({ container: $("#stacks"), element: Page._selectedNoteListing({})[0] });
                        go_on();
                    },
                ],
            },
            cbk
        );
    };
    Page.init = function (args, cbk) {
        async.auto(
            {
                addStripeLibrary: function (go_on) {
                    if (!!window.Background) {
                        return go_on();
                    }
                    Page.addScript({ url: _STRIPE_CHECKOUT_LIBRARY });
                    go_on();
                },
                getLastSelectedNoteId: function (go_on) {
                    Sync.getLastSelectedNoteId({}, go_on);
                },
                initAccountEmail: function (go_on) {
                    Page.initAccountEmail({}, go_on);
                },
                initNotesListing: function (go_on) {
                    Page.reloadNotesList({ skip_animation: true }, go_on);
                },
                initShareTokens: function (go_on) {
                    Page.initShareTokens({}, go_on);
                },
                loadTests: function (go_on) {
                    if (!window.location || !location.hostname === "localhost") {
                        return go_on();
                    }
                    Page._loadTests({});
                    go_on();
                },
                setSizes: function (go_on) {
                    Page.adjustSizeToWindowHeight({});
                    go_on();
                },
                startPage: [
                    "getLastSelectedNoteId",
                    function (go_on, res) {
                        $("#nav, #paper").removeClass("hidden");
                        Page.start({ select_note_id: res.getLastSelectedNoteId }, go_on);
                    },
                ],
                scrollToSelectedNote: [
                    "startPage",
                    function (go_on, res) {
                        setTimeout(function () {
                            Page._scrollIntoView({ container: $("#stacks"), element: Page._selectedNoteListing({})[0] });
                            go_on();
                        }, 500);
                    },
                ],
            },
            cbk
        );
    };
    Page.initAccountEmail = function (args, cbk) {
        Sync.getAuthenticatingEmailAddress({}, function (err, email) {
            if (!!err) {
                return cbk(err);
            }
            $("#account .email").val(email || "");
            cbk();
        });
    };
    Page.initShareTokens = function (args, cbk) {
        var tokenOptions = { createTokensOnBlur: true, delimiter: " ", minLength: 5, minWidth: 150 };
        if (!!window.Background) {
            return cbk();
        }
        $("#share .tokenfield")
            .tokenfield(tokenOptions)
            .on("tokenfield:createdtoken", function (e) {
                if (Sync.isValidEmail({ email: e.attrs.value })) {
                    return;
                }
                $(e.relatedTarget).addClass("invalid");
            });
        cbk();
    };
    Page.logout = function (args, cbk) {
        async.auto(
            {
                clearListings: function (go_on) {
                    if (!!args.keep_notes) {
                        return go_on();
                    }
                    $("#user input").val("");
                    $("#stacks, #notes").html("");
                    go_on();
                },
                clearStorage: function (go_on) {
                    if (!!args.only_update_dom) {
                        return go_on();
                    }
                    Client.clearStorage({}, go_on);
                },
                hideSearch: function (go_on) {
                    Page.hideSearch({}, go_on);
                },
                resetStyle: function (go_on) {
                    Page.setFontSize({ size: 0 });
                    $("body").removeClass("dark standard");
                    Page.setStyle({ style: "standard" });
                    Page._togglePurchasePremiumBackgroundButton({ on: false });
                    go_on();
                },
                resetSync: function (go_on) {
                    if (!!args.only_update_dom) {
                        return go_on();
                    }
                    Sync.reset({}, go_on);
                },
                resetUserDetails: function (go_on) {
                    if (!!args.only_update_dom) {
                        return go_on();
                    }
                    Sync.resetUserDetails({}, go_on);
                },
                resetAuthentication: [
                    "clearStorage",
                    function (go_on, res) {
                        var registerButton = $("#account_register");
                        registerButton.text(registerButton.data("original_title"));
                        $("#account").prop("class", "");
                        $("#account .email").prop("disabled", false);
                        $("#user .password").val("");
                        Page.setRemoteSync({});
                        Page._syncStop({});
                        Page.setAuthError({});
                        Page.resetError({});
                        go_on();
                    },
                ],
                hardLogout: [
                    "resetAuthentication",
                    function (go_on, res) {
                        if (!!args.keep_notes) {
                            return go_on();
                        }
                        Page._logoutRestart({}, go_on);
                    },
                ],
                softLogout: [
                    "resetAuthentication",
                    function (go_on, res) {
                        if (!args.keep_notes) {
                            return go_on();
                        }
                        if (!!args.only_update_dom) {
                            return go_on();
                        }
                        Page._softLogoutRestart({}, go_on);
                    },
                ],
            },
            cbk
        );
    };
    Page.presentShareNoteModal = function (args) {
        $("#share").modal();
        var title = Page.titleFromNoteText({ text: Page.getNoteText({}) });
        $("#share h3 .title").text(title);
        $("#share .preview .content").text(Page.getNoteText({}));
        $("#share .emails, #share .message").val("");
        $("#share .btn").button("reset");
    };
    Page.purchase = function (args) {
        $("#premium").modal();
    };
    Page.purchaseSubscription = function (args) {
        StripeCheckout.configure({
            allowRememberMe: false,
            closed: function () {
                Page._trackPurchaseState({ product_key: args.product_key, state: "closed" });
            },
            key: args.stripe_key,
            image: args.product_icon,
            locale: "auto",
            opened: function () {
                args.purchase_button.data("loading_stripe", 0);
                Page._trackPurchaseState({ product_key: args.product_key, state: "cc_details" });
            },
            panelLabel: "Subscribe {{amount}}",
            token: function (cardToken) {
                Page._purchasePremiumSubscriptionWithCardToken({ card_token: cardToken.id, plan: args.product_key, purchase_button: args.purchase_button });
            },
        }).open({ amount: parseInt(args.product_price), description: args.product_description, email: args.email, name: args.product_name });
    };
    Page.reloadNotesList = function (args, cbk) {
        async.auto(
            {
                getNotes: function (go_on) {
                    setTimeout(function () {
                        Data.getRecentNotes({}, go_on);
                    }, 200);
                },
                updateListings: [
                    "getNotes",
                    function (go_on, res) {
                        async.eachSeries(
                            res.getNotes,
                            function (note, updated) {
                                Page._createOrUpdateListingForNote({ id: note.id, skip_animation: args.skip_animation }, updated);
                            },
                            go_on
                        );
                    },
                ],
                selectedId: [
                    "updateListings",
                    function (go_on, res) {
                        go_on(null, Page.getSelectedNoteId({}));
                    },
                ],
                removeListings: [
                    "selectedId",
                    "updateListings",
                    function (go_on, res) {
                        var visible = res.getNotes.filter(function (note) {
                            return !Data.isHiddenNote({ note: note });
                        });
                        var notesById = _(visible).indexBy("id");
                        $("#stacks .stack")
                            .filter(function () {
                                var id = $(this).data("id");
                                var isSelected = id === res.selectedId;
                                var isVisible = !!notesById[id];
                                return !isSelected && !isVisible;
                            })
                            .remove();
                        go_on();
                    },
                ],
                sortListings: [
                    "removeListings",
                    function (go_on, res) {
                        var stacks = [];
                        $("#stacks .stack").each(function (i, n) {
                            stacks.push($(n));
                        });
                        stacks.sort(function (a, b) {
                            var aM = a.data("lm");
                            var bM = b.data("lm");
                            if (aM !== bM) {
                                return aM > bM ? -1 : 1;
                            }
                            return a.data("id") > b.data("id") ? -1 : 1;
                        });
                        stacks.forEach(function (stack) {
                            stack.appendTo("#stacks");
                        });
                        go_on();
                    },
                ],
            },
            cbk
        );
    };
    Page.remoteSyncInfo = function (args) {
        $("#account")
            .removeClass("dropbox_sync_info google_drive_sync_info")
            .addClass(args.service.join("_") + "_sync_info");
    };
    Page.removeSelectedNoteListing = function (args, cbk) {
        var selectedNoteId = Page.getSelectedNoteId({});
        var node = Page._noteListingElementsById({ id: selectedNoteId });
        Client.track({ path: "stacks/trash" });
        async.auto(
            {
                getNote: function (go_on) {
                    var id = node.data("id");
                    if (!id) {
                        return go_on([0, "Expected node id"]);
                    }
                    Data.getNote({ id: id }, go_on);
                },
                trashNote: [
                    "getNote",
                    function (go_on, res) {
                        if (!res.getNote || !res.getNote.text) {
                            return go_on();
                        }
                        if (!!node.data("trashing")) {
                            return go_on();
                        }
                        node.data("trashing", true);
                        node.find(".confirm").remove();
                        Page._trashNote({}, go_on);
                    },
                ],
                endTrashing: [
                    "trashNote",
                    function (go_on, res) {
                        node.data("trashing", false);
                        return go_on();
                    },
                ],
            },
            cbk
        );
    };
    Page.resetError = function (args) {
        $("#account").removeClass("error").find(".error_message").prop("class", "error_message");
    };
    Page.save = function (args, cbk) {
        var id = Page.getSelectedNoteId({});
        if (!id) {
            return cbk();
        }
        async.auto(
            {
                getNote: function (go_on) {
                    if (!id) {
                        return go_on([0, "Expected a selected id"]);
                    }
                    Data.getNote({ id: id }, go_on);
                },
                noteId: async.constant(Page.getSelectedNoteId({})),
                noteText: async.constant(Page.getNoteText({})),
                addNote: [
                    "getNote",
                    "noteId",
                    function (go_on, res) {
                        if (!!res.getNote) {
                            return go_on();
                        }
                        Data.addNote({ id: res.noteId }, go_on);
                    },
                ],
                editNote: [
                    "addNote",
                    "noteId",
                    "noteText",
                    function (go_on, res) {
                        if (!res.getNote || res.getNote.text === res.noteText) {
                            return go_on();
                        }
                        var id = !!res.addNote ? res.addNote.id : res.noteId;
                        var listings = Page._noteListingElementsById({ id: id });
                        $("#stacks").prepend(listings);
                        Data.editNote({ id: id, text: res.noteText }, go_on);
                    },
                ],
                updateNoteTime: [
                    "editNote",
                    function (go_on, res) {
                        if (!res.editNote) {
                            return go_on();
                        }
                        Page._noteTime({ text: res.editNote.text, text_last_modified: res.editNote.text_last_modified }, go_on);
                    },
                ],
                pingActivity: [
                    "editNote",
                    function (go_on, res) {
                        var now = new Date().toISOString();
                        try {
                            localStorage._lastSave = now;
                        } catch (e) {}
                        go_on();
                    },
                ],
            },
            function (err, res) {
                if (!!err) {
                    return cbk(err);
                }
                cbk(null, res.addNote || res.editNote);
            }
        );
    };
    Page.searchNotes = function (args, cbk) {
        Data.search(
            {
                partial: function (note) {
                    if (args.q == "") {
                        return;
                    }
                    Page._showSearchResults({ show_single: note.id }, Client.reportErrors({}));
                },
                q: args.q,
            },
            function (err, notes) {
                if (!!err) {
                    return cbk(err);
                }
                Page._showSearchResults({ notes: notes, show_all: args.q == "" }, cbk);
            }
        );
    };
    Page.selectNote = function (args, cbk) {
        if (!args.id) {
            return cbk([0, "Expected note id to select"]);
        }
        async.auto(
            {
                getNote: function (go_on) {
                    Data.getNote({ id: args.id }, go_on);
                },
                resetStackTitle: function (go_on) {
                    $("#stacks .confirm").remove();
                    var shortTitle = $("#stacks .title.span8");
                    shortTitle.removeClass("span8").addClass("span12");
                    go_on();
                },
                adjustNoteTime: [
                    "getNote",
                    function (go_on, res) {
                        if (!res.getNote) {
                            return go_on();
                        }
                        Page._noteTime({ text: res.getNote.text, text_last_modified: res.getNote.text_last_modified }, go_on);
                    },
                ],
                isSelected: [
                    "getNote",
                    function (go_on, res) {
                        if (!res.getNote) {
                            return go_on();
                        }
                        go_on(null, Page.getSelectedNoteId({}) === res.getNote.id);
                    },
                ],
                previouslySelectedNote: [
                    "isSelected",
                    function (go_on, res) {
                        if (!!res.isSelected || !Page.getSelectedNoteId({})) {
                            return go_on();
                        }
                        Data.getNote({ id: Page.getSelectedNoteId({}) }, go_on);
                    },
                ],
                focusEditArea: [
                    "isSelected",
                    function (go_on, res) {
                        if (!res.getNote || !!res.isSelected) {
                            return go_on();
                        }
                        if (res.getNote.text !== "" || !!res.getNote.deleted) {
                            return go_on();
                        }
                        $("#notes").focus();
                        go_on();
                    },
                ],
                saveLastSeenNote: [
                    "isSelected",
                    function (go_on, res) {
                        if (!res.getNote || !!res.isSelected) {
                            return go_on();
                        }
                        Sync.setLastSelectedNoteId({ id: args.id }, go_on);
                    },
                ],
                showNote: [
                    "isSelected",
                    "previouslySelectedNote",
                    function (go_on, res) {
                        if (!res.getNote || !!res.isSelected) {
                            return go_on();
                        }
                        var notes = $("#notes");
                        notes.data("id", args.id);
                        Page.setNoteText({ text: res.getNote.text });
                        notes.scrollTop(0);
                        _(go_on).delay(20);
                    },
                ],
                updatePreviousListing: [
                    "showNote",
                    function (go_on, res) {
                        if (!res.previouslySelectedNote) {
                            return go_on();
                        }
                        Page._createOrUpdateListingForNote({ id: res.previouslySelectedNote.id }, go_on);
                    },
                ],
                updateListing: [
                    "showNote",
                    function (go_on, res) {
                        if (!res.getNote || !!res.isSelected) {
                            return go_on();
                        }
                        Page._createOrUpdateListingForNote({ id: res.getNote.id }, go_on);
                    },
                ],
            },
            cbk
        );
    };
    Page.selectNoteListing = function (args, cbk) {
        if (!args.node) {
            return cbk([0, "Expected node"]);
        }
        if (args.node.data("id") === Page.getSelectedNoteId({})) {
            return cbk();
        }
        async.auto(
            {
                animateListingRemoval: function (go_on) {
                    var selected = Page._selectedNoteListing({});
                    if (!selected.hasClass("empty")) {
                        return go_on();
                    }
                    selected.addClass("removed");
                    _(function () {
                        selected.remove();
                    }).delay(200);
                    go_on();
                },
                clearSelection: function (go_on) {
                    if (!args.clear_selection) {
                        return go_on();
                    }
                    var selection = document.getSelection();
                    if (!selection || !selection.removeAllRanges) {
                        return go_on();
                    }
                    selection.removeAllRanges();
                    return go_on();
                },
                highlightNode: function (go_on) {
                    $(args.node).addClass("highlight");
                    return go_on();
                },
                noteId: async.constant(args.node.data("id") + ""),
                noteText: async.constant(Page.getNoteText({})),
                selectedNode: async.constant(Page._selectedNoteListing({})),
                getNote: [
                    "noteId",
                    function (go_on, res) {
                        if (!res.noteId) {
                            return go_on([0, "Expected id for note"]);
                        }
                        Data.getNote({ id: res.noteId }, go_on);
                    },
                ],
                unselectListing: [
                    "selectedNode",
                    function (go_on, res) {
                        if (Page.getSelectedNoteId({}) === args.node.data("id")) {
                            return go_on();
                        }
                        $(res.selectedNode).removeClass("selected");
                        return go_on();
                    },
                ],
                animateSelection: [
                    "getNote",
                    "highlightNode",
                    "noteId",
                    "noteText",
                    "selectedNode",
                    function (go_on, res) {
                        var selectedNoteId = Page.getSelectedNoteId({});
                        if (res.noteId === selectedNoteId || res.noteText !== "") {
                            return go_on();
                        }
                        args.node.addClass("selected");
                        setTimeout(go_on, 20);
                    },
                ],
                saveNotes: [
                    "animateSelection",
                    "noteId",
                    function (go_on, res) {
                        if (res.noteId === Page.getSelectedNoteId({})) {
                            return go_on();
                        }
                        args.node.addClass("selected");
                        res.selectedNode.removeClass("selected");
                        res.selectedNode.removeClass("highlight");
                        Page.save({}, go_on);
                    },
                ],
                showNote: [
                    "getNote",
                    "saveNotes",
                    function (go_on, res) {
                        Client.track({ path: "stacks/select/note_" + args.node.index() });
                        Page.selectNote({ id: res.getNote.id }, go_on);
                    },
                ],
            },
            cbk
        );
    };
    Page.setAuthError = function (args) {
        var status = args.code === undefined ? "" : "status_" + args.code;
        $("#account")
            .toggleClass("error", !!status)
            .find(".error_message")
            .prop("class", "")
            .addClass("error_message " + status);
    };
    Page.setBackgroundTheme = function (args, cbk) {
        var theme = args.theme || "";
        if ($("body").hasClass(theme)) {
            return cbk();
        }
        var isPremiumTheme = !!theme && theme !== "standard";
        $("body").removeClass("dark standard").addClass(theme);
        if (!isPremiumTheme) {
            Page._togglePurchasePremiumBackgroundButton({ on: false });
        }
        if (!args.style) {
            return cbk();
        }
        Page.setStyle({ style: args.style }, cbk);
    };
    Page.setNoteText = function (args) {
        var notes = $("#notes");
        if (!args.force && Page.getNoteText({}) === args.text) {
            return;
        }
        notes.text(args.text || "");
        if (!args.text) {
            return;
        }
        var text = args.text.replace(/</gim, "&lt;").replace(/>/gim, "&gt;");
        var html = Page._linkify({ text: text }) + "<br>";
        notes.html(html);
    };
    Page.setFontSize = function (args) {
        var size = args.size || 0;
        $("#paper")
            .removeClass("size0 size1 size2")
            .addClass("size" + size)
            .data({ size: parseInt(size) });
    };
    Page.setRemoteSync = function (args) {
        var service = args.service || ["remote"];
        var checkbox = $("#sync ." + service.join("_"));
        checkbox.removeClass("indeterminate off on");
        if (args.on === true) {
            checkbox.addClass("on");
        } else if (args.on === false) {
            checkbox.addClass("off");
        } else {
            checkbox.addClass("indeterminate");
        }
    };
    Page.setStyle = function (args) {
        var body = $("body");
        var textView = $("#notes");
        var type = args.style || _DEFAULT_FONT_STYLE;
        var color = textView.data().color_standard;
        var reverseColor = "rgb(255, 255, 255)";
        Client.style = type;
        if (body.hasClass("dark")) {
            color = textView.data().color_dark;
            reverseColor = "rgb(0, 0, 0)";
        }
        textView.css({ color: reverseColor }).animate({ color: color }, 150);
        $("#style li").each(function (i, li) {
            var t = $(li).data("type");
            $("#paper, #style").toggleClass(t, t === type);
        });
        $("#share").attr("data-style", type);
    };
    Page.shareNoteViaCopy = function (args) {
        var text = Page.getNoteText({});
        var message = $("#share .message").val() || "";
        if (!!message.length) {
            message += "\n\n";
        }
        var emails = $("#share .emails").tokenfield("getTokensList", " ");
        if (
            !emails.split(" ").filter(function (n) {
                return !!n;
            }).length
        ) {
            return;
        }
        var sig = "\n\nSent from Memo Notepad\nhttps://www.memonotepad.com";
        var title = Page.titleFromNoteText({ text: text }).substring(0, 75);
        var link = "mailto:" + encodeURIComponent(emails.split(" ").join(", ")) + "?subject=" + encodeURIComponent(title) + "&body=" + encodeURIComponent(message) + encodeURIComponent(text + sig);
        var mailto = window.open(link);
        Client.track({ path: "stacks/share" });
        $("#share").modal("hide");
    };
    Page.shareNoteViaSendButton = function (args) {
        if (!args.button) {
            return Client.log({ err: [0, "Expected button"] });
        }
        var emails = $("#share .emails").tokenfield("getTokensList", " ");
        var share = args.button;
        var text = Page.getNoteText({}) + "" || "";
        if (
            !emails.split(" ").filter(function (n) {
                return !!n;
            }).length
        ) {
            return;
        }
        var message = $("#share .message").val() || "";
        if (!!message.length) {
            message += "\n\n";
        }
        share.button("loading");
        async.auto(
            {
                minTimer: function (go_on) {
                    setTimeout(go_on, 1000);
                },
                shareNote: function (go_on) {
                    Sync.shareNoteByEmail({ send_to: emails.split(" "), text: message + text }, go_on);
                },
            },
            function (err) {
                if (Array.isArray(err) && err[0] === 401) {
                    return share.button("401");
                }
                if (!!err) {
                    return share.button("error");
                }
                share.button("reset");
                $("#share").modal("hide");
            }
        );
    };
    Page.showAuthorizingIndicator = function (args, cbk) {
        Sync.hasSavedAuth({}, function (err, authenticated) {
            if (!!err) {
                return cbk(err);
            }
            if (!!authenticated) {
                return cbk();
            }
            $("#account").addClass("authorizing");
            cbk();
        });
    };
    Page.showError = function (args) {
        $("#account").removeClass("authorizing").addClass("error");
        if (args.err.status !== undefined) {
            $("#account .error_message").prop("class", "error_message status_" + args.err.status);
        }
        Client.log({ err: args.err, path: "page" });
    };
    Page.showFatalStartError = function (args) {
        if (!args.err) {
            return Client.log({ err: [0, "Expected err"] });
        }
        if (!$("#paper").hasClass("hidden")) {
            Client.log({ err: args.err });
            return Client.log({ err: [0, "Expected interface hidden"] });
        }
        $("#existing .toast").remove();
        Client.log({ err: args.err });
        var reason = Array.isArray(args.err) ? args.err[1] : "";
        var toast = "" + '<div class="span12 toast">' + "<strong>Could not start app.</strong> " + reason + "</div>";
        $("#existing").prepend(toast);
    };
    Page.showTrashConfirmationForSelectedNote = function (args) {
        $("#notes").focus();
        $("#stacks .confirm").remove();
        var listing = Page._selectedNoteListing({});
        if (!listing || !listing.length) {
            return Client.log({ err: [0, "Expected selected note listing"] });
        }
        if (listing.is(".empty")) {
            return Page._selectNextListing({});
        }
        Page._scrollIntoView({ container: $("#stacks"), element: listing[0] });
        var confirm = $('<button><i class="fa fa-trash-o"></i></button>');
        confirm.addClass("btn confirm pull-right span4 trash");
        confirm.click(Events.clickConfirmTrashNote);
        listing.find(".title").removeClass("span12").addClass("span8");
        listing.append(confirm);
        setTimeout(function () {
            confirm.addClass("appear");
        }, 20);
    };
    Page.start = function (args, cbk) {
        async.auto(
            {
                adjustSize: function (go_on) {
                    go_on(null, Page.adjustSizeToWindowHeight({}));
                },
                clearEmpty: function (go_on) {
                    Data.clearEmptyNotes({}, go_on);
                },
                setLoggedIn: function (go_on) {
                    Page.authorized({}, go_on);
                },
                showTitleBarForChromeApp: function (go_on) {
                    if (!Client.isChromeApp()) {
                        return go_on();
                    }
                    $("#title_bar").removeClass("hide");
                    go_on();
                },
                showSyncSection: [
                    "setLoggedIn",
                    function (go_on, res) {
                        go_on(null, $("#user").removeClass("hidden"));
                    },
                ],
                getSelected: [
                    "clearEmpty",
                    function (go_on, res) {
                        if (!args.select_note_id) {
                            return go_on();
                        }
                        Data.getNote({ id: args.select_note_id }, go_on);
                    },
                ],
                getRecent: [
                    "getSelected",
                    "clearEmpty",
                    function (go_on, res) {
                        if (!!res.getSelected) {
                            return go_on();
                        }
                        Data.getRecentNotes({ limit: 1 }, go_on);
                    },
                ],
                addNewNote: [
                    "getSelected",
                    "getRecent",
                    function (go_on, res) {
                        var current = res.getSelected;
                        if (res.getRecent && res.getRecent.length) {
                            current = res.getRecent[0];
                        }
                        if (!!current && !current.destination) {
                            return go_on();
                        }
                        Data.addNote({}, go_on);
                    },
                ],
                focusNote: [
                    "addNewNote",
                    function (go_on, res) {
                        var n = res.addNewNote || res.getSelected || res.getRecent[0];
                        Page.selectNote({ id: n.id }, go_on);
                    },
                ],
                updateNoteListing: [
                    "focusNote",
                    function (go_on, res) {
                        if (!res.addNewNote) {
                            return go_on();
                        }
                        Page._createOrUpdateListingForNote({ id: res.addNewNote.id }, go_on);
                    },
                ],
                getAnonymousNotice: [
                    "focusNote",
                    function (go_on, res) {
                        Sync.getAnonNotice({}, Client.reportErrors({}));
                        go_on();
                    },
                ],
            },
            function (err, res) {
                if (!!err && !args.restart) {
                    return Page._logoutRestart({}, cbk);
                }
                cbk(err);
            }
        );
    };
    Page.titleFromNoteText = function (args) {
        var match = args.text.match(/[^ \t\n\xa0][^\n]*(?=\s|$)/gm);
        return !!match ? match[0] : "New Note";
    };
    Page.toggleRemoteSync = function (args, cbk) {
        async.auto(
            {
                hasRemoteSyncEnabled: function (go_on) {
                    Sync.isAccountRemoteSyncEnabled({ service: args.service[0] }, go_on);
                },
                priv: async.constant(args.priv || args.service[0]),
                disableRemoteSync: [
                    "hasRemoteSyncEnabled",
                    function (go_on, res) {
                        if (!res.hasRemoteSyncEnabled) {
                            return go_on();
                        }
                        if (!!args.window) {
                            args.window.close();
                        }
                        Sync.toggleRemoteSync({ on: false, service: args.service });
                        go_on();
                    },
                ],
                getPrivs: [
                    "hasRemoteSyncEnabled",
                    function (go_on, res) {
                        if (!!res.hasRemoteSyncEnabled) {
                            return go_on();
                        }
                        Sync.getCachedAccountPrivs({}, go_on);
                    },
                ],
                showPurchaseButton: [
                    "getPrivs",
                    "priv",
                    function (go_on, res) {
                        if (!!res.hasRemoteSyncEnabled) {
                            return go_on();
                        }
                        var isMissingPriv = !_(res.getPrivs).contains(res.priv);
                        if (!isMissingPriv) {
                            return go_on();
                        }
                        if (!!args.window) {
                            args.window.close();
                        }
                        Page.remoteSyncInfo({ service: args.service });
                        Client.track({ path: "purchase/" + res.priv + "/info" });
                        go_on(null, true);
                    },
                ],
                enableRemoteSync: [
                    "showPurchaseButton",
                    function (go_on, res) {
                        if (!!res.hasRemoteSyncEnabled || !!res.showPurchaseButton) {
                            return go_on();
                        }
                        Sync.toggleRemoteSync({ on: true, service: args.service, window: args.window });
                        Page.setRemoteSync({ service: args.service });
                        Client.track({ path: "account/" + res.priv + "/on" });
                        go_on();
                    },
                ],
            },
            cbk
        );
    };
    Page.toggleSearchMode = function (args, cbk) {
        async.auto(
            {
                toggleSearch: function (go_on) {
                    $("#action_search").toggleClass("btn-primary").find("i").toggleClass("icon-white");
                    $("#search").toggleClass("active");
                    $("#stacks .confirm").removeClass("appear");
                    setTimeout(go_on, 300);
                },
                updateSearchResults: [
                    "toggleSearch",
                    function (go_on, res) {
                        if (!!$("#search").is(".active")) {
                            return go_on();
                        }
                        Page.hideSearch({}, go_on);
                    },
                ],
                alterSearchFocus: [
                    "toggleSearch",
                    function (go_on, res) {
                        var eventType = $("#search").is(".active") ? "focus" : "blur";
                        $("#search input")[eventType]();
                        go_on();
                    },
                ],
                trackToggle: [
                    "toggleSearch",
                    function (go_on, res) {
                        var toggle = $("#search").hasClass("active") ? "on" : "off";
                        Client.track({ path: "stacks/search/" + toggle });
                        go_on();
                    },
                ],
            },
            cbk
        );
    };
    Page.toggleSettings = function (args) {
        async.auto(
            {
                hasSavedAuth: function (go_on) {
                    Sync.hasSavedAuth({}, go_on);
                },
                toggleOptions: [
                    "hasSavedAuth",
                    function (go_on, res) {
                        if (!res.hasSavedAuth) {
                            return go_on();
                        }
                        $("#account").toggleClass("options").removeClass("dropbox_sync_info google_drive_sync_info");
                        Client.track({ path: "account/settings" });
                        Sync.getAccount({}, go_on);
                    },
                ],
            },
            Client.reportErrors({})
        );
    };
    Page.updateCurrentNote = function (args, cbk) {
        if (!args.id) {
            return cbk([0, "Expected note"]);
        }
        async.auto(
            {
                getNote: function (go_on) {
                    Data.getNote({ id: args.id }, go_on);
                },
                updateListing: function (go_on) {
                    Page._createOrUpdateListingForNote({ id: args.id }, go_on);
                },
                trashSelected: [
                    "getNote",
                    function (go_on, res) {
                        if (Page.getSelectedNoteId({}) !== args.id) {
                            return go_on();
                        }
                        if (!res.getNote || !res.getNote.deleted) {
                            return go_on();
                        }
                        Page._trashNote({}, go_on);
                    },
                ],
                hideListing: [
                    "getNote",
                    function (go_on, res) {
                        if (Page.getSelectedNoteId({}) === args.id || !res.getNote) {
                            return go_on();
                        }
                        if (Data.isHiddenNote({ note: res.getNote })) {
                            Page._noteListingElementsById({ id: args.id }).remove();
                        }
                        go_on();
                    },
                ],
                updateVisibleNote: [
                    "getNote",
                    function (go_on, res) {
                        if (Page.getSelectedNoteId({}) !== args.id) {
                            return go_on();
                        }
                        if (Page._typedRecentlyInNotes({})) {
                            return go_on();
                        }
                        if (!res.getNote) {
                            return go_on();
                        }
                        if (Page.getNoteText({}) === res.getNote.text) {
                            return go_on();
                        }
                        Page.setNoteText({ text: res.getNote.text });
                        go_on();
                    },
                ],
                adjustListingPosition: [
                    "getNote",
                    "updateListing",
                    function (go_on, res) {
                        if (!res.getNote) {
                            return go_on();
                        }
                        Page._insertListingInSortedList({ adjust_position: true, listing: Page._noteListingElementsById({ id: args.id }), note: res.getNote });
                        go_on();
                    },
                ],
            },
            cbk
        );
    };
    Page.updateVisibleElements = function (args, cbk) {
        async.auto(
            {
                deauthorize: function (go_on) {
                    if ($("#account").hasClass("authorizing")) {
                        return go_on();
                    }
                    if (!$("#user").hasClass("authorized")) {
                        return go_on();
                    }
                    Sync.hasAuthIncludingCredentials({}, function (err, hasAuth) {
                        if (!!err) {
                            return go_on(err);
                        }
                        if (!!hasAuth) {
                            return go_on();
                        }
                        Sync.logout({}, go_on);
                    });
                },
                getNote: function (go_on) {
                    if (!Page.getSelectedNoteId({})) {
                        return go_on();
                    }
                    Data.getNote({ id: Page.getSelectedNoteId({}) }, go_on);
                },
                reloadListings: function (go_on) {
                    Page.reloadNotesList({ skip_animation: true }, go_on);
                },
                updateAuthorized: function (go_on) {
                    Page.authorized({}, go_on);
                },
                updateVisibleNote: [
                    "getNote",
                    function (go_on, res) {
                        if (!res.getNote) {
                            return go_on();
                        }
                        Page.updateCurrentNote({ id: res.getNote.id }, go_on);
                    },
                ],
            },
            cbk
        );
    };
})();
