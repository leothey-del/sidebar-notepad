(function () {
    'use strict';

    // BEGIN PURE
    var imageBase = '';
    function setImageBase(v) { imageBase = v || ''; }

    function esc(s) {
        return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // "text|200" in the alt text means a 200px wide image
    function splitAlt(alt) {
        var m = /^(.*?)\|(\d{1,4})$/.exec(alt);
        if (m) {
            var w = parseInt(m[2], 10);
            if (w >= 16 && w <= 4000) { return { alt: m[1], width: w }; }
        }
        return { alt: alt, width: 0 };
    }

    function inline(raw, lineNo) {
        var stash = [];
        var imageCount = 0;
        function keep(html) {
            stash.push(html);
            return '\u0000' + (stash.length - 1) + '\u0000';
        }
        var out = esc(raw);
        out = out.replace(/`([^`]+)`/g, function (m, c) {
            return keep('<code>' + c + '</code>');
        });
        // Images: ![text](source) or ![text|width](source). Text is already escaped above.
        out = out.replace(/!\[([^\]]*)\]\((https:\/\/[^\s)]+|data:image\/(?:png|jpe?g|gif|webp);base64,[A-Za-z0-9+\/=]+|img:[A-Za-z0-9._-]+)\)/g, function (m, rawAlt, src) {
            var url = src;
            if (src.indexOf('img:') === 0) {
                if (!imageBase) { return m; }
                url = esc(imageBase) + '/' + src.slice(4);
            }
            var a = splitAlt(rawAlt);
            var html = '<img src="' + url + '" alt="' + a.alt + '"';
            if (a.width) { html += ' width="' + a.width + '"'; }
            if (lineNo !== undefined) { html += ' data-line="' + lineNo + '" data-idx="' + imageCount + '"'; }
            imageCount++;
            return keep(html + ' loading="lazy">');
        });
        out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        out = out.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
        out = out.replace(/~~([^~]+)~~/g, '<del>$1</del>');
        out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>');
        out = out.replace(/\u0000(\d+)\u0000/g, function (m, i) {
            return stash[Number(i)];
        });
        return out;
    }

    // Rewrites the width of the idx-th image on a line of text. width 0 removes it.
    function setImageWidthInLine(line, idx, width) {
        var masked = line.replace(/`[^`]*`/g, function (m) { return new Array(m.length + 1).join('x'); });
        var re = /!\[([^\]]*)\]\((https:\/\/[^\s)]+|data:image\/(?:png|jpe?g|gif|webp);base64,[A-Za-z0-9+\/=]+|img:[A-Za-z0-9._-]+)\)/g;
        var m;
        var k = 0;
        while ((m = re.exec(masked))) {
            if (k === idx) {
                var altStart = m.index + 2;
                var alt = line.slice(altStart, altStart + m[1].length).replace(/\|\d{1,4}$/, '');
                var src = line.slice(altStart + m[1].length + 2, m.index + m[0].length - 1);
                return line.slice(0, m.index) + '![' + alt + (width ? '|' + width : '') + '](' + src + ')' +
                    line.slice(m.index + m[0].length);
            }
            k++;
        }
        return line;
    }

    function renderMarkdown(text) {
        var lines = text.split('\n');
        var html = [];
        var list = null;
        var inCode = false;
        var codeBuf = [];

        function closeList() {
            if (list) { html.push('</' + list + '>'); list = null; }
        }
        function openList(type) {
            if (list !== type) { closeList(); html.push('<' + type + '>'); list = type; }
        }

        for (var i = 0; i < lines.length; i++) {
            var line = lines[i];
            var m;

            if (/^```/.test(line)) {
                if (inCode) {
                    html.push('<pre><code>' + esc(codeBuf.join('\n')) + '</code></pre>');
                    codeBuf = [];
                    inCode = false;
                } else {
                    closeList();
                    inCode = true;
                }
                continue;
            }
            if (inCode) { codeBuf.push(line); continue; }

            if ((m = /^\s*[-*+] \[([ xX])\] ?(.*)$/.exec(line))) {
                openList('ul');
                var done = m[1] !== ' ';
                html.push('<li class="task' + (done ? ' done' : '') + '"><input type="checkbox" data-line="' + i + '"' +
                    (done ? ' checked' : '') + '><span>' + inline(m[2], i) + '</span></li>');
                continue;
            }
            if ((m = /^\s*[-*+] (.*)$/.exec(line))) {
                openList('ul');
                html.push('<li>' + inline(m[1], i) + '</li>');
                continue;
            }
            if ((m = /^\s*\d+[.)] (.*)$/.exec(line))) {
                openList('ol');
                html.push('<li>' + inline(m[1], i) + '</li>');
                continue;
            }

            closeList();

            if (line.trim() === '') {
                html.push('<p class="preview-blank-line"><br></p>');
                continue;
            }
            if ((m = /^(#{1,6})\s+(.*)$/.exec(line))) {
                html.push('<h' + m[1].length + '>' + inline(m[2], i) + '</h' + m[1].length + '>');
            } else if ((m = /^>\s?(.*)$/.exec(line))) {
                html.push('<blockquote>' + inline(m[1], i) + '</blockquote>');
            } else if (/^(-{3,}|\*{3,})\s*$/.test(line)) {
                html.push('<hr>');
            } else {
                html.push('<p>' + inline(line, i) + '</p>');
            }
        }

        if (inCode) { html.push('<pre><code>' + esc(codeBuf.join('\n')) + '</code></pre>'); }
        closeList();
        return html.join('');
    }

    function taskStats(text) {
        var total = 0;
        var done = 0;
        var re = /^\s*[-*+] \[([ xX])\]/gm;
        var m;
        while ((m = re.exec(text))) {
            total++;
            if (m[1] !== ' ') { done++; }
        }
        return { total: total, done: done };
    }

    function formatAgo(ts, now) {
        var s = Math.max(0, Math.round((now - ts) / 1000));
        if (s < 45) { return 'just now'; }
        var m = Math.round(s / 60);
        if (m < 60) { return m + 'm ago'; }
        var h = Math.round(m / 60);
        if (h < 24) { return h + 'h ago'; }
        var d = Math.round(h / 24);
        if (d < 30) { return d + 'd ago'; }
        return new Date(ts).toLocaleDateString();
    }
    // END PURE

    if (typeof acquireVsCodeApi !== 'function') { return; }
    var vscode = acquireVsCodeApi();

    var COLORS = ['red', 'orange', 'yellow', 'green', 'blue', 'purple'];
    var EMOJI = { red: '\uD83D\uDD34', orange: '\uD83D\uDFE0', yellow: '\uD83D\uDFE1', green: '\uD83D\uDFE2', blue: '\uD83D\uDD35', purple: '\uD83D\uDFE3' };

    var settings = { autoSaveDelay: 400, fontSize: 13, darkMode: false, newNoteTitle: 'untitled', trashRetentionDays: 30 };
    var pages = [];
    var trash = [];
    var scope = 'global';
    var hasWorkspace = false;
    var currentId = null;
    var previewMode = false;
    var pendingSave = false;
    var saveTimeout = null;
    var flashTimeout = null;
    var previewClickTimeout = null;
    var flashActive = false;
    var lastDeleted = null;
    var panelMode = null;
    var activeResult = 0;
    var visibleResults = [];
    var menuOpen = false;
    var selectedImage = null;
    var confirmTimers = new WeakMap();

    function $(id) { return document.getElementById(id); }

    var el = {
        noteSelect: $('noteSelect'),
        noteSelectBtn: $('noteSelectBtn'),
        notePicker: $('notePicker'),
        themeBtn: $('themeBtn'),
        searchBtn: $('searchBtn'),
        prevBtn: $('prevBtn'),
        nextBtn: $('nextBtn'),
        addBtn: $('addBtn'),
        panel: $('panel'),
        panelInput: $('panelInput'),
        panelTitle: $('panelTitle'),
        panelAction: $('panelAction'),
        panelClose: $('panelClose'),
        panelList: $('panelList'),
        colorDot: $('colorDot'),
        titleInput: $('titleInput'),
        pinBtn: $('pinBtn'),
        previewBtn: $('previewBtn'),
        menuBtn: $('menuBtn'),
        menu: $('menu'),
        linkRow: $('linkRow'),
        linkBtn: $('linkBtn'),
        linkText: $('linkText'),
        linkRemove: $('linkRemove'),
        noteInput: $('noteInput'),
        preview: $('preview'),
        status: $('status'),
        statusText: $('statusText'),
        undoBtn: $('undoBtn'),
        edited: $('edited'),
        scopeChip: $('scopeChip'),
        tasks: $('tasks'),
        counts: $('counts'),
        progressTrack: $('progressTrack'),
        progressBar: $('progressBar'),
        imgBar: $('imgBar'),
        imgHandle: $('imgHandle')
    };

    /* ---------- Model helpers ---------- */

    function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

    function defaultTitle() {
        if (settings.newNoteTitle === 'date') {
            return new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
        }
        return 'Untitled';
    }

    function makeNote(title) {
        return { id: uid(), title: title || defaultTitle(), content: '', updated: Date.now() };
    }

    function isBlankNote(n) {
        return !n.content.trim() && (!n.title || n.title === 'Untitled' || n.title === defaultTitle());
    }

    function currentIndex() {
        for (var i = 0; i < pages.length; i++) {
            if (pages[i].id === currentId) { return i; }
        }
        return -1;
    }

    function currentNote() {
        var i = currentIndex();
        return i >= 0 ? pages[i] : null;
    }

    function ensureCurrent() {
        if (!pages.length) { pages.push(makeNote()); }
        if (currentIndex() < 0) { currentId = pages[0].id; }
    }

    function keepPinnedFirst() {
        pages = pages.filter(function (p) { return p.pinned; }).concat(pages.filter(function (p) { return !p.pinned; }));
    }

    function noteLabel(n, i, maxTitleLength) {
        var t = taskStats(n.content);
        var title = n.title || 'Untitled';
        if (maxTitleLength && title.length > maxTitleLength) {
            title = title.slice(0, maxTitleLength - 1) + '\u2026';
        }
        return (n.pinned ? '\u2605 ' : '') + (n.color ? EMOJI[n.color] + ' ' : '') + (i + 1) + '. ' +
            title + (t.total ? ' (' + t.done + '/' + t.total + ')' : '');
    }

    /* ---------- Saving ---------- */

    function persist() {
        clearTimeout(saveTimeout);
        pendingSave = false;
        vscode.postMessage({ type: 'save', pages: pages, trash: trash });
        el.status.classList.remove('saving');
        if (!flashActive) { el.statusText.textContent = 'Saved'; }
    }

    function persistIfPending() {
        if (pendingSave) { persist(); }
    }

    function markDirty() {
        pendingSave = true;
        flashActive = false;
        el.status.classList.add('saving');
        el.statusText.textContent = 'Saving';
        el.undoBtn.hidden = true;
        clearTimeout(saveTimeout);
        saveTimeout = setTimeout(persist, settings.autoSaveDelay);
    }

    function flash(text, withUndo) {
        clearTimeout(flashTimeout);
        flashActive = true;
        el.status.classList.remove('saving');
        el.statusText.textContent = text;
        el.undoBtn.hidden = !withUndo;
        flashTimeout = setTimeout(function () {
            flashActive = false;
            el.undoBtn.hidden = true;
            if (!pendingSave) { el.statusText.textContent = 'Saved'; }
            lastDeleted = null;
        }, withUndo ? 8000 : 2500);
    }

    function saveViewState() {
        vscode.setState({ currentId: currentId, previewMode: previewMode });
    }

    /* ---------- Rendering ---------- */

    function renderOptions() {
        el.noteSelect.innerHTML = '';
        el.notePicker.innerHTML = '';
        pages.forEach(function (p, idx) {
            var opt = document.createElement('option');
            opt.value = String(idx);
            opt.textContent = noteLabel(p, idx, 35);
            var selected = p.id === currentId;
            if (selected) { opt.selected = true; }
            el.noteSelect.appendChild(opt);

            var item = document.createElement('div');
            item.className = 'note-picker-option';
            item.setAttribute('role', 'option');
            item.setAttribute('aria-selected', selected ? 'true' : 'false');
            item.setAttribute('tabindex', '-1');
            item.dataset.index = String(idx);
            item.title = p.title || 'Untitled';
            item.textContent = noteLabel(p, idx, 35);
            el.notePicker.appendChild(item);
        });
        var current = currentNote();
        el.noteSelectBtn.setAttribute('aria-label', current ? 'Choose note, current note ' + (current.title || 'Untitled') : 'Choose a note');
    }

    function closeNotePicker(restoreFocus) {
        el.notePicker.hidden = true;
        el.noteSelectBtn.setAttribute('aria-expanded', 'false');
        if (restoreFocus) { el.noteSelectBtn.focus(); }
    }

    function positionNotePicker() {
        var anchor = el.noteSelectBtn.getBoundingClientRect();
        var margin = 8;
        var gap = 4;
        var viewportWidth = document.documentElement.clientWidth;
        var viewportHeight = document.documentElement.clientHeight;
        var width = Math.min(240, Math.max(1, viewportWidth - margin * 2));
        var maxHeight = Math.min(240, Math.max(1, viewportHeight - margin * 2));
        var left = Math.max(margin, Math.min(anchor.left, viewportWidth - width - margin));
        var below = viewportHeight - anchor.bottom - gap - margin;
        var above = anchor.top - gap - margin;

        el.notePicker.style.width = width + 'px';
        el.notePicker.style.maxHeight = maxHeight + 'px';
        el.notePicker.style.left = Math.round(left) + 'px';

        var popupHeight = Math.min(el.notePicker.scrollHeight, maxHeight);
        var top = below >= popupHeight || below >= above
            ? anchor.bottom + gap
            : anchor.top - popupHeight - gap;
        top = Math.max(margin, Math.min(top, viewportHeight - popupHeight - margin));
        el.notePicker.style.top = Math.round(top) + 'px';
    }

    function openNotePicker(focusLast) {
        el.notePicker.hidden = false;
        el.noteSelectBtn.setAttribute('aria-expanded', 'true');
        positionNotePicker();
        var options = el.notePicker.querySelectorAll('[role="option"]');
        var target = focusLast ? options[options.length - 1] : el.notePicker.querySelector('[aria-selected="true"]') || options[0];
        if (target) { target.focus(); }
    }

    function chooseNote(index) {
        if (index < 0 || index >= pages.length) { return; }
        el.noteSelect.value = String(index);
        el.noteSelect.dispatchEvent(new Event('change', { bubbles: true }));
        closeNotePicker(true);
    }

    function renderFooter() {
        var n = currentNote();
        if (!n) { return; }
        var text = n.content.trim();
        var words = text ? text.split(/\s+/).length : 0;
        el.counts.textContent = 'Note ' + (currentIndex() + 1) + ' of ' + pages.length + ', ' + words + (words === 1 ? ' word' : ' words');
        el.scopeChip.hidden = scope !== 'workspace';
        el.edited.textContent = n.updated ? 'Edited ' + formatAgo(n.updated, Date.now()) : '';

        var t = taskStats(n.content);
        el.tasks.hidden = !t.total;
        el.progressTrack.hidden = !t.total;
        if (t.total) {
            el.tasks.textContent = t.done + '/' + t.total + ' done';
            el.progressBar.style.width = Math.round((t.done / t.total) * 100) + '%';
        }
    }

    function renderChrome() {
        var n = currentNote();
        var i = currentIndex();
        renderOptions();
        el.prevBtn.disabled = i <= 0;
        el.nextBtn.disabled = i >= pages.length - 1;

        var pinned = !!(n && n.pinned);
        el.pinBtn.setAttribute('aria-pressed', pinned ? 'true' : 'false');
        el.pinBtn.title = pinned ? 'Unpin note' : 'Pin note to the top';

        el.colorDot.hidden = !(n && n.color);
        el.colorDot.className = 'color-dot' + (n && n.color ? ' dot-' + n.color : '');

        el.linkRow.hidden = !(n && n.link);
        if (n && n.link) {
            el.linkText.textContent = n.link.label + ':' + n.link.line;
            el.linkBtn.title = 'Open ' + n.link.label + ' at line ' + n.link.line;
        }
        renderFooter();
    }

    function renderPreview() {
        var n = currentNote();
        if (!n || !n.content.trim()) {
            el.preview.innerHTML = '<p class="empty">Nothing to preview yet.</p>';
            return;
        }
        el.preview.innerHTML = renderMarkdown(n.content);
        reselectImage();
    }

    /* ---------- Image resizing ---------- */

    function findSelectedImg() {
        if (!selectedImage) { return null; }
        return el.preview.querySelector('img[data-line="' + selectedImage.line + '"][data-idx="' + selectedImage.idx + '"]');
    }

    function clearImageSelection() {
        selectedImage = null;
        el.imgBar.hidden = true;
        el.imgHandle.hidden = true;
        var old = el.preview.querySelector('img.selected');
        if (old) { old.classList.remove('selected'); }
    }

    function positionImageTools() {
        var img = findSelectedImg();
        if (!img || el.preview.hidden) { el.imgHandle.hidden = true; return; }
        var r = img.getBoundingClientRect();
        var p = el.preview.getBoundingClientRect();
        var host = el.preview.parentElement.getBoundingClientRect();
        var inView = r.bottom >= p.top + 6 && r.bottom <= p.bottom - 2;
        el.imgHandle.hidden = !inView;
        if (!inView) { return; }
        var x = Math.min(r.right, p.right - 10);
        el.imgHandle.style.left = Math.round(x - host.left - 6) + 'px';
        el.imgHandle.style.top = Math.round(r.bottom - host.top - 6) + 'px';
    }

    function reselectImage() {
        if (!selectedImage || el.preview.hidden) { return; }
        var img = findSelectedImg();
        if (!img) { clearImageSelection(); return; }
        var prev = el.preview.querySelector('img.selected');
        if (prev && prev !== img) { prev.classList.remove('selected'); }
        img.classList.add('selected');
        el.imgBar.hidden = false;
        positionImageTools();
    }

    function selectImage(img) {
        selectedImage = { line: Number(img.getAttribute('data-line')), idx: Number(img.getAttribute('data-idx')) };
        reselectImage();
    }

    function availableImageWidth() {
        return Math.max(60, el.preview.clientWidth - 24);
    }

    function commitImageWidth(width) {
        var n = currentNote();
        if (!n || !selectedImage) { return; }
        var lines = n.content.split('\n');
        var before = lines[selectedImage.line];
        if (before === undefined) { return; }
        var after = setImageWidthInLine(before, selectedImage.idx, width);
        if (after === before) { return; }
        lines[selectedImage.line] = after;
        n.content = lines.join('\n');
        n.updated = Date.now();
        el.noteInput.value = n.content;
        markDirty();
        renderOptions();
        renderFooter();
        renderPreview();
    }

    function loadNoteIntoInputs() {
        var n = currentNote();
        if (!n) { return; }
        el.noteInput.value = n.content;
        el.titleInput.value = n.title === 'Untitled' ? '' : n.title;
        if (previewMode) { renderPreview(); }
    }

    // Updates what is on screen only
    function applyPreview(on) {
        previewMode = on;
        el.noteInput.hidden = on;
        el.preview.hidden = !on;
        el.previewBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
        el.previewBtn.title = on ? 'Previewing. Click to edit' : 'Preview markdown';
        if (!on) { clearImageSelection(); }
        if (on) { renderPreview(); }
        saveViewState();
    }

    // Changes the mode and remembers it for the current note
    function setPreview(on) {
        var n = currentNote();
        if (n && !!n.preview !== on) {
            if (on) { n.preview = true; } else { delete n.preview; }
            markDirty();
        }
        applyPreview(on);
    }

    function applySettings(next) {
        if (next) { settings = Object.assign(settings, next); }
        document.documentElement.style.setProperty('--note-font-size', settings.fontSize + 'px');
        document.body.dataset.theme = settings.darkMode ? 'dark' : 'light';
        document.documentElement.style.colorScheme = settings.darkMode ? 'dark' : 'light';
        var targetTheme = settings.darkMode ? 'light' : 'dark';
        el.themeBtn.innerHTML = settings.darkMode
            ? '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" aria-hidden="true"><circle cx="8" cy="8" r="2.8"/><path d="M8 1.5v1.4M8 13.1v1.4M1.5 8h1.4M13.1 8h1.4M3.4 3.4l1 1M11.6 11.6l1 1M12.6 3.4l-1 1M4.4 11.6l-1 1"/></svg>'
            : '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13.2 10.2A5.7 5.7 0 0 1 5.8 2.8 5.8 5.8 0 1 0 13.2 10.2z"/></svg>';
        el.themeBtn.setAttribute('aria-label', 'Switch to ' + targetTheme + ' mode');
        el.themeBtn.title = 'Switch to ' + targetTheme + ' mode';
        if (menuOpen) { buildMenu(); }
    }

    function showNote(id) {
        persistIfPending();
        clearImageSelection();
        currentId = id;
        var shown = currentNote();
        applyPreview(!!(shown && shown.preview));
        loadNoteIntoInputs();
        renderChrome();
        saveViewState();
    }

    /* ---------- Editing ---------- */

    function onEdit() {
        var n = currentNote();
        if (!n) { return; }
        var t = el.titleInput.value.trim();
        n.title = t.length ? t : 'Untitled';
        n.content = el.noteInput.value;
        n.updated = Date.now();
        markDirty();
        renderOptions();
        renderFooter();
    }

    function setContentFromPreview(content) {
        var n = currentNote();
        if (!n) { return; }
        n.content = content;
        n.updated = Date.now();
        el.noteInput.value = content;
        markDirty();
        renderOptions();
        renderFooter();
    }

    function commitMeta() {
        renderChrome();
        markDirty();
    }

    function addNote() {
        persistIfPending();
        var n = makeNote();
        pages.push(n);
        currentId = n.id;
        setPreview(false);
        loadNoteIntoInputs();
        renderChrome();
        persist();
        document.body.classList.toggle('compact-title-editing', window.matchMedia('(max-width: 400px)').matches);
        el.titleInput.focus();
    }

    function moveSelection(delta) {
        var i = currentIndex() + delta;
        if (i >= 0 && i < pages.length) { showNote(pages[i].id); }
    }

    function duplicateNote() {
        var i = currentIndex();
        var n = pages[i];
        if (!n) { return; }
        var copy = Object.assign({}, n, { id: uid(), title: (n.title || 'Untitled') + ' copy', updated: Date.now() });
        pages.splice(i + 1, 0, copy);
        showNote(copy.id);
        persist();
        flash('Duplicated note');
    }

    function moveNote(delta) {
        var i = currentIndex();
        var j = i + delta;
        if (j < 0 || j >= pages.length) { return; }
        if (!!pages[j].pinned !== !!pages[i].pinned) { return; }
        var tmp = pages[i];
        pages[i] = pages[j];
        pages[j] = tmp;
        commitMeta();
    }

    function togglePin() {
        var i = currentIndex();
        var n = pages[i];
        if (!n) { return; }
        pages.splice(i, 1);
        n.pinned = !n.pinned;
        if (!n.pinned) { delete n.pinned; }
        var pinnedCount = pages.filter(function (p) { return p.pinned; }).length;
        pages.splice(n.pinned ? 0 : pinnedCount, 0, n);
        commitMeta();
    }

    function setColor(color) {
        var n = currentNote();
        if (!n) { return; }
        if (!color || n.color === color) { delete n.color; } else { n.color = color; }
        commitMeta();
        if (menuOpen) { buildMenu(); }
    }

    function deleteCurrent() {
        var i = currentIndex();
        var n = pages[i];
        if (!n) { return; }
        var keep = !isBlankNote(n);
        pages.splice(i, 1);
        if (keep) {
            trash.unshift(Object.assign({}, n, { deletedAt: Date.now() }));
            trash = trash.slice(0, 100);
        }
        if (!pages.length) { pages.push(makeNote()); }
        lastDeleted = { note: n, index: i };
        // Land on the note before the deleted one so the removal is obvious
        currentId = pages[Math.max(0, Math.min(i - 1, pages.length - 1))].id;
        clearImageSelection();
        applyPreview(!!currentNote().preview);
        loadNoteIntoInputs();
        renderChrome();
        saveViewState();
        persist();
        flash('Deleted note ' + (i + 1), true);
    }

    function undoDelete() {
        if (!lastDeleted) { return; }
        var d = lastDeleted;
        lastDeleted = null;
        trash = trash.filter(function (t) { return t.id !== d.note.id; });
        if (pages.length === 1 && isBlankNote(pages[0])) { pages = []; }
        pages.splice(Math.min(d.index, pages.length), 0, d.note);
        keepPinnedFirst();
        showNote(d.note.id);
        persist();
        flash('Restored note');
    }

    function restoreFromTrash(id) {
        var idx = -1;
        for (var k = 0; k < trash.length; k++) {
            if (trash[k].id === id) { idx = k; break; }
        }
        if (idx < 0) { return; }
        var n = trash.splice(idx, 1)[0];
        delete n.deletedAt;
        if (pages.length === 1 && isBlankNote(pages[0])) { pages = []; }
        pages.push(n);
        keepPinnedFirst();
        showNote(n.id);
        persist();
        renderPanel();
        flash('Restored note');
    }

    function insertChecklistItem() {
        setPreview(false);
        var ta = el.noteInput;
        ta.focus();
        var pos = ta.selectionStart;
        var atLineStart = pos === 0 || ta.value.charAt(pos - 1) === '\n';
        var text = (atLineStart ? '' : '\n') + '- [ ] ';
        try {
            document.execCommand('insertText', false, text);
        } catch (err) {
            var start = ta.selectionStart;
            ta.setRangeText(text, start, ta.selectionEnd, 'end');
            ta.dispatchEvent(new Event('input', { bubbles: true }));
        }
    }

    function insertImageMarkdown(file) {
        var n = currentNote();
        if (!n) { return; }
        var line = '![image](img:' + file + ')';

        if (previewMode) {
            // No text cursor while previewing, so add the picture at the end of the note
            var existing = n.content.replace(/\s+$/, '');
            n.content = (existing ? existing + '\n\n' : '') + line + '\n';
            n.updated = Date.now();
            el.noteInput.value = n.content;
            markDirty();
            renderOptions();
            renderFooter();
            renderPreview();
        } else {
            var ta = el.noteInput;
            ta.focus();
            var pos = ta.selectionStart;
            var atLineStart = pos === 0 || ta.value.charAt(pos - 1) === '\n';
            document.execCommand('insertText', false, (atLineStart ? '' : '\n') + line + '\n');
            onEdit();
            setPreview(true);
        }

        // Bring the new picture into view
        var img = el.preview.querySelector('img[src$="' + file + '"]');
        if (img && img.scrollIntoView) { img.scrollIntoView({ block: 'nearest' }); }
        flash('Image added');
    }

    function blobToBase64(blob) {
        return new Promise(function (resolve) {
            var reader = new FileReader();
            reader.onload = function () {
                var data = String(reader.result);
                resolve(data.slice(data.indexOf(',') + 1));
            };
            reader.readAsDataURL(blob);
        });
    }

    // Shrinks big pictures (max 1600px wide, WebP) so they stay small when kept with the notes.
    // Animated GIFs and tiny images are kept as they are.
    function compressImage(blob) {
        if (blob.type === 'image/gif' || typeof createImageBitmap !== 'function') { return Promise.resolve(blob); }
        return createImageBitmap(blob).then(function (bmp) {
            var scale = Math.min(1, 1600 / bmp.width);
            var w = Math.max(1, Math.round(bmp.width * scale));
            var h = Math.max(1, Math.round(bmp.height * scale));
            var canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
            if (bmp.close) { bmp.close(); }
            return new Promise(function (resolve) {
                canvas.toBlob(function (out) {
                    resolve(out && out.type === 'image/webp' && out.size < blob.size ? out : blob);
                }, 'image/webp', 0.85);
            });
        }).catch(function () { return blob; });
    }

    function saveCompressed(blob) {
        compressImage(blob).then(blobToBase64).then(function (data) {
            vscode.postMessage({ type: 'saveImage', data: data });
        });
    }

    function sendImageFile(file) {
        if (!file || String(file.type).indexOf('image/') !== 0) { return false; }
        if (file.size > 8 * 1024 * 1024) { flash('Image is larger than 8 MB'); return true; }
        flash('Adding image');
        saveCompressed(file);
        return true;
    }

    // The extension read a picture file for us. Shrink it, then send it back to be saved.
    function processImageData(base64) {
        flash('Adding image');
        var bin = atob(base64);
        var bytes = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) { bytes[i] = bin.charCodeAt(i); }
        var type = bytes[0] === 0x47 ? 'image/gif' : bytes[0] === 0x89 ? 'image/png' : bytes[0] === 0xff ? 'image/jpeg' : 'image/webp';
        saveCompressed(new Blob([bytes], { type: type }));
    }

    function insertSelection(msg) {
        persistIfPending();
        var ref = msg.link ? msg.link.label + ':' + msg.link.line : '';
        var fence = '```';
        var lang = msg.language && msg.language !== 'plaintext' ? msg.language : '';
        var block = fence + lang + '\n' + String(msg.text).replace(/\s+$/, '') + '\n' + fence;
        var body = (ref ? ref + '\n' : '') + block + '\n';
        var n;
        if (msg.newNote) {
            var fileName = msg.link ? msg.link.label.split(/[\\/]/).pop() : 'Snippet';
            n = makeNote(fileName);
            n.content = body;
            pages.push(n);
        } else {
            n = currentNote();
            if (!n) { return; }
            var existing = n.content.replace(/\s+$/, '');
            n.content = existing ? existing + '\n\n' + body : body;
        }
        if (msg.link && !n.link) { n.link = msg.link; }
        n.updated = Date.now();
        currentId = n.id;
        setPreview(false);
        loadNoteIntoInputs();
        renderChrome();
        el.noteInput.scrollTop = el.noteInput.scrollHeight;
        persist();
        flash(msg.newNote ? 'Created note from selection' : 'Added selection to note');
    }

    /* ---------- Confirm helper ---------- */

    function armConfirm(btn, idleText, armedText, action) {
        if (btn.dataset.armed === '1') {
            clearTimeout(confirmTimers.get(btn));
            btn.dataset.armed = '';
            btn.textContent = idleText;
            btn.classList.remove('armed');
            action();
            return;
        }
        btn.dataset.armed = '1';
        btn.textContent = armedText;
        btn.classList.add('armed');
        confirmTimers.set(btn, setTimeout(function () {
            btn.dataset.armed = '';
            btn.textContent = idleText;
            btn.classList.remove('armed');
        }, 3000));
    }

    /* ---------- Menu ---------- */

    function closeMenu() {
        if (!menuOpen) { return; }
        menuOpen = false;
        el.menu.hidden = true;
        el.menuBtn.setAttribute('aria-expanded', 'false');
    }

    function addMenuItem(label, onClick, opts) {
        opts = opts || {};
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'menu-item' + (opts.danger ? ' danger' : '');
        b.setAttribute('role', 'menuitem');
        var span = document.createElement('span');
        span.textContent = label;
        b.appendChild(span);
        if (opts.hint) {
            var h = document.createElement('span');
            h.className = 'hint';
            h.textContent = opts.hint;
            b.appendChild(h);
        }
        if (opts.disabled) { b.disabled = true; }
        b.addEventListener('click', function () {
            if (opts.confirm) {
                if (b.dataset.armed === '1') {
                    closeMenu();
                    onClick();
                    return;
                }
                b.dataset.armed = '1';
                span.textContent = opts.confirm;
                b.classList.add('armed');
                setTimeout(function () {
                    b.dataset.armed = '';
                    span.textContent = label;
                    b.classList.remove('armed');
                }, 3000);
                return;
            }
            if (!opts.keepOpen) { closeMenu(); }
            onClick();
        });
        el.menu.appendChild(b);
        return b;
    }

    function addMenuSep() {
        var s = document.createElement('div');
        s.className = 'menu-sep';
        s.setAttribute('role', 'separator');
        el.menu.appendChild(s);
    }

    function buildMenu() {
        var n = currentNote();
        var i = currentIndex();
        el.menu.innerHTML = '';

        addMenuItem('Duplicate note', duplicateNote);
        addMenuItem('Move up', function () { moveNote(-1); }, {
            disabled: i <= 0 || !!pages[i - 1].pinned !== !!(n && n.pinned), keepOpen: true
        });
        addMenuItem('Move down', function () { moveNote(1); }, {
            disabled: i >= pages.length - 1 || !!pages[i + 1].pinned !== !!(n && n.pinned), keepOpen: true
        });
        addMenuItem(n && n.pinned ? 'Unpin note' : 'Pin note to the top', togglePin);
        addMenuItem(previewMode ? 'Edit note' : 'Preview markdown', function () {
            setPreview(!previewMode);
        });
        addMenuSep();

        var row = document.createElement('div');
        row.className = 'menu-row';
        var lbl = document.createElement('span');
        lbl.textContent = 'Label';
        row.appendChild(lbl);
        var sw = document.createElement('div');
        sw.className = 'swatches';
        var none = document.createElement('button');
        none.type = 'button';
        none.className = 'swatch none';
        none.title = 'No label';
        none.setAttribute('aria-label', 'No label');
        none.setAttribute('aria-pressed', n && !n.color ? 'true' : 'false');
        none.addEventListener('click', function () { setColor(null); });
        sw.appendChild(none);
        COLORS.forEach(function (c) {
            var b = document.createElement('button');
            b.type = 'button';
            b.className = 'swatch dot-' + c;
            b.title = c.charAt(0).toUpperCase() + c.slice(1);
            b.setAttribute('aria-label', b.title + ' label');
            b.setAttribute('aria-pressed', n && n.color === c ? 'true' : 'false');
            b.addEventListener('click', function () { setColor(c); });
            sw.appendChild(b);
        });
        row.appendChild(sw);
        el.menu.appendChild(row);

        addMenuSep();
        addMenuItem('Copy note', function () {
            vscode.postMessage({ type: 'copy', text: n ? n.content : '' });
            flash('Copied note');
        });
        addMenuItem('Add checklist item', insertChecklistItem);
        addMenuItem('Insert image from file', function () {
            persistIfPending();
            vscode.postMessage({ type: 'pickImage' });
        });
        addMenuItem('Attach current file', function () {
            vscode.postMessage({ type: 'attachLink' });
        }, { hint: 'from editor' });
        addMenuSep();

        addMenuItem('Trash', function () { openPanel('trash'); }, { hint: String(trash.length) });
        addMenuItem('Export notes', function () { persistIfPending(); vscode.postMessage({ type: 'export' }); });
        addMenuItem('Import notes', function () { persistIfPending(); vscode.postMessage({ type: 'import' }); });

        var fs = document.createElement('div');
        fs.className = 'menu-row';
        var fl = document.createElement('span');
        fl.textContent = 'Font size';
        fs.appendChild(fl);
        var st = document.createElement('div');
        st.className = 'stepper';
        var minus = document.createElement('button');
        minus.type = 'button';
        minus.className = 'text-btn';
        minus.textContent = 'A\u2212';
        minus.setAttribute('aria-label', 'Smaller text');
        var val = document.createElement('span');
        val.className = 'value';
        val.textContent = settings.fontSize + 'px';
        var plus = document.createElement('button');
        plus.type = 'button';
        plus.className = 'text-btn';
        plus.textContent = 'A+';
        plus.setAttribute('aria-label', 'Larger text');
        function setSize(size) {
            size = Math.max(10, Math.min(24, size));
            settings.fontSize = size;
            document.documentElement.style.setProperty('--note-font-size', size + 'px');
            val.textContent = size + 'px';
            vscode.postMessage({ type: 'setFontSize', size: size });
        }
        minus.addEventListener('click', function () { setSize(settings.fontSize - 1); });
        plus.addEventListener('click', function () { setSize(settings.fontSize + 1); });
        st.appendChild(minus);
        st.appendChild(val);
        st.appendChild(plus);
        fs.appendChild(st);
        el.menu.appendChild(fs);

        var toProject = scope === 'global';
        addMenuItem(toProject ? 'Switch to project notes' : 'Switch to global notes', function () {
            persistIfPending();
            vscode.postMessage({ type: 'setScope', scope: toProject ? 'workspace' : 'global' });
        }, { disabled: toProject && !hasWorkspace, hint: toProject && !hasWorkspace ? 'open a folder' : (scope === 'global' ? 'now: global' : 'now: project') });
        addMenuItem('Settings', function () { vscode.postMessage({ type: 'openSettings' }); });
        addMenuSep();
        addMenuItem('Delete note', deleteCurrent, { danger: true, confirm: 'Click again to delete' });
    }

    function openMenu() {
        closePanel();
        buildMenu();
        menuOpen = true;
        el.menu.hidden = false;
        el.menuBtn.setAttribute('aria-expanded', 'true');
        var first = el.menu.querySelector('.menu-item:not(:disabled)');
        if (first) { first.focus(); }
    }

    /* ---------- Search and trash panel ---------- */

    function openPanel(mode) {
        closeMenu();
        panelMode = mode;
        el.panel.hidden = false;
        el.panelInput.hidden = mode !== 'search';
        el.panelTitle.hidden = mode === 'search';
        el.panelAction.hidden = mode === 'search';
        el.panelInput.value = '';
        activeResult = 0;
        renderPanel();
        if (mode === 'search') { el.panelInput.focus(); }
    }

    function closePanel() {
        panelMode = null;
        el.panel.hidden = true;
    }

    function snippetFor(n, q) {
        var text = n.content.replace(/\s+/g, ' ').trim();
        if (q) {
            var at = text.toLowerCase().indexOf(q);
            if (at > -1) {
                var start = Math.max(0, at - 24);
                return (start > 0 ? '\u2026' : '') + text.slice(start, start + 80);
            }
        }
        return text.slice(0, 80);
    }

    function renderPanel() {
        el.panelList.innerHTML = '';
        if (panelMode === 'search') {
            var q = el.panelInput.value.trim().toLowerCase();
            visibleResults = [];
            pages.forEach(function (n, i) {
                if (!q || n.title.toLowerCase().indexOf(q) > -1 || n.content.toLowerCase().indexOf(q) > -1) {
                    visibleResults.push({ note: n, index: i });
                }
            });
            if (!visibleResults.length) {
                var empty = document.createElement('div');
                empty.className = 'panel-empty';
                empty.textContent = 'No notes match "' + el.panelInput.value.trim() + '".';
                el.panelList.appendChild(empty);
                return;
            }
            activeResult = Math.min(activeResult, visibleResults.length - 1);
            visibleResults.forEach(function (r, k) {
                var b = document.createElement('button');
                b.type = 'button';
                b.className = 'result' + (k === activeResult ? ' active' : '');
                b.setAttribute('role', 'option');
                var t = document.createElement('div');
                t.className = 'r-title';
                t.textContent = noteLabel(r.note, r.index);
                var s = document.createElement('div');
                s.className = 'r-snippet';
                s.textContent = snippetFor(r.note, q);
                b.appendChild(t);
                if (s.textContent) { b.appendChild(s); }
                b.addEventListener('click', function () { openResult(k); });
                el.panelList.appendChild(b);
            });
        } else if (panelMode === 'trash') {
            el.panelTitle.textContent = 'Trash (' + trash.length + ')';
            el.panelAction.textContent = 'Empty trash';
            el.panelAction.disabled = !trash.length;
            if (!trash.length) {
                var e2 = document.createElement('div');
                e2.className = 'panel-empty';
                e2.textContent = 'Trash is empty. Deleted notes stay here for ' + settings.trashRetentionDays + ' days.';
                el.panelList.appendChild(e2);
                return;
            }
            trash.forEach(function (n) {
                var item = document.createElement('div');
                item.className = 'trash-item';
                var text = document.createElement('div');
                text.className = 't-text';
                var t = document.createElement('div');
                t.className = 'r-title';
                t.textContent = n.title || 'Untitled';
                var s = document.createElement('div');
                s.className = 'r-snippet';
                s.textContent = 'Deleted ' + formatAgo(n.deletedAt || Date.now(), Date.now()) +
                    (n.content.trim() ? ': ' + snippetFor(n, '') : '');
                text.appendChild(t);
                text.appendChild(s);
                var actions = document.createElement('div');
                actions.className = 't-actions';
                var restore = document.createElement('button');
                restore.type = 'button';
                restore.className = 'text-btn';
                restore.textContent = 'Restore';
                restore.addEventListener('click', function () { restoreFromTrash(n.id); });
                var del = document.createElement('button');
                del.type = 'button';
                del.className = 'text-btn danger';
                del.textContent = 'Delete';
                del.title = 'Delete forever';
                del.addEventListener('click', function () {
                    armConfirm(del, 'Delete', 'Sure?', function () {
                        trash = trash.filter(function (t2) { return t2.id !== n.id; });
                        persist();
                        renderPanel();
                        renderChrome();
                    });
                });
                actions.appendChild(restore);
                actions.appendChild(del);
                item.appendChild(text);
                item.appendChild(actions);
                el.panelList.appendChild(item);
            });
        }
    }

    function openResult(k) {
        var r = visibleResults[k];
        if (!r) { return; }
        closePanel();
        showNote(r.note.id);
    }

    /* ---------- Events ---------- */

    el.noteInput.addEventListener('input', onEdit);
    el.titleInput.addEventListener('input', onEdit);
    el.titleInput.addEventListener('focus', function () {
        if (window.matchMedia('(max-width: 400px)').matches) {
            document.body.classList.add('compact-title-editing');
        }
    });
    el.noteInput.addEventListener('focus', function () {
        document.body.classList.remove('compact-title-editing');
    });
    el.noteInput.addEventListener('blur', persistIfPending);
    el.titleInput.addEventListener('blur', persistIfPending);

    el.titleInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            setPreview(false);
            el.noteInput.focus();
        }
    });

    // Continue bullet and checklist lines when pressing Enter at the end of a line
    el.noteInput.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) { return; }
        var ta = el.noteInput;
        if (ta.selectionStart !== ta.selectionEnd) { return; }
        var pos = ta.selectionStart;
        if (pos === 0) { return; }
        var v = ta.value;
        var lineStart = v.lastIndexOf('\n', pos - 1) + 1;
        var lineEnd = v.indexOf('\n', pos);
        if (lineEnd === -1) { lineEnd = v.length; }
        if (pos !== lineEnd) { return; }
        var line = v.slice(lineStart, lineEnd);
        var m = /^(\s*)([-*+]) \[[ xX]\] ?(.*)$/.exec(line);
        var marker;
        if (m) {
            marker = m[1] + m[2] + ' [ ] ';
        } else {
            m = /^(\s*)([-*+]) (.*)$/.exec(line);
            if (m) { marker = m[1] + m[2] + ' '; }
        }
        if (!m) { return; }
        e.preventDefault();
        if (m[3].trim() === '') {
            ta.setSelectionRange(lineStart, pos);
            try {
                document.execCommand('delete');
            } catch (err) {
                var before = ta.value.slice(0, lineStart);
                var after = ta.value.slice(pos);
                ta.value = before + after;
                ta.setSelectionRange(lineStart, lineStart);
                onEdit();
            }
        } else {
            var insert = '\n' + marker;
            try {
                document.execCommand('insertText', false, insert);
            } catch (err) {
                var start = ta.selectionStart;
                ta.setRangeText(insert, start, ta.selectionEnd, 'end');
                onEdit();
            }
        }
    });

    // Paste a screenshot or copied image straight into the note (edit or preview mode)
    document.addEventListener('paste', function (e) {
        if (e.target === el.titleInput || e.target === el.panelInput) { return; }
        var items = (e.clipboardData && e.clipboardData.items) || [];
        for (var i = 0; i < items.length; i++) {
            if (items[i].kind === 'file' && String(items[i].type).indexOf('image/') === 0) {
                e.preventDefault();
                sendImageFile(items[i].getAsFile());
                return;
            }
        }
    });

    el.noteSelect.addEventListener('change', function (e) {
        document.body.classList.remove('compact-title-editing');
        var p = pages[parseInt(e.target.value, 10)];
        if (p) { showNote(p.id); }
    });

    el.noteSelectBtn.addEventListener('click', function () {
        if (el.notePicker.hidden) { openNotePicker(false); }
        else { closeNotePicker(false); }
    });
    el.noteSelectBtn.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            openNotePicker(e.key === 'ArrowUp');
        }
    });
    el.notePicker.addEventListener('click', function (e) {
        var item = e.target.closest('[role="option"]');
        if (item) { chooseNote(Number(item.dataset.index)); }
    });
    el.notePicker.addEventListener('keydown', function (e) {
        var options = Array.prototype.slice.call(el.notePicker.querySelectorAll('[role="option"]'));
        var at = options.indexOf(document.activeElement);
        var next = at;
        if (e.key === 'ArrowDown') { next = (at + 1) % options.length; }
        else if (e.key === 'ArrowUp') { next = (at - 1 + options.length) % options.length; }
        else if (e.key === 'Home') { next = 0; }
        else if (e.key === 'End') { next = options.length - 1; }
        else if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (at >= 0) { chooseNote(Number(options[at].dataset.index)); }
            return;
        } else if (e.key === 'Escape') {
            e.preventDefault();
            closeNotePicker(true);
            return;
        } else { return; }
        e.preventDefault();
        if (options[next]) { options[next].focus(); }
    });
    window.addEventListener('resize', function () {
        if (!el.notePicker.hidden) { positionNotePicker(); }
    });
    window.addEventListener('scroll', function () {
        if (!el.notePicker.hidden) { positionNotePicker(); }
    }, true);

    el.themeBtn.addEventListener('click', function () {
        settings.darkMode = !settings.darkMode;
        applySettings();
        vscode.postMessage({ type: 'setDarkMode', enabled: settings.darkMode });
    });

    el.prevBtn.addEventListener('click', function () { moveSelection(-1); });
    el.nextBtn.addEventListener('click', function () { moveSelection(1); });
    el.addBtn.addEventListener('click', addNote);
    el.pinBtn.addEventListener('click', togglePin);

    el.previewBtn.addEventListener('click', function () {
        setPreview(!previewMode);
        if (!previewMode) { el.noteInput.focus(); }
    });

    el.preview.addEventListener('change', function (e) {
        var t = e.target;
        if (!t || t.type !== 'checkbox') { return; }
        var n = currentNote();
        if (!n) { return; }
        var lines = n.content.split('\n');
        var idx = Number(t.getAttribute('data-line'));
        if (lines[idx] === undefined) { return; }
        lines[idx] = lines[idx].replace(/\[([ xX])\]/, t.checked ? '[x]' : '[ ]');
        setContentFromPreview(lines.join('\n'));
        renderPreview();
    });

    // Your hint: clicking the preview flashes the eye button to show how to edit
    el.preview.addEventListener('click', function (e) {
        document.body.classList.remove('compact-title-editing');
        if (e.target.closest('input, a, button, img')) { return; }
        clearTimeout(previewClickTimeout);
        el.previewBtn.classList.add('warning-click');
        previewClickTimeout = setTimeout(function () {
            el.previewBtn.classList.remove('warning-click');
        }, 1200);
    });

    // Click an image in the preview to resize it
    el.preview.addEventListener('click', function (e) {
        var t = e.target;
        if (!t || !t.closest) { return; }
        if (t.tagName === 'IMG' && t.hasAttribute('data-idx') && !t.closest('a')) {
            selectImage(t);
            return;
        }
        if (!t.closest('a') && t.type !== 'checkbox') { clearImageSelection(); }
    });
    el.preview.addEventListener('scroll', positionImageTools);

    // A picture that cannot be loaded says which file is missing
    el.preview.addEventListener('error', function (e) {
        var t = e.target;
        if (!t || t.tagName !== 'IMG' || t.classList.contains('broken')) { return; }
        var name = String(t.getAttribute('src') || '').split('/').pop();
        t.classList.add('broken');
        t.setAttribute('alt', 'Image not found: ' + name);
        t.setAttribute('title', 'Could not load ' + name);
    }, true);
    window.addEventListener('resize', positionImageTools);

    el.imgBar.addEventListener('click', function (e) {
        var b = e.target.closest ? e.target.closest('button[data-size]') : null;
        if (!b || !selectedImage) { return; }
        var avail = availableImageWidth();
        var sizes = { small: Math.round(avail / 3), medium: Math.round(avail * 2 / 3), large: avail, original: 0 };
        commitImageWidth(sizes[b.getAttribute('data-size')] || 0);
    });

    el.imgHandle.addEventListener('pointerdown', function (e) {
        var img = findSelectedImg();
        if (!img) { return; }
        e.preventDefault();
        var handle = el.imgHandle;
        var startX = e.clientX;
        var startW = img.getBoundingClientRect().width;
        var maxW = availableImageWidth();
        var current = Math.round(startW);
        handle.setPointerCapture(e.pointerId);
        function move(ev) {
            current = Math.max(24, Math.min(maxW, Math.round(startW + ev.clientX - startX)));
            img.setAttribute('width', String(current));
            positionImageTools();
        }
        function up() {
            handle.removeEventListener('pointermove', move);
            handle.removeEventListener('pointerup', up);
            handle.removeEventListener('pointercancel', up);
            if (current !== Math.round(startW)) { commitImageWidth(current); }
        }
        handle.addEventListener('pointermove', move);
        handle.addEventListener('pointerup', up);
        handle.addEventListener('pointercancel', up);
    });

    el.menuBtn.addEventListener('click', function () {
        if (menuOpen) { closeMenu(); } else { openMenu(); }
    });

    el.menu.addEventListener('keydown', function (e) {
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') { return; }
        e.preventDefault();
        var items = Array.prototype.slice.call(el.menu.querySelectorAll('.menu-item:not(:disabled)'));
        var at = items.indexOf(document.activeElement);
        var next = e.key === 'ArrowDown' ? at + 1 : at - 1;
        if (next < 0) { next = items.length - 1; }
        if (next >= items.length) { next = 0; }
        if (items[next]) { items[next].focus(); }
    });

    document.addEventListener('mousedown', function (e) {
        if (menuOpen && !el.menu.contains(e.target) && !el.menuBtn.contains(e.target)) { closeMenu(); }
        if (!el.notePicker.hidden && !el.noteSelectBtn.parentElement.contains(e.target)) { closeNotePicker(false); }
    });

    document.addEventListener('keydown', function (e) {
        if (e.key !== 'Escape') { return; }
        if (!el.notePicker.hidden) { closeNotePicker(true); }
        else if (menuOpen) { closeMenu(); el.menuBtn.focus(); }
        else if (panelMode) { closePanel(); }
        else if (selectedImage) { clearImageSelection(); }
    });

    el.searchBtn.addEventListener('click', function () {
        if (panelMode === 'search') { closePanel(); } else { openPanel('search'); }
    });
    el.panelClose.addEventListener('click', closePanel);
    el.panelInput.addEventListener('input', function () { activeResult = 0; renderPanel(); });
    el.panelInput.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            if (!visibleResults.length) { return; }
            activeResult = (activeResult + (e.key === 'ArrowDown' ? 1 : -1) + visibleResults.length) % visibleResults.length;
            renderPanel();
            var active = el.panelList.querySelector('.result.active');
            if (active && active.scrollIntoView) { active.scrollIntoView({ block: 'nearest' }); }
        } else if (e.key === 'Enter') {
            e.preventDefault();
            openResult(activeResult);
        }
    });
    el.panelAction.addEventListener('click', function () {
        armConfirm(el.panelAction, 'Empty trash', 'Sure?', function () {
            trash = [];
            persist();
            renderPanel();
            flash('Trash emptied');
        });
    });

    el.undoBtn.addEventListener('click', undoDelete);

    el.linkBtn.addEventListener('click', function () {
        var n = currentNote();
        if (n && n.link) { vscode.postMessage({ type: 'openLink', path: n.link.path, line: n.link.line }); }
    });
    el.linkRemove.addEventListener('click', function () {
        var n = currentNote();
        if (n) { delete n.link; commitMeta(); }
    });

    /* ---------- Messages from the extension ---------- */

    function runCommand(name) {
        if (name === 'new') { addNote(); }
        else if (name === 'next') { moveSelection(1); }
        else if (name === 'prev') { moveSelection(-1); }
        else if (name === 'search') { openPanel('search'); }
    }

    function applyLoad(msg, restoreState) {
        window.__notesReady = true;
        setImageBase(msg.imagesBase);
        pages = Array.isArray(msg.pages) ? msg.pages : [];
        trash = Array.isArray(msg.trash) ? msg.trash : [];
        scope = msg.scope === 'workspace' ? 'workspace' : 'global';
        hasWorkspace = !!msg.hasWorkspace;
        applySettings(msg.settings);

        if (restoreState) {
            var saved = vscode.getState() || {};
            if (saved.currentId) { currentId = saved.currentId; }
        }
        ensureCurrent();
        clearImageSelection();
        applyPreview(!!currentNote().preview);
        loadNoteIntoInputs();
        renderChrome();
        closePanel();
        closeMenu();
        saveViewState();
    }

    window.addEventListener('message', function (event) {
        var msg = event.data || {};
        switch (msg.type) {
            case 'init': applyLoad(msg, true); break;
            case 'load': applyLoad(msg, false); break;
            case 'settings': applySettings(msg.settings); break;
            case 'command': runCommand(msg.name); break;
            case 'insertSelection': insertSelection(msg); break;
            case 'linkAttached':
                var n = currentNote();
                if (n && msg.link) { n.link = msg.link; commitMeta(); flash('Linked to ' + msg.link.label); }
                break;
            case 'imageSaved': insertImageMarkdown(String(msg.file)); break;
            case 'processImage': processImageData(String(msg.data)); break;
            case 'toast': flash(String(msg.text || '')); break;
        }
    });

    setInterval(renderFooter, 30000);

    vscode.postMessage({ type: 'ready' });
})();
