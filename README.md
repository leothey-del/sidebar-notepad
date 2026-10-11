# Sidebar Notepad

[![Ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/leoort)

---
### ☕ Support My Work
If this extension has saved you time or made your workflow easier, consider [buying me a coffee](https://ko-fi.com/leoort)!

[![GitHub stars](https://img.shields.io/github/stars/leothey-del/sidebar-notepad?style=social)](https://github.com/leothey-del/sidebar-notepad)

If you find this extension helpful, please consider giving the project a ⭐ on GitHub!

Keep notes close to your code in a dedicated VS Code Explorer view. Create and organize notes, capture code selections, paste images, track checklist progress, and find or restore notes without leaving your editor.

## Screenshots

![Sidebar Quick Notes screenshot 1](https://raw.githubusercontent.com/leothey-del/sidebar-notepad/main/images/image3.png)

![Sidebar Quick Notes screenshot 2](https://raw.githubusercontent.com/leothey-del/sidebar-notepad/main/images/image4.png)

Supports Ctrl+C and Ctrl+V — easily copy and paste text in your notes.
![Sidebar Quick Notes screenshot 2](https://raw.githubusercontent.com/leothey-del/sidebar-notepad/main/images/image6.png)

Insert image from file
![Sidebar Quick Notes screenshot 2](https://raw.githubusercontent.com/leothey-del/sidebar-notepad/main/images/image7.png)

## Features

- **Multiple notes:** Create, duplicate, reorder, pin, color-label, and title notes. Pinned notes stay at the top.
- **Automatic saving:** Edits save after a configurable delay. The view remembers the selected note.
- **Search:** Find notes by title or content, with matching text snippets.
- **Markdown preview:** Preview headings, lists, task lists, code blocks, blockquotes, links, images, and common inline formatting. Task checkboxes can be toggled in the preview. Each note remembers whether it was in preview or edit mode, and the eye button is outlined while a preview is showing. This is a lightweight preview, not full CommonMark support.
- **Images:** Paste a copied picture or screenshot straight into a note, or insert an image file from the More actions menu. Images appear in the preview. Markdown image links (`![text](https://...)`) work too.
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
4. Use the eye button to preview Markdown. When the preview is on, the button is outlined; click it again to go back to editing. Open the **More actions** menu for note organization, Trash, import/export, font size, storage scope, and settings.
5. Copy a picture and press `Ctrl+V` (`Cmd+V` on macOS) in a note to add it. The note switches to preview so you can see the image.
6. Select text in a code editor and use the editor context menu to add it to a note or create a note from it.

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
| `sidebarQuickNotes.syncWithSettingsSync` | `false` | Include global notes in VS Code Settings Sync. |

## Commands

Commands are available from the Command Palette under **Quick Notes**. These include creating, searching, and navigating notes; adding selected editor text; and importing or exporting notes.