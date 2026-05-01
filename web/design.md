# Quorum Web — Design Choices

Extracted from the current `web/` source. Style identity: **techno-editorial dark** — pitch-black canvas, hairline borders, single acid-lime accent, no drop shadows.

## Design language

- **Mood:** editorial / terminal hybrid. Serif display italic for the wordmark, monospace for everything functional, sans-serif only for body prose inside cards.
- **Discipline:** hairline 1px borders separate everything; columns are split by `1px` background gaps, not gutters. No drop shadows anywhere — depth comes from background tint shifts (`--bg` → `--bg-1` → `--bg-2`).
- **Single accent rule:** one lime accent (`#d6ff3a`). Used only for state changes (hover, active, voted, "Selected" column) and the count of ideas in flight. A muted variant (`--accent-dim`) marks committed-but-not-active states.
- **Texture:** fixed background combines two soft radial vignettes (top-right lime tint, bottom-left white tint) with a fixed-position SVG fractal-noise grain at `opacity: 0.06`, `mix-blend-mode: overlay`. Adds analog warmth without distracting.

## Color tokens (`:root`)

| Token | Value | Role |
|---|---|---|
| `--bg` | `#0a0a0a` | App canvas |
| `--bg-1` | `#101010` | Card / modal panel |
| `--bg-2` | `#161616` | Card hover, modal head/foot |
| `--line` | `#1f1f1f` | Default hairline |
| `--line-2` | `#2a2a2a` | Stronger hairline (inputs, kbd, buttons) |
| `--ink` | `#ededed` | Primary text |
| `--ink-1` | `#b8b8b8` | Secondary text / body copy |
| `--mute` | `#6a6a6a` | Tertiary / labels |
| `--faint` | `#3a3a3a` | Quaternary / dividers, denominators |
| `--accent` | `#d6ff3a` | Single live accent |
| `--accent-dim` | `#8aa826` | Committed/static accent |
| `--warn` | `#ff6a3d` | Error inline message in footer |

## Typography

Loaded once from Google Fonts in [index.html](index.html):

- **Serif** — `Fraunces` (variable, `opsz 9..144`, `SOFT 0..100`, `WONK 0..1`). Used **only** for the wordmark "Quorum" — italic, weight 300, `font-variation-settings: 'opsz' 144, 'SOFT' 50`. Editorial flourish; never for content.
- **Mono** — `JetBrains Mono` (400/500/700 + italic). The workhorse: column titles, card titles, scores, chips, buttons, modal labels, footer.
- **Sans** — system stack (`-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial`). Reserved for body prose (`.card__brief`) and editable input fields, so user content reads naturally against the otherwise-monospaced UI.

Base size `14px / line-height 1.5`, antialiased, `text-rendering: optimizeLegibility`. Tabular numerals (`font-feature-settings: 'tnum'`) on every numeric value.

## Layout & spacing

- **Grid:** `app` is a single grid `auto 1fr auto` (header / board / foot).
- **Board:** `grid-template-columns: repeat(3, 1fr)` with `gap: 1px` over a `--line` background — the gap *is* the divider.
- **Padding rhythm:** one knob, `--pad: 28px` (`18px` under 600px). Column header uses `22px var(--pad) 18px`, body `18px`, foot `14px var(--pad)`.
- **Columns at <1000px:** collapse to single column; `min-height` constraint dropped.
- **Mobile (<600px):** modal goes full-screen (no border, `100vh`); brand tag and idea-count counter hide.

## Iconography & ornament

- **Brand mark:** the glyph `◤` (top-left filled triangle) in mono, accent-colored, slightly raised (`translateY(2px)`).
- **Column title prefix:**
  - Default columns: `> ` in accent (terminal cue).
  - Selected column: `▮ ` (filled bar) + a 1px lime hairline along the top edge of the column and a faint lime gradient wash at the top of the panel.
- **Card hover:** a 2px lime bar appears on the card's left edge (`::before`).
- **Selected column cards:** that left bar is permanently visible in `--accent-dim`; full lime on hover.
- **Card pulse (anonymous viewers):** three 3px dots cycling opacity/scale on `2.4s ease-in-out infinite`, staggered by 0.3s — replaces the vote button when the user is unauthenticated.
- **Foot live dot:** lime dot with lime glow (`box-shadow: 0 0 8px var(--accent)`), same pulse cadence.

## Motion

All easing uses `cubic-bezier(.2,.7,.2,1)` for "snappy out" feel. Three named keyframes:

- `colIn` — columns fade + 8px upward translate over 600ms, staggered by `--i * 80ms` (set inline per column index).
- `cardIn` — cards fade + 6px upward translate over 500ms, staggered by `--d * 50ms + 200ms` (set inline per card index, after column animation lands).
- `panelIn` — modal panel: 260ms fade + 8px translate + scale `0.99 → 1`. Backdrop uses a separate 180ms `fadeIn`.
- `pulse` — shared by the anonymous-viewer dots and the foot live indicator.

Interactive transitions are 100–180ms `ease`. `:active` on buttons gives a 1px translateY for tactile feedback.

## Components

### Header (`.head`)
Flex row, baseline-aligned brand on the left, mono meta on the right. Subtle white-to-transparent gradient under the bottom border (`linear-gradient(180deg, rgba(255,255,255,0.02), transparent)`). Idea count uses `<em>` re-styled to non-italic bold lime: `<em>04</em> ideas in flight` (zero-padded to two digits).

### Auth widget (`.auth`)
- **Signed in:** 22px circular avatar (`border: 1px solid var(--line-2)`), `@login` in mono, role pill (`viewer · vote` muted, or `editor` lime with tinted background `rgba(214,255,58,0.06)`), `sign out` ghost button.
- **Signed out:** lime CTA `sign in with github` — black ink on lime, weight 600, lowercase, with an inline GitHub mark (`<svg>` Octocat path).

### Board column (`.col`)
Header has a numbered prefix `01`, `02`, `03` in `--faint`, the title in mono uppercase with the `> ` accent prefix, and a count pill on the right (`border-radius: 999px`, hairline border). A lowercase mono `col__hint` sits beneath.

Body min-height `60vh` (drops to `auto` on mobile), `overflow-y: auto`, gap `14px`. Empty-state shows `— empty —` in `--faint` mono.

### Card (`.card`)
- Background `--bg-1`, hairline border, padding `18px 18px 16px`.
- Top row: name (mono 14px / 600) + score block (`22px` lime number + `11px` faint `/10` denominator).
- Brief in sans 13px `--ink-1`, line-height 1.55.
- Meta row separated by a `1px dashed var(--line)` divider, holds an `est ~Xh` chip and either a vote button (auth) or the pulse dots (anon).
- Static variant `card--static` (used for non-editor viewers) drops cursor + hover affordances entirely — no border change, no left bar.

### Vote button (`.vote`)
Three states: idle, hover, on. `vote--on` swaps to a tinted-lime background (`rgba(214,255,58,0.10)`) with a lime border and lime icon/label. Custom inline SVG thumbs-up (`24×24` viewBox, rendered at 13px), filled when voted, outlined when not — both stroke and fill use `currentColor` so the active state is one color swap.

### Modal (`.modal`)
- Backdrop: `rgba(0,0,0,0.72)` + 6px `backdrop-filter: blur`.
- Panel: `min(720px, 100%)`, `max-height: 88vh`, hairline border, three regions: `head` (uid, close button), `body` (scrollable, gap 18px), `foot` (hint + actions).
- Read-only triple row (`stage / score / estimate`) is itself a 3-column grid with 1px gaps over `--line` — the gap-as-divider trick reused.
- Inputs: `field__input` with hairline border, `transition: border-color 150ms`, focus ring is just the border switching to lime (no outline). Display variant uses mono 16px / 600 for the title field; long variant has `min-height: 180px`.
- Hint text reminds editors that `score, estimate & stage are agent-controlled` and that `esc to close`.

### Buttons (`.btn`)
Two variants:
- `btn--ghost` — transparent, hairline border, mono uppercase 11px, `letter-spacing: 0.06em`. Hover bumps border to `--ink-1` and ink to `--ink`.
- `btn--primary` — lime fill, black ink, weight 600. Disabled state collapses to a faint hairline (no fill, faint text), `cursor: not-allowed`.

### Keyboard hint (`.kbd`)
Small inline pill (min 22px wide / 22px tall, 4px radius) with hairline border for displaying shortcut keys in the header meta zone.

## Accessibility & semantics

- `aria-label` on cards (`Open <name>`) and score (`score X of 10`).
- Vote button uses `aria-pressed` and a label that flips between `Upvote` and `Remove vote`.
- All decorative SVGs marked `aria-hidden="true"`.
- Modal closes on Escape and on backdrop click; inner panel `stopPropagation`s.
- Focus-visible: `outline: 1px solid var(--accent); outline-offset: 2px` on cards.

## Behavior choices that drive UI

- **Optimistic updates** for both `patchIdea` and `voteIdea` with rollback on failure — UI never waits on the network. Errors surface inline in the footer in `--warn`.
- **Stage-based grouping** is computed in `App.jsx` from `idea.stage`; cards inside each column are sorted by `score` descending. Stage taxonomy is fixed: `bucket | candidates | selected` (see [FRONTEND.md](FRONTEND.md)).
- **Role-gated affordances:** anonymous users see static cards + pulse dots; authed non-editors see vote buttons; editors additionally get clickable cards opening the modal. There is no in-DOM affordance the user can't use.
- **Mock mode:** when running against `public/mock.json`, the auth widget is hidden entirely and the foot reads `mock data` instead of `live`.
