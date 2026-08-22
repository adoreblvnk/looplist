# Analysis workflow contract

## Idempotent start

`POST /api/analyze` requires an `Idempotency-Key` header with this exact grammar:

- Length: 8 through 128 ASCII characters, inclusive.
- First character: ASCII letter or digit.
- Remaining characters: ASCII letters, digits, `.`, `_`, `~`, or `-`.
- Regular expression: `^[A-Za-z0-9][A-Za-z0-9._~-]{7,127}$`.

The server hashes the validated key with SHA-256 and derives an opaque application run ID. The raw key is never persisted or returned. A key replay must contain the exact full ordered media snapshot. A different snapshot returns `409 idempotency_key_reused`.

An immutable private start claim prevents a second Workflow start. If the Workflow start result or confirmation write is ambiguous while the application run remains queued, POST returns `503 analysis_start_pending`; clients must poll `GET /api/analyze/{runId}`. The server never retries `start()` after a claim exists.

## Workflow retry contract

Workflow SDK 4 step metadata attempts are 1-based. Both model steps explicitly set `maxRetries = 1`, allowing at most two total step attempts. Application code additionally rejects metadata outside attempts 1 and 2. AI SDK internal retries remain disabled.

## Deployment verification gate

The installed dependency set does not include `@workflow/vitest`, so this repository cannot truthfully execute a compiled Local World retry integration test without adding a dependency. Unit tests therefore verify the exported Workflow 4 `maxRetries` metadata and the 1-based application guard.

Before accepting a deployment, verify against the deployed Workflow runtime without live Google model calls:

1. Inspect both compiled analysis steps and confirm `maxRetries` is `1`.
2. Exercise a controlled provider failure and confirm metadata attempts are exactly `1`, then `2`, with no third step attempt.
3. Confirm the first provider failure leaves the application run running with one model attempt.
4. Confirm the second provider failure persists the matching sanitized terminal failure before the workflow raises `FatalError`.
5. Exercise a configuration or deterministic input/comparable-data failure and confirm it persists a fatal variant without consuming a model attempt.

Do not mark this gate complete from source inspection alone; retain the deployed run/step inspection as evidence.
