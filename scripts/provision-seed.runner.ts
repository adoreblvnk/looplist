import { expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createMarketplaceRepository } from "../src/lib/persistence/production-repository";
import { provisionSeedMarketplace } from "../src/lib/persistence/provision-seed-marketplace";

test("explicitly provisions the canonical private seed corpus", async () => {
  expect(process.env.BLOB_READ_WRITE_TOKEN, "BLOB_READ_WRITE_TOKEN is required").toBeTruthy();
  const result = await provisionSeedMarketplace(createMarketplaceRepository());
  console.info(`Provisioned ${result.media} private media objects, ${result.listings} listings, and ${result.soldComparables} sold comparables.`);
}, 180_000);
