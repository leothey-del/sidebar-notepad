import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';

interface NoteLink {
    path: string;
    line: number;
    label: string;
}

interface NotePage {
    id: string;
    title: string;
    content: string;
    pinned?: boolean;
    preview?: boolean;
    color?: string;
    updated?: number;
    link?: NoteLink;
    deletedAt?: number;
}

type Scope = 'global' | 'workspace';

// Keep PAGES_KEY the same as earlier versions so existing users keep their notes
const PAGES_KEY = 'quickNotesPagesV3';
const TRASH_KEY = 'quickNotesTrashV1';
const SCOPE_KEY = 'quickNotesScope';
const CONFIG = 'sidebarQuickNotes';
const COLORS = ['red', 'orange', 'yellow', 'green', 'blue', 'purple'];
const MAX_TRASH = 100;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_STORED_BYTES = 3 * 1024 * 1024;
const IMAGE_KEY_PREFIX = 'quickNotesImg:';

function makeId(): string {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

function blankNote(): NotePage {
    return { id: makeId(), title: 'Untitled', content: '', updated: Date.now() };
}

/** Cleans stored or imported data. Older notes (title and content only) get ids added. */
function normalizeNotes(raw: unknown, isTrash = false): NotePage[] {
    if (!Array.isArray(raw)) {
        return [];
    }
    const seen = new Set<string>();
    const result: NotePage[] = [];
    for (const item of raw) {
        if (!item || typeof item !== 'object') {
            continue;
        }
        const r = item as Record<string, unknown>;
        let id = typeof r.id === 'string' && r.id ? r.id : makeId();
        while (seen.has(id)) {
            id = makeId();
        }
        seen.add(id);

        const note: NotePage = {
            id,
            title: typeof r.title === 'string' && r.title.trim() ? r.title : 'Untitled',
            content: typeof r.content === 'string' ? r.content : ''
        };
        if (r.pinned === true) {
            note.pinned = true;
        }
        if (r.preview === true) {
            note.preview = true;
        }
        if (typeof r.color === 'string' && COLORS.indexOf(r.color) >= 0) {
            note.color = r.color;
        }
        if (typeof r.updated === 'number') {
            note.updated = r.updated;
        }
        const l = r.link as Record<string, unknown> | undefined;
        if (l && typeof l.path === 'string' && typeof l.line === 'number' && typeof l.label === 'string') {
            note.link = { path: l.path, line: l.line, label: l.label };
        }
        if (isTrash) {
            note.deletedAt = typeof r.deletedAt === 'number' ? r.deletedAt : Date.now();
        }
        result.push(note);
    }
    return result;
}

/** Looks at the first bytes of a file to decide if it is a supported image. */
function detectImageExt(b: Uint8Array): string | undefined {
    if (b.length < 12) {
        return undefined;
    }
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
        return 'png';
    }
    if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
        return 'jpg';
    }
    if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) {
        return 'gif';
    }
    if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
        b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) {
        return 'webp';
    }
    return undefined;
}

function isValidImageName(name: string): boolean {
    return /^img-[a-z0-9]+\.(png|jpg|gif|webp)$/.test(name);
}

/** Names of the saved pictures that notes point to with ![text](img:name). */
function imageNamesIn(notes: NotePage[]): string[] {
    const names = new Set<string>();
    const re = /img:([A-Za-z0-9._-]+)/g;
    for (const n of notes) {
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(n.content)) !== null) {
            if (isValidImageName(m[1])) {
                names.add(m[1]);
            }
        }
    }
    return Array.from(names);
}

function getNonce(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let nonce = '';
    for (let i = 0; i < 32; i++) {
        nonce += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return nonce;
}

export function activate(context: vscode.ExtensionContext) {
    const provider = new NotesViewProvider(context);
    provider.applySync();

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('notesView', provider, {
            // Keeps the current note and cursor when the sidebar is hidden and shown again
            webviewOptions: { retainContextWhenHidden: true }
        }),
        vscode.commands.registerCommand('quickNotes.newNote', () => provider.sendCommand('new')),
        vscode.commands.registerCommand('quickNotes.nextNote', () => provider.sendCommand('next')),
        vscode.commands.registerCommand('quickNotes.prevNote', () => provider.sendCommand('prev')),
        vscode.commands.registerCommand('quickNotes.searchNotes', () => provider.sendCommand('search')),
        vscode.commands.registerCommand('quickNotes.addSelection', () => provider.addSelection(false)),
        vscode.commands.registerCommand('quickNotes.newNoteFromSelection', () => provider.addSelection(true)),
        vscode.commands.registerCommand('quickNotes.exportNotes', () => provider.exportNotes()),
        vscode.commands.registerCommand('quickNotes.importNotes', () => provider.importNotes()),
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration(CONFIG)) {
                provider.onConfigChanged();
            }
        })
    );
}

class NotesViewProvider implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView;
    private _ready = false;
    private _queue: unknown[] = [];
    private _scope: Scope = 'global';
    private _pages: NotePage[] = [];
    private _trash: NotePage[] = [];

    constructor(private readonly _context: vscode.ExtensionContext) {
        const savedScope = _context.globalState.get<Scope>(SCOPE_KEY, 'global');
        this._scope = savedScope === 'workspace' && this._hasWorkspace() ? 'workspace' : 'global';
        this._loadState();
    }

    /* ---------- State ---------- */

    private _hasWorkspace(): boolean {
        const folders = vscode.workspace.workspaceFolders;
        return !!folders && folders.length > 0;
    }

    private _store(): vscode.Memento {
        return this._scope === 'workspace' ? this._context.workspaceState : this._context.globalState;
    }

    private _settings() {
        const c = vscode.workspace.getConfiguration(CONFIG);
        return {
            autoSaveDelay: clamp(c.get<number>('autoSaveDelay', 400), 100, 5000),
            fontSize: clamp(c.get<number>('fontSize', 13), 10, 24),
            darkMode: c.get<boolean>('darkMode', false),
            newNoteTitle: c.get<string>('newNoteTitle', 'untitled'),
            trashRetentionDays: clamp(c.get<number>('trashRetentionDays', 30), 1, 365)
        };
    }

    private _loadState() {
        const store = this._store();
        this._pages = normalizeNotes(store.get<unknown>(PAGES_KEY));
        if (this._pages.length === 0) {
            this._pages = [blankNote()];
        }
        const cutoff = Date.now() - this._settings().trashRetentionDays * 24 * 60 * 60 * 1000;
        this._trash = normalizeNotes(store.get<unknown>(TRASH_KEY), true)
            .filter(n => (n.deletedAt ?? 0) >= cutoff)
            .slice(0, MAX_TRASH);
    }

    private _persist() {
        const store = this._store();
        void store.update(PAGES_KEY, this._pages);
        void store.update(TRASH_KEY, this._trash);
    }

    /** Lets VS Code Settings Sync include global notes when the user turns it on. */
    public applySync() {
        const enabled = vscode.workspace.getConfiguration(CONFIG).get<boolean>('syncWithSettingsSync', false);
        this._context.globalState.setKeysForSync(enabled ? [PAGES_KEY] : []);
    }

    public onConfigChanged() {
        this.applySync();
        this._post({ type: 'settings', settings: this._settings() });
    }

    /* ---------- Webview ---------- */

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        this._view = webviewView;
        this._ready = false;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(this._context.extensionUri, 'media'), this._imagesDir()]
        };
        webviewView.webview.html = this._getHtml(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(message => this._onMessage(message));
        webviewView.onDidDispose(() => {
            if (this._view === webviewView) {
                this._view = undefined;
                this._ready = false;
            }
        });
    }

    private _post(message: unknown) {
        if (this._view && this._ready) {
            void this._view.webview.postMessage(message);
        } else {
            this._queue.push(message);
        }
    }

    private _sendState(type: 'init' | 'load') {
        if (!this._view) {
            return;
        }
        void this._view.webview.postMessage({
            type,
            pages: this._pages,
            trash: this._trash,
            scope: this._scope,
            hasWorkspace: this._hasWorkspace(),
            settings: this._settings(),
            imagesBase: this._view.webview.asWebviewUri(this._imagesDir()).toString()
        });
    }

    private _imagesDir(): vscode.Uri {
        return vscode.Uri.joinPath(this._context.globalStorageUri, 'images');
    }

    private async _fileExists(uri: vscode.Uri): Promise<boolean> {
        try {
            await vscode.workspace.fs.stat(uri);
            return true;
        } catch {
            return false;
        }
    }

    /** Saves a picture as a file (for showing it) and keeps a copy with the notes (so it travels with them). */
    private async _writeImage(name: string, bytes: Uint8Array): Promise<void> {
        const dir = this._imagesDir();
        await vscode.workspace.fs.createDirectory(dir);
        await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(dir, name), bytes);
        await this._store().update(IMAGE_KEY_PREFIX + name, Buffer.from(bytes).toString('base64'));
    }

    private async _storeImage(bytes: Uint8Array): Promise<void> {
        const ext = detectImageExt(bytes);
        if (!ext) {
            void vscode.window.showErrorMessage('That file is not a PNG, JPEG, GIF or WebP image.');
            return;
        }
        if (bytes.length > MAX_STORED_BYTES) {
            void vscode.window.showErrorMessage('That image is too large to keep with your notes (limit 3 MB after shrinking).');
            return;
        }
        const file = 'img-' + makeId() + '.' + ext;
        await this._writeImage(file, bytes);
        this._post({ type: 'imageSaved', file });
    }

    /** Makes sure every picture the notes use exists as a file and is kept with the notes. */
    private async _syncImages(): Promise<void> {
        const store = this._store();
        const dir = this._imagesDir();
        for (const name of imageNamesIn(this._pages.concat(this._trash))) {
            const file = vscode.Uri.joinPath(dir, name);
            const kept = store.get<string>(IMAGE_KEY_PREFIX + name);
            try {
                if (await this._fileExists(file)) {
                    if (!kept) {
                        // Older pictures were only files. Keep a copy with the notes too.
                        const bytes = await vscode.workspace.fs.readFile(file);
                        if (bytes.length <= MAX_STORED_BYTES) {
                            await store.update(IMAGE_KEY_PREFIX + name, Buffer.from(bytes).toString('base64'));
                        }
                    }
                } else if (kept) {
                    // The file is missing (new profile, new computer). Bring it back from the notes.
                    await vscode.workspace.fs.createDirectory(dir);
                    await vscode.workspace.fs.writeFile(file, Buffer.from(kept, 'base64'));
                }
            } catch {
                // Leave this picture alone
            }
        }
    }

    private async _readImageBase64(name: string): Promise<string | undefined> {
        const kept = this._store().get<string>(IMAGE_KEY_PREFIX + name);
        if (kept) {
            return kept;
        }
        try {
            const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(this._imagesDir(), name));
            return Buffer.from(bytes).toString('base64');
        } catch {
            return undefined;
        }
    }

    private _reveal() {
        void vscode.commands.executeCommand('notesView.focus');
    }

    private async _onMessage(msg: any) {
        if (!msg || typeof msg.type !== 'string') {
            return;
        }
        switch (msg.type) {
            case 'ready': {
                await this._syncImages();
                this._ready = true;
                this._sendState('init');
                const queued = this._queue;
                this._queue = [];
                queued.forEach(m => this._post(m));
                break;
            }
            case 'save': {
                const pages = normalizeNotes(msg.pages);
                this._pages = pages.length ? pages : [blankNote()];
                this._trash = normalizeNotes(msg.trash, true).slice(0, MAX_TRASH);
                this._persist();
                break;
            }
            case 'setScope':
                await this._setScope(msg.scope === 'workspace' ? 'workspace' : 'global');
                break;
            case 'copy':
                if (typeof msg.text === 'string') {
                    await vscode.env.clipboard.writeText(msg.text);
                }
                break;
            case 'setFontSize':
                if (typeof msg.size === 'number') {
                    await vscode.workspace
                        .getConfiguration(CONFIG)
                        .update('fontSize', clamp(Math.round(msg.size), 10, 24), vscode.ConfigurationTarget.Global);
                }
                break;
            case 'setDarkMode':
                if (typeof msg.enabled === 'boolean') {
                    await vscode.workspace
                        .getConfiguration(CONFIG)
                        .update('darkMode', msg.enabled, vscode.ConfigurationTarget.Global);
                }
                break;
            case 'openSettings':
                void vscode.commands.executeCommand('workbench.action.openSettings', CONFIG);
                break;
            case 'saveImage':
                if (typeof msg.data === 'string' && msg.data.length < MAX_IMAGE_BYTES * 1.4) {
                    await this._storeImage(Buffer.from(msg.data, 'base64'));
                }
                break;
            case 'pickImage': {
                const picked = await vscode.window.showOpenDialog({
                    canSelectMany: false,
                    filters: { Images: ['png', 'jpg', 'jpeg', 'gif', 'webp'] },
                    openLabel: 'Insert image'
                });
                if (picked && picked.length > 0) {
                    try {
                        const bytes = await vscode.workspace.fs.readFile(picked[0]);
                        if (!detectImageExt(bytes)) {
                            void vscode.window.showErrorMessage('That file is not a PNG, JPEG, GIF or WebP image.');
                        } else if (bytes.length > MAX_IMAGE_BYTES) {
                            void vscode.window.showErrorMessage('Images must be smaller than 8 MB.');
                        } else {
                            this._post({ type: 'processImage', data: Buffer.from(bytes).toString('base64') });
                        }
                    } catch {
                        void vscode.window.showErrorMessage('Could not read that image.');
                    }
                }
                break;
            }
            case 'attachLink':
                this._attachLink();
                break;
            case 'openLink':
                await this._openLink(msg.path, msg.line);
                break;
            case 'export':
                await this.exportNotes();
                break;
            case 'import':
                await this.importNotes();
                break;
        }
    }

    private async _setScope(scope: Scope) {
        if (scope === 'workspace' && !this._hasWorkspace()) {
            void vscode.window.showInformationMessage('Open a folder to use project notes.');
            return;
        }
        this._scope = scope;
        void this._context.globalState.update(SCOPE_KEY, scope);
        this._loadState();
        await this._syncImages();
        this._sendState('load');
    }

    /* ---------- Commands ---------- */

    public sendCommand(name: 'new' | 'next' | 'prev' | 'search') {
        this._reveal();
        this._post({ type: 'command', name });
    }

    private _linkFor(editor: vscode.TextEditor, line: number): NoteLink | undefined {
        if (editor.document.uri.scheme !== 'file') {
            return undefined;
        }
        return {
            path: editor.document.uri.fsPath,
            line,
            label: vscode.workspace.asRelativePath(editor.document.uri, false)
        };
    }

    public addSelection(newNote: boolean) {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.selection.isEmpty) {
            void vscode.window.showInformationMessage('Select some text in the editor first.');
            return;
        }
        const selection = editor.selection;
        this._reveal();
        this._post({
            type: 'insertSelection',
            text: editor.document.getText(selection),
            language: editor.document.languageId,
            link: this._linkFor(editor, selection.start.line + 1),
            newNote
        });
    }

    private _attachLink() {
        const editor = vscode.window.activeTextEditor;
        const link = editor ? this._linkFor(editor, editor.selection.active.line + 1) : undefined;
        if (!link) {
            void vscode.window.showInformationMessage('Open a file in the editor first, then try again.');
            return;
        }
        this._post({ type: 'linkAttached', link });
    }

    private async _openLink(filePath: unknown, line: unknown) {
        if (typeof filePath !== 'string' || typeof line !== 'number') {
            return;
        }
        try {
            const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
            const target = clamp(line - 1, 0, Math.max(0, doc.lineCount - 1));
            const pos = new vscode.Position(target, 0);
            await vscode.window.showTextDocument(doc, {
                selection: new vscode.Range(pos, pos),
                preview: false
            });
        } catch {
            void vscode.window.showWarningMessage('Could not open ' + filePath + '. The file may have moved or been deleted.');
        }
    }

    public async exportNotes() {
        const pick = await vscode.window.showQuickPick(
            [
                { label: 'JSON backup', description: 'Can be imported back into Sidebar Quick Notes', format: 'json' },
                { label: 'Markdown', description: 'A readable file with every note', format: 'md' }
            ],
            { placeHolder: 'Choose an export format' }
        );
        if (!pick) {
            return;
        }
        const date = new Date().toISOString().slice(0, 10);
        const isJson = pick.format === 'json';
        const fileName = 'sidebar-notes-' + date + (isJson ? '.json' : '.md');
        const target = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(path.join(os.homedir(), fileName)),
            filters: isJson ? { 'JSON backup': ['json'] } : { Markdown: ['md'] },
            saveLabel: 'Export'
        });
        if (!target) {
            return;
        }

        let text: string;
        if (isJson) {
            const images: Record<string, string> = {};
            for (const name of imageNamesIn(this._pages)) {
                const b64 = await this._readImageBase64(name);
                if (b64) {
                    images[name] = b64;
                }
            }
            text = JSON.stringify(
                { app: 'sidebar-quick-notes', version: 2, exportedAt: new Date().toISOString(), pages: this._pages, images },
                null,
                2
            );
        } else {
            text = this._pages.map(n => '# ' + n.title + '\n\n' + n.content.trim() + '\n').join('\n---\n\n');
        }

        try {
            await vscode.workspace.fs.writeFile(target, Buffer.from(text, 'utf8'));
            void vscode.window.showInformationMessage('Exported ' + this._pages.length + ' notes.');
        } catch {
            void vscode.window.showErrorMessage('Could not write the export file. Check the location and try again.');
        }
    }

    public async importNotes() {
        const uris = await vscode.window.showOpenDialog({
            canSelectMany: false,
            filters: { 'Notes backup': ['json'] },
            openLabel: 'Import'
        });
        if (!uris || uris.length === 0) {
            return;
        }

        let imported: NotePage[] = [];
        let importedImages: Record<string, unknown> = {};
        try {
            const bytes = await vscode.workspace.fs.readFile(uris[0]);
            const data = JSON.parse(Buffer.from(bytes).toString('utf8'));
            imported = normalizeNotes(Array.isArray(data) ? data : data && data.pages);
            if (data && data.images && typeof data.images === 'object') {
                importedImages = data.images;
            }
        } catch {
            imported = [];
        }
        if (imported.length === 0) {
            void vscode.window.showErrorMessage('No notes found in that file. Choose a JSON backup exported from Sidebar Quick Notes.');
            return;
        }

        const mode = await vscode.window.showQuickPick(
            [
                { label: 'Merge', description: 'Add ' + imported.length + ' notes after your current notes', mode: 'merge' },
                { label: 'Replace all', description: 'Move your current notes to Trash and use the imported ones', mode: 'replace' }
            ],
            { placeHolder: 'How should the imported notes be added?' }
        );
        if (!mode) {
            return;
        }

        if (mode.mode === 'replace') {
            const ok = await vscode.window.showWarningMessage(
                'Replace all notes? Your current notes will be moved to Trash.',
                { modal: true },
                'Replace'
            );
            if (ok !== 'Replace') {
                return;
            }
            const moved = this._pages
                .filter(n => n.content.trim() || n.title !== 'Untitled')
                .map(n => ({ ...n, deletedAt: Date.now() }));
            this._trash = [...moved, ...this._trash].slice(0, MAX_TRASH);
            this._pages = imported;
        } else {
            const ids = new Set(this._pages.map(p => p.id));
            for (const n of imported) {
                if (ids.has(n.id)) {
                    n.id = makeId();
                }
                ids.add(n.id);
                this._pages.push(n);
            }
        }

        let imageCount = 0;
        for (const name of Object.keys(importedImages)) {
            const b64 = importedImages[name];
            if (!isValidImageName(name) || typeof b64 !== 'string' || b64.length > MAX_STORED_BYTES * 1.4) {
                continue;
            }
            const bytes = Buffer.from(b64, 'base64');
            const ext = detectImageExt(bytes);
            if (!ext || !name.endsWith('.' + ext) || bytes.length > MAX_STORED_BYTES) {
                continue;
            }
            await this._writeImage(name, bytes);
            imageCount++;
        }

        this._persist();
        this._sendState('load');
        void vscode.window.showInformationMessage(
            'Imported ' + imported.length + ' notes' + (imageCount ? ' and ' + imageCount + ' images' : '') + '.'
        );
    }

    /* ---------- HTML ---------- */

    private _getHtml(webview: vscode.Webview): string {
        const nonce = getNonce();
        const base = vscode.Uri.joinPath(this._context.extensionUri, 'media');
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(base, 'main.js'));
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(base, 'main.css'));

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}'; img-src https: data: ${webview.cspSource};">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link href="${styleUri}" rel="stylesheet">
    <title>Notes</title>
</head>
<body>
    <div id="bootLoading" class="boot-loading" role="status" aria-live="polite">
        <span id="bootSpinner" class="boot-spinner" aria-hidden="true"></span>
        <span id="bootLoadingText">Loading notes...</span>
    </div>
    <div id="bootError" class="boot-error" role="alert" hidden></div>
    <script nonce="${nonce}">
        (function () {
            var box = document.getElementById('bootError');
            var loading = document.getElementById('bootLoading');
            var spinner = document.getElementById('bootSpinner');
            var loadingText = document.getElementById('bootLoadingText');
            function show(text) {
                if (!box) { return; }
                var line = document.createElement('div');
                line.textContent = text;
                box.appendChild(line);
                box.hidden = false;
            }
            window.addEventListener('error', function (e) {
                var t = e && e.target;
                if (t && t.tagName === 'SCRIPT') {
                    show('Could not load ' + String(t.src).split('/').pop());
                    return;
                }
                // Pictures or other files that fail to load are not script errors
                if (t && t !== window) { return; }
                var message = (e && e.error && e.error.message) || (e && e.message) || 'Unknown error';
                var line = (e && typeof e.lineno === 'number') ? e.lineno : 'unknown';
                show('Error: ' + message + ' (line ' + line + ')');
            }, true);
            // Replace the loading indicator with useful guidance if startup stalls.
            var started = Date.now();
            var slow = false;
            var timer = setInterval(function () {
                var select = document.getElementById('noteSelect');
                var loaded = window.__notesReady || (select && select.options.length > 0);
                if (loaded) {
                    clearInterval(timer);
                    loading.hidden = true;
                    return;
                }
                if (!slow && Date.now() - started > 15000) {
                    slow = true;
                    spinner.hidden = true;
                    loading.classList.add('boot-loading-slow');
                    loadingText.textContent = 'Notes are taking longer than expected. Try reopening the Notes view.';
                }
            }, 500);
        })();
    </script>
    <div class="title-row">
        <span id="colorDot" class="color-dot" hidden></span>
        <input type="text" id="titleInput" class="title-input" placeholder="Note title" aria-label="Note title" spellcheck="false" />
        <div class="select-wrap">
            <select id="noteSelect" aria-label="Choose a note" hidden></select>
            <button id="noteSelectBtn" class="note-picker-trigger" type="button" aria-label="Choose a note" title="Choose a note" aria-haspopup="listbox" aria-expanded="false" aria-controls="notePicker">
                <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <path d="M3.2 5.7a.75.75 0 0 1 1.06 0L8 9.44l3.74-3.74a.75.75 0 1 1 1.06 1.06l-4.27 4.27a.75.75 0 0 1-1.06 0L3.2 6.76a.75.75 0 0 1 0-1.06z"/>
                </svg>
            </button>
            <div id="notePicker" class="note-picker" role="listbox" aria-label="Notes" hidden></div>
        </div>
        <button id="themeBtn" class="icon-btn" title="Switch to dark mode" aria-label="Switch to dark mode">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13.2 10.2A5.7 5.7 0 0 1 5.8 2.8 5.8 5.8 0 1 0 13.2 10.2z"/></svg>
        </button>
        <button id="searchBtn" class="icon-btn" title="Search notes (Alt+Shift+S)" aria-label="Search notes">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true">
                <circle cx="7" cy="7" r="4.25"/><path d="M10.2 10.2L14 14"/>
            </svg>
        </button>
        <button id="prevBtn" class="icon-btn" title="Previous note (Ctrl+Alt+,)" aria-label="Previous note">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <path d="M9.78 3.22a.75.75 0 0 1 0 1.06L6.06 8l3.72 3.72a.75.75 0 1 1-1.06 1.06L4.47 8.53a.75.75 0 0 1 0-1.06l4.25-4.25a.75.75 0 0 1 1.06 0z"/>
            </svg>
        </button>
        <button id="nextBtn" class="icon-btn" title="Next note (Ctrl+Alt+.)" aria-label="Next note">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <path d="M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06z"/>
            </svg>
        </button>
        <button id="addBtn" class="icon-btn primary" title="New note (Alt+Shift+N)" aria-label="New note">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <path d="M8 2.5a.75.75 0 0 1 .75.75v4h4a.75.75 0 0 1 0 1.5h-4v4a.75.75 0 0 1-1.5 0v-4h-4a.75.75 0 0 1 0-1.5h4v-4A.75.75 0 0 1 8 2.5z"/>
            </svg>
        </button>
        <button id="pinBtn" class="icon-btn" title="Pin note to the top" aria-label="Pin note" aria-pressed="false">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" aria-hidden="true">
                <path class="fill-on-press" d="M8 1.6l1.95 4 4.4.62-3.2 3.1.78 4.38L8 11.65l-3.93 2.05.78-4.38-3.2-3.1 4.4-.62z"/>
            </svg>
        </button>
        <button id="previewBtn" class="icon-btn" title="Preview markdown" aria-label="Preview markdown" aria-pressed="false">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" aria-hidden="true">
                <path d="M1.5 8s2.3-4.5 6.5-4.5S14.5 8 14.5 8s-2.3 4.5-6.5 4.5S1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/>
            </svg>
        </button>
        <div class="menu-anchor">
            <button id="menuBtn" class="icon-btn" title="More actions" aria-label="More actions" aria-haspopup="menu" aria-expanded="false">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                    <circle cx="3.5" cy="8" r="1.2"/><circle cx="8" cy="8" r="1.2"/><circle cx="12.5" cy="8" r="1.2"/>
                </svg>
            </button>
            <div id="menu" class="menu" role="menu" hidden></div>
        </div>
    </div>

    <div id="panel" class="panel" hidden>
        <div class="panel-head">
            <input id="panelInput" class="panel-input" type="text" placeholder="Search titles and text" aria-label="Search notes" spellcheck="false" />
            <span id="panelTitle" class="panel-title" hidden></span>
            <button id="panelAction" class="text-btn danger" type="button" hidden>Empty trash</button>
            <button id="panelClose" class="icon-btn small" type="button" title="Close" aria-label="Close panel">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>
            </button>
        </div>
        <div id="panelList" class="panel-list" role="listbox"></div>
    </div>

    <div id="linkRow" class="link-row" hidden>
        <button id="linkBtn" class="link-btn" type="button">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" aria-hidden="true">
                <path d="M4 1.5h5l3 3v10H4z"/><path d="M9 1.5v3h3"/>
            </svg>
            <span id="linkText"></span>
        </button>
        <button id="linkRemove" class="icon-btn small" type="button" title="Remove file link" aria-label="Remove file link">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>
        </button>
    </div>

    <div class="editor">
        <textarea id="noteInput" placeholder="Start typing. Your note saves automatically." aria-label="Note content"></textarea>
        <div id="preview" class="preview" hidden></div>
        <div id="imgHandle" class="img-handle" title="Drag to resize" hidden></div>
        <div id="imgBar" class="img-bar" role="toolbar" aria-label="Image size" hidden>
            <button type="button" class="text-btn" data-size="small" title="Small">S</button>
            <button type="button" class="text-btn" data-size="medium" title="Medium">M</button>
            <button type="button" class="text-btn" data-size="large" title="Full width">L</button>
            <button type="button" class="text-btn" data-size="original" title="Original size">Reset</button>
        </div>
    </div>

    <div class="footer">
        <div id="progressTrack" class="progress-track" hidden><div id="progressBar" class="progress-bar"></div></div>
        <div class="footer-row">
            <span id="status" class="status" role="status" aria-live="polite">
                <span class="dot"></span><span id="statusText">Saved</span>
                <button id="undoBtn" class="link-btn" type="button" hidden>Undo</button>
            </span>
            <span id="edited"></span>
        </div>
        <div class="footer-row">
            <span><span id="scopeChip" class="scope-chip" hidden>Project</span> <span id="tasks" class="tasks" hidden></span></span>
            <span id="counts" class="counts"></span>
        </div>
    </div>

    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
    }
}

export function deactivate() { }
