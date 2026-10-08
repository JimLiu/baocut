/* 原型随包素材在 assets/stickers，出处与摘要在相邻 provenance.json；v3 应用的程序化贴纸另有测试。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../assets/stickers');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const items = ['', 'anim'].flatMap(folder => Object.entries(JSON.parse(fs.readFileSync(path.join(root, folder, 'provenance.json'), 'utf8')))
  .map(([file, item]) => ({...item, file: path.join(folder, file)})));
test('彩纸只用程序化元素，不分发旧 SVG 彩纸', () => {
  assert.equal(items.filter(i => i.file.includes('dyn-confetti-')).length, 0);
  assert.ok(!fs.readdirSync(path.join(root, 'anim')).some(f => f.startsWith('dyn-confetti-')));
});
test('所有分发的原型素材有许可、固定出处和相符的字节摘要', () => {
  assert.equal(items.length, 382);
  for (const item of items) {
    const bytes = fs.readFileSync(path.join(root, item.file));
    assert.equal(sha(bytes), item.sha256, item.file);
    assert.equal(bytes.length, item.bytes, item.file);
    assert.ok(['MIT', 'CC0-1.0', 'CC-BY-4.0'].includes(item.license), item.file);
    assert.ok(item.sources.length && item.author && item.url.startsWith('https://'), item.file);
    assert.equal(!!item.animated, item.file.startsWith('anim/'));
    assert.equal(item.motion, null);
    if (item.animated) {
      assert.equal(item.license, 'CC-BY-4.0');
      const doc = JSON.parse(bytes);
      assert.ok(doc.layers.length && item.duration > 0);
      assert.ok(String(doc.meta?.k).includes('CC BY 4.0'));
      assert.ok(item.colors.length <= 8);
    } else {
      assert.match(item.url, /(?:[a-f0-9]{40}|open-peeps-9\.4\.2)/);
      assert.ok(bytes.toString().includes(item.license === 'MIT' ? 'MIT License' : 'CC0 1.0 Universal'));
      assert.ok(item.colors.length >= 1 && item.colors.length <= 5);
    }
  }
  for (const folder of ['', 'anim']) {
    const files = fs.readdirSync(path.join(root, folder)).filter(f => /\.(svg|json|gif|png)$/i.test(f) && f !== 'provenance.json');
    assert.deepEqual(files.sort(), items.filter(i => path.dirname(i.file) === (folder || '.')).map(i => path.basename(i.file)).sort());
  }
});
test('素材包完整，动静态素材均有出处记录', () => {
  assert.equal(new Set(items.filter(i => !i.animated).map(i => i.pack)).size, 16);
  assert.equal(new Set(items.filter(i => i.animated).map(i => i.pack)).size, 5);
  assert.equal(items.filter(i => !i.animated).length, 301);
  assert.equal(items.filter(i => i.animated).length, 81);
});
test('人物、设备、手绘与手势包来自具名开源素材且图形不重复', () => {
  for (const [pack, count, provider] of [['People', 20, 'open-peeps'], ['Mockups', 13, 'fluent'], ['Hand-drawn', 8, 'doodle'], ['Gestures', 13, 'fluent']]) {
    const assets = items.filter(i => i.pack === pack);
    assert.equal(assets.length, count, pack);
    assert.deepEqual([...new Set(assets.flatMap(i => i.sources.map(id => id.split('/')[0])))], [provider]);
    assert.equal(new Set(assets.map(i => i.sha256)).size, count, pack);
  }
});
test('People 是唯一人物包，重复的 Avatar 素材不再分发', () => {
  assert.equal(items.some(i => i.name.startsWith('avatar-')), false);
  assert.equal(fs.readdirSync(root).some(f => f.startsWith('avatar-')), false);
});
