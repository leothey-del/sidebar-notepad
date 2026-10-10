# Sidebar Quick Notes

Keep quick notes close to your work. Sidebar Quick Notes is a lightweight, multi-page plain-text notepad for Visual Studio Code.

## Screenshots

![Sidebar Quick Notes screenshot 1](https://raw.githubusercontent.com/leothey-del/sidebar-notepad/main/images/image1.png)

![Sidebar Quick Notes screenshot 2](https://raw.githubusercontent.com/leothey-del/sidebar-notepad/main/images/image2.png)

## Features

- **Multiple pages:** Keep separate notes and move between them with previous and next controls.
- **Quick navigation:** Jump directly to a note from the page selector.
- **Custom titles:** Give each page a title; untitled pages are labeled `Untitled`.
- **Automatic saving:** Changes are saved as you type, with no save button required.
- **Remembers your notes:** Notes are restored from VS Code extension storage when the extension is opened again.

.
## Using the notepad

1. Open the Sidebar Quick Notes view in VS Code.
2. Select a page from the dropdown, or use the previous and next buttons to navigate.
3. Use **+** to add a page.
4. Edit the title and note text. Changes save automatically.

The editor stores plain text; Markdown is not rendered inside a note.

## Storage

Notes are stored using VS Code's extension-wide `globalState`, rather than in your project folder. This implementation does not configure cloud or cross-device sync, so notes should be treated as local to your VS Code installation/profile.
