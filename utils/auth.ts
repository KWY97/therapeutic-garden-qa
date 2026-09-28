import { expect, Page } from '@playwright/test';

export async function loginAsAdmin(page: Page) {
  const loginId = process.env.ADMIN_LOGIN_ID;
  const password = process.env.ADMIN_PASSWORD;

  if (!loginId || !password) {
    throw new Error(
      'ADMIN_LOGIN_ID와 ADMIN_PASSWORD 환경변수가 필요합니다.'
    );
  }

  await page.goto('/admin/login');

  await page.getByLabel('아이디').fill(loginId);
  await page.getByLabel('비밀번호').fill(password);

  await page.getByRole('button', { name: '로그인' }).click();

  await expect(page).toHaveURL(/\/admin\/monitoring/);
}