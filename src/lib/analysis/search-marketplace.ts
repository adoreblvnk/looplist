import { z } from "zod";
import {
  BuyerSearchSelectionRecordSchema,
  GemmaBuyerSearchCandidateSchema,
  type BuyerSearchInterpretedConstraints,
} from "../domain/buyer-search";
import { parseUsdcAmount } from "../domain/usdc";
import {
  type MarketplaceListing,
  type MarketplaceRepository,
} from "../persistence/repository";
import {
  BuyerSearchListingProjectionSchema,
  type BuyerSearchGenerator,
  type BuyerSearchListingProjection,
} from "./buyer-search-contracts";

export const MAX_BUYER_SEARCH_LISTINGS = 100;
export const MAX_GEMMA_BUYER_SEARCH_INPUT_BYTES = 96 * 1024;

export class BuyerSearchError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "BuyerSearchError";
  }
}

function normalize(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en").replace(/[^a-z0-9]+/g, " ").trim();
}

function listingProjection(record: MarketplaceListing): BuyerSearchListingProjection {
  const draft = record.listing.approvedDraft;
  return BuyerSearchListingProjectionSchema.parse({
    listingId: record.listing.listingId,
    title: draft.title,
    category: draft.category,
    brand: draft.brand,
    model: draft.model,
    condition: draft.condition,
    price: record.listing.approvedPrice,
    attributes: structuredClone(draft.attributes),
    includedAccessories: structuredClone(draft.includedAccessories),
    visibleDefects: draft.evidence.filter(({ kind }) => kind === "defect").map(({ claim }) => claim),
    evidence: draft.evidence.map(({ id, kind, claim, confidence }) => ({ id, kind, claim, confidence })),
    assumptions: draft.assumptions.map(({ id, field, value, confidence }) => ({ id, field, value, confidence })),
  });
}

export interface PreparedBuyerSearch {
  query: string;
  listings: BuyerSearchListingProjection[];
  recordsById: Map<string, MarketplaceListing>;
}

export async function prepareBuyerSearch(
  repository: MarketplaceRepository,
  query: string
): Promise<PreparedBuyerSearch> {
  const records = structuredClone(await repository.listMarketplaceListings());
  if (records.length > MAX_BUYER_SEARCH_LISTINGS) {
    throw new BuyerSearchError("listing_corpus_too_large", "Active listing corpus exceeded its record limit");
  }
  const active = records.filter(
    (record) => record.visibility === "active" && record.listing.state === "active"
  );
  const recordsById = new Map<string, MarketplaceListing>();
  const listings = active.map((record) => {
    if (recordsById.has(record.listing.listingId)) {
      throw new BuyerSearchError("listing_corpus_invalid", "Active listing corpus contains duplicate IDs");
    }
    recordsById.set(record.listing.listingId, record);
    return listingProjection(record);
  });
  const bytes = new TextEncoder().encode(JSON.stringify({ query, listings })).byteLength;
  if (bytes > MAX_GEMMA_BUYER_SEARCH_INPUT_BYTES) {
    throw new BuyerSearchError("listing_input_too_large", "Buyer search input exceeded its byte limit");
  }
  return { query, listings, recordsById };
}

function queryBudget(query: string): string | null {
  const match = query.match(
    /\b(?:below|under|less\s+than|up\s+to|maximum|max)\s+(?:s?\$\s*)?(\d{1,12}(?:\.\d{1,6})?)\s*(?:usdc)?\b/i
  );
  return match ? parseUsdcAmount(match[1]) : null;
}

function queryCategories(query: string): Set<"electronics" | "running_shoes" | "sneakers"> {
  const normalized = normalize(query);
  const categories = new Set<"electronics" | "running_shoes" | "sneakers">();
  if (/\b(macbook|laptop|notebook|console|switch|headphones?|phone|pixel|power bank|electronics?)\b/.test(normalized)) {
    categories.add("electronics");
  }
  if (/\b(running shoes?|runners?|trainers?)\b/.test(normalized)) categories.add("running_shoes");
  if (/\b(sneakers?|air force|lifestyle shoes?)\b/.test(normalized)) categories.add("sneakers");
  return categories;
}

const CONDITION_ORDER = ["for_parts", "acceptable", "good", "very_good", "like_new", "new"] as const;

function queryMinimumCondition(query: string): (typeof CONDITION_ORDER)[number] | null {
  const normalized = normalize(query);
  if (/\bbrand new\b/.test(normalized)) return "new";
  if (/\blike new\b/.test(normalized)) return "like_new";
  if (/\bvery good\b/.test(normalized)) return "very_good";
  if (/\bgood condition\b/.test(normalized)) return "good";
  if (/\bacceptable(?: cosmetic)? wear\b/.test(normalized)) return "acceptable";
  return null;
}

function projectionText(listing: BuyerSearchListingProjection): string {
  return normalize(
    [
      listing.title,
      listing.category,
      listing.brand,
      listing.model,
      listing.condition,
      ...Object.entries(listing.attributes).flat(),
      ...listing.includedAccessories,
      ...listing.evidence.map(({ claim }) => claim),
      ...listing.assumptions.flatMap(({ field, value }) => [field, value]),
    ].join(" ")
  );
}

function conditionAtLeast(actual: string, minimum: string): boolean {
  return CONDITION_ORDER.indexOf(actual as (typeof CONDITION_ORDER)[number]) >=
    CONDITION_ORDER.indexOf(minimum as (typeof CONDITION_ORDER)[number]);
}

function assertInterpretedConstraintsDoNotConflict(
  query: string,
  interpreted: BuyerSearchInterpretedConstraints
): void {
  const budget = queryBudget(query);
  if (budget && interpreted.maximumAtomicAmount !== budget) {
    throw new BuyerSearchError("conflicting_constraints", "Model price constraint conflicts with the buyer request");
  }
  const categories = queryCategories(query);
  if (
    categories.size > 0 &&
    (interpreted.categories.length === 0 ||
      !interpreted.categories.some((category) => categories.has(category)))
  ) {
    throw new BuyerSearchError("conflicting_constraints", "Model category constraint conflicts with the buyer request");
  }
  if (queryMinimumCondition(query) && interpreted.acceptableConditions.length === 0) {
    throw new BuyerSearchError("conflicting_constraints", "Model condition constraint conflicts with the buyer request");
  }
}

function satisfiesHardConstraints(
  query: string,
  listing: BuyerSearchListingProjection,
  constraints: BuyerSearchInterpretedConstraints
): boolean {
  const deterministicBudget = queryBudget(query);
  const maximum = deterministicBudget ?? constraints.maximumAtomicAmount;
  if (maximum && BigInt(listing.price.atomicAmount) > BigInt(maximum)) return false;

  const deterministicCategories = queryCategories(query);
  if (deterministicCategories.size > 0 && !deterministicCategories.has(listing.category)) return false;
  if (constraints.categories.length > 0 && !constraints.categories.includes(listing.category)) return false;

  const minimumCondition = queryMinimumCondition(query);
  if (minimumCondition && !conditionAtLeast(listing.condition, minimumCondition)) return false;
  if (
    constraints.acceptableConditions.length > 0 &&
    !constraints.acceptableConditions.includes(listing.condition)
  ) return false;

  const searchable = projectionText(listing);
  if (constraints.requiredTerms.some((term) => !searchable.includes(normalize(term)))) return false;
  const defects = normalize(listing.visibleDefects.join(" "));
  if (constraints.excludedDefectTerms.some((term) => defects.includes(normalize(term)))) return false;

  const normalizedQuery = normalize(query);
  if (/\bno visible screen damage\b/.test(normalizedQuery)) {
    const screenDamage = listing.visibleDefects.some((defect) => {
      const value = normalize(defect);
      return /\bscreen|display\b/.test(value) && /\bdamage|crack|scratch|dead pixel\b/.test(value);
    });
    if (screenDamage) return false;
  }
  return true;
}

function assertExplanationGrounded(
  query: string,
  listing: BuyerSearchListingProjection,
  explanation: string
): void {
  const normalized = normalize(explanation);
  if (/\b(pathname|workflow|blob|storage url|recipient address|private key|seed phrase)\b/.test(normalized)) {
    throw new BuyerSearchError("unsupported_explanation", "Match explanation contains private or implementation claims");
  }
  if (/https?:\/\/|0x[a-fA-F0-9]{40}/.test(explanation)) {
    throw new BuyerSearchError("unsupported_explanation", "Match explanation contains an unsupported external reference");
  }
  const source = normalize(`${query} ${projectionText(listing)} ${listing.price.atomicAmount}`);
  for (const number of explanation.match(/\b\d+(?:\.\d+)?\b/g) ?? []) {
    if (!source.includes(normalize(number))) {
      throw new BuyerSearchError("unsupported_explanation", "Match explanation contains an unsupported numeric claim");
    }
  }
  for (const risky of [
    "authentic", "guaranteed", "fully functional", "works perfectly", "warranty",
    "excellent battery", "healthy battery", "flawless", "pristine", "perfect condition",
  ]) {
    if (normalized.includes(risky) && !projectionText(listing).includes(risky)) {
      throw new BuyerSearchError("unsupported_explanation", "Match explanation contains an unsupported product claim");
    }
  }
}

export interface HydratedBuyerMatch {
  record: MarketplaceListing;
  rank: number;
  score: number;
  fitExplanation: string;
  evidence: Array<{ evidenceId: string; claim: string; confidence: "low" | "medium" | "high" }>;
  assumptions: Array<{
    assumptionId: string;
    field: string;
    value: string;
    confidence: "low" | "medium" | "high";
  }>;
  visibleDefects: string[];
}

export interface HydratedBuyerSearch {
  searchId: string;
  query: string;
  interpretedConstraints: BuyerSearchInterpretedConstraints;
  matches: HydratedBuyerMatch[];
  createdAt: string;
}

export function hydrateBuyerSearch(
  prepared: PreparedBuyerSearch,
  searchId: string,
  generatedAt: string,
  output: unknown
): HydratedBuyerSearch {
  const parsedCandidate = GemmaBuyerSearchCandidateSchema.safeParse(output);
  if (!parsedCandidate.success) {
    throw new BuyerSearchError("model_output_invalid", "Gemma returned an invalid buyer-search selection");
  }
  const candidate = parsedCandidate.data;
  assertInterpretedConstraintsDoNotConflict(prepared.query, candidate.interpretedConstraints);
  const projectionById = new Map(prepared.listings.map((listing) => [listing.listingId, listing]));
  const matches: HydratedBuyerMatch[] = candidate.matches.map((match, index) => {
    const record = prepared.recordsById.get(match.listingId);
    const projection = projectionById.get(match.listingId);
    if (!record || !projection || record.visibility !== "active" || record.listing.state !== "active") {
      throw new BuyerSearchError("unknown_or_unavailable_listing", "Model selected an unknown or unavailable listing");
    }
    if (!satisfiesHardConstraints(prepared.query, projection, candidate.interpretedConstraints)) {
      throw new BuyerSearchError("conflicting_listing", "Model selected a listing that conflicts with hard constraints");
    }
    assertExplanationGrounded(prepared.query, projection, match.fitExplanation);

    const evidenceById = new Map(projection.evidence.map((evidence) => [evidence.id, evidence]));
    const assumptionById = new Map(projection.assumptions.map((assumption) => [assumption.id, assumption]));
    const evidence = match.evidenceIds.map((evidenceId) => {
      const source = evidenceById.get(evidenceId);
      if (!source) throw new BuyerSearchError("unknown_evidence", "Match selected unsupported listing evidence");
      return { evidenceId, claim: source.claim, confidence: source.confidence };
    });
    const assumptions = match.assumptionIds.map((assumptionId) => {
      const source = assumptionById.get(assumptionId);
      if (!source) throw new BuyerSearchError("unknown_assumption", "Match selected an unsupported assumption");
      return { assumptionId, field: source.field, value: source.value, confidence: source.confidence };
    });
    return {
      record,
      rank: index + 1,
      score: match.score,
      fitExplanation: match.fitExplanation,
      evidence,
      assumptions,
      visibleDefects: structuredClone(projection.visibleDefects),
    };
  });
  return { searchId, query: prepared.query, interpretedConstraints: candidate.interpretedConstraints, matches, createdAt: generatedAt };
}

export function toBuyerSearchSelection(
  result: HydratedBuyerSearch
): z.infer<typeof BuyerSearchSelectionRecordSchema> {
  return BuyerSearchSelectionRecordSchema.parse({
    searchId: result.searchId,
    query: result.query,
    interpretedConstraints: result.interpretedConstraints,
    matches: result.matches.map(({ record, score, fitExplanation, evidence, assumptions }) => ({
      listingId: record.listing.listingId,
      score,
      fitExplanation,
      evidenceIds: evidence.map(({ evidenceId }) => evidenceId),
      assumptionIds: assumptions.map(({ assumptionId }) => assumptionId),
    })),
    generatedAt: result.createdAt,
  });
}

export async function searchMarketplace(
  repository: MarketplaceRepository,
  generator: BuyerSearchGenerator,
  input: { searchId: string; query: string; generatedAt: string }
): Promise<HydratedBuyerSearch> {
  const prepared = await prepareBuyerSearch(repository, input.query);
  if (prepared.listings.length === 0) {
    return {
      searchId: input.searchId,
      query: input.query,
      interpretedConstraints: {
        categories: [], maximumAtomicAmount: null, acceptableConditions: [], requiredTerms: [], excludedDefectTerms: [],
      },
      matches: [],
      createdAt: input.generatedAt,
    };
  }
  const output = await generator.generate({ query: prepared.query, listings: structuredClone(prepared.listings) });
  const refreshed = await prepareBuyerSearch(repository, input.query);
  return hydrateBuyerSearch(refreshed, input.searchId, input.generatedAt, output);
}
