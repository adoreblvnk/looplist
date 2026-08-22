import "server-only";
import {
  VercelBlobMarketplaceRepository,
  vercelPrivateBlobTransport,
} from "./vercel-blob-marketplace-repository";
import type { MarketplaceRepository } from "./repository";

export function createMarketplaceRepository(): MarketplaceRepository {
  return new VercelBlobMarketplaceRepository(
    vercelPrivateBlobTransport,
    process.env.X402_PAY_TO_ADDRESS,
  );
}
