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
            localResourceRoots: [vscode.Uri.joinPath(this._context.extensionUri, 'media')]
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
            settings: this._settings()
        });
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
                this._setScope(msg.scope === 'workspace' ? 'workspace' : 'global');
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
            case 'openSettings':
                void vscode.commands.executeCommand('workbench.action.openSettings', CONFIG);
                break;
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

    private _setScope(scope: Scope) {
        if (scope === 'workspace' && !this._hasWorkspace()) {
            void vscode.window.showInformationMessage('Open a folder to use project notes.');
            return;
        }
        this._scope = scope;
        void this._context.globalState.update(SCOPE_KEY, scope);
        this._loadState();
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

        const text = isJson
            ? JSON.stringify({ app: 'sidebar-quick-notes', version: 1, exportedAt: new Date().toISOString(), pages: this._pages }, null, 2)
            : this._pages.map(n => '# ' + n.title + '\n\n' + n.content.trim() + '\n').join('\n---\n\n');

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
        try {
            const bytes = await vscode.workspace.fs.readFile(uris[0]);
            const data = JSON.parse(Buffer.from(bytes).toString('utf8'));
            imported = normalizeNotes(Array.isArray(data) ? data : data && data.pages);
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
            const moved: NotePage[] = this._pages
                .filter(n => n.content.trim() || n.title !== 'Untitled')
                .map(n => ({ ...n, deletedAt: Date.now() }));
            this._trash = moved.concat(this._trash).slice(0, MAX_TRASH);
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

        this._persist();
        this._sendState('load');
        void vscode.window.showInformationMessage('Imported ' + imported.length + ' notes.');
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
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}'; img-src https: data:;">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link href="${styleUri}" rel="stylesheet">
    <title>Notes</title>
</head>
<body>
    <div class="toolbar">
        <div class="select-wrap">
            <select id="noteSelect" aria-label="Choose a note"></select>
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <path d="M3.2 5.7a.75.75 0 0 1 1.06 0L8 9.44l3.74-3.74a.75.75 0 1 1 1.06 1.06l-4.27 4.27a.75.75 0 0 1-1.06 0L3.2 6.76a.75.75 0 0 1 0-1.06z"/>
            </svg>
        </div>
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

    <div class="title-row">
        <span id="colorDot" class="color-dot" hidden></span>
        <input type="text" id="titleInput" class="title-input" placeholder="Note title" aria-label="Note title" spellcheck="false" />
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