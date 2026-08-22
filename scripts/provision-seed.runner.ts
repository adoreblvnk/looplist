import { expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createMarketplaceRepository } from "../src/lib/persistence/production-repository";
import { provisionSeedMarketplace } from "../src/lib/persistence/provision-seed-marketplace";

test("explicitly provisions the canonical private seed corpus", async () => {
  expect(process.env.X402_PAY_TO_ADDRESS, "X402_PAY_TO_ADDRESS is required").toMatch(/^0x[a-fA-F0-9]{40}$/);
  const result = await provisionSeedMarketplace(createMarketplaceRepository(), {
    recipientAddress: process.env.X402_PAY_TO_ADDRESS!,
  });
  console.info(`Provisioned ${result.media} private media objects, ${result.listings} listings, and ${result.soldComparables} sold comparables.`);
}, 180_000);
