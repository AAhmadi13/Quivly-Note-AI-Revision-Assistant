// Author: Adam H. Ahmadi ID: 23160330
        const chatMessages = document.getElementById('chat-messages');
        const chatInput = document.getElementById('chat-input');
        const sendButton = document.getElementById('send-button');
        const summariseBtn = document.getElementById('summarise-btn');
        const quizMeBtn = document.getElementById('quiz-me-btn');
        const quizMeGeneralBtn = document.getElementById('quiz-me-general-btn');
        const podcastBtn = document.getElementById('podcast-btn');
        const flashcardsBtn = document.getElementById('flashcards-btn');
        const clearChatBtn = document.getElementById('clear-chat-btn');
        var activePodcastAudio = null;
        var syncQuickActionsDockForNote;

        (function initChatActionsDock() {
            var dock = document.getElementById('chat-actions-dock');
            var toggle = document.getElementById('chat-actions-toggle');
            var panel = document.getElementById('chat-actions-panel');
            if (!dock || !toggle || !panel) return;

            function quickActionsStorageKey(noteId) {
                return 'quivly_chat_quick_open_' + String(noteId);
            }

            function applyCollapsed(collapsed, persist) {
                dock.classList.toggle('is-collapsed', collapsed);
                toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
                var label = collapsed ? 'Show quick actions' : 'Hide quick actions';
                toggle.setAttribute('aria-label', label);
                toggle.setAttribute('title', label);
                if (persist !== false && lastNoteId !== undefined && lastNoteId !== null && lastNoteId !== '') {
                    try {
                        if (collapsed) {
                            localStorage.removeItem(quickActionsStorageKey(lastNoteId));
                        } else {
                            localStorage.setItem(quickActionsStorageKey(lastNoteId), '1');
                        }
                    } catch (err) {}
                }
            }

            syncQuickActionsDockForNote = function(noteId) {
                try {
                    var open = noteId != null && noteId !== '' && localStorage.getItem(quickActionsStorageKey(noteId)) === '1';
                    applyCollapsed(!open, false);
                } catch (err) {
                    applyCollapsed(true, false);
                }
            };

            toggle.addEventListener('click', function() {
                var newCollapsed = !dock.classList.contains('is-collapsed');
                applyCollapsed(newCollapsed, true);
            });
        })();

        document.addEventListener('click', function(ev) {
            document.querySelectorAll('.chat-podcast-menu-dropdown.is-open').forEach(function(dd) {
                var wrap = dd.closest('.chat-podcast-menu-wrap');
                if (wrap && wrap.contains(ev.target)) return;
                dd.classList.remove('is-open');
                if (wrap) {
                    var mb = wrap.querySelector('.chat-podcast-menu-btn');
                    if (mb) mb.setAttribute('aria-expanded', 'false');
                }
            });
        });

        var chatAbortController = null;
        sendButton.addEventListener('click', function() {
            if (sendButton.classList.contains('is-loading') && chatAbortController) {
                chatAbortController.abort();
                return;
            }
            sendMessage();
        });

        function getNoteFromParent() {
            return new Promise(function(resolve) {
                var done = false;
                function finish(obj) {
                    if (done) return;
                    done = true;
                    window.removeEventListener('message', onMessage);
                    resolve(obj || { title: '', content: '' });
                }
                const requestId = Date.now() + '-' + Math.random().toString(36).slice(2);
                function onMessage(e) {
                    if (e.data && e.data.type === 'NOTE' && String(e.data.requestId) === String(requestId)) {
                        finish({ note_id: e.data.note_id || null, title: e.data.title || '', content: e.data.content || '' });
                    }
                }
                window.addEventListener('message', onMessage);
                if (window.parent && window.parent !== window) {
                    window.parent.postMessage({ type: 'GET_NOTE', requestId: requestId }, '*');
                } else {
                    finish({ note_id: null, title: '', content: '' });
                    return;
                }
                setTimeout(function() { finish({ note_id: null, title: '', content: '' }); }, 2000);
            });
        }

        function notifyNoteAiActivity(noteId) {
            if (noteId == null || noteId === '') return;
            fetch('/note_touch_activity/' + noteId, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: '{}'
            })
                .then(function(r) { return r.json(); })
                .then(function(d) {
                    if (!d.success || !window.parent || window.parent === window) return;
                    window.parent.postMessage({
                        type: 'NOTE_ACTIVITY_BUMP',
                        note_id: noteId,
                        relative_time: d.relative_time || '',
                        reminder_enabled: d.reminder_enabled,
                        show_reminder: d.show_reminder,
                        reminder_nudge_text: d.reminder_nudge_text
                    }, '*');
                })
                .catch(function() {});
        }

        var lastNoteId = undefined;
        var welcomeGen = 0;
        var CHAT_USERNAME = (function() {
            try {
                var el = document.getElementById('quivly-chat-bootstrap');
                if (!el || !el.textContent) return '';
                var cfg = JSON.parse(el.textContent.trim());
                if (!cfg || cfg.username == null || cfg.username === '') return '';
                return String(cfg.username);
            } catch (err) {
                return '';
            }
        })();
        var WELCOME_INTRO_TEXT = CHAT_USERNAME
            ? ("Hello, " + CHAT_USERNAME + "! I'm your AI assistant. Ask me anything. I'm here to help!")
            : "Hello! I'm your AI assistant. Ask me anything. I'm here to help!";
        var CLEAR_CHAT_WARNING_TEXT = "Your chat will be cleared in a moment.";
        
        var FEATURE_ACTION_DELAY_MS = 200;
        var RETURNING_SESSION_HINT = "Back again? Here's where we left off with this note.";
        var pendingReturningChatHint = false;
        var savedChats = {};
        var featureStateByNote = {};
        var hydrateDebounceTimer = null;
        var hydrateGeneration = 0;
        var noteFeaturesFetchAbort = null;

        function abortNoteFeaturesFetch() {
            if (!noteFeaturesFetchAbort) return;
            try {
                noteFeaturesFetchAbort.abort();
            } catch (err) {}
            noteFeaturesFetchAbort = null;
        }

        function addWelcomeMessage() {
            var welcome = document.createElement('div');
            welcome.className = 'message assistant';
            var mc = document.createElement('div');
            mc.className = 'message-content';
            mc.textContent = WELCOME_INTRO_TEXT;
            welcome.appendChild(mc);
            chatMessages.appendChild(welcome);
        }

        
        function runWelcomeTyping() {
            var myGen = welcomeGen;
            var row = document.createElement('div');
            row.className = 'message assistant';
            row.innerHTML = '<div class="message-content"><div class="loading"><div class="loading-dot"></div><div class="loading-dot"></div><div class="loading-dot"></div></div></div>';
            chatMessages.appendChild(row);
            chatMessages.scrollTop = chatMessages.scrollHeight;
            setTimeout(function() {
                if (myGen !== welcomeGen) return;
                var content = row.querySelector('.message-content');
                if (!content) return;
                try {
                    if (window.parent && window.parent !== window) {
                        window.parent.postMessage({ type: 'CHAT_INTRO_TYPING_START' }, '*');
                    }
                } catch (err) {}
                var i = 0;
                function typeChar() {
                    if (myGen !== welcomeGen) return;
                    if (i <= WELCOME_INTRO_TEXT.length) {
                        content.textContent = WELCOME_INTRO_TEXT.slice(0, i);
                        i++;
                        chatMessages.scrollTop = chatMessages.scrollHeight;
                        setTimeout(typeChar, 18);
                    } else {
                        
                        notifyParentChatProgressIfChanged();
                    }
                }
                typeChar();
            }, 550);
        }

        
        function runClearChatWarningTyping(onComplete) {
            welcomeGen++;
            var myGen = welcomeGen;
            var row = document.createElement('div');
            row.className = 'message assistant';
            row.innerHTML = '<div class="message-content"><div class="loading"><div class="loading-dot"></div><div class="loading-dot"></div><div class="loading-dot"></div></div></div>';
            chatMessages.appendChild(row);
            chatMessages.scrollTop = chatMessages.scrollHeight;
            setTimeout(function() {
                if (myGen !== welcomeGen) return;
                var content = row.querySelector('.message-content');
                if (!content) return;
                var i = 0;
                function typeChar() {
                    if (myGen !== welcomeGen) return;
                    if (i <= CLEAR_CHAT_WARNING_TEXT.length) {
                        content.textContent = CLEAR_CHAT_WARNING_TEXT.slice(0, i);
                        i++;
                        chatMessages.scrollTop = chatMessages.scrollHeight;
                        if (i <= CLEAR_CHAT_WARNING_TEXT.length) {
                            setTimeout(typeChar, 18);
                        } else {
                            conversationHistory.push({ role: 'assistant', content: CLEAR_CHAT_WARNING_TEXT });
                            notifyParentChatProgressIfChanged();
                            if (typeof onComplete === 'function') onComplete();
                        }
                    }
                }
                typeChar();
            }, 550);
        }

        
        function runClearChatTranscriptWithWelcomeTyping() {
            if (sendButton.classList.contains('is-loading')) return;
            if (sendButton.disabled) return;
            welcomeGen++;
            stopPodcastPlayback();
            hideLoading();
            quizState = null;
            while (chatMessages.firstChild) {
                chatMessages.removeChild(chatMessages.firstChild);
            }
            conversationHistory.length = 0;
            if (lastNoteId !== undefined && lastNoteId !== null) {
                var sk = String(lastNoteId);
                savedChats[sk] = savedChats[sk] || {};
                savedChats[sk].history = [];
                featureStateByNote[sk] = {};
            }
            runWelcomeTyping();
            chatMessages.scrollTop = chatMessages.scrollHeight;
            notifyParentChatProgressIfChanged();
        }

        function scheduleClearChatKeywordSequence(opts) {
            opts = opts || {};
            if (sendButton.classList.contains('is-loading')) return;
            if (sendButton.disabled) return;
            var noteWhenScheduled = lastNoteId;
            if (!opts.skipUserBubble) {
                addMessage('Clear Chat', true);
            }
            runClearChatWarningTyping(function() {
                setTimeout(function() {
                    if (lastNoteId !== noteWhenScheduled) return;
                    runClearChatTranscriptWithWelcomeTyping();
                }, 400);
            });
        }

        function shouldSkipRestoredMessage(h) {
            if (!h || h.role !== 'assistant') return false;
            var c = (h.content || '').trim();
            return c === 'Podcast generated for this note.' || c === 'Flashcards generated for this note.';
        }

        function filterSavedHistory(history) {
            if (!history || !history.length) return [];
            return history.filter(function(h) { return !shouldSkipRestoredMessage(h); });
        }

        function serializeFeatureStateForPersist(noteKey) {
            var fs = featureStateByNote[noteKey] || {};
            var out = {};
            if (fs.userActivatedPodcast) out.userActivatedPodcast = true;
            if (fs.podcast && typeof fs.podcast === 'object') {
                out.podcast = {
                    audioUrl: String(fs.podcast.audioUrl || '').slice(0, 2048),
                    title: String(fs.podcast.title || '').slice(0, 500)
                };
            }
            if (fs.userActivatedFlashcards) out.userActivatedFlashcards = true;
            if (fs.flashcards && typeof fs.flashcards === 'object') {
                var fcx = {
                    index: typeof fs.flashcards.index === 'number' ? fs.flashcards.index : 0,
                    showingBack: !!fs.flashcards.showingBack
                };
                if (Array.isArray(fs.flashcards.ratings)) {
                    fcx.ratings = fs.flashcards.ratings.map(function(x) {
                        if (x === true) return true;
                        if (x === false) return false;
                        return null;
                    });
                }
                if (fs.flashcards.complete) {
                    fcx.complete = true;
                }
                out.flashcards = fcx;
            }
            if (quizState && lastNoteId != null && String(lastNoteId) === String(noteKey)) {
                out.quiz = {
                    scope: quizState.scope || 'current_note',
                    questions: quizState.questions,
                    index: quizState.index,
                    answers: quizState.answers || [],
                    answered: !!quizState.answered,
                    choiceIndex: typeof quizState.choiceIndex === 'number' ? quizState.choiceIndex : null
                };
            } else if (fs.quiz && fs.quiz.questions && fs.quiz.questions.length) {
                out.quiz = JSON.parse(JSON.stringify(fs.quiz));
            }
            return out;
        }

        var chatPersistTimer = null;

        function flushPersistChatHistoryNow() {
            clearTimeout(chatPersistTimer);
            chatPersistTimer = null;
            
            var persistNoteId = lastNoteId;
            if (persistNoteId == null || persistNoteId === '') return;
            var nk = String(persistNoteId);
            var hist = filterSavedHistory(conversationHistory.slice());
            fetch('/save_note_chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({
                    note_id: persistNoteId,
                    history: hist,
                    features: serializeFeatureStateForPersist(nk)
                }),
                keepalive: true
            })
                .then(function(r) {
                    if (!r.ok) return null;
                    return r.json().catch(function() { return null; });
                })
                .then(function(d) {
                    if (!d || !d.success || !window.parent || window.parent === window) return;
                    var syncId = d.note_id != null ? d.note_id : persistNoteId;
                    try {
                        window.parent.postMessage({
                            type: 'NOTE_REMINDER_SYNC',
                            note_id: syncId,
                            reminder_enabled: d.reminder_enabled,
                            show_reminder: d.show_reminder,
                            reminder_nudge_text: d.reminder_nudge_text
                        }, '*');
                    } catch (err) {}
                })
                .catch(function() {});
        }

        function schedulePersistChatHistoryToServer() {
            clearTimeout(chatPersistTimer);
            chatPersistTimer = setTimeout(function() {
                flushPersistChatHistoryNow();
            }, 1800);
        }

        function runReturningHintTyping() {
            var myGen = welcomeGen;
            var row = document.createElement('div');
            row.className = 'message assistant chat-returning-session-hint';
            row.innerHTML = '<div class="message-content"><div class="loading"><div class="loading-dot"></div><div class="loading-dot"></div><div class="loading-dot"></div></div></div>';
            chatMessages.appendChild(row);
            chatMessages.scrollTop = chatMessages.scrollHeight;
            setTimeout(function() {
                if (myGen !== welcomeGen) {
                    if (row.parentNode) row.remove();
                    return;
                }
                var content = row.querySelector('.message-content');
                if (!content) return;
                var text = RETURNING_SESSION_HINT;
                var i = 0;
                function typeChar() {
                    if (myGen !== welcomeGen) {
                        if (row.parentNode) row.remove();
                        return;
                    }
                    if (i <= text.length) {
                        content.textContent = text.slice(0, i);
                        i++;
                        chatMessages.scrollTop = chatMessages.scrollHeight;
                        setTimeout(typeChar, 16);
                    }
                }
                typeChar();
            }, 400);
        }

        function flushReturningChatHintIfNeeded() {
            if (!pendingReturningChatHint) return;
            pendingReturningChatHint = false;
            if (chatMessages.querySelector('.chat-returning-session-hint')) return;
            runReturningHintTyping();
        }

        function stripReturningSessionHintMessages() {
            chatMessages.querySelectorAll('.chat-returning-session-hint').forEach(function(el) {
                el.remove();
            });
        }

        
        function noteChatHasProgressForPanelReopen() {
            if (conversationHistory.some(function(h) { return h.role === 'user'; })) return true;
            if (chatMessages.querySelector('.message.user')) return true;
            if (chatMessages.querySelector('[data-feature-podcast]')) return true;
            if (chatMessages.querySelector('[data-feature-flashcards]')) return true;
            return false;
        }

        function notifyParentChatProgressIfChanged() {
            try {
                if (!window.parent || window.parent === window) return;
                if (lastNoteId == null || lastNoteId === '') return;
                window.parent.postMessage({
                    type: 'CHAT_PROGRESS_FOR_NOTE',
                    note_id: lastNoteId,
                    has_progress: noteChatHasProgressForPanelReopen()
                }, '*');
            } catch (err) {}
            schedulePersistChatHistoryToServer();
        }

        function restoreChat(savedState, opts) {
            opts = opts || {};
            welcomeGen++;
            pendingReturningChatHint = false;
            while (chatMessages.firstChild) {
                chatMessages.removeChild(chatMessages.firstChild);
            }
            conversationHistory.length = 0;
            if (savedState && savedState.history && savedState.history.length) {
                addWelcomeMessage();
                var restoredCount = 0;
                savedState.history.forEach(function(h) {
                    if (shouldSkipRestoredMessage(h)) return;
                    addMessage(h.content, h.role === 'user', { noHistory: true, skipNotify: true });
                    conversationHistory.push(h);
                    restoredCount++;
                });
                if (restoredCount > 0) {
                    pendingReturningChatHint = true;
                }
            } else {
                runWelcomeTyping();
            }
            chatMessages.scrollTop = chatMessages.scrollHeight;
            if (!opts.skipPersistNotify) {
                notifyParentChatProgressIfChanged();
            }
        }

        function scheduleHydrateFeatures(noteId) {
            if (noteId == null || noteId === '') {
                flushReturningChatHintIfNeeded();
                return;
            }
            clearTimeout(hydrateDebounceTimer);
            hydrateDebounceTimer = setTimeout(function() {
                requestAnimationFrame(function() {
                    hydrateNoteFeatures(noteId);
                });
            }, 0);
        }

        async function hydrateNoteFeatures(noteId) {
            var myGen = null;
            try {
                if (!noteId) return;
                if (String(noteId) !== String(lastNoteId)) return;
                myGen = hydrateGeneration;
                abortNoteFeaturesFetch();
                var ac = new AbortController();
                noteFeaturesFetchAbort = ac;
                try {
                    var r = await fetch('/note_features/' + noteId, { signal: ac.signal });
                    var d = await r.json();
                    if (myGen !== hydrateGeneration) return;
                    if (String(noteId) !== String(lastNoteId)) return;
                    if (!d.success) return;
                    var key = String(noteId);
                    var local = featureStateByNote[key] || {};
                    if (local.userActivatedPodcast && d.podcast_audio_url && !chatMessages.querySelector('[data-feature-podcast="' + key + '"]')) {
                        addPodcastPlayer(d.podcast_audio_url, d.note_title || 'Podcast', noteId);
                        local.podcast = { audioUrl: d.podcast_audio_url, title: d.note_title || '' };
                    }
                    if (local.userActivatedFlashcards && d.flashcards && d.flashcards.length && !chatMessages.querySelector('[data-feature-flashcards="' + key + '"]')) {
                        var fi = (local.flashcards && typeof local.flashcards.index === 'number') ? local.flashcards.index : 0;
                        var fb = local.flashcards && local.flashcards.showingBack;
                        var fopts = { startIndex: fi, startShowingBack: !!fb };
                        if (local.flashcards && local.flashcards.complete) {
                            fopts.sessionComplete = true;
                        } else if (local.flashcards && Array.isArray(local.flashcards.ratings) && local.flashcards.ratings.length === d.flashcards.length) {
                            fopts.startRatings = local.flashcards.ratings;
                        }
                        renderFlashcards(d.flashcards, fopts, noteId);
                    }
                    featureStateByNote[key] = local;
                } catch (err) {
                    if (err.name === 'AbortError') return;
                    console.error(err);
                }
            } finally {
                noteFeaturesFetchAbort = null;
                if (myGen !== null && myGen === hydrateGeneration && noteId != null && String(noteId) === String(lastNoteId)) {
                    flushReturningChatHintIfNeeded();
                }
            }
        }

        window.addEventListener('message', function(e) {
            if (e.data && e.data.type === 'SET_NOTE') {
                var noteId = e.data.note_id;
                var noteKey = String(noteId);
                abortNoteFeaturesFetch();
                hydrateGeneration++;
                var switching = lastNoteId !== undefined && noteId !== lastNoteId;
                if (switching && lastNoteId != null) {
                    flushPersistChatHistoryNow();
                }

                if (switching) {
                    savedChats[String(lastNoteId)] = {
                        history: filterSavedHistory(conversationHistory.slice()),
                        features: JSON.parse(JSON.stringify(featureStateByNote[String(lastNoteId)] || {}))
                    };
                }

                lastNoteId = noteId;

                if (e.data.note_privacy_locked) {
                    window._currentNote = { title: '', content: '' };
                    conversationHistory.length = 0;
                    while (chatMessages.firstChild) {
                        chatMessages.removeChild(chatMessages.firstChild);
                    }
                    welcomeGen++;
                    quizState = null;
                    addMessage('This note is locked. Enter your password in the note editor to unlock it.', false);
                    if (typeof syncQuickActionsDockForNote === 'function') {
                        syncQuickActionsDockForNote(noteId);
                    }
                    notifyParentChatProgressIfChanged();
                    return;
                }

                window._currentNote = { title: e.data.title || '', content: e.data.content || '' };

                if (typeof syncQuickActionsDockForNote === 'function') {
                    syncQuickActionsDockForNote(noteId);
                }

                
                if (e.data.sync_note_context_only) {
                    scheduleHydrateFeatures(noteId);
                    notifyParentChatProgressIfChanged();
                    return;
                }

                if (e.data.play_intro_typing) {
                    welcomeGen++;
                    pendingReturningChatHint = false;
                    quizState = null;
                    stopPodcastPlayback();
                    hideLoading();
                    while (chatMessages.firstChild) {
                        chatMessages.removeChild(chatMessages.firstChild);
                    }
                    conversationHistory.length = 0;
                    var introKey = String(noteId);
                    savedChats[introKey] = savedChats[introKey] || {};
                    savedChats[introKey].history = [];
                    featureStateByNote[introKey] = {};
                    runWelcomeTyping();
                    chatMessages.scrollTop = chatMessages.scrollHeight;
                    notifyParentChatProgressIfChanged();
                    scheduleHydrateFeatures(noteId);
                    return;
                }

                
                if (e.data.panel_reopened && !switching) {
                    welcomeGen++;
                    var hasSession = noteChatHasProgressForPanelReopen();
                    if (hasSession) {
                        stripReturningSessionHintMessages();
                        pendingReturningChatHint = true;
                        notifyParentChatProgressIfChanged();
                        scheduleHydrateFeatures(noteId);
                        return;
                    }
                    pendingReturningChatHint = false;
                    quizState = null;
                    stopPodcastPlayback();
                    hideLoading();
                    while (chatMessages.firstChild) {
                        chatMessages.removeChild(chatMessages.firstChild);
                    }
                    conversationHistory.length = 0;
                    var reopenKey = String(noteId);
                    savedChats[reopenKey] = savedChats[reopenKey] || {};
                    savedChats[reopenKey].history = [];
                    featureStateByNote[reopenKey] = {};
                    runWelcomeTyping();
                    chatMessages.scrollTop = chatMessages.scrollHeight;
                    notifyParentChatProgressIfChanged();
                    scheduleHydrateFeatures(noteId);
                    return;
                }

                if (switching) {
                    var incoming = savedChats[noteKey];
                    if (e.data.saved_chat_features && typeof e.data.saved_chat_features === 'object') {
                        featureStateByNote[noteKey] = JSON.parse(JSON.stringify(e.data.saved_chat_features));
                    } else if (incoming && incoming.features) {
                        featureStateByNote[noteKey] = JSON.parse(JSON.stringify(incoming.features));
                    } else {
                        featureStateByNote[noteKey] = featureStateByNote[noteKey] || {};
                    }
                    if (e.data.saved_chat_history !== undefined && Array.isArray(e.data.saved_chat_history)) {
                        var srvHist = filterSavedHistory(e.data.saved_chat_history);
                        if (srvHist.length && (!incoming || !incoming.history || !incoming.history.length)) {
                            incoming = { history: srvHist, features: featureStateByNote[noteKey] || {} };
                        }
                    }
                    restoreChat(incoming, { skipPersistNotify: true });
                    restoreRichChatFeaturesFromState(noteKey);
                    notifyParentChatProgressIfChanged();
                } else if (
                    e.data.saved_chat_history !== undefined &&
                    Array.isArray(e.data.saved_chat_history) &&
                    !e.data.panel_reopened &&
                    !e.data.play_intro_typing
                ) {
                    welcomeGen++;
                    pendingReturningChatHint = false;
                    quizState = null;
                    stopPodcastPlayback();
                    hideLoading();
                    if (e.data.saved_chat_features && typeof e.data.saved_chat_features === 'object') {
                        featureStateByNote[noteKey] = JSON.parse(JSON.stringify(e.data.saved_chat_features));
                    } else {
                        featureStateByNote[noteKey] = featureStateByNote[noteKey] || {};
                    }
                    if (e.data.saved_chat_history.length > 0) {
                        restoreChat({ history: filterSavedHistory(e.data.saved_chat_history) }, { skipPersistNotify: true });
                    } else {
                        restoreChat(null, { skipPersistNotify: true });
                    }
                    restoreRichChatFeaturesFromState(noteKey);
                    savedChats[noteKey] = savedChats[noteKey] || {};
                    savedChats[noteKey].history = filterSavedHistory(conversationHistory.slice());
                    savedChats[noteKey].features = JSON.parse(JSON.stringify(featureStateByNote[noteKey] || {}));
                    scheduleHydrateFeatures(noteId);
                    notifyParentChatProgressIfChanged();
                    return;
                } else {
                    featureStateByNote[noteKey] = featureStateByNote[noteKey] || {};
                }
                scheduleHydrateFeatures(noteId);
            }
        });

        var CHAT_INPUT_SCROLL_AFTER_LINES = 6;

        function getChatInputMaxGrowOuterHeightPx() {
            var cs = getComputedStyle(chatInput);
            var pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) || 0;
            var lh = cs.lineHeight;
            var linePx;
            if (!lh || lh === 'normal') {
                linePx = parseFloat(cs.fontSize) * 1.25;
            } else {
                linePx = parseFloat(lh);
            }
            return pad + CHAT_INPUT_SCROLL_AFTER_LINES * linePx;
        }

        function resizeChatInput() {
            chatInput.style.height = 'auto';
            var maxGrowH = getChatInputMaxGrowOuterHeightPx();
            var sh = chatInput.scrollHeight;
            if (sh <= maxGrowH) {
                chatInput.style.height = sh + 'px';
                chatInput.style.overflowY = 'hidden';
            } else {
                chatInput.style.height = maxGrowH + 'px';
                chatInput.style.overflowY = 'auto';
            }
        }

        window.addEventListener('resize', function() {
            resizeChatInput();
        });

        chatInput.addEventListener('input', function() {
            resizeChatInput();
        });

        chatInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });

        
        function queueFeatureActionAfterUserBubble(userLabel, actionFn) {
            if (sendButton.classList.contains('is-loading')) return;
            if (sendButton.disabled) return;
            addMessage(userLabel, true);
            setTimeout(actionFn, FEATURE_ACTION_DELAY_MS);
        }

        summariseBtn.addEventListener('click', function() {
            queueFeatureActionAfterUserBubble('Summarise', function() {
                sendMessage('', { summarise: true, _userBubbleAlreadyAdded: true });
            });
        });
        function triggerNoteQuiz(opts) {
            return startQuiz('current_note', opts);
        }
        quizMeBtn.addEventListener('click', function() {
            queueFeatureActionAfterUserBubble('Note Quiz', function() {
                triggerNoteQuiz({ skipUserBubble: true });
            });
        });
        if (quizMeGeneralBtn) {
            quizMeGeneralBtn.addEventListener('click', function() {
                queueFeatureActionAfterUserBubble('Topic Quiz', function() {
                    startQuiz('general', { skipUserBubble: true });
                });
            });
        }
        if (podcastBtn) {
            podcastBtn.addEventListener('click', function() {
                queueFeatureActionAfterUserBubble('Podcast', function() {
                    generatePodcast({ skipUserBubble: true });
                });
            });
        }
        if (flashcardsBtn) {
            flashcardsBtn.addEventListener('click', function() {
                queueFeatureActionAfterUserBubble('Flashcards', function() {
                    generateFlashcards({ skipUserBubble: true });
                });
            });
        }
        if (clearChatBtn) {
            clearChatBtn.addEventListener('click', function() {
                queueFeatureActionAfterUserBubble('Clear Chat', function() {
                    scheduleClearChatKeywordSequence({ skipUserBubble: true });
                });
            });
        }

        const conversationHistory = [];

        function normalizeSummaryParagraph(text) {
            if (!text) return '';
            var t = text.split(/\r?\n/)
                .map(function(line) {
                    return line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim();
                })
                .filter(Boolean)
                .join(' ');
            t = t.replace(/\s+[-*•]\s+(?=[A-Za-z(])/g, ' ');
            return t.replace(/\s+/g, ' ').trim();
        }

        function splitQuizIntoBlocks(text) {
            if (!text || !text.trim()) return [text];
            var parts = text.trim().split(/(?=^\d+\.\s|^Question \d+[:.]\s|^Answers:)/im);
            var blocks = parts.map(function(p) { return p.trim(); }).filter(function(p) { return p.length > 0; });
            if (blocks.length <= 1) return [text];
            return blocks;
        }

        
        function stripAssistantMarkdownBold(s) {
            if (!s || typeof s !== 'string') return s;
            var out = s;
            var prev;
            do {
                prev = out;
                out = out.replace(/\*\*([^*]+)\*\*/g, '$1');
            } while (out !== prev);
            return out.replace(/\*\*/g, '');
        }

        function addMessage(content, isUser, opts) {
            opts = opts || {};
            var storedContent = content;
            if (!isUser && typeof content === 'string') {
                storedContent = stripAssistantMarkdownBold(content);
            }
            var messageDiv = document.createElement('div');
            messageDiv.className = 'message ' + (isUser ? 'user' : 'assistant');
            
            var contentDiv = document.createElement('div');
            contentDiv.className = 'message-content' + (opts.contentClass ? ' ' + opts.contentClass : '');
            contentDiv.textContent = storedContent;
            
            messageDiv.appendChild(contentDiv);
            chatMessages.appendChild(messageDiv);
            chatMessages.scrollTop = chatMessages.scrollHeight;

            if (!opts.noHistory) {
                conversationHistory.push({ role: isUser ? 'user' : 'assistant', content: storedContent });
            }
            if (!opts.skipNotify) {
                notifyParentChatProgressIfChanged();
            }
        }

        function addAssistantResponse(fullResponse, opts) {
            opts = opts || {};
            var blocks = splitQuizIntoBlocks(fullResponse);
            var cleanedFull = stripAssistantMarkdownBold(fullResponse);
            if (blocks.length > 1) {
                blocks.forEach(function(block, i) {
                    addMessage(block, false, { noHistory: true });
                });
                conversationHistory.push({ role: 'assistant', content: cleanedFull });
                notifyParentChatProgressIfChanged();
            } else {
                addMessage(fullResponse, false, { contentClass: opts.contentClass });
            }
        }

        var quizState = null;

        function stopPodcastPlayback() {
            if (activePodcastAudio) {
                try {
                    activePodcastAudio.pause();
                    activePodcastAudio.currentTime = 0;
                } catch (err) {}
                activePodcastAudio = null;
            }
        }

        function formatPodcastTime(sec) {
            if (!isFinite(sec) || sec < 0) return '0:00';
            var m = Math.floor(sec / 60);
            var s = Math.floor(sec % 60);
            return m + ':' + (s < 10 ? '0' : '') + s;
        }

        function addPodcastPlayer(audioUrl, title, noteId) {
            var msgDiv = document.createElement('div');
            msgDiv.className = 'message assistant';
            msgDiv.setAttribute('data-feature-podcast', String(noteId));

            var wrap = document.createElement('div');
            wrap.className = 'message-content chat-podcast-player';

            var head = document.createElement('div');
            head.className = 'chat-podcast-player-title';
            head.textContent = (title || 'Podcast').length > 42 ? (title || 'Podcast').slice(0, 39) + '…' : (title || 'Podcast');

            var audio = document.createElement('audio');
            audio.preload = 'metadata';
            audio.src = audioUrl;
            audio.style.display = 'none';
            audio.setAttribute('aria-hidden', 'true');

            var barRow = document.createElement('div');
            barRow.className = 'chat-podcast-bar-row';
            var curEl = document.createElement('span');
            curEl.className = 'chat-podcast-time';
            curEl.textContent = '0:00';
            var seekWrap = document.createElement('div');
            seekWrap.className = 'chat-podcast-seek-wrap';
            var range = document.createElement('input');
            range.type = 'range';
            range.className = 'chat-podcast-seek';
            range.min = '0';
            range.max = '100';
            range.value = '0';
            seekWrap.appendChild(range);
            var totEl = document.createElement('span');
            totEl.className = 'chat-podcast-time';
            totEl.textContent = '0:00';

            var menuWrap = document.createElement('div');
            menuWrap.className = 'chat-podcast-menu-wrap';
            var menuBtn = document.createElement('button');
            menuBtn.type = 'button';
            menuBtn.className = 'chat-podcast-menu-btn';
            menuBtn.setAttribute('aria-label', 'More options');
            menuBtn.setAttribute('aria-expanded', 'false');
            menuBtn.setAttribute('aria-haspopup', 'true');
            menuBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>';
            var dropdown = document.createElement('div');
            dropdown.className = 'chat-podcast-menu-dropdown';
            dropdown.setAttribute('role', 'menu');
            var dl = document.createElement('a');
            dl.className = 'chat-podcast-download';
            dl.href = audioUrl;
            dl.setAttribute('download', 'podcast-note-' + noteId + '.mp3');
            dl.setAttribute('role', 'menuitem');
            dl.innerHTML = '<svg class="chat-podcast-download-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M12 5v10m0 0l-4-4m4 4l4-4"/><path stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M5 19h14"/></svg><span>Download</span>';
            dropdown.appendChild(dl);
            menuWrap.appendChild(menuBtn);
            menuWrap.appendChild(dropdown);

            menuBtn.addEventListener('click', function(ev) {
                ev.stopPropagation();
                var willOpen = !dropdown.classList.contains('is-open');
                document.querySelectorAll('.chat-podcast-menu-dropdown.is-open').forEach(function(other) {
                    if (other !== dropdown) {
                        other.classList.remove('is-open');
                        var ow = other.closest('.chat-podcast-menu-wrap');
                        if (ow) {
                            var ob = ow.querySelector('.chat-podcast-menu-btn');
                            if (ob) ob.setAttribute('aria-expanded', 'false');
                        }
                    }
                });
                dropdown.classList.toggle('is-open', willOpen);
                menuBtn.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
            });

            dl.addEventListener('click', function() {
                dropdown.classList.remove('is-open');
                menuBtn.setAttribute('aria-expanded', 'false');
            });

            barRow.appendChild(curEl);
            barRow.appendChild(seekWrap);
            barRow.appendChild(totEl);
            barRow.appendChild(menuWrap);

            var playRow = document.createElement('div');
            playRow.className = 'chat-podcast-play-row';
            var playBtn = document.createElement('button');
            playBtn.type = 'button';
            playBtn.className = 'chat-podcast-play-toggle';
            playBtn.setAttribute('aria-label', 'Play');
            playBtn.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M8 5v14l11-7-11-7z" fill="currentColor"/></svg>';
            playRow.appendChild(playBtn);

            wrap.appendChild(head);
            wrap.appendChild(barRow);
            wrap.appendChild(playRow);
            wrap.appendChild(audio);

            msgDiv.appendChild(wrap);
            chatMessages.appendChild(msgDiv);
            chatMessages.scrollTop = chatMessages.scrollHeight;
            notifyParentChatProgressIfChanged();

            function updateTimes() {
                var d = audio.duration;
                var t = audio.currentTime;
                if (isFinite(d) && d > 0) {
                    totEl.textContent = formatPodcastTime(d);
                    range.max = String(d);
                    range.value = String(t);
                }
                curEl.textContent = formatPodcastTime(t);
            }

            audio.addEventListener('loadedmetadata', updateTimes);
            var seeking = false;
            range.addEventListener('mousedown', function() { seeking = true; });
            range.addEventListener('mouseup', function() { seeking = false; updateTimes(); });
            range.addEventListener('touchstart', function() { seeking = true; }, { passive: true });
            range.addEventListener('touchend', function() { seeking = false; updateTimes(); });

            audio.addEventListener('timeupdate', function() {
                if (!seeking && isFinite(audio.duration) && audio.duration > 0) {
                    range.value = String(audio.currentTime);
                }
                curEl.textContent = formatPodcastTime(audio.currentTime);
            });
            audio.addEventListener('ended', function() {
                playBtn.setAttribute('aria-label', 'Play');
                playBtn.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M8 5v14l11-7-11-7z" fill="currentColor"/></svg>';
                activePodcastAudio = null;
            });

            range.addEventListener('input', function() {
                var v = parseFloat(range.value);
                if (isFinite(audio.duration) && audio.duration > 0 && isFinite(v)) {
                    audio.currentTime = v;
                }
            });

            playBtn.addEventListener('click', function(ev) {
                ev.stopPropagation();
                if (audio.paused) {
                    stopPodcastPlayback();
                    activePodcastAudio = audio;
                    audio.play().catch(function() {});
                    playBtn.setAttribute('aria-label', 'Pause');
                    playBtn.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><rect x="6" y="5" width="4" height="14" fill="currentColor"/><rect x="14" y="5" width="4" height="14" fill="currentColor"/></svg>';
                } else {
                    audio.pause();
                    playBtn.setAttribute('aria-label', 'Play');
                    playBtn.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M8 5v14l11-7-11-7z" fill="currentColor"/></svg>';
                    if (activePodcastAudio === audio) activePodcastAudio = null;
                }
            });
        }

        var ARROW_PREV_SVG = '<svg class="chat-flashcards-arrow" width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M15 18L9 12L15 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        var ARROW_NEXT_SVG = '<svg class="chat-flashcards-arrow" width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M9 18L15 12L9 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        var ICON_TICK_SVG = '<svg class="chat-flashcards-rate-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M20 6L9 17l-5-5" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        var ICON_X_SVG = '<svg class="chat-flashcards-rate-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2.25" stroke-linecap="round"/></svg>';

        function findLastFlashcardsUserBubble() {
            var rows = chatMessages.querySelectorAll('.message.user');
            var i;
            for (i = rows.length - 1; i >= 0; i--) {
                var cd = rows[i].querySelector('.message-content');
                var t = (cd && cd.textContent || '').trim();
                if (/^flashcards$/i.test(t)) return rows[i];
            }
            return null;
        }

        
        function insertAssistantFlashcardsMessageEl(msgDiv) {
            var anchor = findLastFlashcardsUserBubble();
            if (!anchor || anchor.parentNode !== chatMessages) {
                chatMessages.appendChild(msgDiv);
                return;
            }
            if (anchor.nextSibling) {
                chatMessages.insertBefore(msgDiv, anchor.nextSibling);
            } else {
                chatMessages.appendChild(msgDiv);
            }
        }

        function mountFlashcardsCompletionUI(cardEl, cardsArr, noteId) {
            var n = cardsArr.length;
            cardEl.innerHTML =
                '<div class="chat-flashcards-done">' +
                '<p class="chat-flashcards-done-msg">You\'ve finished all ' + n + ' flashcards in this set.</p>' +
                '</div>';
            if (noteId != null) {
                var k0 = String(noteId);
                featureStateByNote[k0] = featureStateByNote[k0] || {};
                featureStateByNote[k0].userActivatedFlashcards = true;
                featureStateByNote[k0].flashcards = { complete: true };
                schedulePersistChatHistoryToServer();
            }
            notifyParentChatProgressIfChanged();
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }

        function renderFlashcards(cards, opts, noteId, reuseMsgDiv) {
            opts = opts || {};
            if (!cards || !cards.length) {
                addMessage('No flashcards available.', false);
                return;
            }
            var n = cards.length;

            if (opts.sessionComplete && cards.length) {
                var msgDivDone = reuseMsgDiv;
                if (!msgDivDone) {
                    msgDivDone = document.createElement('div');
                    msgDivDone.className = 'message assistant';
                    if (noteId != null) msgDivDone.setAttribute('data-feature-flashcards', String(noteId));
                    insertAssistantFlashcardsMessageEl(msgDivDone);
                } else {
                    msgDivDone.innerHTML = '';
                    msgDivDone.className = 'message assistant';
                    if (noteId != null) msgDivDone.setAttribute('data-feature-flashcards', String(noteId));
                }
                var cardDone = document.createElement('div');
                cardDone.className = 'message-content chat-flashcards';
                msgDivDone.appendChild(cardDone);
                mountFlashcardsCompletionUI(cardDone, cards, noteId);
                return;
            }

            var msgDiv = reuseMsgDiv;
            if (!msgDiv) {
                msgDiv = document.createElement('div');
                msgDiv.className = 'message assistant';
                if (noteId != null) msgDiv.setAttribute('data-feature-flashcards', String(noteId));
                insertAssistantFlashcardsMessageEl(msgDiv);
            } else {
                msgDiv.innerHTML = '';
                msgDiv.className = 'message assistant';
                if (noteId != null) msgDiv.setAttribute('data-feature-flashcards', String(noteId));
            }

            var card = document.createElement('div');
            card.className = 'message-content chat-flashcards';
            msgDiv.appendChild(card);
            notifyParentChatProgressIfChanged();

            function normalizeRatings(arr, len) {
                var out = new Array(len);
                var i;
                for (i = 0; i < len; i++) {
                    if (arr && i < arr.length) {
                        if (arr[i] === true) out[i] = true;
                        else if (arr[i] === false) out[i] = false;
                        else out[i] = null;
                    } else {
                        out[i] = null;
                    }
                }
                return out;
            }

            function allFlashcardRatingsFilled(rated) {
                return rated && rated.length && rated.every(function(r) { return r === true || r === false; });
            }

            var state = {
                cards: cards,
                index: typeof opts.startIndex === 'number' ? opts.startIndex : 0,
                showingBack: !!opts.startShowingBack,
                rated: normalizeRatings(opts.startRatings, n),
                sessionDone: false
            };
            if (state.index < 0 || state.index >= state.cards.length) state.index = 0;

            var feedbackHideTimer = null;
            var gotItAdvanceTimer = null;

            function showFeedbackOverlay(message, skipAutoHide) {
                var ov = card.querySelector('.chat-flashcards-feedback-overlay');
                if (!ov) return;
                clearTimeout(feedbackHideTimer);
                ov.textContent = message;
                ov.classList.add('is-visible');
                ov.setAttribute('aria-hidden', 'false');
                if (!skipAutoHide) {
                    feedbackHideTimer = setTimeout(function() {
                        hideFeedbackOverlay();
                    }, 550);
                }
                ov.onclick = function(ev) {
                    ev.stopPropagation();
                    hideFeedbackOverlay();
                };
            }

            function hideFeedbackOverlay() {
                var ov = card.querySelector('.chat-flashcards-feedback-overlay');
                clearTimeout(feedbackHideTimer);
                feedbackHideTimer = null;
                if (!ov) return;
                ov.onclick = null;
                ov.classList.remove('is-visible');
                ov.textContent = '';
                ov.setAttribute('aria-hidden', 'true');
            }

            function persistFlashcardState() {
                if (noteId == null) return;
                var k = String(noteId);
                featureStateByNote[k] = featureStateByNote[k] || {};
                if (state.sessionDone) {
                    featureStateByNote[k].flashcards = { complete: true };
                } else {
                    featureStateByNote[k].flashcards = {
                        index: state.index,
                        showingBack: state.showingBack,
                        ratings: state.rated.slice()
                    };
                }
                schedulePersistChatHistoryToServer();
            }

            function showFlashcardsCompleteScreen() {
                if (state.sessionDone) return;
                state.sessionDone = true;
                clearTimeout(feedbackHideTimer);
                clearTimeout(gotItAdvanceTimer);
                feedbackHideTimer = null;
                gotItAdvanceTimer = null;
                mountFlashcardsCompletionUI(card, state.cards, noteId);
            }

            function bindFlipHandlers() {
                var scene = card.querySelector('.chat-flashcards-scene');
                var flipInner = card.querySelector('.chat-flashcards-flip');
                if (!scene || !flipInner) return;

                scene.addEventListener('click', function(e) {
                    if (e.target.closest('.chat-flashcards-feedback-overlay')) return;
                    if (e.target.closest('.chat-flashcards-controls')) return;
                    state.showingBack = !state.showingBack;
                    flipInner.classList.toggle('is-flipped', state.showingBack);
                    persistFlashcardState();
                });
            }

            function draw() {
                if (state.sessionDone) return;
                clearTimeout(feedbackHideTimer);
                clearTimeout(gotItAdvanceTimer);
                feedbackHideTimer = null;
                gotItAdvanceTimer = null;
                var item = state.cards[state.index];
                card.innerHTML =
                    '<div class="chat-flashcards-header">Flashcard ' + (state.index + 1) + ' of ' + state.cards.length + '</div>' +
                    '<div class="chat-flashcards-scene-wrap">' +
                        '<div class="chat-flashcards-scene">' +
                            '<div class="chat-flashcards-flip' + (state.showingBack ? ' is-flipped' : '') + '">' +
                                '<div class="chat-flashcards-side chat-flashcards-front">' +
                                    '<span class="chat-flashcards-label">Question</span>' +
                                    '<div class="chat-flashcards-main"></div>' +
                                    '<span class="chat-flashcards-view-hint">View answer</span>' +
                                '</div>' +
                                '<div class="chat-flashcards-side chat-flashcards-back">' +
                                    '<span class="chat-flashcards-label">Answer</span>' +
                                    '<div class="chat-flashcards-main"></div>' +
                                    '<span class="chat-flashcards-view-hint">View question</span>' +
                                '</div>' +
                            '</div>' +
                        '</div>' +
                        '<div class="chat-flashcards-feedback-overlay" aria-hidden="true"></div>' +
                    '</div>' +
                    '<div class="chat-flashcards-controls">' +
                        '<button type="button" class="chat-flashcards-btn chat-flashcards-nav" data-action="prev" aria-label="Previous">' + ARROW_PREV_SVG + '</button>' +
                        '<button type="button" class="chat-flashcards-rate chat-flashcards-rate-good' + (state.rated[state.index] === true ? ' is-pressed' : '') + '" data-rate="good" aria-label="Got it">' + ICON_TICK_SVG + '</button>' +
                        '<button type="button" class="chat-flashcards-rate chat-flashcards-rate-bad' + (state.rated[state.index] === false ? ' is-pressed' : '') + '" data-rate="bad" aria-label="Review again">' + ICON_X_SVG + '</button>' +
                        '<button type="button" class="chat-flashcards-btn chat-flashcards-nav" data-action="next" aria-label="Next">' + ARROW_NEXT_SVG + '</button>' +
                    '</div>';

                var frontMain = card.querySelector('.chat-flashcards-front .chat-flashcards-main');
                var backMain = card.querySelector('.chat-flashcards-back .chat-flashcards-main');
                if (frontMain && backMain) {
                    var ft = document.createElement('span');
                    ft.className = 'chat-flashcards-text';
                    ft.textContent = stripAssistantMarkdownBold(item.front || '');
                    frontMain.appendChild(ft);
                    var bt = document.createElement('span');
                    bt.className = 'chat-flashcards-text';
                    bt.textContent = stripAssistantMarkdownBold(item.back || '');
                    backMain.appendChild(bt);
                }

                card.querySelectorAll('.chat-flashcards-controls .chat-flashcards-nav').forEach(function(btn) {
                    btn.addEventListener('click', function(ev) {
                        ev.stopPropagation();
                        var action = btn.getAttribute('data-action');
                        if (action === 'prev') {
                            state.index = (state.index - 1 + state.cards.length) % state.cards.length;
                            state.showingBack = false;
                            draw();
                        } else if (action === 'next') {
                            if (state.rated[state.index] == null) {
                                state.rated[state.index] = false;
                            }
                            if (allFlashcardRatingsFilled(state.rated)) {
                                persistFlashcardState();
                                showFlashcardsCompleteScreen();
                                return;
                            }
                            state.index = (state.index + 1) % state.cards.length;
                            state.showingBack = false;
                            draw();
                        }
                    });
                });

                card.querySelectorAll('.chat-flashcards-rate').forEach(function(btn) {
                    btn.addEventListener('click', function(ev) {
                        ev.stopPropagation();
                        var rate = btn.getAttribute('data-rate');
                        if (rate === 'good') {
                            state.rated[state.index] = true;
                            persistFlashcardState();
                            if (allFlashcardRatingsFilled(state.rated)) {
                                showFeedbackOverlay('Got it!', true);
                                btn.classList.add('is-pressed');
                                card.querySelectorAll('.chat-flashcards-rate-bad').forEach(function(b) { b.classList.remove('is-pressed'); });
                                clearTimeout(gotItAdvanceTimer);
                                gotItAdvanceTimer = setTimeout(function() {
                                    gotItAdvanceTimer = null;
                                    hideFeedbackOverlay();
                                    showFlashcardsCompleteScreen();
                                }, 450);
                                return;
                            }
                            showFeedbackOverlay('Got it!', true);
                            btn.classList.add('is-pressed');
                            card.querySelectorAll('.chat-flashcards-rate-bad').forEach(function(b) { b.classList.remove('is-pressed'); });
                            clearTimeout(gotItAdvanceTimer);
                            gotItAdvanceTimer = setTimeout(function() {
                                gotItAdvanceTimer = null;
                                hideFeedbackOverlay();
                                state.index = (state.index + 1) % state.cards.length;
                                state.showingBack = false;
                                draw();
                            }, 550);
                        } else {
                            clearTimeout(gotItAdvanceTimer);
                            gotItAdvanceTimer = null;
                            state.rated[state.index] = false;
                            persistFlashcardState();
                            showFeedbackOverlay('Try again!');
                            btn.classList.add('is-pressed');
                            card.querySelectorAll('.chat-flashcards-rate-good').forEach(function(b) { b.classList.remove('is-pressed'); });
                            if (allFlashcardRatingsFilled(state.rated)) {
                                setTimeout(function() {
                                    hideFeedbackOverlay();
                                    showFlashcardsCompleteScreen();
                                }, 600);
                            }
                        }
                    });
                });

                bindFlipHandlers();
                persistFlashcardState();
                chatMessages.scrollTop = chatMessages.scrollHeight;
            }

            draw();
            if (!state.sessionDone && allFlashcardRatingsFilled(state.rated)) {
                showFlashcardsCompleteScreen();
            }
        }

        function applyQuizAnswerVisuals(state, chosen) {
            var q = state.questions[state.index];
            var options = state.cardEl.querySelectorAll('.chat-quiz-option');
            options.forEach(function(b, i) {
                b.disabled = true;
                if (i === q.correctIndex) b.classList.add('correct');
                else if (i === chosen) b.classList.add('incorrect');
            });
            var feedback = state.cardEl.querySelector('#quiz-feedback');
            if (!feedback) return;
            feedback.className = 'chat-quiz-feedback show ' + (chosen === q.correctIndex ? 'correct' : 'incorrect');
            feedback.textContent = chosen === q.correctIndex
                ? 'Correct!'
                : 'Incorrect. The correct answer was: ' + stripAssistantMarkdownBold(String(q.options[q.correctIndex] || ''));
            var nx = state.cardEl.querySelector('#quiz-next');
            if (nx) nx.classList.add('show');
        }

        function renderQuizCard(state) {
            var q = state.questions[state.index];
            var total = state.questions.length;
            var header = 'Question ' + (state.index + 1) + ' of ' + total;
            var optionsHtml = q.options.map(function(opt, i) {
                var label = stripAssistantMarkdownBold(String(opt != null ? opt : ''));
                if (!label.trim()) label = 'Option ' + (i + 1);
                return '<button type="button" class="chat-quiz-option" data-index="' + i + '">' + label + '</button>';
            }).join('');
            state.cardEl.innerHTML =
                '<div class="chat-quiz-header">' + header + '</div>' +
                '<div class="chat-quiz-question">' + stripAssistantMarkdownBold(q.question || '') + '</div>' +
                '<div class="chat-quiz-options">' + optionsHtml + '</div>' +
                '<div class="chat-quiz-feedback" id="quiz-feedback"></div>' +
                '<button type="button" class="chat-quiz-next" id="quiz-next">Next</button>';
            state.cardEl.querySelectorAll('.chat-quiz-option').forEach(function(btn) {
                btn.addEventListener('click', function() {
                    if (state.answered) return;
                    var chosen = parseInt(btn.getAttribute('data-index'), 10);
                    state.answered = true;
                    state.choiceIndex = chosen;
                    state.answers.push(chosen === q.correctIndex);
                    applyQuizAnswerVisuals(state, chosen);
                    chatMessages.scrollTop = chatMessages.scrollHeight;
                    schedulePersistChatHistoryToServer();
                });
            });
            state.cardEl.querySelector('#quiz-next').addEventListener('click', function() {
                state.index++;
                state.answered = false;
                state.choiceIndex = null;
                schedulePersistChatHistoryToServer();
                if (state.index >= state.questions.length) {
                    var correct = state.answers.filter(Boolean).length;
                    state.cardEl.innerHTML =
                        '<div class="chat-quiz-done">Quiz complete! You got ' + correct + ' out of ' + state.questions.length + ' correct.</div>';
                    conversationHistory.push({ role: 'assistant', content: 'Quiz complete! You got ' + correct + ' out of ' + state.questions.length + ' correct.' });
                    quizState = null;
                    var qk = lastNoteId != null ? String(lastNoteId) : '';
                    if (qk && featureStateByNote[qk]) delete featureStateByNote[qk].quiz;
                    notifyParentChatProgressIfChanged();
                } else {
                    renderQuizCard(state);
                }
                chatMessages.scrollTop = chatMessages.scrollHeight;
            });
        }

        function restoreRichChatFeaturesFromState(noteKey) {
            var fs = featureStateByNote[noteKey];
            if (!fs || !fs.quiz || !fs.quiz.questions || !fs.quiz.questions.length) return;
            var q = fs.quiz;
            if (q.index >= q.questions.length) {
                var msgDivDone = document.createElement('div');
                msgDivDone.className = 'message assistant';
                var cardDone = document.createElement('div');
                cardDone.className = 'message-content chat-quiz';
                var correct = (q.answers || []).filter(Boolean).length;
                cardDone.innerHTML =
                    '<div class="chat-quiz-done">Quiz complete! You got ' + correct + ' out of ' + q.questions.length + ' correct.</div>';
                msgDivDone.appendChild(cardDone);
                chatMessages.appendChild(msgDivDone);
                chatMessages.scrollTop = chatMessages.scrollHeight;
                return;
            }
            var msgDiv = document.createElement('div');
            msgDiv.className = 'message assistant';
            var card = document.createElement('div');
            card.className = 'message-content chat-quiz';
            msgDiv.appendChild(card);
            chatMessages.appendChild(msgDiv);
            quizState = {
                questions: q.questions,
                index: q.index,
                answers: Array.isArray(q.answers) ? q.answers.slice() : [],
                answered: !!q.answered,
                choiceIndex: typeof q.choiceIndex === 'number' ? q.choiceIndex : null,
                cardEl: card,
                scope: q.scope || 'current_note'
            };
            renderQuizCard(quizState);
            if (quizState.answered && typeof quizState.choiceIndex === 'number') {
                applyQuizAnswerVisuals(quizState, quizState.choiceIndex);
            }
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }

        async function startQuiz(scope, opts) {
            opts = opts || {};
            scope = scope || 'current_note';
            var startTime = Date.now();
            if (quizMeBtn.disabled && (quizMeGeneralBtn && quizMeGeneralBtn.disabled)) return;
            quizMeBtn.disabled = true;
            if (quizMeGeneralBtn) quizMeGeneralBtn.disabled = true;
            sendButton.disabled = true;
            chatInput.disabled = true;
            if (summariseBtn) summariseBtn.disabled = true;
            if (!opts.skipUserBubble) {
                addMessage(scope === 'general' ? 'Topic Quiz' : 'Note Quiz', true);
            }
            showLoading();
            chatAbortController = new AbortController();
            sendButton.classList.add('is-loading');
            sendButton.disabled = false;
            sendButton.setAttribute('title', 'Stop');
            sendButton.setAttribute('aria-label', 'Stop');
            try {
                var note = await getNoteFromParent();
                var response = await fetch('/quiz_api', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ note_title: note.title, note_content: note.content, scope: scope }),
                    signal: chatAbortController.signal
                });
                var data = await response.json();
                await hideLoadingWithDelay(startTime);
                if (!data.success || !data.questions || !data.questions.length) {
                    addMessage(data.error || 'Could not generate quiz. Try again.', false);
                    return;
                }
                if (scope !== 'general' && note.note_id != null) notifyNoteAiActivity(note.note_id);
                var msgDiv = document.createElement('div');
                msgDiv.className = 'message assistant';
                var card = document.createElement('div');
                card.className = 'message-content chat-quiz';
                msgDiv.appendChild(card);
                chatMessages.appendChild(msgDiv);
                chatMessages.scrollTop = chatMessages.scrollHeight;
                quizState = {
                    questions: data.questions,
                    index: 0,
                    answers: [],
                    answered: false,
                    choiceIndex: null,
                    cardEl: card,
                    scope: scope
                };
                renderQuizCard(quizState);
                schedulePersistChatHistoryToServer();
            } catch (e) {
                await hideLoadingWithDelay(startTime);
                if (e.name === 'AbortError') {
                    addMessage('Stopped.', false);
                } else {
                    addMessage('Sorry, something went wrong. Please try again.', false);
                    console.error(e);
                }
            } finally {
                chatAbortController = null;
                sendButton.classList.remove('is-loading');
                sendButton.setAttribute('title', 'Send');
                sendButton.setAttribute('aria-label', 'Send');
                quizMeBtn.disabled = false;
                if (quizMeGeneralBtn) quizMeGeneralBtn.disabled = false;
                if (podcastBtn) podcastBtn.disabled = false;
                if (flashcardsBtn) flashcardsBtn.disabled = false;
                if (clearChatBtn) clearChatBtn.disabled = false;
                sendButton.disabled = false;
                chatInput.disabled = false;
                if (summariseBtn) summariseBtn.disabled = false;
                chatInput.focus();
            }
        }

        function showLoading() {
            const loadingDiv = document.createElement('div');
            loadingDiv.className = 'message assistant';
            loadingDiv.id = 'loading-message';
            loadingDiv.innerHTML = '<div class="loading"><div class="loading-dot"></div><div class="loading-dot"></div><div class="loading-dot"></div></div>';
            chatMessages.appendChild(loadingDiv);
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }

        function hideLoading() {
            const loading = document.getElementById('loading-message');
            if (loading) loading.remove();
        }

        const MIN_LOADING_MS = 900;

        async function hideLoadingWithDelay(startTime) {
            var elapsed = Date.now() - startTime;
            if (elapsed < MIN_LOADING_MS) {
                await new Promise(function(resolve) {
                    setTimeout(resolve, MIN_LOADING_MS - elapsed);
                });
            }
            hideLoading();
        }

        function normalizeKeywordPhrase(text) {
            var t = (text || '').trim().replace(/\s+/g, ' ');
            t = t.replace(/[.!?]+$/g, '').trim();
            return t.toLowerCase();
        }

        
        function matchNaturalLanguageQuickAction(text) {
            var t = (text || '').trim().toLowerCase();
            if (!t) return null;

            if (/\b(clear|reset|empty)\s+(the\s+)?chat\b/.test(t)) return 'clearChat';
            if (/^(start over|new chat|erase chat)$/.test(t)) return 'clearChat';

            if (/\btopic\s+quiz\b/.test(t)) return 'topicQuiz';
            if (/\bquiz\s+(me\s+)?on\s+(the\s+)?topic\b/.test(t)) return 'topicQuiz';
            if (/\bquiz\b/.test(t) && /\btopic\b/.test(t) && !/\bnote\b/.test(t)) return 'topicQuiz';
            if (/\b(broader|general|wider)\s+(topic\s+)?quiz\b/.test(t)) return 'topicQuiz';

            if (/\bnote\s+quiz\b/.test(t)) return 'noteQuiz';
            if (/\bquiz\s+me\b/.test(t)) return 'noteQuiz';
            if (/\btest\s+me\s+on\s+(this\s+)?(the\s+)?note\b/.test(t)) return 'noteQuiz';
            if (/\bquiz\b/.test(t) && /\b(this\s+|the\s+|my\s+)?note\b/.test(t) && !/\btopic\b/.test(t)) return 'noteQuiz';

            if (/\bsummari[sz]e\b/.test(t) && /\b(note|this)\b/.test(t)) return 'summarise';
            if (/\bgive\s+me\s+(a\s+)?summary\b/.test(t)) return 'summarise';
            if (/\bsummary\s+of\s+(the\s+|this\s+|my\s+)?note\b/.test(t)) return 'summarise';
            if (/\bsum\s+up\s+(this\s+|the\s+|my\s+)?note\b/.test(t)) return 'summarise';
            if (/\btldr\b/.test(t)) return 'summarise';

            if (/\bpodcast\b/.test(t)) {
                if (/\b(make|made|generate|created?|create|give|gave|want|wanted|build)\b/.test(t)) return 'podcast';
                if (/\b(on|for|from|about)\s+(this\s+)?note\b/.test(t)) return 'podcast';
            }
            if (/\b(make|generate|create|give)\s+(me\s+)?(or\s+)?(generate\s+)?(me\s+)?(a\s+)?podcast\b/.test(t)) return 'podcast';

            if (/\bflashcards?\b/.test(t) && /\b(make|generate|create|give|build)\b/.test(t)) return 'flashcards';
            if (/\b(make|generate|create)\s+(me\s+)?(some\s+)?flashcards?\b/.test(t)) return 'flashcards';
            if (/\bflashcards?\s+(from|for|on)\s+(this\s+)?note\b/.test(t)) return 'flashcards';

            return null;
        }

        function matchQuickActionKeyword(text) {
            var lower = normalizeKeywordPhrase(text);
            if (lower === 'summarise' || lower === 'summarize') return 'summarise';
            if (lower === 'note quiz' || lower === 'quiz me') return 'noteQuiz';
            if (lower === 'topic quiz') return 'topicQuiz';
            if (lower === 'podcast') return 'podcast';
            if (lower === 'flashcards') return 'flashcards';
            if (lower === 'clear chat') return 'clearChat';

            return matchNaturalLanguageQuickAction(text);
        }

        function quickActionDisplayLabel(kw) {
            switch (kw) {
                case 'summarise': return 'Summarise';
                case 'noteQuiz': return 'Note Quiz';
                case 'topicQuiz': return 'Topic Quiz';
                case 'podcast': return 'Podcast';
                case 'flashcards': return 'Flashcards';
                default: return '';
            }
        }

        async function sendMessage(messageOverride, opts) {
            opts = opts || {};
            var summarise = !!opts.summarise;

            if (sendButton.disabled) return;

            if (!summarise && typeof messageOverride !== 'string' && !opts._skipKeywordActions) {
                var kw = matchQuickActionKeyword(chatInput.value.trim());
                if (kw) {
                    chatInput.value = '';
                    chatInput.style.height = 'auto';
                    resizeChatInput();
                    if (kw === 'clearChat') {
                        queueFeatureActionAfterUserBubble('Clear Chat', function() {
                            scheduleClearChatKeywordSequence({ skipUserBubble: true });
                        });
                        return;
                    }
                    addMessage(quickActionDisplayLabel(kw), true);
                    setTimeout(function() {
                        if (kw === 'summarise') sendMessage('', { summarise: true, _skipKeywordActions: true, _userBubbleAlreadyAdded: true });
                        else if (kw === 'noteQuiz') triggerNoteQuiz({ skipUserBubble: true });
                        else if (kw === 'topicQuiz') startQuiz('general', { skipUserBubble: true });
                        else if (kw === 'podcast') generatePodcast({ skipUserBubble: true });
                        else if (kw === 'flashcards') generateFlashcards({ skipUserBubble: true });
                    }, FEATURE_ACTION_DELAY_MS);
                    return;
                }
            }

            var fromInput = chatInput.value.trim();
            var apiMessage = summarise ? '' : (typeof messageOverride === 'string' ? messageOverride : fromInput);
            if (!summarise && !apiMessage) return;

            var startTime = Date.now();

            if (!opts._userBubbleAlreadyAdded) {
                addMessage(summarise ? 'Summarise' : apiMessage, true);
            }
            if (typeof messageOverride !== 'string' && !summarise) {
                chatInput.value = '';
                chatInput.style.height = 'auto';
                resizeChatInput();
            }
            
            sendButton.disabled = true;
            chatInput.disabled = true;
            if (summariseBtn) summariseBtn.disabled = true;
            if (quizMeBtn) quizMeBtn.disabled = true;
            if (quizMeGeneralBtn) quizMeGeneralBtn.disabled = true;
            if (podcastBtn) podcastBtn.disabled = true;
            if (flashcardsBtn) flashcardsBtn.disabled = true;
            if (clearChatBtn) clearChatBtn.disabled = true;
            showLoading();
            chatAbortController = new AbortController();
            sendButton.classList.add('is-loading');
            sendButton.disabled = false;
            sendButton.setAttribute('title', 'Stop');
            sendButton.setAttribute('aria-label', 'Stop');

            try {
                const note = await getNoteFromParent();
                if (note.note_id != null) notifyNoteAiActivity(note.note_id);
                const history = conversationHistory.slice(0, -1).slice(-20);
                const response = await fetch('/chat_api', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        summarise: summarise,
                        message: apiMessage,
                        history: history,
                        note_title: note.title,
                        note_content: note.content
                    }),
                    signal: chatAbortController.signal
                });

                const data = await response.json();
                await hideLoadingWithDelay(startTime);

                if (data.success && data.response) {
                    var reply = summarise ? normalizeSummaryParagraph(data.response) : data.response;
                    addAssistantResponse(reply, summarise ? { contentClass: 'message-summary-justify' } : {});
                } else {
                    const errMsg = data.error || 'Sorry, I encountered an error. Please try again.';
                    addMessage(errMsg, false);
                }
            } catch (error) {
                await hideLoadingWithDelay(startTime);
                if (error.name === 'AbortError') {
                    addMessage('Stopped.', false);
                } else {
                    addMessage('Sorry, I encountered an error. Please try again.', false);
                    console.error('Chat error:', error);
                }
            } finally {
                chatAbortController = null;
                sendButton.classList.remove('is-loading');
                sendButton.setAttribute('title', 'Send');
                sendButton.setAttribute('aria-label', 'Send');
                sendButton.disabled = false;
                chatInput.disabled = false;
                if (summariseBtn) summariseBtn.disabled = false;
                if (quizMeBtn) quizMeBtn.disabled = false;
                if (quizMeGeneralBtn) quizMeGeneralBtn.disabled = false;
                if (podcastBtn) podcastBtn.disabled = false;
                if (flashcardsBtn) flashcardsBtn.disabled = false;
                if (clearChatBtn) clearChatBtn.disabled = false;
                chatInput.focus();
            }
        }

        async function generatePodcast(opts) {
            opts = opts || {};
            if (sendButton.disabled) return;
            var startTime = Date.now();
            if (!opts.skipUserBubble) addMessage('Podcast', true);
            sendButton.disabled = true;
            chatInput.disabled = true;
            if (summariseBtn) summariseBtn.disabled = true;
            if (quizMeBtn) quizMeBtn.disabled = true;
            if (quizMeGeneralBtn) quizMeGeneralBtn.disabled = true;
            if (podcastBtn) podcastBtn.disabled = true;
            if (flashcardsBtn) flashcardsBtn.disabled = true;
            if (clearChatBtn) clearChatBtn.disabled = true;
            showLoading();
            try {
                const note = await getNoteFromParent();
                if (note.note_id == null) {
                    await hideLoadingWithDelay(startTime);
                    addMessage('Save your note first, then generate a podcast.', false);
                    return;
                }
                if (lastNoteId !== undefined && note.note_id !== null && String(note.note_id) !== String(lastNoteId)) {
                    await hideLoadingWithDelay(startTime);
                    addMessage('The note in the editor changed. Open the note you want and try again.', false);
                    return;
                }
                const response = await fetch('/podcast_api', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        note_id: note.note_id
                    })
                });
                const data = await response.json();
                await hideLoadingWithDelay(startTime);
                if (data.success && data.audio_url) {
                    var nid = data.note_id != null ? data.note_id : note.note_id;
                    if (String(nid) !== String(note.note_id)) {
                        addMessage('Podcast did not match the open note. Try again.', false);
                        return;
                    }
                    addPodcastPlayer(data.audio_url, data.note_title || note.title, nid);
                    var ks = String(nid);
                    featureStateByNote[ks] = featureStateByNote[ks] || {};
                    featureStateByNote[ks].userActivatedPodcast = true;
                    featureStateByNote[ks].podcast = { audioUrl: data.audio_url, title: data.note_title || '' };
                    notifyNoteAiActivity(nid);
                    schedulePersistChatHistoryToServer();
                } else {
                    addMessage(data.error || 'Could not generate podcast.', false);
                }
            } catch (e) {
                await hideLoadingWithDelay(startTime);
                addMessage('Could not generate podcast right now.', false);
                console.error(e);
            } finally {
                sendButton.disabled = false;
                chatInput.disabled = false;
                if (summariseBtn) summariseBtn.disabled = false;
                if (quizMeBtn) quizMeBtn.disabled = false;
                if (quizMeGeneralBtn) quizMeGeneralBtn.disabled = false;
                if (podcastBtn) podcastBtn.disabled = false;
                if (flashcardsBtn) flashcardsBtn.disabled = false;
                if (clearChatBtn) clearChatBtn.disabled = false;
            }
        }

        async function generateFlashcards(opts) {
            opts = opts || {};
            if (sendButton.disabled) return;
            var startTime = Date.now();
            if (!opts.skipUserBubble) addMessage('Flashcards', true);
            sendButton.disabled = true;
            chatInput.disabled = true;
            if (summariseBtn) summariseBtn.disabled = true;
            if (quizMeBtn) quizMeBtn.disabled = true;
            if (quizMeGeneralBtn) quizMeGeneralBtn.disabled = true;
            if (podcastBtn) podcastBtn.disabled = true;
            if (flashcardsBtn) flashcardsBtn.disabled = true;
            if (clearChatBtn) clearChatBtn.disabled = true;
            showLoading();
            try {
                const note = await getNoteFromParent();
                const response = await fetch('/flashcards_api', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        note_id: note.note_id,
                        note_title: note.title,
                        note_content: note.content
                    })
                });
                const data = await response.json();
                await hideLoadingWithDelay(startTime);
                if (data.success && data.cards && data.cards.length) {
                    var fk = String(note.note_id);
                    featureStateByNote[fk] = featureStateByNote[fk] || {};
                    featureStateByNote[fk].userActivatedFlashcards = true;
                    renderFlashcards(data.cards, {}, note.note_id);
                    if (note.note_id != null) notifyNoteAiActivity(note.note_id);
                    schedulePersistChatHistoryToServer();
                } else {
                    addMessage(data.error || 'Could not generate flashcards.', false);
                }
            } catch (e) {
                await hideLoadingWithDelay(startTime);
                addMessage('Could not generate flashcards right now.', false);
                console.error(e);
            } finally {
                sendButton.disabled = false;
                chatInput.disabled = false;
                if (summariseBtn) summariseBtn.disabled = false;
                if (quizMeBtn) quizMeBtn.disabled = false;
                if (quizMeGeneralBtn) quizMeGeneralBtn.disabled = false;
                if (podcastBtn) podcastBtn.disabled = false;
                if (flashcardsBtn) flashcardsBtn.disabled = false;
                if (clearChatBtn) clearChatBtn.disabled = false;
            }
        }

        document.addEventListener('visibilitychange', function() {
            if (document.visibilityState === 'hidden') flushPersistChatHistoryNow();
        });
        window.addEventListener('pagehide', function() {
            flushPersistChatHistoryNow();
        });

        runWelcomeTyping();