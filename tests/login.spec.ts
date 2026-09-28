import { test } from "../utils/test";
import { loginAsAdmin } from "../utils/auth";

test("관리자 로그인이 된다", async ({ page }) => {
  await loginAsAdmin(page);
});
