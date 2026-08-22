import "server-only";
import { localPrivateBlobTransport } from "./local-private-blob-transport";
import { VercelBlobMarketplaceRepository } from "./vercel-blob-marketplace-repository";
import type { MarketplaceRepository } from "./repository";

export function createMarketplaceRepository(): MarketplaceRepository {
  return new VercelBlobMarketplaceRepository(
    localPrivateBlobTransport,
    process.env.X402_PAY_TO_ADDRESS,
  );
}
