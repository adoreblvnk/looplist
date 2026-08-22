import assert from "node:assert";
import test from "node:test";
import {
  ALLOWED_MIME_TYPES,
  MAX_FILE_SIZE_BYTES,
  AnalyzeInputSchema,
  AnalyzeOutputSchema,
  EbayListingSchema,
  PublishRequestSchema,
  EbayAdapterRecordSchema,
  RunMarkerSchema,
  EbayListing,
} from "../lib/domain/schemas";
import {
  isUploadImagePath,
  isDraftPath,
  isAdapterRecordPath,
  isSkillPath,
  isRunMarkerPath,
  isPathAllowed,
} from "../lib/domain/path-predicates";
import {
  detectImageFormat,
  validateImageBuffer,
} from "../lib/domain/image-validation";
import {
  validateEbayListing,
  createAdapterRecord,
  verifyAdapterRecordObject,
  computeListingHash,
} from "../lib/domain/ebay-adapter";
import {
  runBoundedRepairController,
  getRejectedExactPaths,
  getMutatedPaths,
  isPathPermitted,
} from "../lib/domain/repair-controller";

const validSampleListing: EbayListing = {
  title: "Nintendo Game Boy DMG-01 Classic Grey Console - Tested Working",
  description: "Authentic original Nintendo Game Boy console DMG-01 in classic grey. Tested and fully functional.",
  category: "Video Games & Consoles > Consoles",
  condition: "Very Good",
  priceSgd: 120,
  priceUsd: 90,
  itemSpecifics: {
    Brand: "Nintendo",
    Model: "Game Boy DMG-01",
    Color: "Grey",
  },
  imagePaths: [
    "uploads/img1.png",
    "uploads/img2.png",
    "uploads/img3.png",
  ],
};

test("1. Artifact-Specific Path Separation Tests", () => {
  assert.strictEqual(AnalyzeInputSchema.safeParse({ imagePaths: ["uploads/1.jpg", "uploads/2.jpg", "uploads/3.jpg"] }).success, true);
  assert.strictEqual(isUploadImagePath("uploads/photo.jpg"), true);
  assert.strictEqual(isUploadImagePath("uploads/photo.jpeg"), true);
  assert.strictEqual(isUploadImagePath("uploads/photo.png"), true);
  assert.strictEqual(isUploadImagePath("uploads/photo.webp"), true);

  assert.strictEqual(isUploadImagePath("drafts/draft-1.json"), false);
  assert.strictEqual(isUploadImagePath("adapter-records/rec-1.json"), false);
  assert.strictEqual(isUploadImagePath("skills/skill-1.json"), false);
  assert.strictEqual(isUploadImagePath("uploads/file.exe"), false);
  assert.strictEqual(isUploadImagePath("../etc/passwd"), false);

  assert.strictEqual(isDraftPath("drafts/draft-123.json"), true);
  assert.strictEqual(isDraftPath("uploads/photo.png"), false);

  assert.strictEqual(isAdapterRecordPath("adapter-records/ebay-adapter-123.json"), true);
  assert.strictEqual(isAdapterRecordPath("uploads/photo.png"), false);

  assert.strictEqual(isSkillPath("skills/repair-v1-123.json"), true);
  assert.strictEqual(isSkillPath("uploads/photo.png"), false);

  assert.strictEqual(isRunMarkerPath("run-metadata/run-123.json"), true);
  assert.strictEqual(isRunMarkerPath("uploads/photo.png"), false);

  assert.strictEqual(isPathAllowed("uploads/photo.png"), true);
  assert.strictEqual(isPathAllowed("drafts/draft-1.json"), true);
  assert.strictEqual(isPathAllowed("adapter-records/rec.json"), true);
  assert.strictEqual(isPathAllowed("skills/skill.json"), true);
  assert.strictEqual(isPathAllowed("run-metadata/run-1.json"), true);
  assert.strictEqual(isPathAllowed("demo/sample.png"), false);
});

test("2. Magic-Byte Detection and MIME Match Tests", () => {
  const jpegBuf = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const pngBuf = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0]);
  const webpBuf = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0, 0, 0, 0]);
  const corruptBuf = Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);

  assert.deepStrictEqual(detectImageFormat(jpegBuf), { mimeType: "image/jpeg", extension: ".jpg" });
  assert.deepStrictEqual(detectImageFormat(pngBuf), { mimeType: "image/png", extension: ".png" });
  assert.deepStrictEqual(detectImageFormat(webpBuf), { mimeType: "image/webp", extension: ".webp" });
  assert.strictEqual(detectImageFormat(corruptBuf), null);

  assert.strictEqual(validateImageBuffer(jpegBuf, "image/jpeg").extension, ".jpg");
  assert.strictEqual(validateImageBuffer(jpegBuf, "image/jpg").extension, ".jpg");
  assert.strictEqual(validateImageBuffer(pngBuf, "image/png").extension, ".png");
  assert.strictEqual(validateImageBuffer(webpBuf, "image/webp").extension, ".webp");

  assert.throws(() => validateImageBuffer(pngBuf, "image/jpeg"), /Mismatched image magic bytes/);
  assert.throws(() => validateImageBuffer(corruptBuf, "image/png"), /Invalid or unsupported image magic bytes/);
});

test("3. 4 MiB Limit Constants Tests", () => {
  assert.strictEqual(MAX_FILE_SIZE_BYTES, 4 * 1024 * 1024);
  assert.strictEqual(ALLOWED_MIME_TYPES.includes("image/jpeg" as const), true);
  assert.strictEqual(ALLOWED_MIME_TYPES.includes("image/png" as const), true);
  assert.strictEqual(ALLOWED_MIME_TYPES.includes("image/webp" as const), true);
});

test("4. Required Brand and Model Analysis Output Tests", () => {
  assert.strictEqual(EbayListingSchema.safeParse(validSampleListing).success, true);
  const validOutput = {
    identity: "Nintendo",
    model: "Game Boy DMG-01",
    category: "Consoles",
    accessories: ["Cartridge"],
    defects: [],
    condition: "Very Good" as const,
    confidence: 0.95,
    unresolvedQuestions: [],
    title: "Nintendo Game Boy DMG-01 Classic Grey Console",
    description: "Original Nintendo Game Boy console in good condition.",
    itemSpecifics: {
      Brand: "Nintendo",
      Model: "Game Boy DMG-01",
      Color: "Grey",
      Type: "Handheld System",
      Platform: "Nintendo Game Boy",
      CountryOrRegion: "Japan",
    },
    priceSuggestion: { sgd: 120, usd: 90, rationale: "Market average" },
  };
  assert.strictEqual(AnalyzeOutputSchema.safeParse(validOutput).success, true);

  const missingBrand = {
    ...validOutput,
    itemSpecifics: { Model: "Game Boy DMG-01" },
  };
  assert.strictEqual(AnalyzeOutputSchema.safeParse(missingBrand).success, false);

  const missingModel = {
    ...validOutput,
    itemSpecifics: { Brand: "Nintendo" },
  };
  assert.strictEqual(AnalyzeOutputSchema.safeParse(missingModel).success, false);
});

test("5. Deterministic Adapter Hash Tests", () => {
  const hash1 = computeListingHash(validSampleListing);
  const hash2 = computeListingHash(validSampleListing);
  assert.strictEqual(hash1, hash2);

  const rec1 = createAdapterRecord(validSampleListing);
  const rec2 = createAdapterRecord(validSampleListing);

  assert.strictEqual(rec1.adapterRecordPath, rec2.adapterRecordPath);
  assert.strictEqual(rec1.record.id, rec2.record.id);
  assert.strictEqual(rec1.record.listingId, rec2.record.listingId);
  assert.strictEqual(rec1.record.isAdapter, true);
});

test("6. Strict Adapter-Record and Run-Marker Parse Tests", () => {
  const { record } = createAdapterRecord(validSampleListing);
  const parseResult = EbayAdapterRecordSchema.safeParse(record);
  assert.strictEqual(parseResult.success, true);

  const malformedRecord = {
    ...record,
    status: "DRAFT",
  };
  assert.strictEqual(EbayAdapterRecordSchema.safeParse(malformedRecord).success, false);

  const validMarker = {
    runId: "run-abc-123",
    kind: "analysis",
    createdAt: new Date().toISOString(),
  };
  assert.strictEqual(RunMarkerSchema.safeParse(validMarker).success, true);

  const extraFieldMarker = {
    ...validMarker,
    extra: "not allowed in strict schema",
  };
  assert.strictEqual(RunMarkerSchema.safeParse(extraFieldMarker).success, false);
});

test("7. All-Field Mismatch Failure Tests", () => {
  const { record } = createAdapterRecord(validSampleListing);

  const mismatches = [
    { title: "Different Title" },
    { description: "Different description long enough" },
    { category: "Different Category" },
    { condition: "Good" as const },
    { priceSgd: 999 },
    { priceUsd: 888 },
    { itemSpecifics: { Brand: "Nintendo", Model: "Game Boy DMG-01", Color: "Blue" } },
    { imagePaths: ["uploads/img1.png", "uploads/img2.png", "uploads/img4.png"] },
  ];

  for (const patch of mismatches) {
    const alteredListing = { ...validSampleListing, ...patch };
    assert.throws(
      () => verifyAdapterRecordObject(record, alteredListing),
      /Independent verification failed/
    );
  }
});

test("8. Approval False Tests", () => {
  const rejectedPayload = {
    approved: false,
    listing: validSampleListing,
  };
  assert.strictEqual(PublishRequestSchema.safeParse(rejectedPayload).success, false);
});

test("9. Invalid-but-Bounded Draft Tests", () => {
  const longTitleDraft = {
    ...validSampleListing,
    title: "Nintendo Game Boy DMG-01 Classic Grey Console Super Long Title That Exceeds The Maximum Allowed Limit Of Eighty Characters Easily",
  };
  const validBoundedRequest = {
    approved: true,
    listing: longTitleDraft,
  };

  assert.strictEqual(PublishRequestSchema.safeParse(validBoundedRequest).success, true);

  const ebayValidation = validateEbayListing(longTitleDraft);
  assert.strictEqual(ebayValidation.valid, false);
  assert.ok("title" in ebayValidation.rejectedFields);
});

test("10. Exact Rejected Path Semantics & Non-Rejected Mutation Policy Rejection Tests", async () => {
  const longTitleDraft = {
    ...validSampleListing,
    title: "Nintendo Game Boy DMG-01 Classic Grey Console Super Long Title That Exceeds The Maximum Allowed Limit Of Eighty Characters Easily",
    description: "Original description that must remain unchanged.",
  };

  await assert.rejects(
    async () => {
      await runBoundedRepairController(longTitleDraft, {
        validateListing: validateEbayListing,
        repairWithGemini: async (listing) => ({
          ...(listing as EbayListing),
          title: "Nintendo Game Boy DMG-01 Classic Grey Console",
          description: "ATTACKER ATTEMPT TO MUTATE UNREJECTED DESCRIPTION FIELD",
        }),
      });
    },
    /Policy violation: Proposed repair mutated non-rejected path 'description'/
  );

  const validRepairResult = await runBoundedRepairController(longTitleDraft, {
    validateListing: validateEbayListing,
    repairWithGemini: async (listing) => ({
      ...(listing as EbayListing),
      title: "Nintendo Game Boy DMG-01 Classic Grey Console",
    }),
  });

  assert.strictEqual(validRepairResult.repaired, true);
  assert.strictEqual(validRepairResult.finalListing.title, "Nintendo Game Boy DMG-01 Classic Grey Console");
  assert.strictEqual(validRepairResult.finalListing.description, "Original description that must remain unchanged.");
});

test("11. Nested Exact-Path Enforcement Tests for ItemSpecifics", async () => {
  const invalidBrandListing = {
    ...validSampleListing,
    itemSpecifics: {
      Brand: "",
      Model: "Game Boy DMG-01",
      Color: "Grey",
    },
  };

  const validation = validateEbayListing(invalidBrandListing);
  assert.strictEqual(validation.valid, false);
  const rejectedPaths = getRejectedExactPaths(validation);
  assert.ok(rejectedPaths.has("itemSpecifics.Brand"));
  assert.strictEqual(rejectedPaths.has("itemSpecifics.Model"), false);

  const mutated = getMutatedPaths(invalidBrandListing, {
    ...invalidBrandListing,
    itemSpecifics: { ...invalidBrandListing.itemSpecifics, Brand: "Nintendo", Model: "UNAUTHORIZED MODEL MUTATION" },
  });
  assert.ok(mutated.has("itemSpecifics.Brand"));
  assert.ok(mutated.has("itemSpecifics.Model"));
  assert.strictEqual(isPathPermitted("itemSpecifics.Brand", rejectedPaths), true);
  assert.strictEqual(isPathPermitted("itemSpecifics.Model", rejectedPaths), false);

  await assert.rejects(
    async () => {
      await runBoundedRepairController(invalidBrandListing, {
        validateListing: validateEbayListing,
        repairWithGemini: async (listing) => {
          const l = listing as EbayListing;
          return {
            ...l,
            itemSpecifics: {
              ...l.itemSpecifics,
              Brand: "Nintendo",
              Model: "UNAUTHORIZED MODEL MUTATION",
            },
          };
        },
      });
    },
    /Policy violation: Proposed repair mutated non-rejected path 'itemSpecifics.Model'/
  );

  const repairResult = await runBoundedRepairController(invalidBrandListing, {
    validateListing: validateEbayListing,
    repairWithGemini: async (listing) => {
      const l = listing as EbayListing;
      return {
        ...l,
        itemSpecifics: {
          ...l.itemSpecifics,
          Brand: "Nintendo",
        },
      };
    },
  });

  assert.strictEqual(repairResult.repaired, true);
  assert.strictEqual(repairResult.finalListing.itemSpecifics.Brand, "Nintendo");
  assert.strictEqual(repairResult.finalListing.itemSpecifics.Model, "Game Boy DMG-01");
});

test("12. At Most Two Repair Calls Tests", async () => {
  const invalidDraft = {
    ...validSampleListing,
    title: "Too long title exceeding eighty characters limit for eBay listing compliance verification",
  };

  let attemptsExecuted = 0;
  await assert.rejects(
    async () => {
      await runBoundedRepairController(invalidDraft, {
        validateListing: validateEbayListing,
        repairWithGemini: async (listing) => {
          attemptsExecuted++;
          return listing as EbayListing;
        },
      });
    },
    /eBay validation repair failed after 2 attempts/
  );

  assert.strictEqual(attemptsExecuted, 2);
});

test("13. Skill Metadata Only Emerges After Valid Repair Tests", async () => {
  const validResult = await runBoundedRepairController(validSampleListing, {
    validateListing: validateEbayListing,
    repairWithGemini: async (listing) => listing as EbayListing,
  });

  assert.strictEqual(validResult.repaired, false);
  assert.strictEqual(validResult.repairMetadata, null);

  const invalidDraft = {
    ...validSampleListing,
    title: "Too long title exceeding eighty characters limit for eBay listing compliance verification",
  };

  const repairedResult = await runBoundedRepairController(invalidDraft, {
    validateListing: validateEbayListing,
    repairWithGemini: async () => ({
      ...validSampleListing,
      title: "Nintendo Game Boy DMG-01 Classic Grey Console",
    }),
  });

  assert.strictEqual(repairedResult.repaired, true);
  assert.strictEqual(repairedResult.repairAttempts, 1);
  assert.notStrictEqual(repairedResult.repairMetadata, null);
  assert.strictEqual(repairedResult.repairMetadata?.attemptNumber, 1);
  assert.strictEqual(repairedResult.repairMetadata?.repairedListing.title, "Nintendo Game Boy DMG-01 Classic Grey Console");
});
