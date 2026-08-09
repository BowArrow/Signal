# design-ref

Reference material pulled from the Claude Design project, not shipped code.

| File | What it is |
| --- | --- |
| `Signal.dc.html` | The design comp for the whole dashboard: 7 screens (queue, opportunities, scoring, guardrails, attribution, digest, system), a dialog and a toast. Written in the `x-dc` template dialect (`sc-for` / `sc-if` / `{{ }}`), with all state logic in the `<script type="text/x-dc">` block at the bottom. Translate to React; do not run it. |
| `nocturne.css` | The Nocturne design-system stylesheet, verbatim. Source of truth for every token and component class. Copy into the app rather than re-deriving values. |

Source project: `claude.ai/design/p/1ac32232-57a3-4208-85af-5ed74b50849d`
Design system: Nocturne, `f3f04b0d-d3f3-4023-922e-3a487f01c859`

## Rules taken from the Nocturne readme

- Take every color, font, space, radius and shadow from a `var(--*)` token. No raw hexes.
- Dark ground `#161826`, one accent `#9184d9` used as a line and a glow, never a flood.
- Primary buttons are an accent outline on transparent, not a solid fill.
- Freestanding rules and table row rules fade to transparent over 48px an end.
- Headings stay at weight 500. Hierarchy is size and space, not boldness.
- Accent-on-ground is tuned to 3:1 — fine for chrome and large text. For
  paragraph-size accent text use `--color-accent-300`.
- Phosphor icons throughout (`ph ph-*`).
- Spacing is deliberately dense (0.7x). Use the `--space-*` scale.

## Comp details worth keeping when porting

- Sidebar collapses to a 58px icon rail under 860px; the queue list stacks
  above the detail pane under 1000px; the score/validator/rules aside moves
  under the draft under 1280px.
- Two non-token status colors appear in the comp and need tokenizing:
  warn `#c9b46a`, block `#d98a8a`.
- Total score in the comp is `contribution*w + intent*w + fit*w - risk*w`,
  clamped at 0. Risk subtracts.
- Status derivation order matters: resolved > source paused > rules_unknown >
  below threshold (expired) > queued. `rules_unknown` beats a high score.
