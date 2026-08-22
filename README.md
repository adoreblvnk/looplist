# LoopList

LoopList turns three to eight item photos into an editable, verified eBay-compatible listing. Gemini 3.6 Flash identifies the item, records visible defects, suggests prices, and asks only for unresolved seller details. Publication starts only after explicit seller approval.

Built for the [Build with Gemini Hackathon 2026](https://luma.com/deepmind-v4ci), Most Creative Gemini Hack track.

## Stack

- Next.js 16 and React 19
- AI SDK 7 `WorkflowAgent` with Gemini 3.6 Flash
- Vercel Workflow for durable analysis and publication runs
- Private Vercel Blob storage for photos, drafts, adapter records, and repair skills
- Deterministic eBay-compatible adapter until Sandbox credentials are available

Gemini, Blob, and Workflow are required live paths. The app reports failures instead of substituting fixtures or mocks. Only the eBay boundary uses a temporary adapter.

## Local development

Create `.env` or `.env.local` with:

```dotenv
GOOGLE_GENERATIVE_AI_API_KEY=
BLOB_READ_WRITE_TOKEN=
```

Then run:

```bash
npm install
npm run dev
```

Open `http://localhost:3000` for the landing page and `http://localhost:3000/demo` for the complete seller flow.

## Verification

```bash
npm test
npm run lint
npm run build
npm audit
```

The seeded Game Boy item still uses the live Blob, Gemini, and Workflow path. The final receipt is clearly marked as an eBay-compatible demo-adapter result and can be restored from its workflow ID until the workspace is reset.

## Deployment boundary

The repository is linked to a Vercel project and a private Blob store. No Production deployment is created by this project setup.
