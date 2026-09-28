import { test, expect } from "@playwright/test";
import { loginAsAdmin } from "../utils/auth";
import { expectInitialGallery, expectLoadedImage, openRenderedSpot } from "../utils/monitoring";

test.beforeEach(async ({ page }) => { await loginAsAdmin(page); });

test("렌더링된 HS의 상세 정보와 이미지 상태가 표시된다", async ({ page }) => {
  const siteName = await page.locator("#siteName").innerText();
  const siteAddress = await page.locator("#siteAddress").innerText();
  const { dialog, spot } = await openRenderedSpot(page);
  const fields = {
    spotId: spot.code,
    spotName: spot.name,
    spotCourse: spot.course || [spot.courseCode, spot.courseName].filter(Boolean).join(" · "),
    spotSiteName: spot.siteName ?? siteName,
    spotSiteAddress: spot.siteAddress ?? siteAddress,
  };
  for (const [id, value] of Object.entries(fields)) {
    expect(value, `${id} 데이터`).toEqual(expect.stringMatching(/\S/));
    await expect(dialog.locator(`#${id}`)).toBeVisible();
    await expect(dialog.locator(`#${id}`)).toHaveText(value);
  }
  await expect(dialog.getByText("시연용 데이터", { exact: true })).toBeVisible();
  await expectInitialGallery(dialog, spot);
  await dialog.getByRole("button", { name: "HS 상세 닫기" }).click();
  await expect(dialog).toBeHidden();
});

test("HS Gallery 대표 이미지와 다른 Thumbnail 전환", async ({ page }, testInfo) => {
  const { dialog, spot } = await openRenderedSpot(page);
  await expectInitialGallery(dialog, spot);
  const thumbnails = dialog.locator("#spotThumbnails");
  const buttons = thumbnails.getByRole("button", { includeHidden: true });
  await expect(buttons).toHaveCount(spot.images.length);
  if (spot.images.length < 2) {
    await expect(thumbnails).toBeHidden();
    testInfo.annotations.push({ type: "gallery", description: `이미지 ${spot.images.length}개: 초기 상태 검증 완료, 전환 대상 없음` });
    return;
  }
  await expect(thumbnails).toBeVisible();
  const main = dialog.locator("#spotImage");
  const previous = await main.getAttribute("src");
  const other = thumbnails.getByRole("button", { pressed: false }).first();
  const next = await other.getByRole("img").getAttribute("src");
  expect(next).toBeTruthy();
  expect(next).not.toBe(previous);
  await other.click();
  await expect(other).toHaveAttribute("aria-pressed", "true");
  await expect(main).toHaveAttribute("src", next!);
  await expectLoadedImage(main);
  await expect(thumbnails.getByRole("button", { pressed: true })).toHaveCount(1);
});
