import { test as base, expect, type ConsoleMessage, type Page } from '@playwright/test';
export { expect };
export type { Locator, Page, TestInfo } from '@playwright/test';

export const test = base.extend<{ browserErrors: void }>({
  browserErrors: [async ({ context, baseURL }, use, testInfo) => {
    const errors: string[] = [];
    const ignored: string[] = [];
    const removers: (() => void)[] = [];
    const origin = new URL(baseURL!).origin;
    const watch = (page: Page) => {
      const onConsole = (message: ConsoleMessage) => {
        if (message.type() !== 'error') return; // SDK warnings are not JS errors.
        const source = message.location().url;
        const text = message.text();
        let resourceNoise = false;
        try {
          const url = new URL(source);
          resourceNoise = /^Failed to load resource:/.test(text)
            && (url.pathname === '/favicon.ico' || url.origin !== origin);
        } catch { /* Missing source is not grounds to suppress an application error. */ }
        (resourceNoise ? ignored : errors).push(`console.error ${source}: ${text}`);
      };
      const onError = (error: Error) => errors.push(`pageerror ${page.url()}: ${error.stack ?? error.message}`);
      page.on('console', onConsole);
      page.on('pageerror', onError);
      removers.push(() => { page.off('console', onConsole); page.off('pageerror', onError); });
    };
    context.on('page', watch);
    context.pages().forEach(watch);
    // Read-only tests may authenticate, but may never submit domain mutations.
    if (testInfo.project.name === 'readonly') {
      await context.route('**/*', async route => {
        const request = route.request();
        const url = new URL(request.url());
        if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())
          && !(request.method() === 'POST' && url.origin === origin && url.pathname === '/admin/login')) {
          errors.push(`Blocked read-only mutation: ${request.method()} ${url.origin}${url.pathname}`);
          return route.abort('blockedbyclient');
        }
        await route.continue();
      });
    }
    try { await use(); }
    finally {
      context.off('page', watch);
      removers.forEach(remove => remove());
      if (errors.length || ignored.length) {
        await testInfo.attach('browser-errors', {
          body: JSON.stringify({ errors, ignoredResourceNoise: ignored }, null, 2),
          contentType: 'application/json',
        });
      }
      // Keep the original assertion/cleanup failure when one already exists.
      if (testInfo.status === testInfo.expectedStatus) {
        expect(errors, '브라우저 JS 오류: HTML report의 browser-errors 첨부 확인').toEqual([]);
      }
    }
  }, { auto: true }],
});
