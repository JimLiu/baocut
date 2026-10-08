// 复用原型 4311、Web 5187 与隔离 audit.bcut 服务；Web 文稿通过请求夹具注入，不写项目。
import {firefox} from '../../../apps/web/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
import {test} from 'node:test';

for (const prototype of [true, false]) test(`${prototype ? '原型' : 'Web'}：cue 底纹开关、刷新、键盘与编辑`, async () => {
  const browser = await firefox.launch({headless:true});
  try {
    const page = await browser.newPage({viewport:{width:1440,height:900}}), errors = [], writes = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', r => {if (r.method() === 'POST' && /\/(?:edit|transcript)\/apply/.test(r.url())) writes.push(r.url());});
    const protoUrl = process.env.BAOCUT_PROTOTYPE_URL || 'http://localhost:4311/baocut/BaoCut.html';
    const webBase = process.env.BAOCUT_WEB_URL || 'http://localhost:5187';
    if (prototype) await page.addInitScript(() => localStorage.setItem('bc-nav-v1', JSON.stringify({stack:[{r:'editor',id:'p1',tab:'transcript'}],pos:0})));
    else {
      const snapshot = await (await fetch(process.env.BAOCUT_SHADE_DOC_URL || 'http://localhost:24467/projects/audit.bcut/__bcut/doc')).json();
      const doc = {...snapshot.document, speakers:{s1:{name:'Speaker',hue:200}}, chapters:[],
        cues:['First cue.', 'Second  cue.', 'Third 😀 cue.'].map((text,i) => ({id:`q-${i}`,text,start:i,end:i+1,sp:'s1',paraId:i ? 'p-b' : 'p-a',paraStart:i<2})),
        sentences:[],transCues:[]};
      for (const url of ['**/projects/audit.bcut/__bcut/doc', '**/projects/audit.bcut/__bcut/doc?*']) await page.route(url, r => r.fulfill({json:{...snapshot,document:doc}}));
      await page.route('**/projects/audit.bcut/studio/data.json?*', r => r.fulfill({json:doc}));
    }
    const editor = async () => {
      if (prototype) await page.reload(); else await page.goto(`${webBase}/p/audit.bcut/transcript`);
      if (prototype) await page.locator('.railb').filter({hasText:'文稿'}).click();
      await page.locator('.para__b').first().waitFor();
    };
    const settings = async () => {
      if (prototype) await page.locator('.side__foot').getByRole('button',{name:'设置',exact:true}).click();
      else await page.goto(`${webBase}/settings/general`);
      return page.getByRole('switch', {name:/cue/i});
    };
    await page.goto(prototype ? protoUrl : `${webBase}/p/audit.bcut/transcript`);
    if (prototype) await page.locator('.railb').filter({hasText:'文稿'}).click();
    await page.locator('.para__b').first().waitFor();
    const text = await page.locator('.para__b').allTextContents();
    assert.equal(await page.locator('.cue-shade').count(), 0);
    let toggle = await settings(); assert.equal(await toggle.getAttribute('aria-checked'), 'false');
    await toggle.focus(); await page.keyboard.press('Space');
    assert.equal(await toggle.getAttribute('aria-checked'), 'true');
    await editor(); assert.ok(await page.locator('.cue-shade').count() > 0);
    assert.deepEqual(await page.locator('.para__b').allTextContents(), text);
    if (!prototype) {
      assert.deepEqual(await page.locator('.cue-shade').allTextContents(), ['First cue.', 'Third 😀 cue.']);
      assert.equal(await page.locator('.para').nth(1).locator('.cue-shade').textContent(), 'Third 😀 cue.');
    }
    await page.locator('.cue-shade').first().click();
    const input = page.locator(prototype ? '.para__b[contenteditable="true"]' : 'textarea.para__b'); await input.waitFor();
    assert.equal(prototype ? await input.textContent() : await input.inputValue(), text[0]);
    await page.keyboard.press('Escape'); assert.ok(await page.locator('.cue-shade').count() > 0);
    if (process.env.BAOCUT_SHADE_SHOTS) await page.screenshot({path:`${process.env.BAOCUT_SHADE_SHOTS}/${prototype?'prototype':'web'}-cue-shading.png`});
    const light = await page.locator('.cue-shade').first().evaluate(el => getComputedStyle(el).backgroundColor);
    await page.emulateMedia({colorScheme:'dark'});
    await page.evaluate(async () => {
      await Promise.all(document.getAnimations().filter(a => Number.isFinite(a.effect?.getComputedTiming().endTime)).map(a => a.finished.catch(() => {})));
    });
    const dark = await page.locator('.cue-shade').first().evaluate(el => getComputedStyle(el).backgroundColor);
    assert.notEqual(light, dark);
    if (process.env.BAOCUT_SHADE_SHOTS) await page.screenshot({path:`${process.env.BAOCUT_SHADE_SHOTS}/${prototype?'prototype':'web'}-cue-shading-dark.png`});
    toggle = await settings(); assert.equal(await toggle.getAttribute('aria-checked'), 'true');
    await toggle.focus(); await page.keyboard.press('Enter');
    await editor(); assert.equal(await page.locator('.cue-shade').count(), 0);
    assert.deepEqual(await page.locator('.para__b').allTextContents(), text);
    assert.deepEqual(writes, []); assert.deepEqual(errors, []);
  } finally {await browser.close();}
});
