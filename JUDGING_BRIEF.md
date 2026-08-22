# LoopList Judging Brief

## Position

LoopList already has a Day 2-worthy prototype:

> Seller photos → Gemini evidence-backed listing → Gemma pricing → publication → Gemma buyer ranking → human-approved x402 payment → receipt and sold state.

The remaining opportunity is not adding marketplace features. It is making the use of Gemini and Gemma feel deliberate, optimized, and difficult to replace with generic API calls.

The relevant tracks are:

- **Most Creative Gemini Hack:** make Gemini Flash fast, visible, and memorable.
- **Best Use of Gemma:** show why an open model is essential to the product.

Source: [Build with Gemini Hackathon 2026](https://luma.com/deepmind-v4ci)

## Day 1: What to present

### Core pitch

> **Gemini sees. Gemma matches. The human decides.**

> LoopList turns seller photos into evidence-backed marketplace listings. Gemini 3.7 Flash identifies the product, visible condition, and defects. Gemma grounds pricing in sold comparables and ranks active listings for a buyer's natural-language request. The agent prepares checkout, but only the buyer can approve the exact x402 payment.

### What judges should understand

- The complete seller-to-buyer transaction already works.
- Gemini and Gemma have separate, intentional responsibilities.
- Model claims are grounded in photos or retrieved marketplace records.
- Sellers approve listings and buyers approve payments.
- Demo identities, inventory, and payments are deliberately seeded or testnet-based.
- Production completeness is not the goal; one polished vertical slice is.

### Day 1 close

> By tomorrow, we are not trying to build more marketplace surface area. We are strengthening the two intelligence layers: an evidence-first Gemini skill for sellers and Southeast Asian resale intelligence for Gemma buyers.

## Day 2: What should improve

The existing transaction flow remains the final demo. Day 2 work should add one clear optimization for each target track and evidence that the optimization matters.

### Gemini: LoopList Evidence-First Listing Skill

Create a versioned Gemini behavior layer called the **LoopList Evidence-First Listing Skill**.

This is not custom model weights. It is a reusable skill made from:

- Product-category inspection instructions.
- Strict listing and evidence schemas.
- Photo-ID binding for every visible-condition claim.
- A rule separating visible facts from editable assumptions.
- Category-specific checks for electronics, running shoes, and sneakers.
- Seller-safe language that avoids authenticity or functionality claims.
- A small evaluation set covering correct evidence, unsupported claims, and category accuracy.

The memorable Gemini moment should be visible:

1. Gemini identifies a condition detail or defect.
2. LoopList highlights the source photo supporting it.
3. Unsupported information appears separately as an assumption.
4. The seller edits and approves the final listing.

If time permits, expose progress such as “identifying product,” “checking condition,” and “binding evidence.” Do not claim token streaming or a custom-trained model unless it is genuinely implemented.

### Gemma: SERA-1 regional RAG lexicon

Create a LoopList-owned retrieval asset called:

> **SERA-1 — Southeast Asian Recommerce Lexicon v1**

SERA-1 is a curated lexicon, not a pretrained dataset and not fine-tuning. Each entry should contain the phrase, normalized meaning, intent, locale, and ambiguity notes.

Initial groups:

- **Buying and selling:** `WTS`, `WTB`, `deal today`, `fast deal`, `reserved`.
- **Negotiation:** `nego`, `can nego`, `nett`, `firm`, `fixed`, `best price`, `last price`, `lowball`.
- **Condition:** `BNIB`, `BNWT`, `LNIB`, `mint`, `tip-top`, `preloved`, `lightly used`.
- **Fulfilment:** `meetup`, `MRT meetup`, `self-collect`, `COD`, `postage`, `courier`.
- **Completeness:** `full set`, `complete set`, `unit only`, `no box`, `with receipt`.
- **Regional language:** `ori` for original/authentic in some Malaysian and Indonesian contexts, and `RFS` for reason for sale in some Philippine listings.

Locale and ambiguity must be preserved. For example, `ori` should not become an authenticity guarantee; it is only interpreted as the seller's language.

Gemma RAG should retrieve from four grounded sources:

1. Active listings.
2. Sold comparables.
3. Photo-backed condition evidence.
4. SERA-1 lexicon entries relevant to the query.

Example evaluation query:

> Find a BNIB or like-new MacBook under 900 USDC, no visible screen damage, can nego, and meetup near an MRT. I can deal today.

The output should show the normalized constraints, retrieved lexicon meanings, ranked candidates, evidence, uncertainty, and strongest-match explanation.

Gemma currently runs through Google's API. Local Gemma QAT inference is a strong future or stretch demonstration, but it must be described as future work unless it runs live and has measured latency and memory usage.

## What judges should see by final judging

- The original end-to-end vertical slice still works without regressions.
- One visible Gemini evidence moment occurs early in the demo.
- Gemma understands at least one SERA-1 term through retrieval.
- The presenter can show why the optimized result is better than generic keyword search.
- Working, seeded, testnet, and future behavior are labelled accurately.
- Tests, production build, model calls, wallet balances, and fallback media are checked.

Authentication, shipping, disputes, production payments, messaging, and a complete marketplace growth strategy are not required.

## Two-minute final demo

- **0:00–0:10:** Explain the manual seller and noisy buyer problem.
- **0:10–0:42:** Upload photos; show Gemini's listing and source-photo evidence.
- **0:42–0:58:** Show assumptions, Gemma comparables, and seller approval.
- **0:58–1:10:** Publish the listing into the marketplace.
- **1:10–1:32:** Search using a SERA-1 phrase; show Gemma's grounded interpretation and top match.
- **1:32–1:52:** Review and approve the exact wallet request.
- **1:52–2:00:** Show the receipt, BaseScan transaction, and sold state. Close with “Gemini sees. Gemma matches. The human decides.”

## Questions to prepare for

### Why Gemini and Gemma?

Gemini 3.7 Flash is the fast multimodal seller-side perception layer. Gemma is the market-intelligence layer for grounded pricing and private, locally adaptable buyer reasoning.

### What is custom?

The Gemini model is not fine-tuned; LoopList adds the Evidence-First Listing Skill, schemas, evidence rules, and evaluations. Gemma gains marketplace RAG and the SERA-1 lexicon. Only claim local inference or fine-tuning if demonstrated.

### How are hallucinations controlled?

Visible claims cite photos, uncertain details remain assumptions, outputs pass strict schemas, marketplace facts come from retrieval, sellers approve publication, and buyers approve payment.

### Why x402?

x402 makes the exact recipient, amount, asset, and network machine-readable while keeping the private key in the wallet and payment authority with the human.

### What becomes production work?

Authentication, moderation, fraud controls, shipping and disputes, scalable retrieval, model-quality monitoring, reconciliation, and jurisdiction-appropriate payment rails.

## Priority

1. Keep the existing vertical slice stable.
2. Target **Most Creative Gemini Hack** first with the Evidence-First Listing Skill and a visible photo-grounding moment.
3. Strengthen **Best Use of Gemma** with SERA-1 and grounded RAG.
4. Prefer one measured optimization over several unfinished features.
5. Use future architecture to answer scalability questions, not to exaggerate the current build.
