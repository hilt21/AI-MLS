import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

test('restored cloud fixture retains image/history, permits review and keeps ownership isolation', async ({ browser, baseURL }, testInfo) => {
  const id = '33333333-3333-4333-8333-333333333333';
  const context = await browser.newContext({ ...testInfo.project.use, baseURL, extraHTTPHeaders: { 'x-e2e-user': 'm3-synthetic-owner' } });
  try {
    const progressResponse = await context.request.get('/api/progress');
    expect(progressResponse.status()).toBe(200);
    const before = await progressResponse.json();
    expect(before.confirmedCount).toBe(1);
    expect(before.reviewCount).toBeGreaterThanOrEqual(1);
    expect(before.independentCount).toBeGreaterThanOrEqual(1);
    const image = await context.request.get(`/api/questions/${id}/image`);
    expect(image.status()).toBe(200);
    expect(createHash('sha256').update(await image.body()).digest('hex')).toBe('072911b8f7dbb8cd41787fd281ab60e3fdc6b139efa6625ab1d968e9d6931960');
    const page = await context.newPage();
    await page.goto('/');
    await page.getByRole('button', { name: /错题库/ }).click();
    await expect(page.getByRole('heading', { name: '[M3] 合成恢复演练', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '查看 / 编辑', exact: true }).click();
    await expect.poll(() => page.getByAltText('原始错题照片').evaluate(el => el.complete && el.naturalWidth > 0)).toBeTruthy();
    await page.screenshot({ path: testInfo.outputPath('restored-image.png'), fullPage: true });
    await page.getByRole('button', { name: /今日复习/ }).click();
    await expect(page.getByRole('heading', { name: '[M3] 合成恢复演练', exact: true })).toBeVisible();
    await page.getByLabel('我的答案', { exact: true }).fill('3');
    await page.getByRole('button', { name: '查看解析与反馈 →' }).click();
    await page.getByRole('button', { name: '自己做对了', exact: true }).click();
    const response = page.waitForResponse(r => r.url().endsWith('/api/reviews/submit'));
    await page.getByRole('button', { name: '记录复习并安排下次 →' }).click();
    expect((await response).status()).toBe(200);
    await page.reload();
    expect(await (await context.request.get('/api/progress')).json()).toMatchObject({ confirmedCount: 1, reviewCount: before.reviewCount + 1, independentCount: before.independentCount + 1 });
    const other = await browser.newContext({ baseURL, extraHTTPHeaders: { 'x-e2e-user': 'm3-other-owner' } });
    try {
      expect((await other.request.get(`/api/questions/${id}/image`)).status()).toBe(404);
      expect((await (await other.request.get('/api/questions')).json()).questions).toHaveLength(0);
    } finally { await other.close(); }
    await page.getByRole('button', { name: /学习进度/ }).click();
    await page.screenshot({ path: testInfo.outputPath('restored-progress.png'), fullPage: true });
    await writeFile(testInfo.outputPath('readiness.json'), JSON.stringify({ applicationReadyAt: new Date().toISOString(), environment: 'private deployed Cloudflare application + restored D1/R2, reached through localhost operator gateway with synthetic identity; production Access excluded', restoredHistoryAndImage: true, reviewAfterRestore: true, ownershipIsolation: true }));
  } finally { await context.close(); }
});
