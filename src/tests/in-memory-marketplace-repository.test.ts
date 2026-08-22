import { describe, expect, it } from "vitest";
import { ActiveListingSchema, SettlementReceiptSchema } from "../lib/domain/marketplace";
import {
  IN_MEMORY_REPOSITORY_TEST_HOOK,
  InMemoryMarketplaceRepository,
} from "../lib/persistence/in-memory-marketplace-repository";
import {
  RepositoryConflictError,
  RepositoryDataError,
  RepositoryNotFoundError,
  MAX_SOLD_COMPARABLES,
} from "../lib/persistence/repository";
import { activeListing, comparable, reconciliationFailure, settlementReceipt, validDraft } from "./domain-fixtures";

const seededListing = ActiveListingSchema.parse({
  ...structuredClone(activeListing),
  source: "seed",
  seller: {
    id: "seed-seller-integrity",
    displayName: "Integrity Seller (Demo)",
    role: "seller",
    fictional: true,
  },
});

function seededReceipt() {
  return SettlementReceiptSchema.parse({
    ...settlementReceipt(),
    seller: seededListing.seller,
  });
}

describe("InMemoryMarketplaceRepository", () => {
  it("publishes and reads cloned immutable listing snapshots", async () => {
    const repository = new InMemoryMarketplaceRepository();
    const input = structuredClone(activeListing);
    await repository.publishSellerListing(input);
    input.approvedDraft.title = "Mutated caller title";

    const firstRead = await repository.getListing(activeListing.listingId);
    expect(firstRead.listing.approvedDraft.title).toBe(activeListing.approvedDraft.title);
    firstRead.listing.approvedDraft.title = "Mutated read title";
    const secondRead = await repository.getListing(activeListing.listingId);
    expect(secondRead.listing.approvedDraft.title).toBe(activeListing.approvedDraft.title);
  });

  it("fails closed on listing collisions, including identical retries", async () => {
    const repository = new InMemoryMarketplaceRepository();
    await repository.publishSellerListing(activeListing);
    await expect(repository.publishSellerListing(structuredClone(activeListing))).rejects.toBeInstanceOf(RepositoryConflictError);
  });

  it("validates operation input and rejects seed records through seller publication", async () => {
    const repository = new InMemoryMarketplaceRepository();
    const unsupported = Object.assign(structuredClone(activeListing), { unsupported: true });
    await expect(repository.publishSellerListing(unsupported)).rejects.toThrow();
    await expect(repository.publishSellerListing(seededListing)).rejects.toThrow();
  });

  it("persists immutable sold comparables with sorted cloned reads and corruption mapping", async () => {
    const second = { ...structuredClone(comparable), comparableId: "comparable-2" };
    const repository = new InMemoryMarketplaceRepository();
    await repository.createSoldComparable(second);
    const input = structuredClone(comparable);
    await repository.createSoldComparable(input);
    input.title = "Caller mutation must not persist";
    await expect(repository.createSoldComparable(comparable)).rejects.toBeInstanceOf(RepositoryConflictError);
    const listed = await repository.listSoldComparables();
    expect(listed.map(({ comparableId }) => comparableId)).toEqual(["comparable-1", "comparable-2"]);
    listed[0].title = "Read mutation must not persist";
    expect((await repository.listSoldComparables())[0].title).toBe(comparable.title);

    const malformed = new InMemoryMarketplaceRepository({
      [IN_MEMORY_REPOSITORY_TEST_HOOK]: [
        { collection: "comparables", key: comparable.comparableId, value: { ...comparable, extra: true } },
      ],
    });
    await expect(malformed.listSoldComparables()).rejects.toBeInstanceOf(RepositoryDataError);

    const mismatched = new InMemoryMarketplaceRepository({
      [IN_MEMORY_REPOSITORY_TEST_HOOK]: [
        { collection: "comparables", key: comparable.comparableId, value: second },
      ],
    });
    await expect(mismatched.listSoldComparables()).rejects.toBeInstanceOf(RepositoryDataError);
  });

  it("accepts exactly the sold-comparable limit and rejects create and constructor overflow", async () => {
    const corpus = Array.from({ length: MAX_SOLD_COMPARABLES }, (_, index) => ({
      ...structuredClone(comparable), comparableId: `bounded-comparable-${index}`,
    }));
    const repository = new InMemoryMarketplaceRepository({ soldComparables: corpus });
    expect(await repository.listSoldComparables()).toHaveLength(MAX_SOLD_COMPARABLES);
    await expect(repository.createSoldComparable({ ...structuredClone(comparable), comparableId: "overflow" }))
      .rejects.toBeInstanceOf(RepositoryDataError);
    expect(() => new InMemoryMarketplaceRepository({
      soldComparables: [...corpus, { ...structuredClone(comparable), comparableId: "overflow" }],
    })).toThrow(RepositoryDataError);
  });

  it("immutably creates exactly one cloned queued analysis run", async () => {
    const repository = new InMemoryMarketplaceRepository();
    const queued = {
      runId: "analysis-run-immutable",
      kind: "analysis" as const,
      status: "queued" as const,
      media: structuredClone(validDraft.media),
      photoIds: validDraft.media.map(({ id }) => id),
      geminiAttempts: 0,
      gemmaAttempts: 0,
      createdAt: "2026-08-21T10:00:00.000Z",
      updatedAt: "2026-08-21T10:00:00.000Z",
      attempt: 0,
    };
    const created = await repository.createAnalysisRun(queued);
    created.media[0].alt = "Mutated returned media";
    queued.media[0].alt = "Mutated input media";
    await expect(repository.createAnalysisRun({
      ...structuredClone(queued),
      media: structuredClone(validDraft.media),
    })).rejects.toBeInstanceOf(RepositoryConflictError);
    const stored = await repository.readRunSnapshot("analysis", queued.runId);
    if (stored.kind !== "analysis") throw new Error("Expected analysis run");
    expect(stored.media).toEqual(validDraft.media);
    await expect(repository.createAnalysisRun({
      ...queued,
      status: "running",
      startedAt: queued.createdAt,
    } as never)).rejects.toThrow();
  });

  it("upserts durable run snapshots by deterministic kind and run ID while cloning", async () => {
    const repository = new InMemoryMarketplaceRepository();
    const queued = {
      runId: "analysis-run-1",
      kind: "analysis" as const,
      status: "queued" as const,
      media: structuredClone(validDraft.media),
      photoIds: validDraft.media.map(({ id }) => id),
      geminiAttempts: 0,
      gemmaAttempts: 0,
      createdAt: "2026-08-21T10:00:00.000Z",
      updatedAt: "2026-08-21T10:00:00.000Z",
      attempt: 0,
    };
    const written = await repository.saveRunSnapshot(queued);
    if (written.kind !== "analysis") throw new Error("Expected analysis run");
    written.photoIds[0] = "mutated";
    const reread = await repository.readRunSnapshot("analysis", queued.runId);
    if (reread.kind !== "analysis") throw new Error("Expected analysis run");
    expect(reread.photoIds).toEqual(queued.photoIds);

    await repository.saveRunSnapshot({
      ...queued,
      status: "running",
      startedAt: "2026-08-21T10:01:00.000Z",
      updatedAt: "2026-08-21T10:01:00.000Z",
      attempt: 1,
      geminiAttempts: 1,
    });
    expect((await repository.readRunSnapshot("analysis", queued.runId)).attempt).toBe(1);
    await expect(repository.readRunSnapshot("purchase", queued.runId)).rejects.toBeInstanceOf(RepositoryNotFoundError);
  });

  it("allows exactly one immutable receipt winner and derives sold visibility from receipt existence", async () => {
    const repository = new InMemoryMarketplaceRepository({ listings: [activeListing] });
    const receipt = settlementReceipt();
    const attempts = await Promise.allSettled([
      repository.createSettlementReceipt(structuredClone(receipt)),
      repository.createSettlementReceipt(structuredClone(receipt)),
    ]);
    expect(attempts.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    const rejection = attempts.find(({ status }) => status === "rejected");
    expect(rejection).toMatchObject({ status: "rejected", reason: expect.any(RepositoryConflictError) });

    const marketplaceListing = await repository.getListing(activeListing.listingId);
    expect(marketplaceListing.visibility).toBe("sold");
    expect(marketplaceListing.receiptId).toBe(receipt.receiptId);
    expect((await repository.readSettlementReceipt(receipt.purchaseId)).listingId).toBe(activeListing.listingId);
  });

  it("rejects every schema-valid incoming receipt mismatch before writing", async () => {
    const mismatches = [
      (receipt: ReturnType<typeof seededReceipt>) => ({ ...receipt, listingTitle: "Different valid listing title" }),
      (receipt: ReturnType<typeof seededReceipt>) => ({ ...receipt, seller: { ...receipt.seller, displayName: "Different Seller (Demo)" } }),
      (receipt: ReturnType<typeof seededReceipt>) => ({ ...receipt, recipientAddress: "0x2222222222222222222222222222222222222222" }),
      (receipt: ReturnType<typeof seededReceipt>) => ({ ...receipt, amount: { ...receipt.amount, atomicAmount: "500000001" } }),
    ];

    for (const mismatch of mismatches) {
      const repository = new InMemoryMarketplaceRepository({ listings: [seededListing] });
      const forged = SettlementReceiptSchema.parse(mismatch(seededReceipt()));
      await expect(repository.createSettlementReceipt(forged)).rejects.toThrow(
        "Receipt does not match the immutable published active listing snapshot"
      );
      await expect(repository.readSettlementReceipt(forged.purchaseId)).rejects.toBeInstanceOf(RepositoryNotFoundError);
      expect((await repository.getListing(seededListing.listingId)).visibility).toBe("active");
    }
  });

  it("fails closed on stored receipt mismatches during both receipt reads and sold derivation", async () => {
    const mismatches = [
      (receipt: ReturnType<typeof seededReceipt>) => ({ ...receipt, listingTitle: "Different valid listing title" }),
      (receipt: ReturnType<typeof seededReceipt>) => ({ ...receipt, seller: { ...receipt.seller, displayName: "Different Seller (Demo)" } }),
      (receipt: ReturnType<typeof seededReceipt>) => ({ ...receipt, recipientAddress: "0x2222222222222222222222222222222222222222" }),
      (receipt: ReturnType<typeof seededReceipt>) => ({ ...receipt, amount: { ...receipt.amount, atomicAmount: "500000001" } }),
    ];

    for (const mismatch of mismatches) {
      const forged = SettlementReceiptSchema.parse(mismatch(seededReceipt()));
      const repository = new InMemoryMarketplaceRepository({
        listings: [seededListing],
        [IN_MEMORY_REPOSITORY_TEST_HOOK]: [
          { collection: "receipts", key: forged.purchaseId, value: forged },
        ],
      });
      await expect(repository.readSettlementReceipt(forged.purchaseId)).rejects.toBeInstanceOf(RepositoryDataError);
      await expect(repository.getListing(seededListing.listingId)).rejects.toBeInstanceOf(RepositoryDataError);
      await expect(repository.listMarketplaceListings()).rejects.toBeInstanceOf(RepositoryDataError);
    }
  });

  it("rejects a schema-valid stored receipt whose listing identity differs from its storage key", async () => {
    const expected = seededReceipt();
    const forged = SettlementReceiptSchema.parse({
      ...expected,
      receiptId: "purchase:other-listing",
      purchaseId: "purchase:other-listing",
      listingId: "other-listing",
    });
    const repository = new InMemoryMarketplaceRepository({
      listings: [seededListing],
      [IN_MEMORY_REPOSITORY_TEST_HOOK]: [
        { collection: "receipts", key: expected.purchaseId, value: forged },
      ],
    });
    await expect(repository.readSettlementReceipt(expected.purchaseId)).rejects.toBeInstanceOf(RepositoryDataError);
    await expect(repository.getListing(seededListing.listingId)).rejects.toBeInstanceOf(RepositoryDataError);
  });

  it("does not invent a reservation lock or CAS before a receipt exists", async () => {
    const repository = new InMemoryMarketplaceRepository({ listings: [activeListing] });
    expect((await repository.getListing(activeListing.listingId)).visibility).toBe("active");
  });

  it("stores immutable reconciliation records separately from receipts", async () => {
    const repository = new InMemoryMarketplaceRepository();
    const failure = reconciliationFailure();
    await repository.createReconciliationRecord("attempt-1", failure);
    await expect(repository.createReconciliationRecord("attempt-1", failure)).rejects.toBeInstanceOf(RepositoryConflictError);
    const read = await repository.readReconciliationRecord(failure.purchaseId, "attempt-1");
    expect(read).toEqual(failure);
    read.reason = "Caller mutation must not alter the stored reconciliation failure.";
    expect((await repository.readReconciliationRecord(failure.purchaseId, "attempt-1")).reason).toBe(failure.reason);
  });

  it("rejects a stored reconciliation record whose purchase ID does not match its key", async () => {
    const expected = reconciliationFailure();
    const forged = { ...expected, purchaseId: "purchase:different-listing" };
    const repository = new InMemoryMarketplaceRepository({
      [IN_MEMORY_REPOSITORY_TEST_HOOK]: [
        {
          collection: "reconciliations",
          key: `${expected.purchaseId}:attempt-1`,
          value: forged,
        },
      ],
    });

    await expect(
      repository.readReconciliationRecord(expected.purchaseId, "attempt-1")
    ).rejects.toBeInstanceOf(RepositoryDataError);
  });

  it("maps malformed internal records in every collection to RepositoryDataError", async () => {
    const run = {
      runId: "analysis-run-corrupt",
      kind: "analysis" as const,
      status: "queued" as const,
      media: structuredClone(validDraft.media),
      photoIds: validDraft.media.map(({ id }) => id),
      geminiAttempts: 0,
      gemmaAttempts: 0,
      createdAt: "2026-08-21T10:00:00.000Z",
      updatedAt: "2026-08-21T10:00:00.000Z",
      attempt: 0,
    };
    const receipt = seededReceipt();
    const reconciliation = reconciliationFailure();
    const media = validDraft.media[0];
    const corruptions = [
      {
        repository: new InMemoryMarketplaceRepository({
          [IN_MEMORY_REPOSITORY_TEST_HOOK]: [
            { collection: "listings", key: seededListing.listingId, value: undefined },
          ],
        }),
        read: (repository: InMemoryMarketplaceRepository) => repository.getListing(seededListing.listingId),
      },
      {
        repository: new InMemoryMarketplaceRepository({
          [IN_MEMORY_REPOSITORY_TEST_HOOK]: [
            { collection: "runs", key: `${run.kind}:${run.runId}`, value: { ...run, unsupported: true } },
          ],
        }),
        read: (repository: InMemoryMarketplaceRepository) => repository.readRunSnapshot(run.kind, run.runId),
      },
      {
        repository: new InMemoryMarketplaceRepository({
          listings: [seededListing],
          [IN_MEMORY_REPOSITORY_TEST_HOOK]: [
            { collection: "receipts", key: receipt.purchaseId, value: { ...receipt, unsupported: true } },
          ],
        }),
        read: (repository: InMemoryMarketplaceRepository) => repository.readSettlementReceipt(receipt.purchaseId),
      },
      {
        repository: new InMemoryMarketplaceRepository({
          [IN_MEMORY_REPOSITORY_TEST_HOOK]: [
            {
              collection: "reconciliations",
              key: `${reconciliation.purchaseId}:attempt-corrupt`,
              value: { ...reconciliation, unsupported: true },
            },
          ],
        }),
        read: (repository: InMemoryMarketplaceRepository) =>
          repository.readReconciliationRecord(reconciliation.purchaseId, "attempt-corrupt"),
      },
      {
        repository: new InMemoryMarketplaceRepository({
          [IN_MEMORY_REPOSITORY_TEST_HOOK]: [
            { collection: "media", key: media.pathname, value: { unsupported: true } },
          ],
        }),
        read: (repository: InMemoryMarketplaceRepository) => repository.readPrivateMediaContent(media),
      },
    ];

    for (const { repository, read } of corruptions) {
      await expect(read(repository)).rejects.toBeInstanceOf(RepositoryDataError);
    }
  });

  it("maps schema-valid stored key and object mismatches to RepositoryDataError", async () => {
    const run = {
      runId: "analysis-run-expected",
      kind: "analysis" as const,
      status: "queued" as const,
      media: structuredClone(validDraft.media),
      photoIds: validDraft.media.map(({ id }) => id),
      geminiAttempts: 0,
      gemmaAttempts: 0,
      createdAt: "2026-08-21T10:00:00.000Z",
      updatedAt: "2026-08-21T10:00:00.000Z",
      attempt: 0,
    };
    const media = validDraft.media[0];
    const repositories = [
      {
        repository: new InMemoryMarketplaceRepository({
          [IN_MEMORY_REPOSITORY_TEST_HOOK]: [
            {
              collection: "listings",
              key: seededListing.listingId,
              value: { ...seededListing, listingId: "other-listing" },
            },
          ],
        }),
        read: (repository: InMemoryMarketplaceRepository) => repository.getListing(seededListing.listingId),
      },
      {
        repository: new InMemoryMarketplaceRepository({
          [IN_MEMORY_REPOSITORY_TEST_HOOK]: [
            {
              collection: "runs",
              key: `${run.kind}:${run.runId}`,
              value: { ...run, runId: "analysis-run-other" },
            },
          ],
        }),
        read: (repository: InMemoryMarketplaceRepository) => repository.readRunSnapshot(run.kind, run.runId),
      },
      {
        repository: new InMemoryMarketplaceRepository({
          [IN_MEMORY_REPOSITORY_TEST_HOOK]: [
            {
              collection: "media",
              key: media.pathname,
              value: {
                metadata: {
                  media: { ...media, alt: "Different but schema-valid alt text" },
                  size: 3,
                  uploadedAt: "2026-08-21T00:00:00.000Z",
                },
                bytes: new Uint8Array([1, 2, 3]),
              },
            },
          ],
        }),
        read: (repository: InMemoryMarketplaceRepository) => repository.readPrivateMediaMetadata(media),
      },
    ];

    for (const { repository, read } of repositories) {
      await expect(read(repository)).rejects.toBeInstanceOf(RepositoryDataError);
    }
  });

  it("clones private media bytes and metadata on every boundary", async () => {
    const media = validDraft.media[0];
    const source = new Uint8Array([1, 2, 3]);
    const repository = new InMemoryMarketplaceRepository({ media: [{ media, bytes: source }] });
    source[0] = 9;
    const first = await repository.readPrivateMediaContent(media);
    expect([...first.bytes]).toEqual([1, 2, 3]);
    first.bytes[0] = 8;
    expect([...(await repository.readPrivateMediaContent(media)).bytes]).toEqual([1, 2, 3]);
    expect((await repository.readPrivateMediaMetadata(media)).media.pathname).toBe(media.pathname);
  });
});
