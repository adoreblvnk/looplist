# LoopList Project Context

## Status

This document is the sole source of truth for the LoopList hackathon prototype. Implementation, design, testing, and deployment decisions must follow it.

## Summary

LoopList is a Carousell-referenced, agent-native resale marketplace for electronics and running shoes. A seller uploads product photos, Gemini 3.6 Flash creates an evidence-backed listing, and Gemma uses seeded marketplace data to recommend a price. Buyers search in natural language, Gemma ranks matching listings, and an explicitly approved purchase settles through x402 on Base Sepolia testnet.

The prototype demonstrates one complete seller-to-buyer transaction. It does not claim affiliation with Carousell or use Carousell data, APIs, trademarks, or production services.

## Hackathon Positioning

https://luma.com/deepmind-v4ci

LoopList targets:

- Most Creative Gemini Hack through Gemini 3.6 Flash multimodal product inspection.
- Best Use of Gemma through essential comparable search, pricing, and buyer-side ranking.

Core pitch:

> Carousell, but agent-native. Sellers create listings from photos, buyer agents find the right product, and approved purchases settle through x402.

## Goals

- Reduce product listing creation to a photo-first review flow.
- Ground condition claims in visible photo evidence.
- Recommend prices from comparable marketplace records rather than unsupported model guesses.
- Let buyers search with natural-language requirements.
- Require human approval before every payment.
- Complete and verify a real x402 testnet settlement.
- Present the entire flow in a clear two-minute demonstration.

## Non-goals

- Real-money commerce.
- Carousell integration or affiliation.
- External marketplace APIs or backwards compatibility with the previous prototype.
- Authentication or onboarding.
- Buyer-seller chat, offers, shipping, refunds, disputes, reviews, or notifications.
- Mainnet payments.
- Product authenticity guarantees.
- Claims about functionality that cannot be inferred from the supplied photos.
- A production-ready marketplace or financial system.

## Users

### Seller

A fixed demo seller listing used electronics or running shoes. The seller wants to publish quickly while retaining control over the final listing and price.

### Buyer

A fixed demo buyer searching by product requirements, budget, condition, and preferences. The buyer must approve the selected listing and exact payment before settlement.

## Product Scope

### Marketplace

- Carousell-referenced desktop and mobile layout.
- LoopList branding and the `adore` achromatic visual system.
- Seeded sellers, active listings, and sold comparable records.
- Categories limited to electronics and running shoes.
- Searchable marketplace feed.
- Listing detail pages.
- Fixed demo seller and buyer identities without authentication.

### Seller Agent

The seller uploads 3 to 8 photos. Gemini 3.6 Flash produces:

- Product identity.
- Product category.
- Brand, model, and visible attributes.
- Included and visibly missing accessories.
- Visible condition and defects.
- Photo-backed evidence for condition claims.
- Confidence-labelled assumptions for details not directly visible.
- Listing title.
- Listing description.

Gemini may make reasonable assumptions. Assumptions must remain editable and must not be represented as verified facts.

### Comparable Pricing

Gemma uses a server-side search tool over seeded sold-listing data to:

- Find comparable products.
- Rank comparables by product, model, condition, and included accessories.
- Recommend a price range.
- Explain the strongest comparable matches.

The seller chooses the final price. The interface must call it a recommendation, not an accurate or guaranteed market price.

### Publication

The seller reviews and edits the generated listing, then explicitly publishes it. Publication:

- Creates a durable listing ID.
- Stores the seller-approved listing snapshot.
- Adds the listing to the marketplace feed.
- Creates a public listing detail page.
- Does not generate or depend on a cryptographic listing hash.

### Buyer Agent

The buyer enters a natural-language request such as:

> Find a MacBook below 900 USDC with no visible screen damage and acceptable cosmetic wear.

Gemma:

- Searches active seeded and seller-created listings.
- Applies category, price, condition, and attribute constraints.
- Ranks matching listings.
- Explains why the top result fits.
- Surfaces visible defects and confidence-labelled assumptions.
- Never purchases autonomously.

### x402 Purchase

The buyer reviews:

- Selected listing.
- Exact testnet USDC amount.
- Recipient address.
- Visible condition summary.
- Payment network.

The buyer must explicitly approve. LoopList then:

- Requests payment through x402 v2.
- Uses Base Sepolia and test USDC.
- Uses the public x402.org testnet facilitator.
- Settles the exact listing price.
- Records the payment response and transaction reference.
- Marks the listing sold.
- Rejects later purchase attempts for that sold listing.

No server-held buyer private key is required. Payment uses a connected browser wallet.

### Receipt

After settlement, LoopList displays and persists a receipt containing:

- Listing ID and title.
- Buyer and seller demo identities.
- Recipient address.
- Paid test USDC amount.
- Base Sepolia network identifier.
- x402 payment and settlement reference.
- Settlement timestamp.
- Sold status.

The receipt is bound by stored identifiers, not a custom cryptographic listing hash.

## Core Journey

1. Seller opens the marketplace and selects Sell.
2. Seller uploads 3 to 8 photos.
3. Gemini 3.6 Flash generates the editable listing and photo-backed condition evidence.
4. Gemma searches seeded sold comparables and recommends a price.
5. Seller edits and publishes the listing.
6. The listing appears in the marketplace feed and on its detail page.
7. Buyer describes the desired product in natural language.
8. Gemma ranks matching active listings.
9. Buyer reviews the top recommendation and approves the exact purchase.
10. x402 settles the Base Sepolia testnet payment.
11. LoopList marks the listing sold and shows the settlement receipt.

## Required Screens

### Marketplace feed

- Search input.
- Electronics and running-shoe categories.
- Responsive listing grid.
- Product image, title, price, condition, and seller summary.
- Sold state.
- Prominent Sell action.

### Sell flow

- 3 to 8 photo intake.
- Analysis progress.
- Editable product, category, condition, title, description, attributes, and price.
- Photo-backed condition evidence.
- Comparable listings and recommended price range.
- Explicit Publish action.

### Listing detail

- Product gallery.
- Title, price, description, attributes, and seller.
- Visible condition and defects.
- Photo-backed evidence.
- Active or sold state.

### Buyer agent

- Natural-language request input.
- Ranked results.
- Concise fit explanation.
- Visible defects and uncertainty.
- Select-for-purchase action.

### Payment approval

- Listing summary.
- Exact test USDC amount.
- Recipient and Base Sepolia network.
- Connected wallet state.
- Explicit approval action.

### Receipt

- Settlement status.
- Listing and payment identifiers.
- Amount, recipient, network, and timestamp.
- Sold status.

## Visual Direction

- Reproduce Carousell's familiar marketplace information hierarchy and density from supplied references.
- Do not use Carousell branding, logo, copy, proprietary assets, or claim affiliation.
- Apply the `adore` visual language: achromatic palette, paper-white surfaces, graphite rules, sharp geometry, low radius, and restrained shadows.
- Use semantic color only for status, warning, error, selection, and success.
- Preserve clear keyboard focus, labels, touch targets, reduced motion, and WCAG 2.2 AA contrast.
- Support 1440 by 900, 768 by 1024, and 390 by 844 viewports.

## Data Requirements

Seeded marketplace data must include:

- Electronics listings such as laptops, handheld consoles, headphones, phones, and power banks.
- Running-shoe listings spanning several brands, models, sizes, conditions, and prices.
- Active listings for buyer search.
- Sold listings for comparable pricing.
- Product photos that match each record.
- Explicitly fictional demo sellers.

Seed data must be deterministic and clearly separated from live model-generated listings. No scraped Carousell data is required.

## AI Responsibilities

### Gemini 3.6 Flash

- Multimodal inspection of seller photos.
- Structured listing generation.
- Visible defect detection.
- Evidence-to-photo association.
- Confidence-labelled assumptions.

### Gemma through the Gemini API and AI SDK

- Tool-driven comparable search.
- Comparable ranking and price recommendation.
- Buyer-query interpretation.
- Active-listing ranking and fit explanation.

Both models are required live paths. Model failures must be surfaced clearly. Do not silently substitute fixtures or another model.

## Architecture

- Next.js and React hosted on Vercel Production.
- AI SDK with the Google Generative AI provider.
- Vercel Functions for APIs.
- Vercel Workflows for durable analysis, publication, and payment orchestration.
- Private Vercel Blob storage for photos, generated listings, seeded records, workflow results, and receipts.
- Public listing images and records served through controlled application routes.
- x402 v2 with the public x402.org facilitator on Base Sepolia.
- Connected browser wallet for buyer authorization.
- No GCP Functions.

## Credentials and Configuration

Required secrets:

```dotenv
GOOGLE_GENERATIVE_AI_API_KEY=
BLOB_READ_WRITE_TOKEN=
```

Required non-secret configuration:

```dotenv
X402_PAY_TO_ADDRESS=
X402_NETWORK=eip155:84532
```

Vercel project access is required for Production deployment and Workflows. Vercel provisions deployed runtime identity for its managed services. Use the x402 SDK's default public x402.org testnet facilitator, which requires no URL override or API key. The buyer connects a browser wallet and LoopList must never receive or persist its private key.

## Security and Integrity

- Validate image type, size, count, and server-generated object paths.
- Keep Blob objects private unless deliberately served through a controlled route.
- Validate every model response against strict schemas.
- Limit JSON request sizes and reject unsupported content types.
- Require explicit seller publication and buyer payment approval.
- Never expose API keys, wallet secrets, internal model reasoning, or raw environment values.
- Treat sold status as authoritative for the prototype and reject repeat purchases.
- Display that all payments use testnet funds.

## Acceptance Criteria

The prototype is complete when:

- A seller uploads 3 to 8 electronics or running-shoe photos.
- Live Gemini 3.6 Flash returns a valid editable listing with visible condition evidence.
- Live Gemma searches seeded sold comparables and recommends a price.
- Seller edits and publishes the listing.
- The listing appears in the marketplace feed and detail route.
- A buyer enters a natural-language request.
- Live Gemma ranks active listings and explains the top result.
- Buyer approval initiates an actual Base Sepolia x402 testnet settlement.
- A persisted receipt displays the correct listing, amount, recipient, network, and settlement reference.
- The purchased listing becomes sold and cannot be purchased again.
- The complete flow works on desktop and mobile.
- Vercel Production deployment passes build, browser, console, network, accessibility, and responsive checks.

## Demo Script

1. Open the marketplace feed.
2. Sell an electronics item from 3 to 8 photos.
3. Show Gemini's generated listing and visible defect evidence.
4. Show Gemma's sold comparables and price recommendation.
5. Publish and confirm the listing appears in the feed.
6. Switch to the buyer view and enter a natural-language request.
7. Show Gemma ranking the new listing.
8. Approve the x402 testnet payment.
9. Show the sold listing and settlement receipt.
