import * as vscode from 'vscode';

interface NotePage {
    title: string;
    content: string;
}

export function activate(context: vscode.ExtensionContext) {
    const provider = new NotesViewProvider(context);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('notesView', provider)
    );
}

class NotesViewProvider implements vscode.WebviewViewProvider {
    constructor(private readonly _context: vscode.ExtensionContext) {}

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        webviewView.webview.options = {
            enableScripts: true
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(message => {
            switch (message.type) {
                case 'savePages':
                    this._context.globalState.update('quickNotesPagesV3', message.pages);
                    break;
            }
        });
    }

    private _getHtmlForWebview(webview: vscode.Webview): string {
        const defaultPages: NotePage[] = [{ title: 'Untitled', content: '' }];
        const savedData = this._context.globalState.get<NotePage[]>('quickNotesPagesV3', defaultPages);
        const initialPages = JSON.stringify(savedData);

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        body {
            font-family: var(--vscode-font-family);
            padding: 8px;
            margin: 0;
            display: flex;
            flex-direction: column;
            height: 100vh;
            box-sizing: border-box;
            color: var(--vscode-foreground);
            background-color: var(--vscode-sideBar-background);
        }
        .controls-row {
            display: flex;
            align-items: center;
            gap: 6px;
            margin-bottom: 8px;
        }
        .nav-group {
            display: flex;
            align-items: center;
            gap: 4px;
        }
        .nav-btn {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 4px 8px;
            cursor: pointer;
            border-radius: 2px;
            font-size: 12px;
            font-weight: bold;
        }
        .nav-btn:hover {
            background: var(--vscode-button-hoverBackground);
        }
        .nav-btn:disabled {
            opacity: 0.4;
            cursor: not-allowed;
        }
        .page-indicator {
            font-size: 11px;
            font-weight: 500;
            white-space: nowrap;
        }
        select, input[type="text"] {
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 2px;
            padding: 4px 6px;
            font-size: 12px;
            box-sizing: border-box;
            width: 100%;
        }
        select:focus, input[type="text"]:focus, textarea:focus {
            outline: 1px solid var(--vscode-focusBorder);
        }
        .title-container {
            display: flex;
            flex-direction: column;
            gap: 6px;
            margin-bottom: 8px;
        }
        textarea {
            flex: 1;
            width: 100%;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            padding: 8px;
            resize: none;
            box-sizing: border-box;
            font-family: inherit;
        }
        .status {
            font-size: 10px;
            color: var(--vscode-descriptionForeground);
            margin-top: 4px;
            text-align: right;
            height: 12px;
        }
    </style>
</head>
<body>
    <div class="controls-row">
        <div class="nav-group">
            <button id="prevBtn" class="nav-btn">&lt;</button>
            <button id="nextBtn" class="nav-btn">&gt;</button>
            <button id="addBtn" class="nav-btn" title="Add New Page">+</button>
        </div>
        <span id="pageIndicator" class="page-indicator">1/1</span>
    </div>

    <div class="title-container">
        <select id="noteSelect"></select>
        <input type="text" id="titleInput" placeholder="Add title..." />
    </div>

    <textarea id="noteInput" placeholder="Type your note here..."></textarea>
    <div id="status" class="status"></div>

    <script>
        const vscode = acquireVsCodeApi();
        let pages = ${initialPages};
        let currentPage = 0;
        let saveTimeout;

        const noteInput = document.getElementById('noteInput');
        const titleInput = document.getElementById('titleInput');
        const noteSelect = document.getElementById('noteSelect');
        const prevBtn = document.getElementById('prevBtn');
        const nextBtn = document.getElementById('nextBtn');
        const addBtn = document.getElementById('addBtn');
        const pageIndicator = document.getElementById('pageIndicator');
        const status = document.getElementById('status');

        function updateDropdownOptions() {
            noteSelect.innerHTML = '';
            pages.forEach((p, idx) => {
                const opt = document.createElement('option');
                opt.value = idx;
                opt.textContent = \`\${idx + 1}. \${p.title || 'Untitled'}\`;
                if (idx === currentPage) opt.selected = true;
                noteSelect.appendChild(opt);
            });
        }

        function updateUI() {
            const page = pages[currentPage] || { title: 'Untitled', content: '' };
            noteInput.value = page.content || '';
            titleInput.value = page.title || '';
            pageIndicator.textContent = \`\${currentPage + 1}/\${pages.length}\`;
            
            prevBtn.disabled = currentPage === 0;
            nextBtn.disabled = currentPage === pages.length - 1;

            updateDropdownOptions();
        }

        function triggerAutoSave() {
            status.textContent = 'Saving...';
            clearTimeout(saveTimeout);

            const enteredTitle = titleInput.value.trim();
            pages[currentPage] = {
                title: enteredTitle.length > 0 ? enteredTitle : 'Untitled',
                content: noteInput.value
            };

            updateDropdownOptions();

            saveTimeout = setTimeout(() => {
                vscode.postMessage({
                    type: 'savePages',
                    pages: pages
                });
                status.textContent = 'Saved';
            }, 400);
        }

        noteInput.addEventListener('input', triggerAutoSave);
        titleInput.addEventListener('input', triggerAutoSave);

        noteSelect.addEventListener('change', (e) => {
            currentPage = parseInt(e.target.value, 10);
            updateUI();
        });

        prevBtn.addEventListener('click', () => {
            if (currentPage > 0) {
                currentPage--;
                updateUI();
            }
        });

        nextBtn.addEventListener('click', () => {
            if (currentPage < pages.length - 1) {
                currentPage++;
                updateUI();
            }
        });

        addBtn.addEventListener('click', () => {
            pages.push({ title: 'Untitled', content: '' });
            currentPage = pages.length - 1;
            updateUI();
            triggerAutoSave();
        });

        updateUI();
    </script>
</body>
</html>`;
    }
}

export function deactivate() {}