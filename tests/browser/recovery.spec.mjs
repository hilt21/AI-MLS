import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
const photo = readFileSync(new URL('./synthetic.png', import.meta.url));
async function seed(context, baseURL, title) {
  const upload = await context.request.post('/api/upload', { headers: { origin: baseURL }, multipart: { photo: { name: 'synthetic.png', mimeType: 'image/png', buffer: photo } } });
  expect(upload.status()).toBe(200);
  const { id } = await upload.json();
  const question = (await (await context.request.get('/api/questions')).json()).questions.find(q => q.id === id);
  expect((await context.request.patch(`/api/questions/${id}`, { headers: { origin: baseURL }, data: { ...question, title, expectedVersion: question.version } })).status()).toBe(200);
  return id;
}
async function feedback(page, answer = '3') {
  await page.locator('.practice textarea').fill(answer);
  await page.getByRole('button', { name: '查看解析与反馈 →' }).click();
  await page.getByRole('button', { name: '自己做对了', exact: true }).click();
}
for (const change of ['delete', 'edit']) test(`sync after another page ${change}s question clears answer and feedback`, async ({ browser, baseURL }, info) => {
  const context = await browser.newContext({ ...info.project.use, baseURL, extraHTTPHeaders: { 'x-e2e-user': `reset-${change}-${info.project.name}` } });
  try {
    await seed(context, baseURL, '题目 A'); await seed(context, baseURL, '题目 B');
    const first = (await (await context.request.get('/api/reviews')).json()).reviews[0];
    const page = await context.newPage(); await page.goto('/');
    await expect(page.getByRole('heading', { name: first.question.title, exact: true })).toBeVisible();
    await feedback(page, '旧题答案');
    if (change === 'delete') await context.request.delete(`/api/questions/${first.question_id}`, { headers: { origin: baseURL } });
    else expect((await context.request.patch(`/api/questions/${first.question_id}`, { headers: { origin: baseURL }, data: { ...first.question, title: '修改后的题目', expectedVersion: first.version } })).status()).toBe(200);
    await page.getByRole('button', { name: '↻ 同步', exact: true }).click();
    await expect(page.locator('.practice textarea')).toHaveValue('');
    await expect(page.locator('.practice textarea')).toBeEnabled();
    await expect(page.getByRole('button', { name: '查看解析与反馈 →' })).toBeVisible();
    await expect(page.getByRole('button', { name: '自己做对了', exact: true })).toHaveCount(0);
  } finally { await context.close(); }
});
for (const failure of ['html', '401', '403', 'shape', 'invalid-json']) test(`refresh ${failure} preserves draft and recovers without false completion`, async ({ browser, baseURL }, info) => {
  const context = await browser.newContext({ ...info.project.use, baseURL, extraHTTPHeaders: { 'x-e2e-user': `failure-${failure}-${info.project.name}` } });
  try {
    await seed(context, baseURL, '保留作答');
    const page = await context.newPage(); await page.goto('/');
    await expect(page.getByRole('heading', { name: '保留作答', exact: true })).toBeVisible();
    await page.locator('.practice textarea').fill('未提交内容');
    await page.route('**/api/reviews', route => route.fulfill({ status: failure === '401' ? 401 : failure === '403' ? 403 : 200, contentType: failure === 'html' ? 'text/html' : 'application/json', body: failure === 'html' ? '<html>login</html>' : failure === 'invalid-json' ? '{broken' : JSON.stringify(failure === 'shape' ? {} : { error: 'session expired' }) }));
    await page.getByRole('button', { name: '↻ 同步', exact: true }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.locator('.practice textarea')).toHaveValue('未提交内容');
    if (['html', '401', '403'].includes(failure)) await expect(page.getByRole('link', { name: /重新登录/ })).toHaveAttribute('target', '_blank');
    await page.unroute('**/api/reviews');
    await page.getByRole('button', { name: '↻ 同步', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.locator('.practice textarea')).toHaveValue('未提交内容');
  } finally { await context.close(); }
});
test('saved review with failed refresh retries synchronization without another submission', async ({ browser, baseURL }, info) => {
  const context = await browser.newContext({ ...info.project.use, baseURL, extraHTTPHeaders: { 'x-e2e-user': `saved-${info.project.name}` } });
  try {
    await seed(context, baseURL, '提交后同步失败'); const page = await context.newPage(); await page.goto('/');
    await expect(page.getByRole('heading', { name: '提交后同步失败', exact: true })).toBeVisible(); await feedback(page);
    let posts = 0; page.on('request', r => { if (r.url().endsWith('/api/reviews/submit')) posts++; });
    await page.route('**/api/reviews', r => r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: '同步暂不可用' }) }));
    await page.getByRole('button', { name: '记录复习并安排下次 →' }).click();
    await expect(page.getByRole('button', { name: '已记录，重新同步 →' })).toBeVisible();
    await expect(page.locator('.practice textarea')).toHaveValue('3');
    await page.unroute('**/api/reviews'); await page.getByRole('button', { name: '已记录，重新同步 →' }).click();
    await expect(page.locator('.practice')).toHaveCount(0);
    expect(posts).toBe(1); expect((await (await context.request.get('/api/progress')).json()).reviewCount).toBe(1);
  } finally { await context.close(); }
});
test('lost submission response can retry the same submission without duplicate review', async ({ browser, baseURL }, info) => {
  const context = await browser.newContext({ ...info.project.use, baseURL, extraHTTPHeaders: { 'x-e2e-user': `lost-${info.project.name}` } });
  try {
    await seed(context, baseURL, '响应丢失'); const page = await context.newPage(); await page.goto('/');
    await expect(page.getByRole('heading', { name: '响应丢失', exact: true })).toBeVisible(); await feedback(page);
    const ids = []; await page.route('**/api/reviews/submit', async route => { ids.push(route.request().postDataJSON().submissionId); await route.fetch(); await route.abort(); });
    await page.getByRole('button', { name: '记录复习并安排下次 →' }).click();
    await expect(page.locator('.practice .alert')).toBeVisible(); await expect(page.locator('.practice textarea')).toHaveValue('3');
    await page.unroute('**/api/reviews/submit'); page.on('request', r => { if (r.url().endsWith('/api/reviews/submit')) ids.push(r.postDataJSON().submissionId); });
    await page.getByRole('button', { name: '记录复习并安排下次 →' }).click();
    await expect(page.locator('.practice')).toHaveCount(0);
    expect(ids).toHaveLength(2); expect(ids[0]).toBe(ids[1]); expect((await (await context.request.get('/api/progress')).json()).reviewCount).toBe(1);
  } finally { await context.close(); }
});

test('saved edit with failed refresh retries sync without another PATCH', async ({ browser, baseURL }, info) => {
  const context = await browser.newContext({ ...info.project.use, baseURL, extraHTTPHeaders: { 'x-e2e-user': `edit-saved-${info.project.name}` } });
  try {
    await seed(context, baseURL, '原题目'); const page = await context.newPage(); await page.goto('/');
    await page.getByRole('button', { name: /错题库/ }).click();
    await page.getByRole('button', { name: '查看 / 编辑', exact: true }).click();
    await page.getByLabel('标题', { exact: true }).fill('已保存题目');
    let patches = 0; page.on('request', r => { if (r.method() === 'PATCH') patches++; });
    await page.route('**/api/reviews', r => r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: '同步暂不可用' }) }));
    await page.getByRole('button', { name: '确认并加入复习 →' }).click();
    await expect(page.getByRole('button', { name: '已保存，重新同步 →' })).toBeVisible();
    await expect(page.getByLabel('标题', { exact: true })).toHaveValue('已保存题目');
    await page.unroute('**/api/reviews'); await page.getByRole('button', { name: '已保存，重新同步 →' }).click();
    await expect(page.getByRole('heading', { name: '已保存题目', exact: true })).toBeVisible();
    expect(patches).toBe(1);
  } finally { await context.close(); }
});

test('failed initial load never reports no due questions and can retry', async ({ browser, baseURL }, info) => {
  const context = await browser.newContext({ ...info.project.use, baseURL, extraHTTPHeaders: { 'x-e2e-user': `initial-${info.project.name}` } });
  try {
    await seed(context, baseURL, '初次同步恢复'); const page = await context.newPage();
    await page.route('**/api/reviews', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
    await page.goto('/'); await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByText('当前没有到期的错题', { exact: true })).toHaveCount(0);
    await page.unroute('**/api/reviews'); await page.getByRole('button', { name: '↻ 同步', exact: true }).click();
    await expect(page.getByRole('heading', { name: '初次同步恢复', exact: true })).toBeVisible();
  } finally { await context.close(); }
});
