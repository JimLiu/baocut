import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { shareFonts, shareWasm } from './shared-package-resources.mjs';

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'baocut-shared-wasm-'));
  const appDir = path.join(root, 'resources/app.asar');
  const webDir = path.join(root, 'resources/web');
  const desktopAssets = path.join(appDir, 'out/renderer/assets');
  const webAssets = path.join(webDir, 'assets');
  const nodeWasm = path.join(appDir, 'out/main/generated/editor.wasm');
  for (const dir of [desktopAssets, webAssets, path.dirname(nodeWasm)]) mkdirSync(dir, { recursive: true });
  const sources = {};
  const urls = {};
  for (const [name, letter] of [['editor', 97], ['preview', 98]]) {
    const bytes = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0, 0, 2, 1, letter]);
    const file = path.join(root, `${name}.wasm`);
    writeFileSync(file, bytes);
    sources[name] = file;
    urls[name] = `data:application/wasm;base64,${bytes.toString('base64')}`;
    if (name === 'editor') writeFileSync(nodeWasm, bytes);
  }
  for (const dir of [desktopAssets, webAssets]) {
    writeFileSync(path.join(dir, 'index.js'), `const editor = ${JSON.stringify(urls.editor)}; export { editor };`);
    writeFileSync(path.join(dir, 'preview.js'), `export default '${urls.preview}';`);
  }
  return { root, appDir, webDir, desktopAssets, webAssets, nodeWasm, sources, urls };
}

test('staging shares identical desktop, Web and Runtime WASM without changing their API', async () => {
  const f = fixture();
  try {
    const { manifest } = shareWasm(f);
    assert.deepEqual(JSON.parse(readFileSync(path.join(f.webAssets, 'bundled-wasm.json'))), manifest);
    assert.ok(!existsSync(f.nodeWasm));
    for (const name of ['editor', 'preview']) {
      const asset = manifest[`${name}.wasm`];
      assert.deepEqual(readFileSync(path.join(f.webAssets, asset)), readFileSync(f.sources[name]));
      const consumer = name === 'editor' ? 'index.js' : 'preview.js';
      const desktop = readFileSync(path.join(f.desktopAssets, consumer), 'utf8');
      const web = readFileSync(path.join(f.webAssets, consumer), 'utf8');
      const adapter = /from "\.\/([^"]+)"/.exec(web)[1];
      assert.ok(!desktop.includes(f.urls[name]));
      assert.ok(!web.includes(f.urls[name]));
      assert.match(adapter, new RegExp(`^${name}-loader-[a-f0-9]{12}\\.js$`));
      assert.ok(desktop.includes(`../../../../web/assets/${adapter}`));
      assert.ok(web.includes(`./${adapter}`));
      for (const base of [
        'file:///Applications/BaoCut.app/Contents/Resources/app.asar/out/renderer/assets/index.js',
        'file:///C:/Users/Test%20User/BaoCut/resources/app.asar/out/renderer/assets/index.js',
      ]) {
        const url = new URL(`../../../../web/assets/${asset}`, base);
        assert.ok(url.pathname.endsWith(`/resources/web/assets/${asset}`) || url.pathname.endsWith(`/Resources/web/assets/${asset}`));
      }
      // Exercise the generated adapter's real fetch and error paths with a data URL.
      const source = readFileSync(path.join(f.webAssets, adapter), 'utf8');
      const withUrl = (url) => source.replace(`new URL(${JSON.stringify(asset)}, import.meta.url)`, `new URL(${JSON.stringify(url)})`);
      const load = (source) => import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
      const module = await load(withUrl(f.urls[name]));
      assert.equal(module.default, f.urls[name]);
      await assert.rejects(load(withUrl('bad:missing')), /fetch failed/);
    }
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('stale clients, invalid WASM and stale Runtime fail before changing staging', () => {
  for (const failure of ['desktop', 'web', 'runtime', 'source']) {
    const f = fixture();
    try {
      if (failure === 'desktop' || failure === 'web') {
        writeFileSync(path.join(failure === 'desktop' ? f.desktopAssets : f.webAssets, 'preview.js'), 'export default "stale";');
      }
      if (failure === 'runtime') writeFileSync(f.nodeWasm, 'stale');
      if (failure === 'source') writeFileSync(f.sources.editor, 'invalid');
      const original = readFileSync(path.join(f.desktopAssets, 'index.js'));
      assert.throws(() => shareWasm(f));
      assert.deepEqual(readFileSync(path.join(f.desktopAssets, 'index.js')), original);
      assert.ok(existsSync(f.nodeWasm));
      assert.ok(!existsSync(path.join(f.webAssets, 'bundled-wasm.json')));
      assert.equal(readFileSync(path.join(f.webAssets, 'index.js'), 'utf8').includes('__baocut_shared_'), false);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  }
});

function fontFixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'baocut-shared-fonts-'));
  const appDir = path.join(root, 'app');
  const webDir = path.join(root, 'web');
  const fontSource = path.join(root, 'source');
  const desktopAssets = path.join(appDir, 'out/renderer/assets');
  const webAssets = path.join(webDir, 'assets');
  for (const dir of [desktopAssets, webAssets, fontSource]) mkdirSync(dir, { recursive: true });
  const names = ['NotoSansSC-Variable', 'Poppins-Regular'];
  const script = path.join(desktopAssets, 'preview.js');
  for (const name of names) {
    writeFileSync(path.join(fontSource, `${name}.ttf`), `font ${name}`);
    for (const assets of [desktopAssets, webAssets]) cpSync(path.join(fontSource, `${name}.ttf`), path.join(assets, `${name}-12345678.ttf`));
  }
  writeFileSync(script, names.map((name, i) => `const font${i}=new URL("${name}-12345678.ttf", import.meta.url).href;`).join('\n'));
  return { root, appDir, webDir, fontSource, desktopAssets, webAssets, script };
}

test('Desktop staging removes only byte-identical fonts and rewrites file URLs to the shared Web assets', () => {
  const f = fontFixture();
  try {
    const { manifest, savedBytes } = shareFonts(f);
    assert.equal(Object.keys(manifest).length, 2);
    assert.ok(savedBytes > 0);
    assert.deepEqual(JSON.parse(readFileSync(path.join(f.webAssets, 'bundled-fonts.json'))), manifest);
    const script = readFileSync(f.script, 'utf8');
    for (const asset of Object.values(manifest)) {
      assert.ok(!existsSync(path.join(f.desktopAssets, asset)));
      const url = new URL(`../../../../web/assets/${asset}`, 'file:///Applications/BaoCut.app/Contents/Resources/app.asar/out/renderer/assets/preview.js');
      assert.equal(url.pathname, `/Applications/BaoCut.app/Contents/Resources/web/assets/${asset}`);
      const windows = new URL(`../../../../web/assets/${asset}`, 'file:///C:/Users/Test%20User/BaoCut/resources/app.asar/out/renderer/assets/preview.js');
      assert.equal(windows.pathname, `/C:/Users/Test%20User/BaoCut/resources/web/assets/${asset}`);
      assert.ok(script.includes(JSON.stringify(`../../../../web/assets/${asset}`)));
      assert.ok(existsSync(path.join(f.webAssets, asset)));
    }
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('Stale Web fonts, missing references and prebuilt embedded-font workers fail before staging is changed', () => {
  for (const failure of ['stale', 'missing-reference', 'embedded-worker']) {
    const f = fontFixture();
    try {
      if (failure === 'stale') writeFileSync(path.join(f.webAssets, 'Poppins-Regular-12345678.ttf'), 'stale font');
      if (failure === 'missing-reference') writeFileSync(f.script, '// no font references');
      if (failure === 'embedded-worker') {
        f.exportWorker = path.join(f.root, 'export-worker');
        writeFileSync(f.exportWorker, readFileSync(path.join(f.fontSource, 'NotoSansSC-Variable.ttf')));
      }
      const original = readFileSync(f.script);
      assert.throws(() => shareFonts(f));
      assert.deepEqual(readFileSync(f.script), original);
      assert.ok(existsSync(path.join(f.desktopAssets, 'NotoSansSC-Variable-12345678.ttf')));
      assert.ok(!existsSync(path.join(f.webAssets, 'bundled-fonts.json')));
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  }
});
