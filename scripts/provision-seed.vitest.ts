import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["scripts/provision-seed.runner.ts"],
    maxWorkers: 1,
  },
});
