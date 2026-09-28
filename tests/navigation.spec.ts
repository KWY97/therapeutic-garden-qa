import { test, expect, Locator, Page } from "@playwright/test";
import { loginAsAdmin } from "../utils/auth";

async function followReadOnlyLink(page: Page, link: Locator, heading: string) {
  const href = await link.getAttribute("href");
  expect(href).toBeTruthy();
  const destination = new URL(href!, page.url()).href;
  const responsePromise = page.waitForResponse(response =>
    response.request().isNavigationRequest() && response.request().resourceType() === "document"
      && response.url() === destination,
  );
  await link.click();
  const response = await responsePromise;
  expect(response.status(), destination).toBe(200);
  await expect(page).toHaveURL(destination);
  await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
  await expect(page.getByText(/Whitelabel Error Page|Internal Server Error/)).toHaveCount(0);
}

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
  await followReadOnlyLink(page, page.getByRole("link", { name: "관리자 페이지", exact: true }), "관리자 메인");
});

for (const [menu, heading] of [
  ["사이트 관리", "Site 목록"],
  ["참가자 관리", "참가자 목록"],
  ["일정 목록", "일정 목록"],
  ["달력 보기", "전체 일정"],
]) {
  test(`관리자 메뉴 ${menu} 조회`, async ({ page }) => {
    await followReadOnlyLink(page, page.getByRole("navigation", { name: "관리 기능" })
      .getByRole("link", { name: menu, exact: true }), heading);
  });
}

test("Site → HC → HS 목록과 상세 조회", async ({ page }) => {
  await followReadOnlyLink(page, page.getByRole("link", { name: "사이트 관리", exact: true }), "Site 목록");
  // List tables contain only entity-detail links; select existing data, never new/edit links.
  await followReadOnlyLink(page, page.getByRole("table").getByRole("link").first(), "사이트 상세 정보");
  await followReadOnlyLink(page, page.getByRole("link", { name: "HC 관리", exact: true }), "HC 목록");
  await followReadOnlyLink(page, page.getByRole("table").getByRole("link").first(), "HC 상세 정보");
  await followReadOnlyLink(page, page.getByRole("link", { name: "HS 관리", exact: true }), "HS 목록");
  await followReadOnlyLink(page, page.getByRole("table").getByRole("link").first(), "HS 상세 정보");
});
