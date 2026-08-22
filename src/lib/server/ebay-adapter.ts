import "server-only";
import {
  EbayListing,
  EbayAdapterRecordSchema,
  EbayAdapterRecord,
} from "../domain/schemas";
import {
  validateEbayListing,
  computeListingHash,
  createAdapterRecord,
  verifyAdapterRecordObject,
} from "../domain/ebay-adapter";
import { putPrivateBlobJson, getPrivateBlobJson } from "./blob-client";

export {
  validateEbayListing,
  computeListingHash,
  createAdapterRecord,
  verifyAdapterRecordObject,
};

export async function publishToEbayAdapter(
  listing: EbayListing
): Promise<{ adapterRecordPath: string; record: EbayAdapterRecord }> {
  const { adapterRecordPath, record } = createAdapterRecord(listing);
  await putPrivateBlobJson(adapterRecordPath, record);
  return { adapterRecordPath, record };
}

export async function verifyEbayAdapterRecord(
  adapterRecordPath: string,
  expectedListing: EbayListing
): Promise<{ verified: boolean; fetchedRecord: EbayAdapterRecord }> {
  const rawRecord = await getPrivateBlobJson<unknown>(adapterRecordPath);

  if (!rawRecord) {
    throw new Error(`Failed to retrieve adapter record at path: ${adapterRecordPath}`);
  }

  const parsedRecord = EbayAdapterRecordSchema.safeParse(rawRecord);
  if (!parsedRecord.success) {
    throw new Error(`Adapter record schema parse failed: ${parsedRecord.error.issues.map((i) => i.message).join(", ")}`);
  }

  const fetchedRecord = parsedRecord.data;
  const { verified } = verifyAdapterRecordObject(fetchedRecord, expectedListing);

  return {
    verified,
    fetchedRecord,
  };
}
