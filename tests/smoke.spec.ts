import { test, expect } from "../utils/test";

test("서비스 메인 페이지 열기", async ({ page, baseURL }) => {
  await page.goto("/");

  await expect(page).toHaveURL(new URL("/", baseURL!).href);
});
