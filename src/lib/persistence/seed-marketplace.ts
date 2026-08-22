import {
  ActiveListingSchema,
  SeededSellerIdentitySchema,
  SoldComparableSchema,
  type ActiveListing,
  type ConfidenceLabel,
  type ListingCondition,
  type MarketplaceCategory,
  type PhotoEvidence,
  type SeededSellerIdentity,
  type SoldComparable,
} from "../domain/marketplace";
import { seedMediaPath } from "./paths";
import { MAX_SOLD_COMPARABLES, type MarketplaceRepository } from "./repository";

function deepFreeze<T>(value: T): T {
  if (Array.isArray(value)) {
    for (const nested of value) deepFreeze(nested);
    return Object.freeze(value);
  }
  if (
    value !== null &&
    typeof value === "object" &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null) &&
    !Object.isFrozen(value)
  ) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

export const SEEDED_SELLERS: readonly SeededSellerIdentity[] = deepFreeze(SeededSellerIdentitySchema.array().parse([
  { id: "seed-seller-nora", displayName: "Nora Vale (Demo)", role: "seller", fictional: true },
  { id: "seed-seller-eli", displayName: "Eli Park (Demo)", role: "seller", fictional: true },
  { id: "seed-seller-sam", displayName: "Sam Ito (Demo)", role: "seller", fictional: true },
  { id: "seed-seller-jules", displayName: "Jules Reed (Demo)", role: "seller", fictional: true },
]));

const RECIPIENT = "0x1111111111111111111111111111111111111111" as const;
const PUBLISHED_AT = "2026-08-20T12:00:00.000Z" as const;

type EvidenceInput = Omit<PhotoEvidence, "id" | "photoId"> & { photo: number };

interface SeedListingInput {
  listingId: string;
  sellerIndex: number;
  title: string;
  description: string;
  category: MarketplaceCategory;
  brand: string;
  model: string;
  condition: ListingCondition;
  attributes: Record<string, string>;
  atomicAmount: string;
  dimensions: readonly (readonly [number, number])[];
  evidence: readonly EvidenceInput[];
  assumptionField: string;
  assumptionValue: string;
}

function listing(input: SeedListingInput): ActiveListing {
  const media = input.dimensions.map(([width, height], index) => {
    const id = `${input.listingId}-p${index + 1}`;
    return {
      id,
      pathname: seedMediaPath(input.listingId, id, "jpg"),
      mediaType: "image" as const,
      mimeType: "image/jpeg" as const,
      alt: `${input.title}, product photo ${index + 1}`,
      width,
      height,
    };
  });

  return ActiveListingSchema.parse({
    listingId: input.listingId,
    source: "seed",
    seller: SEEDED_SELLERS[input.sellerIndex],
    recipientAddress: RECIPIENT,
    approvedDraft: {
      title: input.title,
      description: input.description,
      category: input.category,
      brand: input.brand,
      model: input.model,
      condition: input.condition,
      attributes: input.attributes,
      includedAccessories: [],
      visiblyMissingAccessories: [],
      media,
      evidence: input.evidence.map((evidence, index) => ({
        id: `${input.listingId}-e${index + 1}`,
        photoId: media[evidence.photo - 1].id,
        kind: evidence.kind,
        claim: evidence.claim,
        confidence: evidence.confidence satisfies ConfidenceLabel,
      })),
      assumptions: [
        {
          id: `${input.listingId}-assumption`,
          field: input.assumptionField,
          value: input.assumptionValue,
          confidence: "low",
          editable: true,
          verified: false,
          sellerEdited: false,
        },
      ],
    },
    approvedPrice: { currency: "USDC", network: "eip155:84532", atomicAmount: input.atomicAmount },
    publishedAt: PUBLISHED_AT,
    lastReconciliationFailure: null,
    state: "active",
    reservation: null,
    settlement: null,
    receipt: null,
  });
}

export const SEED_ACTIVE_LISTINGS: readonly ActiveListing[] = deepFreeze(ActiveListingSchema.array().parse([
  listing({
    listingId: "seed-macbook-air-m2-512",
    sellerIndex: 0,
    title: "Silver Apple MacBook Air laptop",
    description: "Silver Apple laptop photographed powered on, closed, and beside a power adapter and cable. Internal configuration and functional health are not claimed.",
    category: "electronics",
    brand: "Apple",
    model: "MacBook Air",
    condition: "good",
    attributes: { Color: "Silver", Form: "Laptop" },
    atomicAmount: "825000000",
    dimensions: [[824, 1080], [1080, 876], [1080, 1080]],
    evidence: [
      { photo: 1, kind: "identity", claim: "The photo shows a silver Apple laptop with a MacBook Air-style keyboard and display enclosure.", confidence: "high" },
      { photo: 1, kind: "condition", claim: "The display is visibly powered on and has no obvious crack in this front view.", confidence: "high" },
      { photo: 3, kind: "accessory", claim: "An Apple-branded power adapter and a coiled white USB-C cable are pictured beside the laptop.", confidence: "high" },
    ],
    assumptionField: "configurationAndFunction",
    assumptionValue: "Chip generation, memory, storage, battery health, port function, and charger wattage are not verified by these photos.",
  }),
  listing({
    listingId: "seed-switch-oled-white",
    sellerIndex: 1,
    title: "Nintendo Switch OLED · White",
    description: "White Nintendo Switch OLED console shown from the front, rear kickstand, and right-control detail. The screen remains off in the photos.",
    category: "electronics",
    brand: "Nintendo",
    model: "Switch OLED",
    condition: "good",
    attributes: { Color: "White", Form: "Handheld console" },
    atomicAmount: "285000000",
    dimensions: [[512, 887], [512, 887], [512, 887]],
    evidence: [
      { photo: 1, kind: "condition", claim: "The front glass appears intact with no obvious crack in the three-quarter view.", confidence: "high" },
      { photo: 2, kind: "identity", claim: "The rear view shows the wide integrated kickstand and attached white controllers.", confidence: "high" },
      { photo: 3, kind: "defect", claim: "Light gray cosmetic rubbing is visible near the lower edge of the right controller.", confidence: "high" },
    ],
    assumptionField: "functionAndIncludedItems",
    assumptionValue: "Display, controls, battery, dock compatibility, storage, and any unpictured items are not verified by still photos.",
  }),
  listing({
    listingId: "seed-sony-wh1000xm5-black",
    sellerIndex: 2,
    title: "Sony WH-1000XM5 headphones · Black",
    description: "Matte-black over-ear Sony headphones photographed from front, side, and close detail under neutral studio light.",
    category: "electronics",
    brand: "Sony",
    model: "WH-1000XM5",
    condition: "very_good",
    attributes: { Color: "Black", Form: "Over-ear headphones" },
    atomicAmount: "245000000",
    dimensions: [[512, 887], [512, 887], [512, 887]],
    evidence: [
      { photo: 1, kind: "condition", claim: "The headband and both ear cushions appear intact in the front view.", confidence: "high" },
      { photo: 2, kind: "identity", claim: "The side profile shows the slim stem and smooth oval earcup associated with this headphone design.", confidence: "high" },
      { photo: 3, kind: "defect", claim: "Faint shallow surface rubbing is visible on the matte earcup in close detail.", confidence: "medium" },
    ],
    assumptionField: "audioAndBattery",
    assumptionValue: "Audio, microphones, controls, noise cancellation, wireless pairing, and battery health are not verifiable from photos.",
  }),
  listing({
    listingId: "seed-pixel-8-blue",
    sellerIndex: 3,
    title: "Google Pixel 8 phone · Blue",
    description: "Blue Google Pixel 8 photographed with its screen off, rear camera bar visible, and a close view of the lower frame and USB-C port.",
    category: "electronics",
    brand: "Google",
    model: "Pixel 8",
    condition: "good",
    attributes: { Color: "Blue", Form: "Smartphone" },
    atomicAmount: "390000000",
    dimensions: [[512, 946], [512, 946], [512, 946]],
    evidence: [
      { photo: 1, kind: "condition", claim: "The front glass appears intact with no obvious crack in the screen-off view.", confidence: "high" },
      { photo: 2, kind: "identity", claim: "The blue rear panel, Google mark, and horizontal camera bar are visible together.", confidence: "high" },
      { photo: 3, kind: "defect", claim: "A tiny pale nick is visible on the blue lower frame beside the USB-C port.", confidence: "high" },
    ],
    assumptionField: "configurationAndFunction",
    assumptionValue: "Storage, carrier status, battery health, cameras, display, buttons, speakers, and USB-C operation are not verified by photos.",
  }),
  listing({
    listingId: "seed-asics-kayano-30",
    sellerIndex: 0,
    title: "ASICS Gel-Kayano 30 · White / Blue",
    description: "White-and-blue ASICS road-running shoes shown as a pair, in side profile, and from the outsoles with visible light use.",
    category: "running_shoes",
    brand: "ASICS",
    model: "Gel-Kayano 30",
    condition: "very_good",
    attributes: { Color: "White / Blue", Use: "Road running" },
    atomicAmount: "105000000",
    dimensions: [[512, 887], [512, 887], [512, 887]],
    evidence: [
      { photo: 1, kind: "condition", claim: "Both mesh uppers appear clean and retain their shape in the pair view.", confidence: "high" },
      { photo: 2, kind: "identity", claim: "The side view visibly shows ASICS striping and a cushioned road-running silhouette.", confidence: "high" },
      { photo: 3, kind: "defect", claim: "Light dry dirt and mild heel-edge abrasion are visible on both outsoles.", confidence: "high" },
    ],
    assumptionField: "sizeAndUseHistory",
    assumptionValue: "Size, width, fit, mileage, and remaining foam resilience are not verifiable from these photos.",
  }),
  listing({
    listingId: "seed-nike-pegasus-40",
    sellerIndex: 1,
    title: "Nike Pegasus 40 · White / Orange",
    description: "White-and-orange Nike road-running shoes photographed as a pair, in lateral profile, and from the outsoles.",
    category: "running_shoes",
    brand: "Nike",
    model: "Pegasus 40",
    condition: "good",
    attributes: { Color: "White / Orange", Use: "Road running" },
    atomicAmount: "78000000",
    dimensions: [[512, 887], [512, 887], [512, 887]],
    evidence: [
      { photo: 1, kind: "condition", claim: "The white mesh uppers appear intact without an obvious tear in the pair view.", confidence: "high" },
      { photo: 2, kind: "identity", claim: "The lateral view shows an orange-outlined Nike Swoosh and a white road-running profile.", confidence: "high" },
      { photo: 3, kind: "condition", claim: "The orange waffle-pattern outsoles appear clean with defined rubber lugs.", confidence: "high" },
    ],
    assumptionField: "sizeAndUseHistory",
    assumptionValue: "Size, width, fit, mileage, and remaining cushioning are not verifiable from these photos.",
  }),
  listing({
    listingId: "seed-brooks-ghost-15",
    sellerIndex: 2,
    title: "Brooks Ghost 15 · Blue / White",
    description: "Blue Brooks road-running shoes with white midsoles, photographed from pair, side, and close outsole/toe views.",
    category: "running_shoes",
    brand: "Brooks",
    model: "Ghost 15",
    condition: "good",
    attributes: { Color: "Blue / White", Use: "Road running" },
    atomicAmount: "82000000",
    dimensions: [[512, 887], [512, 887], [512, 887]],
    evidence: [
      { photo: 1, kind: "condition", claim: "Both blue mesh uppers appear intact and similarly shaped in the pair view.", confidence: "high" },
      { photo: 2, kind: "identity", claim: "The lateral view shows Brooks branding and a cushioned road-running profile.", confidence: "high" },
      { photo: 3, kind: "defect", claim: "Outsole dirt and small pale marks on the blue toe mesh are visible in close view.", confidence: "high" },
    ],
    assumptionField: "sizeAndUseHistory",
    assumptionValue: "Size, width, fit, mileage, and remaining cushioning are not verifiable from these photos.",
  }),
  listing({
    listingId: "seed-newbalance-1080v13",
    sellerIndex: 3,
    title: "New Balance 1080v13 · White / Orange",
    description: "White-and-orange New Balance road-running shoes shown as a pair, in side profile, and from the outsoles.",
    category: "running_shoes",
    brand: "New Balance",
    model: "Fresh Foam X 1080v13",
    condition: "very_good",
    attributes: { Color: "White / Orange", Use: "Road running" },
    atomicAmount: "118000000",
    dimensions: [[512, 1024], [512, 1024], [512, 1024]],
    evidence: [
      { photo: 1, kind: "condition", claim: "The white uppers and heel shapes appear clean and structurally crisp in the pair view.", confidence: "high" },
      { photo: 2, kind: "identity", claim: "The lateral view shows New Balance branding and a thick cushioned running-shoe midsole.", confidence: "high" },
      { photo: 3, kind: "defect", claim: "Minor dry dirt is visible in the white-and-orange outsole grooves.", confidence: "high" },
    ],
    assumptionField: "sizeAndUseHistory",
    assumptionValue: "Size, width, fit, mileage, and remaining foam resilience are not verifiable from these photos.",
  }),
  listing({
    listingId: "seed-nike-air-force-1-07-white",
    sellerIndex: 0,
    title: "Nike Air Force 1 '07 White",
    description: "White Nike Air Force 1 '07 lifestyle sneakers photographed as a pair, from the interiors and side, from both outsoles, and beside a photographed box label.",
    category: "sneakers",
    brand: "Nike",
    model: "Air Force 1 '07",
    condition: "very_good",
    attributes: { Color: "White", Style: "Lifestyle sneaker" },
    atomicAmount: "115000000",
    dimensions: [[810, 1080], [810, 1080], [810, 1080], [1080, 810], [1080, 810], [810, 1080]],
    evidence: [
      { photo: 1, kind: "identity", claim: "The pair view shows white low-top Nike sneakers with perforated toe boxes and white Swooshes.", confidence: "high" },
      { photo: 2, kind: "condition", claim: "The interior openings, white laces, and gray insoles are visible without an obvious tear in this view.", confidence: "high" },
      { photo: 3, kind: "condition", claim: "The top view shows an intact padded collar and perforated toe panel on one shoe.", confidence: "high" },
      { photo: 4, kind: "identity", claim: "The lateral profile shows a white Nike Swoosh, stitched leather panels, and the low Air Force silhouette.", confidence: "high" },
      { photo: 5, kind: "condition", claim: "Both white outsoles are pictured with their circular tread grooves visibly defined.", confidence: "high" },
      { photo: 6, kind: "identity", claim: "The photographed box label visibly reads AIR FORCE 1 '07 and CW2288 111.", confidence: "high" },
    ],
    assumptionField: "sizeAuthenticityUseHistoryAndFunction",
    assumptionValue: "Shoe size, authenticity, prior use history, fit, and functional condition are unverified; the photographed box label does not verify that the pair and box match.",
  }),
  listing({
    listingId: "seed-nike-air-force-1-miami-double-hook",
    sellerIndex: 1,
    title: "Nike Air Force 1 Miami Dolphins Double Hook",
    description: "White Nike Air Force 1 lifestyle sneakers with visible orange and teal accent Swooshes, photographed as a pair from two three-quarter arrangements and with one outsole facing the camera.",
    category: "sneakers",
    brand: "Nike",
    model: "Air Force 1 Miami Dolphins Double Hook",
    condition: "very_good",
    attributes: { Color: "White / Orange / Teal", Style: "Lifestyle sneaker" },
    atomicAmount: "135000000",
    dimensions: [[1664, 2200], [1678, 2200], [1679, 2200]],
    evidence: [
      { photo: 1, kind: "identity", claim: "The pair view shows white low-top Nike sneakers with small orange and teal accent Swooshes near the side panels.", confidence: "high" },
      { photo: 2, kind: "condition", claim: "The white uppers, laces, padded collars, and perforated toe panels appear intact in this view.", confidence: "high" },
      { photo: 3, kind: "condition", claim: "The raised shoe's white outsole is visible with circular tread grooves sharply defined.", confidence: "high" },
    ],
    assumptionField: "sizeAuthenticityUseHistoryAndFunction",
    assumptionValue: "Shoe size, authenticity, prior use history, fit, and functional condition are unverified; the background box is not verified as included or matched to the pair.",
  }),
]));

function comparable(
  comparableId: string,
  title: string,
  category: MarketplaceCategory,
  brand: string,
  model: string,
  condition: ListingCondition,
  atomicAmount: string,
  soldAt: string,
  similarityScore: number,
  similarityReason: string
): SoldComparable {
  return SoldComparableSchema.parse({
    comparableId,
    title,
    category,
    brand,
    model,
    condition,
    attributes: {},
    includedAccessories: [],
    similarityScore,
    similarityReason,
    soldPrice: { currency: "USDC", network: "eip155:84532", atomicAmount },
    soldAt,
  });
}

export const SEED_SOLD_COMPARABLES: readonly SoldComparable[] = deepFreeze(SoldComparableSchema.array().parse([
  comparable("sold-macbook-air-a", "Silver Apple MacBook Air laptop", "electronics", "Apple", "MacBook Air", "good", "790000000", "2026-07-05T12:00:00.000Z", 0.93, "Same visible product family and a similar described exterior condition."),
  comparable("sold-macbook-air-b", "Apple MacBook Air laptop", "electronics", "Apple", "MacBook Air", "very_good", "850000000", "2026-07-14T12:00:00.000Z", 0.88, "Same product family in a cleaner described condition."),
  comparable("sold-switch-oled-a", "Nintendo Switch OLED white", "electronics", "Nintendo", "Switch OLED", "good", "270000000", "2026-07-28T12:00:00.000Z", 0.95, "Same handheld console model and visible white colorway."),
  comparable("sold-sony-xm5-a", "Sony WH-1000XM5 black headphones", "electronics", "Sony", "WH-1000XM5", "very_good", "230000000", "2026-08-02T12:00:00.000Z", 0.94, "Same headphone model, visible color, and similar described condition."),
  comparable("sold-pixel8-a", "Google Pixel 8 blue phone", "electronics", "Google", "Pixel 8", "good", "365000000", "2026-08-03T12:00:00.000Z", 0.95, "Same phone model and visible blue finish with similar cosmetic wear."),
  comparable("sold-kayano30-a", "ASICS Gel-Kayano 30 white and blue", "running_shoes", "ASICS", "Gel-Kayano 30", "very_good", "99000000", "2026-07-08T12:00:00.000Z", 0.96, "Exact running-shoe model and color family with similar visible outsole wear."),
  comparable("sold-kayano30-b", "ASICS Gel-Kayano 30 running shoes", "running_shoes", "ASICS", "Gel-Kayano 30", "good", "84000000", "2026-07-18T12:00:00.000Z", 0.86, "Same stability-running model with more described wear."),
  comparable("sold-pegasus40-a", "Nike Pegasus 40 white and orange", "running_shoes", "Nike", "Pegasus 40", "good", "73000000", "2026-07-11T12:00:00.000Z", 0.96, "Exact running-shoe model and color family with similar sole condition."),
  comparable("sold-pegasus40-b", "Nike Pegasus 40 road runners", "running_shoes", "Nike", "Pegasus 40", "very_good", "88000000", "2026-07-25T12:00:00.000Z", 0.87, "Same neutral running model in a cleaner described condition."),
  comparable("sold-ghost15-a", "Brooks Ghost 15 blue running shoes", "running_shoes", "Brooks", "Ghost 15", "good", "79000000", "2026-07-09T12:00:00.000Z", 0.96, "Exact running-shoe model and color family with comparable wear."),
  comparable("sold-ghost15-b", "Brooks Ghost 15 road runners", "running_shoes", "Brooks", "Ghost 15", "very_good", "92000000", "2026-07-30T12:00:00.000Z", 0.88, "Same running model in a cleaner described condition."),
  comparable("sold-1080v13-a", "New Balance 1080v13 white and orange", "running_shoes", "New Balance", "Fresh Foam X 1080v13", "very_good", "121000000", "2026-07-21T12:00:00.000Z", 0.98, "Exact running-shoe model and color family with similar visible condition."),
  comparable("sold-1080v13-b", "New Balance 1080v13 road runners", "running_shoes", "New Balance", "Fresh Foam X 1080v13", "good", "104000000", "2026-08-04T12:00:00.000Z", 0.9, "Same cushioned running model with more described outsole use."),
  comparable("sold-af1-07-white-a", "Nike Air Force 1 '07 white sneakers", "sneakers", "Nike", "Air Force 1 '07", "very_good", "108000000", "2026-07-16T12:00:00.000Z", 0.97, "Same lifestyle-sneaker model and visible all-white colorway in a similar described condition."),
  comparable("sold-af1-07-white-b", "White Nike Air Force 1 '07", "sneakers", "Nike", "Air Force 1 '07", "good", "92000000", "2026-08-01T12:00:00.000Z", 0.91, "Same model and all-white colorway with more described cosmetic wear."),
  comparable("sold-af1-miami-hook-a", "Nike Air Force 1 Miami Dolphins Double Hook", "sneakers", "Nike", "Air Force 1 Miami Dolphins Double Hook", "very_good", "129000000", "2026-07-19T12:00:00.000Z", 0.98, "Same lifestyle-sneaker variant with matching visible white, orange, and teal color details."),
  comparable("sold-af1-miami-hook-b", "Air Force 1 white double-hook sneakers", "sneakers", "Nike", "Air Force 1 Miami Dolphins Double Hook", "good", "112000000", "2026-08-06T12:00:00.000Z", 0.9, "Same double-hook model and color family with more described wear."),
]));

/** Explicit test/dev seeding helper. Production reads never fall back to static fixtures. */
export async function seedSoldComparables(
  repository: MarketplaceRepository,
  comparables: readonly SoldComparable[] = SEED_SOLD_COMPARABLES
): Promise<void> {
  const validated = SoldComparableSchema.array().max(MAX_SOLD_COMPARABLES).parse(structuredClone(comparables));
  for (const comparable of validated) {
    await repository.createSoldComparable(comparable);
  }
}
