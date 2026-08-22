import { z } from "zod";
import { UsdcAtomicAmountSchema } from "./usdc";

export const BASE_SEPOLIA_NETWORK = "eip155:84532" as const;
export const USDC_CURRENCY = "USDC" as const;

const IdentifierSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/, "Identifier contains unsupported characters");
const PurchaseIdSchema = z
  .string()
  .min(10)
  .max(73)
  .regex(/^purchase:[a-zA-Z0-9][a-zA-Z0-9_-]*$/, "Invalid deterministic purchase ID");
const TimestampSchema = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    "Timestamp must use canonical UTC millisecond precision"
  )
  .refine(
    (timestamp) => {
      const parsed = new Date(timestamp);
      return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === timestamp;
    },
    "Timestamp must be a valid canonical UTC instant"
  );
const EvmAddressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Invalid EVM address");
const BoundedLabelSchema = z.string().trim().min(1).max(120);
const BoundedTextSchema = z.string().trim().min(1).max(500);

export const DEMO_SELLER = {
  id: "demo-seller",
  displayName: "Maya Chen",
  role: "seller",
  fictional: true,
} as const;

export const DEMO_BUYER = {
  id: "demo-buyer",
  displayName: "Alex Rivera",
  role: "buyer",
  fictional: true,
} as const;

const DemoSellerIdentitySchema = z
  .object({
    id: z.literal(DEMO_SELLER.id),
    displayName: z.literal(DEMO_SELLER.displayName),
    role: z.literal(DEMO_SELLER.role),
    fictional: z.literal(true),
  })
  .strict();

export const SeededSellerIdentitySchema = z
  .object({
    id: IdentifierSchema.regex(
      /^seed-seller-[a-zA-Z0-9][a-zA-Z0-9_-]*$/,
      "Seeded seller ID must use the seed-seller prefix"
    ),
    displayName: BoundedLabelSchema,
    role: z.literal("seller"),
    fictional: z.literal(true),
  })
  .strict();

export const SellerIdentitySchema = z.union([
  DemoSellerIdentitySchema,
  SeededSellerIdentitySchema,
]);

const DemoBuyerIdentitySchema = z
  .object({
    id: z.literal(DEMO_BUYER.id),
    displayName: z.literal(DEMO_BUYER.displayName),
    role: z.literal(DEMO_BUYER.role),
    fictional: z.literal(true),
  })
  .strict();

export const DemoIdentitySchema = z.union([
  SellerIdentitySchema,
  DemoBuyerIdentitySchema,
]);
export type DemoIdentity = z.infer<typeof DemoIdentitySchema>;
export type DemoSellerIdentity = z.infer<typeof DemoSellerIdentitySchema>;
export type DemoBuyerIdentity = z.infer<typeof DemoBuyerIdentitySchema>;
export type SeededSellerIdentity = z.infer<typeof SeededSellerIdentitySchema>;
export type SellerIdentity = z.infer<typeof SellerIdentitySchema>;

export const MarketplaceCategorySchema = z.enum(["electronics", "running_shoes", "sneakers"]);
export type MarketplaceCategory = z.infer<typeof MarketplaceCategorySchema>;

export const ListingConditionSchema = z.enum([
  "new",
  "like_new",
  "very_good",
  "good",
  "acceptable",
  "for_parts",
]);
export type ListingCondition = z.infer<typeof ListingConditionSchema>;

export const ConfidenceLabelSchema = z.enum(["low", "medium", "high"]);
export type ConfidenceLabel = z.infer<typeof ConfidenceLabelSchema>;

export const MediaReferenceSchema = z
  .object({
    id: IdentifierSchema,
    pathname: z
      .string()
      .min(1)
      .max(512)
      .regex(
        /^media\/(?:seed\/[a-zA-Z0-9][a-zA-Z0-9_-]*|uploads\/[a-zA-Z0-9][a-zA-Z0-9_-]*)\/[a-zA-Z0-9][a-zA-Z0-9_-]*\.(?:jpg|jpeg|png|webp)$/,
        "Media pathname must be a canonical private seed or upload path"
      ),
    mediaType: z.literal("image"),
    mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
    alt: z.string().trim().min(1).max(200),
    width: z.number().int().min(1).max(20_000),
    height: z.number().int().min(1).max(20_000),
  })
  .strict()
  .superRefine((media, context) => {
    const filename = media.pathname.split("/").at(-1);
    const pathnameMediaId = filename?.slice(0, filename.lastIndexOf("."));
    if (pathnameMediaId !== media.id) {
      context.addIssue({
        code: "custom",
        path: ["pathname"],
        message: "Media pathname filename must match the media ID",
      });
    }
    const extension = filename?.slice(filename.lastIndexOf(".") + 1);
    const mimeTypeByExtension: Record<string, "image/jpeg" | "image/png" | "image/webp"> = {
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
      webp: "image/webp",
    };
    if (extension && mimeTypeByExtension[extension] !== media.mimeType) {
      context.addIssue({
        code: "custom",
        path: ["mimeType"],
        message: "Media MIME type must match the canonical lowercase pathname extension",
      });
    }
  });
export type MediaReference = z.infer<typeof MediaReferenceSchema>;

export function mediaReferencesEqual(left: MediaReference, right: MediaReference): boolean {
  return (
    left.id === right.id &&
    left.pathname === right.pathname &&
    left.mediaType === right.mediaType &&
    left.mimeType === right.mimeType &&
    left.alt === right.alt &&
    left.width === right.width &&
    left.height === right.height
  );
}

export const PhotoEvidenceSchema = z
  .object({
    id: IdentifierSchema,
    photoId: IdentifierSchema,
    kind: z.enum(["identity", "accessory", "condition", "defect"]),
    claim: z.string().trim().min(3).max(500),
    confidence: ConfidenceLabelSchema,
  })
  .strict();
export type PhotoEvidence = z.infer<typeof PhotoEvidenceSchema>;

export const EditableAssumptionSchema = z
  .object({
    id: IdentifierSchema,
    field: z.string().trim().min(1).max(80),
    value: z.string().trim().min(1).max(500),
    confidence: ConfidenceLabelSchema,
    editable: z.literal(true),
    verified: z.literal(false),
    sellerEdited: z.boolean(),
  })
  .strict();
export type EditableAssumption = z.infer<typeof EditableAssumptionSchema>;

const ListingAttributeKeySchema = z.string().min(1).max(60);
export const ListingAttributesSchema = z
  .record(ListingAttributeKeySchema, z.string().trim().min(1).max(200))
  .superRefine((attributes, context) => {
    const canonicalKeys = new Map<string, string>();
    Object.keys(attributes).forEach((key) => {
      const canonicalKey = key.trim().normalize("NFC");
      if (key !== key.trim()) {
        context.addIssue({
          code: "custom",
          path: [key],
          message: "Listing attribute keys must not contain leading or trailing whitespace",
        });
      }
      if (key !== key.normalize("NFC")) {
        context.addIssue({
          code: "custom",
          path: [key],
          message: "Listing attribute keys must use canonical NFC normalization",
        });
      }
      const existing = canonicalKeys.get(canonicalKey);
      if (existing !== undefined && existing !== key) {
        context.addIssue({
          code: "custom",
          path: [key],
          message: "Listing attribute keys must not collide after canonical normalization",
        });
      } else {
        canonicalKeys.set(canonicalKey, key);
      }
    });
    if (Object.keys(attributes).length > 24) {
      context.addIssue({
        code: "custom",
        message: "Listings support at most 24 attributes",
      });
    }
  });
export type ListingAttributes = z.infer<typeof ListingAttributesSchema>;

export const ListingDraftSchema = z
  .object({
    title: z.string().trim().min(5).max(80),
    description: z.string().trim().min(20).max(3_000),
    category: MarketplaceCategorySchema,
    brand: BoundedLabelSchema,
    model: BoundedLabelSchema,
    condition: ListingConditionSchema,
    attributes: ListingAttributesSchema,
    includedAccessories: z.array(BoundedLabelSchema).max(20),
    visiblyMissingAccessories: z.array(BoundedLabelSchema).max(20),
    media: z.array(MediaReferenceSchema).min(3).max(8),
    evidence: z.array(PhotoEvidenceSchema).min(1).max(32),
    assumptions: z.array(EditableAssumptionSchema).max(16),
  })
  .strict()
  .superRefine((draft, context) => {
    const photoIds = new Set(draft.media.map(({ id }) => id));
    if (photoIds.size !== draft.media.length) {
      context.addIssue({ code: "custom", path: ["media"], message: "Media IDs must be unique" });
    }

    const evidenceIds = new Set<string>();
    draft.evidence.forEach((evidence, index) => {
      if (!photoIds.has(evidence.photoId)) {
        context.addIssue({
          code: "custom",
          path: ["evidence", index, "photoId"],
          message: "Evidence must reference an associated listing photo",
        });
      }
      if (evidenceIds.has(evidence.id)) {
        context.addIssue({ code: "custom", path: ["evidence", index, "id"], message: "Evidence IDs must be unique" });
      }
      evidenceIds.add(evidence.id);
    });
    if (!draft.evidence.some(({ kind }) => kind === "condition" || kind === "defect")) {
      context.addIssue({
        code: "custom",
        path: ["evidence"],
        message: "Listing condition must be supported by condition or defect photo evidence",
      });
    }
  });
export type ListingDraft = z.infer<typeof ListingDraftSchema>;

export const MoneySchema = z
  .object({
    currency: z.literal(USDC_CURRENCY),
    network: z.literal(BASE_SEPOLIA_NETWORK),
    atomicAmount: UsdcAtomicAmountSchema.refine((amount) => amount !== "0", "Money amount must be greater than zero"),
  })
  .strict();
export type Money = z.infer<typeof MoneySchema>;

export const SoldComparableSchema = z
  .object({
    comparableId: IdentifierSchema,
    title: z.string().trim().min(5).max(80),
    category: MarketplaceCategorySchema,
    brand: BoundedLabelSchema,
    model: BoundedLabelSchema,
    condition: ListingConditionSchema,
    attributes: ListingAttributesSchema,
    includedAccessories: z.array(BoundedLabelSchema).max(20),
    similarityScore: z.number().finite().min(0).max(1),
    similarityReason: z.string().trim().min(10).max(500),
    soldPrice: MoneySchema,
    soldAt: TimestampSchema,
  })
  .strict();
export type SoldComparable = z.infer<typeof SoldComparableSchema>;

export const PriceRecommendationSchema = z
  .object({
    recommendedPrice: MoneySchema,
    minimumPrice: MoneySchema,
    maximumPrice: MoneySchema,
    comparables: z.array(SoldComparableSchema).min(1).max(8),
    strongestComparableIds: z.array(IdentifierSchema).min(1).max(3),
    rationale: z.string().trim().min(20).max(1_500),
  })
  .strict()
  .superRefine((recommendation, context) => {
    const minimumAmount = UsdcAtomicAmountSchema.safeParse(
      recommendation.minimumPrice.atomicAmount
    );
    const recommendedAmount = UsdcAtomicAmountSchema.safeParse(
      recommendation.recommendedPrice.atomicAmount
    );
    const maximumAmount = UsdcAtomicAmountSchema.safeParse(
      recommendation.maximumPrice.atomicAmount
    );
    if (minimumAmount.success && recommendedAmount.success && maximumAmount.success) {
      const minimum = BigInt(minimumAmount.data);
      const recommended = BigInt(recommendedAmount.data);
      const maximum = BigInt(maximumAmount.data);
      if (minimum > recommended || recommended > maximum) {
        context.addIssue({
          code: "custom",
          path: ["recommendedPrice", "atomicAmount"],
          message: "Recommended price must be within the recommendation range",
        });
      }
    }

    const comparableIds = new Set(recommendation.comparables.map(({ comparableId }) => comparableId));
    const strongestIds = new Set<string>();
    recommendation.strongestComparableIds.forEach((id, index) => {
      if (!comparableIds.has(id)) {
        context.addIssue({
          code: "custom",
          path: ["strongestComparableIds", index],
          message: "Strongest comparable must be included in comparables",
        });
      }
      if (strongestIds.has(id)) {
        context.addIssue({
          code: "custom",
          path: ["strongestComparableIds", index],
          message: "Strongest comparable IDs must be unique",
        });
      }
      strongestIds.add(id);
    });
  });
export type PriceRecommendation = z.infer<typeof PriceRecommendationSchema>;

export const PaymentFingerprintSchema = z
  .string()
  .regex(/^0x[a-f0-9]{64}$/, "Payment fingerprint must be a canonical lowercase 32-byte hex string");
export type PaymentFingerprint = z.infer<typeof PaymentFingerprintSchema>;

export function deterministicPurchaseId(listingId: string): string {
  return PurchaseIdSchema.parse(`purchase:${IdentifierSchema.parse(listingId)}`);
}

function safeDeterministicPurchaseId(listingId: string): string | undefined {
  const parsedListingId = IdentifierSchema.safeParse(listingId);
  if (!parsedListingId.success) return undefined;
  const purchaseId = PurchaseIdSchema.safeParse(`purchase:${parsedListingId.data}`);
  return purchaseId.success ? purchaseId.data : undefined;
}

export const PurchaseReservationSchema = z
  .object({
    purchaseId: PurchaseIdSchema,
    listingId: IdentifierSchema,
    buyer: DemoBuyerIdentitySchema,
    buyerAddress: EvmAddressSchema,
    recipientAddress: EvmAddressSchema,
    amount: MoneySchema,
    createdAt: TimestampSchema,
    expiresAt: TimestampSchema,
    paymentFingerprint: PaymentFingerprintSchema,
  })
  .strict()
  .superRefine((reservation, context) => {
    const expectedPurchaseId = safeDeterministicPurchaseId(reservation.listingId);
    if (expectedPurchaseId !== undefined && reservation.purchaseId !== expectedPurchaseId) {
      context.addIssue({ code: "custom", path: ["purchaseId"], message: "Purchase ID is not deterministic" });
    }
    if (Date.parse(reservation.expiresAt) <= Date.parse(reservation.createdAt)) {
      context.addIssue({ code: "custom", path: ["expiresAt"], message: "Reservation expiry must follow creation" });
    }
  });
export type PurchaseReservation = z.infer<typeof PurchaseReservationSchema>;

export const SettlementReceiptSchema = z
  .object({
    receiptId: PurchaseIdSchema,
    purchaseId: PurchaseIdSchema,
    listingId: IdentifierSchema,
    listingTitle: z.string().trim().min(5).max(80),
    buyer: DemoBuyerIdentitySchema,
    seller: SellerIdentitySchema,
    buyerAddress: EvmAddressSchema,
    recipientAddress: EvmAddressSchema,
    amount: MoneySchema,
    x402PaymentReference: z.string().trim().min(1).max(500),
    settlementTransaction: z.string().regex(/^0x[a-fA-F0-9]{64}$/, "Invalid settlement transaction hash"),
    settledAt: TimestampSchema,
    status: z.literal("sold"),
  })
  .strict()
  .superRefine((receipt, context) => {
    const expectedPurchaseId = safeDeterministicPurchaseId(receipt.listingId);
    if (expectedPurchaseId !== undefined && receipt.purchaseId !== expectedPurchaseId) {
      context.addIssue({ code: "custom", path: ["purchaseId"], message: "Purchase ID is not deterministic" });
    }
    if (receipt.receiptId !== receipt.purchaseId) {
      context.addIssue({
        code: "custom",
        path: ["receiptId"],
        message: "Receipt ID must equal the deterministic purchase ID",
      });
    }
  });
export type SettlementReceipt = z.infer<typeof SettlementReceiptSchema>;

export interface ReceiptInvariantViolation {
  path: PropertyKey[];
  message: string;
}

function equalSnapshot(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function settlementReservationInvariantViolations(
  settlement: SettlementSubmission,
  reservation: PurchaseReservation
): ReceiptInvariantViolation[] {
  const violations: ReceiptInvariantViolation[] = [];
  if (settlement.purchaseId !== reservation.purchaseId) {
    violations.push({
      path: ["settlement", "purchaseId"],
      message: "Settlement submission must match the durable purchase reservation",
    });
  }
  if (Date.parse(settlement.submittedAt) < Date.parse(reservation.createdAt)) {
    violations.push({
      path: ["settlement", "submittedAt"],
      message: "Settlement submission timestamp must not predate the reservation",
    });
  }
  if (Date.parse(settlement.submittedAt) >= Date.parse(reservation.expiresAt)) {
    violations.push({
      path: ["settlement", "submittedAt"],
      message: "Settlement submission timestamp must be strictly before reservation expiry",
    });
  }
  return violations;
}

export function receiptReservationInvariantViolations(
  receipt: SettlementReceipt,
  reservation: PurchaseReservation
): ReceiptInvariantViolation[] {
  const violations: ReceiptInvariantViolation[] = [];
  const comparisons = [
    [receipt.purchaseId, reservation.purchaseId, ["receipt", "purchaseId"], "Receipt purchase ID must match the reservation"],
    [receipt.receiptId, reservation.purchaseId, ["receipt", "receiptId"], "Receipt ID must match the reservation purchase ID"],
    [receipt.listingId, reservation.listingId, ["receipt", "listingId"], "Receipt listing ID must match the reservation"],
    [receipt.buyer, reservation.buyer, ["receipt", "buyer"], "Receipt buyer identity must match the reservation"],
    [receipt.buyerAddress, reservation.buyerAddress, ["receipt", "buyerAddress"], "Receipt buyer address must match the reservation"],
    [receipt.recipientAddress, reservation.recipientAddress, ["receipt", "recipientAddress"], "Receipt recipient address must match the reservation"],
    [receipt.amount, reservation.amount, ["receipt", "amount"], "Receipt exact amount must match the reservation"],
  ] as const;

  for (const [actual, expected, path, message] of comparisons) {
    if (!equalSnapshot(actual, expected)) {
      violations.push({ path: [...path], message });
    }
  }
  if (Date.parse(receipt.settledAt) < Date.parse(reservation.createdAt)) {
    violations.push({
      path: ["receipt", "settledAt"],
      message: "Receipt settlement timestamp must not predate the reservation",
    });
  }
  return violations;
}

interface SoldReceiptContext {
  listingId: string;
  listingTitle: string;
  seller: SellerIdentity;
  recipientAddress: string;
  approvedPrice: Money;
  reservation: PurchaseReservation;
  settlement: SettlementSubmission;
  receipt: SettlementReceipt;
}

export function soldReceiptInvariantViolations(
  snapshot: SoldReceiptContext
): ReceiptInvariantViolation[] {
  const violations = [
    ...settlementReservationInvariantViolations(snapshot.settlement, snapshot.reservation),
    ...receiptReservationInvariantViolations(snapshot.receipt, snapshot.reservation),
  ];
  const comparisons = [
    [snapshot.receipt.listingId, snapshot.listingId, ["receipt", "listingId"], "Receipt listing ID must match the listing snapshot"],
    [snapshot.receipt.listingTitle, snapshot.listingTitle, ["receipt", "listingTitle"], "Receipt title must match the listing snapshot"],
    [snapshot.receipt.seller, snapshot.seller, ["receipt", "seller"], "Receipt seller identity must match the listing snapshot"],
    [snapshot.receipt.recipientAddress, snapshot.recipientAddress, ["receipt", "recipientAddress"], "Receipt recipient address must match the listing snapshot"],
    [snapshot.receipt.amount, snapshot.approvedPrice, ["receipt", "amount"], "Receipt exact amount must match the approved listing price"],
    [snapshot.receipt.x402PaymentReference, snapshot.settlement.x402PaymentReference, ["receipt", "x402PaymentReference"], "Receipt payment reference must match the settlement submission"],
    [snapshot.receipt.settlementTransaction, snapshot.settlement.settlementTransaction, ["receipt", "settlementTransaction"], "Receipt transaction reference must match the settlement submission"],
  ] as const;

  for (const [actual, expected, path, message] of comparisons) {
    if (!equalSnapshot(actual, expected)) {
      violations.push({ path: [...path], message });
    }
  }
  if (Date.parse(snapshot.receipt.settledAt) < Date.parse(snapshot.settlement.submittedAt)) {
    violations.push({
      path: ["receipt", "settledAt"],
      message: "Receipt settlement timestamp must not predate the settlement submission",
    });
  }
  return violations;
}

export const SettlementSubmissionSchema = z
  .object({
    purchaseId: PurchaseIdSchema,
    x402PaymentReference: z.string().trim().min(1).max(500),
    settlementTransaction: z.string().regex(/^0x[a-fA-F0-9]{64}$/, "Invalid settlement transaction hash"),
    submittedAt: TimestampSchema,
  })
  .strict();
export type SettlementSubmission = z.infer<typeof SettlementSubmissionSchema>;

export const ReconciliationFailureSchema = z
  .object({
    purchaseId: PurchaseIdSchema,
    x402PaymentReference: z.string().trim().min(1).max(500),
    settlementTransaction: z.string().regex(/^0x[a-fA-F0-9]{64}$/, "Invalid settlement transaction hash"),
    reason: z.string().trim().min(10).max(1_000),
    failedAt: TimestampSchema,
  })
  .strict();
export type ReconciliationFailure = z.infer<typeof ReconciliationFailureSchema>;

export function reconciliationFailureInvariantViolations(
  failure: ReconciliationFailure,
  settlement: SettlementSubmission
): ReceiptInvariantViolation[] {
  const violations: ReceiptInvariantViolation[] = [];
  const comparisons = [
    [failure.purchaseId, settlement.purchaseId, ["failure", "purchaseId"], "Reconciliation failure purchase ID must match the settlement submission"],
    [failure.x402PaymentReference, settlement.x402PaymentReference, ["failure", "x402PaymentReference"], "Reconciliation failure payment reference must match the settlement submission"],
    [failure.settlementTransaction, settlement.settlementTransaction, ["failure", "settlementTransaction"], "Reconciliation failure transaction reference must match the settlement submission"],
  ] as const;
  for (const [actual, expected, path, message] of comparisons) {
    if (actual !== expected) violations.push({ path: [...path], message });
  }
  if (Date.parse(failure.failedAt) < Date.parse(settlement.submittedAt)) {
    violations.push({
      path: ["failure", "failedAt"],
      message: "Reconciliation failure timestamp must not predate the settlement submission",
    });
  }
  return violations;
}

const ListingBaseSchema = z
  .object({
    listingId: IdentifierSchema,
    source: z.enum(["seed", "seller"]),
    seller: SellerIdentitySchema,
    recipientAddress: EvmAddressSchema,
    approvedDraft: ListingDraftSchema,
    approvedPrice: MoneySchema,
    publishedAt: TimestampSchema,
    lastReconciliationFailure: ReconciliationFailureSchema.nullable(),
  })
  .strict();

const ActiveListingObjectSchema = ListingBaseSchema.extend({
  state: z.literal("active"),
  reservation: z.null(),
  settlement: z.null(),
  receipt: z.null(),
}).strict();

const PaymentPendingListingObjectSchema = ListingBaseSchema.extend({
  state: z.literal("payment_pending"),
  reservation: PurchaseReservationSchema,
  settlement: z.null(),
  receipt: z.null(),
}).strict();

const SettlementPendingListingObjectSchema = ListingBaseSchema.extend({
  state: z.literal("settlement_pending"),
  reservation: PurchaseReservationSchema,
  settlement: SettlementSubmissionSchema,
  receipt: z.null(),
}).strict();

const SoldListingObjectSchema = ListingBaseSchema.extend({
  state: z.literal("sold"),
  reservation: PurchaseReservationSchema,
  settlement: SettlementSubmissionSchema,
  receipt: SettlementReceiptSchema,
}).strict();

const ListingObjectUnionSchema = z.discriminatedUnion("state", [
  ActiveListingObjectSchema,
  PaymentPendingListingObjectSchema,
  SettlementPendingListingObjectSchema,
  SoldListingObjectSchema,
]);
type ListingCandidate = z.infer<typeof ListingObjectUnionSchema>;

function listingInvariantViolations(listing: ListingCandidate): ReceiptInvariantViolation[] {
  const violations: ReceiptInvariantViolation[] = [];
  if (listing.source === "seller" && listing.seller.id !== DEMO_SELLER.id) {
    violations.push({
      path: ["seller"],
      message: "Seller-created listings must use the fixed demo seller",
    });
  }
  if (listing.source === "seed" && listing.seller.id === DEMO_SELLER.id) {
    violations.push({
      path: ["seller"],
      message: "Seed listings must use a seeded fictional seller",
    });
  }
  const expectedPurchaseId = safeDeterministicPurchaseId(listing.listingId);
  if (
    listing.lastReconciliationFailure &&
    expectedPurchaseId !== undefined &&
    listing.lastReconciliationFailure.purchaseId !== expectedPurchaseId
  ) {
    violations.push({
      path: ["lastReconciliationFailure", "purchaseId"],
      message: "Reconciliation failure must match its listing purchase",
    });
  }
  if (listing.reservation && listing.reservation.listingId !== listing.listingId) {
    violations.push({
      path: ["reservation", "listingId"],
      message: "Reservation must match its listing",
    });
  }
  if (listing.reservation && listing.reservation.recipientAddress !== listing.recipientAddress) {
    violations.push({
      path: ["reservation", "recipientAddress"],
      message: "Reservation must preserve the listing recipient",
    });
  }
  if (
    listing.reservation &&
    (listing.reservation.amount.currency !== listing.approvedPrice.currency ||
      listing.reservation.amount.network !== listing.approvedPrice.network ||
      listing.reservation.amount.atomicAmount !== listing.approvedPrice.atomicAmount)
  ) {
    violations.push({
      path: ["reservation", "amount"],
      message: "Reservation must preserve the approved listing price",
    });
  }
  if (listing.state === "settlement_pending") {
    violations.push(
      ...settlementReservationInvariantViolations(listing.settlement, listing.reservation)
    );
  }
  if (listing.state === "sold") {
    violations.push(
      ...soldReceiptInvariantViolations({
        listingId: listing.listingId,
        listingTitle: listing.approvedDraft.title,
        seller: listing.seller,
        recipientAddress: listing.recipientAddress,
        approvedPrice: listing.approvedPrice,
        reservation: listing.reservation,
        settlement: listing.settlement,
        receipt: listing.receipt,
      })
    );
  }
  return violations;
}

function addListingInvariantIssues(listing: ListingCandidate, context: z.RefinementCtx): void {
  for (const violation of listingInvariantViolations(listing)) {
    context.addIssue({ code: "custom", ...violation });
  }
}

export const ActiveListingSchema = ActiveListingObjectSchema.superRefine(addListingInvariantIssues);
export type ActiveListing = z.infer<typeof ActiveListingSchema>;
export const PaymentPendingListingSchema =
  PaymentPendingListingObjectSchema.superRefine(addListingInvariantIssues);
export type PaymentPendingListing = z.infer<typeof PaymentPendingListingSchema>;
export const SettlementPendingListingSchema =
  SettlementPendingListingObjectSchema.superRefine(addListingInvariantIssues);
export type SettlementPendingListing = z.infer<typeof SettlementPendingListingSchema>;
export const SoldListingSchema = SoldListingObjectSchema.superRefine(addListingInvariantIssues);
export type SoldListing = z.infer<typeof SoldListingSchema>;
export const ListingSchema = ListingObjectUnionSchema.superRefine(addListingInvariantIssues);
export type Listing = z.infer<typeof ListingSchema>;

export const BuyerMatchSchema = z
  .object({
    listingId: IdentifierSchema,
    rank: z.number().int().min(1).max(100),
    score: z.number().finite().min(0).max(1),
    title: z.string().trim().min(5).max(80),
    price: MoneySchema,
    fitExplanation: z.string().trim().min(10).max(1_000),
    visibleDefects: z.array(BoundedTextSchema).max(12),
    assumptions: z.array(EditableAssumptionSchema).max(16),
  })
  .strict();
export type BuyerMatch = z.infer<typeof BuyerMatchSchema>;

export const BuyerSearchResultSchema = z
  .object({
    searchId: IdentifierSchema,
    query: z.string().trim().min(3).max(1_000),
    matches: z.array(BuyerMatchSchema).max(20),
    createdAt: TimestampSchema,
  })
  .strict()
  .superRefine((result, context) => {
    const listingIds = new Set<string>();
    const ranks = new Set<number>();
    result.matches.forEach((match, index) => {
      if (listingIds.has(match.listingId)) {
        context.addIssue({ code: "custom", path: ["matches", index, "listingId"], message: "Listing matches must be unique" });
      }
      if (ranks.has(match.rank)) {
        context.addIssue({ code: "custom", path: ["matches", index, "rank"], message: "Match ranks must be unique" });
      }
      listingIds.add(match.listingId);
      ranks.add(match.rank);
    });
  });
export type BuyerSearchResult = z.infer<typeof BuyerSearchResultSchema>;

const RunBaseShape = {
  runId: IdentifierSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  attempt: z.number().int().min(0).max(10),
};
const RunErrorSchema = z.object({ code: z.string().min(1).max(80), message: z.string().min(1).max(1_000) }).strict();

interface DurableRunChronology {
  createdAt: string;
  updatedAt: string;
  reservation?: PurchaseReservation;
  startedAt?: string | null;
  completedAt?: string;
  failedAt?: string;
  settlement?: SettlementSubmission;
  receipt?: SettlementReceipt;
  failure?: ReconciliationFailure;
}

function addRunChronologyIssues(run: DurableRunChronology, context: z.RefinementCtx): void {
  const createdAt = Date.parse(run.createdAt);
  const updatedAt = Date.parse(run.updatedAt);
  if (run.reservation && createdAt < Date.parse(run.reservation.createdAt)) {
    context.addIssue({
      code: "custom",
      path: ["createdAt"],
      message: "Run creation timestamp must not predate the reservation",
    });
  }
  if (updatedAt < createdAt) {
    context.addIssue({
      code: "custom",
      path: ["updatedAt"],
      message: "Run update timestamp must not predate creation",
    });
  }

  const lifecycleEvents: Array<[string, string]> = [];
  if (run.startedAt) lifecycleEvents.push(["startedAt", run.startedAt]);
  if (run.completedAt) lifecycleEvents.push(["completedAt", run.completedAt]);
  if (run.failedAt) lifecycleEvents.push(["failedAt", run.failedAt]);
  if (run.settlement) lifecycleEvents.push(["settlement.submittedAt", run.settlement.submittedAt]);
  if (run.receipt) lifecycleEvents.push(["receipt.settledAt", run.receipt.settledAt]);
  if (run.failure) lifecycleEvents.push(["failure.failedAt", run.failure.failedAt]);

  for (const [path, timestamp] of lifecycleEvents) {
    if (Date.parse(timestamp) < createdAt) {
      context.addIssue({
        code: "custom",
        path: path.split("."),
        message: "Run lifecycle event must not predate creation",
      });
    }
  }
  if (run.startedAt && run.completedAt && Date.parse(run.completedAt) < Date.parse(run.startedAt)) {
    context.addIssue({
      code: "custom",
      path: ["completedAt"],
      message: "Run completion timestamp must not predate start",
    });
  }
  if (run.startedAt && run.failedAt && Date.parse(run.failedAt) < Date.parse(run.startedAt)) {
    context.addIssue({
      code: "custom",
      path: ["failedAt"],
      message: "Run failure timestamp must not predate start",
    });
  }
  if (
    run.startedAt &&
    run.settlement &&
    Date.parse(run.settlement.submittedAt) < Date.parse(run.startedAt)
  ) {
    context.addIssue({
      code: "custom",
      path: ["settlement", "submittedAt"],
      message: "Settlement submission timestamp must not predate the run start",
    });
  }
  if (
    run.settlement &&
    run.receipt &&
    Date.parse(run.receipt.settledAt) < Date.parse(run.settlement.submittedAt)
  ) {
    context.addIssue({
      code: "custom",
      path: ["receipt", "settledAt"],
      message: "Receipt settlement timestamp must not predate submission",
    });
  }
  if (run.receipt && run.completedAt && Date.parse(run.completedAt) < Date.parse(run.receipt.settledAt)) {
    context.addIssue({
      code: "custom",
      path: ["completedAt"],
      message: "Run completion timestamp must not predate settlement",
    });
  }
  if (
    run.settlement &&
    run.failure &&
    Date.parse(run.failure.failedAt) < Date.parse(run.settlement.submittedAt)
  ) {
    context.addIssue({
      code: "custom",
      path: ["failure", "failedAt"],
      message: "Reconciliation failure timestamp must not predate submission",
    });
  }

  const latestEvent = lifecycleEvents.reduce(
    (latest, [, timestamp]) => Math.max(latest, Date.parse(timestamp)),
    createdAt
  );
  if (updatedAt < latestEvent) {
    context.addIssue({
      code: "custom",
      path: ["updatedAt"],
      message: "Run update timestamp must include the latest represented lifecycle event",
    });
  }
}

export const MAX_ANALYSIS_STAGE_ATTEMPTS = 2;
export const ANALYSIS_RUN_FAILURES = {
  gemini: {
    code: "analysis_listing_generation_failed",
    message: "Listing analysis failed. Please retry.",
  },
  gemma: {
    code: "analysis_price_recommendation_failed",
    message: "Price recommendation failed. Please retry.",
  },
} as const;

const AnalysisRunSnapshotShape = {
  media: z.array(MediaReferenceSchema).min(3).max(8),
  photoIds: z.array(IdentifierSchema).min(3).max(8),
  geminiAttempts: z.number().int().min(0).max(MAX_ANALYSIS_STAGE_ATTEMPTS),
  gemmaAttempts: z.number().int().min(0).max(MAX_ANALYSIS_STAGE_ATTEMPTS),
};

export const AnalysisRunStateSchema = z
  .discriminatedUnion("status", [
    z.object({ ...RunBaseShape, ...AnalysisRunSnapshotShape, kind: z.literal("analysis"), status: z.literal("queued") }).strict(),
    z.object({ ...RunBaseShape, ...AnalysisRunSnapshotShape, kind: z.literal("analysis"), status: z.literal("running"), startedAt: TimestampSchema, draft: ListingDraftSchema.optional() }).strict(),
    z.object({ ...RunBaseShape, ...AnalysisRunSnapshotShape, kind: z.literal("analysis"), status: z.literal("succeeded"), startedAt: TimestampSchema, completedAt: TimestampSchema, draft: ListingDraftSchema, priceRecommendation: PriceRecommendationSchema }).strict(),
    z.object({ ...RunBaseShape, ...AnalysisRunSnapshotShape, kind: z.literal("analysis"), status: z.literal("failed"), startedAt: TimestampSchema, failedAt: TimestampSchema, draft: ListingDraftSchema.optional(), error: RunErrorSchema }).strict(),
  ])
  .superRefine((run, context) => {
    addRunChronologyIssues(run, context);
    if (run.attempt !== run.geminiAttempts + run.gemmaAttempts) {
      context.addIssue({ code: "custom", path: ["attempt"], message: "Analysis attempt must equal the total model attempts" });
    }
    if (run.status === "queued" && run.attempt !== 0) {
      context.addIssue({ code: "custom", path: ["attempt"], message: "Queued analysis cannot have model attempts" });
    }
    const inputPhotoIds = new Set(run.photoIds);
    const mediaIds = run.media.map(({ id }) => id);
    if (inputPhotoIds.size !== run.photoIds.length || new Set(mediaIds).size !== mediaIds.length) {
      context.addIssue({ code: "custom", path: ["photoIds"], message: "Analysis photo IDs must be unique" });
    }
    if (new Set(run.media.map(({ pathname }) => pathname)).size !== run.media.length) {
      context.addIssue({ code: "custom", path: ["media"], message: "Analysis media pathnames must be unique" });
    }
    if (run.photoIds.length !== mediaIds.length || run.photoIds.some((id, index) => id !== mediaIds[index])) {
      context.addIssue({ code: "custom", path: ["photoIds"], message: "Analysis photo IDs must exactly match stored media IDs in order" });
    }
    const draft =
      run.status === "succeeded" ? run.draft : run.status === "running" || run.status === "failed" ? run.draft : undefined;
    if (draft && run.geminiAttempts === 0) {
      context.addIssue({ code: "custom", path: ["geminiAttempts"], message: "A durable draft requires a Gemini attempt" });
    }
    if (run.gemmaAttempts > 0 && !draft) {
      context.addIssue({ code: "custom", path: ["gemmaAttempts"], message: "Gemma attempts require a durable draft" });
    }
    if (run.status === "succeeded" && run.gemmaAttempts === 0) {
      context.addIssue({ code: "custom", path: ["gemmaAttempts"], message: "Successful analysis requires a Gemma attempt" });
    }
    if (run.status === "failed") {
      const stage = run.draft ? "gemma" : "gemini";
      const expectedFailure = ANALYSIS_RUN_FAILURES[stage];
      if (run.error.code !== expectedFailure.code || run.error.message !== expectedFailure.message) {
        context.addIssue({
          code: "custom",
          path: ["error"],
          message: `Failed analysis must use the sanitized ${stage} failure`,
        });
      }
      if (stage === "gemini" && (
        run.geminiAttempts !== MAX_ANALYSIS_STAGE_ATTEMPTS || run.gemmaAttempts !== 0
      )) {
        context.addIssue({
          code: "custom",
          path: ["geminiAttempts"],
          message: "Listing-generation failure requires exactly two Gemini attempts and no Gemma attempts",
        });
      }
      if (stage === "gemma" && (
        run.geminiAttempts < 1 || run.gemmaAttempts !== MAX_ANALYSIS_STAGE_ATTEMPTS
      )) {
        context.addIssue({
          code: "custom",
          path: ["gemmaAttempts"],
          message: "Price-recommendation failure requires a durable Gemini draft and exactly two Gemma attempts",
        });
      }
    }
    if (!draft) return;

    if (
      run.media.length !== draft.media.length ||
      run.media.some((reference, index) => !mediaReferencesEqual(reference, draft.media[index]))
    ) {
      context.addIssue({
        code: "custom",
        path: ["media"],
        message: "Analysis draft media must exactly match the stored full media snapshot in order",
      });
    }
  });
export type AnalysisRunState = z.infer<typeof AnalysisRunStateSchema>;

const PublicationSnapshotShape = {
  sellerApproved: z.literal(true),
  approvedDraft: ListingDraftSchema,
  approvedPrice: MoneySchema,
};

export const PublicationRunStateSchema = z
  .discriminatedUnion("status", [
    z.object({ ...RunBaseShape, ...PublicationSnapshotShape, kind: z.literal("publication"), status: z.literal("queued") }).strict(),
    z.object({ ...RunBaseShape, ...PublicationSnapshotShape, kind: z.literal("publication"), status: z.literal("running"), startedAt: TimestampSchema }).strict(),
    z.object({ ...RunBaseShape, ...PublicationSnapshotShape, kind: z.literal("publication"), status: z.literal("succeeded"), startedAt: TimestampSchema, completedAt: TimestampSchema, listingId: IdentifierSchema }).strict(),
    z.object({ ...RunBaseShape, ...PublicationSnapshotShape, kind: z.literal("publication"), status: z.literal("failed"), startedAt: TimestampSchema.nullable(), failedAt: TimestampSchema, error: RunErrorSchema }).strict(),
  ])
  .superRefine(addRunChronologyIssues);
export type PublicationRunState = z.infer<typeof PublicationRunStateSchema>;

const PurchaseRunSnapshotShape = {
  reservation: PurchaseReservationSchema,
  listingTitle: z.string().trim().min(5).max(80),
  seller: SellerIdentitySchema,
};

export const PurchaseRunStateSchema = z
  .discriminatedUnion("status", [
    z.object({ ...RunBaseShape, ...PurchaseRunSnapshotShape, kind: z.literal("purchase"), status: z.literal("queued") }).strict(),
    z.object({ ...RunBaseShape, ...PurchaseRunSnapshotShape, kind: z.literal("purchase"), status: z.literal("running"), startedAt: TimestampSchema }).strict(),
    z.object({ ...RunBaseShape, ...PurchaseRunSnapshotShape, kind: z.literal("purchase"), status: z.literal("settlement_pending"), startedAt: TimestampSchema, settlement: SettlementSubmissionSchema }).strict(),
    z.object({ ...RunBaseShape, ...PurchaseRunSnapshotShape, kind: z.literal("purchase"), status: z.literal("succeeded"), startedAt: TimestampSchema, completedAt: TimestampSchema, settlement: SettlementSubmissionSchema, receipt: SettlementReceiptSchema }).strict(),
    z.object({ ...RunBaseShape, ...PurchaseRunSnapshotShape, kind: z.literal("purchase"), status: z.literal("failed"), startedAt: TimestampSchema.nullable(), failedAt: TimestampSchema, error: RunErrorSchema }).strict(),
    z.object({ ...RunBaseShape, ...PurchaseRunSnapshotShape, kind: z.literal("purchase"), status: z.literal("reconciliation_failed"), startedAt: TimestampSchema, settlement: SettlementSubmissionSchema, failure: ReconciliationFailureSchema }).strict(),
  ])
  .superRefine((run, context) => {
    addRunChronologyIssues(run, context);
    if ("settlement" in run) {
      for (const violation of settlementReservationInvariantViolations(
        run.settlement,
        run.reservation
      )) {
        context.addIssue({ code: "custom", ...violation });
      }
    }
    if (run.status === "succeeded") {
      for (const violation of receiptReservationInvariantViolations(run.receipt, run.reservation)) {
        context.addIssue({ code: "custom", ...violation });
      }
      if (
        run.receipt.x402PaymentReference !== run.settlement.x402PaymentReference ||
        run.receipt.settlementTransaction !== run.settlement.settlementTransaction
      ) {
        context.addIssue({
          code: "custom",
          path: ["receipt"],
          message: "Receipt must match the authoritative settlement references",
        });
      }
      if (run.receipt.listingTitle !== run.listingTitle) {
        context.addIssue({
          code: "custom",
          path: ["receipt", "listingTitle"],
          message: "Receipt title must match the immutable purchase listing snapshot",
        });
      }
      if (!equalSnapshot(run.receipt.seller, run.seller)) {
        context.addIssue({
          code: "custom",
          path: ["receipt", "seller"],
          message: "Receipt seller identity must match the immutable purchase listing snapshot",
        });
      }
      if (Date.parse(run.receipt.settledAt) < Date.parse(run.settlement.submittedAt)) {
        context.addIssue({
          code: "custom",
          path: ["receipt", "settledAt"],
          message: "Receipt settlement timestamp must not predate the settlement submission",
        });
      }
    }
    if (run.status === "reconciliation_failed") {
      for (const violation of reconciliationFailureInvariantViolations(run.failure, run.settlement)) {
        context.addIssue({ code: "custom", ...violation });
      }
    }
  });
export type PurchaseRunState = z.infer<typeof PurchaseRunStateSchema>;
