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
    await page.getByLabel('从相册选择', { exact: true }).setInputFiles({ name: 'synthetic.png', mimeType: 'image/png', buffer: photo });
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

test('camera/library choices and crop export preserve selected pixels; cancel and upload failure retain photo', async ({ browser, baseURL }, info) => {
  const context = await browser.newContext({ ...info.project.use, baseURL, extraHTTPHeaders: { 'x-e2e-user': `crop-${info.project.name}` } });
  try {
    const page = await context.newPage(); await page.goto('/');
    await page.getByRole('button', { name: /拍照录入/ }).first().click();
    const library = page.getByLabel('从相册选择', { exact: true });
    const camera = page.getByLabel('拍照', { exact: true });
    await expect(library).not.toHaveAttribute('capture');
    await expect(camera).toHaveAttribute('capture', 'environment');
    const data = await page.evaluate(() => {
      const c = document.createElement('canvas'); c.width = 120; c.height = 80;
      const g = c.getContext('2d'); g.fillStyle = 'red'; g.fillRect(0,0,120,80);
      g.fillStyle = 'blue'; g.fillRect(30,20,60,40); return c.toDataURL('image/png').split(',')[1];
    });
    const input = { name: 'crop.png', mimeType: 'image/png', buffer: Buffer.from(data, 'base64') };
    await library.setInputFiles(input);
    await page.getByRole('button', { name: '裁剪图片', exact: true }).click();
    await expect(page.getByRole('button', { name: '提交图片识别 →' })).toBeDisabled();
    await page.getByRole('button', { name: '取消裁剪' }).click();
    await expect(page.getByAltText('待上传题目预览')).toBeVisible();
    await page.getByRole('button', { name: '裁剪图片', exact: true }).click();
    await expect(page.getByRole('button', { name: '应用裁剪' })).toBeEnabled();
    const surface = page.getByTestId('crop-surface'); const box = await surface.boundingBox();
    await page.mouse.move(box.x + box.width * .25, box.y + box.height * .25);
    await page.mouse.down(); await page.mouse.move(box.x + box.width * .75, box.y + box.height * .75); await page.mouse.up();
    for (const [label,value] of [['左边界',25],['右边界',75],['上边界',25],['下边界',75]]) expect(Number(await page.getByLabel(label, { exact: true }).inputValue())).toBeCloseTo(value,0);
    // Native range controls also allow keyboard/screen-reader crop adjustment.
    for (const [label,value] of [['左边界','25'],['右边界','75'],['上边界','25'],['下边界','75']]) await page.getByLabel(label, { exact: true }).fill(value);
    await page.getByRole('button', { name: '应用裁剪' }).click();
    const preview = page.getByAltText('待上传题目预览'); await expect(preview).toBeVisible();
    await expect.poll(() => preview.evaluate(el => [el.naturalWidth,el.naturalHeight])).toEqual([60,40]);
    const pixel = await preview.evaluate(el => { const c = document.createElement('canvas'); c.width=60;c.height=40;const g=c.getContext('2d');g.drawImage(el,0,0);return [...g.getImageData(30,20,1,1).data]; });
    expect(pixel[2]).toBeGreaterThan(200); expect(pixel[0]).toBeLessThan(30);
    await page.screenshot({path:`outputs/browser/crop-${info.project.name}.png`,fullPage:true});
    await page.route('**/api/upload', route => route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'暂时不可用'})}));
    await page.getByRole('button', { name: '提交图片识别 →' }).click();
    await expect(page.getByRole('status')).toContainText('暂时不可用');
    await expect(preview).toBeVisible(); await expect(page.getByRole('button', {name:'提交图片识别 →'})).toBeEnabled();
    await page.unroute('**/api/upload');
    const uploaded = page.waitForResponse(r => r.url().endsWith('/api/upload'));
    await page.getByRole('button', {name:'提交图片识别 →'}).click();
    const response = await uploaded; expect(response.status()).toBe(200); const {id} = await response.json();
    await page.goto(`/api/questions/${id}/image`);
    await expect.poll(() => page.locator('img').evaluate(el => [el.naturalWidth,el.naturalHeight])).toEqual([60,40]);
    await page.goto('/'); await page.getByRole('button', {name:/拍照录入/}).first().click();
    await camera.setInputFiles(input); await expect(page.getByAltText('待上传题目预览')).toBeVisible();
    await page.getByRole('button', {name:'裁剪图片',exact:true}).click();
    await page.getByLabel('左边界',{exact:true}).fill('20');
    await page.getByRole('button', {name:'重置裁剪'}).click();
    await expect(page.getByLabel('左边界',{exact:true})).toHaveValue('0');
    await page.getByRole('button', {name:'取消裁剪'}).click();
    await expect.poll(() => page.getByAltText('待上传题目预览').evaluate(el => [el.naturalWidth,el.naturalHeight])).toEqual([120,80]);
  } finally { await context.close(); }
});
