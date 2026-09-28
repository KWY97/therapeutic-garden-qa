import "dotenv/config";
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",

  use: {
    baseURL: process.env.BASE_URL || "http://localhost:8080",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
});
