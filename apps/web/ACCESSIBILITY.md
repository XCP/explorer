# Accessibility status

Automated semantic WCAG checks run in Playwright for the home, asset index, asset detail, address detail,
transaction detail, and block index routes. The suite checks serious and critical axe violations and is part
of the Linux CI browser job.

## Known visual debt

The initial audit on 2026-07-12 found recurring WCAG AA contrast failures across all six representative
routes. The common sources are muted `text-zinc-500` content and the brand/XCP accent colors on dark
backgrounds. Contrast enforcement is temporarily disabled in the automated gate because changing those
tokens is an intentional visual-design decision, not a mechanical accessibility edit.

Before enabling the contrast rule:

1. Choose accessible muted-text and accent tokens in the design lab.
2. Verify normal text, small metadata, buttons, links, badges, and table cells against their actual
   backgrounds.
3. Inspect the resulting hierarchy visually on desktop and mobile.
4. Remove the `color-contrast` exclusion from `tests/e2e/accessibility.spec.ts`.

Automated checks do not replace keyboard, focus-order, screen-reader, reduced-motion, chart-alternative, or
touch-target review. Those remain manual and test-expansion workstreams.
