import { test, expect } from "../utils/test";
import { loginAsAdmin } from "../utils/auth";

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
});

test("공간 모니터링 화면이 정상적으로 로딩된다", async ({ page }) => {
  // 로그인 성공 후 관리자 Monitoring으로 이동했는지 확인
  await expect(page).toHaveURL(/\/admin\/monitoring/);

  // 화면 제목 확인
  await expect(
    page.getByRole("heading", { name: "공간 모니터링" }),
  ).toBeVisible();

  // 공간 데이터 로딩이 끝나면 hidden이 해제되는 실제 Monitoring Canvas
  const monitoringCanvas = page.locator("#monitoringCanvas");

  await expect(monitoringCanvas).toBeVisible({
    timeout: 10_000,
  });

  // Monitoring Canvas 안에 실제 이미지가 하나 이상 표시되는지 확인
  const images = monitoringCanvas.locator("img");

  await expect(images.first()).toBeVisible();
});
