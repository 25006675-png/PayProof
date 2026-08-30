---
name: PayProof
description: Private order details, public payment certainty.
colors:
  ledger-white: "oklch(1 0 0)"
  cool-paper: "oklch(0.974 0.006 230)"
  paper-strong: "oklch(0.94 0.012 230)"
  ledger-ink: "oklch(0.2 0.025 230)"
  ink-soft: "oklch(0.43 0.025 230)"
  ink-faint: "oklch(0.55 0.02 230)"
  marine-cobalt: "oklch(0.48 0.105 230)"
  marine-deep: "oklch(0.4 0.105 230)"
  marine-pale: "oklch(0.94 0.035 230)"
  coral-signal: "oklch(0.68 0.16 38)"
  verified-green: "oklch(0.46 0.12 155)"
  error-red: "oklch(0.5 0.16 25)"
  rule: "oklch(0.86 0.012 230)"
  rule-strong: "oklch(0.72 0.02 230)"
typography:
  display:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(2.25rem, 4vw, 4.3rem)"
    fontWeight: 760
    lineHeight: 0.95
    letterSpacing: "-0.055em"
  headline:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "2.2rem"
    fontWeight: 650
    lineHeight: 1.08
    letterSpacing: "-0.035em"
  title:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.45rem"
    fontWeight: 580
    lineHeight: 1.2
  body:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.78rem"
    fontWeight: 700
    lineHeight: 1.35
rounded:
  sm: "6px"
  md: "10px"
  lg: "14px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  section: "34px"
components:
  button-primary:
    backgroundColor: "{colors.marine-cobalt}"
    textColor: "{colors.ledger-white}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "0 17px"
    height: "44px"
  button-secondary:
    backgroundColor: "{colors.ledger-white}"
    textColor: "{colors.ledger-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "0 17px"
    height: "44px"
  field:
    backgroundColor: "{colors.ledger-white}"
    textColor: "{colors.ledger-ink}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "12px 13px"
    height: "44px"
  payment-panel:
    backgroundColor: "{colors.cool-paper}"
    textColor: "{colors.ledger-ink}"
    rounded: "{rounded.lg}"
    padding: "30px"
---

# Design System: PayProof

## Overview

**Creative North Star: "The Settled Ledger"**

PayProof should feel like the cleanest page in a well-kept business ledger: quiet, exact, and composed when money changes hands. Strong type hierarchy and ruled structure carry the interface; color is used to establish action and status, never to manufacture excitement. The desktop workspace deliberately joins order entry and settlement, while the mobile version preserves the same reading order in one continuous column.

The system rejects neon crypto dashboards, trading-terminal density, speculative token imagery, generic corporate banking templates, glass-heavy surfaces, and anonymous “Web3” decoration. It is business software first, with blockchain details disclosed only where they establish certainty.

**Key Characteristics:**

- Ledger-like alignment and dividers
- Restrained marine-cobalt action color
- Dense enough for work, spacious enough for review
- Plain-language status and recovery states
- Fluid from 320px mobile to wide desktop

## Colors

The palette pairs white paper and cool ruled neutrals with a single marine-cobalt voice; coral, green, and red are reserved for status.

### Primary

- **Marine Cobalt:** The only sustained action color, used for primary buttons, the brand mark, active navigation, and the verify instruction panel.
- **Marine Deep:** Hover and pressed treatment; never a second decorative band.
- **Marine Pale:** Focus halos and selected low-emphasis controls.

### Secondary

- **Coral Signal:** A compact network/status marker. It must not become a general accent.
- **Verified Green:** Successful proof and completed settlement states only.
- **Error Red:** Validation and chain mismatch states only, always paired with text or an icon.

### Neutral

- **Ledger White:** Default page, input, and primary working surface.
- **Cool Paper:** Settlement panels, muted statuses, and supporting surfaces.
- **Paper Strong:** Selected toggles and disabled surface differentiation.
- **Ledger Ink / Ink Soft / Ink Faint:** Primary, secondary, and tertiary text roles.
- **Rule / Rule Strong:** Dividers, input strokes, and structural boundaries.

**The One Voice Rule.** Marine cobalt is the only broad saturated surface. Status colors remain small and semantic.

**The Paper Rule.** Depth comes from adjacent paper tones and one-pixel rules, not translucent overlays.

## Typography

**Display Font:** Inter (with system sans-serif fallback)

**Body Font:** Inter (with system sans-serif fallback)

**Label/Mono Font:** System monospace is reserved for addresses, hashes, and transaction identifiers.

**Character:** A single disciplined sans-serif keeps order entry practical. Tight display spacing adds identity without turning headings into advertising.

### Hierarchy

- **Display** (760, fluid 2.25–4.3rem, 0.95): One decisive page promise per view.
- **Headline** (650, 2.2rem, 1.08): Success and tool headings.
- **Title** (580, 1.45rem, 1.2): Workspace, form, and panel section titles.
- **Body** (400, 1rem, 1.55): Guidance and explanatory copy, normally held below 70 characters per line.
- **Label** (700, 0.78rem, 1.35): Field labels, network facts, and ledger annotations; sentence case is mandatory.

**The Numbers Stay Still Rule.** Amounts, addresses, hashes, and ledger values never use decorative italics or animated counters.

## Elevation

PayProof is flat by default. Tonal layering, one-pixel borders, and whitespace establish hierarchy. The only floating shadow is a restrained ambient lift (`0 4px 8px oklch(0.2 0.025 230 / 0.08)`) for genuinely lifted transient elements; core cards and panels do not float.

### Shadow Vocabulary

- **Ambient Float:** Used only when an element must visually leave the ledger plane, never on every container.
- **Focus Halo:** A three-pixel marine-pale ring accompanies the stronger focus border and is an interaction state, not elevation.

**The Flat-at-Rest Rule.** If every section casts a shadow, the hierarchy has failed. Restore borders and tonal contrast instead.

## Components

### Buttons

- **Shape:** Compact, gently curved rectangle (6px radius) with a 44px minimum height.
- **Primary:** Marine cobalt with white text and horizontal 17px padding; one primary action per decision region.
- **Hover / Focus:** Marine deep on hover; a visible marine-pale focus halo and no bounce or vertical jump.
- **Secondary / Ghost:** White with a strong rule, or transparent for low-priority navigation. Disabled actions retain readable text and clearly muted fill.

### Chips

- **Style:** Asset selection is a two-choice segmented control on white with a compact circular asset initial.
- **State:** The selected asset uses paper-strong fill plus `aria-checked`; color alone never communicates selection.

### Cards / Containers

- **Corner Style:** Broad working containers use the 14px radius; nested controls use 6–10px.
- **Background:** Ledger white for order work, cool paper for settlement context.
- **Shadow Strategy:** Flat at rest, as defined in Elevation.
- **Border:** One-pixel rule around the joined workspace and verify tool.
- **Internal Padding:** 30–34px desktop, 18–24px mobile.

### Inputs / Fields

- **Style:** White surface, strong one-pixel rule, 6px radius, and labels above controls.
- **Focus:** Stronger marine border plus a three-pixel pale halo; never remove the outline without a replacement.
- **Error / Disabled:** Specific inline message in a live region; read-only USDC amount remains visibly legible.

### Navigation

The sticky white header uses compact sentence-case labels, simple line icons, and a two-pixel active underline. On mobile the brand word and network badge yield space, but both primary destinations and wallet access remain visible.

### Settlement Ledger

Order total, payment asset, balance, endpoints, privacy notice, and signature action form one continuous cool-paper panel. Never separate these facts into unrelated dashboard cards.

## Do's and Don'ts

### Do:

- **Do** keep order entry and settlement visible in one continuous workflow.
- **Do** use the 44px control minimum, visible focus, semantic labels, and live status announcements.
- **Do** pair every color state with explicit language or an icon.
- **Do** let long identifiers wrap safely and test at 320px width and 200% text size.
- **Do** explain whether a transaction is unsigned, submitted, indexing, finalized, or failed.

### Don't:

- **Don't** introduce neon crypto dashboards, trading-terminal density, or speculative token imagery.
- **Don't** copy generic corporate banking templates or scatter the workflow into dashboard card grids.
- **Don't** use glass-heavy surfaces, glassmorphism, blurred panels, or translucent decoration.
- **Don't** add anonymous “Web3” decoration or make users understand blockchain internals before paying.
- **Don't** use gradients, gradient text, excessive pills, floating rounded rectangles, or bounce easing.
- **Don't** publish private customer, line-item, or notes content on-chain; the public layer receives only its hash and essential payment facts.
