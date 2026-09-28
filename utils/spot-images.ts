import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, Page, TestInfo } from '@playwright/test';
import { expectLoadedImage } from './monitoring';

const fixtures = ['qa-red.png', 'qa-green.png', 'qa-blue.png'].map(name => {
  const filePath = path.resolve(__dirname, '../fixtures/images', name);
  return { name, path: filePath, bytes: readFileSync(filePath) };
});
export type ImageRun = { keys: string[]; sources: string[]; attempted: boolean };
type Owner = {
  names: [string, string]; href?: string;
  course?: { names: [string, string]; code: string; href?: string };
  spot?: { names: [string, string]; code: string; href?: string };
  images?: ImageRun;
};

export async function imagePayloadAllowed(form: FormData, run: ImageRun | undefined, isOwnedEdit: boolean) {
  const files = form.getAll('files');
  if (!run || !isOwnedEdit) return files.every(file => typeof file !== 'string' && file.size === 0);
  if (String(form.get('imageSpatial') ?? '') !== '') return false;
  for (const file of files) {
    if (typeof file === 'string') return false;
    if (!file.size) continue;
    const fixture = fixtures.find(item => item.name === file.name);
    if (!run.attempted || !fixture || file.type !== 'image/png') return false;
    if (!Buffer.from(await file.arrayBuffer()).equals(fixture.bytes)) return false;
  }
  const allowedKeys = new Set([...run.keys, ...files.map((_, index) => `n:${index}`)]);
  return ['imageOrder', 'imageDeleted', 'imageRepresentative'].every(field =>
    String(form.get(field) ?? '').split(',').filter(Boolean).every(key => allowedKeys.has(key)));
}

export async function openImageEditor(page: Page, owned: Owner) {
  const spot = owned.spot!;
  expect(spot.href).toMatch(/^\/admin\/spots\/\d+$/);
  await page.goto(spot.href!);
  await expect(page.getByText(spot.code, { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: owned.names[0], exact: true })).toHaveAttribute('href', owned.href!);
  await expect(page.getByRole('link', { name: `${owned.course!.code} ${owned.course!.names[0]}`, exact: true }))
    .toHaveAttribute('href', owned.course!.href!);
  await page.getByRole('link', { name: 'HS 수정', exact: true }).click();
  await expect(page.getByLabel('소속 코스', { exact: true })).toHaveValue(owned.course!.href!.split('/').pop()!);
  await expect(page.getByLabel('HS 코드', { exact: true })).toHaveValue(spot.code);
  expect(spot.names).toContain(await page.getByLabel('스팟명', { exact: true }).inputValue());
  await expect(page.locator('[data-image-editor]')).toHaveAttribute('data-unavailable', 'false');
  // This alert is inserted by admin-image-form.js when upload listeners are installed.
  await expect(page.locator('#image-files + [role="alert"]')).toHaveCount(1);
}

const cards = (page: Page) => page.locator('[data-image-editor]').getByRole('article');
const card = (page: Page, name: string) => cards(page).filter({ has: page.getByRole('img', { name, exact: true }) });

async function saveAndReopen(page: Page, owned: Owner) {
  const response = page.waitForResponse(res => res.request().method() === 'POST'
    && new URL(res.url()).pathname === `${owned.spot!.href}/edit`);
  await page.getByRole('button', { name: 'HS 수정', exact: true }).click();
  expect((await response).status()).toBe(302);
  await expect(page).toHaveURL(url => url.pathname === owned.spot!.href || url.pathname === '/admin/spots');
  await openImageEditor(page, owned);
}

async function rememberImages(page: Page, owned: Owner) {
  const run = owned.images!;
  // Recovery also uses the exact uploaded filename and bytes, not merely the QA prefix.
  for (const item of await cards(page).all()) {
    const image = item.getByRole('img');
    const name = await image.getAttribute('alt');
    const fixture = fixtures.find(file => file.name === name);
    expect(fixture, `Unknown image in owned HS: ${name}`).toBeTruthy();
    const key = (await item.getAttribute('data-key'))!;
    expect(key).toMatch(/^e:\d+$/);
    const source = (await image.getAttribute('src'))!;
    expect(source).toBe(`${owned.spot!.href}/images/${key.slice(2)}/content`);
    const response = await page.request.get(source);
    expect(response.status()).toBe(200);
    expect(createHash('sha256').update(await response.body()).digest('hex'))
      .toBe(createHash('sha256').update(fixture!.bytes).digest('hex'));
    if (!run.keys.includes(key)) run.keys.push(key);
    if (!run.sources.includes(source)) run.sources.push(source);
    await expectLoadedImage(image);
  }
}

async function expectOrder(page: Page, names: string[], representative?: string) {
  await expect(cards(page)).toHaveCount(names.length);
  for (const [index, name] of names.entries()) {
    await expect(cards(page).nth(index).getByRole('img')).toHaveAttribute('alt', name);
    await expect(card(page, name)).toContainText(`순서 ${index + 1}`);
    await expectLoadedImage(card(page, name).getByRole('img'));
  }
  await expect(page.locator('[data-image-editor] .image-representative')).toHaveCount(representative ? 1 : 0);
  if (representative) {
    await expect(card(page, representative).getByText('대표', { exact: true })).toBeVisible();
    await expect(card(page, representative).getByRole('button', { name: '대표 이미지로 설정', exact: true })).toBeDisabled();
  }
}

export async function cleanupImages(page: Page, owned: Owner) {
  if (!owned.images?.attempted) return;
  await openImageEditor(page, owned);
  await rememberImages(page, owned);
  // Every current card has just passed owner + filename + bytes checks.
  while (await cards(page).count()) await cards(page).first().getByRole('button', { name: '삭제', exact: true }).click();
  await saveAndReopen(page, owned);
  await expectOrder(page, []);
  await expect(page.locator('[data-image-empty]')).toBeVisible();
  for (const source of owned.images.sources) {
    const response = await page.request.get(source, { maxRedirects: 0 });
    expect([404, 410], `Deleted image content: ${source}`).toContain(response.status());
  }
}

export async function runImageScenario(page: Page, owned: Owner, testInfo: TestInfo) {
  const run = owned.images!;
  const [red, green, blue] = fixtures.map(file => file.name);
  run.attempted = true;
  await page.getByLabel('새 이미지 추가', { exact: true }).setInputFiles(fixtures.map(file => file.path));
  await expectOrder(page, [red, green, blue], red);
  await saveAndReopen(page, owned);
  await rememberImages(page, owned);
  await expectOrder(page, [red, green, blue], red);

  await card(page, blue).getByRole('button', { name: '대표 이미지로 설정', exact: true }).click();
  await expectOrder(page, [red, green, blue], blue);
  await saveAndReopen(page, owned);
  await expectOrder(page, [red, green, blue], blue);

  await page.goto('/admin/monitoring');
  const siteId = owned.href!.split('/').pop()!;
  const layoutResponse = page.waitForResponse(response =>
    new URL(response.url()).pathname === `${owned.href}/spatial-layout/data`
      && response.request().method() === 'GET');
  await page.locator('#siteSelect').selectOption(siteId);
  const response = await layoutResponse;
  expect(response.ok()).toBe(true);
  const layout = await response.json();
  expect(String(layout.siteId)).toBe(siteId);
  expect(layout.image).toBeNull();
  await expect(page.locator('#monitoringStatus')).toHaveText('모니터링 이미지가 아직 설정되지 않았습니다.');
  await expect(page.locator('#monitoringCanvas')).toBeHidden();
  await expect(page.locator('#monitoringCanvas').getByRole('button', { name: / 상세 보기$/ })).toHaveCount(0);
  testInfo.annotations.push({ type: 'monitoring', description: 'QA Site has no monitoring image or saved HS placement; representative persistence checked in editor, canvas rendering requires those preconditions.' });
  await openImageEditor(page, owned);
  await expectOrder(page, [red, green, blue], blue);

  await card(page, green).getByRole('button', { name: '위로 이동', exact: true }).click();
  await expectOrder(page, [green, red, blue], blue);
  await saveAndReopen(page, owned);
  await expectOrder(page, [green, red, blue], blue);

  await card(page, red).getByRole('button', { name: '삭제', exact: true }).click();
  await saveAndReopen(page, owned);
  await expectOrder(page, [green, blue], blue);
  // Observed ImageDraft.normalize chooses the first remaining image after representative removal.
  await card(page, blue).getByRole('button', { name: '삭제', exact: true }).click();
  await expectOrder(page, [green], green);
  await saveAndReopen(page, owned);
  await expectOrder(page, [green], green);
  testInfo.annotations.push({ type: 'qa-images', description: `Uploaded ${run.keys.join(', ')}; representative deletion falls back to first remaining image` });
  await cleanupImages(page, owned);
}
