// Author: Adam H. Ahmadi ID: 23160330
(function() {
    var el = document.getElementById('note-init-data');
    var data = el ? JSON.parse(el.textContent) : { id: null, title: "", content: "", is_locked: false, content_hidden: false };
    window._noteId = data.id;
    window._initialTitle = data.title || "";
    window._initialContent = data.content || "";
    window._initialLocked = !!data.is_locked;
    window._contentHidden = !!data.content_hidden;
})();
var noteId = window._noteId;
var initialTitle = window._initialTitle;
var initialContent = window._initialContent;
var noteLocked = window._initialLocked;
var noteContentHidden = window._contentHidden;

var timeout = null;

function applyNoteLockStatePage(locked) {
    noteLocked = !!locked;
    var titleEl = document.getElementById('title');
    var contentEl = document.getElementById('content');
    var lockBtn = document.getElementById('note-lock-btn-page');
    if (titleEl) titleEl.readOnly = noteLocked;
    if (contentEl) contentEl.readOnly = noteLocked;
    document.querySelectorAll('.note-toolbar .toolbar-btn').forEach(function(btn) {
        btn.disabled = noteLocked;
    });
    if (lockBtn) {
        lockBtn.classList.toggle('is-locked', noteLocked);
        var label = lockBtn.querySelector('.note-lock-label');
        if (label) label.textContent = noteLocked ? 'Remove lock' : 'Lock';
        lockBtn.title = noteLocked ? 'Remove password protection' : 'Lock with password';
        lockBtn.setAttribute('aria-label', noteLocked ? 'Remove lock' : 'Lock note');
    }
}

function updateLockBtnPage() {
    var lockBtn = document.getElementById('note-lock-btn-page');
    if (!lockBtn) return;
    var hasSaved = !!noteId;
    var hide = !hasSaved || noteContentHidden;
    lockBtn.hidden = hide;
    lockBtn.disabled = hide;
}

function setNotePagePrivacyHidden(hidden) {
    noteContentHidden = !!hidden;
    var root = document.getElementById('note-page-privacy-root');
    if (root) root.classList.toggle('is-content-hidden', noteContentHidden);
}

function syncChatNotePage() {
    var iframe = document.getElementById('chat-iframe');
    if (!iframe || !iframe.contentWindow || !noteId) return;
    if (noteContentHidden) {
        iframe.contentWindow.postMessage({ type: 'SET_NOTE', note_id: noteId, title: '', content: '', note_privacy_locked: true }, '*');
        return;
    }
    var t = document.getElementById('title');
    var c = document.getElementById('content');
    iframe.contentWindow.postMessage({
        type: 'SET_NOTE',
        note_id: noteId,
        title: (t && t.value) ? t.value.trim() : '',
        content: (c && c.value) ? c.value : ''
    }, '*');
}

function promptUnlockNotePage() {
    var pw = window.prompt('Enter your password:');
    if (pw === null) return;
    fetch('/verify_note_lock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note_id: noteId, password: pw })
    })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (data.success) {
                setNotePagePrivacyHidden(false);
                document.getElementById('title').value = data.title || '';
                document.getElementById('content').value = data.content || '';
                noteLocked = !!data.is_locked;
                applyNoteLockStatePage(noteLocked);
                updateLockBtnPage();
                syncChatNotePage();
            } else {
                alert(data.error || 'Could not unlock');
            }
        })
        .catch(function() { alert('Could not unlock'); });
}

function toggleNoteLockPage() {
    if (!noteId || noteContentHidden) return;
    if (noteLocked) {
        var pw = window.prompt('Enter your password to remove lock:');
        if (pw === null || pw === '') return;
        fetch('/clear_note_lock', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ note_id: noteId, password: pw })
        })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                if (data.success) {
                    applyNoteLockStatePage(false);
                    syncChatNotePage();
                } else {
                    alert(data.error || 'Failed');
                }
            })
            .catch(function() {});
        return;
    }
    var p1 = window.prompt('Enter your password to lock this note:');
    if (p1 === null || p1 === '') return;
    fetch('/set_note_lock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note_id: noteId, password: p1 })
    })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (data.success) {
                applyNoteLockStatePage(true);
                updateLockBtnPage();
                syncChatNotePage();
            } else {
                alert(data.error || 'Failed to lock');
            }
        })
        .catch(function() {});
}

function autoSave() {
    clearTimeout(timeout);

    timeout = setTimeout(() => {
        if (noteLocked || noteContentHidden) return;
        fetch("/autosave_note", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                note_id: noteId,
                title: document.getElementById("title").value,
                content: document.getElementById("content").value
            })
        })
        .then(response => response.json())
        .then(data => {
            if (data.locked) {
                applyNoteLockStatePage(true);
                return;
            }
            if (data.note_id) {
                noteId = data.note_id;
                updateLockBtnPage();
            }
        })
        .catch(error => console.error('Autosave failed:', error));
    }, 800);
}

function deleteNote() {
    if (!noteId) {
        alert('Please save the note before deleting.');
        return;
    }

    if (!confirm('Are you sure you want to delete this note?')) {
        return;
    }

    fetch("/delete_note/" + noteId, {
        method: "POST"
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            window.location.href = "/dashboard";
        } else {
            alert('Failed to delete note.');
        }
    })
    .catch(error => console.error('Delete failed:', error));
}

window.addEventListener("DOMContentLoaded", function() {

    document.getElementById("title").value = initialTitle;
    document.getElementById("content").value = initialContent;

    setNotePagePrivacyHidden(noteContentHidden);
    applyNoteLockStatePage(noteLocked);
    updateLockBtnPage();

    if (noteContentHidden && noteId) {
        promptUnlockNotePage();
    } else {
        setTimeout(syncChatNotePage, 200);
    }

    document.getElementById("title").addEventListener("input", autoSave);
    document.getElementById("content").addEventListener("input", autoSave);

    var lockBtn = document.getElementById('note-lock-btn-page');
    if (lockBtn) lockBtn.addEventListener('click', toggleNoteLockPage);

    lucide.createIcons();
});