import { describe, expect, it } from "vitest";
import {
  ANALYSIS_RUN_FAILURES,
  AnalysisRunStateSchema,
  BuyerSearchResultSchema,
  DEMO_BUYER,
  DEMO_SELLER,
  DemoIdentitySchema,
  ListingAttributesSchema,
  ListingDraftSchema,
  ListingSchema,
  MarketplaceCategorySchema,
  MediaReferenceSchema,
  MoneySchema,
  PaymentPendingListingSchema,
  PriceRecommendationSchema,
  PublicationRunStateSchema,
  PurchaseReservationSchema,
  PurchaseRunStateSchema,
  SeededSellerIdentitySchema,
  SettlementPendingListingSchema,
  SettlementReceiptSchema,
  SoldListingSchema,
  deterministicPurchaseId,
} from "../lib/domain/marketplace";
import {
  activeListing,
  comparable,
  money,
  paymentFingerprint,
  purchaseReservation,
  recommendation,
  reconciliationFailure,
  settlementReceipt,
  settlementSubmission,
  validDraft,
} from "./domain-fixtures";

function expectIssue(
  result: ReturnType<typeof ListingDraftSchema.safeParse>,
  path: PropertyKey[],
  message: RegExp
) {
  expect(result.success).toBe(false);
  if (!result.success) {
    expect(result.error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path, message: expect.stringMatching(message) }),
      ])
    );
  }
}

const runBase = {
  createdAt: "2026-08-21T09:59:00.000Z",
  updatedAt: "2026-08-21T10:08:00.000Z",
  attempt: 1,
};

const purchaseRunBase = {
  ...runBase,
  createdAt: purchaseReservation().createdAt,
};

function soldListing() {
  const reservation = purchaseReservation();
  const settlement = settlementSubmission(reservation.purchaseId);
  return {
    ...activeListing,
    state: "sold" as const,
    reservation,
    settlement,
    receipt: settlementReceipt(reservation.purchaseId),
  };
}

function succeededAnalysis(photoIds: string[]) {
  const fourthPhoto = {
    ...validDraft.media[0],
    id: "photo-4",
    pathname: "media/uploads/session-1/photo-4.webp",
    alt: "MacBook underside",
  };
  return {
    ...runBase,
    kind: "analysis" as const,
    media: [...validDraft.media, fourthPhoto],
    geminiAttempts: 1,
    gemmaAttempts: 1,
    attempt: 2,
    runId: "analysis-input-binding",
    status: "succeeded" as const,
    photoIds,
    startedAt: "2026-08-21T10:00:00.000Z",
    completedAt: "2026-08-21T10:01:00.000Z",
    draft: { ...validDraft, media: [...validDraft.media, fourthPhoto] },
    priceRecommendation: recommendation,
  };
}

function succeededPurchaseRun() {
  return {
    ...purchaseRunBase,
    kind: "purchase" as const,
    runId: "purchase-run-succeeded-hostile",
    status: "succeeded" as const,
    reservation: purchaseReservation(),
    listingTitle: activeListing.approvedDraft.title,
    seller: activeListing.seller,
    startedAt: "2026-08-21T10:01:00.000Z",
    completedAt: "2026-08-21T10:03:00.000Z",
    settlement: settlementSubmission(),
    receipt: settlementReceipt(),
  };
}

function submittedPurchaseRun(
  status: "settlement_pending" | "succeeded" | "reconciliation_failed",
  submittedAt: string
) {
  const settlement = { ...settlementSubmission(), submittedAt };
  const common = {
    ...purchaseRunBase,
    kind: "purchase" as const,
    runId: `purchase-run-${status}-timing`,
    status,
    reservation: purchaseReservation(),
    listingTitle: activeListing.approvedDraft.title,
    seller: activeListing.seller,
    startedAt: "2026-08-21T10:01:00.000Z",
    settlement,
  };
  if (status === "succeeded") {
    return {
      ...common,
      completedAt: "2026-08-21T10:08:00.000Z",
      receipt: { ...settlementReceipt(), settledAt: "2026-08-21T10:07:00.000Z" },
    };
  }
  if (status === "reconciliation_failed") {
    return {
      ...common,
      failure: { ...reconciliationFailure(), failedAt: "2026-08-21T10:07:00.000Z" },
    };
  }
  return common;
}

describe("authoritative marketplace records", () => {
  it("accepts the upstream electronics, running-shoe, and lifestyle-sneaker categories", () => {
    expect(MarketplaceCategorySchema.options).toEqual(["electronics", "running_shoes", "sneakers"]);
    expect(MarketplaceCategorySchema.parse("electronics")).toBe("electronics");
    expect(MarketplaceCategorySchema.parse("running_shoes")).toBe("running_shoes");
    expect(MarketplaceCategorySchema.parse("sneakers")).toBe("sneakers");
  });

  it("accepts complete listing, pricing, search, reservation, and receipt records", () => {
    expect(DemoIdentitySchema.parse(DEMO_SELLER)).toEqual(DEMO_SELLER);
    expect(DemoIdentitySchema.parse(DEMO_BUYER)).toEqual(DEMO_BUYER);
    expect(ListingDraftSchema.parse(validDraft)).toEqual(validDraft);
    expect(MoneySchema.parse(money())).toEqual(money());
    expect(PriceRecommendationSchema.parse(recommendation)).toEqual(recommendation);
    expect(ListingSchema.parse(activeListing)).toEqual(activeListing);
    expect(PurchaseReservationSchema.parse(purchaseReservation())).toEqual(purchaseReservation());
    expect(SettlementReceiptSchema.parse(settlementReceipt())).toEqual(settlementReceipt());

    const search = BuyerSearchResultSchema.parse({
      searchId: "search-1",
      query: "MacBook below 900 USDC with no visible screen damage",
      matches: [
        {
          listingId: activeListing.listingId,
          rank: 1,
          score: 0.96,
          title: activeListing.approvedDraft.title,
          price: activeListing.approvedPrice,
          fitExplanation: "The listing is within budget and its photos show no visible screen damage.",
          visibleDefects: ["Light top-case wear"],
          assumptions: activeListing.approvedDraft.assumptions,
        },
      ],
      createdAt: "2026-08-21T10:02:00.000Z",
    });
    expect(search.matches[0]?.rank).toBe(1);
  });

  it("rejects unknown listing fields", () => {
    const result = ListingDraftSchema.safeParse({ ...validDraft, unsupportedClaim: "tested working" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toContainEqual(
        expect.objectContaining({ code: "unrecognized_keys", path: [], keys: ["unsupportedClaim"] })
      );
    }
  });
});

describe("private media and photo-backed evidence", () => {
  it("accepts canonical private seed media paths", () => {
    expect(
      MediaReferenceSchema.parse({
        ...validDraft.media[0],
        pathname: "media/seed/listing-1/photo-1.webp",
      }).pathname
    ).toBe("media/seed/listing-1/photo-1.webp");
  });

  it.each([
    ["jpg", "image/jpeg"],
    ["jpeg", "image/jpeg"],
    ["png", "image/png"],
    ["webp", "image/webp"],
  ] as const)("accepts a canonical .%s path with matching %s MIME", (extension, mimeType) => {
    const media = {
      ...validDraft.media[0],
      pathname: `media/uploads/session-1/photo-1.${extension}`,
      mimeType,
    };
    expect(MediaReferenceSchema.parse(media)).toEqual(media);
  });

  it.each([
    ["URL", "https://cdn.example/photo-1.webp"],
    ["leading slash", "/media/uploads/session-1/photo-1.webp"],
    ["traversal", "media/uploads/../photo-1.webp"],
    ["backslash", "media\\uploads\\session-1\\photo-1.webp"],
    ["empty segment", "media/uploads//photo-1.webp"],
    ["query", "media/uploads/session-1/photo-1.webp?token=x"],
    ["fragment", "media/uploads/session-1/photo-1.webp#x"],
    ["unrelated prefix", "uploads/session-1/photo-1.webp"],
  ])("rejects a media pathname containing a %s", (_case, pathname) => {
    expect(MediaReferenceSchema.safeParse({ ...validDraft.media[0], pathname }).success).toBe(false);
  });

  it("rejects a canonical-looking pathname whose filename differs from its media ID", () => {
    const result = MediaReferenceSchema.safeParse({
      ...validDraft.media[0],
      pathname: "media/uploads/session-1/different-photo.webp",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toContainEqual(
        expect.objectContaining({ path: ["pathname"], message: expect.stringMatching(/match the media ID/) })
      );
    }
  });

  it.each([
    ["image/jpeg", "webp"],
    ["image/png", "jpg"],
    ["image/webp", "png"],
  ])("rejects %s when the pathname extension is .%s", (mimeType, extension) => {
    const result = MediaReferenceSchema.safeParse({
      ...validDraft.media[0],
      pathname: `media/uploads/session-1/photo-1.${extension}`,
      mimeType,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: ["mimeType"], message: expect.stringMatching(/match/) }),
        ])
      );
    }
  });

  it.each(["WEBP", "JPG", "JPEG", "PNG"])(
    "rejects the noncanonical uppercase .%s media extension",
    (extension) => {
      expect(
        MediaReferenceSchema.safeParse({
          ...validDraft.media[0],
          pathname: `media/uploads/session-1/photo-1.${extension}`,
        }).success
      ).toBe(false);
    }
  );

  it("rejects an empty evidence collection", () => {
    expectIssue(ListingDraftSchema.safeParse({ ...validDraft, evidence: [] }), ["evidence"], /too small/i);
  });

  it("rejects evidence with no condition or defect claim", () => {
    const evidence = [{ ...validDraft.evidence[0], kind: "identity" as const }];
    expectIssue(
      ListingDraftSchema.safeParse({ ...validDraft, evidence }),
      ["evidence"],
      /condition or defect photo evidence/
    );
  });

  it("rejects condition evidence not associated with a supplied photo", () => {
    const evidence = [{ ...validDraft.evidence[0], photoId: "photo-not-supplied" }];
    expectIssue(
      ListingDraftSchema.safeParse({ ...validDraft, evidence }),
      ["evidence", 0, "photoId"],
      /associated listing photo/
    );
  });
});

describe("canonical listing attribute keys", () => {
  it.each([" Color", "Color "])("rejects the whitespace-bearing key %j", (key) => {
    const result = ListingAttributesSchema.safeParse({ [key]: "Midnight" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([expect.objectContaining({ message: expect.stringMatching(/whitespace/) })])
      );
    }
  });

  it("rejects keys that collide after Unicode normalization", () => {
    const result = ListingAttributesSchema.safeParse({ Café: "one", "Cafe\u0301": "two" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([expect.objectContaining({ message: expect.stringMatching(/collide/) })])
      );
    }
  });

  it("rejects a lone decomposed non-NFC key", () => {
    const result = ListingAttributesSchema.safeParse({ "Cafe\u0301": "one" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([expect.objectContaining({ message: expect.stringMatching(/NFC/) })])
      );
    }
  });

  it("preserves accepted canonical attribute keys without normalization or rewriting", () => {
    const attributes = { Café: "one", Color: "Midnight" };
    const parsed = ListingAttributesSchema.parse(attributes);
    expect(parsed).toEqual(attributes);
    expect(Object.keys(parsed)).toEqual(["Café", "Color"]);
    expect(Object.hasOwn(parsed, "Cafe\u0301")).toBe(false);
  });
});

describe("strict fictional identities", () => {
  const seededSeller = {
    id: "seed-seller-jordan-lee",
    displayName: "Jordan Lee",
    role: "seller" as const,
    fictional: true as const,
  };

  it("accepts multiple named deterministic fictional seeded sellers", () => {
    expect(SeededSellerIdentitySchema.parse(seededSeller)).toEqual(seededSeller);
    expect(
      SeededSellerIdentitySchema.parse({
        id: "seed-seller-samira-patel",
        displayName: "Samira Patel",
        role: "seller",
        fictional: true,
      }).displayName
    ).toBe("Samira Patel");
  });

  it("rejects a seeded identity with a non-seller role", () => {
    expect(SeededSellerIdentitySchema.safeParse({ ...seededSeller, role: "buyer" }).success).toBe(false);
  });

  it("rejects a nonfictional seeded seller", () => {
    expect(SeededSellerIdentitySchema.safeParse({ ...seededSeller, fictional: false }).success).toBe(false);
  });

  it("requires seller-created listings to retain the fixed demo seller", () => {
    expect(ListingSchema.safeParse({ ...activeListing, seller: seededSeller }).success).toBe(false);
  });

  it("allows a seed listing to use its named fictional seeded seller", () => {
    expect(
      ListingSchema.parse({ ...activeListing, source: "seed", seller: seededSeller }).seller
    ).toEqual(seededSeller);
  });
});

describe("Gemma pricing explanations", () => {
  it("preserves bounded similarity score and reason for each selected comparable", () => {
    const parsed = PriceRecommendationSchema.parse(recommendation);
    expect(parsed.comparables[0]).toMatchObject({
      similarityScore: comparable.similarityScore,
      similarityReason: comparable.similarityReason,
    });
  });

  it("rejects a comparable score above one", () => {
    const comparables = [{ ...comparable, similarityScore: 1.01 }];
    expect(PriceRecommendationSchema.safeParse({ ...recommendation, comparables }).success).toBe(false);
  });

  it("rejects a missing comparable explanation", () => {
    const withoutReason = { ...comparable } as Partial<typeof comparable>;
    delete withoutReason.similarityReason;
    expect(
      PriceRecommendationSchema.safeParse({ ...recommendation, comparables: [withoutReason] }).success
    ).toBe(false);
  });

  it("rejects a strongest comparable ID absent from the explained comparables", () => {
    const result = PriceRecommendationSchema.safeParse({
      ...recommendation,
      strongestComparableIds: ["not-selected"],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toContainEqual(
        expect.objectContaining({ path: ["strongestComparableIds", 0] })
      );
    }
  });

  it("rejects a recommendation outside its exact range", () => {
    const result = PriceRecommendationSchema.safeParse({
      ...recommendation,
      recommendedPrice: money("950000000"),
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toContainEqual(
        expect.objectContaining({
          path: ["recommendedPrice", "atomicAmount"],
          message: "Recommended price must be within the recommendation range",
        })
      );
    }
  });

  it("returns an unsuccessful safe parse for a malformed recommendation amount", () => {
    const malformed = {
      ...recommendation,
      recommendedPrice: { ...recommendation.recommendedPrice, atomicAmount: "bad" },
    };

    expect(() => PriceRecommendationSchema.safeParse(malformed)).not.toThrow();
    const result = PriceRecommendationSchema.safeParse(malformed);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: ["recommendedPrice", "atomicAmount"] }),
        ])
      );
    }
  });
});

describe("deterministic sell-once purchase identity", () => {
  it("derives purchase identity solely from the validated listing ID", () => {
    expect(deterministicPurchaseId(activeListing.listingId)).toBe("purchase:listing-demo-1");
  });

  it("keeps a second payment fingerprint as evidence without creating a second purchase identity", () => {
    const first = PurchaseReservationSchema.parse(purchaseReservation(paymentFingerprint));
    const second = PurchaseReservationSchema.parse(purchaseReservation(`0x${"c".repeat(64)}`));
    expect(second.paymentFingerprint).not.toBe(first.paymentFingerprint);
    expect(second.purchaseId).toBe(first.purchaseId);
  });

  it("rejects a noncanonical payment fingerprint", () => {
    expect(
      PurchaseReservationSchema.safeParse(purchaseReservation(`0x${"B".repeat(64)}`)).success
    ).toBe(false);
  });

  it("rejects a nondeterministic purchase ID", () => {
    const result = PurchaseReservationSchema.safeParse({
      ...purchaseReservation(),
      purchaseId: "purchase:wrong-listing",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toContainEqual(
        expect.objectContaining({ path: ["purchaseId"], message: "Purchase ID is not deterministic" })
      );
    }
  });

  it("requires receipt ID to equal the deterministic purchase ID", () => {
    const result = SettlementReceiptSchema.safeParse({
      ...settlementReceipt(),
      receiptId: "purchase:different-listing",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toContainEqual(
        expect.objectContaining({ path: ["receiptId"], message: expect.stringMatching(/equal/) })
      );
    }
  });

  it("returns an ordinary unsuccessful safeParse result for a malformed reservation listing ID", () => {
    let result: ReturnType<typeof PurchaseReservationSchema.safeParse> | undefined;
    expect(() => {
      result = PurchaseReservationSchema.safeParse({
        ...purchaseReservation(),
        listingId: "malformed listing id",
      });
    }).not.toThrow();
    expect(result?.success).toBe(false);
  });

  it("returns an ordinary unsuccessful safeParse result for a malformed receipt listing ID", () => {
    let result: ReturnType<typeof SettlementReceiptSchema.safeParse> | undefined;
    expect(() => {
      result = SettlementReceiptSchema.safeParse({
        ...settlementReceipt(),
        listingId: "malformed listing id",
      });
    }).not.toThrow();
    expect(result?.success).toBe(false);
  });
});

describe("canonical persisted timestamps", () => {
  it.each([
    "2026-08-21T10:01:00Z",
    "2026-08-21T10:01:00.00Z",
    "2026-08-21T10:01:00.0000Z",
    "2026-08-21T10:01:00.000+00:00",
    "2026-08-21T11:01:00.000+01:00",
  ])("rejects the noncanonical timestamp %s", (createdAt) => {
    expect(
      PurchaseReservationSchema.safeParse({ ...purchaseReservation(), createdAt }).success
    ).toBe(false);
  });

  it("preserves a one-millisecond reservation boundary without comparison collapse", () => {
    expect(
      PurchaseReservationSchema.safeParse({
        ...purchaseReservation(),
        createdAt: "2026-08-21T10:01:00.000Z",
        expiresAt: "2026-08-21T10:01:00.001Z",
      }).success
    ).toBe(true);
    expect(
      PurchaseReservationSchema.safeParse({
        ...purchaseReservation(),
        createdAt: "2026-08-21T10:01:00.001Z",
        expiresAt: "2026-08-21T10:01:00.000Z",
      }).success
    ).toBe(false);
  });
});

describe("durable sold listing cross-object invariants", () => {
  it.each([
    [
      "listing",
      { listingId: "other-listing", purchaseId: "purchase:other-listing" },
    ],
    ["recipient", { recipientAddress: "0x3333333333333333333333333333333333333333" }],
    ["amount", { amount: money("850000001") }],
  ])("rejects direct payment_pending parsing with a mismatched reservation %s", (_field, patch) => {
    const reservation = purchaseReservation();
    expect(
      PaymentPendingListingSchema.safeParse({
        ...activeListing,
        state: "payment_pending",
        reservation: { ...reservation, ...patch },
        settlement: null,
        receipt: null,
      }).success
    ).toBe(false);
  });

  it("accepts a fully bound sold listing through the authoritative schema", () => {
    expect(ListingSchema.parse(soldListing()).state).toBe("sold");
  });

  it.each([
    ["title", { listingTitle: "Different approved listing title" }],
    ["recipient", { recipientAddress: "0x3333333333333333333333333333333333333333" }],
    ["amount", { amount: money("850000001") }],
  ])("rejects direct sold-state parsing with a tampered receipt %s", (_field, receiptPatch) => {
    const valid = soldListing();
    expect(
      SoldListingSchema.safeParse({
        ...valid,
        receipt: { ...valid.receipt, ...receiptPatch },
      }).success
    ).toBe(false);
  });

  it.each([
    ["buyer address", { buyerAddress: "0x3333333333333333333333333333333333333333" }, /buyer address/],
    ["recipient address", { recipientAddress: "0x3333333333333333333333333333333333333333" }, /recipient address/],
    ["exact amount", { amount: money("850000001") }, /exact amount/],
    ["listing title", { listingTitle: "Different approved listing title" }, /title/],
    ["settlement timestamp", { settledAt: "2026-08-21T10:00:59.999Z" }, /timestamp/],
  ])("rejects direct sold-schema parsing with a mismatched %s", (_field, receiptPatch, message) => {
    const valid = soldListing();
    const result = ListingSchema.safeParse({
      ...valid,
      receipt: { ...valid.receipt, ...receiptPatch },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([expect.objectContaining({ message: expect.stringMatching(message) })])
      );
    }
  });

  it("rejects a direct sold listing whose settlement submission predates its reservation", () => {
    const valid = soldListing();
    const result = ListingSchema.safeParse({
      ...valid,
      settlement: { ...valid.settlement, submittedAt: "2026-08-21T10:00:59.999Z" },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: ["settlement", "submittedAt"],
            message: expect.stringMatching(/must not predate the reservation/),
          }),
        ])
      );
    }
  });

  it("rejects a sold receipt listing identity that is internally valid but belongs to another listing", () => {
    const valid = soldListing();
    const result = ListingSchema.safeParse({
      ...valid,
      receipt: {
        ...valid.receipt,
        receiptId: "purchase:other-listing",
        purchaseId: "purchase:other-listing",
        listingId: "other-listing",
      },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: ["receipt", "listingId"], message: expect.stringMatching(/listing ID/) }),
        ])
      );
    }
  });

  it("accepts direct settlement_pending parsing when submission equals reservation creation", () => {
    const reservation = purchaseReservation();
    expect(
      SettlementPendingListingSchema.safeParse({
        ...activeListing,
        state: "settlement_pending",
        reservation,
        settlement: { ...settlementSubmission(), submittedAt: reservation.createdAt },
        receipt: null,
      }).success
    ).toBe(true);
  });

  it.each([
    ["before creation", "2026-08-21T10:00:59.999Z", /must not predate/],
    ["at expiry", "2026-08-21T10:06:00.000Z", /strictly before/],
  ])("rejects direct settlement_pending parsing with submission %s", (_case, submittedAt, message) => {
    const reservation = purchaseReservation();
    const result = SettlementPendingListingSchema.safeParse({
      ...activeListing,
      state: "settlement_pending",
      reservation,
      settlement: { ...settlementSubmission(), submittedAt },
      receipt: null,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: ["settlement", "submittedAt"],
            message: expect.stringMatching(message),
          }),
        ])
      );
    }
  });
});

describe("durable AI and publication outputs", () => {
  it("requires successful analysis to carry both validated outputs", () => {
    const succeeded = AnalysisRunStateSchema.parse({
      ...runBase,
      kind: "analysis",
      media: validDraft.media,
      geminiAttempts: 1,
      gemmaAttempts: 1,
      attempt: 2,
      runId: "analysis-1",
      status: "succeeded",
      photoIds: ["photo-1", "photo-2", "photo-3"],
      startedAt: "2026-08-21T10:00:00.000Z",
      completedAt: "2026-08-21T10:01:00.000Z",
      draft: validDraft,
      priceRecommendation: recommendation,
    });
    expect(succeeded).toMatchObject({ draft: validDraft, priceRecommendation: recommendation });
  });

  it.each([
    ["early Gemini failure", { geminiAttempts: 1, attempt: 1 }],
    ["Gemma attempts without a draft", { gemmaAttempts: 1, attempt: 3 }],
    ["wrong listing code", { error: ANALYSIS_RUN_FAILURES.gemma }],
    ["arbitrary listing message", { error: { ...ANALYSIS_RUN_FAILURES.gemini, message: "Another message" } }],
  ])("rejects %s in a failed analysis without a durable draft", (_case, mutation) => {
    const failed = {
      ...runBase,
      kind: "analysis" as const,
      runId: "analysis-failed-listing-stage",
      status: "failed" as const,
      media: validDraft.media,
      photoIds: validDraft.media.map(({ id }) => id),
      geminiAttempts: 2,
      gemmaAttempts: 0,
      attempt: 2,
      startedAt: "2026-08-21T10:00:00.000Z",
      failedAt: "2026-08-21T10:01:00.000Z",
      error: ANALYSIS_RUN_FAILURES.gemini,
    };
    expect(AnalysisRunStateSchema.safeParse(failed).success).toBe(true);
    expect(AnalysisRunStateSchema.safeParse({ ...failed, ...mutation }).success).toBe(false);
  });

  it.each([
    ["early Gemma failure", { gemmaAttempts: 1, attempt: 2 }],
    ["no Gemini attempt", { geminiAttempts: 0, attempt: 2 }],
    ["wrong pricing code", { error: ANALYSIS_RUN_FAILURES.gemini }],
    ["arbitrary pricing message", { error: { ...ANALYSIS_RUN_FAILURES.gemma, message: "Another message" } }],
  ])("rejects %s in a failed analysis with a durable draft", (_case, mutation) => {
    const failed = {
      ...runBase,
      kind: "analysis" as const,
      runId: "analysis-failed-pricing-stage",
      status: "failed" as const,
      media: validDraft.media,
      photoIds: validDraft.media.map(({ id }) => id),
      geminiAttempts: 1,
      gemmaAttempts: 2,
      attempt: 3,
      startedAt: "2026-08-21T10:00:00.000Z",
      failedAt: "2026-08-21T10:01:00.000Z",
      draft: validDraft,
      error: ANALYSIS_RUN_FAILURES.gemma,
    };
    expect(AnalysisRunStateSchema.safeParse(failed).success).toBe(true);
    expect(AnalysisRunStateSchema.safeParse({ ...failed, ...mutation }).success).toBe(false);
  });

  it.each([
    ["pathname", { pathname: "media/uploads/session-2/photo-1.webp" }],
    ["MIME", { pathname: "media/uploads/session-1/photo-1.png", mimeType: "image/png" }],
    ["alt", { alt: "Hostile replacement alt text" }],
    ["width", { width: validDraft.media[0].width + 1 }],
    ["height", { height: validDraft.media[0].height + 1 }],
  ])("rejects a draft whose same-ID media changes %s from the durable snapshot", (_case, change) => {
    const storedMedia = structuredClone(validDraft.media);
    storedMedia[0] = { ...storedMedia[0], ...change } as typeof storedMedia[number];
    expect(AnalysisRunStateSchema.safeParse({
      ...runBase,
      kind: "analysis",
      runId: `analysis-hostile-media-${_case}`,
      status: "succeeded",
      media: storedMedia,
      photoIds: storedMedia.map(({ id }) => id),
      geminiAttempts: 1,
      gemmaAttempts: 1,
      attempt: 2,
      startedAt: "2026-08-21T10:00:00.000Z",
      completedAt: "2026-08-21T10:01:00.000Z",
      draft: validDraft,
      priceRecommendation: recommendation,
    }).success).toBe(false);
  });

  it("rejects duplicate durable media pathnames even when IDs differ", () => {
    const storedMedia = structuredClone(validDraft.media);
    storedMedia[1] = { ...storedMedia[1], pathname: storedMedia[0].pathname };
    expect(AnalysisRunStateSchema.safeParse({
      ...runBase,
      kind: "analysis",
      runId: "analysis-duplicate-media-pathname",
      status: "queued",
      media: storedMedia,
      photoIds: storedMedia.map(({ id }) => id),
      geminiAttempts: 0,
      gemmaAttempts: 0,
      attempt: 0,
    }).success).toBe(false);
  });

  it("rejects successful analysis without a price recommendation", () => {
    expect(
      AnalysisRunStateSchema.safeParse({
        ...runBase,
        kind: "analysis",
      media: validDraft.media,
      geminiAttempts: 1,
      gemmaAttempts: 0,
        runId: "analysis-1",
        status: "succeeded",
        photoIds: ["photo-1", "photo-2", "photo-3"],
        startedAt: "2026-08-21T10:00:00.000Z",
        completedAt: "2026-08-21T10:01:00.000Z",
        draft: validDraft,
      }).success
    ).toBe(false);
  });

  it.each([
    ["missing", ["photo-1", "photo-2", "photo-3"], /exactly match/],
    ["extra", ["photo-1", "photo-2", "photo-3", "photo-4", "photo-5"], /exactly match/],
    ["duplicate", ["photo-1", "photo-2", "photo-3", "photo-3"], /unique/],
    ["unrelated", ["photo-1", "photo-2", "photo-3", "unrelated-photo"], /exactly match/],
  ])("rejects succeeded analysis with %s input photo IDs", (_case, photoIds, message) => {
    const result = AnalysisRunStateSchema.safeParse(succeededAnalysis(photoIds));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: ["photoIds"], message: expect.stringMatching(message) }),
        ])
      );
    }
  });

  it.each([
    ["queued", {}],
    ["running", { startedAt: "2026-08-21T10:00:00.000Z" }],
    [
      "succeeded",
      {
        startedAt: "2026-08-21T10:00:00.000Z",
        completedAt: "2026-08-21T10:01:00.000Z",
        draft: validDraft,
        priceRecommendation: recommendation,
      },
    ],
    [
      "failed",
      {
        startedAt: "2026-08-21T10:00:00.000Z",
        failedAt: "2026-08-21T10:01:00.000Z",
        error: { code: "analysis_failed", message: "Analysis failed after starting." },
      },
    ],
  ] as const)("rejects duplicate analysis photo IDs in the isolated %s branch", (status, fields) => {
    const result = AnalysisRunStateSchema.safeParse({
      ...runBase,
      ...fields,
      kind: "analysis",
      media: validDraft.media,
      geminiAttempts: 1,
      gemmaAttempts: 0,
      runId: `analysis-${status}-duplicate-inputs`,
      status,
      photoIds: ["photo-1", "photo-2", "photo-2"],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: ["photoIds"],
            message: "Analysis photo IDs must be unique",
          }),
        ])
      );
    }
  });

  it.each([
    ["queued", {}],
    ["running", { startedAt: "2026-08-21T10:00:00.000Z" }],
    [
      "succeeded",
      {
        startedAt: "2026-08-21T10:00:00.000Z",
        completedAt: "2026-08-21T10:01:00.000Z",
        listingId: activeListing.listingId,
      },
    ],
  ] as const)("binds the %s publication state to its approved draft and price", (status, fields) => {
    const parsed = PublicationRunStateSchema.parse({
      ...runBase,
      ...fields,
      kind: "publication",
      runId: `publication-${status}`,
      status,
      sellerApproved: true,
      approvedDraft: validDraft,
      approvedPrice: money(),
    });
    expect(parsed.approvedDraft).toEqual(validDraft);
    expect(parsed.approvedPrice).toEqual(money());
  });

  it("keeps the queued publication snapshot isolated from later external draft mutation", () => {
    const mutableDraft = structuredClone(validDraft);
    const queued = PublicationRunStateSchema.parse({
      ...runBase,
      kind: "publication",
      runId: "publication-retry",
      status: "queued",
      sellerApproved: true,
      approvedDraft: mutableDraft,
      approvedPrice: money(),
    });
    mutableDraft.title = "A later seller edit must not leak into a retry";
    expect(queued.approvedDraft.title).toBe(validDraft.title);
  });

  it("rejects publication without the exact final price snapshot", () => {
    expect(
      PublicationRunStateSchema.safeParse({
        ...runBase,
        kind: "publication",
        runId: "publication-1",
        status: "queued",
        sellerApproved: true,
        approvedDraft: validDraft,
      }).success
    ).toBe(false);
  });
});

describe("durable run chronology", () => {
  it("rejects an analysis run updated before creation", () => {
    expect(
      AnalysisRunStateSchema.safeParse({
        ...runBase,
        kind: "analysis",
      media: validDraft.media,
      geminiAttempts: 0,
      gemmaAttempts: 0,
        runId: "analysis-queued-chronology",
        status: "queued",
        attempt: 0,
        photoIds: ["photo-1", "photo-2", "photo-3"],
        updatedAt: "2026-08-21T09:58:59.999Z",
      }).success
    ).toBe(false);
  });

  it.each([
    ["running", { startedAt: "2026-08-21T09:58:59.999Z" }],
    [
      "succeeded",
      {
        startedAt: "2026-08-21T10:01:00.000Z",
        completedAt: "2026-08-21T10:00:59.999Z",
        draft: validDraft,
        priceRecommendation: recommendation,
      },
    ],
    [
      "failed",
      {
        startedAt: "2026-08-21T10:01:00.000Z",
        failedAt: "2026-08-21T10:00:59.999Z",
        error: { code: "analysis_failed", message: "Analysis failed after starting." },
      },
    ],
  ] as const)("rejects the analysis %s branch with reversed lifecycle times", (status, fields) => {
    expect(
      AnalysisRunStateSchema.safeParse({
        ...runBase,
        ...fields,
        kind: "analysis",
      media: validDraft.media,
      geminiAttempts: 1,
      gemmaAttempts: 0,
        runId: `analysis-${status}-chronology`,
        status,
        photoIds: ["photo-1", "photo-2", "photo-3"],
      }).success
    ).toBe(false);
  });

  it.each([
    [
      "succeeded",
      {
        startedAt: "2026-08-21T10:01:00.000Z",
        completedAt: "2026-08-21T10:00:59.999Z",
        listingId: activeListing.listingId,
      },
    ],
    [
      "failed",
      {
        startedAt: "2026-08-21T10:01:00.000Z",
        failedAt: "2026-08-21T10:00:59.999Z",
        error: { code: "publication_failed", message: "Publication failed after starting." },
      },
    ],
  ] as const)("rejects the publication %s branch with reversed lifecycle times", (status, fields) => {
    expect(
      PublicationRunStateSchema.safeParse({
        ...runBase,
        ...fields,
        kind: "publication",
        runId: `publication-${status}-chronology`,
        status,
        sellerApproved: true,
        approvedDraft: validDraft,
        approvedPrice: money(),
      }).success
    ).toBe(false);
  });

  it("rejects a purchase settlement submitted before its run started", () => {
    expect(
      PurchaseRunStateSchema.safeParse({
        ...submittedPurchaseRun("settlement_pending", "2026-08-21T10:02:00.000Z"),
        startedAt: "2026-08-21T10:03:00.000Z",
      }).success
    ).toBe(false);
  });

  it("rejects purchase completion before its represented settlement", () => {
    expect(
      PurchaseRunStateSchema.safeParse({
        ...succeededPurchaseRun(),
        completedAt: "2026-08-21T10:02:59.999Z",
      }).success
    ).toBe(false);
  });

  it("rejects a purchase run whose update predates its settlement submission", () => {
    expect(
      PurchaseRunStateSchema.safeParse({
        ...submittedPurchaseRun("settlement_pending", "2026-08-21T10:02:00.000Z"),
        updatedAt: "2026-08-21T10:01:59.999Z",
      }).success
    ).toBe(false);
  });
});

describe("durable purchase reconciliation runs", () => {
  it.each([
    ["queued", {}],
    ["running", { startedAt: "2026-08-21T10:01:00.000Z" }],
    [
      "settlement_pending",
      { startedAt: "2026-08-21T10:01:00.000Z", settlement: settlementSubmission() },
    ],
    [
      "succeeded",
      {
        startedAt: "2026-08-21T10:01:00.000Z",
        completedAt: "2026-08-21T10:03:00.000Z",
        settlement: settlementSubmission(),
        receipt: settlementReceipt(),
      },
    ],
    [
      "failed",
      {
        startedAt: "2026-08-21T10:01:00.000Z",
        failedAt: "2026-08-21T10:01:30.000Z",
        error: { code: "payment_submission_failed", message: "Payment submission failed before settlement." },
      },
    ],
    [
      "reconciliation_failed",
      {
        startedAt: "2026-08-21T10:01:00.000Z",
        settlement: settlementSubmission(),
        failure: reconciliationFailure(),
      },
    ],
  ] as const)("models strict %s purchase status without conflation", (status, fields) => {
    const parsed = PurchaseRunStateSchema.parse({
      ...purchaseRunBase,
      ...fields,
      kind: "purchase",
      runId: `purchase-run-${status}`,
      status,
      reservation: purchaseReservation(),
      listingTitle: activeListing.approvedDraft.title,
      seller: activeListing.seller,
    });
    expect(parsed.status).toBe(status);
  });

  it("does not interpret settlement_pending as failed", () => {
    const pending = PurchaseRunStateSchema.parse({
      ...purchaseRunBase,
      kind: "purchase",
      runId: "purchase-run-pending",
      status: "settlement_pending",
      reservation: purchaseReservation(),
      listingTitle: activeListing.approvedDraft.title,
      seller: activeListing.seller,
      startedAt: "2026-08-21T10:01:00.000Z",
      settlement: settlementSubmission(),
    });
    expect(pending.status).toBe("settlement_pending");
    expect("error" in pending).toBe(false);
  });

  it("rejects settlement references bound to a different purchase", () => {
    expect(
      PurchaseRunStateSchema.safeParse({
        ...purchaseRunBase,
        kind: "purchase",
        runId: "purchase-run-pending",
        status: "settlement_pending",
        reservation: purchaseReservation(),
        listingTitle: activeListing.approvedDraft.title,
        seller: activeListing.seller,
        startedAt: "2026-08-21T10:01:00.000Z",
        settlement: { ...settlementSubmission(), purchaseId: "purchase:other-listing" },
      }).success
    ).toBe(false);
  });

  it("rejects a settlement submission on generic pre-submission failed status", () => {
    expect(
      PurchaseRunStateSchema.safeParse({
        ...purchaseRunBase,
        kind: "purchase",
        runId: "purchase-run-generic-failed",
        status: "failed",
        reservation: purchaseReservation(),
        listingTitle: activeListing.approvedDraft.title,
        seller: activeListing.seller,
        startedAt: "2026-08-21T10:01:00.000Z",
        failedAt: "2026-08-21T10:01:30.000Z",
        settlement: settlementSubmission(),
        error: { code: "payment_submission_failed", message: "Payment submission failed." },
      }).success
    ).toBe(false);
  });

  it.each([
    ["queued", {}],
    ["running", { startedAt: "2026-08-21T10:01:00.000Z" }],
    [
      "failed",
      {
        startedAt: "2026-08-21T10:01:00.000Z",
        failedAt: "2026-08-21T10:01:30.000Z",
        error: { code: "payment_submission_failed", message: "Payment submission failed." },
      },
    ],
  ] as const)("rejects %s purchase creation/update before its reservation", (status, fields) => {
    const result = PurchaseRunStateSchema.safeParse({
      ...purchaseRunBase,
      ...fields,
      kind: "purchase",
      runId: `purchase-run-${status}-before-reservation`,
      status,
      reservation: purchaseReservation(),
      listingTitle: activeListing.approvedDraft.title,
      seller: activeListing.seller,
      createdAt: "2026-08-21T10:00:59.999Z",
      updatedAt: "2026-08-21T10:00:59.999Z",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: ["createdAt"],
            message: expect.stringMatching(/must not predate the reservation/),
          }),
        ])
      );
    }
  });

  it.each(["settlement_pending", "succeeded", "reconciliation_failed"] as const)(
    "rejects %s purchase creation/update before its reservation",
    (status) => {
      const result = PurchaseRunStateSchema.safeParse({
        ...submittedPurchaseRun(status, "2026-08-21T10:02:00.000Z"),
        createdAt: "2026-08-21T10:00:59.999Z",
        updatedAt: "2026-08-21T10:00:59.999Z",
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              path: ["createdAt"],
              message: expect.stringMatching(/must not predate the reservation/),
            }),
          ])
        );
      }
    }
  );

  it.each(["settlement_pending", "succeeded", "reconciliation_failed"] as const)(
    "accepts %s submission exactly at reservation creation",
    (status) => {
      expect(
        PurchaseRunStateSchema.safeParse(
          submittedPurchaseRun(status, purchaseReservation().createdAt)
        ).success
      ).toBe(true);
    }
  );

  it.each(["settlement_pending", "succeeded", "reconciliation_failed"] as const)(
    "rejects %s submission before reservation creation",
    (status) => {
      const result = PurchaseRunStateSchema.safeParse(
        submittedPurchaseRun(status, "2026-08-21T10:00:59.999Z")
      );
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              path: ["settlement", "submittedAt"],
              message: expect.stringMatching(/must not predate/),
            }),
          ])
        );
      }
    }
  );

  it.each(["settlement_pending", "succeeded", "reconciliation_failed"] as const)(
    "rejects %s submission exactly at reservation expiry",
    (status) => {
      const result = PurchaseRunStateSchema.safeParse(
        submittedPurchaseRun(status, purchaseReservation().expiresAt)
      );
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              path: ["settlement", "submittedAt"],
              message: expect.stringMatching(/strictly before/),
            }),
          ])
        );
      }
    }
  );

  it.each([
    ["missing reason", { reason: "" }, /too small/i],
    ["mismatched payment reference", { x402PaymentReference: "different-reference" }, /payment reference/],
    ["failure before submission", { failedAt: "2026-08-21T10:01:59.999Z" }, /timestamp/],
  ])("rejects reconciliation_failed with %s", (_case, failurePatch, message) => {
    const valid = submittedPurchaseRun("reconciliation_failed", "2026-08-21T10:02:00.000Z");
    if (!("failure" in valid)) throw new Error("Expected reconciliation failure fixture");
    const result = PurchaseRunStateSchema.safeParse({
      ...valid,
      failure: { ...valid.failure, ...failurePatch },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([expect.objectContaining({ message: expect.stringMatching(message) })])
      );
    }
  });

  it("rejects reconciliation_failed without its terminal failure record", () => {
    const valid = submittedPurchaseRun("reconciliation_failed", "2026-08-21T10:02:00.000Z");
    if (!("failure" in valid)) throw new Error("Expected reconciliation failure fixture");
    const withoutFailure: Record<string, unknown> = { ...valid };
    delete withoutFailure.failure;
    expect(PurchaseRunStateSchema.safeParse(withoutFailure).success).toBe(false);
  });

  it("rejects reconciliation_failed without its terminal failure time", () => {
    const valid = submittedPurchaseRun("reconciliation_failed", "2026-08-21T10:02:00.000Z");
    if (!("failure" in valid)) throw new Error("Expected reconciliation failure fixture");
    const failureWithoutTime: Record<string, unknown> = { ...valid.failure };
    delete failureWithoutTime.failedAt;
    expect(
      PurchaseRunStateSchema.safeParse({ ...valid, failure: failureWithoutTime }).success
    ).toBe(false);
  });

  it.each([
    ["exact amount", { amount: money("850000001") }, /exact amount/],
    ["buyer address", { buyerAddress: "0x3333333333333333333333333333333333333333" }, /buyer address/],
    ["recipient address", { recipientAddress: "0x3333333333333333333333333333333333333333" }, /recipient address/],
    ["listing title", { listingTitle: "Different immutable listing title" }, /title/],
    [
      "seller identity",
      {
        seller: {
          id: "seed-seller-other",
          displayName: "Other Seller",
          role: "seller" as const,
          fictional: true as const,
        },
      },
      /seller identity/,
    ],
  ])("rejects succeeded purchase run with a tampered %s", (_field, receiptPatch, message) => {
    const valid = succeededPurchaseRun();
    const result = PurchaseRunStateSchema.safeParse({
      ...valid,
      receipt: { ...valid.receipt, ...receiptPatch },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: expect.arrayContaining(["receipt"]), message: expect.stringMatching(message) }),
        ])
      );
    }
  });
});
