// Author: Adam H. Ahmadi ID: 23160330
(function() {
    var list = document.getElementById('trash-list');
    var emptyState = document.getElementById('empty-state');
    var trashNoteEditor = document.getElementById('note-editor');
    var trashTitleInput = document.getElementById('title');
    var trashContentEl = document.getElementById('content');
    var restoreBtn = document.getElementById('restore-btn');
    var permanentlyDeleteBtn = document.getElementById('permanently-delete-btn');
    var searchInput = document.getElementById('search-input');
    var deletedNoteModal = document.getElementById('deleted-note-modal');
    var deletedNoteCancelBtn = document.getElementById('deleted-note-cancel-btn');
    var deletedNoteRecoverBtn = document.getElementById('deleted-note-recover-btn');
    var toolbar = document.querySelector('.note-toolbar');
    var sidebar = document.querySelector('.sidebar');
    var selectedNoteId = null;

    function setTrashPreviewHtml(el, raw) {
        if (!el) return;
        raw = raw || '';
        if (raw && raw.indexOf('<') === -1) el.innerHTML = raw.replace(/\n/g, '<br>');
        else el.innerHTML = raw;
    }

    function showDeletedNoteModal() {
        if (!selectedNoteId || !deletedNoteModal) return;
        deletedNoteModal.style.display = 'flex';
        deletedNoteModal.setAttribute('aria-hidden', 'false');
    }

    function hideDeletedNoteModal() {
        if (!deletedNoteModal) return;
        deletedNoteModal.style.display = 'none';
        deletedNoteModal.setAttribute('aria-hidden', 'true');
    }

    function restoreSelectedNote() {
        if (!selectedNoteId) return;
        fetch('/restore_note/' + selectedNoteId, { method: 'POST', headers: { 'Content-Type': 'application/json' } })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                if (data.success) window.location.href = window.QUIVLY_DASHBOARD_URL;
                else alert('Failed to recover note.');
            })
            .catch(function(err) { console.error(err); alert('Failed to recover note.'); });
    }

    function selectNote(noteId, title, preview, date) {
        selectedNoteId = noteId;
        if (trashTitleInput) trashTitleInput.value = title || 'Untitled Note';
        if (trashContentEl) trashContentEl.innerHTML = '';
        emptyState.style.display = 'none';
        if (trashNoteEditor) trashNoteEditor.style.display = 'flex';
        document.querySelectorAll('.trash-note-item').forEach(function(el) {
            el.classList.toggle('active', parseInt(el.getAttribute('data-note-id'), 10) === noteId);
        });
        fetch('/get_note/' + noteId)
            .then(function(r) { return r.json(); })
            .then(function(data) {
                if (data.success && parseInt(data.id, 10) === noteId) {
                    if (trashTitleInput) trashTitleInput.value = data.title || 'Untitled Note';
                    var raw = data.content || '';
                    if (trashContentEl) setTrashPreviewHtml(trashContentEl, raw);
                }
            })
            .catch(function(err) { console.error(err); });
    }

    function showEmptyState() {
        selectedNoteId = null;
        emptyState.style.display = 'flex';
        if (trashNoteEditor) trashNoteEditor.style.display = 'none';
        hideDeletedNoteModal();
        document.querySelectorAll('.trash-note-item').forEach(function(el) { el.classList.remove('active'); });
        resetTrashSelectUI();
    }

    function getVisibleItems() {
        return Array.prototype.filter.call(document.querySelectorAll('.trash-note-item'), function(el) {
            return el.style.display !== 'none';
        });
    }

    
    var selectPhase = 0;
    var selectAllBtn = document.getElementById('select-all-btn');

    function resetTrashSelectUI() {
        selectPhase = 0;
        if (sidebar) sidebar.classList.remove('trash-selection-mode');
        document.querySelectorAll('.trash-note-item.selected').forEach(function(el) { el.classList.remove('selected'); });
        if (selectAllBtn) {
            selectAllBtn.textContent = 'Select';
            selectAllBtn.setAttribute('aria-label', 'Select notes');
            selectAllBtn.title = 'Select notes';
        }
    }

    function updateTrashCount() {
        var h3 = document.querySelector('.sidebar-header h3');
        if (h3) {
            var n = document.querySelectorAll('.trash-note-item').length;
            h3.textContent = 'All Trash (' + n + ')';
        }
    }

    if (list) {
        list.addEventListener('click', function(e) {
            var item = e.target.closest('.trash-note-item');
            if (!item) return;
            if (sidebar && sidebar.classList.contains('trash-selection-mode')) {
                e.preventDefault();
                e.stopPropagation();
                item.classList.toggle('selected');
                if (!item.classList.contains('selected')) {
                    item.classList.remove('active');
                }
                return;
            }
            var id = parseInt(item.getAttribute('data-note-id'), 10);
            var titleEl = item.querySelector('.note-item-title');
            var previewEl = item.querySelector('.note-item-preview');
            var dateEl = item.querySelector('.note-item-date');
            var title = titleEl ? titleEl.textContent : '';
            var preview = previewEl ? previewEl.textContent : '';
            var date = dateEl ? dateEl.textContent.replace(/^Deleted\s+/, '') : '';
            selectNote(id, title, preview, date);
        });
    }

    if (selectAllBtn) {
        selectAllBtn.addEventListener('click', function() {
            var visible = getVisibleItems();
            if (selectPhase === 0) {
                if (!visible.length) return;
                selectPhase = 1;
                if (sidebar) sidebar.classList.add('trash-selection-mode');
                visible.forEach(function(el) { el.classList.remove('selected'); });
                selectAllBtn.textContent = 'Select All';
                selectAllBtn.setAttribute('aria-label', 'Select all visible notes in trash');
                selectAllBtn.title = 'Tap to select every note shown, or tap individual notes first';
                return;
            }
            if (selectPhase === 1) {
                visible.forEach(function(el) { el.classList.add('selected'); });
                selectPhase = 2;
                selectAllBtn.textContent = 'Unselect';
                selectAllBtn.setAttribute('aria-label', 'Unselect and exit trash selection mode');
                selectAllBtn.title = 'Tap to clear selection and exit. Use the bin icon to delete selected notes first if needed.';
                return;
            }
            if (selectPhase === 2) {
                resetTrashSelectUI();
            }
        });
    }

    var bulkDeleteBtn = document.getElementById('bulk-delete-btn');
    if (bulkDeleteBtn) {
        bulkDeleteBtn.addEventListener('click', function() {
            var selected = document.querySelectorAll('.trash-note-item.selected');
            if (!selected.length) {
                alert('Select notes to delete.');
                return;
            }
            var ids = Array.prototype.map.call(selected, function(el) { return parseInt(el.getAttribute('data-note-id'), 10); });
            var done = 0;
            var failed = false;
            ids.forEach(function(id) {
                fetch('/permanently_delete_note/' + id, { method: 'POST', headers: { 'Content-Type': 'application/json' } })
                    .then(function(r) { return r.json(); })
                    .then(function(data) {
                        if (data.success) {
                            var el = document.querySelector('.trash-note-item[data-note-id="' + id + '"]');
                            if (el) el.remove();
                        } else failed = true;
                        done++;
                        if (done === ids.length) {
                            if (failed) alert('Some notes could not be deleted.');
                            updateTrashCount();
                            if (document.querySelectorAll('.trash-note-item').length === 0) {
                                showEmptyState();
                            } else {
                                resetTrashSelectUI();
                            }
                        }
                    })
                    .catch(function(err) { console.error(err); failed = true; done++; if (done === ids.length) alert('Failed to delete some notes.'); });
            });
        });
    }

    if (restoreBtn) {
        restoreBtn.addEventListener('click', function() {
            if (!selectedNoteId) return;
            if (!confirm('Recover this note?')) return;
            restoreSelectedNote();
        });
    }

    if (permanentlyDeleteBtn) {
        permanentlyDeleteBtn.addEventListener('click', function() {
            if (!selectedNoteId) return;
            fetch('/permanently_delete_note/' + selectedNoteId, { method: 'POST', headers: { 'Content-Type': 'application/json' } })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (data.success) {
                        var item = document.querySelector('.trash-note-item[data-note-id="' + selectedNoteId + '"]');
                        if (item) item.remove();
                        updateTrashCount();
                        if (document.querySelectorAll('.trash-note-item').length === 0) showEmptyState();
                        else {
                            resetTrashSelectUI();
                            var first = document.querySelector('.trash-note-item');
                            if (first) first.click();
                        }
                    } else alert('Failed to delete note.');
                })
                .catch(function(err) { console.error(err); alert('Failed to delete note.'); });
        });
    }

    if (searchInput) {
        searchInput.addEventListener('input', function() {
            var term = searchInput.value.toLowerCase().trim();
            document.querySelectorAll('.trash-note-item').forEach(function(item) {
                var titleEl = item.querySelector('.note-item-title');
                var previewEl = item.querySelector('.note-item-preview');
                var title = (titleEl ? titleEl.textContent : '').toLowerCase();
                var preview = (previewEl ? previewEl.textContent : '').toLowerCase();
                item.style.display = (!term || title.indexOf(term) !== -1 || preview.indexOf(term) !== -1) ? 'block' : 'none';
            });
        });
    }

    if (deletedNoteCancelBtn) {
        deletedNoteCancelBtn.addEventListener('click', function() {
            hideDeletedNoteModal();
        });
    }

    if (deletedNoteRecoverBtn) {
        deletedNoteRecoverBtn.addEventListener('click', function() {
            restoreSelectedNote();
        });
    }

    if (trashTitleInput) {
        ['click', 'focus', 'keydown', 'input'].forEach(function(evt) {
            trashTitleInput.addEventListener(evt, function(e) {
                if (evt === 'keydown' || evt === 'input') e.preventDefault();
                showDeletedNoteModal();
            });
        });
    }

    if (trashContentEl) {
        ['click', 'focus', 'keydown', 'input', 'paste'].forEach(function(evt) {
            trashContentEl.addEventListener(evt, function(e) {
                if (evt === 'keydown' || evt === 'input' || evt === 'paste') e.preventDefault();
                showDeletedNoteModal();
            });
        });
    }

    if (toolbar) {
        toolbar.addEventListener('click', function(e) {
            if (e.target.closest('.toolbar-btn')) {
                e.preventDefault();
                showDeletedNoteModal();
            }
        });
    }

})();