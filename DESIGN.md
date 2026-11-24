# Earnings Intel — design system

The look of a modern consumer brokerage, adapted for research: a white page, near-black text, one vivid green for gains and one orange-red for losses, huge bold numbers, lots of air, rounded pills and almost no borders. Dark mode is pure black. Inspired by that category, never copied: no other company's name, logo, mascot, typeface or brand assets.

Physical scene: someone checks a stock on a laptop or phone in a lit room, often minutes after a company reports. Light is the default; dark is one tap away and remembered.

## Color

Restrained: neutrals plus two signal colors. Green and orange-red only ever mean up and down (or the app's one action color, which is the same green). Comparison lines and categories never use them.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--background` | `#ffffff` | `#000000` | page |
| `--foreground` | `#0b0c0d` | `#f5f6f6` | text, primary buttons |
| `--muted` | `#5f6467` | `#9ca1a4` | secondary text (≥5:1) |
| `--card` | `#f4f5f5` | `#121314` | quiet surfaces, hovered rows, pill fills |
| `--border` | `rgba(11,12,13,.07)` | `rgba(255,255,255,.08)` | hairlines, only where a surface would be too heavy |
| `--up` | `#00a63e` | `#2bd46b` | gains: chart lines, big numbers, pill fills, the accent |
| `--up-ink` | `#007533` | `#2bd46b` | gains as small text (≥4.5:1) |
| `--down` | `#e8590c` | `#ff6a3d` | losses: same roles as `--up` |
| `--down-ink` | `#b23a0a` | `#ff6a3d` | losses as small text |
| `--accent` | follows the period's direction on a company page (`--up` or `--down`), else `--up` | | links, active tab, focus ring |

Pills: tinted fill (signal at 12% / 18% dark) with ink text. Never gray text on a colored fill.

## Type

One family: **Geist** (variable, self-hosted via `@fontsource-variable/geist`), tabular figures everywhere numbers sit in columns.

| Role | Size / line | Weight | Tracking |
|---|---|---|---|
| Hero price | 44px → 56px (sm+) / 1 | 700 | -0.035em |
| Landing headline | 40px → 64px / 1.02 | 700 | -0.04em |
| Page title (h1) | 28px → 32px / 1.1 | 700 | -0.03em |
| Section (h2) | 22px / 1.2 | 700 | -0.02em |
| One-line answer | 20px → 24px / 1.25 | 600 | -0.015em |
| Body | 15–16px / 1.55 | 400 | 0 |
| Label / meta | 13px / 1.4 | 500 | 0 |

Emphasis comes from weight and size, never color alone. No eyebrows or tracked uppercase labels above headings; small section labels are sentence case, 13px, 600, muted.

## Space and shape

- 4px base. Section gaps 64–96px on the landing, 40–48px between blocks on data pages; more space above a heading than below it.
- Content width 1120px (data pages), 720px for reading (briefs, landing copy).
- Radius: pills `9999px`; surfaces 16px; inputs and the search field are pills.
- Separation by space and `--card` fills, not borders. Tables keep one hairline between rows.
- Depth: one soft shadow for floating layers only (menus, the sticky bar, popovers): `0 8px 30px -12px rgba(0,0,0,.25)`.

## Components

- **Header**: logo left, one large centered pill search, then "This week", "My stocks", More (Screener, Compare, Economy, About, theme), the alerts bell. On phones the search collapses to an icon that opens a full-width field.
- **Price row** (lists): ticker (600) · name (muted) · sparkline · price (tabular) · day's move pill.
- **Company header**: name, ticker, search-this-company field, hero price and day's move; condenses into a 56px sticky bar (ticker, price, move, Watch, Compare, Download) once the hero scrolls away.
- **Tabs**: text tabs with a 2px underline in `--accent` that slides between tabs; views inside a tab are pills.
- **One-line answer**: every tab opens with a sentence in the answer style plus a short muted "why" line, then the detail.
- **Buttons**: primary = foreground fill, background text, pill; secondary = `--card` fill; tertiary = text in `--accent`.

## Charts

- Price line 2px in the period's direction color; no axes or gridlines on the main price chart; a dotted 1px muted line at the previous close (the close before the range starts).
- Comparison lines dashed, neutral palette (never green/orange-red).
- Hover/drag scrubs: a 1px muted vertical rule, the headline price, change and date update live; release returns to the latest.
- Data charts elsewhere: one hairline baseline, muted 12px axis labels, tabular numbers, tooltips on `--background` with the floating shadow.

## Motion

Polish-weighted, never on things people do dozens of times a day (typing, opening menus they use constantly, switching chart ranges).

| Moment | Effect | Duration / easing |
|---|---|---|
| Chart scrub | price/change/date update per frame | instant |
| Row hover | `--card` fill, sparkline stroke thickens | 120ms ease-out |
| Linked card hover | lift 2px | 200ms `cubic-bezier(.23,1,.32,1)` |
| Tab change | underline slides to the new tab | 260ms `cubic-bezier(.23,1,.32,1)` |
| Button press | scale .97 | 120ms |
| Sticky bar | slides down 8px + fades in when the hero leaves | 220ms ease-out |
| Landing sections | rise 8px + fade in once on entering view; lists inside do not stagger | 500ms `cubic-bezier(.16,1,.3,1)` |
| Hero price | counts up once on first load | 700ms ease-out-expo |

Rules: transform and opacity only (60 fps); content is visible by default and only hidden once JavaScript has armed the reveal; hover effects only under `(hover: hover)`; everything off under `prefers-reduced-motion: reduce`.

## Browser surfaces

Selection tinted from `--up`; caret `--foreground`; focus ring 2px `--accent` with 2px offset; link underline offset .2em; thin scrollbars tinted from `--muted`; tabular numerals in every table.
