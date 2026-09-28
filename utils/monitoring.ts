import { expect, Locator, Page } from "@playwright/test";

export async function expectLoadedImage(image: Locator) {
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((element: HTMLImageElement) =>
    element.complete && element.naturalWidth > 0,
  ), { timeout: 10_000 }).toBe(true);
}

export async function openRenderedSpot(page: Page) {
  const canvas = page.locator("#monitoringCanvas");
  await expect(canvas).toBeVisible({ timeout: 10_000 });
  // Every rendered hotspot has this accessible-name suffix (home-spatial.js).
  // Any currently displayed spot is suitable; no database ID or HS code is fixed.
  const hotspot = canvas.getByRole("button", { name: / 상세 보기$/ }).first();
  await expect(hotspot).toBeVisible();
  const title = (await hotspot.getAttribute("aria-label"))!.replace(/ 상세 보기$/, "");
  const responsePromise = page.waitForResponse(response =>
    /\/api\/sites\/[^/]+\/spots\/[^/]+$/.test(new URL(response.url()).pathname)
      && response.request().method() === "GET",
  );
  await hotspot.click();
  const response = await responsePromise;
  expect(response.ok(), "HS 상세 조회 응답").toBe(true);
  const spot = await response.json();
  const dialog = page.getByRole("dialog", { name: title, exact: true });
  await expect(dialog).toBeVisible();
  // Wait for the fresh response to replace the initial preview and thumbnails.
  await expect(dialog.locator("#spotGalleryStatus")).toHaveText("");
  expect(Array.isArray(spot.images)).toBe(true);
  return { dialog, spot };
}

export async function expectInitialGallery(dialog: Locator, spot: {
  images: { readUrl: string; representative: boolean; displayOrder: number; imageId: number }[];
}) {
  const images = [...spot.images].sort((a, b) => a.displayOrder - b.displayOrder || a.imageId - b.imageId);
  const initial = images.find(image => image.representative) || images[0];
  const main = dialog.locator("#spotImage");
  if (initial) {
    await expect(main).toHaveAttribute("src", initial.readUrl);
    await expectLoadedImage(main);
    await expect(dialog.locator("#spotImageEmpty")).toBeHidden();
  } else {
    await expect(main).toBeHidden();
    await expect(main).not.toHaveAttribute("src");
    await expect(dialog.locator("#spotImageEmpty")).toBeVisible();
    await expect(dialog.locator("#spotImageEmpty")).toContainText("등록된 이미지가 없습니다.");
  }
}
