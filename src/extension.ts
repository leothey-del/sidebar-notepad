import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import { NotesAi } from './ai/notesAi';

interface NoteLink {
    path: string;
    line: number;
    label: string;
}

interface TerminalCommand {
    command: string;
    cwd?: string;
}

interface TerminalCommandHistory {
    date: string;
    commands: TerminalCommand[];
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
    links?: NoteLink[];
    deletedAt?: number;
}

type Scope = 'global' | 'workspace';

// Keep PAGES_KEY the same as earlier versions so existing users keep their notes
const PAGES_KEY = 'quickNotesPagesV3';
const TRASH_KEY = 'quickNotesTrashV1';
const SCOPE_KEY = 'quickNotesScope';
const TERMINAL_COMMANDS_KEY = 'quickNotesTerminalCommandsV1';
const CONFIG = 'sidebarQuickNotes';
const COLORS = ['red', 'orange', 'yellow', 'green', 'blue', 'purple'];
const MAX_TRASH = 100;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_STORED_BYTES = 3 * 1024 * 1024;
const IMAGE_KEY_PREFIX = 'quickNotesImg:';
const NOTE_DOCUMENT_SCHEME = 'sidebar-quick-notes';

function localDateKey(date = new Date()): string {
    return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' +
        String(date.getDate()).padStart(2, '0');
}

function normalizeTerminalCommandHistory(raw: unknown, today: string): TerminalCommandHistory {
    if (!raw || typeof raw !== 'object') {
        return { date: today, commands: [] };
    }
    const value = raw as Record<string, unknown>;
    if (value.date !== today || !Array.isArray(value.commands)) {
        return { date: today, commands: [] };
    }
    const commands = value.commands.reduce<TerminalCommand[]>((result, item) => {
        if (!item || typeof item !== 'object') { return result; }
        const command = item as Record<string, unknown>;
        if (typeof command.command !== 'string' || !command.command.trim()) { return result; }
        result.push({
            command: command.command,
            ...(typeof command.cwd === 'string' ? { cwd: command.cwd } : {})
        });
        return result;
    }, []);
    return { date: today, commands };
}

interface NoteDocumentIdentity {
    scope: Scope;
    id: string;
}

function makeId(): string {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

function blankNote(): NotePage {
    return { id: makeId(), title: 'Untitled', content: '', updated: Date.now() };
}

function noteDocumentUri(scope: Scope, note: NotePage): vscode.Uri {
    const slug = note.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'note';
    return vscode.Uri.from({ scheme: NOTE_DOCUMENT_SCHEME, path: `/${scope}/${slug}-${note.id}.md` });
}

function noteDocumentIdentity(uri: vscode.Uri): NoteDocumentIdentity | undefined {
    if (uri.scheme !== NOTE_DOCUMENT_SCHEME) {
        return undefined;
    }
    const match = /^\/(global|workspace)\/.*-([a-z0-9]+)\.md$/i.exec(uri.path);
    return match ? { scope: match[1] as Scope, id: match[2] } : undefined;
}

function noteDocumentText(note: NotePage): string {
    return '# ' + (note.title || 'Untitled') + '\n\n' + note.content;
}

function parseNoteDocument(text: string, fallbackTitle: string): { title: string; content: string } {
    const match = /^# ([^\r\n]*)(?:\r?\n|$)/.exec(text);
    if (!match) {
        return { title: fallbackTitle, content: text };
    }
    return {
        title: match[1].trim() || fallbackTitle,
        content: text.slice(match[0].length).replace(/^\r?\n/, '')
    };
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
        const links: NoteLink[] = [];
        const candidates = (Array.isArray(r.links) ? r.links : []).concat(r.link ? [r.link] : []);
        for (const candidate of candidates) {
            if (!candidate || typeof candidate !== 'object') { continue; }
            const link = candidate as Record<string, unknown>;
            if (typeof link.path !== 'string' || typeof link.line !== 'number' || typeof link.label !== 'string') { continue; }
            if (!links.some(existing => existing.path === link.path && existing.line === link.line)) {
                links.push({ path: link.path, line: link.line, label: link.label });
            }
        }
        if (links.length) {
            note.links = links;
            note.link = links[0];
        }
        if (isTrash) {
            note.deletedAt = typeof r.deletedAt === 'number' ? r.deletedAt : Date.now();
        }
        result.push(note);
    }
    return result;
}

function parseMarkdownNotes(markdown: string): NotePage[] {
    const sections = markdown.replace(/^\uFEFF/, '').split(/\r?\n\r?\n---\r?\n\r?\n/);
    const notes = sections.flatMap(section => {
        const match = /^# (.*)(?:\r?\n|$)/.exec(section.trimStart());
        if (!match) {
            return [];
        }
        return [{ title: match[1].trim(), content: section.trimStart().slice(match[0].length).trim() }];
    });
    return normalizeNotes(notes);
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
    const documentProvider = new NotesFileSystemProvider(provider);
    provider.applySync();

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('notesView', provider, {
            // Keeps the current note and cursor when the sidebar is hidden and shown again
            webviewOptions: { retainContextWhenHidden: true }
        }),
        vscode.workspace.registerFileSystemProvider(NOTE_DOCUMENT_SCHEME, documentProvider, { isCaseSensitive: true }),
        vscode.workspace.onDidChangeTextDocument(event => {
            const identity = noteDocumentIdentity(event.document.uri);
            if (identity) {
                provider.updateNoteFromEditor(identity.scope, identity.id, event.document.getText());
                const key = event.document.uri.toString();
                clearTimeout(editorSaveTimers.get(key));
                editorSaveTimers.set(key, setTimeout(() => {
                    editorSaveTimers.delete(key);
                    const document = vscode.workspace.textDocuments.find(item => item.uri.toString() === key);
                    if (document && document.isDirty) {
                        void document.save();
                    }
                }, 400));
            }
        }),
        vscode.workspace.onDidCloseTextDocument(document => {
            const key = document.uri.toString();
            clearTimeout(editorSaveTimers.get(key));
            editorSaveTimers.delete(key);
            const identity = noteDocumentIdentity(document.uri);
            if (identity) {
                provider.updateNoteFromEditor(identity.scope, identity.id, document.getText());
                provider.flushEditorWrites();
            }
        }),
        vscode.commands.registerCommand('quickNotes.newNote', () => provider.sendCommand('new')),
        vscode.commands.registerCommand('quickNotes.nextNote', () => provider.sendCommand('next')),
        vscode.commands.registerCommand('quickNotes.prevNote', () => provider.sendCommand('prev')),
        vscode.commands.registerCommand('quickNotes.searchNotes', () => provider.sendCommand('search')),
        vscode.commands.registerCommand('quickNotes.addSelection', () => provider.addSelection(false)),
        vscode.commands.registerCommand('quickNotes.newNoteFromSelection', () => provider.addSelection(true)),
        vscode.commands.registerCommand('quickNotes.exportNotes', () => provider.exportGlobalNotes()),
        vscode.commands.registerCommand('quickNotes.importNotes', () => provider.importNotes()),
        vscode.commands.registerCommand('quickNotes.activateProLicense', () => provider.activateProLicense()),
        vscode.commands.registerCommand('quickNotes.deactivateProLicense', () => provider.deactivateProLicense()),
        vscode.commands.registerCommand('quickNotes.newNoteFromTerminal', () => provider.addTerminalCommand(true)),
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration(CONFIG)) {
                provider.onConfigChanged();
            }
        }),
        new vscode.Disposable(() => {
            editorSaveTimers.forEach(timer => clearTimeout(timer));
            provider.flushEditorWrites();
        })
    );

    if ('onDidStartTerminalShellExecution' in (vscode.window as unknown as Record<string, unknown>)) {
        context.subscriptions.push(
            (vscode.window as unknown as { onDidStartTerminalShellExecution: (listener: (e: { execution?: { commandLine?: { value?: string }; cwd?: vscode.Uri } }) => void) => vscode.Disposable }).onDidStartTerminalShellExecution(event => {
                const cmd = event?.execution?.commandLine?.value?.trim();
                if (cmd) {
                    provider.recordTerminalCommand(
                        cmd,
                        event?.execution?.cwd ? vscode.workspace.asRelativePath(event.execution.cwd, false) : undefined
                    );
                }
            })
        );
    }
}

const editorSaveTimers = new Map<string, ReturnType<typeof setTimeout>>();

class NotesViewProvider implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView;
    private _ready = false;
    private _queue: unknown[] = [];
    private _scope: Scope = 'global';
    private _pages: NotePage[] = [];
    private _trash: NotePage[] = [];
    private readonly _ai: NotesAi;
    private _editorSaveTimers = new Map<Scope, ReturnType<typeof setTimeout>>();
    private _pendingEditorPages = new Map<Scope, NotePage[]>();
    private _lastTerminalCommand?: { command: string; cwd?: string; timestamp: number };
    private _terminalHistory: TerminalCommandHistory;
    private _terminalHistoryWrite: Promise<void> = Promise.resolve();

    constructor(private readonly _context: vscode.ExtensionContext) {
        const savedScope = _context.globalState.get<Scope>(SCOPE_KEY, 'global');
        this._scope = savedScope === 'workspace' && this._hasWorkspace() ? 'workspace' : 'global';
        const today = localDateKey();
        const savedTerminalHistory = _context.globalState.get<unknown>(TERMINAL_COMMANDS_KEY);
        this._terminalHistory = normalizeTerminalCommandHistory(savedTerminalHistory, today);
        if (!savedTerminalHistory || typeof savedTerminalHistory !== 'object' ||
            (savedTerminalHistory as Record<string, unknown>).date !== today) {
            this._persistTerminalHistory();
        }
        this._loadState();
        this._ai = new NotesAi(_context, message => this._post(message), () =>
            this._pages.map(note => ({ id: note.id, title: note.title, content: note.content, updated: note.updated }))
        );
    }

    public activateProLicense(): Promise<void> {
        return this._ai.activateLicense();
    }

    public deactivateProLicense(): Promise<void> {
        return this._ai.deactivateLicense();
    }

    public recordTerminalCommand(command: string, cwd?: string) {
        const today = localDateKey();
        if (this._terminalHistory.date !== today) {
            this._terminalHistory = { date: today, commands: [] };
        }
        this._terminalHistory.commands.push({ command, cwd });
        this._persistTerminalHistory();
        this._lastTerminalCommand = {
            command,
            cwd,
            timestamp: Date.now()
        };
    }

    public showTerminalCommands() {
        const today = localDateKey();
        if (this._terminalHistory.date !== today) {
            this._terminalHistory = { date: today, commands: [] };
            this._persistTerminalHistory();
        }
        if (!this._terminalHistory.commands.length) {
            void vscode.window.showInformationMessage(
                'No terminal commands recorded today. Run a command in the integrated terminal, then try again.'
            ).then(() => this._post({ type: 'menuActionComplete', actionId: 'terminalBtn' }));
            return;
        }

        const addButton: vscode.QuickInputButton = {
            iconPath: new vscode.ThemeIcon('add'),
            tooltip: 'Add command to current note'
        };
        const picker = vscode.window.createQuickPick<vscode.QuickPickItem & TerminalCommand>();
        picker.title = "Today's terminal commands";
        picker.placeholder = 'Choose a command and click + to add it to the current note';
        picker.items = this._terminalHistory.commands.slice().reverse().map(command => ({
            label: command.command.split(/\r?\n/)[0],
            description: command.cwd ? 'in ' + command.cwd : undefined,
            detail: command.command.includes('\n') ? command.command : undefined,
            buttons: [addButton],
            ...command
        }));
        picker.onDidTriggerItemButton(event => {
            this._post({
                type: 'insertTerminalCommand',
                command: event.item.command,
                cwd: event.item.cwd,
                newNote: false
            });
        });
        picker.onDidHide(() => {
            picker.dispose();
            this._post({ type: 'menuActionComplete', actionId: 'terminalBtn' });
        });
        picker.show();
    }

    public async addTerminalCommand(newNote = true) {
        let command = this._lastTerminalCommand?.command;
        let cwd = this._lastTerminalCommand?.cwd;

        if (!command) {
            const input = await vscode.window.showInputBox({
                prompt: 'No recent terminal command recorded. Enter or paste a command for your note:',
                placeHolder: 'e.g. npm create vite@latest'
            });
            if (!input || !input.trim()) {
                return;
            }
            command = input.trim();
        }

        this._reveal();
        this._post({
            type: 'insertTerminalCommand',
            command,
            cwd,
            newNote
        });
    }

    private _persistTerminalHistory() {
        const history: TerminalCommandHistory = {
            date: this._terminalHistory.date,
            commands: this._terminalHistory.commands.map(command => ({ ...command }))
        };
        this._terminalHistoryWrite = this._terminalHistoryWrite.then(async () => {
            try {
                await this._context.globalState.update(TERMINAL_COMMANDS_KEY, history);
            } catch (error) {
                console.error('Could not save terminal command history:', error);
                void vscode.window.showErrorMessage('Could not save terminal command history.');
            }
        });
    }

    /* ---------- State ---------- */

    private _hasWorkspace(): boolean {
        const folders = vscode.workspace.workspaceFolders;
        return !!folders && folders.length > 0;
    }

    private _store(): vscode.Memento {
        return this._scope === 'workspace' ? this._context.workspaceState : this._context.globalState;
    }

    private _storeForScope(scope: Scope): vscode.Memento {
        return scope === 'workspace' ? this._context.workspaceState : this._context.globalState;
    }

    private _settings() {
        const c = vscode.workspace.getConfiguration(CONFIG);
        return {
            autoSaveDelay: clamp(c.get<number>('autoSaveDelay', 400), 100, 5000),
            fontSize: clamp(c.get<number>('fontSize', 13), 1, 24),
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

    public getNotes(scope: Scope = this._scope): NotePage[] {
        if (scope === this._scope) {
            return this._pages;
        }
        return normalizeNotes(this._storeForScope(scope).get<unknown>(PAGES_KEY));
    }

    public getNote(scope: Scope, id: string): NotePage | undefined {
        return this.getNotes(scope).find(note => note.id === id);
    }

    public async openNote(scope: Scope, id: string) {
        const note = this.getNote(scope, id);
        if (!note) {
            return;
        }
        const document = await vscode.workspace.openTextDocument(noteDocumentUri(scope, note));
        await vscode.window.showTextDocument(document, { preview: false });
    }

    public async createEditorNote() {
        const note = blankNote();
        if (this._settings().newNoteTitle === 'date') {
            note.title = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
        }
        this._pages.unshift(note);
        this._persist();
        await this.openNote(this._scope, note.id);
    }

    public updateNoteFromEditor(scope: Scope, id: string, text: string) {
        const notes = this.getNotes(scope).map(note => ({ ...note }));
        const note = notes.find(item => item.id === id);
        if (!note) {
            return;
        }
        const parsed = parseNoteDocument(text, note.title || 'Untitled');
        if (note.title === parsed.title && note.content === parsed.content) {
            return;
        }
        note.title = parsed.title;
        note.content = parsed.content;
        note.updated = Date.now();
        if (scope === this._scope) {
            this._pages = notes;
        }
        this._pendingEditorPages.set(scope, notes);
        const previous = this._editorSaveTimers.get(scope);
        if (previous) {
            clearTimeout(previous);
        }
        this._editorSaveTimers.set(scope, setTimeout(() => this._flushEditorWrites(scope), this._settings().autoSaveDelay));
        this._post({ type: 'editorNoteChanged', scope, note });
    }

    public flushEditorWrites() {
        Array.from(this._pendingEditorPages.keys()).forEach(scope => this._flushEditorWrites(scope));
    }

    private _flushEditorWrites(scope: Scope) {
        const timer = this._editorSaveTimers.get(scope);
        if (timer) {
            clearTimeout(timer);
            this._editorSaveTimers.delete(scope);
        }
        const pages = this._pendingEditorPages.get(scope);
        if (pages) {
            this._pendingEditorPages.delete(scope);
            void this._storeForScope(scope).update(PAGES_KEY, pages);
        }
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
        webviewView.description = '';

        const codiconsDir = vscode.Uri.joinPath(this._context.extensionUri, 'node_modules', '@vscode', 'codicons', 'dist');
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(this._context.extensionUri, 'media'), codiconsDir, this._imagesDir()]
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

    private _setActivityStatus(status: string, duration?: number) {
        this._post({ type: 'activityStatus', status, duration });
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

    private async _storeImage(bytes: Uint8Array, pasted = false): Promise<void> {
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
        this._post({ type: 'imageSaved', file, pasted });
    }

    /** Makes sure every picture the notes use exists as a file and is kept with the notes. */
    private async _syncImages(onProgress?: (completed: number, total: number) => void): Promise<number> {
        const store = this._store();
        const dir = this._imagesDir();
        const names = imageNamesIn(this._pages.concat(this._trash));
        let failed = 0;
        for (let index = 0; index < names.length; index++) {
            const name = names[index];
            onProgress?.(index + 1, names.length);
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
                failed++;
            }
        }
        return failed;
    }

    private async _readImageBase64(name: string, store: vscode.Memento): Promise<string | undefined> {
        const kept = store.get<string>(IMAGE_KEY_PREFIX + name);
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
                this._ready = true;
                this._sendState('init');
                void this._ai.sendLicenseStatus();
                const queued = this._queue;
                this._queue = [];
                queued.forEach(m => this._post(m));
                const view = this._view;
                void this._syncImages((completed, total) => {
                    if (this._view === view && this._ready) {
                        this._post({ type: 'imageSyncProgress', completed, total });
                    }
                }).then(failedCount => {
                    if (this._view === view && this._ready) {
                        this._post({ type: 'imageSyncComplete', failedCount });
                    }
                }, error => {
                    console.error('Failed to sync note images:', error);
                    if (this._view === view && this._ready) {
                        this._post({ type: 'imageSyncFailed' });
                    }
                });
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
                    try {
                        await vscode.env.clipboard.writeText(msg.text);
                        this._post({ type: 'copyComplete' });
                    } catch (error) {
                        console.error('Could not copy note to clipboard:', error);
                        this._post({ type: 'copyFailed' });
                        void vscode.window.showErrorMessage('Could not copy note to the clipboard.');
                    }
                }
                break;
            case 'copyImageMarkdownForCut':
                if (typeof msg.markdown === 'string' && typeof msg.requestId === 'number') {
                    try {
                        await vscode.env.clipboard.writeText(msg.markdown);
                        this._post({ type: 'imageCutMarkdownCopied', requestId: msg.requestId });
                    } catch (error) {
                        console.error('Could not copy image Markdown for cut:', error);
                        this._post({ type: 'imageCutMarkdownFailed', requestId: msg.requestId });
                        void vscode.window.showErrorMessage('Could not cut the image because clipboard access failed.');
                    }
                }
                break;
            case 'aiStatus':
                this._ai.sendStatus();
                break;
            case 'aiRun':
                void this._ai.run(msg);
                break;
            case 'aiCancel':
                this._ai.cancel(msg.requestId);
                break;
            case 'aiChooseModel':
                try {
                    await this._ai.chooseModel();
                } finally {
                    this._post({ type: 'menuActionComplete', actionId: 'menu:choose-ai-model' });
                }
                break;
            case 'setFontSize':
                if (typeof msg.size === 'number') {
                    await vscode.workspace
                        .getConfiguration(CONFIG)
                        .update('fontSize', clamp(Math.round(msg.size), 1, 24), vscode.ConfigurationTarget.Global);
                }
                break;
            case 'saveImage':
                if (typeof msg.data === 'string' && msg.data.length < MAX_IMAGE_BYTES * 1.4) {
                    await this._storeImage(Buffer.from(msg.data, 'base64'), msg.pasted === true);
                }
                break;
            case 'readDroppedImage': {
                if (typeof msg.uri !== 'string') {
                    break;
                }
                try {
                    const uri = vscode.Uri.parse(msg.uri);
                    if (uri.scheme !== 'file') {
                        void vscode.window.showErrorMessage('Drop an image file from your computer.');
                        break;
                    }
                    const stat = await vscode.workspace.fs.stat(uri);
                    if (stat.size > MAX_IMAGE_BYTES) {
                        void vscode.window.showErrorMessage('Images must be smaller than 8 MB.');
                        break;
                    }
                    const bytes = await vscode.workspace.fs.readFile(uri);
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
                break;
            }
            case 'pickImage': {
                try {
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
                } finally {
                    this._post({ type: 'menuActionComplete', actionId: 'menu:insert-image-from-file' });
                }
                break;
            }
            case 'attachLink':
                try {
                    this._attachLink();
                } finally {
                    this._post({ type: 'menuActionComplete', actionId: 'menu:attach-current-file' });
                }
                break;
            case 'openLink':
                await this._openLink(msg.path, msg.line);
                break;
            case 'exportCurrent':
                try {
                    await this.exportCurrentNote(msg.id);
                } catch (error) {
                    this._setActivityStatus('');
                    throw error;
                } finally {
                    this._post({ type: 'menuActionComplete', actionId: 'menu:export-current-note' });
                }
                break;
            case 'exportGlobal':
                try {
                    await this.exportGlobalNotes();
                } catch (error) {
                    this._setActivityStatus('');
                    throw error;
                } finally {
                    this._post({ type: 'menuActionComplete', actionId: 'menu:export-all-global-notes' });
                }
                break;
            case 'import':
                try {
                    await this.importNotes();
                } finally {
                    this._post({ type: 'menuActionComplete', actionId: 'menu:import-notes' });
                }
                break;
            case 'getTerminalCommand':
                void this.addTerminalCommand(msg.newNote !== false);
                break;
            case 'showTerminalCommands':
                this.showTerminalCommands();
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

    public async exportCurrentNote(noteId: unknown): Promise<boolean> {
        if (typeof noteId !== 'string') {
            this._setActivityStatus('');
            return false;
        }
        const note = this._pages.find(page => page.id === noteId);
        if (!note) {
            this._setActivityStatus('');
            void vscode.window.showInformationMessage('The selected note is no longer available.');
            return false;
        }
        return this._exportNotes([note], this._store(), 'sidebar-note');
    }

    public async exportGlobalNotes(): Promise<boolean> {
        const globalStore = this._context.globalState;
        const notes = normalizeNotes(globalStore.get<unknown>(PAGES_KEY));
        if (notes.length === 0) {
            this._setActivityStatus('');
            void vscode.window.showInformationMessage('There are no global notes to export.');
            return false;
        }
        return this._exportNotes(notes, globalStore, 'sidebar-global-notes');
    }

    private async _exportNotes(notes: NotePage[], imageStore: vscode.Memento, filePrefix: string): Promise<boolean> {
        let exported = false;
        this._setActivityStatus('Choose export format');
        try {
            const pick = await vscode.window.showQuickPick(
                [
                    { label: 'JSON backup', description: 'Can be imported back into Sidebar Quick Notes', format: 'json' },
                    { label: 'Markdown', description: 'A readable file with every note', format: 'md' }
                ],
                { placeHolder: 'Choose an export format' }
            );
            if (!pick) {
                return false;
            }
            this._setActivityStatus('Choose save location');
            const date = new Date().toISOString().slice(0, 10);
            const isJson = pick.format === 'json';
            const fileName = filePrefix + '-' + date + (isJson ? '.json' : '.md');
            const target = await vscode.window.showSaveDialog({
                defaultUri: vscode.Uri.file(path.join(os.homedir(), fileName)),
                filters: isJson ? { 'JSON backup': ['json'] } : { Markdown: ['md'] },
                saveLabel: 'Export'
            });
            if (!target) {
                return false;
            }

            this._setActivityStatus('Exporting...');
            let text: string;
            if (isJson) {
                const images: Record<string, string> = {};
                for (const name of imageNamesIn(notes)) {
                    const b64 = await this._readImageBase64(name, imageStore);
                    if (b64) {
                        images[name] = b64;
                    }
                }
                text = JSON.stringify(
                    { app: 'sidebar-quick-notes', version: 2, exportedAt: new Date().toISOString(), pages: notes, images },
                    null,
                    2
                );
            } else {
                text = notes.map(n => '# ' + n.title + '\n\n' + n.content.trim() + '\n').join('\n---\n\n');
            }

            try {
                await vscode.workspace.fs.writeFile(target, Buffer.from(text, 'utf8'));
            } catch {
                void vscode.window.showErrorMessage('Could not write the export file. Check the location and try again.');
                return false;
            }
            void vscode.window.showInformationMessage('Exported ' + notes.length + (notes.length === 1 ? ' note.' : ' notes.'));
            this._setActivityStatus('Exported', 2500);
            exported = true;
            return true;
        } finally {
            if (!exported) {
                this._setActivityStatus('');
            }
        }
    }

    public async importNotes() {
        let importedSuccessfully = false;
        this._setActivityStatus('Choose notes file');
        try {
            const uris = await vscode.window.showOpenDialog({
                canSelectMany: false,
                filters: { 'Notes export': ['json', 'md'] },
                openLabel: 'Import'
            });
            if (!uris || uris.length === 0) {
                return;
            }

            this._setActivityStatus('Importing...');
            let imported: NotePage[] = [];
            let importedImages: Record<string, unknown> = {};
            try {
                const bytes = await vscode.workspace.fs.readFile(uris[0]);
                const text = Buffer.from(bytes).toString('utf8');
                if (path.extname(uris[0].fsPath).toLowerCase() === '.md') {
                    imported = parseMarkdownNotes(text);
                } else {
                    const data = JSON.parse(text);
                    imported = normalizeNotes(Array.isArray(data) ? data : data && data.pages);
                    if (data && data.images && typeof data.images === 'object') {
                        importedImages = data.images;
                    }
                }
            } catch {
                imported = [];
            }
            if (imported.length === 0) {
                void vscode.window.showErrorMessage('No notes found. Choose a JSON backup or Markdown export from Sidebar Quick Notes.');
                return;
            }

            this._setActivityStatus('Choose import method');
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
            this._setActivityStatus('Imported', 2500);
            importedSuccessfully = true;
        } finally {
            if (!importedSuccessfully) {
                this._setActivityStatus('');
            }
        }
    }

    /* ---------- HTML ---------- */

    private _getHtml(webview: vscode.Webview): string {
        const nonce = getNonce();
        const base = vscode.Uri.joinPath(this._context.extensionUri, 'media');
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(base, 'main.js'));
        const aiScriptUri = webview.asWebviewUri(vscode.Uri.joinPath(base, 'ai', 'ai.js'));
        const highlightScriptUri = webview.asWebviewUri(vscode.Uri.joinPath(base, 'highlight.js'));
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(base, 'main.css'));
        const aiStyleUri = webview.asWebviewUri(vscode.Uri.joinPath(base, 'ai', 'ai.css'));
        const codiconStyleUri = webview.asWebviewUri(vscode.Uri.joinPath(
            this._context.extensionUri, 'node_modules', '@vscode', 'codicons', 'dist', 'codicon.css'
        ));

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; font-src ${webview.cspSource}; script-src 'nonce-${nonce}'; img-src https: data: ${webview.cspSource};">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link href="${codiconStyleUri}" rel="stylesheet">
    <link href="${styleUri}" rel="stylesheet">
    <link href="${aiStyleUri}" rel="stylesheet">
    <title>Notes</title>
</head>
<body class="booting">
    <div id="bootLoading" class="boot-loading" role="status" aria-live="polite" aria-label="Loading notes">
        <span id="bootSpinner" class="boot-spinner" aria-hidden="true"></span>
        <span id="bootLoadingText">Loading saved notes...</span>
    </div>
    <div id="bootError" class="boot-error" role="alert" hidden></div>
    <script nonce="${nonce}">
        (function () {
            var box = document.getElementById('bootError');
            var loading = document.getElementById('bootLoading');
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
                    document.body.classList.remove('booting');
                    return;
                }
                if (!slow && Date.now() - started > 15000) {
                    slow = true;
                    loading.classList.add('boot-loading-slow');
                    var slowMessage = 'Still loading. Notes are taking longer than expected; try reopening the Notes view.';
                    loadingText.textContent = slowMessage;
                    loading.setAttribute('aria-label', slowMessage);
                }
            }, 500);
        })();
    </script>
    <div class="title-row">
        <div class="select-wrap">
            <select id="noteSelect" aria-label="Choose a note" hidden></select>
            <button id="noteSelectBtn" class="note-picker-trigger" type="button" aria-label="Open notes list" title="Open notes list" aria-haspopup="dialog" aria-expanded="false" aria-controls="notePickerList">
                <span class="codicon codicon-layout-sidebar-left-off" aria-hidden="true"></span>
            </button>
            <div id="notePicker" class="note-picker" role="dialog" aria-label="Notes" hidden>
                <div class="note-picker-head">
                    <button id="notePickerSearch" class="note-picker-search icon-btn small" type="button" title="Search notes" aria-label="Search notes">
                        <span class="codicon codicon-search" aria-hidden="true"></span>
                    </button>
                    <button id="notePickerClose" class="note-picker-close icon-btn small" type="button" title="Close notes list" aria-label="Close notes list">
                        <span class="codicon codicon-chevron-left" aria-hidden="true"></span>
                    </button>
                </div>
                <div id="notePickerList" class="note-picker-list" role="group" aria-label="Note titles"></div>
            </div>
        </div>
        <input type="text" id="titleInput" class="title-input" placeholder="Note title" aria-label="Note title" spellcheck="false" />
        <button id="addBtn" class="icon-btn primary" title="New note (Alt+Shift+N)" aria-label="New note">
            <span class="codicon codicon-add" aria-hidden="true"></span>
        </button>
        <div id="pinnedMenuActions" class="pinned-menu-actions">
            <button id="searchBtn" class="icon-btn" title="Search notes (Alt+Shift+S)" aria-label="Search notes" aria-pressed="false">
                <span class="codicon codicon-search" aria-hidden="true"></span>
            </button>
            <button id="terminalBtn" class="icon-btn" title="Show today's terminal commands" aria-label="Show today's terminal commands">
                <span class="codicon codicon-terminal" aria-hidden="true"></span>
            </button>
            <button id="pinBtn" class="icon-btn" title="Pin note to the top" aria-label="Pin note" aria-pressed="false">
                <span class="codicon codicon-pin" aria-hidden="true"></span>
            </button>
            <button id="previewBtn" class="icon-btn" title="Preview markdown" aria-label="Preview markdown" aria-pressed="false">
                <span class="codicon codicon-eye" aria-hidden="true"></span>
            </button>
        </div>
        <div class="menu-anchor">
            <button id="menuBtn" class="icon-btn" title="More actions" aria-label="More actions" aria-haspopup="menu" aria-expanded="false">
                <span class="codicon codicon-ellipsis" aria-hidden="true"></span>
            </button>
            <div id="menu" class="menu" role="menu" hidden></div>
        </div>
    </div>
    <div id="toolbarContextMenu" class="toolbar-context-menu" role="menu" aria-label="Customize toolbar" hidden></div>

    <div id="panel" class="panel" hidden>
        <div class="panel-head">
            <div class="panel-search-field">
                <input id="panelInput" class="panel-input" type="text" placeholder="Search titles and text" aria-label="Search notes" spellcheck="false" />
                <button id="panelClear" class="icon-btn small" type="button" title="Clear search" aria-label="Clear search" hidden>
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>
                </button>
            </div>
            <span id="panelTitle" class="panel-title" hidden></span>
            <button id="panelAction" class="text-btn danger" type="button" hidden>Empty trash</button>
            <button id="panelClose" class="icon-btn small" type="button" title="Close" aria-label="Close panel">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>
            </button>
        </div>
        <div id="panelList" class="panel-list" role="listbox"></div>
    </div>

    <div id="linkRow" class="link-row" hidden></div>

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

    <div id="backgroundStatus" class="background-status" role="status" aria-live="polite" hidden></div>
    <div class="footer">
        <div id="progressTrack" class="progress-track" hidden><div id="progressBar" class="progress-bar"></div></div>
        <div class="footer-row status-row">
            <span id="scopeChip" class="scope-chip" hidden>Project</span>
            <span class="footer-status-actions">
                <span id="statusText" class="visually-hidden" role="status" aria-live="polite">Saved</span>
                <span class="zoom-controls" role="group" aria-label="Note text size">
                    <button id="zoomOutBtn" class="icon-btn zoom-button" type="button" title="Zoom out (Ctrl/Cmd+-)" aria-label="Zoom out text">-</button>
                    <button id="zoomInBtn" class="icon-btn zoom-button" type="button" title="Zoom in (Ctrl/Cmd++)" aria-label="Zoom in text">+</button>
                </span>
                <button id="undoBtn" class="link-btn" type="button" hidden>Undo</button>
            </span>
            <span id="edited"></span>
        </div>
        <div id="footerMeta" class="footer-row" hidden>
            <span id="tasks" class="tasks" hidden></span>
        </div>
    </div>

    <script nonce="${nonce}" src="${scriptUri}" data-markdown-src="${highlightScriptUri}"></script>
    <script nonce="${nonce}" src="${aiScriptUri}"></script>
</body>
</html>`;
    }
}

class NotesFileSystemProvider implements vscode.FileSystemProvider {
    private _onDidChangeFile = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
    public readonly onDidChangeFile = this._onDidChangeFile.event;

    constructor(private readonly _notes: NotesViewProvider) { }

    public watch(): vscode.Disposable {
        return new vscode.Disposable(() => undefined);
    }

    public stat(uri: vscode.Uri): vscode.FileStat {
        if (uri.path === '/' || /^\/(global|workspace)$/.test(uri.path)) {
            return { type: vscode.FileType.Directory, ctime: 0, mtime: 0, size: 0 };
        }
        const identity = noteDocumentIdentity(uri);
        const note = identity && this._notes.getNote(identity.scope, identity.id);
        if (!identity || !note) {
            throw vscode.FileSystemError.FileNotFound(uri);
        }
        const content = Buffer.byteLength(noteDocumentText(note));
        const updated = note.updated || 0;
        return { type: vscode.FileType.File, ctime: updated, mtime: updated, size: content };
    }

    public readDirectory(uri: vscode.Uri): [string, vscode.FileType][] {
        if (uri.path === '/') {
            return [['global', vscode.FileType.Directory], ['workspace', vscode.FileType.Directory]];
        }
        const match = /^\/(global|workspace)$/.exec(uri.path);
        if (!match) {
            throw vscode.FileSystemError.FileNotADirectory(uri);
        }
        const scope = match[1] as Scope;
        return this._notes.getNotes(scope).map(note => [
            path.basename(noteDocumentUri(scope, note).path),
            vscode.FileType.File
        ]);
    }

    public createDirectory(uri: vscode.Uri): void {
        if (uri.path !== '/' && !/^\/(global|workspace)$/.test(uri.path)) {
            throw vscode.FileSystemError.NoPermissions(uri);
        }
    }

    public readFile(uri: vscode.Uri): Uint8Array {
        const identity = noteDocumentIdentity(uri);
        const note = identity && this._notes.getNote(identity.scope, identity.id);
        if (!note) {
            throw vscode.FileSystemError.FileNotFound(uri);
        }
        return Buffer.from(noteDocumentText(note), 'utf8');
    }

    public writeFile(uri: vscode.Uri, content: Uint8Array, options: { create: boolean; overwrite: boolean }): void {
        const identity = noteDocumentIdentity(uri);
        const note = identity && this._notes.getNote(identity.scope, identity.id);
        if (!identity || !note) {
            throw vscode.FileSystemError.FileNotFound(uri);
        }
        if (!options.overwrite) {
            throw vscode.FileSystemError.FileExists(uri);
        }
        this._notes.updateNoteFromEditor(identity.scope, identity.id, Buffer.from(content).toString('utf8'));
        this._notes.flushEditorWrites();
    }

    public delete(uri: vscode.Uri): void {
        throw vscode.FileSystemError.NoPermissions(uri);
    }

    public rename(oldUri: vscode.Uri, _newUri: vscode.Uri): void {
        throw vscode.FileSystemError.NoPermissions(oldUri);
    }
}

export function deactivate() { }
