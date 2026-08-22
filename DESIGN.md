# LoopList Design System

## Theme

A light, paper-white inspection workspace used by a seller under ordinary indoor light. The interface combines Vercel-like precision with the sharp, tactile document treatment in `Documents/adore`: thin rules, low radius, dense evidence, and clear hierarchy. It is not a dashboard shell or an editorial magazine.

The landing page is the brand-oriented entry surface. `/demo` is the default product register and carries the complete workflow.

## Color Palette

Use OKLCH tokens throughout.

- Canvas: `oklch(0.975 0 0)`
- Paper: `oklch(0.995 0 0)`
- Raised paper: `oklch(0.955 0 0)`
- Ink: `oklch(0.16 0 0)`
- Muted ink: `oklch(0.43 0 0)`
- Hairline: `oklch(0.82 0 0)`
- Strong rule: `oklch(0.28 0 0)`
- Success: `oklch(0.53 0.13 150)`
- Warning: `oklch(0.64 0.13 75)`
- Error: `oklch(0.56 0.18 28)`
- Info: `oklch(0.5 0.12 250)`

Ink and paper remain dominant. State colors appear only beside an icon or text label and never carry meaning alone.

## Typography

Use the existing Geist variable family for headings, body, fields, and controls. Use Geist Mono only for run IDs, timestamps, prices, confidence values, and concise operational labels.

- Landing display: 56–88px, weight 650–750, letter spacing no tighter than `-0.04em`
- Page title: 32–44px, weight 650–750
- Section title: 20–24px, weight 650
- Body: 15–17px, line height 1.5–1.65, maximum 70ch
- Controls and labels: 13–15px, weight 550–650
- Mono data: 12–14px

Use sentence case. Avoid repetitive uppercase eyebrows and decorative italics.

## Layout

Landing uses a decisive split composition: product promise and call to action on one side, the seeded Game Boy photography and a compact verified-listing specimen on the other. Follow with one real ordered flow and one trust statement rather than repeated card grids.

The demo uses a document workspace with a 64px top bar and a centered maximum width around 1440px. On desktop, evidence/photos occupy roughly two fifths and the editable listing three fifths. Operational trace is a compact ruled timeline beneath the active work, not a third sidebar. On small screens, sections stack in task order and the approval action remains reachable without covering content.

Use 4px control radius and 8–12px section radius only when grouping is necessary. Prefer rules, whitespace, and paper tone shifts over nested cards or wide shadows.

## Components

### Header

Compact wordmark, current workflow state, live-service indicators, and reset. The landing header links directly to `/demo`.

### Photo intake

A native file input with a large labeled drop target, visible 3–8 photo requirement, individual thumbnails, remove controls, and a seeded-item action. Each seed photo is still uploaded through the live Blob endpoint before analysis.

### Workflow progress

An ordered state rail: Photos, Inspection, Review, Approval, Verified. Current state uses ink fill; completed state uses a checked text label; pending states remain neutral. Loading content uses skeleton rows and a concise live status announcement.

### Evidence sheet

Shows identity, model, confidence, accessories, condition, observed defects, and unresolved seller questions. Defects include visual evidence text. Confidence always includes a numeric value and label.

### Listing editor

Native labeled fields for title, description, category, condition, SGD/USD prices, and item specifics. Character limits are visible where relevant. Seller edits remain local until approval.

### Approval block

A clear unchecked confirmation stating that condition disclosures and prices were reviewed. Publishing is disabled until checked. The eBay-compatible adapter status is named directly near the action.

### Verification receipt

Shows verified status, adapter listing ID, published field snapshot, retrieval check, and repair-skill status. Do not link to a fictional live listing as if it were real eBay.

### Operational trace

A concise ruled list using only Observation, Action, Tool result, Verification, and Skill saved. Never expose hidden model reasoning.

## Motion

Use 150–220ms ease-out transitions for state changes, thumbnail insertion, validation feedback, and result reveal. No decorative page choreography in the product surface. The landing may use one restrained image-sheet reveal. Under `prefers-reduced-motion: reduce`, remove transforms and use instant state changes or a short opacity crossfade.

## Responsive and Accessibility

Use structural breakpoints around 960px and 680px. Preserve source order, keyboard flow, labels, error associations, `aria-live` workflow updates, 44px touch targets where space allows, and visible focus rings. All images require descriptive alt text. Verify at 1440×900, 768×1024, and 390×844.
