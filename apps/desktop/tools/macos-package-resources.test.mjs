import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { LOCALES } from '../../../packages/protocol/src/i18n.ts';
import { macElectronLanguages, shareMacFonts } from './macos-package-resources.mjs';

function fixture() {
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

test('Mac languages preserve every app locale, Chromium aliases, regions and gender variants', () => {
  const languages = macElectronLanguages(LOCALES);
  for (const locale of LOCALES) assert.ok(languages.includes(locale));
  for (const locale of ['zh_CN', 'zh_TW', 'pt_BR', 'en', 'en_GB', 'es_419', 'ja']) {
    for (const suffix of ['', '_FEMININE', '_MASCULINE', '_NEUTER']) assert.ok(languages.includes(`${locale}${suffix}`));
  }
  assert.ok(!languages.includes('ar'));
});

test('Mac staging removes only byte-identical fonts and rewrites file URLs to the shared Web assets', () => {
  const f = fixture();
  try {
    const { manifest, savedBytes } = shareMacFonts(f);
    assert.equal(Object.keys(manifest).length, 2);
    assert.ok(savedBytes > 0);
    assert.deepEqual(JSON.parse(readFileSync(path.join(f.webAssets, 'bundled-fonts.json'))), manifest);
    const script = readFileSync(f.script, 'utf8');
    for (const asset of Object.values(manifest)) {
      assert.ok(!existsSync(path.join(f.desktopAssets, asset)));
      const url = new URL(`../../../../web/assets/${asset}`, 'file:///Applications/BaoCut.app/Contents/Resources/app.asar/out/renderer/assets/preview.js');
      assert.equal(url.pathname, `/Applications/BaoCut.app/Contents/Resources/web/assets/${asset}`);
      assert.ok(script.includes(JSON.stringify(`../../../../web/assets/${asset}`)));
      assert.ok(existsSync(path.join(f.webAssets, asset)));
    }
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('Stale Web fonts, missing references and prebuilt embedded-font workers fail before staging is changed', () => {
  for (const failure of ['stale', 'missing-reference', 'embedded-worker']) {
    const f = fixture();
    try {
      if (failure === 'stale') writeFileSync(path.join(f.webAssets, 'Poppins-Regular-12345678.ttf'), 'stale font');
      if (failure === 'missing-reference') writeFileSync(f.script, '// no font references');
      if (failure === 'embedded-worker') {
        f.exportWorker = path.join(f.root, 'export-worker');
        writeFileSync(f.exportWorker, readFileSync(path.join(f.fontSource, 'NotoSansSC-Variable.ttf')));
      }
      const original = readFileSync(f.script);
      assert.throws(() => shareMacFonts(f));
      assert.deepEqual(readFileSync(f.script), original);
      assert.ok(existsSync(path.join(f.desktopAssets, 'NotoSansSC-Variable-12345678.ttf')));
      assert.ok(!existsSync(path.join(f.webAssets, 'bundled-fonts.json')));
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  }
});
