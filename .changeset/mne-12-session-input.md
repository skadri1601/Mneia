---
'@mneia/cli': minor
---

Rebuild the interactive session's input surface.

Typing `/` now opens a menu of every command and each further character narrows it, so the commands
are discoverable without running `/help` first. The arrow keys move the selection, Tab or the right
arrow accepts it, and Escape dismisses the menu. The rest of the selected name is shown as ghost
text after the cursor, which is what makes Tab discoverable in the first place. Enter runs the
selected command outright, or leaves the cursor after it when the command still needs an argument.

History now survives the process. It is appended to `~/.mneia/history` — honouring `MNEIA_HOME` —
and loaded at startup, so the up arrow reaches what was typed in a previous session.

The line editor also gained the emacs bindings the old `readline` prompt had no route to: Ctrl+A,
Ctrl+E, Ctrl+U, Ctrl+K, Ctrl+W, and Ctrl+L to clear the screen without losing the typed line.

The banner's block-glyph mark now renders as the M it was always meant to be, built from full and
half blocks only so it cannot drift between fonts, and the plain-words hint line is gone.
