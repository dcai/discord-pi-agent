import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    reporters: process.env.GITHUB_ACTIONS
      ? ["default", "github-actions"]
      : ["default"],
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html", "lcov"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.ts"],
      exclude: [
        "src/types.ts",
        "src/**/*.d.ts",
        "src/**/*.test.ts",
        "src/**/__snapshots__/**",
        "dist/**",
      ],
    },
  },
});
