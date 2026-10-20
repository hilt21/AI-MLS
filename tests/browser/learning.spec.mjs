import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
const photo = readFileSync(new URL('./synthetic.png', import.meta.url));

test('upload → model failure → retry → correction → review → refresh → delete; ownership isolation', async ({ browser, baseURL }, testInfo) => {
  const user = `e2e-${testInfo.project.name}`;
  const context = await browser.newContext({ ...testInfo.project.use, baseURL, extraHTTPHeaders: { 'x-e2e-user': user } });
  const page = await context.newPage();
  let id;
  try {
    expect((await context.request.get('/api/questions')).ok()).toBeTruthy();
    await context.request.post('/__fixture/model-mode', { data: 'failed' });
    await page.goto('/');
    await page.getByRole('button', { name: /拍照录入/, exact: false }).first().click();
    await page.locator('input[type=file]').setInputFiles({ name: 'synthetic.png', mimeType: 'image/png', buffer: photo });
    const upload = page.waitForResponse(r => r.url().endsWith('/api/upload') && r.request().method() === 'POST', { timeout: 15_000 });
    await page.getByRole('button', { name: '提交图片识别 →' }).click();
    const response = await upload;
    expect(response.status()).toBe(200);
    const draft = await response.json(); id = draft.id;
    expect(draft.recognitionStatus).toBe('failed');
    await page.getByRole('button', { name: '打开错题库', exact: true }).click();
    await page.getByRole('button', { name: '检查并入库', exact: true }).click();
    await expect(page.getByRole('button', { name: '确认并加入复习 →' })).toBeDisabled();
    const image = page.getByAltText('原始错题照片');
    await expect.poll(() => image.evaluate(el => el.complete && el.naturalWidth > 0)).toBeTruthy();
    await context.request.post('/__fixture/model-mode', { data: 'ready' });
    await page.getByRole('button', { name: '重试识别原图', exact: true }).click();
    await expect(page.getByLabel('标题', { exact: true })).toHaveValue('[E2E] 合成方程');
    await page.getByLabel('标题', { exact: true }).fill('[E2E] 人工校对后的方程');
    await page.getByRole('button', { name: '确认并加入复习 →' }).click();
    await page.getByRole('button', { name: /今日复习/ }).click();
    await expect(page.getByRole('heading', { name: '[E2E] 人工校对后的方程' })).toBeVisible();
    await page.getByLabel('我的答案', { exact: true }).fill('3');
    await page.getByRole('button', { name: '查看解析与反馈 →' }).click();
    await page.getByRole('button', { name: '自己做对了', exact: true }).click();
    await page.getByLabel('做题时看过提示或解析').check();
    const submitted = page.waitForResponse(r => r.url().endsWith('/api/reviews/submit'));
    await page.getByRole('button', { name: '记录复习并安排下次 →' }).click();
    expect((await submitted).status()).toBe(200);
    await page.reload();
    const progress = await (await context.request.get('/api/progress')).json();
    expect(progress).toMatchObject({ confirmedCount: 1, reviewCount: 1, independentCount: 0, rateSource: 'self_report' });
    const questions = await (await context.request.get('/api/questions')).json();
    expect(questions.questions).toHaveLength(1);
    expect(questions.questions[0].title).toBe('[E2E] 人工校对后的方程');
    const other = await browser.newContext({ baseURL, extraHTTPHeaders: { 'x-e2e-user': `${user}-other` } });
    try {
      expect((await (await other.request.get('/api/questions')).json()).questions).toHaveLength(0);
      for (const method of ['get', 'patch', 'delete']) {
        const r = await other.request[method](`/api/questions/${id}`, { headers: { origin: baseURL }, data: method === 'patch' ? {} : undefined });
        expect(r.status()).toBe(404);
      }
      expect((await other.request.get(`/api/questions/${id}/image`)).status()).toBe(404);
    } finally { await other.close(); }
    await page.getByRole('button', { name: /学习进度/ }).click();
    await page.screenshot({ path: testInfo.outputPath('persisted-progress.png'), fullPage: true });
  } finally {
    if (id) {
      expect((await context.request.delete(`/api/questions/${id}`, { headers: { origin: baseURL } })).status()).toBe(200);
      expect((await context.request.get(`/api/questions/${id}/image`)).status()).toBe(404);
      expect((await (await context.request.get('/api/progress')).json()).reviewCount).toBe(0);
    }
    await context.close();
  }
});
