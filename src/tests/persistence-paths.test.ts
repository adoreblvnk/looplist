import { describe, expect, it } from "vitest";
import {
  DurableRunPathSchema,
  PublishedListingPathSchema,
  ReconciliationRecordPathSchema,
  SettlementReceiptPathSchema,
  durableRunPath,
  publishedListingPath,
  reconciliationRecordPath,
  seedMediaPath,
  settlementReceiptPath,
  uploadedMediaPath,
} from "../lib/persistence/paths";
import { MediaReferenceSchema } from "../lib/domain/marketplace";

describe("private persistence path builders", () => {
  it("builds explicit operation-specific record paths", () => {
    expect(publishedListingPath("listing-1")).toBe("records/listings/listing-1/published.json");
    expect(durableRunPath("analysis", "run-1")).toBe("records/runs/analysis/run-1.json");
    expect(durableRunPath("publication", "run-2")).toBe("records/runs/publication/run-2.json");
    expect(durableRunPath("purchase", "run-3")).toBe("records/runs/purchase/run-3.json");
    expect(settlementReceiptPath("purchase:listing-1")).toBe("records/settlements/receipts/purchase:listing-1.json");
    expect(reconciliationRecordPath("purchase:listing-1", "failure-1")).toBe("records/settlements/reconciliation/purchase:listing-1/failure-1.json");
  });

  it("builds media paths aligned with MediaReference grammar", () => {
    const seedPath = seedMediaPath("listing-1", "photo-1", "jpg");
    const uploadPath = uploadedMediaPath("session-1", "photo-2", "webp");
    expect(MediaReferenceSchema.safeParse({ id: "photo-1", pathname: seedPath, mediaType: "image", mimeType: "image/jpeg", alt: "Photo one", width: 10, height: 10 }).success).toBe(true);
    expect(MediaReferenceSchema.safeParse({ id: "photo-2", pathname: uploadPath, mediaType: "image", mimeType: "image/webp", alt: "Photo two", width: 10, height: 10 }).success).toBe(true);
  });

  it("keeps stored path schemas exactly aligned with 64-character builder segments", () => {
    const max = "a".repeat(64);
    const tooLong = "a".repeat(65);
    expect(PublishedListingPathSchema.safeParse(publishedListingPath(max)).success).toBe(true);
    expect(DurableRunPathSchema.safeParse(durableRunPath("analysis", max)).success).toBe(true);
    expect(SettlementReceiptPathSchema.safeParse(settlementReceiptPath(`purchase:${max}`)).success).toBe(true);
    expect(ReconciliationRecordPathSchema.safeParse(reconciliationRecordPath(`purchase:${max}`, max)).success).toBe(true);

    expect(() => publishedListingPath(tooLong)).toThrow();
    expect(() => durableRunPath("analysis", tooLong)).toThrow();
    expect(() => settlementReceiptPath(`purchase:${tooLong}`)).toThrow();
    expect(() => reconciliationRecordPath("purchase:x", tooLong)).toThrow();
    expect(PublishedListingPathSchema.safeParse(`records/listings/${tooLong}/published.json`).success).toBe(false);
    expect(DurableRunPathSchema.safeParse(`records/runs/analysis/${tooLong}.json`).success).toBe(false);
    expect(SettlementReceiptPathSchema.safeParse(`records/settlements/receipts/purchase:${tooLong}.json`).success).toBe(false);
    expect(ReconciliationRecordPathSchema.safeParse(`records/settlements/reconciliation/purchase:x/${tooLong}.json`).success).toBe(false);
  });

  it.each([
    "../escape",
    "a/../../escape",
    "/absolute",
    "https://example.com/file",
    "http:%2F%2Fexample.com",
    "back\\slash",
    "query?x=1",
    "fragment#x",
    "",
    ".",
    "two words",
  ])("rejects hostile identifier %j", (hostile) => {
    expect(() => publishedListingPath(hostile)).toThrow();
    expect(() => durableRunPath("analysis", hostile)).toThrow();
    expect(() => seedMediaPath(hostile, "photo-1", "jpg")).toThrow();
    expect(() => uploadedMediaPath("session-1", hostile, "jpg")).toThrow();
  });

  it("rejects unsupported run kinds and purchase IDs", () => {
    expect(() => durableRunPath("preflight" as "analysis", "run-1")).toThrow();
    expect(() => settlementReceiptPath("listing-1")).toThrow();
    expect(() => reconciliationRecordPath("purchase:../listing", "failure-1")).toThrow();
    expect(() => seedMediaPath("listing-1", "photo-1", "jpg/../../secret" as "jpg")).toThrow();
    expect(() => uploadedMediaPath("session-1", "photo-1", "JPG" as "jpg")).toThrow();
  });

  it.each([
    [PublishedListingPathSchema, "records/listings/x/../../secret.json"],
    [PublishedListingPathSchema, "https://store/records/listings/x/published.json"],
    [DurableRunPathSchema, "records/runs/preflight/run.json"],
    [DurableRunPathSchema, "records/runs/analysis/../run.json"],
    [SettlementReceiptPathSchema, "/records/settlements/receipts/purchase:x.json"],
    [ReconciliationRecordPathSchema, "records/settlements/reconciliation/purchase:x/http://evil.json"],
  ])("strict pathname schemas reject hostile stored path", (schema, pathname) => {
    expect(schema.safeParse(pathname).success).toBe(false);
  });
});
