import { createHash } from "node:crypto";
import {
  EbayListingSchema,
  EbayListing,
  EbayAdapterRecord,
} from "./schemas";
import { ValidationResult } from "./repair-controller";

export function validateEbayListing(listing: unknown): ValidationResult {
  const parseResult = EbayListingSchema.safeParse(listing);
  if (parseResult.success) {
    return {
      valid: true,
      errors: [],
      rejectedFields: {},
      data: parseResult.data,
    };
  }

  const errors: string[] = [];
  const rejectedFields: Record<string, string> = {};

  for (const issue of parseResult.error.issues) {
    const fieldName = issue.path.join(".") || "root";
    const message = issue.message;
    errors.push(`${fieldName}: ${message}`);
    rejectedFields[fieldName] = message;
  }

  return {
    valid: false,
    errors,
    rejectedFields,
  };
}

export function computeListingHash(listing: EbayListing): string {
  const sortedSpecifics: Record<string, string> = {};
  if (listing.itemSpecifics) {
    for (const key of Object.keys(listing.itemSpecifics).sort()) {
      sortedSpecifics[key] = listing.itemSpecifics[key];
    }
  }

  const canonicalObject = {
    title: listing.title,
    description: listing.description,
    category: listing.category,
    condition: listing.condition,
    priceSgd: listing.priceSgd,
    priceUsd: listing.priceUsd,
    itemSpecifics: sortedSpecifics,
    imagePaths: listing.imagePaths,
  };

  return createHash("sha256")
    .update(JSON.stringify(canonicalObject))
    .digest("hex")
    .slice(0, 16);
}

export function createAdapterRecord(listing: EbayListing): { adapterRecordPath: string; record: EbayAdapterRecord } {
  const hash = computeListingHash(listing);
  const adapterRecordId = `ebay-adapter-${hash}`;
  const adapterListingId = `adapter-item-${hash}`;
  const adapterListingUrl = `https://sandbox.ebay.com/itm/${adapterListingId}`;
  const adapterRecordPath = `adapter-records/${adapterRecordId}.json`;

  const record: EbayAdapterRecord = {
    id: adapterRecordId,
    listingId: adapterListingId,
    listingUrl: adapterListingUrl,
    isAdapter: true,
    adapterNotice: "eBay Sandbox adapter (deterministic mode - live credentials absent)",
    listing,
    publishedAt: new Date().toISOString(),
    status: "PUBLISHED",
  };

  return { adapterRecordPath, record };
}

export function verifyAdapterRecordObject(
  fetchedRecord: EbayAdapterRecord,
  expectedListing: EbayListing
): { verified: boolean } {
  if (fetchedRecord.status !== "PUBLISHED") {
    throw new Error(`Adapter record status is invalid: expected PUBLISHED, got ${fetchedRecord.status}`);
  }

  if (!fetchedRecord.isAdapter) {
    throw new Error("Adapter record isAdapter flag missing or false");
  }

  const expected = createAdapterRecord(expectedListing).record;

  if (fetchedRecord.id !== expected.id) {
    throw new Error(`Independent verification failed: record id mismatch (expected ${expected.id}, got ${fetchedRecord.id})`);
  }

  if (fetchedRecord.listingId !== expected.listingId) {
    throw new Error(`Independent verification failed: listingId mismatch (expected ${expected.listingId}, got ${fetchedRecord.listingId})`);
  }

  if (fetchedRecord.listingUrl !== expected.listingUrl) {
    throw new Error(`Independent verification failed: listingUrl mismatch (expected ${expected.listingUrl}, got ${fetchedRecord.listingUrl})`);
  }

  const sameTitle = fetchedRecord.listing.title === expectedListing.title;
  const sameDescription = fetchedRecord.listing.description === expectedListing.description;
  const sameCategory = fetchedRecord.listing.category === expectedListing.category;
  const sameCondition = fetchedRecord.listing.condition === expectedListing.condition;
  const samePriceSgd = fetchedRecord.listing.priceSgd === expectedListing.priceSgd;
  const samePriceUsd = fetchedRecord.listing.priceUsd === expectedListing.priceUsd;
  const sameSpecifics = JSON.stringify(fetchedRecord.listing.itemSpecifics) === JSON.stringify(expectedListing.itemSpecifics);
  const sameImages = JSON.stringify(fetchedRecord.listing.imagePaths) === JSON.stringify(expectedListing.imagePaths);

  if (!sameTitle || !sameDescription || !sameCategory || !sameCondition || !samePriceSgd || !samePriceUsd || !sameSpecifics || !sameImages) {
    throw new Error("Independent verification failed: complete listing equality check failed");
  }

  return { verified: true };
}
