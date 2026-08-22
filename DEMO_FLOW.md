# LoopList — 2-Minute Demo Flow & Script

## Pitch & Positioning

> **“Gemini sees. Gemma matches. The human decides.”**
>
> LoopList is an agent-native recommerce marketplace for electronics and running shoes. Sellers turn photos into evidence-backed listings via Gemini 3.7 Flash, Gemma reasons over regional resale dynamics with grounded RAG, and payments settle deterministically on Base Sepolia via x402.

---

## 2-Minute Demo Sequence

### Part 1: The Problem & Vision (0:00 – 0:15)
- **Screen:** Marketplace Feed (`/`)
- **Action:** Show the Carousell-style feed populated with active electronics and running shoe listings.
- **Visual:** Clean feed UI, category tabs, and active item cards.
- **Spoken Script:**
  > *"We all have second-hand gear sitting in our closet, but creating a listing has too much friction: writing descriptions, pricing, and examining our product for defects. **Meet LoopList.** All you need are photos to list, and agentic intelligence handles the rest— and the seller connects directly with buyer agents."*
- **Behind-the-Scenes Focus:** Autonomous buyer/seller duality with deterministic human guardrails.

---

### Part 2: Evidence-First Vision Listing (0:15 – 0:45)
- **Screen:** Sell Flow (`/sell`)
- **Action:** Drop in 3 to 6 product photos (e.g., MacBook or Headphones) and trigger the seller agent.
- **Visual:** Fast analysis progress completes. In a single execution pass, the engine handles **8 distinct jobs**:
  1. **Product Identification:** Exact brand, model, and year.
  2. **Title Generation:** Search-friendly item title.
  3. **Description Generation:** Clean, structured overview.
  4. **Condition Grading:** Cosmetic and wear assessment.
  5. **Size & Specs:** Sizing, storage, and colorway details.
  6. **Accessory Check:** Detects included vs. missing accessories/box.
  7. **Photo-ID Evidence Grounding:** Binds every defect directly to a source photo ID.
  8. **Assumption Isolation:** Moves unseen details (e.g., battery health) into editable assumptions instead of guessing.
- **Spoken Script:**
  > *"We drop in raw photos. Instead of a generic prompt, our custom **Gemini Evidence-First Listing Skill** handles 7 jobs at once: identifying the item, writing titles and descriptions, grading condition, checking specs, and binding every defect to a photo ID. Anything it can't see becomes an editable assumption."*
- **Behind-the-Scenes Focus (Gemini Showcase):** Multimodal vision specialization via strict schemas, zero ungrounded claims, and automated photo-ID evidence binding.

---

### Part 3: Grounded Pricing & Publication (0:45 – 1:12)
- **Screen:** Sell Review & Confirmation
- **Action:** Review Gemma's comparable price range, set the final price, and click **Publish**.
- **Visual:** Gemma displays comparable sold items, explains the recommended price bracket based on condition and accessories, and the listing publishes instantly to the feed and detail page.
- **Spoken Script:**
  > *"Next, Gemma sets the price. It searches our past sales data, compares condition and accessories, and recommends a fair price range. we decide & approve the price and publish. The listing goes live instantly."*
- **Behind-the-Scenes Focus (Gemma Showcase):** Open-model tool retrieval over real sales data; durable and safe workflow persistence.

---

### Part 4: SERA-1 Lexicon & Grounded Buyer Search (1:12 – 1:35)
- **Screen:** Buyer Agent Interface (`/buyer`)
- **Action:** Enter a complex regional natural-language query:
  `Find a BNIB or like-new Air Force under 120 USDC, no damage, can nego, MRT meetup. Deal today.`
- **Visual:** Search processes. The top-ranked listing appears with a clear explanation of fit, highlighted defect checks, and condition verifications.
- **Spoken Script:**
  > *"Now the buyer side. We search using regional slang like `BNIB`, `can nego`, and `MRT meetup`. Instead of guessing what these mean, our system looks up exact definitions in **SERA-1**—our custom regional resale lexicon set—and feeds them to Gemma. Gemma finds the best match and explains why it fits, while our backend double-checks the buyer's budget and condition rules."*
- **Behind-the-Scenes Focus:** SERA-1 RAG Lexicon retrieval, isolated buyer context, deterministic backend rule enforcement.

---

### Part 5: x402 Protocol Settlement & Finality (1:35 – 2:00)
- **Screen:** Payment Approval & Receipt Modal
- **Action:** Click **Buy**, review the exact settlement breakdown, and approve the connected browser wallet transaction.
- **Visual:** Connected wallet popup approves testnet USDC on Base Sepolia. The screen updates to a persisted receipt with transaction hash, BaseScan link, and a **SOLD** status badge across the marketplace.
- **Spoken Script:**
  > *"Time to buy. Once Gemma picks the winning item, it doesn't spend money blindly. It hands the verified listing directly to the x402 protocol, which translates the agent's match into an exact payment payload on Base Sepolia. we still approve the final payment in your wallet.*
  >
  > *this demonstrates how gemma interacts with x402 protocol. this is looplist"*
- **Behind-the-Scenes Focus:** x402 payment integrity, zero private key custody, immediate on-chain settlement, authoritative sold-state locking.

---

## Stage Soundbites

1. **On Gemini 3.7 Flash:**
   > *“This isn't a prompt wrapper. It's our Evidence-First Listing Skill—running 8 listing jobs in a single multimodal pass while linking every defect directly to a photo.”*

2. **On Gemma:**
   > *“Gemma is our pricing and matching brain. It prices items from real sales data and searches listings using our SERA-1 regional slang lexicon instead of guessing from memory.”*

3. **On Southeast Asian Resale (SERA-1):**
   > *“Terms like `can nego`, `MRT meetup`, or `BNIB` carry specific local meaning. SERA-1 normalizes them before Gemma ranks candidates.”*

4. **On Safety & x402 Payments:**
   > *“Gemma recommends, but our code enforces the rules. And when paying, the agent prepares the bill, but only your wallet signs it.”*

---

## Technical Q&A Guide

- **Q: Did you fine-tune Gemma or Gemini?**
  - **A:** *“No, and deliberately so. For dynamic marketplace inventory, fine-tuning risks hallucinating stale stock. We specialized Gemini via structured multimodal skill schemas and evaluations, and Gemma via grounded RAG over deterministic marketplace records and SERA-1.”*

- **Q: How do you prevent prompt injection from malicious buyers?**
  - **A:** *“Buyer input is treated as untrusted data in an isolated context. Gemma only receives a minimal projection of active listings without access to private blob paths or server secrets, and all output IDs and budget constraints are re-verified deterministically by the backend.”*

- **Q: Why use x402 instead of standard Web3 wallet calls?**
  - **A:** *“x402 provides a standard HTTP-native payment protocol for autonomous agents. It defines machine-readable pricing and settlement requirements while enforcing human-in-the-loop signing.”*

- **Q: How do you handle race conditions when two buyers purchase the same item?**
  - **A:** *“The backend maintains an authoritative sold-state invariant. Once a settlement is verified, the listing is atomically locked and any subsequent settlement attempts are rejected.”*

---

## Pre-Flight Stage Checklist

1. **Demo Assets Folder on Desktop:**
   - Keep a folder of 3–6 photos ready to drag & drop (e.g. `img/carousell/macbook air M2 lightly used/img1.jpg` through `img6.jpg` or `air force 1 07 white like new/`).
2. **Buyer Query on Clipboard / Scratchpad:**
   - Text ready to paste: `Find a BNIB or like-new Air Force under 120 USDC, no damage, can nego.`
3. **Connected Browser Wallet (Base Sepolia):**
   - Ensure the browser wallet (e.g., MetaMask/Coinbase Wallet) is switched to **Base Sepolia**.
   - Confirm balance contains at least `1000 test USDC` and a fraction of testnet `ETH` for gas.
4. **Environment Health:**
   - Verify active deployment or local server is warmed up (one test inference pass done beforehand so cold-starts are eliminated).
5. **Live Recovery Plan (If Wi-Fi / API Stalls):**
   - Keep a backup browser tab already open at the review screen and buyer search screen to seamlessly switch if the stage network experiences packet drops.
