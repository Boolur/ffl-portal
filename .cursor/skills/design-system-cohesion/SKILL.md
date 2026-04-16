---
name: design-system-cohesion
description: Enforces cohesive frontend component updates using the project's shared tokens, semantic CSS utilities, and existing UI patterns. Use when creating, refactoring, or reviewing React/Next.js components, pages, layouts, and styles to keep visuals and interaction behavior consistent.
---

# Design System Cohesion

## Purpose

Keep all frontend updates visually and behaviorally consistent with the existing design system in this repository.

## Default Source Of Truth

Use these in priority order:

1. `src/app/globals.css` theme variables and semantic classes (`app-*`)
2. Existing component patterns in `src/components/**`
3. Existing page/layout patterns in `src/app/**`

If patterns conflict, prefer the newest and most reused pattern.

## Core Rules

1. Reuse existing tokens and semantic classes before introducing new styles.
2. Keep color, spacing, radius, and typography aligned with current theme variables.
3. Preserve interaction consistency (hover, focus-visible, disabled, destructive states).
4. Preserve accessibility semantics (labels, button types, aria attributes, focus behavior).
5. Minimize one-off visual variants; favor extending existing patterns.

## Component Update Workflow

Copy this checklist when working:

```md
Design Cohesion Checklist
- [ ] Locate existing component/page with similar purpose
- [ ] Reuse existing `app-*` classes and theme variables first
- [ ] Keep spacing, radius, and typography consistent with nearby UI
- [ ] Verify interactive states (hover/focus/disabled/destructive)
- [ ] Verify accessibility semantics and keyboard use
- [ ] Avoid introducing duplicate style patterns
```

### Step 1: Pattern Discovery

- Inspect similar components in `src/components/**` before coding.
- Inspect surrounding layout in `src/app/**` to match page-level rhythm.

### Step 2: Style Decision Order

When styling a component, choose in this order:

1. Existing semantic class in `globals.css` (for example `app-btn-primary`)
2. Existing utility composition pattern from a nearby component
3. New semantic class in `globals.css` only when reuse is likely across screens

### Step 3: Interaction And A11y

Verify:

- Focus-visible styles exist and are clear.
- Disabled affordances match current app behavior.
- Destructive actions use existing danger treatment patterns.
- Interactive elements are proper controls (`button`, `a`, form inputs) with correct attributes.

### Step 4: Consistency Review

Before finishing, compare your update with at least one existing component in the same area and confirm:

- Similar purpose => similar visual treatment
- Different priority => intentionally different treatment
- No accidental drift in spacing, font weight, border, or color contrast

## Allowed Exceptions

Deviate only when one applies:

1. New product requirement needs a clearly new visual language
2. Accessibility improvement requires changing current pattern
3. Performance or technical constraints block reuse

When deviating, add a brief inline code comment explaining why.

## Output Style For Agent Responses

When asked to implement or review a frontend change, respond with:

1. What existing pattern was reused
2. What new style surface (if any) was introduced and why
3. Quick accessibility check notes
4. Any follow-up refactor suggestion to improve cohesion

## Quick Heuristics

- Prefer semantic intent (`app-btn-primary`) over bespoke class strings when both solve the same problem.
- If a style appears in 3+ places, promote it into a shared semantic class.
- Use theme variables for colors rather than hardcoded hex unless matching an existing approved pattern.
