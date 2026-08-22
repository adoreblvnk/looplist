# LoopList Project Context

Event: https://luma.com/deepmind-v4ci

## Product

LoopList turns item photos into a verified eBay listing. The first category is used consumer electronics and collectibles. The seller approves condition disclosures and price before publication.

## Core flow

1. Upload 3 to 8 photos.
2. Gemini extracts identity, model, accessories, defects, and confidence.
3. Ask only for unresolved details.
4. Generate structured listing fields and a price suggestion.
5. Pause for explicit seller approval.
6. Publish through the eBay Sandbox Inventory API.
7. Retrieve and verify the listing.
8. Repair validation failures with bounded retries.
9. Save a repair skill only after deterministic checks pass.

## Architecture

- Next.js deployed on Vercel
- AI SDK 7 `WorkflowAgent` with durable Vercel Workflow steps
- Gemini via `@ai-sdk/google`
- Vercel Blob for images and versioned skill artifacts
- eBay Sandbox as the listing source of truth
- Browser local storage only for the workflow ID and disposable UI cache

## Experience and visual direction

- Blend the restrained precision of Vercel with the tactile paper treatment in `/home/adoreblvnk/Documents/adore`.
- Keep the interface achromatic by default: black, white, graphite, and paper-toned neutrals. Use color only when it conveys relevant state, such as confidence, success, warning, failure, or a selected listing attribute.
- Treat white surfaces as a paper palette rather than one flat white. Use subtle shifts between clean white, soft off-white, and muted gray to establish hierarchy without decorative color.
- Preserve Vercel-like clarity through strong typography, disciplined spacing, thin borders, compact controls, and minimal ornament. Borrow `adore`'s sharp geometry, low radius, monochrome hierarchy, and document/canvas contrast without copying its application shell.
- Avoid gradients, decorative glass, excessive cards, oversized rounding, and color used only for branding.
- The minimum public structure is a landing page and a dedicated site/demo page. Add separate pages only when they make the seller journey or demo materially clearer; do not compress every state into one page or add generic dashboard pages.
- The landing page should communicate the product quickly and lead directly into the demo. The demo page should carry the complete photo-to-approved-listing flow and remain the center of the two-minute presentation.

## Delivery boundaries

- Create a private GitHub repository for LoopList.
- Create and link a Vercel project and Vercel Blob store.
- Do not deploy to Vercel Production. Development and verification remain local unless the user later changes this boundary explicitly.
- Test the complete visible flow locally in a real browser. Prioritize `playwright-cli` for browser automation, screenshots, and interaction checks; use other browser tooling only when it materially helps.
- Tear down local test servers and verify no orphaned browser or server processes remain after testing.

## Demo scope

The two-minute demo begins at item capture. It uses one preconfigured eBay Sandbox seller and server-side OAuth refresh token. There is no application login, onboarding, billing, buyer messaging, real payment, shipping fulfilment, or Carousell integration.

Provide a seeded item, completed fallback run, published fallback listing, and reset action. Never publish without explicit approval. Show operational trace labels only: Observation, Action, Tool result, Verification, and Skill saved.
