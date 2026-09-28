import { test, expect } from "@playwright/test";
import { loginAsAdmin } from "../utils/auth";

test("지도 Modal을 열고 닫을 수 있다", async ({ page }) => {
  await loginAsAdmin(page);
  await page.getByRole("button", { name: "지도 보기", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: /지도$/ });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("#map")).toBeVisible();
  // Inspected live SDK DOM: unnamed presentation images and generated
  // daum.maps.Marker.Area:N / area nodes. No stable app-owned marker locator.
  // Keep SDK tile loading and marker clicks outside this deterministic smoke test.
  await dialog.getByRole("button", { name: "지도 닫기" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: "지도 보기", exact: true })).toBeFocused();
});
