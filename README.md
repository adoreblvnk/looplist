# LoopList

LoopList turns photos of a used item into an approved, published, and verified eBay listing.

## Stack

- Next.js 16 (App Router)
- AI SDK 7 `WorkflowAgent` and Vercel Workflows (`workflow` 4.8.3, `@ai-sdk/workflow` 1.0.69)
- Gemini 3.6 Flash through `@ai-sdk/google`
- Vercel Blob for private image storage, draft/final workflow records, eBay adapter records, and versioned repair skill artifacts
- Deterministic eBay Sandbox adapter boundary

## API Endpoints

- `POST /api/upload`: Raw image binary upload contract. Requires numeric `Content-Length` (> 0 and <= 4 MiB) and allowed `Content-Type` (`image/jpeg`, `image/png`, `image/webp`). Verifies PNG/JPEG/WebP magic bytes.
- `GET /api/images?path=...`: Public preview image endpoint accepting only upload-scoped image pathnames (`uploads/*.jpg|.png|.webp`).
- `POST /api/analyze`: Triggers analysis workflow on 3–8 upload image paths.
- `GET /api/analyze/[runId]`: Polls analysis workflow status and typed result DTO.
- `POST /api/publish`: Triggers publication workflow with explicit seller approval (`approved: true`).
- `GET /api/publish/[runId]`: Polls publish workflow status and typed result DTO.

## Setup

```bash
cp .env.example .env.local
npm install
npm run dev
```

In `.env.local`, configure your live `GOOGLE_GENERATIVE_AI_API_KEY` and `BLOB_READ_WRITE_TOKEN`.
Gemini, Blob, and Workflow are live required execution paths.
When live eBay credentials are absent, the eBay listing boundary operates in deterministic adapter mode with identical publish, retrieve, verify, and repair semantics. Never commit `.env.local`.

## Local Verification Commands

```bash
npm run test    # Pure-function unit tests for schemas, path scoping, magic bytes, eBay validation, approval rejection, adapter identity, and repair control
npm run lint    # ESLint
npm run build   # Next.js build
npm audit       # Dependency security audit
```

See `PROJECT_CONTEXT.md` for product scope and vertical slice boundaries.
