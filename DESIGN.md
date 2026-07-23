---
name: HDB Kaki
description: An honest broadsheet for Singapore's HDB resale market — warm paper, serif headlines, monospaced figures, one editorial red.
colors:
  paper: "#f6f2ea"
  paper-raised: "#fffdf8"
  paper-table: "#faf6ee"
  ink: "#181410"
  ink-2: "#5b544a"
  ink-3: "#8c8479"
  line: "#e4ddd0"
  red: "#fe012b"
  red-ink: "#c9001f"
  red-wash: "#fdeef0"
  good: "#1f7a4d"
  good-wash: "#e6f2ea"
  flat-wash: "#efeadf"
  chart-teal: "#2f9e8f"
  chart-amber: "#d98a2b"
  chart-blue: "#3b6ea5"
  chart-green: "#1f7a4d"
typography:
  display:
    fontFamily: "var(--font-newsreader), Georgia, serif"
    fontSize: "clamp(38px, 6vw, 64px)"
    fontWeight: 600
    lineHeight: 1.02
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "var(--font-newsreader), Georgia, serif"
    fontSize: "27px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  title:
    fontFamily: "var(--font-newsreader), Georgia, serif"
    fontSize: "18px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "normal"
  body:
    fontFamily: "var(--font-sans), sans-serif"
    fontSize: "16.5px"
    fontWeight: 400
    lineHeight: 1.7
    letterSpacing: "normal"
  label:
    fontFamily: "var(--font-sans), sans-serif"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0.05em"
  eyebrow:
    fontFamily: "var(--font-sans), sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0.14em"
  mono:
    fontFamily: "var(--font-mono), monospace"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "normal"
    fontFeature: "'tnum' 1"
  brand:
    fontFamily: "var(--font-brand), sans-serif"
    fontSize: "22px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "0"
rounded:
  chip: "8px"
  input: "10px"
  control: "11px"
  card: "14px"
  pill: "999px"
spacing:
  xs: "8px"
  sm: "14px"
  md: "18px"
  lg: "28px"
  section: "40px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "#ffffff"
    rounded: "{rounded.input}"
    padding: "13px 24px"
  button-primary-hover:
    backgroundColor: "{colors.red}"
    textColor: "#ffffff"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "9px"
    padding: "12px 20px"
  chip:
    backgroundColor: "transparent"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.chip}"
    padding: "8px 15px"
  chip-on:
    backgroundColor: "{colors.ink}"
    textColor: "#ffffff"
  card:
    backgroundColor: "{colors.paper-raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: "22px 24px"
  field-select:
    backgroundColor: "{colors.paper-raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0 8px 0 14px"
  pill-up:
    backgroundColor: "{colors.good-wash}"
    textColor: "{colors.good}"
    rounded: "{rounded.pill}"
    padding: "3px 9px"
  pill-down:
    backgroundColor: "{colors.red-wash}"
    textColor: "{colors.red-ink}"
    rounded: "{rounded.pill}"
    padding: "3px 9px"
  eyebrow:
    backgroundColor: "{colors.red-wash}"
    textColor: "{colors.red-ink}"
    rounded: "{rounded.pill}"
    padding: "6px 12px"
---

# Design System: HDB Kaki

## Overview

**Creative North Star: "The Honest Broadsheet"**

HDB Kaki reads like a quality newspaper's property desk rebuilt for the browser: the authority and literacy of print applied to live public data. The surface is warm off-white paper (#f6f2ea), never clinical white. Headlines are set in a serif (Newsreader) with the key word dropped into red italic, the way a broadsheet italicizes the phrase that matters. Every figure — prices, PSF, counts, dates — is set in a monospaced face (IBM Plex Mono) with tabular numerals, so columns of numbers align like a market table and never jitter as they update. The tone is trustworthy, unhurried, and quietly confident. It explains without hyping, and it looks like it has nothing to hide.

Density is calm rather than dense. Content sits in a single centered 1160px column, broken into numbered sections like chapters in a report. Cards are flat cream panels with a hairline border and one very soft, long shadow, as if resting on a desk under even light. There is exactly one loud color — a vivid editorial red (#fe012b) — and it is spent sparingly: an emphasized word, a link, an active control, a negative delta, the dot beside a section eyebrow, a faint red glow under the logo. Its scarcity is the entire point; if red is everywhere, nothing is urgent.

The aesthetic deliberately rejects the two default looks of its category: the cold blue "SaaS dashboard" (Inter on white, glassy cards, saturated gradients) and the aggressive property-portal look (stock photography, banner reds, hard-sell CTAs). This is neither. It is paper, ink, a single red, and honest numbers.

**Key Characteristics:**
- Warm paper canvas (#f6f2ea) with a barely-there red radial wash, never plain white.
- Newsreader serif headlines with a single red-italic emphasis word.
- Monospaced tabular figures everywhere numbers appear.
- One editorial red, rationed; near-black ink carries the weight.
- Flat cream cards, hairline borders, one soft long shadow.
- Editorial structure: numbered sections, generous rhythm, calm density.

## Colors

A warm paper-and-ink palette carrying one vivid editorial red, plus a restrained functional set for market direction and charts.

### Primary
- **Editorial Red** (#fe012b): The single loud voice. Used for the emphasized word in a headline (as red italic), the section-eyebrow dot, primary-button hover, negative/down deltas, and the soft drop-shadow glow beneath the brand logo. Never a large flat fill.
- **Red Ink** (#c9001f): The darker, legible sibling of the red for text-weight uses — links in prose (with a hairline underline), the mono section number in the gutter, hover states on nav links, active nav labels' accent. Chosen over pure red wherever contrast on paper matters.

### Secondary
- **Signal Green** (#1f7a4d) with wash (#e6f2ea): Positive market direction only — up-deltas and gain pills. Never decorative.

### Neutral
- **Ink** (#181410): Primary text, primary-button fill, chip "on" fill, tooltip/popover background. A warm near-black, not pure #000.
- **Ink 2** (#5b544a): Secondary text — ledes, body copy, deck/hint lines, muted numeric cells.
- **Ink 3** (#8c8479): Tertiary text — captions, axis labels, footer, table meta, timestamps.
- **Paper** (#f6f2ea): The page canvas. Warm cream.
- **Paper Raised** (#fffdf8): Cards, controls, chipsets, selects, tooltips-on-light — a half-shade brighter than the page so panels lift optically without a shadow doing all the work.
- **Paper Table** (#faf6ee): Table header fill and row-hover — a warm tint distinct from both page and card.
- **Line** (#e4ddd0): All hairline borders and dividers. One warm neutral rule everywhere.

### Washes
- **Red Wash** (#fdeef0): Eyebrow pill background, down-pill background, error tint.
- **Flat Wash** (#efeadf): The neutral "flat / no change" pill background.

### Chart palette (categorical, in order)
Red (#fe012b) → Ink (#181410) → **Teal** (#2f9e8f) → **Amber** (#d98a2b) → **Blue** (#3b6ea5) → **Green** (#1f7a4d). The first two series lean on the brand duo; the muted teal/amber/blue/green extend the set without ever competing with the signal red.

### Named Rules
**The One Red Rule.** The editorial red (and its Red Ink sibling) appears on a small fraction of any screen — an emphasized word, a link, an active control, a down-delta, the logo glow. If you are reaching for red as a background fill or to decorate a section, stop; near-black ink is the workhorse and red is the exception that earns attention.

**The Warm-Not-White Rule.** No surface is pure white (#fff) and no text is pure black (#000). Backgrounds are paper (#f6f2ea / #fffdf8), text is ink (#181410). The warmth is the brand.

## Typography

**Display / Headline Font:** Newsreader (with Georgia, serif) — weight 600, normal and italic.
**Body / UI Font:** Public Sans (with sans-serif) — weights 400/500/600/700.
**Figure / Label Font:** IBM Plex Mono (with monospace) — weights 400/500/600, tabular numerals on.
**Brand Font:** Quicksand Bold (with sans-serif) — the "hdb kaki" wordmark and nav brand only.

Fonts are self-hosted and subset via Astro's Fonts API under hashed @font-face names, so they are reachable **only** through the `var(--font-*)` custom properties. Any canvas context (ECharts) must read the computed value of the variable into a plain string; it cannot resolve `var()`.

**Character:** A broadsheet pairing. Newsreader gives headlines editorial gravity and lets a single italic word carry emotion; Public Sans keeps running UI and body copy clean and neutral; IBM Plex Mono turns every price and statistic into aligned, table-grade data. The three voices never blur — serif for statements, sans for interface, mono for numbers.

### Hierarchy
- **Display** (Newsreader 600, clamp(38–64px), line-height 1.02, letter-spacing -0.025em): Page hero titles (`h1.title`). The emphasized word is `<em>` in red italic.
- **Headline** (Newsreader 600, 27px, letter-spacing -0.02em): Section headings (`.sec-head h2`), prose page section titles (24px).
- **Title** (Newsreader 600, 18px): Chart-card titles; the large benchmark stat value (`.bench .bv`, 34px) also uses Newsreader.
- **Body** (Public Sans 400, 16.5px, line-height 1.7, max 68ch): Long-form prose (about / privacy / terms). Interface ledes run 18px in Ink 2, capped ~52ch.
- **Label** (Public Sans 600, 11px, letter-spacing 0.05em, uppercase): Field-select labels, table column headers.
- **Eyebrow** (Public Sans 600, 12px, letter-spacing 0.14em, uppercase, Red Ink on red wash): The section/kicker pill with a leading red dot.
- **Mono** (IBM Plex Mono 500/600, tabular): Every figure — prices, PSF, counts, dates, axis labels, the gutter section number, timestamps.

### Named Rules
**The Mono-For-Numbers Rule.** Any quantity a reader might compare or scan — price, PSF, count, percentage, date — is set in IBM Plex Mono with `font-feature-settings: 'tnum' 1`. Prose and labels are sans; numbers are mono. This keeps figures aligned and unmistakable.

**The One-Word-In-Red Rule.** A hero headline emphasizes exactly one word (or short phrase) by setting it as red italic `<em>`. "How's the resale market *moving*?" Never emphasize a whole clause; the single italic word is the editorial gesture.

## Layout

A single centered column: `.wrap` is `max-width: 1160px` with 28px side padding, `margin: 0 auto`. Everything — nav, hero, sections, footer — aligns to this measure. Long-form prose narrows further to a 68ch `.prose` measure inside the same wrap, so reading length stays comfortable while still aligning to the hero's left edge.

The page is organized as numbered editorial sections: `.sec-head` is a two-column grid (a mono section number in a narrow gutter, the heading and its deck/hint stacked in the second column), giving the site a report-chapter rhythm. Vertical rhythm keys off a small scale — 8 / 14 / 18 / 28px, with ~40px between major sections. The hero pads 52px top.

Comparative content sits in a `.split` grid (equal-stretch columns, 18px gap) that collapses to a single column at ≤900px; every grid child sets `min-width: 0` so ECharts canvases can shrink rather than force overflow. KPI strips are a 4-up grid that becomes 2-up on mobile. Benchmark tiles are 3-up collapsing to 1-up. The primary breakpoints are **900px** (nav collapses to a hamburger drawer, splits and benchmark grids stack, section hints hide) and **560px** (opt-in data tables reflow from horizontal-scroll to stacked cards; tooltips re-anchor and clamp to the viewport).

## Elevation & Depth

Flat by default, with a single soft lift. Surfaces are flat cream panels distinguished from the page by tone (`paper-raised` #fffdf8 vs `paper` #f6f2ea) and a hairline border (#e4ddd0) first; shadow is secondary and always soft. There are no hard drop shadows, no glassmorphism beyond the nav's subtle backdrop blur, and no stacked elevation tiers. The overall impression is objects resting on paper under even, ambient light.

### Shadow Vocabulary
- **Rest shadow** (`box-shadow: 0 1px 2px rgba(24,20,16,0.04), 0 12px 30px -18px rgba(24,20,16,0.35)`): The standard card/control shadow — a crisp 1px contact edge plus a wide, deep-offset ambient shadow. Warm-tinted (ink-based rgba), never neutral gray-black.
- **Large lift** (`box-shadow: 0 2px 4px rgba(24,20,16,0.05), 0 40px 80px -40px rgba(24,20,16,0.4)`): Reserved for the most prominent raised surface; same recipe, longer throw.
- **Logo glow** (`filter: drop-shadow(0 6px 16px rgba(254,1,43,0.4))`): The one colored shadow in the system — a red glow under the brand icon only.

### Named Rules
**The Border-First Rule.** A panel is defined by its hairline #e4ddd0 border and its raised paper tone before any shadow. Shadows are soft ambient depth, not the primary separator; never reach for a heavier shadow to make a card "pop."

## Shapes

Gently rounded, consistent, and calm. Radii step up by role: chips 8px, inputs 10px, control shells (chipsets, selects) 11px, cards 14px (`--radius`), and fully rounded 999px for pills and the eyebrow. Nothing is sharp-cornered and nothing is heavily pill-shaped except genuine status pills and tags. Borders are always the single 1px #e4ddd0 hairline. The recurring silhouette is a soft-cornered cream rectangle with a hairline edge — the "card" — reused for KPIs, charts, tables, controls, and forms so the whole system feels cut from one paper stock.

## Components

### Buttons
- **Shape:** Gently rounded (primary 10px, ghost 9px). Inline-flex with an 8–9px gap for an optional icon.
- **Primary (`.cta`):** Ink fill (#181410), white text, Public Sans 600, 15px, padding 13px/24px. **Hover:** background shifts to Editorial Red (#fe012b) and the button lifts `translateY(-1px)`; a trailing arrow slides `translateX(3px)`. This ink→red hover is a signature moment — the one place red fills a surface, and only on intent.
- **Ghost (`.ghost`):** Transparent fill, 1px line border, Ink text, 600/14px. **Hover:** border darkens from #e4ddd0 to Ink. Used for secondary actions and, compacted (`.pager .pg`, 7px/13px), for table pagers; disabled pagers drop to 0.4 opacity.

### Chips (segmented control)
- **Shell (`.chipset`):** Raised paper, 1px line border, 11px radius, 4px inner padding, rest shadow — a segmented track.
- **Chip:** Transparent, Ink 2 text, 600/13.5px, 8px radius. **On (`.chip.on`):** Ink fill, white text. A single active segment; selection is shown by the ink fill, not by red.

### Cards / Containers
- **Corner:** 14px (`--radius`). **Background:** Paper Raised (#fffdf8). **Border:** 1px #e4ddd0. **Shadow:** rest shadow (see Elevation). **Padding:** ~22–24px (chart cards 22px 24px 18px; benchmark tiles 20px 22px). One card recipe serves KPIs, charts, tables, controls, and forms.

### Inputs / Fields
- **Field-select (`.field-select`):** A raised-paper shell (1px border, 11px radius, rest shadow) wrapping an uppercase Label (Ink 3, 11px, 0.05em) and a borderless native `<select>` (Public Sans 500, 13.5px, Ink). **Focus:** the select shows a 2px Ink `focus-visible` outline offset 3px (the shell hides the native ring, so the ring is restored explicitly).
- **Text input (`.big`, postal code):** Large numeric entry on paper; helper "cue" sublabel in Ink 3 beneath.

### Pills (deltas & status)
- Fully rounded (999px), 600/12.5px, 3px/9px. **Up:** Signal Green on green wash. **Down:** Red Ink on red wash. **Flat:** Ink 2 on flat wash (#efeadf). Direction is color-coded but always paired with an arrow/value, never color alone.

### Tables
- Full-width, collapsed borders, 14px. **Header:** uppercase 11px Ink 3 labels (0.06em) on Paper Table (#faf6ee) fill with a hairline bottom rule. **Cells:** 13px/16px padding, hairline row dividers, last row borderless; **row hover** tints to Paper Table. Prices use mono 600; other figures use mono in Ink 2. On phones (≤560px) an opt-in `.stack` table reflows to stacked cards: address + price on the first line, the rest as a dotted muted meta strip.

### Navigation
- **Style:** Sticky top bar, 66px tall, hairline bottom border, translucent paper background with 8px backdrop blur. **Brand:** Quicksand 700, 22px, ink, with the red-glow logo icon. **Links:** Public Sans, 14.5px, Ink 2; **active** is Ink + 600 weight; **hover** shifts to Red Ink. **Mobile (≤900px):** collapses to a three-bar hamburger that animates to an X and opens a full-width drawer of stacked, ruled links.

### Info tooltip / term (signature)
- A small filled circular "i" chip (`.info`, 18px, tonal ink-on-paper) and dotted-underlined inline terms (`.term`) both reveal the same dark popover (Ink background, Paper text, 10px radius, rest shadow, tooltip arrow). Hover-reveal is gated to real pointer devices above 561px; touch drives an explicit tap-toggle, and popovers re-anchor and clamp to the viewport edge on phones. A near-invisible 44px tap target is centered on the 18px chip for comfortable touch. This glossary affordance is core to the product's "explain honestly" voice.

### Charts (ECharts, signature)
- Transparent background over paper; brand fonts read from CSS variables into canvas strings; muted axes (labels in mono Ink 3 / 11px, split lines and axis lines in #e4ddd0). Tooltips are light (Paper Raised #fffdf8, 1px line border, 10px radius, the rest-shadow via `extraCssText`). The categorical palette leads with red then ink. Hero charts are server-rendered to inline SVG for instant paint, then swapped for the interactive canvas after hydration.

## Do's and Don'ts

### Do:
- **Do** keep every surface on warm paper (#f6f2ea page, #fffdf8 raised) and every text color in the ink ramp (#181410 / #5b544a / #8c8479). Never #fff or #000.
- **Do** set all figures — prices, PSF, counts, percentages, dates, axis labels — in IBM Plex Mono with tabular numerals.
- **Do** emphasize exactly one word per hero headline as red italic `<em>` in Newsreader.
- **Do** define panels with the hairline #e4ddd0 border and raised paper tone first, then the soft rest shadow.
- **Do** use the ink→red hover on the primary button; it is the one intentional place red fills a surface.
- **Do** show market direction with the green/red/flat pill set, always pairing color with an arrow or value.
- **Do** honor reduced-motion (the `.rise` entrance animation disables itself) and restore visible focus rings when a native control's ring is hidden.

### Don't:
- **Don't** spend red as a background fill, banner, or decoration. It is a scarce signal (emphasis, links, active state, down-deltas, logo glow) — the One Red Rule.
- **Don't** introduce pure white cards, cold blue "SaaS dashboard" gradients, or property-portal stock photography; they are the confirmed anti-references.
- **Don't** reach for a heavier or darker shadow to make something pop; depth is border-first and softly ambient.
- **Don't** set numbers in a proportional sans or headings in the body sans — serif states, sans interfaces, mono counts.
- **Don't** reference a literal @font-face family name; fonts resolve only through `var(--font-*)`, and canvas contexts must read the computed variable.
- **Don't** let a `.split` chart column force horizontal overflow; grid children carry `min-width: 0` so canvases can shrink.
