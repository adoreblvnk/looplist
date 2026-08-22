# LoopList

LoopList turns photos of a used item into an approved, published, and verified eBay listing.

## Stack

- Next.js on Vercel
- AI SDK 7 `WorkflowAgent` and Vercel Workflows
- Gemini through `@ai-sdk/google`
- Vercel Blob for images and verified skill artifacts
- eBay Sandbox Sell APIs

## Setup

```bash
cp .env.example .env.local
npm install
npm run dev
```

Add only Sandbox credentials to `.env.local`. Never commit the file.

## Checks

```bash
npm run lint
npm run build
npm audit
```

See `PROJECT_CONTEXT.md` for product scope and demo constraints.
