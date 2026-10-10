(function () {
    'use strict';

    // BEGIN PURE
    function esc(s) {
        return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function inline(raw) {
        var codes = [];
        var out = esc(raw);
        out = out.replace(/`([^`]+)`/g, function (m, c) {
            codes.push(c);
            return '\u0000' + (codes.length - 1) + '\u0000';
        });
        out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        out = out.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
        out = out.replace(/~~([^~]+)~~/g, '<del>$1</del>');
        out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>');
        out = out.replace(/\u0000(\d+)\u0000/g, function (m, i) {
            return '<code>' + codes[Number(i)] + '</code>';
        });
        return out;
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
                    (done ? ' checked' : '') + '><span>' + inline(m[2]) + '</span></li>');
                continue;
            }
            if ((m = /^\s*[-*+] (.*)$/.exec(line))) {
                openList('ul');
                html.push('<li>' + inline(m[1]) + '</li>');
                continue;
            }
            if ((m = /^\s*\d+[.)] (.*)$/.exec(line))) {
                openList('ol');
                html.push('<li>' + inline(m[1]) + '</li>');
                continue;
            }

            closeList();

            if (line.trim() === '') { continue; }
            if ((m = /^(#{1,6})\s+(.*)$/.exec(line))) {
                html.push('<h' + m[1].length + '>' + inline(m[2]) + '</h' + m[1].length + '>');
            } else if ((m = /^>\s?(.*)$/.exec(line))) {
                html.push('<blockquote>' + inline(m[1]) + '</blockquote>');
            } else if (/^(-{3,}|\*{3,})\s*$/.test(line)) {
                html.push('<hr>');
            } else {
                html.push('<p>' + inline(line) + '</p>');
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

    var settings = { autoSaveDelay: 400, fontSize: 13, newNoteTitle: 'untitled', trashRetentionDays: 30 };
    var pages = [];
    var trash = [];
    var scope = 'global';
    var hasWorkspace = false;
    var currentId = null;
    var previewMode = false;
    var pendingSave = false;
    var saveTimeout = null;
    var flashTimeout = null;
    var flashActive = false;
    var lastDeleted = null;
    var panelMode = null;
    var activeResult = 0;
    var visibleResults = [];
    var menuOpen = false;
    var confirmTimers = new WeakMap();

    function $(id) { return document.getElementById(id); }

    var el = {
        noteSelect: $('noteSelect'),
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
        progressBar: $('progressBar')
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

    function noteLabel(n, i) {
        var t = taskStats(n.content);
        return (n.pinned ? '\u2605 ' : '') + (n.color ? EMOJI[n.color] + ' ' : '') + (i + 1) + '. ' +
            (n.title || 'Untitled') + (t.total ? ' (' + t.done + '/' + t.total + ')' : '');
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
        pages.forEach(function (p, idx) {
            var opt = document.createElement('option');
            opt.value = String(idx);
            opt.textContent = noteLabel(p, idx);
            if (p.id === currentId) { opt.selected = true; }
            el.noteSelect.appendChild(opt);
        });
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
    }

    function loadNoteIntoInputs() {
        var n = currentNote();
        if (!n) { return; }
        el.noteInput.value = n.content;
        el.titleInput.value = n.title === 'Untitled' ? '' : n.title;
        if (previewMode) { renderPreview(); }
    }

    function setPreview(on) {
        previewMode = on;
        el.noteInput.hidden = on;
        el.preview.hidden = !on;
        el.previewBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
        el.previewBtn.title = on ? 'Back to editing' : 'Preview markdown';
        if (on) { renderPreview(); }
        saveViewState();
    }

    function applySettings(next) {
        if (next) { settings = Object.assign(settings, next); }
        document.documentElement.style.setProperty('--note-font-size', settings.fontSize + 'px');
        if (menuOpen) { buildMenu(); }
    }

    function showNote(id) {
        persistIfPending();
        currentId = id;
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
        document.execCommand('insertText', false, (atLineStart ? '' : '\n') + '- [ ] ');
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
        addMenuItem('Attach current file', function () {
            vscode.postMessage({ type: 'attachLink' });
        }, { hint: 'from editor' });
        addMenuSep();

        addMenuItem('Trash', function () { openPanel('trash'); }, { hint: String(trash.length) });
        addMenuItem('Export notes', function () { persistIfPending(); vscode.postMessage({ type: 'export' }); });
        addMenuItem('Import notes', function () { persistIfPending(); vscode.postMessage({ type: 'import' }); });
        addMenuSep();

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
            document.execCommand('delete');
        } else {
            document.execCommand('insertText', false, '\n' + marker);
        }
    });

    el.noteSelect.addEventListener('change', function (e) {
        var p = pages[parseInt(e.target.value, 10)];
        if (p) { showNote(p.id); }
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
    });

    document.addEventListener('keydown', function (e) {
        if (e.key !== 'Escape') { return; }
        if (menuOpen) { closeMenu(); el.menuBtn.focus(); } else if (panelMode) { closePanel(); }
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
        pages = Array.isArray(msg.pages) ? msg.pages : [];
        trash = Array.isArray(msg.trash) ? msg.trash : [];
        scope = msg.scope === 'workspace' ? 'workspace' : 'global';
        hasWorkspace = !!msg.hasWorkspace;
        applySettings(msg.settings);

        if (restoreState) {
            var saved = vscode.getState() || {};
            if (saved.currentId) { currentId = saved.currentId; }
            previewMode = !!saved.previewMode;
        }
        ensureCurrent();
        setPreview(previewMode);
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
            case 'toast': flash(String(msg.text || '')); break;
        }
    });

    setInterval(renderFooter, 30000);

    vscode.postMessage({ type: 'ready' });
})();