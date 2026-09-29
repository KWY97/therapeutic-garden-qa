import { randomUUID } from 'node:crypto';
import { test as base, expect, type Page, type TestInfo } from '../utils/test';
import { loginAsAdmin } from '../utils/auth';

// The administrator UI exposes participant management under /admin/members.
const listPath = '/admin/members';

function localOrigin(baseURL?: string): string | undefined {
  try {
    const url = new URL(baseURL ?? '');
    if (['http:', 'https:'].includes(url.protocol)
      && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      && !url.username && !url.password) return url.origin;
  } catch { /* Invalid or non-local URLs never run mutation QA. */ }
}

type OwnedParticipant = {
  name: string;
  loginId: string;
  password: string;
  groupNo: string;
  phone: string;
  attempted: boolean;
  href?: string;
  baseline: { href: string; text: string }[];
};

const test = base.extend<{ owned: OwnedParticipant }>({
  owned: [async ({ baseURL, context }, use, testInfo) => {
    const origin = localOrigin(baseURL);
    test.skip(!origin, '참가자 mutation은 localhost / 127.0.0.1 / [::1]에서만 실행합니다.');
    const suffix = randomUUID().replaceAll('-', '');
    const owned: OwnedParticipant = {
      name: `[QA] Participant ${suffix}`,
      loginId: `qa-participant-${suffix}`,
      password: `Qa!${suffix.slice(0, 12)}`,
      groupNo: String(1 + Math.floor(Math.random() * 3)),
      phone: `010${String(Math.floor(Math.random() * 1_0000_0000)).padStart(8, '0')}`,
      attempted: false,
      baseline: [],
    };
    testInfo.annotations.push({ type: 'qa-participant', description: `${owned.name} / ${owned.loginId}` });
    await context.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      const mutation = !['GET', 'HEAD', 'OPTIONS'].includes(request.method());
      const mainNavigation = request.isNavigationRequest() && !request.frame().parentFrame();
      if ((mutation || mainNavigation) && url.origin !== origin) return route.abort('blockedbyclient');
      if (mutation) {
        const allowedAuth = request.method() === 'POST'
          && ['/admin/login', '/member/login'].includes(url.pathname);
        // The create form lives at /new but submits to the collection URL.
        const allowedCreate = request.method() === 'POST' && url.pathname === listPath
          && owned.attempted;
        const allowedDelete = request.method() === 'POST' && Boolean(owned.href)
          && url.pathname === `${owned.href}/delete`;
        if (!allowedAuth && !allowedCreate && !allowedDelete) return route.abort('blockedbyclient');
        if (allowedCreate) {
          const fields = new URLSearchParams(request.postData() ?? '');
          if (fields.get('loginId') !== owned.loginId
            || ![owned.name, `${owned.name} duplicate-attempt`].includes(fields.get('name') ?? '')) {
            return route.abort('blockedbyclient');
          }
        }
      }
      await route.continue();
    });
    try { await use(owned); }
    finally {
      if (owned.attempted) {
        const cleanupPage = await context.newPage();
        try {
          await loginAsAdmin(cleanupPage);
          await deleteOwnedParticipant(cleanupPage, owned);
        } catch (error) {
          const message = `Participant cleanup 실패: ${owned.name} / ${owned.loginId}; ${String(error)}`;
          await testInfo.attach('participant-cleanup-error', { body: message, contentType: 'text/plain' });
          console.error(message);
          if (testInfo.status === testInfo.expectedStatus) throw error;
        } finally { await cleanupPage.close(); }
      }
    }
  }, { timeout: 60_000 }],
});

test.describe.configure({ mode: 'default' });

async function openList(page: Page) {
  await page.goto(listPath);
  await expect(page.getByRole('heading', { name: '참가자 목록', exact: true })).toBeVisible();
}

async function captureBaseline(page: Page, owned: OwnedParticipant) {
  await openList(page);
  owned.baseline = await page.getByRole('table').getByRole('row').filter({
    has: page.getByRole('link'),
  }).evaluateAll(rows => rows.map(row => ({
    href: row.querySelector('a')!.getAttribute('href')!, text: row.textContent!.trim(),
  })));
  expect(owned.baseline).toHaveLength(11);
  expect(owned.baseline.some(row => row.text.includes(owned.loginId))).toBe(false);
}

function exactNameLink(page: Page, name: string) {
  return page.getByRole('table').getByRole('link', { name, exact: true });
}

async function findOwned(page: Page, owned: OwnedParticipant) {
  await openList(page);
  const ownedRows = page.getByRole("table").getByRole("row").filter({
    has: page.getByText(owned.loginId, { exact: true }),
  });
  const count = await ownedRows.count();
  expect(count, "이번 실행에서 만든 loginId만 정확히 한 행이어야 함").toBeLessThanOrEqual(1);
  const candidate = ownedRows.getByRole("link");
  if (count === 1) {
    await expect(candidate).toHaveCount(1);
    const href = await candidate.getAttribute("href");
    expect(href).toMatch(/^\/admin\/members\/\d+$/);
    expect(owned.baseline.some(row => row.href === href), "기존 참가자 삭제 금지").toBe(false);
    if (owned.href) expect(href).toBe(owned.href);
    owned.href = href!;
  }
  return candidate;
}

async function deleteOwnedParticipant(page: Page, owned: OwnedParticipant) {
  const candidate = await findOwned(page, owned);
  if (await candidate.count() === 1) {
    await candidate.click();
    await expect(page).toHaveURL(new RegExp(`${owned.href}$`));
    const deleteButton = page.getByRole("button", { name: "참가자 삭제", exact: true });
    await expect(page.locator(`form[action=\"${owned.href}/delete\"]`).getByRole("button", {
      name: "참가자 삭제", exact: true,
    })).toBeEnabled();
    const deleteResponse = page.waitForResponse(response => response.request().method() === "POST"
      && new URL(response.url()).pathname === `${owned.href}/delete`);
    const onDialog = async (dialog: import("@playwright/test").Dialog) => {
      if (dialog.type() === "confirm"
        && dialog.message() === "참가자를 삭제하면 해당 참가자의 모든 일정도 함께 삭제됩니다. 정말 삭제하시겠습니까?") {
        await dialog.accept();
      } else await dialog.dismiss();
    };
    page.on("dialog", onDialog);
    let response;
    try {
      await deleteButton.click();
      response = await deleteResponse;
    } finally { page.off("dialog", onDialog); }
    expect(new URL(response.url()).pathname).toBe(`${owned.href}/delete`);
    expect(response.status()).toBe(302);
    expect(new URL(response.headers().location!, response.url()).pathname).toMatch(new RegExp(`^${listPath}/?$`));
    await expect(page).toHaveURL(new RegExp(`${listPath}/?$`));
    await expect(page.getByRole("heading", { name: "참가자 목록", exact: true })).toBeVisible();
  }
  await openList(page);
  await expect(page.getByRole("table").getByRole("row").filter({
    has: page.getByText(owned.loginId, { exact: true }),
  })).toHaveCount(0);
  for (const row of owned.baseline) {
    const original = page.getByRole("row").filter({ has: page.locator(`a[href=\"${row.href}\"]`) });
    await expect(original).toHaveCount(1);
    await expect(original).toHaveText(row.text);
  }
}

async function openCreateForm(page: Page) {
  await page.getByRole('link', { name: '참가자 등록', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${listPath}/new$`));
}

async function fillParticipantForm(page: Page, owned: OwnedParticipant) {
  await page.getByLabel('그룹', { exact: true }).selectOption({ label: `${owned.groupNo}그룹` });
  await page.getByLabel('로그인 아이디', { exact: true }).fill(owned.loginId);
  await page.getByLabel('초기 비밀번호', { exact: true }).fill(owned.password);
  await page.getByLabel('이름', { exact: true }).fill(owned.name);
  await page.getByLabel('전화번호', { exact: true }).fill(owned.phone);
}

async function createParticipant(page: Page, owned: OwnedParticipant) {
  await openCreateForm(page);
  await fillParticipantForm(page, owned);
  owned.attempted = true; // Teardown can recover a create whose response was lost.
  await page.getByRole('button', { name: '참가자 등록', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/members\/\d+$/);
  await expect(page.getByText(owned.name, { exact: true })).toBeVisible();
  await expect(page.getByText(owned.loginId, { exact: true })).toBeVisible();
  await expect(page.getByText(new RegExp(`그룹\\s*${owned.groupNo}|${owned.groupNo}\\s*그룹`))).toBeVisible();
  const detail = await page.locator('body').innerText();
  const numberMatch = detail.match(/참가자\s*번호\s*[:：]?\s*(\d+)/);
  expect(numberMatch?.[1], '서비스가 participantNo를 숫자로 자동 발급해야 함').toMatch(/^\d+$/);
  owned.href = page.url().replace(new URL(page.url()).origin, '');
}

test('관리자 참가자 등록 → 참가자 로그인 → QA 참가자 삭제 @crud', async ({ page, owned }) => {
  test.setTimeout(90_000);
  await loginAsAdmin(page);
  await captureBaseline(page, owned);
  await openCreateForm(page);
  await fillParticipantForm(page, owned);
  owned.attempted = true;
  await page.getByRole('button', { name: '참가자 등록', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/members\/\d+$/);
  owned.href = new URL(page.url()).pathname;
  await expect(page.getByText(owned.name, { exact: true })).toBeVisible();
  await expect(page.getByText(owned.loginId, { exact: true })).toBeVisible();
  await expect(page.getByText(new RegExp(`그룹\\s*${owned.groupNo}|${owned.groupNo}\\s*그룹`))).toBeVisible();
  const detailText = await page.locator('body').innerText();
  const generatedNo = detailText.match(/참가자\s*번호\s*[:：]?\s*(\d+)/)?.[1];
  expect(generatedNo, 'participantNo 자동 생성').toMatch(/^\d+$/);
  await page.getByRole('link', { name: '로그아웃', exact: true }).click();
  await page.goto('/member/login');
  await page.getByLabel('아이디', { exact: true }).fill(owned.loginId);
  await page.getByLabel('비밀번호', { exact: true }).fill(owned.password);
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await expect(page).toHaveURL(/\/member(?:\/home)?\/?$/);
  await expect(page.getByRole('link', { name: '로그아웃', exact: true })).toBeVisible();
  await page.getByRole('link', { name: '로그아웃', exact: true }).click();

  await loginAsAdmin(page);
  await deleteOwnedParticipant(page, owned);
});

test('중복 loginId 거부 및 QA 참가자 정리 @crud', async ({ page, owned }) => {
  await loginAsAdmin(page);
  await captureBaseline(page, owned);
  await createParticipant(page, owned);
  await openList(page);
  await openCreateForm(page);
  const duplicateName = `${owned.name} duplicate-attempt`;
  await page.getByLabel('그룹', { exact: true }).selectOption({ label: `${owned.groupNo}그룹` });
  await page.getByLabel('로그인 아이디', { exact: true }).fill(owned.loginId);
  await page.getByLabel('초기 비밀번호', { exact: true }).fill(owned.password);
  await page.getByLabel('이름', { exact: true }).fill(duplicateName);
  await page.getByLabel('전화번호', { exact: true }).fill(owned.phone);
  const responsePromise = page.waitForResponse(response => response.request().method() === 'POST'
    && new URL(response.url()).pathname === listPath);
  await page.getByRole('button', { name: '참가자 등록', exact: true }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  expect(new URL(response.url()).pathname).toBe(listPath);
  await expect(page).toHaveURL(new RegExp(`${listPath}/?$`));
  await expect(page.getByRole('heading', { name: '참가자 등록', exact: true })).toBeVisible();
  await expect(page.getByLabel('로그인 아이디', { exact: true })).toHaveValue(owned.loginId);
  await expect(page.getByText(/이미 사용 중인 로그인 아이디/)).toBeVisible();
  await openList(page);
  await expect(page.getByRole('table').getByRole('row').filter({
    has: page.getByText(owned.loginId, { exact: true }),
  })).toHaveCount(1);
  await deleteOwnedParticipant(page, owned);
});

test('필수 입력 누락 시 참가자 등록 화면에서 Validation 표시 @crud', async ({ page, owned }) => {
  await loginAsAdmin(page);
  await captureBaseline(page, owned);
  await openCreateForm(page);
  await page.getByLabel('그룹', { exact: true }).selectOption({ label: `${owned.groupNo}그룹` });
  await page.getByLabel('로그인 아이디', { exact: true }).fill(owned.loginId);
  const passwordInput = page.getByLabel('초기 비밀번호', { exact: true });
  await expect(passwordInput).toHaveValue('');
  await page.getByLabel('전화번호', { exact: true }).fill(owned.phone);
  expect(new URL(page.url()).pathname).toBe(`${listPath}/new`);
  const validity = await passwordInput.evaluate((input: HTMLInputElement) => ({
    required: input.required,
    valid: input.checkValidity(),
    message: input.validationMessage,
  }));
  expect(validity.required).toBe(true);
  expect(validity.valid).toBe(false);
  expect(validity.message).not.toBe('');
  const postRequests: string[] = [];
  const recordRequest = (request: import('@playwright/test').Request) => {
    if (request.method() === 'POST') postRequests.push(request.url());
  };
  page.on('request', recordRequest);
  await page.getByRole('button', { name: '참가자 등록', exact: true }).click();
  page.off('request', recordRequest);
  expect(postRequests).toEqual([]);
  await expect(page).toHaveURL(new RegExp(`${listPath}/new$`));
  await expect(page.getByRole('heading', { name: '참가자 등록', exact: true })).toBeVisible();
  await openList(page);
  await expect(page.getByText(owned.loginId, { exact: true })).toHaveCount(0);
  for (const row of owned.baseline) {
    await expect(page.getByRole('row').filter({ has: page.locator(`a[href="${row.href}"]`) })).toHaveText(row.text);
  }
});
