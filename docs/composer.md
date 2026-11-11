# The composer

How the message input is built, and the rules that keep it from breaking. Read this before changing
anything under `src/components/chat/composer/`.

## Layers

| Layer | File | Owns |
| --- | --- | --- |
| Input | `editor.tsx` | A native `<textarea>`: caret, selection, IME, dictation, autocorrect, undo, paste. Its text is transparent. |
| Copy | `source.ts` | The highlighted copy drawn under the textarea. It only paints. |
| Keys | `keys.ts` | What each key does, decided in one ordered list. |
| Edits | `edits.ts` | The edits the composer makes itself (newline, indent), as pure functions. |
| Height | `use-autosize.ts` | The box grows with its text up to 320px, then scrolls. |
| State | `composer.tsx`, `use-draft.ts`, `completions.tsx`, `use-attachments.ts` | Text, drafts, the `/` and `@` menu, attachments, sending. |

The textarea stays native on purpose: the phone's keyboard, IME composition and dictation work without
any code of ours. A contenteditable editor would have to rebuild all of that.

## Copy rules

The copy must lay out exactly like the textarea, or the caret drifts away from the text.

- Same box. `BOX` in `editor.tsx` is shared by both: padding, font size (16px on touch, so iOS doesn't
  zoom), line height, wrapping and a stable scrollbar gutter.
- One block per source line, `<div class="md-line">`. An empty line holds a `<br>`. A code block's lines,
  fences included, are wrapped in one `.md-codeblock` with no vertical box model.
- Only paint. Colors, backgrounds, `-webkit-text-stroke` for bold, `text-decoration`, inset shadows. Never
  font weight, size, style, letter spacing, margins, padding or borders that take space.
- Decorations that span a line (a code block's frame, a quote's bar) bleed sideways with a negative margin
  and equal padding, so they widen without moving the text.
- The copy's text is the source. `source.test.ts` checks this line for line for every case.

## Keys

In order, the first that applies wins:

1. Composition (IME) keystrokes are never taken.
2. The completion menu, while open: ↑ ↓ Return Tab Esc.
3. Esc stops a running turn.
4. ↑ at the very start of an empty or recalled input walks back through sent messages; ↓ forward.
5. Tab / Shift+Tab indent or outdent list items and code lines. Anywhere else Tab moves focus.
6. Return.
   - ⌘/Ctrl+Return always sends (desktop).
   - It makes a newline on a touch keyboard, with Shift, when the send key is ⌘Return, and inside a
     code block. Otherwise it sends.
   - A newline continues a list (numbers count up, tasks start open) or a quote, ends them on an empty
     item, keeps a code line's indent, and opens a block with its closing fence after ```` ``` ````.

Edits go through `document.execCommand("insertText")`, so ⌘Z undoes them as one step.

## Verifying

- `npm test` runs `source.test.ts` and `edits.test.ts`.
- In the browser, compare each character's position in the copy with a clone of the textarea, on the
  desktop window and on the phone frame (`/?device`), for headings, emphasis, inline and fenced code
  (closed, unclosed, tilde, nested fences), lists, tasks, quotes, tables, rules, links, escapes, CJK,
  emoji and long wrapping lines. Everything should line up within a pixel and the heights should match.
