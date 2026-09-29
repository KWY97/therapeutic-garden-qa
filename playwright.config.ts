import "dotenv/config";
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  outputDir: "test-results",
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  projects: [
    { name: "readonly", testMatch: /(?:login|monitoring|healing-spot|map|navigation|smoke)\.spec\.ts$/ },
    { name: "crud", testMatch: /(?:site-crud|participant)\.spec\.ts$/ },
  ],
  use: {
    baseURL: process.env.BASE_URL || "http://localhost:8080",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
});
