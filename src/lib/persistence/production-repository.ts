import "server-only";
import { VercelBlobMarketplaceRepository } from "./vercel-blob-marketplace-repository";
import type { MarketplaceRepository } from "./repository";

export function createMarketplaceRepository(): MarketplaceRepository {
  return new VercelBlobMarketplaceRepository();
}
