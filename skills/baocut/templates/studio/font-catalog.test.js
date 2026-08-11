const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, 'font-catalog.js'), 'utf8');
const appCss = fs.readFileSync(path.join(__dirname, 'app.css'), 'utf8');

function load(queryLocalFonts) {
  const window = {};
  if (queryLocalFonts) window.queryLocalFonts = queryLocalFonts;
  vm.runInNewContext(source, { window }, { filename: 'font-catalog.js' });
  return window.BCS_FONT_CATALOG;
}

test('catalog matches the Mac App curated font families', () => {
  const catalog = load();
  const macSource = fs.readFileSync(path.join(
    __dirname,
    '../../../../apps/mac/Sources/VoiceInk/Adapters/SampleStyleDataAdapter.swift',
  ), 'utf8');
  const macFamilies = Array.from(
    macSource.matchAll(/FontEntry\(family: "([^"]+)"/g),
    (match) => match[1],
  );
  const webFamilies = Array.from(catalog.builtIns(), (font) => font.family);

  assert.deepEqual(
    webFamilies,
    [
      'Montserrat', 'Lexend Deca', 'Alata', 'Bebas Neue', 'Archivo Black',
      'Paytone One', 'Carter One', 'Fredoka One', 'Bangers',
      'Permanent Marker', 'Dancing Script', 'Press Start 2P', 'Impact',
      'Comic Sans MS', 'Courier New', 'Source Sans 3', 'Source Serif 4',
      'Source Code Pro',
    ],
  );
  assert.deepEqual(webFamilies, macFamilies);
  for (const font of catalog.builtIns().filter((item) => item.source !== 'system')) {
    assert.match(
      appCss,
      new RegExp(`font-family:\\s*"${font.family.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}"`),
      `${font.family} must have a bundled @font-face`,
    );
  }
  assert.equal(catalog.canonicalFamily('montserrat'), 'Montserrat');
  assert.equal(catalog.canonicalFamily({ fontFamily: 'serif' }), 'Source Serif 4');
  assert.equal(catalog.displayName('system'), '系统黑体');
  assert.match(catalog.stackFor('Archivo Black'), /^"Archivo Black"/);
  assert.match(catalog.stackFor('My "Local" Font'), /^"My \\"Local\\" Font"/);
});

test('system font access deduplicates faces and excludes curated families', async () => {
  const catalog = load(async () => [
    { family: 'Avenir Next', style: 'Regular' },
    { family: 'Avenir Next', style: 'Bold' },
    { family: 'Montserrat', style: 'Regular' },
    { family: 'Menlo', style: 'Regular' },
    { family: '' },
  ]);
  const result = await catalog.requestSystemFonts();
  assert.equal(result.status, 'ready');
  assert.deepEqual(Array.from(result.families), ['Avenir Next', 'Menlo']);
  assert.deepEqual(Array.from(catalog.systemFamilies()), ['Avenir Next', 'Menlo']);
});

test('unsupported and denied browsers keep the manual-family fallback available', async () => {
  const unsupported = await load().requestSystemFonts();
  assert.equal(unsupported.status, 'unsupported');
  assert.match(load().stackFor('Hiragino Sans'), /^"Hiragino Sans"/);

  const deniedError = Object.assign(new Error('denied'), { name: 'NotAllowedError' });
  const denied = await load(async () => { throw deniedError; }).requestSystemFonts();
  assert.equal(denied.status, 'denied');
  assert.deepEqual(Array.from(denied.families), []);
});
