import { vi } from "vitest";
vi.mock("server-only", () => ({}));

import { describe, expect, it } from "vitest";
import type { PrivateBlobTransport } from "../lib/persistence/vercel-blob-marketplace-repository";
import { VercelBlobMarketplaceRepository } from "../lib/persistence/vercel-blob-marketplace-repository";
import {
  RepositoryConflictError,
  RepositoryDataError,
  RepositoryNotFoundError,
  RepositoryUnavailableError,
  MAX_SOLD_COMPARABLES,
} from "../lib/persistence/repository";
import { activeListing, comparable, reconciliationFailure, settlementReceipt, validDraft } from "./domain-fixtures";

type Stored = { body: string | Uint8Array; contentType: string; uploadedAt: Date };
const UNSET = Symbol("unset");

function stream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } });
}

function errorMessage(error: unknown): string {
  expect(error).toBeInstanceOf(Error);
  return error instanceof Error ? error.message : "";
}

class FakeBlobTransport implements PrivateBlobTransport {
  readonly stored = new Map<string, Stored>();
  readonly puts: Array<{ pathname: string; options: Parameters<PrivateBlobTransport["put"]>[2] }> = [];
  readonly gets: Array<{ pathname: string; options: Parameters<PrivateBlobTransport["get"]>[1] }> = [];
  nextPutError: unknown;
  nextGetError: unknown;
  nextHeadError: unknown;
  nextListError: unknown;
  nextPutResult: unknown | typeof UNSET = UNSET;
  nextGetResult: Awaited<ReturnType<PrivateBlobTransport["get"]>> | undefined;
  nextHeadResult: Awaited<ReturnType<PrivateBlobTransport["head"]>> | undefined;
  readonly getResultsByPath = new Map<string, unknown>();
  readonly listResults: unknown[] = [];
  readonly listCalls: Array<{ prefix: string; limit: number; cursor?: string }> = [];
  getDelayMs = 0;
  activeGets = 0;
  maxActiveGets = 0;

  async put(pathname: string, body: string | Uint8Array, options: Parameters<PrivateBlobTransport["put"]>[2]) {
    this.puts.push({ pathname, options });
    if (this.nextPutError) { const error = this.nextPutError; this.nextPutError = undefined; throw error; }
    if (this.nextPutResult !== UNSET) {
      const result = this.nextPutResult;
      this.nextPutResult = UNSET;
      return result;
    }
    if (!options.allowOverwrite && this.stored.has(pathname)) throw { code: "blob_already_exists", providerPayload: "secret" };
    this.stored.set(pathname, { body, contentType: options.contentType, uploadedAt: new Date("2026-08-21T00:00:00.000Z") });
    return { pathname };
  }

  async get(pathname: string, options: Parameters<PrivateBlobTransport["get"]>[1]) {
    this.gets.push({ pathname, options });
    this.activeGets += 1;
    this.maxActiveGets = Math.max(this.maxActiveGets, this.activeGets);
    try {
      if (this.getDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.getDelayMs));
      if (this.nextGetError) { const error = this.nextGetError; this.nextGetError = undefined; throw error; }
      if (this.getResultsByPath.has(pathname)) return this.getResultsByPath.get(pathname);
      if (this.nextGetResult !== undefined) {
        const result = this.nextGetResult;
        this.nextGetResult = undefined;
        return result;
      }
      const stored = this.stored.get(pathname);
      if (!stored) return null;
      const bytes = typeof stored.body === "string" ? new TextEncoder().encode(stored.body) : stored.body;
      return { stream: stream(bytes), blob: { pathname, contentType: stored.contentType, size: bytes.byteLength, uploadedAt: stored.uploadedAt } };
    } finally {
      this.activeGets -= 1;
    }
  }

  async head(pathname: string) {
    if (this.nextHeadError) { const error = this.nextHeadError; this.nextHeadError = undefined; throw error; }
    if (this.nextHeadResult !== undefined) {
      const result = this.nextHeadResult;
      this.nextHeadResult = undefined;
      return result;
    }
    const stored = this.stored.get(pathname);
    if (!stored) throw { code: "not_found" };
    const size = typeof stored.body === "string" ? new TextEncoder().encode(stored.body).byteLength : stored.body.byteLength;
    return { pathname, contentType: stored.contentType, size, uploadedAt: stored.uploadedAt };
  }

  async list(options: { prefix: string; limit: number; cursor?: string }) {
    this.listCalls.push(options);
    if (this.nextListError) { const error = this.nextListError; this.nextListError = undefined; throw error; }
    if (this.listResults.length > 0) return this.listResults.shift();
    return { blobs: [...this.stored.keys()].filter((pathname) => pathname.startsWith(options.prefix)).map((pathname) => ({ pathname })), hasMore: false };
  }
}

describe("VercelBlobMarketplaceRepository", () => {
  it("publishes immutable private JSON at the deterministic path with fail-closed options", async () => {
    const transport = new FakeBlobTransport();
    const repository = new VercelBlobMarketplaceRepository(transport);
    await repository.publishSellerListing(activeListing);
    expect(transport.puts[0]).toEqual({
      pathname: `records/listings/${activeListing.listingId}/published.json`,
      options: { access: "private", addRandomSuffix: false, allowOverwrite: false, contentType: "application/json" },
    });
    expect(transport.stored.get(transport.puts[0].pathname)?.body).not.toContain("BLOB_READ_WRITE_TOKEN");
  });

  it("stores analysis-start claim and engine confirmation at separate immutable private paths", async () => {
    const transport = new FakeBlobTransport();
    const repository = new VercelBlobMarketplaceRepository(transport);
    const claim = {
      runId: "analysis-start-1",
      media: structuredClone(validDraft.media),
      claimedAt: "2026-08-21T10:00:00.000Z",
    };
    const confirmation = {
      runId: claim.runId,
      workflowRunId: "wrun_private_1",
      confirmedAt: "2026-08-21T10:00:01.000Z",
    };
    await repository.createAnalysisStartClaim(claim);
    await repository.createAnalysisStartConfirmation(confirmation);
    expect(transport.puts).toEqual([
      expect.objectContaining({
        pathname: "records/runs/analysis-start/analysis-start-1/claim.json",
        options: expect.objectContaining({ access: "private", allowOverwrite: false, addRandomSuffix: false }),
      }),
      expect.objectContaining({
        pathname: "records/runs/analysis-start/analysis-start-1/confirmation.json",
        options: expect.objectContaining({ access: "private", allowOverwrite: false, addRandomSuffix: false }),
      }),
    ]);
    expect(await repository.readAnalysisStartClaim(claim.runId)).toEqual(claim);
    expect(await repository.readAnalysisStartConfirmation(claim.runId)).toEqual(confirmation);
    await expect(repository.createAnalysisStartClaim(claim)).rejects.toBeInstanceOf(RepositoryConflictError);
    await expect(repository.createAnalysisStartConfirmation(confirmation)).rejects.toBeInstanceOf(RepositoryConflictError);
  });

  it("stores recipient-bound publication claims at their immutable deterministic path", async () => {
    const transport = new FakeBlobTransport();
    const repository = new VercelBlobMarketplaceRepository(transport);
    const request = {
      runId: "publication-request-1",
      listingId: "listing-request-1",
      analysisRunId: "analysis-request-1",
      recipientAddress: "0x1111111111111111111111111111111111111111",
      network: "eip155:84532" as const,
      sellerApproved: true as const,
      approvedDraft: structuredClone(validDraft),
      approvedPrice: { currency: "USDC" as const, network: "eip155:84532" as const, atomicAmount: "1000000" },
      requestedAt: "2026-08-21T10:00:00.000Z",
    };
    await expect(repository.createPublicationRequest(request)).resolves.toEqual(request);
    expect(transport.puts[0]).toMatchObject({
      pathname: "records/runs/publication-request/publication-request-1.json",
      options: { access: "private", addRandomSuffix: false, allowOverwrite: false },
    });
    await expect(repository.readPublicationRequest(request.runId)).resolves.toEqual(request);
    await expect(repository.createPublicationRequest(request)).rejects.toBeInstanceOf(RepositoryConflictError);
  });

  it("creates and lists immutable sold comparables with strict path binding and bounds", async () => {
    const transport = new FakeBlobTransport();
    const repository = new VercelBlobMarketplaceRepository(transport);
    await repository.createSoldComparable(comparable);
    expect(transport.puts[0]).toEqual({
      pathname: "records/comparables/sold/comparable-1.json",
      options: { access: "private", addRandomSuffix: false, allowOverwrite: false, contentType: "application/json" },
    });
    await expect(repository.createSoldComparable(comparable)).rejects.toBeInstanceOf(RepositoryConflictError);
    expect(await repository.listSoldComparables()).toEqual([comparable]);
    expect(transport.listCalls.at(-1)).toMatchObject({ prefix: "records/comparables/sold/", limit: 1000 });

    const exact = new FakeBlobTransport();
    for (let index = 0; index < MAX_SOLD_COMPARABLES; index += 1) {
      const record = { ...structuredClone(comparable), comparableId: `bounded-comparable-${index}` };
      exact.stored.set(`records/comparables/sold/${record.comparableId}.json`, {
        body: JSON.stringify(record), contentType: "application/json", uploadedAt: new Date(),
      });
    }
    expect(await new VercelBlobMarketplaceRepository(exact).listSoldComparables())
      .toHaveLength(MAX_SOLD_COMPARABLES);

    const mismatched = new FakeBlobTransport();
    mismatched.stored.set("records/comparables/sold/comparable-1.json", {
      body: JSON.stringify({ ...comparable, comparableId: "comparable-2" }),
      contentType: "application/json",
      uploadedAt: new Date(),
    });
    await expect(
      new VercelBlobMarketplaceRepository(mismatched).listSoldComparables()
    ).rejects.toBeInstanceOf(RepositoryDataError);

    const overflow = new FakeBlobTransport();
    overflow.listResults.push({
      blobs: Array.from({ length: MAX_SOLD_COMPARABLES + 1 }, (_, index) => ({
        pathname: `records/comparables/sold/comparable-${index}.json`,
      })),
      hasMore: false,
    });
    await expect(
      new VercelBlobMarketplaceRepository(overflow).listSoldComparables()
    ).rejects.toBeInstanceOf(RepositoryDataError);
    expect(overflow.gets).toHaveLength(0);
  });

  it("accepts the 100th comparable and rejects the 101st before Blob put", async () => {
    const transport = new FakeBlobTransport();
    for (let index = 0; index < MAX_SOLD_COMPARABLES - 1; index += 1) {
      const record = { ...structuredClone(comparable), comparableId: `capacity-comparable-${index}` };
      transport.stored.set(`records/comparables/sold/${record.comparableId}.json`, {
        body: JSON.stringify(record), contentType: "application/json", uploadedAt: new Date(),
      });
    }
    const repository = new VercelBlobMarketplaceRepository(transport);
    const hundredth = { ...structuredClone(comparable), comparableId: "capacity-comparable-99" };
    await expect(repository.createSoldComparable(hundredth)).resolves.toEqual(hundredth);
    expect(transport.puts).toHaveLength(1);
    await expect(repository.createSoldComparable(hundredth)).rejects.toBeInstanceOf(RepositoryConflictError);
    expect(transport.puts).toHaveLength(2);

    const overflowRecord = { ...structuredClone(comparable), comparableId: "capacity-comparable-100" };
    await expect(repository.createSoldComparable(overflowRecord)).rejects.toBeInstanceOf(RepositoryDataError);
    expect(transport.puts).toHaveLength(2);
    expect(transport.stored.has("records/comparables/sold/capacity-comparable-100.json")).toBe(false);
  });

  it("immutably creates the initial analysis run at its deterministic private path", async () => {
    const run = {
      runId: "analysis-run-immutable", kind: "analysis" as const, status: "queued" as const,
      media: structuredClone(validDraft.media), geminiAttempts: 0, gemmaAttempts: 0,
      photoIds: validDraft.media.map(({ id }) => id), createdAt: "2026-08-21T10:00:00.000Z",
      updatedAt: "2026-08-21T10:00:00.000Z", attempt: 0,
    };
    const transport = new FakeBlobTransport();
    const repository = new VercelBlobMarketplaceRepository(transport);
    await expect(repository.createAnalysisRun(run)).resolves.toEqual(run);
    expect(transport.puts[0]).toEqual({
      pathname: "records/runs/analysis/analysis-run-immutable.json",
      options: { access: "private", addRandomSuffix: false, allowOverwrite: false, contentType: "application/json" },
    });
    await expect(repository.createAnalysisRun(run)).rejects.toBeInstanceOf(RepositoryConflictError);

    for (const acknowledgement of [null, { pathname: "records/runs/analysis/changed.json" }]) {
      const corruptTransport = new FakeBlobTransport();
      corruptTransport.nextPutResult = acknowledgement;
      await expect(
        new VercelBlobMarketplaceRepository(corruptTransport).createAnalysisRun(run)
      ).rejects.toBeInstanceOf(RepositoryDataError);
    }
  });

  it("uses overwrite only for durable run snapshots and reads with private origin access", async () => {
    const transport = new FakeBlobTransport();
    const repository = new VercelBlobMarketplaceRepository(transport);
    const run = {
      runId: "analysis-run-1", kind: "analysis" as const, status: "queued" as const,
      media: structuredClone(validDraft.media), geminiAttempts: 0, gemmaAttempts: 0,
      photoIds: validDraft.media.map(({ id }) => id), createdAt: "2026-08-21T10:00:00.000Z",
      updatedAt: "2026-08-21T10:00:00.000Z", attempt: 0,
    };
    await repository.saveRunSnapshot(run);
    expect(transport.puts[0]).toMatchObject({ pathname: "records/runs/analysis/analysis-run-1.json", options: { access: "private", addRandomSuffix: false, allowOverwrite: true } });
    expect(await repository.readRunSnapshot("analysis", run.runId)).toEqual(run);
    expect(transport.gets.at(-1)?.options).toEqual({ access: "private", useCache: false });
  });

  it("creates receipts with immutable options and makes receipt existence authoritative for sold visibility", async () => {
    const transport = new FakeBlobTransport();
    const repository = new VercelBlobMarketplaceRepository(transport);
    await repository.publishSellerListing(activeListing);
    await repository.createSettlementReceipt(settlementReceipt());
    expect(transport.puts.at(-1)).toMatchObject({
      pathname: `records/settlements/receipts/${settlementReceipt().purchaseId}.json`,
      options: { access: "private", addRandomSuffix: false, allowOverwrite: false },
    });
    expect((await repository.getListing(activeListing.listingId)).visibility).toBe("sold");
  });

  it("maps a path-mismatched stored listing to RepositoryDataError before receipt validation", async () => {
    const transport = new FakeBlobTransport();
    transport.stored.set(`records/listings/${activeListing.listingId}/published.json`, {
      body: JSON.stringify({ ...activeListing, listingId: "different-listing" }),
      contentType: "application/json",
      uploadedAt: new Date("2026-08-21T00:00:00.000Z"),
    });

    await expect(
      new VercelBlobMarketplaceRepository(transport).createSettlementReceipt(settlementReceipt())
    ).rejects.toBeInstanceOf(RepositoryDataError);
  });

  it("stores reconciliation records at a separate immutable path", async () => {
    const transport = new FakeBlobTransport();
    const repository = new VercelBlobMarketplaceRepository(transport);
    const failure = reconciliationFailure();
    await repository.createReconciliationRecord("attempt-1", failure);
    expect(transport.puts[0]).toMatchObject({
      pathname: `records/settlements/reconciliation/${failure.purchaseId}/attempt-1.json`,
      options: { access: "private", addRandomSuffix: false, allowOverwrite: false },
    });
    expect(await repository.readReconciliationRecord(failure.purchaseId, "attempt-1")).toEqual(failure);
  });

  it("rejects a stored reconciliation record whose purchase ID does not match its deterministic path", async () => {
    const transport = new FakeBlobTransport();
    const requested = reconciliationFailure();
    const forged = { ...requested, purchaseId: "purchase:different-listing" };
    transport.stored.set(
      `records/settlements/reconciliation/${requested.purchaseId}/attempt-1.json`,
      { body: JSON.stringify(forged), contentType: "application/json", uploadedAt: new Date() }
    );

    await expect(
      new VercelBlobMarketplaceRepository(transport).readReconciliationRecord(requested.purchaseId, "attempt-1")
    ).rejects.toBeInstanceOf(RepositoryDataError);
  });

  it("maps provider conflicts and not-found responses without leaking provider payloads", async () => {
    const transport = new FakeBlobTransport();
    const repository = new VercelBlobMarketplaceRepository(transport);
    transport.nextPutError = { status: 409, message: "secret provider conflict response" };
    const conflict = await repository.publishSellerListing(activeListing).catch((error: unknown) => error);
    expect(conflict).toBeInstanceOf(RepositoryConflictError);
    expect(errorMessage(conflict)).not.toContain("secret");

    transport.nextPutError = new Error(
      "Vercel Blob: This blob already exists, use `allowOverwrite: true` if you want to overwrite it."
    );
    await expect(repository.publishSellerListing(activeListing)).rejects.toBeInstanceOf(
      RepositoryConflictError
    );

    await expect(repository.getListing("missing-listing")).rejects.toBeInstanceOf(RepositoryNotFoundError);
    transport.nextGetError = { status: 503, message: "token=secret" };
    const unavailable = await repository.getListing("missing-listing").catch((error: unknown) => error);
    expect(unavailable).toBeInstanceOf(RepositoryUnavailableError);
    expect(errorMessage(unavailable)).not.toContain("secret");
  });

  it("maps throwing required and optional JSON streams to sanitized RepositoryUnavailableError", async () => {
    const throwingResult = (pathname: string) => ({
      stream: new ReadableStream<Uint8Array>({ pull() { throw new Error("secret JSON stream payload"); } }),
      blob: {
        pathname,
        contentType: "application/json",
        size: 3,
        uploadedAt: new Date("2026-08-21T00:00:00.000Z"),
      },
    });

    const requiredTransport = new FakeBlobTransport();
    const listingPath = `records/listings/${activeListing.listingId}/published.json`;
    requiredTransport.getResultsByPath.set(listingPath, throwingResult(listingPath));
    const requiredError = await new VercelBlobMarketplaceRepository(requiredTransport)
      .getListing(activeListing.listingId)
      .catch((error: unknown) => error);
    expect(requiredError).toBeInstanceOf(RepositoryUnavailableError);
    expect(errorMessage(requiredError)).not.toContain("secret");

    const optionalTransport = new FakeBlobTransport();
    optionalTransport.stored.set(listingPath, {
      body: JSON.stringify(activeListing),
      contentType: "application/json",
      uploadedAt: new Date("2026-08-21T00:00:00.000Z"),
    });
    const receiptPath = `records/settlements/receipts/${settlementReceipt().purchaseId}.json`;
    optionalTransport.getResultsByPath.set(receiptPath, throwingResult(receiptPath));
    const optionalError = await new VercelBlobMarketplaceRepository(optionalTransport)
      .getListing(activeListing.listingId)
      .catch((error: unknown) => error);
    expect(optionalError).toBeInstanceOf(RepositoryUnavailableError);
    expect(errorMessage(optionalError)).not.toContain("secret");
  });

  it("keeps oversized JSON classified as stored-data corruption", async () => {
    const transport = new FakeBlobTransport();
    const pathname = `records/listings/${activeListing.listingId}/published.json`;
    const bytes = new Uint8Array(512 * 1024 + 1);
    transport.nextGetResult = {
      stream: stream(bytes),
      blob: { pathname, contentType: "application/json", size: bytes.byteLength, uploadedAt: new Date() },
    };
    await expect(
      new VercelBlobMarketplaceRepository(transport).getListing(activeListing.listingId)
    ).rejects.toBeInstanceOf(RepositoryDataError);
  });

  it("keeps malformed JSON classified as stored-data corruption", async () => {
    const transport = new FakeBlobTransport();
    const pathname = `records/listings/${activeListing.listingId}/published.json`;
    transport.stored.set(pathname, {
      body: "{not-json",
      contentType: "application/json",
      uploadedAt: new Date("2026-08-21T00:00:00.000Z"),
    });
    await expect(
      new VercelBlobMarketplaceRepository(transport).getListing(activeListing.listingId)
    ).rejects.toBeInstanceOf(RepositoryDataError);
  });

  it("runtime-validates complete Blob put acknowledgements", async () => {
    const malformedResults: unknown[] = [null, undefined, {}, { pathname: null }, { pathname: 42 }];
    for (const result of malformedResults) {
      const transport = new FakeBlobTransport();
      transport.nextPutResult = result;
      await expect(
        new VercelBlobMarketplaceRepository(transport).publishSellerListing(activeListing)
      ).rejects.toBeInstanceOf(RepositoryDataError);
    }

    const changedPath = new FakeBlobTransport();
    changedPath.nextPutResult = { pathname: "records/listings/changed/published.json" };
    await expect(
      new VercelBlobMarketplaceRepository(changedPath).publishSellerListing(activeListing)
    ).rejects.toBeInstanceOf(RepositoryDataError);

    const unavailableTransport = new FakeBlobTransport();
    unavailableTransport.nextPutError = new Error("secret provider write payload");
    const unavailable = await new VercelBlobMarketplaceRepository(unavailableTransport)
      .publishSellerListing(activeListing)
      .catch((error: unknown) => error);
    expect(unavailable).toBeInstanceOf(RepositoryUnavailableError);
    expect(errorMessage(unavailable)).not.toContain("secret");
  });

  it("fails closed when stored JSON or provider path data violates authoritative schemas", async () => {
    const transport = new FakeBlobTransport();
    const repository = new VercelBlobMarketplaceRepository(transport);
    const pathname = `records/listings/${activeListing.listingId}/published.json`;
    transport.stored.set(pathname, { body: JSON.stringify({ ...activeListing, injected: true }), contentType: "application/json", uploadedAt: new Date() });
    await expect(repository.getListing(activeListing.listingId)).rejects.toBeInstanceOf(RepositoryDataError);

    transport.stored.clear();
    transport.stored.set(pathname, { body: JSON.stringify(activeListing), contentType: "text/plain", uploadedAt: new Date() });
    await expect(repository.getListing(activeListing.listingId)).rejects.toBeInstanceOf(RepositoryDataError);
  });

  it("rejects a stored listing whose listing ID does not match the requested deterministic path", async () => {
    const transport = new FakeBlobTransport();
    const pathname = `records/listings/${activeListing.listingId}/published.json`;
    transport.stored.set(pathname, {
      body: JSON.stringify({ ...activeListing, listingId: "different-listing" }),
      contentType: "application/json",
      uploadedAt: new Date(),
    });

    await expect(
      new VercelBlobMarketplaceRepository(transport).getListing(activeListing.listingId)
    ).rejects.toBeInstanceOf(RepositoryDataError);
  });

  it("maps malformed or overlong provider list entries to RepositoryDataError", async () => {
    const malformedEntries: unknown[] = [
      { pathname: `records/listings/${"a".repeat(65)}/published.json` },
      { pathname: "records/listings/x/../published.json" },
      { pathname: 42 },
      {},
    ];
    for (const blob of malformedEntries) {
      const transport = new FakeBlobTransport();
      transport.listResults.push({ blobs: [blob], hasMore: false });
      const repository = new VercelBlobMarketplaceRepository(transport);
      await expect(repository.listMarketplaceListings()).rejects.toBeInstanceOf(RepositoryDataError);
    }
  });

  it("rejects a listed pathname whose stored listing ID points at a different listing", async () => {
    const transport = new FakeBlobTransport();
    const pathname = `records/listings/${activeListing.listingId}/published.json`;
    transport.stored.set(pathname, {
      body: JSON.stringify({ ...activeListing, listingId: "different-listing" }),
      contentType: "application/json",
      uploadedAt: new Date(),
    });

    await expect(
      new VercelBlobMarketplaceRepository(transport).listMarketplaceListings()
    ).rejects.toBeInstanceOf(RepositoryDataError);
    expect(transport.gets.map(({ pathname: requestedPath }) => requestedPath)).toEqual([pathname]);
  });

  it("rejects malformed pagination flags and cursors", async () => {
    const malformedPages: unknown[] = [
      { blobs: [], hasMore: {} },
      { blobs: [], hasMore: 1 },
      { blobs: [], hasMore: true, cursor: {} },
      { blobs: [], hasMore: true, cursor: 1 },
      { blobs: [], hasMore: true, cursor: "" },
      { blobs: [], hasMore: true, cursor: "   " },
      { blobs: [], hasMore: true, cursor: "x".repeat(1025) },
      { blobs: [], hasMore: false, cursor: {} },
    ];

    for (const page of malformedPages) {
      const transport = new FakeBlobTransport();
      transport.listResults.push(page);
      await expect(
        new VercelBlobMarketplaceRepository(transport).listMarketplaceListings()
      ).rejects.toBeInstanceOf(RepositoryDataError);
    }
  });

  it("rejects repeated pagination cursors instead of looping", async () => {
    const transport = new FakeBlobTransport();
    transport.listResults.push(
      { blobs: [], hasMore: true, cursor: "same-cursor" },
      { blobs: [], hasMore: true, cursor: "same-cursor" }
    );

    await expect(
      new VercelBlobMarketplaceRepository(transport).listMarketplaceListings()
    ).rejects.toBeInstanceOf(RepositoryDataError);
    expect(transport.listResults).toHaveLength(0);
  });

  it("bounds unique-cursor pagination and total listing records", async () => {
    const pageTransport = new FakeBlobTransport();
    for (let page = 1; page <= 25; page += 1) {
      pageTransport.listResults.push({ blobs: [], hasMore: true, cursor: `cursor-${page}` });
    }
    await expect(
      new VercelBlobMarketplaceRepository(pageTransport).listMarketplaceListings()
    ).rejects.toBeInstanceOf(RepositoryDataError);
    expect(pageTransport.listResults).toHaveLength(0);
    expect(pageTransport.listCalls).toHaveLength(25);

    const recordTransport = new FakeBlobTransport();
    recordTransport.listResults.push({
      blobs: Array.from({ length: 501 }, (_, index) => ({
        pathname: `records/listings/listing-${index}/published.json`,
      })),
      hasMore: false,
    });
    await expect(
      new VercelBlobMarketplaceRepository(recordTransport).listMarketplaceListings()
    ).rejects.toBeInstanceOf(RepositoryDataError);
    expect(recordTransport.gets).toHaveLength(0);
  });

  it("accepts exactly 25 pages and exactly 500 listing records", async () => {
    const pageTransport = new FakeBlobTransport();
    for (let page = 1; page <= 25; page += 1) {
      pageTransport.listResults.push({
        blobs: [],
        hasMore: page < 25,
        ...(page < 25 ? { cursor: `cursor-${page}` } : {}),
      });
    }
    await expect(
      new VercelBlobMarketplaceRepository(pageTransport).listMarketplaceListings()
    ).resolves.toEqual([]);
    expect(pageTransport.listCalls).toHaveLength(25);

    const recordTransport = new FakeBlobTransport();
    for (let index = 0; index < 500; index += 1) {
      const listing = { ...structuredClone(activeListing), listingId: `listing-${index}` };
      recordTransport.stored.set(`records/listings/${listing.listingId}/published.json`, {
        body: JSON.stringify(listing),
        contentType: "application/json",
        uploadedAt: new Date("2026-08-21T00:00:00.000Z"),
      });
    }
    await expect(
      new VercelBlobMarketplaceRepository(recordTransport).listMarketplaceListings()
    ).resolves.toHaveLength(500);
  });

  it("reads enumerated listings with explicit bounded concurrency", async () => {
    const transport = new FakeBlobTransport();
    transport.getDelayMs = 2;
    for (let index = 0; index < 20; index += 1) {
      const listing = { ...structuredClone(activeListing), listingId: `listing-${index}` };
      transport.stored.set(`records/listings/${listing.listingId}/published.json`, {
        body: JSON.stringify(listing),
        contentType: "application/json",
        uploadedAt: new Date("2026-08-21T00:00:00.000Z"),
      });
    }
    const listings = await new VercelBlobMarketplaceRepository(transport).listMarketplaceListings();
    expect(listings).toHaveLength(20);
    expect(transport.maxActiveGets).toBeGreaterThan(1);
    expect(transport.maxActiveGets).toBeLessThanOrEqual(8);
  });

  it("rejects duplicate listing paths returned across provider pages", async () => {
    const transport = new FakeBlobTransport();
    const pathname = `records/listings/${activeListing.listingId}/published.json`;
    transport.listResults.push(
      { blobs: [{ pathname }], hasMore: true, cursor: "next-page" },
      { blobs: [{ pathname }], hasMore: false }
    );

    await expect(
      new VercelBlobMarketplaceRepository(transport).listMarketplaceListings()
    ).rejects.toBeInstanceOf(RepositoryDataError);
  });

  it("validates incoming and stored receipts against every immutable listing field", async () => {
    const mismatches = [
      { ...settlementReceipt(), listingTitle: "Different valid listing title" },
      { ...settlementReceipt(), recipientAddress: "0x2222222222222222222222222222222222222222" },
      { ...settlementReceipt(), amount: { ...settlementReceipt().amount, atomicAmount: "500000001" } },
    ];

    for (const forged of mismatches) {
      const inputTransport = new FakeBlobTransport();
      const inputRepository = new VercelBlobMarketplaceRepository(inputTransport);
      await inputRepository.publishSellerListing(activeListing);
      await expect(inputRepository.createSettlementReceipt(forged)).rejects.toThrow(
        "Receipt does not match the immutable published active listing snapshot"
      );
      expect(inputTransport.stored.has(`records/settlements/receipts/${forged.purchaseId}.json`)).toBe(false);

      const storedTransport = new FakeBlobTransport();
      const listingPath = `records/listings/${activeListing.listingId}/published.json`;
      const receiptPath = `records/settlements/receipts/${forged.purchaseId}.json`;
      storedTransport.stored.set(listingPath, { body: JSON.stringify(activeListing), contentType: "application/json", uploadedAt: new Date("2026-08-21T00:00:00.000Z") });
      storedTransport.stored.set(receiptPath, { body: JSON.stringify(forged), contentType: "application/json", uploadedAt: new Date("2026-08-21T00:00:00.000Z") });
      const storedRepository = new VercelBlobMarketplaceRepository(storedTransport);
      await expect(storedRepository.getListing(activeListing.listingId)).rejects.toBeInstanceOf(RepositoryDataError);
      await expect(storedRepository.readSettlementReceipt(forged.purchaseId)).rejects.toBeInstanceOf(RepositoryDataError);
      await expect(storedRepository.listMarketplaceListings()).rejects.toBeInstanceOf(RepositoryDataError);
    }
  });

  it("creates immutable private media with deterministic fail-closed Blob options", async () => {
    const transport = new FakeBlobTransport();
    const repository = new VercelBlobMarketplaceRepository(transport);
    const media = validDraft.media[0];
    const bytes = new Uint8Array([1, 2, 3]);
    await expect(repository.createPrivateMedia(media, bytes, "2026-08-21T00:00:00.000Z"))
      .resolves.toMatchObject({ media, size: 3 });
    expect(transport.puts[0]).toEqual({
      pathname: media.pathname,
      options: {
        access: "private",
        addRandomSuffix: false,
        allowOverwrite: false,
        contentType: media.mimeType,
      },
    });
    expect(transport.stored.get(media.pathname)?.body).toEqual(bytes);
    await expect(repository.createPrivateMedia(media, bytes, "2026-08-21T00:00:00.000Z"))
      .rejects.toBeInstanceOf(RepositoryConflictError);

    const malformed = new FakeBlobTransport();
    malformed.nextPutResult = null;
    await expect(new VercelBlobMarketplaceRepository(malformed)
      .createPrivateMedia(media, bytes, "2026-08-21T00:00:00.000Z"))
      .rejects.toBeInstanceOf(RepositoryDataError);
  });

  it("reads private media metadata and bytes through validated references", async () => {
    const transport = new FakeBlobTransport();
    const media = validDraft.media[0];
    transport.stored.set(media.pathname, { body: "abc", contentType: media.mimeType, uploadedAt: new Date("2026-08-21T00:00:00.000Z") });
    const repository = new VercelBlobMarketplaceRepository(transport);
    expect((await repository.readPrivateMediaMetadata(media)).size).toBe(3);
    expect([...((await repository.readPrivateMediaContent(media)).bytes)]).toEqual([97, 98, 99]);
    expect(transport.gets.at(-1)?.options).toEqual({ access: "private", useCache: false });
  });

  it("maps malformed private-media dates, sizes, and oversize content to RepositoryDataError", async () => {
    const media = validDraft.media[0];
    const metadataTransport = new FakeBlobTransport();
    metadataTransport.nextHeadResult = {
      pathname: media.pathname,
      contentType: media.mimeType,
      size: 3,
      uploadedAt: new Date(Number.NaN),
    };
    await expect(
      new VercelBlobMarketplaceRepository(metadataTransport).readPrivateMediaMetadata(media)
    ).rejects.toBeInstanceOf(RepositoryDataError);

    const invalidDateTransport = new FakeBlobTransport();
    invalidDateTransport.nextGetResult = {
      stream: stream(new Uint8Array([1, 2, 3])),
      blob: { pathname: media.pathname, contentType: media.mimeType, size: 3, uploadedAt: new Date(Number.NaN) },
    };
    await expect(
      new VercelBlobMarketplaceRepository(invalidDateTransport).readPrivateMediaContent(media)
    ).rejects.toBeInstanceOf(RepositoryDataError);

    const wrongSizeTransport = new FakeBlobTransport();
    wrongSizeTransport.nextGetResult = {
      stream: stream(new Uint8Array([1, 2, 3])),
      blob: { pathname: media.pathname, contentType: media.mimeType, size: 4, uploadedAt: new Date("2026-08-21T00:00:00.000Z") },
    };
    await expect(
      new VercelBlobMarketplaceRepository(wrongSizeTransport).readPrivateMediaContent(media)
    ).rejects.toBeInstanceOf(RepositoryDataError);

    const oversizeTransport = new FakeBlobTransport();
    const oversize = new Uint8Array(20 * 1024 * 1024 + 1);
    oversizeTransport.nextGetResult = {
      stream: stream(oversize),
      blob: { pathname: media.pathname, contentType: media.mimeType, size: oversize.byteLength, uploadedAt: new Date("2026-08-21T00:00:00.000Z") },
    };
    await expect(
      new VercelBlobMarketplaceRepository(oversizeTransport).readPrivateMediaContent(media)
    ).rejects.toBeInstanceOf(RepositoryDataError);
  });

  it("maps malformed private-media transport envelopes to RepositoryDataError", async () => {
    const media = validDraft.media[0];
    for (const malformedHead of [null, {}, { pathname: media.pathname }]) {
      const transport = new FakeBlobTransport();
      transport.nextHeadResult = malformedHead;
      await expect(
        new VercelBlobMarketplaceRepository(transport).readPrivateMediaMetadata(media)
      ).rejects.toBeInstanceOf(RepositoryDataError);
    }

    for (const malformedGet of [{}, { blob: null }, { stream: null, blob: null }]) {
      const transport = new FakeBlobTransport();
      transport.nextGetResult = malformedGet;
      await expect(
        new VercelBlobMarketplaceRepository(transport).readPrivateMediaContent(media)
      ).rejects.toBeInstanceOf(RepositoryDataError);
    }
  });

  it("maps media provider and stream failures to sanitized RepositoryUnavailableError", async () => {
    const media = validDraft.media[0];
    const headTransport = new FakeBlobTransport();
    headTransport.nextHeadError = new Error("secret provider metadata payload");
    const headError = await new VercelBlobMarketplaceRepository(headTransport)
      .readPrivateMediaMetadata(media)
      .catch((error: unknown) => error);
    expect(headError).toBeInstanceOf(RepositoryUnavailableError);
    expect(errorMessage(headError)).not.toContain("secret");

    const getTransport = new FakeBlobTransport();
    getTransport.nextGetError = new Error("secret provider content payload");
    const getError = await new VercelBlobMarketplaceRepository(getTransport)
      .readPrivateMediaContent(media)
      .catch((error: unknown) => error);
    expect(getError).toBeInstanceOf(RepositoryUnavailableError);
    expect(errorMessage(getError)).not.toContain("secret");

    const streamTransport = new FakeBlobTransport();
    streamTransport.nextGetResult = {
      stream: new ReadableStream<Uint8Array>({ pull() { throw new Error("secret stream payload"); } }),
      blob: { pathname: media.pathname, contentType: media.mimeType, size: 3, uploadedAt: new Date("2026-08-21T00:00:00.000Z") },
    };
    const streamError = await new VercelBlobMarketplaceRepository(streamTransport)
      .readPrivateMediaContent(media)
      .catch((error: unknown) => error);
    expect(streamError).toBeInstanceOf(RepositoryUnavailableError);
    expect(errorMessage(streamError)).not.toContain("secret");
  });
});
