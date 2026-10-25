# Sidebar Notepad

☕ [Buy me a coffee](https://ko-fi.com/leoort)

Keep notes close to your code in a dedicated VS Code Explorer view. Create and organize notes, capture code selections, paste images, track checklist progress, and find or restore notes without leaving your editor.

## Screenshots

![Sidebar Quick Notes screenshot 1](https://github.com/leothey-del/sidebar-notepad/blob/main/images/image2.png)


## Features

- **Multiple notes:** Create, duplicate, pin, color-label, and title notes. Pinned notes stay at the top.
- **Theme matching:** The Notes view follows the active VS Code color theme.
- **Customizable toolbar:** Right-click supported toolbar actions or More actions entries to pin or unpin them. Pinned actions appear beside **+** in the order they were pinned. The New note button is always visible; the note selector and More actions buttons are not customizable.
- **Automatic saving:** Edits save after a configurable delay. The view remembers the selected note.
- **Search:** Find notes by title or content, with matching text snippets.
- **Markdown preview:** Preview headings, lists, task lists, tables, blockquotes, links, images, and common inline formatting. Fenced code blocks use their declared language for syntax highlighting, and recognizable unfenced code snippets are highlighted automatically. Task checkboxes can be toggled in the preview. Each note remembers whether it was in preview or edit mode, and the eye button is outlined while a preview is showing. This is a lightweight preview, not full CommonMark support.
- **Images:** Paste a copied picture or screenshot straight into a note, or insert an image file from the More actions menu. Images appear in the preview. Markdown image links (`![text](https://...)`) work too.
- **Code capture:** Add selected editor text to the current note or create a new note from the selection. Captured snippets include a language-tagged code block and a link to the source file when available.
- **Terminal commands:** Browse commands run in the integrated terminal today, newest first, and add individual commands to the current note.
- **File links:** Attach the active file and line to a note, then jump back to that location from the note.
- **AI tools:** Suggest a title, summarize a note, extract checklist tasks, explain an error or log, or ask questions about your notes. Choose a VS Code language model, then review, copy, or apply the response. Answers about your notes can include links to their source notes.
- **Trash and undo:** Undo a recent deletion, restore notes from Trash, or permanently remove notes. Trash is limited to the newest 100 notes and expires according to the retention setting.
- **Import and export:** Export notes as JSON backup or Markdown. Import a JSON backup by merging notes or replacing the current set.
- **Global or project notes:** Choose extension-wide notes or notes stored with the current workspace.
- **Optional Settings Sync:** Include global notes in VS Code Settings Sync when enabled in the extension settings and VS Code Settings Sync is on.
- **Editor integration:** Use the Command Palette, editor selection context menu, or keyboard shortcuts for common actions.

## How to Use

1. Install the extension.
2. Select the **Notes** icon in the Activity Bar to open the Notes view.
3. Select **+** to create a note and start typing. Changes are saved automatically.
4. Your notes persist across different projects and VS Code sessions.

## Getting Started

1. Select the **Notes** icon in the Activity Bar to open the Notes view.
2. Select **+** to create a note. Give it a descriptive title, such as **HTML/CSS Scratchpad**; if you leave the title empty, the note uses **Untitled**. Note IDs are generated automatically. Type in the editor; changes save automatically.
3. Use the note selector or previous/next buttons to move between notes.
4. Use the eye button to preview Markdown. When the preview is on, the button is outlined; click it again to go back to editing. Open the **More actions** menu for note organization, Trash, import/export, font size, storage scope, and settings.
   Right-click a supported icon in the More actions panel to add that action to the toolbar; right-click it again to unpin it. The New note button cannot be unpinned; the note selector and More actions buttons do not have a right-click action.
5. Open **More actions** to run an AI tool. Sign in to GitHub Copilot or configure an AI provider in VS Code, then choose a model. AI actions send the relevant note text to the selected model; **Ask your notes** can search your notes to answer a question.
6. Copy a picture and press `Ctrl+V` (`Cmd+V` on macOS) in a note to add it. The note switches to preview so you can see the image.
7. Select text in a code editor and use the editor context menu to add it to a note or create a note from it.

## Images

There are three ways to add a picture to a note:

- **Paste:** Copy an image (for example a screenshot with `Win+Shift+S`, or **Copy image** in a browser) and press `Ctrl+V` in the note. If you paste while previewing, the image is added to the end of the note.
- **From a file:** Open **More actions** and choose **Insert image from file**.
- **By link:** Type `![description](https://example.com/photo.png)` in the note and open the preview.

Good to know:

- Pasted and inserted images are saved as PNG, JPEG, GIF, or WebP files, up to 8 MB each. The note itself only keeps a short link such as `![image](img:img-abc123.png)`, so notes stay small.
- Images show in the preview, not in the text editor. Click the eye button to switch.
- Web links must start with `https://`. Remote images load from the internet when you preview the note.
- Small images can also be embedded as `data:image/...;base64,` links.

## Keyboard Shortcuts

Default shortcuts on Windows and Linux:

| Action | Shortcut |
| --- | --- |
| New note | `Alt+Shift+N` |
| Search notes | `Alt+Shift+S` |
| Next note | `Ctrl+Alt+.` |
| Previous note | `Ctrl+Alt+,` |
| Add editor selection to current note | `Ctrl+Alt+A` |

On macOS, the note navigation shortcuts use `Cmd+Alt+.` and `Cmd+Alt+,`; new note and search use `Alt+Shift+N` and `Alt+Shift+S`. Shortcuts can be changed in **Keyboard Shortcuts**. Selection commands are also available from the editor context menu when text is selected.

## Storage

By default, notes use extension-wide storage and are available across workspaces in the current VS Code profile. Switch to **project notes** from the More actions menu to keep a separate set for the open workspace; a workspace must be open to use this scope. Project notes use VS Code workspace storage.

Notes remain local to the VS Code profile unless you enable **Sidebar Quick Notes: Sync With Settings Sync** and VS Code Settings Sync. Sync is off by default. When enabled, VS Code may sync global notes between signed-in devices; a newer edit on one device can replace an older version on another. Project notes are not included in this setting.

Deleted notes are retained for the configured number of days (30 by default), up to a maximum of 100 items. Export a JSON backup for a portable copy of your notes.

Pasted and inserted images are stored as files in the extension's local storage on your computer. They are not included in JSON or Markdown exports, are not synced by Settings Sync, and are not deleted when you delete a note. Images linked with `https://` or embedded as base64 are part of the note itself.

## Settings

Open **Settings** and search for `Sidebar Quick Notes`:

| Setting | Default | Description |
| --- | --- | --- |
| `sidebarQuickNotes.autoSaveDelay` | `400` ms | Delay after typing before a note is saved. Range: 100-5000 ms. |
| `sidebarQuickNotes.fontSize` | `13` | Note text size in pixels. Range: 10-24. |
| `sidebarQuickNotes.newNoteTitle` | `untitled` | Start new notes as `Untitled` or with today's date. |
| `sidebarQuickNotes.trashRetentionDays` | `30` | Days deleted notes remain in Trash. Range: 1-365. |
| `sidebarQuickNotes.ai.enabled` | `true` | Enable or disable AI actions. Note text is sent to the selected VS Code language model when you run an action. |
| `sidebarQuickNotes.ai.modelFamily` | empty | Preferred Copilot model family for AI actions. Leave empty to choose from available models. |
AI features include five free generations in each rolling 24-hour period. Usage is tracked locally in your VS Code profile. A valid Polar Pro license unlocks unlimited generations. To activate one, configure the Polar organization and benefit IDs, then run **Quick Notes: Activate Pro License** from the Command Palette and enter your key. The key is stored in VS Code SecretStorage and validated with Polar. Run **Quick Notes: Deactivate Pro License** to remove it.

## Commands

Commands are available from the Command Palette under **Quick Notes**. These include creating, searching, and navigating notes; adding selected editor text; importing or exporting notes; and managing a Polar Pro license.