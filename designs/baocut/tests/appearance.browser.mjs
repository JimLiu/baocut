// 先启动原型 4311 与 Web 5187；也可通过环境变量指定预览地址。
import {firefox} from '../../../apps/web/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {writeFile} from 'node:fs/promises';

for (const prototype of [true, false]) test(`${prototype ? '原型' : 'Web'}：外观即时应用、刷新保留、系统跟随和内容隔离`, async () => {
  const browser = await firefox.launch({headless: true});
  try {
    const page = await browser.newPage({viewport: {width: 1440, height: 900}, colorScheme: 'light'});
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    if (prototype) await page.addInitScript(() => localStorage.setItem('bc-nav-v1', JSON.stringify({stack: [{r:'settings', sec:'general'}], pos:0})));
    await page.goto(prototype ? process.env.BAOCUT_PROTOTYPE_URL || 'http://localhost:4311/baocut/BaoCut.html' : process.env.BAOCUT_WEB_SETTINGS_URL || 'http://localhost:5187/settings/general');
    const pick = name => page.locator('.seg button').filter({hasText: new RegExp(`^${name}$`)}).click();
    const body = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    await page.locator('.seg').first().waitFor();
    await pick(prototype ? '浅色' : 'Light'); const light = await body();
    await pick(prototype ? '深色' : 'Dark'); const dark = await body();
    assert.notEqual(dark, light); assert.equal(dark, 'rgb(44, 44, 44)');
    await page.reload(); await page.waitForFunction(() => document.documentElement.style.colorScheme === 'dark');
    assert.equal(await body(), dark);
    await page.emulateMedia({colorScheme:'light'}); assert.equal(await body(), dark, '显式深色不被系统覆盖');
    await pick(prototype ? '跟随系统' : 'System');
    await page.waitForFunction(() => getComputedStyle(document.body).backgroundColor === 'rgb(233, 233, 233)');
    await page.emulateMedia({colorScheme:'dark'});
    await page.waitForFunction(() => getComputedStyle(document.body).backgroundColor === 'rgb(44, 44, 44)');
    // 真实内容容器 class 的 CSS 契约；独立于舞台媒体加载，不能把这一步当导出像素验收。
    const content = await page.evaluate(prototype => {
      const el = document.createElement('div'); el.className = prototype ? 'frame' : 'sthumb';
      el.style.color = 'var(--gray-25)'; document.body.append(el);
      const result = getComputedStyle(el).color; el.remove(); return result;
    }, prototype);
    assert.equal(content, 'rgb(255, 255, 255)');
    if (process.env.BAOCUT_APPEARANCE_SHOTS) await page.screenshot({path:`${process.env.BAOCUT_APPEARANCE_SHOTS}/${prototype ? 'prototype' : 'web'}-dark.png`});
    assert.deepEqual(errors, []);
  } finally {await browser.close();}
});

test('原型切换外观不改变实际视频画布像素', async () => {
  const browser = await firefox.launch({headless:true});
  try {
    const page = await browser.newPage({viewport:{width:1440,height:900},colorScheme:'light'});
    await page.addInitScript(() => localStorage.setItem('bc-nav-v1', JSON.stringify({stack:[{r:'editor',id:'p1',tab:'subtitle'}],pos:0})));
    await page.goto(process.env.BAOCUT_PROTOTYPE_URL || 'http://localhost:4311/baocut/BaoCut.html');
    await page.locator('.frame').waitFor(); await page.evaluate(() => document.fonts.ready);
    const capture = async () => {
      const box = await page.locator('.frame').boundingBox();
      // 圆角和小数外沿会混入不同的 chrome 背景；只比较框内视频内容。
      return page.screenshot({clip:{x:box.x+5,y:box.y+5,width:box.width-10,height:box.height-10},animations:'disabled'});
    };
    const light = await capture();
    await page.locator('.side__foot').getByRole('button',{name:'设置',exact:true}).click();
    await page.locator('.seg button').filter({hasText:/^深色$/}).click();
    await page.reload(); await page.waitForFunction(() => document.documentElement.style.colorScheme === 'dark');
    await page.locator('.frame').waitFor(); await page.evaluate(() => document.fonts.ready);
    const dark = await capture();
    if (process.env.BAOCUT_APPEARANCE_SHOTS) {
      await writeFile(`${process.env.BAOCUT_APPEARANCE_SHOTS}/frame-light.png`, light);
      await writeFile(`${process.env.BAOCUT_APPEARANCE_SHOTS}/frame-dark.png`, dark);
    }
    assert.equal(dark.equals(light), true, '画布 PNG 必须相同；失败时比较两张 frame 截图，避免输出整个字节数组');
    if (process.env.BAOCUT_APPEARANCE_SHOTS) await page.screenshot({path:`${process.env.BAOCUT_APPEARANCE_SHOTS}/prototype-editor-dark.png`});
  } finally {await browser.close();}
});
