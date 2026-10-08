// 先从仓库根目录启动 HTTP 预览，再运行 node designs/baocut/tests/history.browser.mjs。
// 使用生产 Web 已安装的 Playwright；只操作隔离浏览器里的演示项目。
import {firefox} from '../../../apps/web/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
import {test} from 'node:test';

const url = process.env.BAOCUT_PROTOTYPE_URL || 'http://localhost:4311/baocut/BaoCut.html';
const setup = async run => {
  const browser = await firefox.launch({headless: true});
  try {
    const page = await browser.newPage({viewport: {width: 1440, height: 900}});
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => localStorage.setItem('bc-nav-v1', JSON.stringify({stack: [{r:'editor', id:'p1', tab:'subtitle'}], pos:0})));
    await page.goto(url);
    await page.getByRole('button', {name:'只看原文', exact:true}).waitFor();
    await run(page);
    assert.deepEqual(errors, []);
  } finally {await browser.close();}
};
const mode = (page, name) => page.getByRole('button', {name, exact:true}).click();
const input = page => page.locator('[contenteditable="true"]');
const paired = page => page.locator('.sb').filter({has:page.locator('.blkpairs')}).first();
const caret = (page, at) => input(page).evaluate((el, at) => {
  const range = document.createRange(); range.setStart(el.firstChild, at); range.collapse(true);
  const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
}, at);
const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const key = async (page, shortcut) => {await page.keyboard.press(shortcut); await settle(page);};

test('双语草稿与拆分一笔撤销、重做，切列表仍保留；新编辑清空重做', () => setup(async page => {
  await mode(page, '原文 ＋ 译文');
  const card = paired(page);
  const before = await card.locator('.blkpair').allInnerTexts();
  await card.locator('.blkpair .tgo .edt').nth(2).click();
  const original = await input(page).innerText();
  await input(page).fill(original + '新增'); await caret(page, 2); await key(page, 'Enter');
  assert.equal(await card.locator('.blkpair').count(), 4);
  const after = await card.locator('.blkpair').allInnerTexts();
  const current = await input(page).innerText();
  await page.keyboard.insertText('临时草稿');
  const draft = await input(page).innerText();
  await key(page, 'Meta+z');
  assert.equal(await card.locator('.blkpair').count(), 4, '先撤文本草稿，不能跨过它撤结构');
  assert.equal(await input(page).innerText(), current);
  await key(page, 'Meta+Shift+z');
  assert.equal(await input(page).innerText(), draft, '文本撤销后须先重做文本，不能跳到文档栈');
  await key(page, 'Meta+z');
  await key(page, 'Meta+z');
  assert.deepEqual(await card.locator('.blkpair').allInnerTexts(), before);
  assert.equal(await input(page).count(), 0);
  await key(page, 'Meta+Shift+z');
  assert.deepEqual(await card.locator('.blkpair').allInnerTexts(), after);
  await mode(page, '只看原文'); await mode(page, '原文 ＋ 译文');
  assert.deepEqual(await card.locator('.blkpair').allInnerTexts(), after);
  await key(page, 'Meta+z');
  await card.locator('.blkpair .tgt .edt').first().click();
  await input(page).fill('新字幕版'); await key(page, 'Meta+Enter');
  await key(page, 'Meta+Shift+z');
  assert.equal(await card.locator('.blkpair').count(), 3);
  assert.equal(await card.locator('.blkpair .tgt .edt').first().innerText(), '新字幕版');
  await key(page, 'Meta+z');
  assert.deepEqual(await card.locator('.blkpair').allInnerTexts(), before);
}));

test('原文与双语编辑按发生顺序撤销，提示条撤销可重做', () => setup(async page => {
  const cue = page.locator('.sbtext.edt').first();
  const original = await cue.innerText();
  await cue.click(); await input(page).fill(original + '原文修正'); await key(page, 'Meta+Enter');
  await mode(page, '原文 ＋ 译文');
  const card = paired(page), before = await card.locator('.blkpair').allInnerTexts();
  await card.locator('.blkpair .tgt .edt').first().click();
  await input(page).fill('译文修正'); await key(page, 'Meta+Enter');
  await page.locator('.toast__act--undo').last().click(); await settle(page);
  assert.deepEqual(await card.locator('.blkpair').allInnerTexts(), before);
  await mode(page, '只看原文');
  assert.equal(await cue.innerText(), original + '原文修正');
  await key(page, 'Meta+z'); assert.equal(await cue.innerText(), original);
  await key(page, 'Meta+Shift+z'); assert.equal(await cue.innerText(), original + '原文修正');
  await key(page, 'Meta+Shift+z');
  await mode(page, '原文 ＋ 译文');
  assert.equal(await card.locator('.blkpair .tgt .edt').first().innerText(), '译文修正');
}));

test('cue 拆并恢复条数与文本，输入法期间不触发全局历史', () => setup(async page => {
  const cues = page.locator('.sbtext.edt'), count = await cues.count(), text = await cues.first().innerText();
  await cues.first().click(); await caret(page, 2); await key(page, 'Enter');
  assert.equal(await cues.count(), count + 1);
  await input(page).evaluate(el => el.dispatchEvent(new KeyboardEvent('keydown', {key:'z', metaKey:true, isComposing:true, bubbles:true, cancelable:true})));
  assert.equal(await cues.count(), count + 1);
  await key(page, 'Meta+z');
  assert.equal(await cues.count(), count); assert.equal(await cues.first().innerText(), text);
  await key(page, 'Meta+Shift+z'); assert.equal(await cues.count(), count + 1);
}));

test('切换语言隔离覆盖，撤销仍遵循同一项目的顺序', () => setup(async page => {
  await mode(page, '原文 ＋ 译文');
  const cell = paired(page).locator('.blkpair .tgt .edt').first();
  const original = await cell.innerText();
  await cell.click(); await input(page).fill('英文字幕修正'); await key(page, 'Meta+Enter');
  const language = async name => {
    await page.locator('.sublist .pickb').click();
    await page.locator('.menu__i').filter({hasText:name}).click();
    await settle(page);
  };
  await language('日本語'); assert.equal(await cell.innerText(), original);
  await cell.click(); await input(page).fill('日文字幕修正'); await key(page, 'Meta+Enter');
  await language('English'); assert.equal(await cell.innerText(), '英文字幕修正');
  await key(page, 'Meta+z'); assert.equal(await cell.innerText(), '英文字幕修正');
  await language('日本語'); assert.equal(await cell.innerText(), original);
  await key(page, 'Meta+Shift+z'); assert.equal(await cell.innerText(), '日文字幕修正');
}));
