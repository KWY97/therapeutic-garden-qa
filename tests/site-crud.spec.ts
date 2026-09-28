import { randomUUID } from 'node:crypto';
import { test as base, expect, Page, TestInfo } from '@playwright/test';
import { ImageRun, imagePayloadAllowed, openImageEditor, cleanupImages, runImageScenario } from '../utils/spot-images';
import { loginAsAdmin } from '../utils/auth';

const listPath = '/admin/sites';
const address = '서울 중구 세종대로 110';
type OwnedSite = {
  names: [string, string];
  href?: string;
  attempted: boolean;
  baseline: { href: string; text: string }[];
  course?: { names: [string, string]; code: string; href?: string; attempted: boolean };
  spot?: { names: [string, string]; code: string; href?: string; attempted: boolean };
  images?: ImageRun;
  originalSpots?: { list: string; rows: { href: string; text: string }[] }[];
  originalCourses?: { list: string; rows: { href: string; text: string }[] }[];
};

function localOrigin(baseURL?: string): string | undefined {
  try {
    const url = new URL(baseURL ?? '');
    if (['http:', 'https:'].includes(url.protocol)
      && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      && !url.username && !url.password) return url.origin;
  } catch { /* Invalid or non-local URLs never run CRUD. */ }
}

async function openList(page: Page) {
  await page.goto(listPath);
  await expect(page.getByRole('heading', { name: 'Site 목록', exact: true })).toBeVisible();
}

async function assertOriginalSites(page: Page, owned: OwnedSite) {
  for (const original of owned.baseline) {
    const row = page.getByRole('row').filter({
      has: page.getByRole('link').and(page.locator(`a[href="${original.href}"]`)),
    });
    await expect(row).toHaveCount(1);
    await expect(row).toHaveText(original.text);
  }
}

async function deleteOwnedSite(page: Page, owned: OwnedSite) {
  await openList(page);
  // Never sweep [QA] rows: only this invocation's two exact names are eligible.
  const links = page.getByRole('table').getByRole('link');
  const candidates = links.filter({ hasText: new RegExp(`^${owned.names.map(
    name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
  ).join('$|^')}$`) });
  const count = await candidates.count();
  expect(count, '현재 실행의 QA Site는 최대 하나여야 함').toBeLessThanOrEqual(1);
  if (count === 1) {
    const href = await candidates.getAttribute('href');
    expect(href).toMatch(/^\/admin\/sites\/\d+$/);
    expect(owned.baseline.some(site => site.href === href), '기존 Site 삭제 금지').toBe(false);
    if (owned.href) expect(href).toBe(owned.href);
    owned.href = href!;
    const name = (await candidates.innerText()).trim();
    expect(owned.names).toContain(name);
    await candidates.click();
    await expect(page).toHaveURL(new RegExp(`${owned.href}$`));
    await expect(page.getByText(name, { exact: true })).toBeVisible();
    const button = page.getByRole('button', { name: 'Site 삭제', exact: true });
    await expect(page.locator(`form[action="${owned.href}/delete"]`).getByRole('button', {
      name: 'Site 삭제', exact: true,
    })).toBeEnabled();
    const onDialog = async (dialog: import('@playwright/test').Dialog) => {
      if (dialog.type() === 'confirm' && dialog.message() === '정말 이 사이트를 삭제하시겠습니까?') {
        await dialog.accept();
      } else await dialog.dismiss();
    };
    page.on('dialog', onDialog);
    try {
      await button.click();
      await expect(page).toHaveURL(/\/admin\/sites$/);
    } finally { page.off('dialog', onDialog); }
  }
  // A fresh GET verifies server state, including a delete whose redirect was lost.
  await openList(page);
  for (const name of owned.names) await expect(page.getByRole('table').getByRole('link', { name, exact: true })).toHaveCount(0);
  if (owned.href) await expect(page.locator(`a[href="${owned.href}"]`)).toHaveCount(0);
  await assertOriginalSites(page, owned);
}

const test = base.extend<{ owned: OwnedSite }>({
  owned: [async ({ baseURL, context }, use, testInfo) => {
    const origin = localOrigin(baseURL);
    test.skip(!origin, '관리자 CRUD는 localhost / 127.0.0.1 / [::1]에서만 실행합니다.');
    const suffix = `${Date.now()}-${randomUUID()}`;
    const owned: OwnedSite = {
      names: [`[QA] Site ${suffix}`, `[QA] Site ${suffix} 수정`],
      attempted: false, baseline: [],
    };
    testInfo.annotations.push({ type: 'qa-site', description: owned.names.join(' → ') });
    await context.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      const mutation = !['GET', 'HEAD', 'OPTIONS'].includes(request.method());
      const mainNavigation = request.isNavigationRequest() && !request.frame().parentFrame();
      // Block remote form targets/redirects too; SDK read requests and iframes remain usable.
      if ((mutation || mainNavigation) && url.origin !== origin) return route.abort('blockedbyclient');
      if (mutation) {
        const course = owned.course;
        const courseWrite = course && owned.href && (
          (course.attempted && url.pathname === '/admin/courses/new')
          || (course.href && [`${course.href}/edit`, `${course.href}/delete`].includes(url.pathname))
        );
        // Course forms are URL-encoded. Require the owned parent and exact run values
        // for create/edit, even if the UI accidentally submits another selected Site.
        const fields = new URLSearchParams(request.postData() ?? '');
        const courseFieldsMatch = course && owned.href
          && fields.get('siteId') === owned.href.split('/').pop()
          && fields.get('code') === course.code
          && course.names.includes(fields.get('name') ?? '');
        const allowedCourse = courseWrite && (url.pathname.endsWith('/delete') || courseFieldsMatch);
        const spot = owned.spot;
        const spotWrite = spot && course?.href && owned.href && (
          (spot.attempted && url.pathname === '/admin/spots/new')
          || (spot.href && [`${spot.href}/edit`, `${spot.href}/delete`].includes(url.pathname))
        );
        let allowedSpot = false;
        if (spotWrite) {
          if (url.pathname.endsWith('/delete')) allowedSpot = true;
          else {
            // The inspected HS form uses multipart encoding even without images.
            // Parse the actual POST, rather than trusting a selected option in the DOM.
            try {
              const form = await new Response(new Uint8Array(request.postDataBuffer() ?? []), {
                headers: { 'content-type': request.headers()['content-type'] ?? '' },
              }).formData();
              allowedSpot = form.getAll('courseId').length === 1
                && form.get('courseId') === course!.href!.split('/').pop()
                && form.getAll('code').length === 1 && form.get('code') === spot!.code
                && form.getAll('name').length === 1 && spot!.names.includes(String(form.get('name')))
                && await imagePayloadAllowed(form, owned.images, url.pathname === `${spot!.href}/edit`);
            } catch { /* Reject unparseable or unexpected mutation payloads. */ }
          }
        }
        const allowed = allowedSpot || allowedCourse || url.pathname === '/admin/login'
          || (owned.attempted && url.pathname === `${listPath}/new`)
          || (owned.href && [`${owned.href}/edit`, `${owned.href}/delete`].includes(url.pathname));
        if (!allowed) return route.abort('blockedbyclient');
      }
      await route.continue();
    });
    try { await use(owned); }
    finally {
      if (owned.attempted) {
        const cleanupPage = await context.newPage();
        try {
          await loginAsAdmin(cleanupPage);
          // Stop on child cleanup failure: never cascade into a parent deletion.
          if (owned.images) await cleanupImages(cleanupPage, owned);
          if (owned.spot?.attempted) await deleteOwnedSpot(cleanupPage, owned);
          if (owned.course?.attempted) await deleteOwnedCourse(cleanupPage, owned);
          await deleteOwnedSite(cleanupPage, owned);
          await assertOriginalCourses(cleanupPage, owned);
          await assertOriginalSpots(cleanupPage, owned);
        } catch (error) {
          const message = `Cleanup 실패: ${owned.names.join(' / ')}; HC: ${owned.course?.names.join(' / ') ?? '없음'}; HS: ${owned.spot?.names.join(' / ') ?? '없음'}; ${String(error)}`;
          await testInfo.attach('site-cleanup-error', { body: message, contentType: 'text/plain' });
          console.error(message);
          // Preserve the original scenario failure. Cleanup alone failing still fails the test.
          if (testInfo.status === testInfo.expectedStatus) throw error;
        } finally { await cleanupPage.close(); }
      }
    }
  }, { timeout: 60_000 }],
});

test.describe.configure({ mode: 'default' });

async function createOwnedSite(page: Page, owned: OwnedSite) {
  await loginAsAdmin(page);
  await page.getByRole('link', { name: '관리자 페이지', exact: true }).click();
  await page.getByRole('link', { name: '사이트 관리', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Site 목록', exact: true })).toBeVisible();
  owned.baseline = await page.getByRole('table').getByRole('row').filter({
    has: page.getByRole('link'),
  }).evaluateAll(rows => rows.map(row => ({
    href: row.querySelector('a')!.getAttribute('href')!, text: row.textContent!,
  })));
  for (const name of owned.names) await expect(page.getByRole('link', { name, exact: true })).toHaveCount(0);

  await page.getByRole('link', { name: '사이트 등록', exact: true }).click();
  await page.getByLabel('사이트명', { exact: true }).fill(owned.names[0]);
  // Observed UI: address is readonly; choose a public address through the real postcode UI.
  await page.waitForFunction(() => Boolean((window as Window & { daum?: { Postcode?: unknown } }).daum?.Postcode));
  await page.getByRole('button', { name: '주소 검색', exact: true }).click();
  const search = page.frameLocator('#site-postcode-embed iframe').frameLocator('iframe');
  await search.getByRole('textbox').fill(address);
  await search.getByRole('button', { name: '검색', exact: true }).click();
  await search.getByRole('button', { name: `${address} (서울특별시청)`, exact: true }).click();
  await expect(page.getByRole('dialog', { name: '주소 검색', exact: true })).toBeHidden();
  await expect(page.getByLabel('주소', { exact: true })).toHaveValue(address);
  await expect(page.locator('#latitude')).not.toHaveValue('');
  await expect(page.locator('#longitude')).not.toHaveValue('');
  await expect(page.getByLabel('지도 레벨', { exact: true })).toHaveValue('3');
  owned.attempted = true; // Set before POST, so cleanup also covers lost responses.
  await page.getByRole('button', { name: '사이트 등록', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/sites(?:\/\d+)?$/);
  await openList(page);
  const created = page.getByRole('table').getByRole('link', { name: owned.names[0], exact: true });
  await expect(created).toHaveCount(1);
  owned.href = (await created.getAttribute('href'))!;
  expect(owned.href).toMatch(/^\/admin\/sites\/\d+$/);
  expect(owned.baseline.some(site => site.href === owned.href)).toBe(false);
  await created.click();
}

test('QA Site 등록 → 수정 → 재진입 → 삭제 @crud', async ({ page, owned }) => {
  test.setTimeout(90_000);
  await createOwnedSite(page, owned);
  await expect(page.getByText(owned.names[0], { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Site 수정', exact: true }).click();
  await expect(page.getByLabel('사이트명', { exact: true })).toHaveValue(owned.names[0]);
  await page.getByLabel('사이트명', { exact: true }).fill(owned.names[1]);
  await page.getByRole('button', { name: '사이트 수정', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${owned.href}$`));
  await expect(page.getByText(owned.names[1], { exact: true })).toBeVisible();

  await openList(page);
  await expect(page.getByRole('link', { name: owned.names[0], exact: true })).toHaveCount(0);
  await page.getByRole('table').getByRole('link', { name: owned.names[1], exact: true }).click();
  await page.getByRole('link', { name: 'Site 수정', exact: true }).click();
  await expect(page.getByLabel('사이트명', { exact: true })).toHaveValue(owned.names[1]);
  await expect(page.getByLabel('주소', { exact: true })).toHaveValue(address);
  await expect(page.getByLabel('지도 레벨', { exact: true })).toHaveValue('3');
  await deleteOwnedSite(page, owned);
});

// These CRUD scenarios intentionally share one spec: Playwright runs them sequentially,
// so neither scenario mistakes the other's short-lived QA Site for baseline data.
async function openCourseList(page: Page, owned: OwnedSite) {
  expect(owned.href, 'HC는 이번 실행이 만든 Site 내부에서만 조회/조작').toBeTruthy();
  const siteId = owned.href!.split('/').pop()!;
  await page.goto(`/admin/courses?siteId=${siteId}`);
  await expect(page.getByRole('heading', { name: 'HC 목록', exact: true })).toBeVisible();
  await expect(page.getByLabel('사이트', { exact: true })).toHaveValue(siteId);
  await expect(page.getByRole('link', { name: 'Site 상세로', exact: true })).toHaveAttribute('href', owned.href!);
}

async function assertOriginalCourses(page: Page, owned: OwnedSite) {
  for (const original of owned.originalCourses ?? []) {
    await page.goto(original.list);
    await expect(page.getByRole('heading', { name: 'HC 목록', exact: true })).toBeVisible();
    // Compare the entire original list, including IDs, names, codes and radii.
    await expect(page.getByRole('table').getByRole('link')).toHaveCount(original.rows.length);
    for (const row of original.rows) {
      const match = page.getByRole('row').filter({ has: page.locator(`a[href="${row.href}"]`) });
      await expect(match).toHaveCount(1);
      await expect(match).toHaveText(row.text);
    }
  }
}

async function deleteOwnedCourse(page: Page, owned: OwnedSite) {
  const course = owned.course!;
  // Recover the parent ID if registration completed but its response was lost.
  await openList(page);
  const parent = page.getByRole('table').getByRole('link', { name: owned.names[0], exact: true });
  await expect(parent).toHaveCount(1);
  const href = (await parent.getAttribute('href'))!;
  expect(href).toMatch(/^\/admin\/sites\/\d+$/);
  expect(owned.baseline.some(site => site.href === href)).toBe(false);
  if (owned.href) expect(href).toBe(owned.href);
  owned.href = href;
  await openCourseList(page, owned);
  const table = page.getByRole('table');
  const candidate = table.getByRole('link', { name: course.names[0], exact: true })
    .or(table.getByRole('link', { name: course.names[1], exact: true }));
  expect(await candidate.count(), '이번 실행의 HC는 최대 하나여야 함').toBeLessThanOrEqual(1);
  if (await candidate.count() === 1) {
    const name = (await candidate.innerText()).trim();
    const courseHref = (await candidate.getAttribute('href'))!;
    expect(courseHref).toMatch(/^\/admin\/courses\/\d+$/);
    expect(owned.originalCourses?.some(list => list.rows.some(row => row.href === courseHref))).not.toBe(true);
    if (course.href) expect(courseHref).toBe(course.href);
    // An exact name alone is insufficient: match unique code and parent association too.
    await expect(page.getByRole('row').filter({ has: page.getByRole('link', { name, exact: true }) }).getByRole('cell', {
      name: course.code, exact: true,
    })).toBeVisible();
    await candidate.click();
    await expect(page).toHaveURL(new RegExp(`${courseHref}$`));
    await expect(page.getByText(name, { exact: true })).toBeVisible();
    await expect(page.getByText(course.code, { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: owned.names[0], exact: true })).toHaveAttribute('href', owned.href);
    course.href = courseHref;
    const button = page.locator(`form[action="${course.href}/delete"]`)
      .getByRole('button', { name: 'HC 삭제', exact: true });
    await expect(button).toBeEnabled();
    const onDialog = async (dialog: import('@playwright/test').Dialog) => {
      if (dialog.type() === 'confirm' && dialog.message() === '정말 이 HC를 삭제하시겠습니까?') await dialog.accept();
      else await dialog.dismiss();
    };
    page.on('dialog', onDialog);
    try {
      await button.click();
      await expect(page).toHaveURL(new RegExp(`/admin/courses\\?siteId=${owned.href.split('/').pop()}$`));
    } finally { page.off('dialog', onDialog); }
  }
  await openCourseList(page, owned);
  for (const name of course.names) await expect(table.getByRole('link', { name, exact: true })).toHaveCount(0);
  await expect(table.getByRole('cell', { name: course.code, exact: true })).toHaveCount(0);
  if (course.href) await expect(page.locator(`a[href="${course.href}"]`)).toHaveCount(0);
  // Do not remove the Site if any unexpected child remains.
  await expect(table.getByRole('link')).toHaveCount(0);
  await assertOriginalCourses(page, owned);
}

async function createOwnedCourse(page: Page, owned: OwnedSite, testInfo: TestInfo) {
  const suffix = `${Date.now()}-${randomUUID()}`;
  owned.course = {
    names: [`[QA] Course ${suffix}`, `[QA] Course ${suffix} 수정`],
    code: `QA-HC-${suffix}`, attempted: false,
  };
  const course = owned.course;
  testInfo.annotations.push({ type: 'qa-course', description: `${course.code}: ${course.names.join(' → ')}` });
  await createOwnedSite(page, owned);

  // Read-only baseline across all pre-existing Sites; no mutations are allowed for these IDs.
  owned.originalCourses = [];
  for (const site of owned.baseline) {
    await page.goto(site.href);
    const link = page.getByRole('link', { name: 'HC 관리', exact: true });
    const list = (await link.getAttribute('href'))!;
    await link.click();
    await expect(page.getByRole('heading', { name: 'HC 목록', exact: true })).toBeVisible();
    const rows = await page.getByRole('table').getByRole('row').filter({ has: page.getByRole('link') })
      .evaluateAll(rows => rows.map(row => ({ href: row.querySelector('a')!.getAttribute('href')!, text: row.textContent! })));
    owned.originalCourses.push({ list, rows });
  }

  await page.goto(owned.href!);
  await expect(page.getByText(owned.names[0], { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'HC 관리', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'HC 목록', exact: true })).toBeVisible();
  await expect(page.getByRole('table').getByRole('link')).toHaveCount(0);
  await page.getByRole('link', { name: 'HC 등록', exact: true }).click();
  const siteId = owned.href!.split('/').pop()!;
  await expect(page.getByLabel('사이트', { exact: true })).toHaveValue(siteId);
  await expect(page.getByLabel('사이트', { exact: true }).locator('option:checked')).toHaveText(owned.names[0]);
  await page.getByLabel('HC 코드', { exact: true }).fill(course.code);
  await page.getByLabel('코스명', { exact: true }).fill(course.names[0]);
  // Radius and map center are optional in the inspected UI; leave them untouched.
  course.attempted = true;
  await page.getByRole('button', { name: 'HC 등록', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/courses(?:\/\d+|\?siteId=\d+)$/);
  await openCourseList(page, owned);
  const created = page.getByRole('table').getByRole('link', { name: course.names[0], exact: true });
  await expect(created).toHaveCount(1);
  course.href = (await created.getAttribute('href'))!;
  expect(course.href).toMatch(/^\/admin\/courses\/\d+$/);
  expect(owned.originalCourses.some(list => list.rows.some(row => row.href === course.href))).toBe(false);
  await created.click();
  await expect(page.getByText(course.code, { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: owned.names[0], exact: true })).toHaveAttribute('href', owned.href!);
}

test('QA Site 내부 HC 등록 → 수정 → 재진입 → HC·Site 삭제 @crud', async ({ page, owned }, testInfo) => {
  test.setTimeout(120_000);
  await createOwnedCourse(page, owned, testInfo);
  const course = owned.course!;
  const siteId = owned.href!.split('/').pop()!;
  await page.getByRole('link', { name: 'HC 수정', exact: true }).click();
  await expect(page.getByLabel('사이트', { exact: true })).toHaveValue(siteId);
  await expect(page.getByLabel('HC 코드', { exact: true })).toHaveValue(course.code);
  await expect(page.getByLabel('코스명', { exact: true })).toHaveValue(course.names[0]);
  await page.getByLabel('코스명', { exact: true }).fill(course.names[1]);
  await page.getByRole('button', { name: 'HC 수정', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/courses\\?siteId=${siteId}$`));
  await expect(page.getByText(course.names[1], { exact: true })).toBeVisible();

  await openCourseList(page, owned);
  await expect(page.getByRole('link', { name: course.names[0], exact: true })).toHaveCount(0);
  await page.getByRole('table').getByRole('link', { name: course.names[1], exact: true }).click();
  await page.getByRole('link', { name: 'HC 수정', exact: true }).click();
  await expect(page.getByLabel('코스명', { exact: true })).toHaveValue(course.names[1]);
  await expect(page.getByLabel('HC 코드', { exact: true })).toHaveValue(course.code);
  await expect(page.getByLabel('사이트', { exact: true })).toHaveValue(siteId);
  await deleteOwnedCourse(page, owned);
  // Parent cleanup is deliberately last, in the fixture; it rechecks child absence first.
});

async function openSpotList(page: Page, owned: OwnedSite) {
  const course = owned.course!;
  expect(course.href, 'HS는 이번 실행이 생성한 HC 내부에서만 조작').toBeTruthy();
  await page.goto(course.href!);
  await expect(page.getByText(course.code, { exact: true })).toBeVisible();
  await expect(page.getByText(course.names[0], { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: owned.names[0], exact: true })).toHaveAttribute('href', owned.href!);
  await page.getByRole('link', { name: 'HS 관리', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'HS 목록', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'HC 상세로', exact: true })).toHaveAttribute('href', course.href!);
  expect(new URL(page.url()).searchParams.get('courseId')).toBe(course.href!.split('/').pop());
}

async function assertOriginalSpots(page: Page, owned: OwnedSite) {
  for (const original of owned.originalSpots ?? []) {
    await page.goto(original.list);
    await expect(page.getByRole('heading', { name: 'HS 목록', exact: true })).toBeVisible();
    await expect(page.getByRole('table').getByRole('link')).toHaveCount(original.rows.length);
    for (const row of original.rows) {
      const match = page.getByRole('row').filter({ has: page.locator(`a[href="${row.href}"]`) });
      await expect(match).toHaveCount(1);
      await expect(match).toHaveText(row.text);
    }
  }
}

async function deleteOwnedSpot(page: Page, owned: OwnedSite) {
  const spot = owned.spot!;
  const course = owned.course!;
  await openSpotList(page, owned);
  const table = page.getByRole('table');
  const candidate = table.getByRole('link', { name: spot.names[0], exact: true })
    .or(table.getByRole('link', { name: spot.names[1], exact: true }));
  const count = await candidate.count();
  expect(count, '이번 실행의 HS는 최대 하나여야 함').toBeLessThanOrEqual(1);
  if (count === 1) {
    const name = (await candidate.innerText()).trim();
    const href = (await candidate.getAttribute('href'))!;
    expect(href).toMatch(/^\/admin\/spots\/\d+$/);
    expect(owned.originalSpots?.some(list => list.rows.some(row => row.href === href))).not.toBe(true);
    if (spot.href) expect(href).toBe(spot.href);
    await expect(page.getByRole('row').filter({ has: page.getByRole('link', { name, exact: true }) })
      .getByRole('cell', { name: spot.code, exact: true })).toBeVisible();
    await candidate.click();
    await expect(page).toHaveURL(new RegExp(`${href}$`));
    await expect(page.getByText(name, { exact: true })).toBeVisible();
    await expect(page.getByText(spot.code, { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: `${course.code} ${course.names[0]}`, exact: true }))
      .toHaveAttribute('href', course.href!);
    await expect(page.getByRole('link', { name: owned.names[0], exact: true })).toHaveAttribute('href', owned.href!);
    spot.href = href;
    const button = page.locator(`form[action="${href}/delete"]`).getByRole('button', { name: 'HS 삭제', exact: true });
    await expect(button).toBeEnabled();
    const onDialog = async (dialog: import('@playwright/test').Dialog) => {
      if (dialog.type() === 'confirm' && dialog.message() === '정말 이 HS를 삭제하시겠습니까?') await dialog.accept();
      else await dialog.dismiss();
    };
    page.on('dialog', onDialog);
    try {
      await button.click();
      await expect(page).toHaveURL(url => url.pathname === '/admin/spots'
        && url.searchParams.get('courseId') === course.href!.split('/').pop());
    } finally { page.off('dialog', onDialog); }
  }
  // Fresh HC detail + HS list also prove that deleting the HS did not delete its parent.
  await openSpotList(page, owned);
  for (const name of spot.names) await expect(table.getByRole('link', { name, exact: true })).toHaveCount(0);
  await expect(table.getByRole('cell', { name: spot.code, exact: true })).toHaveCount(0);
  if (spot.href) await expect(page.locator(`a[href="${spot.href}"]`)).toHaveCount(0);
  await expect(table.getByRole('link')).toHaveCount(0);
  await assertOriginalSpots(page, owned);
}

async function createOwnedSpot(page: Page, owned: OwnedSite, testInfo: TestInfo) {
  await createOwnedCourse(page, owned, testInfo);
  const course = owned.course!;
  const courseId = course.href!.split('/').pop()!;
  const suffix = `${Date.now()}-${randomUUID()}`;
  owned.spot = {
    names: [`[QA] Spot ${suffix}`, `[QA] Spot ${suffix} 수정`],
    code: `QA-HS-${suffix}`, attempted: false,
  };
  const spot = owned.spot;
  testInfo.annotations.push({ type: 'qa-spot', description: `${spot.code}: ${spot.names.join(' → ')}` });

  owned.originalSpots = [];
  for (const original of owned.originalCourses ?? []) {
    for (const row of original.rows) {
      await page.goto(row.href);
      const link = page.getByRole('link', { name: 'HS 관리', exact: true });
      const list = (await link.getAttribute('href'))!;
      await link.click();
      await expect(page.getByRole('heading', { name: 'HS 목록', exact: true })).toBeVisible();
      const rows = await page.getByRole('table').getByRole('row').filter({ has: page.getByRole('link') })
        .evaluateAll(rows => rows.map(row => ({ href: row.querySelector('a')!.getAttribute('href')!, text: row.textContent! })));
      owned.originalSpots.push({ list, rows });
    }
  }

  await openSpotList(page, owned);
  await expect(page.getByRole('table').getByRole('link')).toHaveCount(0);
  await page.getByRole('link', { name: 'HS 등록', exact: true }).click();
  await expect(page.getByLabel('소속 코스', { exact: true })).toHaveValue(courseId);
  await expect(page.getByLabel('소속 코스', { exact: true }).locator('option:checked'))
    .toHaveText(`${owned.names[0]} / ${course.code} ${course.names[0]}`);
  await page.getByLabel('HS 코드', { exact: true }).fill(spot.code);
  await page.getByLabel('스팟명', { exact: true }).fill(spot.names[0]);
  // Server validation requires coordinates, exposed only through this registration map.
  // This sets geographic fields, not the separate Spatial Layout/image placement.
  const map = page.getByLabel('HealingSpot 위치 설정', { exact: true });
  await expect(map.getByRole('img', { name: 'Kakao 맵으로 이동(새창열림)', exact: true })).toBeVisible();
  await map.click();
  await expect(page.locator('#latitude')).toHaveValue(/^-?\d+(?:\.\d+)?$/);
  await expect(page.locator('#longitude')).toHaveValue(/^-?\d+(?:\.\d+)?$/);
  const latitude = await page.locator('#latitude').inputValue();
  const longitude = await page.locator('#longitude').inputValue();
  spot.attempted = true;
  await page.getByRole('button', { name: 'HS 등록', exact: true }).click();
  await expect(page).toHaveURL(url => /^\/admin\/spots\/\d+$/.test(url.pathname)
    || (url.pathname === '/admin/spots' && url.searchParams.get('courseId') === courseId));
  await openSpotList(page, owned);
  const created = page.getByRole('table').getByRole('link', { name: spot.names[0], exact: true });
  await expect(created).toHaveCount(1);
  spot.href = (await created.getAttribute('href'))!;
  expect(spot.href).toMatch(/^\/admin\/spots\/\d+$/);
  expect(owned.originalSpots.some(list => list.rows.some(row => row.href === spot.href))).toBe(false);
  await created.click();
  await expect(page.getByText(spot.code, { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: `${course.code} ${course.names[0]}`, exact: true }))
    .toHaveAttribute('href', course.href!);
  return { latitude, longitude };
}

test('QA Site·HC 내부 HS 등록 → 수정 → 재진입 → HS·HC·Site 삭제 @crud', async ({ page, owned }, testInfo) => {
  test.setTimeout(120_000);
  const { latitude, longitude } = await createOwnedSpot(page, owned, testInfo);
  const spot = owned.spot!;
  const courseId = owned.course!.href!.split('/').pop()!;
  await page.getByRole('link', { name: 'HS 수정', exact: true }).click();
  await expect(page.getByLabel('소속 코스', { exact: true })).toHaveValue(courseId);
  await expect(page.getByLabel('HS 코드', { exact: true })).toHaveValue(spot.code);
  await expect(page.getByLabel('스팟명', { exact: true })).toHaveValue(spot.names[0]);
  await page.getByLabel('스팟명', { exact: true }).fill(spot.names[1]);
  await page.getByRole('button', { name: 'HS 수정', exact: true }).click();
  await expect(page).toHaveURL(url => url.pathname === spot.href
    || (url.pathname === '/admin/spots' && url.searchParams.get('courseId') === courseId));
  await expect(page.getByText(spot.names[1], { exact: true })).toBeVisible();

  await openSpotList(page, owned);
  await expect(page.getByRole('link', { name: spot.names[0], exact: true })).toHaveCount(0);
  await page.getByRole('table').getByRole('link', { name: spot.names[1], exact: true }).click();
  await page.getByRole('link', { name: 'HS 수정', exact: true }).click();
  await expect(page.getByLabel('스팟명', { exact: true })).toHaveValue(spot.names[1]);
  await expect(page.getByLabel('HS 코드', { exact: true })).toHaveValue(spot.code);
  await expect(page.getByLabel('소속 코스', { exact: true })).toHaveValue(courseId);
  await expect(page.locator('#latitude')).toHaveValue(latitude);
  await expect(page.locator('#longitude')).toHaveValue(longitude);
  await deleteOwnedSpot(page, owned);
  // Fixture confirms HS absence again before deleting HC, then Site.
});

test('QA HS 이미지 업로드 → 대표·순서 → 재진입 → 삭제 @crud', async ({ page, owned }, testInfo) => {
  test.setTimeout(150_000);
  await createOwnedSpot(page, owned, testInfo);
  await openImageEditor(page, owned);
  await expect(page.locator('[data-image-editor]').getByRole('article')).toHaveCount(0);
  owned.images = { keys: [], sources: [], attempted: false };
  await runImageScenario(page, owned, testInfo);
});
