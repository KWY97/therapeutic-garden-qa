import { test, expect } from "@playwright/test";

test("서비스 메인 페이지 열기", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveURL(/localhost:8080/);
});
