// Author: Adam H. Ahmadi ID: 23160330
(function () {
    if (!window.QUIVLY_SHOW_TUTORIAL) return;

    var STEPS = [
        {
            title: 'Welcome to Quivly',
            body: 'Take a minute to learn where the main tools live. You can skip anytime.',
            target: null,
        },
        {
            title: 'Your notes',
            body: 'This whole column is your notes home. This is where you can see your notes or search for a note. Click a note to open it, or use the + button to create one.',
            target: '.sidebar',
        },
        {
            title: 'Create a note',
            body: 'Tap the pencil icon whenever you want a blank note. Your work saves automatically as you type.',
            target: '#new-note-btn',
        },
        {
            title: 'Search',
            body: 'Filter your notes quickly by typing here.',
            target: '.search-container',
        },
        {
            id: 'ai_gate',
            title: 'Open a note first',
            body: 'Create a new note with the pencil button, or choose one from the list. The note editor must be open so you can see the toolbar and the next step.',
            target: null,
        },
        {
            id: 'ai_toolbar',
            title: 'AI Assistant',
            body: 'Use AI Assistant in the toolbar for summaries, quizzes, flashcards, chat, and more. It uses your note content as context.',
            target: '#ai-assistant-toggle-btn',
        },
        {
            title: 'Trash & sign out',
            body: 'Recently Deleted holds notes you removed. Logout is here when you are done.',
            target: '.sidebar-footer',
        },
    ];

    var root = document.getElementById('tutorial-root');
    var spotlight = root && root.querySelector('.tutorial-spotlight');
    var titleEl = document.getElementById('tutorial-title');
    var bodyEl = document.getElementById('tutorial-body');
    var nextBtn = document.getElementById('tutorial-next');
    var prevBtn = document.getElementById('tutorial-prev');
    var skipBtn = document.getElementById('tutorial-skip');
    var indicatorEl = document.getElementById('tutorial-step-indicator');
    var cardEl = root && root.querySelector('.tutorial-card');

    if (!root || !spotlight || !titleEl || !bodyEl || !nextBtn || !prevBtn || !skipBtn || !cardEl) return;

    var stepIndex = 0;
    var resizeBound = false;
    var aiGateObserver = null;

    function getTargetEl(selector) {
        if (!selector) return null;
        try {
            return document.querySelector(selector);
        } catch (e) {
            return null;
        }
    }

    function padRect(rect, pad) {
        return {
            top: rect.top - pad,
            left: rect.left - pad,
            width: rect.width + pad * 2,
            height: rect.height + pad * 2,
        };
    }

    
    function getSidebarFooterTourInnerBox(footerEl) {
        if (!footerEl || !footerEl.getBoundingClientRect) return null;
        var fr = footerEl.getBoundingClientRect();
        if (!(fr.width > 2)) return null;

        var minL = fr.left;
        var maxR = fr.right;
        var minT = fr.top;
        var maxB = fr.bottom;
        var anchors;
        try {
            anchors = footerEl.querySelectorAll(':scope > a');
        } catch (e) {
            anchors = footerEl.querySelectorAll('a');
        }
        var i;
        for (i = 0; i < anchors.length; i++) {
            var r = anchors[i].getBoundingClientRect();
            minL = Math.min(minL, r.left);
            maxR = Math.max(maxR, r.right);
            minT = Math.min(minT, r.top);
            maxB = Math.max(maxB, r.bottom);
        }

        return {
            left: minL,
            top: minT,
            width: maxR - minL,
            height: Math.max(maxB - minT, 1),
        };
    }

    
    function spotlightPadForTarget(selector) {
        if (!selector) return 10;
        if (
            selector === '.sidebar' ||
            selector === '.main-content' ||
            selector === '.search-container' ||
            selector === '.sidebar-footer'
        ) {
            return 0;
        }
        if (selector === '#ai-assistant-toggle-btn') return 20;
        return 10;
    }

    function isNoteEditorVisible() {
        var ed = document.getElementById('note-editor');
        if (!ed) return false;
        if (ed.style.display === 'none') return false;
        try {
            return window.getComputedStyle(ed).display !== 'none';
        } catch (e) {
            return ed.style.display !== 'none';
        }
    }

    function disconnectAiGateObserver() {
        if (aiGateObserver) {
            aiGateObserver.disconnect();
            aiGateObserver = null;
        }
    }

    function connectAiGateObserver() {
        disconnectAiGateObserver();
        var ed = document.getElementById('note-editor');
        if (!ed) return;
        aiGateObserver = new MutationObserver(syncAiGateNextButton);
        aiGateObserver.observe(ed, {
            attributes: true,
            attributeFilter: ['style', 'class'],
        });
        syncAiGateNextButton();
    }

    function syncAiGateNextButton() {
        var step = STEPS[stepIndex];
        if (step && step.id === 'ai_gate') {
            nextBtn.disabled = !isNoteEditorVisible();
        } else {
            nextBtn.disabled = false;
        }
    }

    function roundRect(r) {
        return {
            left: Math.round(r.left),
            top: Math.round(r.top),
            width: Math.max(1, Math.round(r.width)),
            height: Math.max(1, Math.round(r.height)),
        };
    }

    function applySpotlight() {
        var step = STEPS[stepIndex];
        var el = getTargetEl(step.target);

        root.classList.toggle('tutorial-step-centered', !el);

        if (!el) {
            spotlight.classList.remove(
                'tutorial-spotlight--circle',
                'tutorial-spotlight--search-shape',
                'tutorial-spotlight--footer-shape'
            );
            spotlight.style.opacity = '0';
            cardEl.classList.remove('tutorial-card-docked');
            return;
        }

        try {
            if (step.target !== '.sidebar-footer') {
                el.scrollIntoView({ block: 'nearest', behavior: 'auto' });
            }
        } catch (e) {}

        var rect = el.getBoundingClientRect();
        if (rect.width < 4 || rect.height < 4) {
            spotlight.classList.remove(
                'tutorial-spotlight--circle',
                'tutorial-spotlight--search-shape',
                'tutorial-spotlight--footer-shape'
            );
            root.classList.add('tutorial-step-centered');
            spotlight.style.opacity = '0';
            cardEl.classList.remove('tutorial-card-docked');
            return;
        }

        var padded = padRect(rect, spotlightPadForTarget(step.target));
        
        var COLUMN_RIGHT_TRIM_PX = 34;
        if (step.target === '.sidebar') {
            padded.width = Math.max(24, padded.width - COLUMN_RIGHT_TRIM_PX);
        }
        if (step.target === '.search-container') {
            var SEARCH_HIGHLIGHT_RIGHT_TRIM_PX = 50;
            padded.width = Math.max(48, padded.width - SEARCH_HIGHLIGHT_RIGHT_TRIM_PX);
        }
        
        if (step.target === '#new-note-btn') {
            var NEW_NOTE_SPOTLIGHT_RING_PX = 14;
            var rAnchor = rect;
            var iconSvg = el.querySelector('.new-note-icon');
            var rIcon = iconSvg ? iconSvg.getBoundingClientRect() : null;
            var d =
                Math.max(rAnchor.width, rAnchor.height) +
                NEW_NOTE_SPOTLIGHT_RING_PX * 2;
            d = Math.max(48, d);
            var cx =
                rIcon && rIcon.width >= 2
                    ? rIcon.left + rIcon.width / 2
                    : rAnchor.left + rAnchor.width / 2;
            var cy =
                rIcon && rIcon.height >= 2
                    ? rIcon.top + rIcon.height / 2
                    : rAnchor.top + rAnchor.height / 2;
            try {
                var z = parseFloat(
                    window.getComputedStyle(document.documentElement).zoom || '1'
                );
                if (z > 1 && z < 5 && !isNaN(z)) {
                    cx -= (z - 1) * rAnchor.width * 6.25;
                }
            } catch (ze) {}
            
            cx -= 8;
            padded = {
                left: cx - d / 2,
                top: cy - d / 2,
                width: d,
                height: d,
            };
        }
        
        if (step.target === '.sidebar-footer') {
            var FOOTER_PAD_PX = 12;
            var FOOTER_RIGHT_TRIM_PX = 36;
            var u = getSidebarFooterTourInnerBox(el);
            if (!u) {
                u = {
                    left: rect.left,
                    top: rect.top,
                    width: rect.width,
                    height: rect.height,
                };
            }
            var innerW = Math.max(56, u.width - FOOTER_RIGHT_TRIM_PX);
            padded = padRect(
                {
                    left: u.left,
                    top: u.top,
                    width: innerW,
                    height: u.height,
                },
                FOOTER_PAD_PX
            );
            
            var FOOTER_SPOTLIGHT_SHIFT_UP_PX = 64;
            padded.top -= FOOTER_SPOTLIGHT_SHIFT_UP_PX;
            padded.height += FOOTER_SPOTLIGHT_SHIFT_UP_PX;
        }
        if (step.target === '#ai-assistant-toggle-btn') {
            var AI_SPOTLIGHT_SHIFT_UP_PX = 10;
            var AI_SPOTLIGHT_SHIFT_RIGHT_PX = 14;
            padded.top -= AI_SPOTLIGHT_SHIFT_UP_PX;
            padded.left += AI_SPOTLIGHT_SHIFT_RIGHT_PX;
        }
        padded = roundRect(padded);

        spotlight.classList.toggle(
            'tutorial-spotlight--circle',
            step.target === '#new-note-btn'
        );
        spotlight.classList.toggle(
            'tutorial-spotlight--search-shape',
            step.target === '.search-container'
        );
        spotlight.classList.toggle(
            'tutorial-spotlight--footer-shape',
            step.target === '.sidebar-footer'
        );

        spotlight.style.top = padded.top + 'px';
        spotlight.style.left = padded.left + 'px';
        spotlight.style.width = padded.width + 'px';
        spotlight.style.height = padded.height + 'px';
        spotlight.style.opacity = '1';

        if (window.matchMedia('(min-width: 900px)').matches) {
            try {
                var cardRect = cardEl.getBoundingClientRect();
                var overlaps =
                    cardRect.left < padded.left + padded.width &&
                    cardRect.left + cardRect.width > padded.left &&
                    cardRect.top < padded.top + padded.height &&
                    cardRect.top + cardRect.height > padded.top;
                cardEl.classList.toggle('tutorial-card-docked', !overlaps && padded.left + padded.width < window.innerWidth * 0.55);
            } catch (e) {
                cardEl.classList.remove('tutorial-card-docked');
            }
        } else {
            cardEl.classList.remove('tutorial-card-docked');
        }
    }

    function renderStep() {
        var step = STEPS[stepIndex];
        titleEl.textContent = step.title;
        bodyEl.textContent = step.body;
        prevBtn.disabled = stepIndex === 0;
        nextBtn.textContent = stepIndex >= STEPS.length - 1 ? 'Finish' : 'Next';

        disconnectAiGateObserver();
        if (step.id === 'ai_gate') {
            connectAiGateObserver();
        }

        if (indicatorEl) {
            indicatorEl.textContent = 'Step ' + (stepIndex + 1) + ' of ' + STEPS.length;
        }
        applySpotlight();
        if (step.target === '#new-note-btn') {
            var newNoteTourStep = stepIndex;
            requestAnimationFrame(function () {
                requestAnimationFrame(function () {
                    if (
                        root.hidden ||
                        stepIndex !== newNoteTourStep ||
                        STEPS[stepIndex].target !== '#new-note-btn'
                    ) {
                        return;
                    }
                    applySpotlight();
                });
            });
        }
        if (step.target === '.sidebar-footer') {
            var footerTourStep = stepIndex;
            requestAnimationFrame(function () {
                requestAnimationFrame(function () {
                    if (
                        root.hidden ||
                        stepIndex !== footerTourStep ||
                        STEPS[stepIndex].target !== '.sidebar-footer'
                    ) {
                        return;
                    }
                    applySpotlight();
                });
            });
        }
        syncAiGateNextButton();
    }

    function bindResize() {
        if (resizeBound) return;
        resizeBound = true;
        window.addEventListener(
            'resize',
            function () {
                applySpotlight();
            },
            { passive: true }
        );
    }

    function completeTutorial() {
        disconnectAiGateObserver();
        root.hidden = true;
        root.setAttribute('aria-hidden', 'true');
        root.classList.remove('tutorial-active');
        document.body.style.overflow = '';
        fetch('/tutorial_complete', {
            method: 'POST',
            headers: { Accept: 'application/json' },
            credentials: 'same-origin',
        }).catch(function () {});
    }

    function openTutorial() {
        root.hidden = false;
        root.setAttribute('aria-hidden', 'false');
        root.classList.add('tutorial-active');
        document.body.style.overflow = 'hidden';
        bindResize();
        renderStep();
        try {
            nextBtn.focus();
        } catch (e) {}
    }

    nextBtn.addEventListener('click', function () {
        if (stepIndex >= STEPS.length - 1) {
            completeTutorial();
            return;
        }
        stepIndex += 1;
        renderStep();
    });

    prevBtn.addEventListener('click', function () {
        if (stepIndex <= 0) return;
        stepIndex -= 1;
        renderStep();
    });

    skipBtn.addEventListener('click', completeTutorial);

    document.addEventListener('keydown', function (ev) {
        if (root.hidden) return;
        if (ev.key === 'Escape') {
            ev.preventDefault();
            completeTutorial();
        }
    });

    openTutorial();
})();
