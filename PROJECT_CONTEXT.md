# LoopList Project Context

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

## Demo scope

The two-minute demo begins at item capture. It uses one preconfigured eBay Sandbox seller and server-side OAuth refresh token. There is no application login, onboarding, billing, buyer messaging, real payment, shipping fulfilment, or Carousell integration.

Provide a seeded item, completed fallback run, published fallback listing, and reset action. Never publish without explicit approval. Show operational trace labels only: Observation, Action, Tool result, Verification, and Skill saved.
