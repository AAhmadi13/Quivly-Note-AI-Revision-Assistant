// Author: Adam H. Ahmadi ID: 23160330
const LAST_NOTE_STORAGE_KEY = window.QUIVLY_LAST_NOTE_STORAGE_KEY;

function persistLastOpenNoteId(noteId) {
    try {
        if (noteId != null && noteId !== '') {
            var n = parseInt(noteId, 10);
            if (n > 0) {
                localStorage.setItem(LAST_NOTE_STORAGE_KEY, String(n));
                return;
            }
        }
        localStorage.removeItem(LAST_NOTE_STORAGE_KEY);
    } catch (e) {}
}

function clearLastOpenNoteId() {
    try {
        localStorage.removeItem(LAST_NOTE_STORAGE_KEY);
    } catch (e) {}
}


const SKIP_NOTE_RESTORE_SESSION_KEY = 'revisionAssistant_skipNoteRestoreOnce';

let currentNoteId = null;
let currentNoteLocked = false;
let currentNoteContentHidden = false;
let lockVerifyModalMode = 'view';

let lockVerifyTargetNoteId = null;

let lockSetTargetNoteId = null;
let currentNoteHasPassword = false;
let autoSaveTimeout = null;

let createNewNoteInFlight = false;
const deleteNoteModal = document.getElementById('delete-note-modal');
const deleteNoteCancelBtn = document.getElementById('delete-note-cancel-btn');
const deleteNoteConfirmBtn = document.getElementById('delete-note-confirm-btn');
const deleteNoteModalTitleEl = document.getElementById('delete-note-modal-title');
const deleteNoteModalBodyEl = document.getElementById('delete-note-modal-body');
const DELETE_MODAL_DEFAULT_TITLE = 'Delete note';
const DELETE_MODAL_DEFAULT_BODY = 'Are you sure you want to delete this note?';

function getReminderAlarmIconHtml() {
    return '<svg class="note-reminder-alarm-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><circle cx="12" cy="14" r="7" stroke="currentColor" stroke-width="1.75"/><path d="M12 10v4h3" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/><path d="M5 2 3 5M19 2l2 3M9 1h6" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/></svg>';
}

function updateSidebarReminderAlarmEl(li, reminderEnabled) {
    var alarm = li.querySelector('.note-item-reminder-alarm');
    if (!alarm) return;
    if (reminderEnabled) {
        if (!alarm.innerHTML.trim()) alarm.innerHTML = getReminderAlarmIconHtml();
        alarm.removeAttribute('hidden');
        alarm.setAttribute('aria-hidden', 'false');
    } else {
        alarm.setAttribute('hidden', '');
        alarm.setAttribute('aria-hidden', 'true');
    }
}
const noteLockBtn = document.getElementById('note-lock-btn');
const lockSetModal = document.getElementById('lock-set-modal');
const lockSetPw = document.getElementById('lock-set-password');
const lockSetErr = document.getElementById('lock-set-error');
const lockSetCancel = document.getElementById('lock-set-cancel-btn');
const lockSetConfirm = document.getElementById('lock-set-confirm-btn');
const lockVerifyModal = document.getElementById('lock-verify-modal');
const lockVerifyPw = document.getElementById('lock-verify-password');
const lockVerifyErr = document.getElementById('lock-verify-error');
const lockVerifyTitle = document.getElementById('lock-verify-modal-title');
const lockVerifySub = document.getElementById('lock-verify-sub');
const lockVerifyCancel = document.getElementById('lock-verify-cancel-btn');
const lockVerifyConfirm = document.getElementById('lock-verify-confirm-btn');
const reminderLockedModal = document.getElementById('reminder-locked-modal');
const reminderLockedOkBtn = document.getElementById('reminder-locked-ok-btn');
const reminderCustomModal = document.getElementById('reminder-custom-modal');
const reminderCustomDate = document.getElementById('reminder-custom-date');
const reminderCustomTime = document.getElementById('reminder-custom-time');
const reminderCustomCancelBtn = document.getElementById('reminder-custom-cancel-btn');
const reminderCustomConfirmBtn = document.getElementById('reminder-custom-confirm-btn');
var pendingCustomReminder = null;
const REMINDER_CUSTOM_MAX_HOURS = 8760;

var reminderScheduledRefreshTimers = window.reminderScheduledRefreshTimers || (window.reminderScheduledRefreshTimers = {});
var reminderNudgeAutoHideTimers = window.reminderNudgeAutoHideTimers || (window.reminderNudgeAutoHideTimers = {});
var reminderNudgeViewportTicking = false;
var REMINDER_NUDGE_AUTO_HIDE_MS = 5000;

var REMINDER_NUDGE_VIEWPORT_OFFSET_X = -8;

function clearReminderNudgeAutoHideTimer(li) {
    if (!li || !li.getAttribute) return;
    var raw = li.getAttribute('data-note-id');
    if (raw == null || raw === 'new') return;
    var key = String(raw);
    if (reminderNudgeAutoHideTimers[key]) {
        clearTimeout(reminderNudgeAutoHideTimers[key]);
        delete reminderNudgeAutoHideTimers[key];
    }
}

function scheduleReminderNudgeAutoHide(li) {
    clearReminderNudgeAutoHideTimer(li);
    var raw = li.getAttribute('data-note-id');
    if (!raw || raw === 'new') return;
    var key = String(raw);
    reminderNudgeAutoHideTimers[key] = setTimeout(function() {
        delete reminderNudgeAutoHideTimers[key];
        
        if (li && li.parentNode) {
            sidebarReminderNudgeSetOpen(li, false);
            li.dataset.reminderNudgeSuppressed = 'true';
        }
    }, REMINDER_NUDGE_AUTO_HIDE_MS);
}


function updateReminderNudgeViewportPosition(li) {
    var wrap = li && li.querySelector ? li.querySelector('.note-reminder-nudge') : null;
    if (!wrap || wrap.hasAttribute('hidden')) return;
    if (!wrap.classList.contains('note-reminder-nudge--open')) return;
    var r = li.getBoundingClientRect();
    wrap.classList.add('note-reminder-nudge--viewport-fixed');
    wrap.style.left = Math.round(r.right + REMINDER_NUDGE_VIEWPORT_OFFSET_X) + 'px';
    wrap.style.top = Math.round(r.top + r.height / 2) + 'px';
}

function clearReminderNudgeViewportPosition(wrap) {
    if (!wrap) return;
    wrap.classList.remove('note-reminder-nudge--viewport-fixed');
    wrap.style.left = '';
    wrap.style.top = '';
}

function refreshAllOpenReminderNudgePositions() {
    document.querySelectorAll('#notes-list .note-item.note-item-reminder-nudge-visible').forEach(function(li) {
        updateReminderNudgeViewportPosition(li);
    });
}

function setSidebarReminderNudgeBody(li, text) {
    var body = li.querySelector('.note-reminder-nudge-body');
    if (body) body.textContent = text || '';
}

function sidebarReminderNudgeSetOpen(li, open, opts) {
    opts = opts || {};
    var wrap = li.querySelector('.note-reminder-nudge');
    if (!wrap) return;
    if (opts.text != null) setSidebarReminderNudgeBody(li, opts.text);
    if (open) {
        wrap.removeAttribute('hidden');
        li.classList.add('note-item-reminder-nudge-visible');
        if (opts.instant) {
            wrap.classList.add('note-reminder-nudge--open');
            updateReminderNudgeViewportPosition(li);
            if (!opts.skipAutoHide) scheduleReminderNudgeAutoHide(li);
            return;
        }
        requestAnimationFrame(function() {
            requestAnimationFrame(function() {
                wrap.classList.add('note-reminder-nudge--open');
                updateReminderNudgeViewportPosition(li);
                if (!opts.skipAutoHide) scheduleReminderNudgeAutoHide(li);
            });
        });
    } else {
        clearReminderNudgeAutoHideTimer(li);
        li.classList.remove('note-item-reminder-nudge-visible');
        wrap.classList.remove('note-reminder-nudge--open');
        var done = false;
        function finishHide() {
            if (done) return;
            done = true;
            clearReminderNudgeViewportPosition(wrap);
            wrap.setAttribute('hidden', '');
        }
        var shell = wrap.querySelector('.note-reminder-nudge-shell');
        if (shell) {
            shell.addEventListener('transitionend', function onNudgeEnd(ev) {
                if (ev.target !== shell) return;
                if (ev.propertyName !== 'transform' && ev.propertyName !== 'opacity') return;
                shell.removeEventListener('transitionend', onNudgeEnd);
                finishHide();
            });
        }
        setTimeout(finishHide, 580);
    }
}


function syncSidebarReminderNudgesToActiveNoteOnly() {
    document.querySelectorAll('#notes-list .note-item.note-item-reminder-active').forEach(function(li) {
        if (li.dataset.reminderNudgeSuppressed === 'true') return;
        var nb = li.querySelector('.note-reminder-nudge-body');
        var txt = nb ? nb.textContent.trim() : '';
        sidebarReminderNudgeSetOpen(li, true, { text: txt || undefined, instant: true });
    });
}

function applySidebarReminderStateForNote(noteId, showReminder, nudgeText, reminderEnabled) {
    if (noteId == null || noteId === '' || String(noteId) === 'new') return;
    var li = document.querySelector('#notes-list .note-item[data-note-id="' + noteId + '"]');
    if (!li) return;

    var wasShowing = li.classList.contains('note-item-reminder-active');
    if (!showReminder) {
        delete li.dataset.reminderNudgeSuppressed;
    } else if (!wasShowing) {
        delete li.dataset.reminderNudgeSuppressed;
    }
    li.classList.toggle('note-item-reminder-active', !!showReminder);
    if (showReminder) {
        setSidebarReminderNudgeBody(li, nudgeText != null ? nudgeText : '');
        if (li.dataset.reminderNudgeSuppressed !== 'true') {
            sidebarReminderNudgeSetOpen(li, true, { text: nudgeText != null ? nudgeText : '' });
        }
    } else {
        sidebarReminderNudgeSetOpen(li, false);
    }
    if (typeof reminderEnabled !== 'undefined') {
        li.dataset.reminderEnabled = reminderEnabled ? 'true' : 'false';
        updateSidebarReminderAlarmEl(li, !!reminderEnabled);
        var slot = li.querySelector('.note-card-menu-reminder-slot');
        if (slot) slot.innerHTML = getReminderSlotHtmlForSidebar(!!reminderEnabled);
        if (!reminderEnabled) {
            delete li.dataset.reminderTargetAt;
            clearReminderScheduledRefresh(noteId);
        }
    }
}

function getSidebarReminderNudgeHtml(bodyText, options) {
    options = options || {};
    var openCls = options.open ? ' note-reminder-nudge--open' : '';
    var hiddenAttr = options.open ? '' : ' hidden';
    var esc = typeof escapeSidebarHtml === 'function' ? escapeSidebarHtml(bodyText || '') : '';
    return (
        '<div class="note-reminder-nudge' + openCls + '" role="status" aria-live="polite"' + hiddenAttr + '>' +
        '<div class="note-reminder-nudge-shell">' +
        '<div class="note-reminder-nudge-icon-wrap" aria-hidden="true">' +
        '<svg class="note-reminder-nudge-bell" width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="14" r="7" stroke="currentColor" stroke-width="1.75"/><path d="M12 10v4h3" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/><path d="M5 2 3 5M19 2l2 3M9 1h6" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/></svg>' +
        '</div>' +
        '<div class="note-reminder-nudge-copy">' +
        '<span class="note-reminder-nudge-title">Reminder</span>' +
        '<span class="note-reminder-nudge-body">' + esc + '</span>' +
        '</div></div></div>'
    );
}

function clearReminderScheduledRefresh(noteId) {
    var key = String(noteId);
    if (reminderScheduledRefreshTimers[key]) {
        clearTimeout(reminderScheduledRefreshTimers[key]);
        delete reminderScheduledRefreshTimers[key];
    }
}
function scheduleReminderScheduledRefresh(li, noteId, targetIso) {
    clearReminderScheduledRefresh(noteId);
    var t0 = new Date(targetIso).getTime();
    var delay = t0 - Date.now() + 400;
    if (delay < 400) delay = 400;
    if (delay > 2147483647) delay = 2147483647;
    var key = String(noteId);
    reminderScheduledRefreshTimers[key] = setTimeout(function() {
        delete reminderScheduledRefreshTimers[key];
        fetch('/note/' + noteId + '/reminder_state', { headers: { 'Accept': 'application/json' } })
            .then(function(r) { return r.json(); })
            .then(function(d) {
                if (!d.success || !li.parentNode) return;
                applySidebarReminderStateForNote(noteId, d.show_reminder, d.reminder_nudge_text, d.reminder_enabled);
            })
            .catch(function() {});
    }, delay);
}

function fetchAndApplyReminderStateForNote(li, noteId) {
    if (!li || !noteId || String(noteId) === 'new') return;
    fetch('/note/' + noteId + '/reminder_state', { headers: { 'Accept': 'application/json' } })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (!data || !data.success || !li.parentNode) return;
            if (data.reminder_idle_hours != null) li.dataset.reminderIdleHours = String(data.reminder_idle_hours);
            if (data.reminder_target_at) {
                li.dataset.reminderTargetAt = data.reminder_target_at;
            } else {
                delete li.dataset.reminderTargetAt;
            }
            applySidebarReminderStateForNote(noteId, data.show_reminder, data.reminder_nudge_text, data.reminder_enabled);
            if (data.reminder_target_at && !data.show_reminder) {
                scheduleReminderScheduledRefresh(li, noteId, data.reminder_target_at);
            } else {
                clearReminderScheduledRefresh(noteId);
            }
        })
        .catch(function() {});
}

function syncReminderStateForEnabledSidebarNotes() {
    document.querySelectorAll('#notes-list .note-item[data-reminder-enabled="true"]').forEach(function(li) {
        var rawId = li.getAttribute('data-note-id');
        if (!rawId || rawId === 'new') return;
        var noteId = parseInt(rawId, 10);
        if (!noteId || noteId !== noteId) return;
        fetchAndApplyReminderStateForNote(li, noteId);
    });
}

function padReminderTwo(n) {
    return (n < 10 ? '0' : '') + n;
}

function setReminderCustomDateTimeFieldsFromDate(d) {
    if (!d || isNaN(d.getTime())) return;
    if (reminderCustomDate) {
        reminderCustomDate.value = d.getFullYear() + '-' + padReminderTwo(d.getMonth() + 1) + '-' + padReminderTwo(d.getDate());
    }
    if (reminderCustomTime) {
        reminderCustomTime.value = padReminderTwo(d.getHours()) + ':' + padReminderTwo(d.getMinutes());
    }
}

function getReminderCustomCombinedDate() {
    if (!reminderCustomDate || !reminderCustomTime) return null;
    var dv = reminderCustomDate.value;
    var tv = reminderCustomTime.value;
    if (!dv || !tv) return null;
    var dp = dv.split('-');
    if (dp.length !== 3) return null;
    var y = parseInt(dp[0], 10);
    var mo = parseInt(dp[1], 10) - 1;
    var da = parseInt(dp[2], 10);
    var tp = tv.split(':');
    var ho = parseInt(tp[0], 10);
    var mi = parseInt(tp[1], 10);
    var seRaw = tp.length > 2 && tp[2] != null && String(tp[2]).length ? tp[2] : '0';
    var se = parseInt(String(seRaw).replace(/\D.*$/, ''), 10);
    if ([y, mo, da, ho, mi].some(function(x) { return isNaN(x); })) return null;
    if (isNaN(se)) se = 0;
    var t = new Date(y, mo, da, ho, mi, se, 0);
    return isNaN(t.getTime()) ? null : t;
}

function isSidebarNoteLocked(li) {
    return !!(li && li.getAttribute && li.getAttribute('data-is-locked') === 'true');
}

function showReminderLockedModal() {
    if (!reminderLockedModal) return;
    reminderLockedModal.style.display = 'flex';
    reminderLockedModal.setAttribute('aria-hidden', 'false');
    if (reminderLockedOkBtn) {
        setTimeout(function() { try { reminderLockedOkBtn.focus(); } catch (e) {} }, 30);
    }
}

function closeReminderLockedModal() {
    if (!reminderLockedModal) return;
    reminderLockedModal.style.display = 'none';
    reminderLockedModal.setAttribute('aria-hidden', 'true');
}

function openReminderCustomModal(li, noteId) {
    if (isSidebarNoteLocked(li)) {
        showReminderLockedModal();
        return;
    }
    pendingCustomReminder = { li: li, noteId: noteId };
    var d = new Date();
    d.setHours(d.getHours() + 24);
    setReminderCustomDateTimeFieldsFromDate(d);
    if (reminderCustomModal) {
        reminderCustomModal.style.display = 'flex';
        reminderCustomModal.setAttribute('aria-hidden', 'false');
    }
    if (reminderCustomDate) {
        setTimeout(function() { try { reminderCustomDate.focus(); } catch (e) {} }, 30);
    }
}

function closeReminderCustomModal() {
    pendingCustomReminder = null;
    if (reminderCustomModal) {
        reminderCustomModal.style.display = 'none';
        reminderCustomModal.setAttribute('aria-hidden', 'true');
    }
}

function confirmReminderCustomModal() {
    if (!pendingCustomReminder) return;
    var target = getReminderCustomCombinedDate();
    if (!target) return;
    if (target.getTime() <= Date.now()) {
        showPageToast("You can't set a reminder in the past");
        return;
    }
    var li = pendingCustomReminder.li;
    var noteId = pendingCustomReminder.noteId;
    closeReminderCustomModal();
    setNoteReminderFromSidebar(li, noteId, { enabled: true, reminder_target_at: target.toISOString() });
}
if (reminderCustomCancelBtn) reminderCustomCancelBtn.addEventListener('click', closeReminderCustomModal);
if (reminderCustomConfirmBtn) reminderCustomConfirmBtn.addEventListener('click', confirmReminderCustomModal);
if (reminderLockedOkBtn) reminderLockedOkBtn.addEventListener('click', closeReminderLockedModal);
if (reminderLockedModal) {
    reminderLockedModal.addEventListener('click', function(e) {
        if (e.target === reminderLockedModal) closeReminderLockedModal();
    });
}

document.addEventListener('keydown', function(e) {
    if (e.key !== 'Escape') return;
    if (reminderLockedModal && reminderLockedModal.style.display === 'flex') {
        closeReminderLockedModal();
    }
});

function updatePrivacyUnlockVeilAria() {
    var shade = document.getElementById('note-privacy-shade-layer');
    var editor = document.getElementById('note-editor');
    if (!shade || !editor) return;
    var show = editor.classList.contains('note-content-hidden') || editor.classList.contains('note-session-lock-cta');
    shade.setAttribute('aria-hidden', show ? 'false' : 'true');
}

function setPrivacyContentHidden(hidden) {
    currentNoteContentHidden = !!hidden;
    var root = document.getElementById('note-editor-privacy-root');
    if (root) root.classList.toggle('is-content-hidden', currentNoteContentHidden);
    var editor = document.getElementById('note-editor');
    if (editor) editor.classList.toggle('note-content-hidden', currentNoteContentHidden);
    syncChatPanelLockedBlur();
}

function syncChatPanelLockedBlur() {
    var editor = document.getElementById('note-editor');
    var chatWrap = document.getElementById('chat-panel-wrapper');
    var mainCol = document.querySelector('.note-main-column');
    var privacyRoot = document.getElementById('note-editor-privacy-root');
    var aiToggle = document.getElementById('ai-assistant-toggle-btn');
    var blockAi = !!(currentNoteLocked && !currentNoteContentHidden);
    if (chatWrap) {
        chatWrap.classList.toggle('chat-panel-note-locked', blockAi);
        if (blockAi) chatWrap.classList.add('chat-panel-closed');
    }
    if (mainCol) mainCol.classList.toggle('note-main-locked-blur', blockAi);
    if (privacyRoot) privacyRoot.classList.toggle('privacy-root-session-lock-blur', blockAi);
    if (editor) editor.classList.toggle('note-session-lock-cta', !!blockAi);
    updatePrivacyUnlockVeilAria();
    if (aiToggle) {
        aiToggle.disabled = !!blockAi;
        aiToggle.style.opacity = blockAi ? '0.45' : '';
        aiToggle.style.pointerEvents = blockAi ? 'none' : '';
        aiToggle.title = blockAi ? 'Unlock this note in the editor to use the AI Assistant' : 'Toggle AI Assistant';
    }
}

function fillNoteEditorContent(title, rawContent) {
    document.getElementById('title').value = title || '';
    var raw = rawContent || '';
    if (raw && raw.indexOf('<') === -1) {
        document.getElementById('content').innerHTML = raw.replace(/\n/g, '<br>');
    } else {
        document.getElementById('content').innerHTML = raw;
    }
    if (window.ensureChecklistTextSpans) window.ensureChecklistTextSpans();
}

function showLockSetModal(targetNoteId) {
    if (targetNoteId != null && targetNoteId !== '') {
        var tid = parseInt(String(targetNoteId), 10);
        lockSetTargetNoteId = !isNaN(tid) && tid >= 1 ? tid : null;
    } else {
        lockSetTargetNoteId = null;
    }
    if (!lockSetModal) return;
    if (lockSetErr) { lockSetErr.hidden = true; lockSetErr.textContent = ''; }
    if (lockSetPw) lockSetPw.value = '';
    lockSetModal.style.display = 'flex';
    lockSetModal.setAttribute('aria-hidden', 'false');
    setTimeout(function() { if (lockSetPw) lockSetPw.focus(); }, 50);
}

function hideLockSetModal() {
    if (!lockSetModal) return;
    lockSetModal.style.display = 'none';
    lockSetModal.setAttribute('aria-hidden', 'true');
    lockSetTargetNoteId = null;
}

function showLockVerifyModal(mode, targetNoteId) {
    lockVerifyModalMode = mode || 'view';
    if (targetNoteId != null && targetNoteId !== '') {
        var tid = parseInt(String(targetNoteId), 10);
        lockVerifyTargetNoteId = !isNaN(tid) && tid >= 1 ? tid : null;
    } else {
        lockVerifyTargetNoteId = null;
    }
    if (!lockVerifyModal) return;
    if (lockVerifyErr) { lockVerifyErr.hidden = true; lockVerifyErr.textContent = ''; }
    if (lockVerifyPw) lockVerifyPw.value = '';
    if (lockVerifyTitle && lockVerifySub && lockVerifyConfirm) {
        if (lockVerifyModalMode === 'remove') {
            lockVerifyTitle.textContent = 'Remove lock';
            lockVerifySub.textContent = 'Enter your password';
            lockVerifyConfirm.textContent = 'Remove lock';
        } else {
            lockVerifyTitle.textContent = 'Unlock note';
            lockVerifySub.textContent = 'Enter your password';
            lockVerifyConfirm.textContent = 'Unlock';
        }
    }
    lockVerifyModal.style.display = 'flex';
    lockVerifyModal.setAttribute('aria-hidden', 'false');
    setTimeout(function() { if (lockVerifyPw) lockVerifyPw.focus(); }, 50);
}

function hideLockVerifyModal() {
    if (!lockVerifyModal) return;
    lockVerifyModal.style.display = 'none';
    lockVerifyModal.setAttribute('aria-hidden', 'true');
    lockVerifyTargetNoteId = null;
}

function syncSidebarLockMenuItem(li, locked) {
    if (!li) return;
    var dd = li.querySelector('.note-card-menu-dropdown');
    if (!dd) return;
    var delBtn = dd.querySelector('.note-card-menu-item[data-action="delete"]');
    if (!delBtn) return;
    var unlockBtn = dd.querySelector('.note-card-menu-item[data-action="unlock"]');
    var lockBtn = dd.querySelector('.note-card-menu-item[data-action="lock"]');
    if (locked) {
        if (lockBtn) lockBtn.remove();
        if (!unlockBtn) {
            var u = document.createElement('button');
            u.type = 'button';
            u.className = 'note-card-menu-item';
            u.setAttribute('role', 'menuitem');
            u.setAttribute('data-action', 'unlock');
            u.textContent = 'Unlock';
            delBtn.parentNode.insertBefore(u, delBtn);
        }
    } else {
        if (unlockBtn) unlockBtn.remove();
        if (!lockBtn) {
            var lk = document.createElement('button');
            lk.type = 'button';
            lk.className = 'note-card-menu-item';
            lk.setAttribute('role', 'menuitem');
            lk.setAttribute('data-action', 'lock');
            lk.textContent = 'Lock';
            delBtn.parentNode.insertBefore(lk, delBtn);
        }
    }
}

function updateSidebarLockIndicator(noteId, locked) {
    const item = document.querySelector(`[data-note-id="${noteId}"]`);
    if (!item) return;
    item.classList.toggle('note-item-locked', !!locked);
    item.setAttribute('data-is-locked', locked ? 'true' : 'false');
    const badge = item.querySelector('.note-sidebar-lock');
    if (badge) badge.hidden = !locked;
    syncSidebarLockMenuItem(item, !!locked);
}

function updateLockButtonVisibility() {
    if (!noteLockBtn) return;
    const hasSavedNote = !!currentNoteId;
    var hideBtn = !hasSavedNote || currentNoteContentHidden;
    noteLockBtn.hidden = hideBtn;
    noteLockBtn.disabled = hideBtn;
}

function applyNoteLockState(locked) {
    currentNoteLocked = !!locked;
    const editor = document.getElementById('note-editor');
    const titleEl = document.getElementById('title');
    const contentEl = document.getElementById('content');
    if (editor) editor.classList.toggle('note-locked', currentNoteLocked);
    if (titleEl) titleEl.readOnly = currentNoteLocked;
    if (contentEl) contentEl.contentEditable = currentNoteLocked ? 'false' : 'true';
    if (noteLockBtn) {
        noteLockBtn.classList.toggle('is-locked', currentNoteLocked);
        const label = noteLockBtn.querySelector('.note-lock-label');
        if (label) label.textContent = currentNoteLocked ? 'Remove lock' : 'Lock';
        noteLockBtn.title = currentNoteLocked ? 'Remove lock (password)' : 'Lock note (confirm with password)';
        noteLockBtn.setAttribute('aria-label', currentNoteLocked ? 'Remove lock' : 'Lock note');
    }
    document.querySelectorAll('.note-toolbar .toolbar-btn, .table-toolbar .table-toolbar-btn').forEach(function(btn) {
        btn.disabled = currentNoteLocked;
    });
    if (currentNoteId && !currentNoteContentHidden) updateSidebarLockIndicator(currentNoteId, currentNoteLocked);
    syncChatPanelLockedBlur();
}

function submitLockSet() {
    var nid = lockSetTargetNoteId != null ? lockSetTargetNoteId : currentNoteId;
    if (!nid || !lockSetPw) return;
    if (lockSetErr) { lockSetErr.hidden = true; lockSetErr.textContent = ''; }
    fetch('/set_note_lock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            note_id: nid,
            password: lockSetPw.value
        })
    })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (data.success) {
                hideLockSetModal();
                if (String(nid) === String(currentNoteId)) {
                    currentNoteHasPassword = true;
                    window.chatProgressAtLockTime = window.chatProgressAtLockTime || {};
                    window.chatProgressAtLockTime[currentNoteId] = !!(window.chatProgressByNote && window.chatProgressByNote[currentNoteId]);
                    applyNoteLockState(true);
                    updateLockButtonVisibility();
                    sendNoteToChatIframe();
                } else {
                    updateSidebarLockIndicator(nid, true);
                }
            } else if (data.error && lockSetErr) {
                lockSetErr.textContent = data.error;
                lockSetErr.hidden = false;
            }
        })
        .catch(function() {});
}

function submitLockVerify() {
    var nid = lockVerifyTargetNoteId != null ? lockVerifyTargetNoteId : currentNoteId;
    if (!nid || !lockVerifyPw) return;
    if (lockVerifyErr) { lockVerifyErr.hidden = true; lockVerifyErr.textContent = ''; }
    var pw = lockVerifyPw.value;
    if (lockVerifyModalMode === 'remove') {
        fetch('/clear_note_lock', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ note_id: nid, password: pw })
        })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                if (data.success) {
                    var wasContentHidden = currentNoteContentHidden;
                    hideLockVerifyModal();
                    if (String(nid) === String(currentNoteId)) {
                        currentNoteHasPassword = false;
                        applyNoteLockState(false);
                        updateSidebarLockIndicator(currentNoteId, false);
                        if (wasContentHidden) {
                            fetch('/get_note/' + currentNoteId)
                                .then(function(r) { return r.json(); })
                                .then(function(d) {
                                    if (d.success && !d.content_hidden) {
                                        setPrivacyContentHidden(false);
                                        fillNoteEditorContent(d.title || '', d.content || '');
                                        if (window.resetToolbarHistory) window.resetToolbarHistory();
                                    }
                                    updateLockButtonVisibility();
                                    openAiPanelAfterUnlock();
                                })
                                .catch(function() {
                                    updateLockButtonVisibility();
                                    openAiPanelAfterUnlock();
                                });
                        } else {
                            updateLockButtonVisibility();
                            openAiPanelAfterUnlock();
                        }
                    } else {
                        updateSidebarLockIndicator(nid, false);
                    }
                } else if (data.error && lockVerifyErr) {
                    lockVerifyErr.textContent = data.error;
                    lockVerifyErr.hidden = false;
                }
            })
            .catch(function() {});
        return;
    }
    fetch('/verify_note_lock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note_id: nid, password: pw })
    })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (data.success) {
                hideLockVerifyModal();
                if (String(nid) === String(currentNoteId)) {
                    setPrivacyContentHidden(false);
                    fillNoteEditorContent(data.title, data.content);
                    if (window.resetToolbarHistory) window.resetToolbarHistory();
                    currentNoteHasPassword = true;
                    applyNoteLockState(!!data.is_locked);
                    updateLockButtonVisibility();
                    openAiPanelAfterUnlock();
                }
            } else if (data.error && lockVerifyErr) {
                lockVerifyErr.textContent = data.error;
                lockVerifyErr.hidden = false;
            }
        })
        .catch(function() {});
}

function onNoteLockButtonClick() {
    if (!currentNoteId || currentNoteContentHidden) return;
    if (currentNoteLocked) {
        showLockVerifyModal('remove');
    } else {
        showLockSetModal();
    }
}


function showDeleteNoteModal(opts) {
    opts = opts || {};
    var titleText = opts.title != null ? opts.title : DELETE_MODAL_DEFAULT_TITLE;
    var bodyText = opts.message != null ? opts.message : DELETE_MODAL_DEFAULT_BODY;
    return new Promise((resolve) => {
        if (!deleteNoteModal || !deleteNoteCancelBtn || !deleteNoteConfirmBtn) {
            resolve(window.confirm(bodyText));
            return;
        }

        if (deleteNoteModalTitleEl) deleteNoteModalTitleEl.textContent = titleText;
        if (deleteNoteModalBodyEl) deleteNoteModalBodyEl.textContent = bodyText;

        function cleanup() {
            deleteNoteCancelBtn.removeEventListener('click', onCancel);
            deleteNoteConfirmBtn.removeEventListener('click', onConfirm);
            if (deleteNoteModalTitleEl) deleteNoteModalTitleEl.textContent = DELETE_MODAL_DEFAULT_TITLE;
            if (deleteNoteModalBodyEl) deleteNoteModalBodyEl.textContent = DELETE_MODAL_DEFAULT_BODY;
        }

        function onCancel() {
            cleanup();
            deleteNoteModal.style.display = 'none';
            deleteNoteModal.setAttribute('aria-hidden', 'true');
            resolve(false);
        }

        function onConfirm() {
            cleanup();
            deleteNoteModal.style.display = 'none';
            deleteNoteModal.setAttribute('aria-hidden', 'true');
            resolve(true);
        }

        deleteNoteCancelBtn.addEventListener('click', onCancel);
        deleteNoteConfirmBtn.addEventListener('click', onConfirm);
        deleteNoteModal.style.display = 'flex';
        deleteNoteModal.setAttribute('aria-hidden', 'false');
    });
}

function beginSidebarLock(noteId) {
    var id = parseInt(String(noteId), 10);
    if (isNaN(id) || id < 1) return;
    closeAllNoteCardMenus();
    if (currentNoteId != null && String(currentNoteId) === String(id)) {
        showLockSetModal();
        return;
    }
    fetch('/get_note/' + id)
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (!data || !data.success) return;
            if (data.is_locked) return;
            showLockSetModal(id);
        })
        .catch(function() {});
}

function beginSidebarUnlock(noteId) {
    var id = parseInt(String(noteId), 10);
    if (isNaN(id) || id < 1) return;
    closeAllNoteCardMenus();
    if (currentNoteId != null && String(currentNoteId) === String(id)) {
        showLockVerifyModal('remove');
        return;
    }
    fetch('/get_note/' + id)
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (!data || !data.success) return;
            if (!data.is_locked) return;
            showLockVerifyModal('remove', id);
        })
        .catch(function() {});
}

function loadNote(noteId, opts) {
    opts = opts || {};
    clearTimeout(autoSaveTimeout);
    autoSaveTimeout = null;
    clearIntroSyncedTitlePending();
    function doLoad() {
        fetch(`/get_note/${noteId}`)
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    currentNoteId = noteId;
                    persistLastOpenNoteId(noteId);
                    currentNoteHasPassword = !!data.has_password;
                    var chatHist = Array.isArray(data.chat_history) ? data.chat_history : [];
                    var chatIframeOpts = {
                        saved_chat_history: chatHist,
                        saved_chat_features: data.chat_features && typeof data.chat_features === 'object' ? data.chat_features : {}
                    };
                    if (chatHist.length > 0) {
                        chatIframeOpts.show_returning_session_hint = true;
                    }
                    document.getElementById('empty-state').style.display = 'none';
                    document.getElementById('note-editor').style.display = 'flex';
                    document.querySelectorAll('.note-item').forEach(item => item.classList.remove('active'));
                    const el = document.querySelector(`[data-note-id="${noteId}"]`);
                    if (el) el.classList.add('active');
                    var panelWrapper = document.getElementById('chat-panel-wrapper');

                    if (data.content_hidden) {
                        setPrivacyContentHidden(true);
                        fillNoteEditorContent('', '');
                        if (window.resetToolbarHistory) window.resetToolbarHistory();
                        document.getElementById('title').readOnly = true;
                        document.getElementById('content').contentEditable = 'false';
                        document.querySelectorAll('.note-toolbar .toolbar-btn, .table-toolbar .table-toolbar-btn').forEach(function(btn) {
                            btn.disabled = true;
                        });
                        applyNoteLockState(true);
                        updateLockButtonVisibility();
                        if (panelWrapper) {
                            panelWrapper.classList.add('chat-panel-closed');
                            setTimeout(function() { sendNoteToChatIframe(chatIframeOpts); }, 160);
                        }
                        if (opts.openLockVerifyAfterLoad) {
                            setTimeout(function() { showLockVerifyModal('view'); }, 200);
                        }
                        syncSidebarReminderNudgesToActiveNoteOnly();
                        return;
                    }

                    setPrivacyContentHidden(false);
                    fillNoteEditorContent(data.title, data.content);
                    if (window.ensureChecklistTextSpans) window.ensureChecklistTextSpans();
                    if (window.resetToolbarHistory) window.resetToolbarHistory();
                    applyNoteLockState(!!data.is_locked);
                    updateLockButtonVisibility();
                    if (panelWrapper) {
                        panelWrapper.classList.add('chat-panel-closed');
                        if (data.is_locked) {
                            setTimeout(function() { sendNoteToChatIframe(chatIframeOpts); }, 160);
                        } else {
                            openChatPanelThenSendIframe(chatIframeOpts);
                        }
                    }
                    syncSidebarReminderNudgesToActiveNoteOnly();
                }
            });
    }

    var hasPlaceholder = document.querySelector('[data-note-id="new"]');
    if (currentNoteId === null && hasPlaceholder) {
        var contentEl = document.getElementById('content');
        var title = document.getElementById('title').value.trim();
        fetch('/autosave_note', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                note_id: null,
                title: title || '',
                content: contentEl.innerHTML || ''
            })
        })
        .then(response => response.json())
        .then(data => {
            if (data.note_id) {
                var firstLine = contentEl.innerText ? contentEl.innerText.split('\n')[0].trim() : '';
                var previewText = firstLine ? firstLine.substring(0, 80) : '';
                var sidet = (data.title && String(data.title).trim()) ? String(data.title).trim() : (title || 'Untitled Note');
                removePlaceholderCard();
                addNoteToSidebar(data.note_id, sidet, previewText || 'No content', data.relative_time || 'less than a min ago');
                migrateChatQuickActionsPreferenceToNote(data.note_id);
                var ti0 = document.getElementById('title');
                if (ti0 && data.title) ti0.value = data.title;
            } else {
                removePlaceholderCard();
            }
            doLoad();
        })
        .catch(() => { removePlaceholderCard(); doLoad(); });
    } else {
        doLoad();
    }
}

function removePlaceholderCard() {
    const placeholder = document.querySelector('[data-note-id="new"]');
    if (placeholder) {
        placeholder.remove();
        const notesList = document.getElementById('notes-list');
        const noteCount = notesList.querySelectorAll('.note-item').length;
        document.querySelector('.sidebar-header h3').textContent = `All Notes (${noteCount})`;
    }
}


function migrateChatQuickActionsPreferenceToNote(noteId) {
    if (noteId == null || noteId === '') return;
    try {
        var fromKey = 'quivly_chat_quick_open_null';
        var toKey = 'quivly_chat_quick_open_' + String(noteId);
        if (localStorage.getItem(fromKey) === '1') {
            localStorage.setItem(toKey, '1');
            localStorage.removeItem(fromKey);
        }
    } catch (e) {}
}

function escapeSidebarHtml(str) {
    return String(str == null ? '' : str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

function isAllocatedUntitledNoteTitle(s) {
    return /^Untitled Note \(\d+\)\s*$/i.test(String(s || '').trim());
}


var CHAT_INTRO_SYNC_MS_PER_CHAR = 18;
var CHAT_INTRO_SYNC_INITIAL_DELAY_MS = 18;

var pendingTitleIntroSync = null;
var chatIntroTypingStartReceived = false;
var introSyncFallbackTimer = null;

function clearIntroSyncedTitlePending() {
    if (introSyncFallbackTimer) {
        clearTimeout(introSyncFallbackTimer);
        introSyncFallbackTimer = null;
    }
    if (pendingTitleIntroSync) {
        var p = pendingTitleIntroSync;
        pendingTitleIntroSync = null;
        var ft = p.fullText || '';
        if (p.sidebarTitleEl) p.sidebarTitleEl.textContent = ft;
        var nid = p.noteId;
        if (p.editorInput && nid != null && String(currentNoteId) === String(nid)) {
            p.editorInput.value = ft;
        }
        window._titleTypewriterActive = false;
        if (p.onDone) p.onDone();
    }
    chatIntroTypingStartReceived = false;
}

function tryFlushIntroSyncedTitle() {
    if (!pendingTitleIntroSync || !chatIntroTypingStartReceived) return;
    var p = pendingTitleIntroSync;
    pendingTitleIntroSync = null;
    chatIntroTypingStartReceived = false;
    if (introSyncFallbackTimer) {
        clearTimeout(introSyncFallbackTimer);
        introSyncFallbackTimer = null;
    }
    runUntitledTitleTypewriterImmediate(p.fullText, p.editorInput, p.sidebarTitleEl, p.onDone, {
        msPerChar: p.msPerChar != null ? p.msPerChar : CHAT_INTRO_SYNC_MS_PER_CHAR,
        initialDelayMs: p.initialDelayMs != null ? p.initialDelayMs : CHAT_INTRO_SYNC_INITIAL_DELAY_MS,
        noteId: p.noteId
    });
}

function queueIntroSyncedTitleTypewriter(fullText, editorInput, sidebarTitleEl, onDone, noteId) {
    fullText = String(fullText || '').trim();
    pendingTitleIntroSync = {
        fullText: fullText,
        editorInput: editorInput,
        sidebarTitleEl: sidebarTitleEl,
        onDone: onDone,
        noteId: noteId,
        msPerChar: CHAT_INTRO_SYNC_MS_PER_CHAR,
        initialDelayMs: CHAT_INTRO_SYNC_INITIAL_DELAY_MS
    };
    tryFlushIntroSyncedTitle();
    if (introSyncFallbackTimer) clearTimeout(introSyncFallbackTimer);
    introSyncFallbackTimer = setTimeout(function() {
        introSyncFallbackTimer = null;
        if (!pendingTitleIntroSync) return;
        chatIntroTypingStartReceived = true;
        tryFlushIntroSyncedTitle();
    }, 2500);
}

function runUntitledTitleTypewriterImmediate(fullText, editorInput, sidebarTitleEl, onDone, opts) {
    opts = opts || {};
    var msPerChar = opts.msPerChar != null ? opts.msPerChar : 38;
    var initialDelayMs = opts.initialDelayMs != null ? opts.initialDelayMs : 0;
    var guardNoteId = opts.noteId;
    fullText = String(fullText || '');
    if (!fullText.length) {
        if (onDone) onDone();
        return;
    }
    window._titleTypewriterActive = true;
    clearTimeout(autoSaveTimeout);
    autoSaveTimeout = null;
    var i = 0;
    if (editorInput) editorInput.value = '';
    if (sidebarTitleEl) sidebarTitleEl.textContent = '';
    function step() {
        if (guardNoteId != null && String(currentNoteId) !== String(guardNoteId)) {
            window._titleTypewriterActive = false;
            return;
        }
        if (i >= fullText.length) {
            window._titleTypewriterActive = false;
            if (onDone) onDone();
            return;
        }
        i += 1;
        var slice = fullText.slice(0, i);
        if (editorInput) editorInput.value = slice;
        if (sidebarTitleEl) sidebarTitleEl.textContent = slice;
        setTimeout(step, msPerChar);
    }
    if (initialDelayMs > 0) {
        setTimeout(step, initialDelayMs);
    } else {
        step();
    }
}

function runUntitledTitleTypewriter(fullText, editorInput, sidebarTitleEl, onDone, opts) {
    opts = opts || {};
    if (opts.syncWithChatIntro) {
        queueIntroSyncedTitleTypewriter(fullText, editorInput, sidebarTitleEl, onDone, opts.noteId);
        return;
    }
    runUntitledTitleTypewriterImmediate(fullText, editorInput, sidebarTitleEl, onDone, {
        msPerChar: opts.msPerChar != null ? opts.msPerChar : 38,
        initialDelayMs: opts.initialDelayMs != null ? opts.initialDelayMs : 0
    });
}

function addPlaceholderCard() {
    const notesList = document.getElementById('notes-list');
    const noteItem = document.createElement('li');
    noteItem.className = 'note-item active';
    noteItem.dataset.noteId = 'new';
    noteItem.dataset.isLocked = 'false';
    noteItem.dataset.reminderEnabled = 'false';
    noteItem.innerHTML = `
        <span class="sidebar-note-check" aria-hidden="true"></span>
        <div class="note-item-inner-col">
            <div class="note-item-body">
                <div class="note-item-title-row">
                    <span class="note-sidebar-lock" aria-hidden="true" hidden>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7 11V8a5 5 0 0 1 10 0v3M6 11h12a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/></svg>
                    </span>
                    <div class="note-item-title"></div>
                </div>
                <div class="note-item-preview">No content</div>
                <div class="note-item-meta-row">
                    <div class="note-item-date">less than a min ago</div>
                    <span class="note-item-reminder-alarm" hidden aria-hidden="true">${getReminderAlarmIconHtml()}</span>
                </div>
            </div>
        </div>
        ${getSidebarReminderNudgeHtml('', { open: false })}
    `;
    notesList.insertBefore(noteItem, notesList.firstChild);
    updateSidebarNotesCountHeader();
}

function createNewNote() {
    if (createNewNoteInFlight) {
        return;
    }
    createNewNoteInFlight = true;
    clearTimeout(autoSaveTimeout);
    autoSaveTimeout = null;

    const title = document.getElementById('title').value.trim();
    const contentEl = document.getElementById('content');

    function openFreshNote() {
        clearTimeout(autoSaveTimeout);
        autoSaveTimeout = null;
        clearIntroSyncedTitlePending();
        removePlaceholderCard();
        currentNoteId = null;
        clearLastOpenNoteId();
        document.getElementById('title').value = '';
        document.getElementById('content').innerHTML = '';
        if (window.resetToolbarFormattingDefaults) window.resetToolbarFormattingDefaults();
        document.getElementById('empty-state').style.display = 'none';
        document.getElementById('note-editor').style.display = 'flex';
        document.querySelectorAll('.note-item').forEach(item => item.classList.remove('active'));
        addPlaceholderCard();
        document.getElementById('title').focus();
        setPrivacyContentHidden(false);
        currentNoteHasPassword = false;
        applyNoteLockState(false);
        updateLockButtonVisibility();
        openChatPanelThenSendIframe({ play_intro_typing: true, animate_quick_actions: true });
        syncSidebarReminderNudgesToActiveNoteOnly();
    }

    var hasPlaceholder = document.querySelector('[data-note-id="new"]');
    if (currentNoteId === null && hasPlaceholder) {
        fetch('/autosave_note', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                note_id: null,
                title: title || '',
                content: contentEl.innerHTML || ''
            })
        })
        .then(response => response.json())
        .then(data => {
            if (data.note_id) {
                const firstLine = contentEl.innerText ? contentEl.innerText.split('\n')[0].trim() : '';
                const previewText = firstLine ? firstLine.substring(0, 80) : '';
                const displayTitle = (data.title && String(data.title).trim()) ? String(data.title).trim() : (title ? title : 'Untitled Note');
                const displayPreview = previewText || 'No content';
                const relativeTime = data.relative_time || 'less than a min ago';
                removePlaceholderCard();
                addNoteToSidebar(data.note_id, displayTitle, displayPreview, relativeTime);
                migrateChatQuickActionsPreferenceToNote(data.note_id);
                if (data.title) {
                    const ti = document.getElementById('title');
                    if (ti) ti.value = data.title;
                }
            }
            openFreshNote();
        })
        .catch(() => openFreshNote())
        .finally(() => {
            createNewNoteInFlight = false;
        });
    } else {
        try {
            openFreshNote();
        } catch (err) {
            createNewNoteInFlight = false;
            throw err;
        }
        const titleInput = document.getElementById('title');
        const contentElForSave = document.getElementById('content');
        fetch('/autosave_note', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                note_id: null,
                title: (titleInput && titleInput.value) ? titleInput.value.trim() : '',
                content: (contentElForSave && contentElForSave.innerHTML) ? contentElForSave.innerHTML : ''
            })
        })
        .then(response => response.json())
        .then(data => {
            if (data.note_id) {
                removePlaceholderCard();
                const nt = (data.title && String(data.title).trim()) ? String(data.title).trim() : 'Untitled Note';
                if (isAllocatedUntitledNoteTitle(nt)) {
                    addNoteToSidebar(data.note_id, '', 'No content', data.relative_time || 'less than a min ago', nt);
                } else {
                    addNoteToSidebar(data.note_id, nt, 'No content', data.relative_time || 'less than a min ago');
                    const tin = document.getElementById('title');
                    if (tin) tin.value = nt;
                }
                migrateChatQuickActionsPreferenceToNote(data.note_id);
                currentNoteId = data.note_id;
                persistLastOpenNoteId(data.note_id);
                document.querySelectorAll('.note-item').forEach(item => item.classList.remove('active'));
                const el = document.querySelector(`[data-note-id="${data.note_id}"]`);
                if (el) el.classList.add('active');
                updateLockButtonVisibility();
                sendNoteToChatIframe({ sync_note_context_only: true });
            }
        })
        .catch(() => {})
        .finally(() => {
            createNewNoteInFlight = false;
        });
    }
}

function closeNote() {
    clearTimeout(autoSaveTimeout);
    autoSaveTimeout = null;
    clearIntroSyncedTitlePending();
    document.getElementById('empty-state').style.display = 'flex';
    document.getElementById('note-editor').style.display = 'none';
    document.querySelectorAll('.note-item').forEach(item => {
        item.classList.remove('active');
    });
    syncSidebarReminderNudgesToActiveNoteOnly();
}

function autoSave() {
    clearTimeout(autoSaveTimeout);
    
    autoSaveTimeout = setTimeout(() => {
        if (currentNoteLocked || currentNoteContentHidden) return;
        if (window._titleTypewriterActive) return;
        const title = document.getElementById('title').value.trim();
        const contentEl = document.getElementById('content');
        const content = contentEl.innerHTML;
        const contentPlain = contentEl.innerText ? contentEl.innerText.trim() : '';
        
        fetch('/autosave_note', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                note_id: currentNoteId,
                title: title || '',
                content: content || ''
            })
        })
        .then(response => response.json())
        .then(data => {
            if (data.locked) {
                applyNoteLockState(true);
                return;
            }
            if (data.note_id) {
                const wasNewNote = !currentNoteId;
                currentNoteId = data.note_id;
                const firstLine = contentEl.innerText ? contentEl.innerText.split('\n')[0].trim() : '';
                const previewText = firstLine ? firstLine.substring(0, 80) : '';
                const displayTitle = (data.title != null && String(data.title).trim() !== '')
                    ? String(data.title).trim()
                    : ((title && title.trim()) ? title.trim() : 'Untitled Note');
                const displayPreview = previewText || 'No content';
                const relativeTime = data.relative_time || 'less than a min ago';
                if (wasNewNote) {
                    removePlaceholderCard();
                    var allocTitle = (data.title != null && String(data.title).trim() !== '') ? String(data.title).trim() : displayTitle;
                    if (isAllocatedUntitledNoteTitle(allocTitle)) {
                        addNoteToSidebar(data.note_id, '', displayPreview, relativeTime, allocTitle);
                    } else {
                        addNoteToSidebar(data.note_id, displayTitle, displayPreview, relativeTime);
                        const ti = document.getElementById('title');
                        if (ti && allocTitle) ti.value = allocTitle;
                    }
                    migrateChatQuickActionsPreferenceToNote(data.note_id);
                    persistLastOpenNoteId(data.note_id);
                    sendNoteToChatIframe({ sync_note_context_only: true });
                } else {
                    updateSidebarNote(data.note_id, displayTitle, displayPreview, relativeTime);
                }
                if (typeof data.show_reminder !== 'undefined') {
                    applySidebarReminderStateForNote(data.note_id, data.show_reminder, data.reminder_nudge_text, data.reminder_enabled);
                }
                updateLockButtonVisibility();
            }
        })
        .catch(error => console.error('Autosave failed:', error));
    }, 800);
}

function updateSidebarNote(noteId, title, preview, relativeTime) {
    const noteEl = document.querySelector(`[data-note-id="${noteId}"]`);
    if (!noteEl) return;
    noteEl.querySelector('.note-item-title').textContent = title || 'Untitled Note';
    noteEl.querySelector('.note-item-preview').textContent = preview || 'No content';
    if (relativeTime) noteEl.querySelector('.note-item-date').textContent = relativeTime;
    const notesList = document.getElementById('notes-list');
    if (notesList && noteEl.parentNode === notesList && notesList.firstChild !== noteEl) {
        notesList.insertBefore(noteEl, notesList.firstChild);
    }
}

function getReminderSlotHtmlForSidebar(reminderOn) {
    if (reminderOn) {
        return '<button type="button" class="note-card-menu-item" role="menuitem" data-action="reminder-off">Turn off reminder</button>';
    }
    return (
        '<div class="note-card-menu-item note-card-menu-item--sub" role="none">' +
        '<div class="note-card-menu-sub-trigger">' +
        '<span class="note-card-menu-item-sub-label">Set reminder</span>' +
        '<span class="note-card-menu-sub-chevron" aria-hidden="true">›</span>' +
        '</div>' +
        '<div class="note-card-menu-sub" role="menu">' +
        '<button type="button" class="note-card-menu-subitem" role="menuitem" data-idle-hours="1">1 Hour</button>' +
        '<button type="button" class="note-card-menu-subitem" role="menuitem" data-idle-hours="24">24 Hours</button>' +
        '<button type="button" class="note-card-menu-subitem" role="menuitem" data-idle-hours="168">1 Week</button>' +
        '<button type="button" class="note-card-menu-subitem" role="menuitem" data-idle-hours="custom">Custom</button>' +
        '</div></div>'
    );
}

function formatSidebarReminderNudgeText(hours) {
    var h = parseInt(hours, 10);
    if (h === 168) return 'Check in: no edits or chat for 1+ week.';
    if (h === 1) return 'Check in: no edits or chat for 1+ hr.';
    if (h === h && h > 0) return 'Check in: no edits or chat for ' + h + '+ hrs.';
    return 'Check in: no edits or chat for 24+ hrs.';
}

function addNoteToSidebar(noteId, title, preview, relativeTime, typewriterFinalTitle) {
    const notesList = document.getElementById('notes-list');
    const noteItem = document.createElement('li');
    noteItem.className = 'note-item active';
    noteItem.dataset.noteId = noteId;
    noteItem.dataset.isLocked = 'false';
    noteItem.dataset.reminderEnabled = 'false';
    noteItem.dataset.reminderIdleHours = '24';
    const dateStr = relativeTime || 'less than a min ago';
    var useTypewriter = typewriterFinalTitle && isAllocatedUntitledNoteTitle(typewriterFinalTitle);
    const t = escapeSidebarHtml(useTypewriter ? '' : (title || 'Untitled Note'));
    const p = escapeSidebarHtml(preview || 'No content');
    const d = escapeSidebarHtml(dateStr);
    
    noteItem.innerHTML = `
        <span class="sidebar-note-check" aria-hidden="true"></span>
        <div class="note-item-inner-col">
            <div class="note-item-body">
                <div class="note-item-title-row">
                    <span class="note-sidebar-lock" aria-hidden="true" hidden>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7 11V8a5 5 0 0 1 10 0v3M6 11h12a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/></svg>
                    </span>
                    <div class="note-item-title">${t}</div>
                    <div class="note-card-menu-wrap">
                        <button type="button" class="note-card-menu-btn" aria-label="Note options" aria-expanded="false" aria-haspopup="true" title="More">⋮</button>
                        <div class="note-card-menu-dropdown" role="menu" hidden>
                            <button type="button" class="note-card-menu-item" role="menuitem" data-action="select">Select</button>
                            <div class="note-card-menu-reminder-slot">${getReminderSlotHtmlForSidebar(false)}</div>
                            <button type="button" class="note-card-menu-item" role="menuitem" data-action="lock">Lock</button>
                            <button type="button" class="note-card-menu-item" role="menuitem" data-action="delete">Delete</button>
                        </div>
                    </div>
                </div>
                <div class="note-item-preview">${p}</div>
                <div class="note-item-meta-row">
                    <div class="note-item-date">${d}</div>
                    <span class="note-item-reminder-alarm" hidden aria-hidden="true">${getReminderAlarmIconHtml()}</span>
                </div>
            </div>
        </div>
        ${getSidebarReminderNudgeHtml('', { open: false })}
    `;
    
    notesList.insertBefore(noteItem, notesList.firstChild);
    updateSidebarNotesCountHeader();
    if (useTypewriter) {
        var span = noteItem.querySelector('.note-item-title');
        var inp = document.getElementById('title');
        runUntitledTitleTypewriter(String(typewriterFinalTitle).trim(), inp, span, function() {
            autoSave();
        }, { syncWithChatIntro: true, noteId: noteId });
    }
    return noteItem;
}

async function deleteNote() {
    if (!currentNoteId) {
        removePlaceholderCard();
        closeNote();
        return;
    }

    const shouldDelete = await showDeleteNoteModal();
    if (!shouldDelete) {
        return;
    }

    fetch(`/delete_note/${currentNoteId}`, {
        method: 'POST'
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            const noteElement = document.querySelector(`[data-note-id="${currentNoteId}"]`);
            if (noteElement) {
                noteElement.remove();
            }
            clearLastOpenNoteId();
            closeNote();
            updateSidebarNotesCountHeader();
            showPageToast('Note deleted');
            exitSidebarSelectionModeIfNothingSelected();
        }
    })
    .catch(error => console.error('Delete failed:', error));
}

document.getElementById('new-note-btn').addEventListener('click', (e) => {
    e.preventDefault();
    createNewNote();
});

if (noteLockBtn) {
    noteLockBtn.addEventListener('click', function() {
        onNoteLockButtonClick();
    });
}
if (lockSetCancel) lockSetCancel.addEventListener('click', hideLockSetModal);
if (lockSetConfirm) lockSetConfirm.addEventListener('click', submitLockSet);
if (lockSetPw) {
    lockSetPw.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') submitLockSet();
    });
}
if (lockVerifyCancel) lockVerifyCancel.addEventListener('click', function() {
    var crossNoteUnlock =
        lockVerifyTargetNoteId != null &&
        currentNoteId != null &&
        String(lockVerifyTargetNoteId) !== String(currentNoteId);
    hideLockVerifyModal();
    if (!crossNoteUnlock && lockVerifyModalMode === 'view' && currentNoteContentHidden) {
        closeNote();
    }
});
if (lockVerifyConfirm) lockVerifyConfirm.addEventListener('click', submitLockVerify);
if (lockVerifyPw) lockVerifyPw.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') submitLockVerify();
});

(function() {
    var unlockCta = document.getElementById('note-privacy-unlock-cta-btn');
    if (unlockCta) {
        unlockCta.addEventListener('click', function() {
            showLockVerifyModal(currentNoteContentHidden ? 'view' : 'remove');
        });
    }
})();

document.getElementById('title').addEventListener('input', autoSave);
document.getElementById('content').addEventListener('input', autoSave);

(function() {
    const contentEl = document.getElementById('content');
    const toolbar = document.querySelector('.note-toolbar');
    if (!contentEl || !toolbar) return;

    function setHeadingActive(which) {
        toolbar.querySelectorAll('.toolbar-btn[data-format="h1"], .toolbar-btn[data-format="h2"], .toolbar-btn[data-format="normal"]').forEach(btn => btn.classList.remove('active'));
        const btn = toolbar.querySelector('.toolbar-btn[data-format="' + which + '"]');
        if (btn) btn.classList.add('active');
    }

    function getBlockTag() {
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0) return 'p';
        let node = sel.anchorNode;
        while (node && node !== contentEl) {
            if (node.nodeType === 1) {
                const tag = node.tagName ? node.tagName.toLowerCase() : '';
                if (tag === 'h1' || tag === 'h2' || tag === 'p') return tag;
            }
            node = node.parentNode;
        }
        return 'p';
    }

    function updateHeadingActiveState() {
        const tag = getBlockTag();
        setHeadingActive(tag === 'h1' ? 'h1' : tag === 'h2' ? 'h2' : 'normal');
    }

    function updateBoldItalicActiveState() {
        var boldBtn = toolbar.querySelector('.toolbar-btn[data-format="bold"]');
        var italicBtn = toolbar.querySelector('.toolbar-btn[data-format="italic"]');
        if (boldBtn) boldBtn.classList.toggle('active', document.queryCommandState('bold'));
        if (italicBtn) italicBtn.classList.toggle('active', document.queryCommandState('italic'));
    }

    function applyFormat(format) {
        contentEl.focus();
        if (format === 'h1') {
            document.execCommand('formatBlock', false, 'h1');
            setHeadingActive('h1');
        } else if (format === 'h2') {
            document.execCommand('formatBlock', false, 'h2');
            setHeadingActive('h2');
        } else if (format === 'normal') {
            document.execCommand('formatBlock', false, 'p');
            setHeadingActive('normal');
        } else if (format === 'bold') {
            document.execCommand('bold', false, null);
            updateBoldItalicActiveState();
        } else if (format === 'italic') {
            document.execCommand('italic', false, null);
            updateBoldItalicActiveState();
        } else if (format === 'ul') {
            document.execCommand('insertUnorderedList', false, null);
        } else if (format === 'ol') {
            document.execCommand('insertOrderedList', false, null);
        } else if (format === 'checklist') {
            var checklistHtml = '<div class="note-editor-checklist"><div class="note-checklist-item"><span class="note-checklist-box" contenteditable="false">&#9744;</span><span class="note-checklist-inner" contenteditable="true"> </span></div></div><p><br></p>';
            document.execCommand('insertHTML', false, checklistHtml);
        } else if (format === 'undo') {
            document.execCommand('undo', false, null);
        } else if (format === 'redo') {
            document.execCommand('redo', false, null);
        } else if (format === 'table') {
            var tableHtml = '<table class="note-editor-table" border="1" cellpadding="8" cellspacing="0"><tbody>' +
                '<tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>' +
                '<tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>' +
                '<tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>' +
                '</tbody></table><p><br></p>';
            document.execCommand('insertHTML', false, tableHtml);
        }
        updateHeadingActiveState();
        updateBoldItalicActiveState();
        autoSave();
    }

    toolbar.addEventListener('click', function(e) {
        const btn = e.target.closest('.toolbar-btn[data-format]');
        if (!btn) return;
        e.preventDefault();
        applyFormat(btn.getAttribute('data-format'));
    });

    contentEl.addEventListener('keyup', function() { updateHeadingActiveState(); updateBoldItalicActiveState(); });
    contentEl.addEventListener('click', function() { updateHeadingActiveState(); updateBoldItalicActiveState(); });
    contentEl.addEventListener('focus', function() { updateHeadingActiveState(); updateBoldItalicActiveState(); });
    document.addEventListener('selectionchange', function() {
        if (contentEl.contains(document.activeElement)) {
            updateHeadingActiveState();
            updateBoldItalicActiveState();
        }
    });

    contentEl.addEventListener('click', function(e) {
        var box = e.target.closest('.note-checklist-box');
        if (box) {
            e.preventDefault();
            var li = box.closest('.note-checklist-item');
            if (!li) return;
            var checked = li.classList.toggle('checked');
            box.textContent = checked ? '\u2611' : '\u2610';
            autoSave();
            return;
        }
        var li = e.target.closest('.note-checklist-item');
        if (li && li.closest('.note-editor-checklist')) {
            var box = li.querySelector('.note-checklist-box');
            var textSpan = li.querySelector('.note-checklist-text');
            if (textSpan && box && !box.contains(e.target)) {
                if (e.target === li) {
                    e.preventDefault();
                    textSpan.focus();
                    var range = document.createRange();
                    var sel = window.getSelection();
                    if (textSpan.firstChild) {
                        range.setStart(textSpan.firstChild, 0);
                        range.collapse(true);
                    } else {
                        range.setStart(textSpan, 0);
                        range.collapse(true);
                    }
                    sel.removeAllRanges();
                    sel.addRange(range);
                }
            }
        }
    });

    function getChecklistRowText(row) {
        var inner = row.querySelector('.note-checklist-inner');
        var raw = inner ? (inner.textContent || '') : (row.textContent || '').replace(/\u2610/g, '').replace(/\u2611/g, '');
        return raw.replace(/\s/g, '');
    }

    function tryDeleteChecklistRow(e, key) {
        if (key !== 'Backspace' && key !== 'Delete') return false;
        var row = null;
        var active = document.activeElement;
        if (active && active.classList && (active.classList.contains('note-checklist-item') || active.classList.contains('note-checklist-inner') || active.classList.contains('note-checklist-text'))) {
            row = active.classList.contains('note-checklist-item') ? active : active.closest('.note-checklist-item');
        }
        if (!row && window.getSelection().rangeCount) {
            var node = window.getSelection().anchorNode || window.getSelection().focusNode;
            while (node && node !== contentEl) {
                if (node.nodeType === 1 && node.classList && (node.classList.contains('note-checklist-item') || node.classList.contains('note-checklist-inner') || node.classList.contains('note-checklist-text') || node.classList.contains('note-checklist-box'))) {
                    row = node.closest('.note-checklist-item');
                    break;
                }
                node = node.parentNode;
            }
        }
        if (!row || !row.closest('.note-editor-checklist')) return false;
        var rowText = getChecklistRowText(row);
        var isEmpty = rowText.length === 0;
        var atStart = false;
        var atEnd = false;
        var inner = row.querySelector('.note-checklist-inner');
        var rangeEl = inner || row;
        if (window.getSelection().rangeCount) {
            var r = window.getSelection().getRangeAt(0);
            if (r.collapsed) {
                try {
                    var box = row.querySelector('.note-checklist-box');
                    if (box && rangeEl.contains(r.startContainer)) {
                        var afterBox = document.createRange();
                        afterBox.setStartAfter(box);
                        afterBox.collapse(true);
                        atStart = r.compareBoundaryPoints(Range.START_TO_START, afterBox) <= 0;
                        var rowEnd = document.createRange();
                        rowEnd.selectNodeContents(rangeEl);
                        rowEnd.collapse(false);
                        atEnd = r.compareBoundaryPoints(Range.END_TO_END, rowEnd) >= 0;
                    }
                } catch (err) {}
            }
        }
        var shouldRemove = isEmpty || (key === 'Backspace' && atStart) || (key === 'Delete' && atEnd);
        if (!shouldRemove) return false;
        e.preventDefault();
        e.stopPropagation();
        var list = row.closest('.note-editor-checklist');
        var prevRow = row.previousElementSibling;
        row.remove();
        if (list && list.children.length === 0) list.remove();
        if (prevRow && prevRow.classList && prevRow.classList.contains('note-checklist-item')) {
            var prevInner = prevRow.querySelector('.note-checklist-inner') || prevRow.querySelector('.note-checklist-text');
            var focusEl = prevInner || prevRow;
            focusEl.focus();
            var sel = window.getSelection();
            var range = document.createRange();
            range.selectNodeContents(focusEl);
            range.collapse(false);
            sel.removeAllRanges();
            sel.addRange(range);
        } else {
            contentEl.focus();
        }
        autoSave();
        return true;
    }

    document.addEventListener('keydown', function(e) {
        if (e.key !== 'Backspace' && e.key !== 'Delete') return;
        if (!contentEl.contains(document.activeElement) && document.activeElement !== contentEl) return;
        if (tryDeleteChecklistRow(e, e.key)) {
            e.preventDefault();
            e.stopPropagation();
        }
    }, true);

    contentEl.addEventListener('keydown', function(e) {
        var sel = window.getSelection();
        var node = sel.anchorNode || sel.focusNode;
        var row = null;
        while (node && node !== contentEl) {
            if (node.nodeType === 1) {
                if (node.classList && node.classList.contains('note-checklist-item')) {
                    row = node;
                    break;
                }
                if (node.classList && (node.classList.contains('note-checklist-text') || node.classList.contains('note-checklist-box'))) {
                    row = node.closest('.note-checklist-item');
                    break;
                }
            }
            node = node.parentNode;
        }
        var inChecklist = row && row.closest('.note-editor-checklist');

        if (e.key === 'Backspace' || e.key === 'Delete') {
            if (tryDeleteChecklistRow(e, e.key)) return;
        }

        if (e.key !== 'Enter') return;
        if (!inChecklist) return;
        e.preventDefault();
        var list = row.closest('.note-editor-checklist');
        var isDivList = row.tagName === 'DIV';
        var newRow = document.createElement(isDivList ? 'div' : 'li');
        newRow.className = 'note-checklist-item';
        var span = document.createElement('span');
        span.className = 'note-checklist-box';
        span.contentEditable = 'false';
        span.textContent = '\u2610';
        newRow.appendChild(span);
        if (isDivList) {
            var innerSpan = document.createElement('span');
            innerSpan.className = 'note-checklist-inner';
            innerSpan.contentEditable = 'true';
            innerSpan.appendChild(document.createTextNode(' '));
            newRow.appendChild(innerSpan);
        } else {
            newRow.contentEditable = 'false';
            var textSpanNew = document.createElement('span');
            textSpanNew.className = 'note-checklist-text';
            textSpanNew.contentEditable = 'true';
            textSpanNew.setAttribute('tabindex', '0');
            textSpanNew.appendChild(document.createTextNode(' '));
            newRow.appendChild(textSpanNew);
        }
        list.insertBefore(newRow, row.nextSibling);
        if (isDivList) {
            var newInner = newRow.querySelector('.note-checklist-inner');
            if (newInner) {
                newInner.focus();
                var range = document.createRange();
                range.setStart(newInner.firstChild || newInner, 0);
                range.collapse(true);
                sel.removeAllRanges();
                sel.addRange(range);
            }
        } else {
            var range = document.createRange();
            range.setStart(newRow.querySelector('.note-checklist-text').firstChild, 0);
            range.collapse(true);
            sel.removeAllRanges();
            sel.addRange(range);
        }
        autoSave();
    });

    function resetToolbarFormattingDefaults() {
        setHeadingActive('normal');
        var boldBtn = toolbar.querySelector('.toolbar-btn[data-format="bold"]');
        var italicBtn = toolbar.querySelector('.toolbar-btn[data-format="italic"]');
        if (boldBtn) boldBtn.classList.remove('active');
        if (italicBtn) italicBtn.classList.remove('active');
    }

    window.resetToolbarHistory = function() {
        updateHeadingActiveState();
        updateBoldItalicActiveState();
    };

    window.resetToolbarFormattingDefaults = resetToolbarFormattingDefaults;

    window.ensureChecklistTextSpans = function() {
        var content = document.getElementById('content');
        if (!content) return;
        content.querySelectorAll('.note-checklist-delete').forEach(function(el) { el.remove(); });
        content.querySelectorAll('.note-checklist-box').forEach(function(box) {
            box.removeAttribute('style');
            box.removeAttribute('data-cursor-element-id');
        });
        content.querySelectorAll('.note-editor-checklist .note-checklist-item').forEach(function(li) {
            if (li.tagName === 'DIV') {
                if (!li.querySelector('.note-checklist-inner')) {
                    var box = li.querySelector('.note-checklist-box');
                    if (box) {
                        var inner = document.createElement('span');
                        inner.className = 'note-checklist-inner';
                        inner.contentEditable = 'true';
                        while (box.nextSibling) inner.appendChild(box.nextSibling);
                        if (!inner.firstChild) inner.appendChild(document.createTextNode(' '));
                        li.appendChild(inner);
                    }
                }
                return;
            }
            if (li.querySelector('.note-checklist-text')) {
                li.contentEditable = 'false';
                var ts = li.querySelector('.note-checklist-text');
                ts.contentEditable = 'true';
                ts.setAttribute('tabindex', '0');
                return;
            }
            var box = li.querySelector('.note-checklist-box');
            if (!box) return;
            li.contentEditable = 'false';
            var textSpan = document.createElement('span');
            textSpan.className = 'note-checklist-text';
            textSpan.contentEditable = 'true';
            textSpan.setAttribute('tabindex', '0');
            while (box.nextSibling) {
                textSpan.appendChild(box.nextSibling);
            }
            if (!textSpan.firstChild) textSpan.appendChild(document.createTextNode(' '));
            li.appendChild(textSpan);
        });
    };

    const tableToolbar = document.getElementById('table-toolbar');
    const noteEditorSection = document.getElementById('note-editor-section');
    let currentTable = null;
    let currentCell = null;

    function getClosest(el, tagName) {
        tagName = tagName.toUpperCase();
        while (el && el !== contentEl) {
            if (el.nodeType === 1 && el.tagName === tagName) return el;
            el = el.parentNode;
        }
        return null;
    }

    function getCellIndex(cell) {
        var i = 0;
        var c = cell;
        while (c && (c = c.previousSibling)) i++;
        return i;
    }

    function showTableToolbar(table, cell, addGlow) {
        if (addGlow) {
            contentEl.querySelectorAll('table.note-editor-table-focused').forEach(function(t) { t.classList.remove('note-editor-table-focused'); });
            table.classList.add('note-editor-table-focused');
        } else {
            table.classList.remove('note-editor-table-focused');
        }
        currentTable = table;
        currentCell = cell;
        if (!tableToolbar || !noteEditorSection) return;
        var rect = table.getBoundingClientRect();
        var sectionRect = noteEditorSection.getBoundingClientRect();
        tableToolbar.style.display = 'flex';
        tableToolbar.style.top = (rect.top - sectionRect.top - 44) + 'px';
        tableToolbar.style.left = (rect.left - sectionRect.left) + 'px';
    }

    function hideTableToolbar() {
        contentEl.querySelectorAll('table.note-editor-table-focused').forEach(function(t) { t.classList.remove('note-editor-table-focused'); });
        currentTable = null;
        currentCell = null;
        if (tableToolbar) tableToolbar.style.display = 'none';
    }

    function updateTableToolbarVisibility() {
        var sel = window.getSelection();
        contentEl.querySelectorAll('table.note-editor-table-focused').forEach(function(t) { t.classList.remove('note-editor-table-focused'); });
        if (!sel || sel.rangeCount === 0) { hideTableToolbar(); return; }
        var tables = contentEl.querySelectorAll('table');
        var fullySelectedTable = null;
        for (var i = 0; i < tables.length; i++) {
            if (sel.containsNode(tables[i], false)) {
                fullySelectedTable = tables[i];
                break;
            }
        }
        if (fullySelectedTable) {
            var firstCell = fullySelectedTable.querySelector('td');
            showTableToolbar(fullySelectedTable, firstCell, true);
            return;
        }
        var node = sel.anchorNode;
        var cell = getClosest(node, 'TD');
        var table = cell ? getClosest(cell, 'TABLE') : null;
        if (table && contentEl.contains(table)) {
            showTableToolbar(table, cell, false);
        } else {
            hideTableToolbar();
        }
    }

    function addRowAbove() {
        if (!currentTable || !currentCell) return;
        var tbody = currentTable.querySelector('tbody') || currentTable;
        var row = currentCell.parentNode;
        var colCount = row.cells.length;
        var newRow = document.createElement('tr');
        for (var i = 0; i < colCount; i++) {
            var td = document.createElement('td');
            td.innerHTML = '&nbsp;';
            newRow.appendChild(td);
        }
        tbody.insertBefore(newRow, row);
        hideTableToolbar();
        autoSave();
    }

    function addRowBelow() {
        if (!currentTable || !currentCell) return;
        var tbody = currentTable.querySelector('tbody') || currentTable;
        var row = currentCell.parentNode;
        var colCount = row.cells.length;
        var newRow = document.createElement('tr');
        for (var i = 0; i < colCount; i++) {
            var td = document.createElement('td');
            td.innerHTML = '&nbsp;';
            newRow.appendChild(td);
        }
        tbody.insertBefore(newRow, row.nextSibling);
        hideTableToolbar();
        autoSave();
    }

    function addColumnLeft() {
        if (!currentTable || !currentCell) return;
        var tbody = currentTable.querySelector('tbody') || currentTable;
        var cellIndex = getCellIndex(currentCell);
        var rows = tbody.querySelectorAll('tr');
        for (var r = 0; r < rows.length; r++) {
            var td = document.createElement('td');
            td.innerHTML = '&nbsp;';
            rows[r].insertBefore(td, rows[r].cells[cellIndex]);
        }
        hideTableToolbar();
        autoSave();
    }

    function addColumnRight() {
        if (!currentTable || !currentCell) return;
        var tbody = currentTable.querySelector('tbody') || currentTable;
        var cellIndex = getCellIndex(currentCell);
        var rows = tbody.querySelectorAll('tr');
        for (var r = 0; r < rows.length; r++) {
            var td = document.createElement('td');
            td.innerHTML = '&nbsp;';
            rows[r].insertBefore(td, rows[r].cells[cellIndex + 1] || null);
        }
        hideTableToolbar();
        autoSave();
    }

    function deleteTable() {
        if (!currentTable) return;
        var table = currentTable;
        hideTableToolbar();
        var next = table.nextSibling;
        table.remove();
        if (next && next.nodeType === 1 && next.tagName === 'P' && !next.textContent.trim()) next.remove();
        autoSave();
    }

    contentEl.addEventListener('click', function() {
        setTimeout(updateTableToolbarVisibility, 10);
    });
    contentEl.addEventListener('keyup', function() {
        setTimeout(updateTableToolbarVisibility, 10);
    });
    contentEl.addEventListener('focus', updateTableToolbarVisibility);
    document.addEventListener('click', function(e) {
        if (tableToolbar && tableToolbar.contains(e.target)) return;
        if (contentEl.contains(e.target)) return;
        hideTableToolbar();
    });

    if (tableToolbar) {
        tableToolbar.addEventListener('click', function(e) {
            var btn = e.target.closest('.table-toolbar-btn[data-table-action]');
            if (!btn) return;
            e.preventDefault();
            var action = btn.getAttribute('data-table-action');
            if (action === 'row-above') addRowAbove();
            else if (action === 'row-below') addRowBelow();
            else if (action === 'col-left') addColumnLeft();
            else if (action === 'col-right') addColumnRight();
            else if (action === 'delete-table') deleteTable();
        });
    }
})();

document.getElementById('search-input').addEventListener('input', function(e) {
    const searchTerm = e.target.value.toLowerCase();
    const noteItems = document.querySelectorAll('.note-item');
    
    noteItems.forEach(item => {
        const title = item.querySelector('.note-item-title').textContent.toLowerCase();
        const preview = item.querySelector('.note-item-preview').textContent.toLowerCase();
        
        if (title.includes(searchTerm) || preview.includes(searchTerm)) {
            item.style.display = '';
        } else {
            item.style.display = 'none';
        }
    });
});

function sendNoteToChatIframe(opts) {
    const iframe = document.getElementById('chat-iframe');
    if (!iframe || !iframe.contentWindow) return;
    var options = opts || {};
    const titleEl = document.getElementById('title');
    const contentEl = document.getElementById('content');
    const noteId = currentNoteId;
    if (currentNoteContentHidden) {
        iframe.contentWindow.postMessage({
            type: 'SET_NOTE',
            note_id: noteId,
            title: '',
            content: '',
            note_privacy_locked: true
        }, '*');
        return;
    }
    const title = (titleEl && titleEl.value) ? titleEl.value.trim() : '';
    const content = (contentEl && contentEl.innerText) ? contentEl.innerText.trim() : '';
    var payload = { type: 'SET_NOTE', note_id: noteId, title: title, content: content };
    if (options.play_intro_typing) payload.play_intro_typing = true;
    if (options.animate_quick_actions) payload.animate_quick_actions = true;
    if (options.panel_reopened) payload.panel_reopened = true;
    if (options.saved_chat_history !== undefined) payload.saved_chat_history = options.saved_chat_history;
    if (options.saved_chat_features !== undefined) payload.saved_chat_features = options.saved_chat_features;
    if (options.show_returning_session_hint) payload.show_returning_session_hint = true;
    if (options.sync_note_context_only) payload.sync_note_context_only = true;
    iframe.contentWindow.postMessage(payload, '*');
}


function openChatPanelThenSendIframe(opts) {
    var panelWrapper = document.getElementById('chat-panel-wrapper');
    if (!panelWrapper) {
        sendNoteToChatIframe(opts || {});
        return;
    }
    panelWrapper.classList.add('chat-panel-closed');
    setTimeout(function() {
        panelWrapper.classList.remove('chat-panel-closed');
        setTimeout(function() {
            sendNoteToChatIframe(opts || {});
        }, 120);
    }, 450);
}

function openAiPanelAfterUnlock() {
    var wrap = document.getElementById('chat-panel-wrapper');
    var noteId = currentNoteId;
    if (noteId == null || noteId === '') return;
    if (window.chatProgressAtLockTime) {
        delete window.chatProgressAtLockTime[noteId];
    }
    var startedId = noteId;
    var runSend = function(opts) {
        var send = function() {
            sendNoteToChatIframe(opts || {});
        };
        if (!wrap) {
            send();
            return;
        }
        if (wrap.classList.contains('chat-panel-closed')) {
            wrap.classList.remove('chat-panel-closed');
            setTimeout(send, 150);
        } else {
            send();
        }
    };
    fetch('/get_note/' + startedId)
        .then(function(r) { return r.json(); })
        .then(function(d) {
            if (String(currentNoteId) !== String(startedId)) return;
            if (!d || !d.success) {
                runSend({ saved_chat_history: [], saved_chat_features: {} });
                return;
            }
            var hist = Array.isArray(d.chat_history) ? d.chat_history : [];
            var feats = d.chat_features && typeof d.chat_features === 'object' ? d.chat_features : {};
            var opts = {
                saved_chat_history: hist,
                saved_chat_features: feats
            };
            if (hist.length > 0) {
                opts.show_returning_session_hint = true;
            }
            runSend(opts);
        })
        .catch(function() {
            if (String(currentNoteId) !== String(startedId)) return;
            runSend({ saved_chat_history: [], saved_chat_features: {} });
        });
}

window.addEventListener('message', function(e) {
    if (e.data && e.data.type === 'CHAT_INTRO_TYPING_START') {
        chatIntroTypingStartReceived = true;
        tryFlushIntroSyncedTitle();
        return;
    }
    if (e.data && e.data.type === 'CHAT_PROGRESS_FOR_NOTE') {
        window.chatProgressByNote = window.chatProgressByNote || {};
        window.chatProgressByNote[e.data.note_id] = !!e.data.has_progress;
        return;
    }
    if (e.data && e.data.type === 'NOTE_ACTIVITY_BUMP') {
        var nid = e.data.note_id;
        var rt = e.data.relative_time;
        if (nid != null && rt) {
            var noteEl = document.querySelector('[data-note-id="' + nid + '"]');
            if (noteEl) {
                var dateEl = noteEl.querySelector('.note-item-date');
                if (dateEl) dateEl.textContent = rt;
                var notesList = document.getElementById('notes-list');
                if (notesList && noteEl.parentNode === notesList && notesList.firstChild !== noteEl) {
                    notesList.insertBefore(noteEl, notesList.firstChild);
                }
            }
        }
        if (nid != null && typeof e.data.show_reminder !== 'undefined') {
            applySidebarReminderStateForNote(nid, e.data.show_reminder, e.data.reminder_nudge_text, e.data.reminder_enabled);
        }
        return;
    }
    if (e.data && e.data.type === 'NOTE_REMINDER_SYNC') {
        var nid2 = e.data.note_id;
        if (nid2 != null && typeof e.data.show_reminder !== 'undefined') {
            applySidebarReminderStateForNote(nid2, e.data.show_reminder, e.data.reminder_nudge_text, e.data.reminder_enabled);
        }
        return;
    }
    if (e.data && e.data.type === 'GET_NOTE') {
        if (currentNoteContentHidden) {
            if (e.source && e.source.postMessage) {
                e.source.postMessage({
                    type: 'NOTE',
                    requestId: e.data.requestId,
                    note_id: currentNoteId,
                    title: '',
                    content: '',
                    note_privacy_locked: true
                }, e.origin || '*');
            }
            return;
        }
        const titleEl = document.getElementById('title');
        const contentEl = document.getElementById('content');
        const title = (titleEl && titleEl.value) ? titleEl.value.trim() : '';
        const content = (contentEl && contentEl.innerText) ? contentEl.innerText.trim() : '';
        if (e.source && e.source.postMessage) {
            e.source.postMessage({ type: 'NOTE', requestId: e.data.requestId, note_id: currentNoteId, title: title, content: content }, e.origin || '*');
        }
    }
});

(function() {
    const wrapper = document.getElementById('chat-panel-wrapper');
    const closeBtn = document.getElementById('chat-panel-close');
    const toolbarToggle = document.getElementById('ai-assistant-toggle-btn');
    if (!wrapper || !closeBtn) return;
    function replayIntroAfterOpen() {
        sendNoteToChatIframe({ panel_reopened: true });
    }
    function closePanel() {
        wrapper.classList.add('chat-panel-closed');
    }
    function openPanel() {
        if (wrapper.classList.contains('chat-panel-closed')) {
            wrapper.classList.remove('chat-panel-closed');
            setTimeout(replayIntroAfterOpen, 150);
        }
    }
    function togglePanel() {
        wrapper.classList.toggle('chat-panel-closed');
        if (!wrapper.classList.contains('chat-panel-closed')) {
            setTimeout(replayIntroAfterOpen, 150);
        }
    }
    closeBtn.addEventListener('click', closePanel);
    if (toolbarToggle) toolbarToggle.addEventListener('click', togglePanel);
    window.openChatPanelIfClosed = openPanel;
})();

function clearReminderSubmenuFixedStyles(sub) {
    if (!sub) return;
    sub.classList.remove('note-card-menu-sub--fixed');
    ['position', 'left', 'top', 'right', 'bottom', 'zIndex', 'minWidth', 'visibility', 'marginLeft', 'marginTop', 'marginRight', 'marginBottom', 'pointerEvents', 'transform'].forEach(function(k) {
        sub.style[k] = '';
    });
}

function closeAllNoteCardMenus() {
    if (typeof window.__cancelReminderFlyoutHide === 'function') {
        window.__cancelReminderFlyoutHide();
    }
    document.querySelectorAll('.note-card-menu-sub').forEach(clearReminderSubmenuFixedStyles);
    document.querySelectorAll('.note-card-menu-dropdown').forEach(function(dd) {
        dd.setAttribute('hidden', '');
    });
    document.querySelectorAll('.note-card-menu-btn').forEach(function(b) {
        b.setAttribute('aria-expanded', 'false');
    });
}


(function initReminderFlyoutFixedLayer() {
    var notesList = document.getElementById('notes-list');
    if (!notesList || notesList.dataset.reminderFlyoutInit) return;
    notesList.dataset.reminderFlyoutInit = '1';

    var anchorHost = null;
    var flyoutHideTimer = null;

    function cancelHideFlyout() {
        if (flyoutHideTimer) {
            clearTimeout(flyoutHideTimer);
            flyoutHideTimer = null;
        }
    }

    function scheduleHideFlyout(host) {
        cancelHideFlyout();
        flyoutHideTimer = setTimeout(function() {
            flyoutHideTimer = null;
            var sub = host && host.querySelector ? host.querySelector('.note-card-menu-sub') : null;
            if (!sub || !sub.classList.contains('note-card-menu-sub--fixed')) return;
            try {
                if (host.matches(':hover')) return;
                if (sub.matches(':hover')) return;
            } catch (err) {}
            clearReminderSubmenuFixedStyles(sub);
            if (anchorHost === host) anchorHost = null;
        }, 220);
    }

    window.__cancelReminderFlyoutHide = cancelHideFlyout;

    function positionReminderFlyout(host) {
        var liHost = host && host.closest ? host.closest('.note-item') : null;
        if (isSidebarNoteLocked(liHost)) return;
        var sub = host.querySelector('.note-card-menu-sub');
        if (!sub) return;
        requestAnimationFrame(function() {
            requestAnimationFrame(function() {
                var trigger = host.querySelector('.note-card-menu-sub-trigger');
                if (!trigger) return;
                var tr = trigger.getBoundingClientRect();
                var dd = host.closest('.note-card-menu-dropdown');
                var ddRect = dd ? dd.getBoundingClientRect() : tr;
                
                sub.style.marginLeft = '0';
                sub.style.marginTop = '0';
                sub.style.marginRight = '0';
                sub.style.marginBottom = '0';
                sub.style.transform = 'none';
                
                var overlapPx = 22;
                var minW = 168;
                sub.style.minWidth = minW + 'px';
                sub.classList.add('note-card-menu-sub--fixed');
                sub.style.position = 'fixed';
                sub.style.visibility = 'visible';
                sub.style.pointerEvents = 'auto';
                var subW = Math.max(sub.getBoundingClientRect().width || minW, sub.offsetWidth || minW, minW);
                var subH = Math.max(sub.offsetHeight || 0, sub.getBoundingClientRect().height) || 160;
                var left = Math.round(ddRect.right - overlapPx);
                var top = Math.round(tr.top);
                if (left + subW > window.innerWidth - 12) {
                    left = Math.round(ddRect.left - subW + overlapPx);
                }
                if (left < 12) left = 12;
                var maxTop = window.innerHeight - subH - 12;
                if (top > maxTop) top = Math.max(12, maxTop);
                if (top < 12) top = 12;
                sub.style.left = left + 'px';
                sub.style.top = top + 'px';
                sub.style.right = 'auto';
                sub.style.bottom = 'auto';
                sub.style.zIndex = '2147483000';
            });
        });
    }

    notesList.addEventListener('mouseover', function(e) {
        var host = e.target.closest('.note-card-menu-item--sub');
        if (!host || !notesList.contains(host)) return;
        var liH = host.closest('.note-item');
        if (isSidebarNoteLocked(liH)) return;
        cancelHideFlyout();
        anchorHost = host;
        positionReminderFlyout(host);
    }, true);

    notesList.addEventListener('mouseout', function(e) {
        var host = e.target.closest('.note-card-menu-item--sub');
        if (!host || !notesList.contains(host)) return;
        var rel = e.relatedTarget;
        if (rel && host.contains(rel)) return;
        scheduleHideFlyout(host);
    }, true);

    notesList.addEventListener('scroll', function() {
        if (!anchorHost || !document.body.contains(anchorHost)) return;
        try {
            if (anchorHost.matches(':hover')) positionReminderFlyout(anchorHost);
        } catch (err) {}
    }, true);

    window.addEventListener('resize', function() {
        if (anchorHost && document.body.contains(anchorHost)) {
            try {
                if (anchorHost.matches(':hover')) positionReminderFlyout(anchorHost);
            } catch (err) {}
        }
    });

    notesList.addEventListener('focusin', function(e) {
        var host = e.target.closest('.note-card-menu-item--sub');
        if (!host || !notesList.contains(host)) return;
        var liF = host.closest('.note-item');
        if (isSidebarNoteLocked(liF)) return;
        anchorHost = host;
        positionReminderFlyout(host);
    }, true);
})();

function setNotesSidebarSelectionMode(on) {
    var sidebar = document.querySelector('.sidebar');
    if (!sidebar) return;
    var en = !!on;
    sidebar.classList.toggle('notes-selection-mode', en);
    if (!en) {
        document.querySelectorAll('#notes-list .note-item.selected').forEach(function(li) {
            li.classList.remove('selected');
        });
    }
}

function collectSelectedSidebarNoteIds() {
    var ids = [];
    document.querySelectorAll('#notes-list .note-item.selected').forEach(function(li) {
        var id = li.getAttribute('data-note-id');
        if (id && id !== 'new') ids.push(parseInt(id, 10));
    });
    return ids;
}

function exitSidebarSelectionModeIfNothingSelected() {
    if (collectSelectedSidebarNoteIds().length === 0) {
        setNotesSidebarSelectionMode(false);
    }
}

function updateSidebarNotesCountHeader() {
    var n = document.querySelectorAll('#notes-list .note-item').length;
    var h = document.querySelector('.sidebar-header h3');
    if (h) h.textContent = 'All Notes (' + n + ')';
}

var pageToastHideTimer = null;
function showPageToast(message, durationMs) {
    var el = document.getElementById('page-toast');
    if (!el || !message) return;
    if (durationMs == null) durationMs = 3200;
    if (pageToastHideTimer) {
        clearTimeout(pageToastHideTimer);
        pageToastHideTimer = null;
    }
    el.textContent = message;
    el.removeAttribute('hidden');
    el.classList.add('page-toast--visible');
    pageToastHideTimer = setTimeout(function() {
        el.classList.remove('page-toast--visible');
        el.setAttribute('hidden', '');
        pageToastHideTimer = null;
    }, durationMs);
}

function setNoteReminderFromSidebar(li, noteId, payload) {
    fetch('/note/' + noteId + '/reminder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload || {})
    })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (data.locked) {
                showReminderLockedModal();
                return;
            }
            if (!data.success) return;
            delete li.dataset.reminderNudgeSuppressed;
            li.dataset.reminderEnabled = data.reminder_enabled ? 'true' : 'false';
            if (data.reminder_idle_hours != null) {
                li.dataset.reminderIdleHours = String(data.reminder_idle_hours);
            }
            if (data.reminder_target_at) {
                li.dataset.reminderTargetAt = data.reminder_target_at;
            } else {
                delete li.dataset.reminderTargetAt;
            }
            var slot = li.querySelector('.note-card-menu-reminder-slot');
            if (slot) {
                slot.innerHTML = getReminderSlotHtmlForSidebar(!!data.reminder_enabled);
            }
            li.classList.toggle('note-item-reminder-active', !!data.show_reminder);
            updateSidebarReminderAlarmEl(li, !!data.reminder_enabled);
            if (data.show_reminder) {
                var nudgeText = data.reminder_nudge_text;
                if (!nudgeText) {
                    var hIdle = data.reminder_idle_hours != null ? data.reminder_idle_hours : parseInt(li.dataset.reminderIdleHours || '24', 10);
                    nudgeText = formatSidebarReminderNudgeText(hIdle);
                }
                sidebarReminderNudgeSetOpen(li, true, { text: nudgeText });
            } else {
                sidebarReminderNudgeSetOpen(li, false);
            }
            if (data.reminder_target_at && !data.show_reminder) {
                scheduleReminderScheduledRefresh(li, noteId, data.reminder_target_at);
            } else {
                clearReminderScheduledRefresh(noteId);
            }
            if (data.reminder_enabled) {
                showPageToast('Reminder set');
            } else {
                showPageToast('Reminder turned off');
            }
        })
        .catch(function() {});
}

function softDeleteNoteFromSidebar(li, noteId) {
    clearReminderScheduledRefresh(noteId);
    fetch('/delete_note/' + noteId, { method: 'POST' })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (!data.success) return;
            clearReminderNudgeAutoHideTimer(li);
            li.remove();
            updateSidebarNotesCountHeader();
            if (currentNoteId === noteId) {
                closeNote();
                currentNoteId = null;
                clearLastOpenNoteId();
            }
            showPageToast('Note deleted');
            exitSidebarSelectionModeIfNothingSelected();
        })
        .catch(function() {});
}

document.addEventListener('click', function(e) {
    if (e.target.closest('.note-card-menu-wrap')) return;
    
    if (e.target.closest('.note-card-menu-sub')) return;
    closeAllNoteCardMenus();
});

document.getElementById('sidebar-bulk-trash-btn').addEventListener('click', function(e) {
    e.preventDefault();
    e.stopPropagation();
    var sidebar = document.querySelector('.sidebar');
    var inSelection = sidebar && sidebar.classList.contains('notes-selection-mode');
    var selectedIds = collectSelectedSidebarNoteIds();
    var ids;

    if (inSelection) {
        if (!selectedIds.length) {
            setNotesSidebarSelectionMode(false);
            return;
        }
        ids = selectedIds;
    } else {
        if (currentNoteId == null) return;
        ids = [currentNoteId];
    }

    var modalOpts = {
        title: 'Delete notes',
        message: 'Are you sure you want to delete these notes?'
    };
    showDeleteNoteModal(modalOpts).then(function(confirmed) {
        if (!confirmed) return;
        fetch('/delete_notes_bulk', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ note_ids: ids })
        })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                if (!data.success) return;
                var deletedCurrent = currentNoteId != null && ids.indexOf(currentNoteId) >= 0;
                ids.forEach(function(nid) {
                    var row = document.querySelector('#notes-list .note-item[data-note-id="' + nid + '"]');
                    if (row) row.remove();
                });
                updateSidebarNotesCountHeader();
                setNotesSidebarSelectionMode(false);
                if (deletedCurrent) {
                    closeNote();
                    currentNoteId = null;
                    clearLastOpenNoteId();
                }
                var n = ids.length;
                showPageToast(n === 1 ? 'Note deleted' : n + ' notes deleted');
            })
            .catch(function() {});
    });
});

document.getElementById('notes-list').addEventListener('click', function(e) {
    var nudgeHit = e.target.closest('.note-reminder-nudge-shell');
    if (nudgeHit) {
        var liNudge = nudgeHit.closest('.note-item');
        var nudgeWrap = liNudge && liNudge.querySelector('.note-reminder-nudge');
        if (liNudge && nudgeWrap && nudgeWrap.classList.contains('note-reminder-nudge--open')) {
            e.preventDefault();
            e.stopPropagation();
            var rawNid = liNudge.getAttribute('data-note-id');
            if (rawNid && rawNid !== 'new') {
                clearReminderNudgeAutoHideTimer(liNudge);
                sidebarReminderNudgeSetOpen(liNudge, false);
                liNudge.dataset.reminderNudgeSuppressed = 'true';
            } else {
                sidebarReminderNudgeSetOpen(liNudge, false, { fromClick: true });
            }
            return;
        }
    }
    var menuBtn = e.target.closest('.note-card-menu-btn');
    if (menuBtn) {
        e.stopPropagation();
        var wrap = menuBtn.closest('.note-card-menu-wrap');
        var dd = wrap.querySelector('.note-card-menu-dropdown');
        var wasOpen = !dd.hasAttribute('hidden');
        closeAllNoteCardMenus();
        if (wasOpen) return;
        dd.removeAttribute('hidden');
        menuBtn.setAttribute('aria-expanded', 'true');
        return;
    }
    var lockedSetReminderHost = e.target.closest('.note-item[data-is-locked="true"] .note-card-menu-item--sub');
    if (lockedSetReminderHost && lockedSetReminderHost.closest('.note-card-menu-dropdown') && !e.target.closest('.note-card-menu-sub')) {
        e.stopPropagation();
        closeAllNoteCardMenus();
        showReminderLockedModal();
        return;
    }
    var subReminder = e.target.closest('.note-card-menu-subitem[data-idle-hours]');
    if (subReminder && subReminder.closest('.note-card-menu-dropdown')) {
        e.stopPropagation();
        var liSub = subReminder.closest('.note-item');
        if (isSidebarNoteLocked(liSub)) {
            closeAllNoteCardMenus();
            showReminderLockedModal();
            return;
        }
        var rawIdSub = liSub.getAttribute('data-note-id');
        var idleH = subReminder.getAttribute('data-idle-hours');
        closeAllNoteCardMenus();
        if (rawIdSub === 'new' || !idleH) return;
        if (idleH === 'custom') {
            openReminderCustomModal(liSub, parseInt(rawIdSub, 10));
            return;
        }
        setNoteReminderFromSidebar(liSub, parseInt(rawIdSub, 10), { enabled: true, idle_hours: parseInt(idleH, 10) });
        return;
    }
    var reminderOffBtn = e.target.closest('.note-card-menu-item[data-action="reminder-off"]');
    if (reminderOffBtn && reminderOffBtn.closest('.note-card-menu-dropdown')) {
        e.stopPropagation();
        var liOff = reminderOffBtn.closest('.note-item');
        var rawIdOff = liOff.getAttribute('data-note-id');
        closeAllNoteCardMenus();
        if (rawIdOff === 'new') return;
        setNoteReminderFromSidebar(liOff, parseInt(rawIdOff, 10), { enabled: false });
        return;
    }
    var menuItem = e.target.closest('.note-card-menu-item[data-action]');
    if (menuItem && menuItem.closest('.note-card-menu-dropdown')) {
        e.stopPropagation();
        var action = menuItem.getAttribute('data-action');
        var li = menuItem.closest('.note-item');
        var rawId = li.getAttribute('data-note-id');
        closeAllNoteCardMenus();
        if (rawId === 'new') {
            if (action === 'select') setNotesSidebarSelectionMode(true);
            return;
        }
        var nid = parseInt(rawId, 10);
        if (action === 'select') {
            setNotesSidebarSelectionMode(true);
            li.classList.add('selected');
        } else if (action === 'unlock') {
            beginSidebarUnlock(nid);
        } else if (action === 'lock') {
            beginSidebarLock(nid);
        } else if (action === 'delete') {
            showDeleteNoteModal().then(function(confirmed) {
                if (confirmed) softDeleteNoteFromSidebar(li, nid);
            });
        }
        return;
    }
    
    if (e.target.closest('.note-card-menu-dropdown:not([hidden])')) {
        e.stopPropagation();
        return;
    }
    var li = e.target.closest('.note-item');
    if (!li) return;
    var id = li.getAttribute('data-note-id');
    if (id === 'new') { document.getElementById('title').focus(); return; }
    var sidebar = document.querySelector('.sidebar');
    if (sidebar.classList.contains('notes-selection-mode')) {
        if (id !== 'new') {
            li.classList.toggle('selected');
            exitSidebarSelectionModeIfNothingSelected();
        }
        return;
    }
    loadNote(parseInt(id, 10));
});

(function syncReminderNudgesBeforeRestoreOpenNote() {
    syncSidebarReminderNudgesToActiveNoteOnly();
})();

(function initReminderStateSync() {
    syncReminderStateForEnabledSidebarNotes();
    setInterval(syncReminderStateForEnabledSidebarNotes, 30000);
    document.addEventListener('visibilitychange', function() {
        if (!document.hidden) syncReminderStateForEnabledSidebarNotes();
    });
})();

(function initReminderNudgeViewportSync() {
    var list = document.getElementById('notes-list');
    if (!list) return;
    function onScrollResize() {
        if (reminderNudgeViewportTicking) return;
        reminderNudgeViewportTicking = true;
        requestAnimationFrame(function() {
            reminderNudgeViewportTicking = false;
            refreshAllOpenReminderNudgePositions();
        });
    }
    list.addEventListener('scroll', onScrollResize, { passive: true });
    window.addEventListener('resize', onScrollResize);
    requestAnimationFrame(function() {
        refreshAllOpenReminderNudgePositions();
    });
})();

(function restoreLastOpenNoteOnLoad() {
    try {
        if (sessionStorage.getItem(SKIP_NOTE_RESTORE_SESSION_KEY) === '1') {
            sessionStorage.removeItem(SKIP_NOTE_RESTORE_SESSION_KEY);
            clearLastOpenNoteId();
            return;
        }
    } catch (err) {}
    try {
        var raw = localStorage.getItem(LAST_NOTE_STORAGE_KEY);
        if (!raw) return;
        var id = parseInt(raw, 10);
        if (!id || id !== id || id < 1) return;
        var item = document.querySelector('#notes-list [data-note-id="' + id + '"]');
        if (!item) {
            clearLastOpenNoteId();
            return;
        }
        loadNote(id);
    } catch (err) {}
})();

(function setupLogoutClearsLastOpenNote() {
    var logoutEl = document.getElementById('dashboard-logout-link');
    if (!logoutEl) return;
    logoutEl.addEventListener('click', function () {
        clearLastOpenNoteId();
        try {
            sessionStorage.setItem(SKIP_NOTE_RESTORE_SESSION_KEY, '1');
        } catch (e) {}
    });
})();