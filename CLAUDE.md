@AGENTS.md

# Project conventions

## Design and implementation plan

`plan/SPEC.md` is the build document: the selected designs, exact tokens and geometry, all
data rules, error handling. `plan/plan.html` is the visual reference — open it in a browser
to see the components behave. Each of its sections shows three or four alternatives and
**only the ones marked SELECTED are built**.

`plan/findings.md` is the measured record behind SPEC.md: the captures, the counts, the
worked examples. **SPEC.md states rules and carries no dated per-capture prose** — when a
rule there looks arbitrary, findings.md is where the evidence is. Keep the split when
editing either: measurements go in findings.md, timeless rules go in SPEC.md.

## Never use text glyphs for icons

No arrow, chevron, bullet-as-icon or symbol characters in UI text. Not in labels, not in
buttons, not in error messages, not in placeholder or mock content.

Banned: `→ ← ↑ ↓ ↵ ⇒ » « › ‹ ≫ ◉ ● ▶ ✓ ✕ × ⚠ ⏱ ⚑`

Instead:

- **Every icon is an inline SVG** on a 20×20 viewBox, referenced from the shared sprite,
  rendered `display:block` inside an `align-items:center` flex row. Text glyphs inherit
  font metrics that never match the text beside them, which caused every single alignment
  bug during the design phase.
- **This includes monospace technical strings.** ASCII `->` in a proxy hop or a log line
  inherits the mono font's metrics and sits visibly off centre, so it gets an inline SVG
  too (12 px, `vertical-align:-2px`, `opacity:.75`).
- Need one in prose the user reads? Write the word. Code comments are unaffected.

The only font glyphs allowed anywhere are the **MNR2007 pictograms**, which are MÁV's own
data (`String.fromCharCode(fontCode)`) and cannot be replaced by SVG.

## Never use em-dashes in user-facing strings

No `—` in any warning, error, empty state, tooltip or button label. Use a full stop or a
comma instead.

- Yes: `Route line unavailable. Everything below is still live.`
- No: `Route line unavailable — everything below is still live.`

This applies to strings the user reads. Code comments and Markdown docs are unaffected.

## Relative times are `m:ss`

In warnings, errors and any elapsed or countdown value: `4:08 ago`, `6:12 old`,
`retry in 0:08`, `aborted after 0:12`, `backing off to 2:00`. Fixed configuration intervals
stay plain: `polls every 30 s`.

## Error messages are technical

This app is a personal tool. Error text names the failing hop, the HTTP status and the raw
error. Never "Something went wrong". See `plan/SPEC.md` §10.
