# Sidebar Notepad

Keep notes close to your code in a dedicated VS Code Explorer view. Create and organize notes, capture code selections, track checklist progress, and find or restore notes without leaving your editor.

## Screenshots

![Sidebar Quick Notes screenshot 1](https://raw.githubusercontent.com/leothey-del/sidebar-notepad/main/images/image3.png)

![Sidebar Quick Notes screenshot 2](https://raw.githubusercontent.com/leothey-del/sidebar-notepad/main/images/image4.png)

## Features

- **Multiple notes:** Create, duplicate, reorder, pin, color-label, and title notes. Pinned notes stay at the top.
- **Automatic saving:** Edits save after a configurable delay. The view remembers the selected note and whether Markdown preview was open.
- **Search:** Find notes by title or content, with matching text snippets.
- **Markdown preview:** Preview headings, lists, task lists, code blocks, blockquotes, links, and common inline formatting. Task checkboxes can be toggled in the preview. This is a lightweight preview, not full CommonMark support.
- **Code capture:** Add selected editor text to the current note or create a new note from the selection. Captured snippets include a language-tagged code block and a link to the source file when available.
- **File links:** Attach the active file and line to a note, then jump back to that location from the note.
- **Trash and undo:** Undo a recent deletion, restore notes from Trash, or permanently remove notes. Trash is limited to the newest 100 notes and expires according to the retention setting.
- **Import and export:** Export notes as JSON backup or Markdown. Import a JSON backup by merging notes or replacing the current set.
- **Global or project notes:** Choose extension-wide notes or notes stored with the current workspace.
- **Optional Settings Sync:** Include global notes in VS Code Settings Sync when enabled in the extension settings and VS Code Settings Sync is on.
- **Editor integration:** Use the Command Palette, editor selection context menu, or keyboard shortcuts for common actions.

## Getting Started

1. Open the **Explorer** sidebar and expand **Notes**.
2. Select **+** to create a note. Enter a title and type in the editor; changes save automatically.
3. Use the note selector or previous/next buttons to move between notes.
4. Use the eye button to preview Markdown. Open the **More actions** menu for note organization, Trash, import/export, font size, storage scope, and settings.
5. Select text in a code editor and use the editor context menu to add it to a note or create a note from it.

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

## Settings

Open **Settings** and search for `Sidebar Quick Notes`:

| Setting | Default | Description |
| --- | --- | --- |
| `sidebarQuickNotes.autoSaveDelay` | `400` ms | Delay after typing before a note is saved. Range: 100-5000 ms. |
| `sidebarQuickNotes.fontSize` | `13` | Note text size in pixels. Range: 10-24. |
| `sidebarQuickNotes.newNoteTitle` | `untitled` | Start new notes as `Untitled` or with today's date. |
| `sidebarQuickNotes.trashRetentionDays` | `30` | Days deleted notes remain in Trash. Range: 1-365. |
| `sidebarQuickNotes.syncWithSettingsSync` | `false` | Include global notes in VS Code Settings Sync. |

## Commands

Commands are available from the Command Palette under **Quick Notes**. These include creating, searching, and navigating notes; adding selected editor text; and importing or exporting notes.
