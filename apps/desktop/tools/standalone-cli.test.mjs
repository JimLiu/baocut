import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createPackage } from '@electron/asar';
import { parseManifest, releaseManifest } from '../src/main/app-update-rules.ts';
import { RESOURCE_DIRS } from '../src/main/packaged-resources.ts';
import { parseStandaloneFeed, parseStandaloneManifest, standaloneLayout } from '../../../packages/protocol/src/standalone-cli.ts';
import { DISTRIBUTED_NOTICES } from '../../../tools/third-party-notices.ts';
import { addStandaloneToFeed, appRelease, archiveStandalone, signStandaloneMac, stageStandalonePackage, standaloneInfoPlist } from './standalone-cli.mjs';

const COMMIT = 'a'.repeat(40);

function scratch() {
  return realpathSync(mkdtempSync(path.join(os.tmpdir(), 'baocut-standalone-test-')));
}

function write(file, text = 'x') {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
}

/** A built App with the same resource layout and an asar holding main, renderer and preload code. */
async function fakeApp(dir, platform) {
  const app = path.join(dir, platform === 'darwin' ? 'BaoCut.app' : 'win-unpacked');
  const resources = path.join(app, platform === 'darwin' ? 'Contents/Resources' : 'resources');
  for (const sub of Object.values(RESOURCE_DIRS)) write(path.join(resources, sub, 'marker.txt'), sub);
  write(path.join(resources, 'bin', 'engine-host'), 'binary');
  write(path.join(resources, 'icon.icns'), 'icon');
  const code = path.join(dir, 'asar-source');
  write(path.join(code, 'out/main/cli.js'), 'cli');
  write(path.join(code, 'out/main/runtime.js'), 'runtime');
  write(path.join(code, 'out/renderer/index.html'), 'renderer');
  write(path.join(code, 'out/preload/index.js'), 'preload');
  write(path.join(code, 'node_modules/ws/package.json'), '{"name":"ws"}');
  write(path.join(code, 'package.json'), JSON.stringify({ name: 'baocut', version: '3.17.0', baocutBuild: 93, baocutSourceCommit: COMMIT, baocutVariant: 'cpu' }));
  await createPackage(code, path.join(resources, 'app.asar'));
  return app;
}

function launchers(dir) {
  const launcher = path.join(dir, 'launchers', 'baocut-cli');
  const disclaim = path.join(dir, 'launchers', 'baocut-disclaim');
  write(launcher, 'launcher');
  write(disclaim, 'disclaim');
  return { launcher, disclaim };
}

test('Info.plist names the command line bundle with Node as its executable', () => {
  const text = standaloneInfoPlist({ version: '3.17.0', build: 93 });
  if (process.platform === 'darwin') {
    const parsed = spawnSync('plutil', ['-convert', 'json', '-o', '-', '-'], { input: text, encoding: 'utf8' });
    assert.equal(parsed.status, 0, parsed.stderr);
    const info = JSON.parse(parsed.stdout);
    assert.equal(info.CFBundleIdentifier, 'com.baocut.cli');
    assert.equal(info.CFBundleExecutable, 'node');
    assert.equal(info.CFBundleName, 'BaoCut CLI');
    assert.equal(info.CFBundleShortVersionString, '3.17.0');
    assert.equal(info.CFBundleVersion, '93');
    assert.equal(info.LSMinimumSystemVersion, '14.0');
    assert.equal(info.LSUIElement, true);
    assert.deepEqual(info.NSBonjourServices, ['_baocut-node._tcp']);
  } else {
    assert.match(text, /<key>CFBundleIdentifier<\/key><string>com\.baocut\.cli<\/string>/);
  }
});

for (const platform of ['darwin', 'win32']) {
  test(`stages the ${platform} package from the built App: resources, unpacked main code, Node, launchers and manifest`, async () => {
    const dir = scratch();
    try {
      const app = await fakeApp(dir, platform);
      const release = await appRelease(app, platform);
      assert.deepEqual(release, { version: '3.17.0', build: 93, variant: 'cpu', sourceCommit: COMMIT });
      const node = path.join(dir, 'node-binary');
      write(node, 'node');
      const out = path.join(dir, 'package');
      const staged = await stageStandalonePackage({
        platform, app, out, node, launchers: launchers(dir), version: '3.17.0', build: 93, sourceCommit: COMMIT, nodeVersion: '24.22.1',
      });
      assert.deepEqual(staged.manifest, {
        schema: 1, product: 'baocut-cli', version: '3.17.0', build: 93,
        target: platform === 'darwin' ? 'aarch64-apple-darwin' : 'x86_64-pc-windows-msvc', variant: 'cpu', sourceCommit: COMMIT, node: '24.22.1',
      });
      const layout = standaloneLayout(platform);
      const at = (...segments) => path.join(out, ...segments);
      assert.ok(parseStandaloneManifest(readFileSync(at(...layout.app, 'baocut-standalone.json'), 'utf8')));
      for (const sub of Object.values(RESOURCE_DIRS)) assert.equal(readFileSync(at(...layout.resources, sub, 'marker.txt'), 'utf8'), sub);
      for (const { fileName } of DISTRIBUTED_NOTICES) assert.ok(existsSync(at(...layout.resources, fileName)), fileName);
      assert.equal(readFileSync(at(...layout.app, 'out/main/runtime.js'), 'utf8'), 'runtime');
      assert.ok(existsSync(at(...layout.app, 'node_modules/ws/package.json')));
      // No Electron in the package: renderer and preload code stay out.
      assert.equal(existsSync(at(...layout.app, 'out/renderer')), false);
      assert.equal(existsSync(at(...layout.app, 'out/preload')), false);
      assert.equal(readFileSync(at(...layout.node), 'utf8'), 'node');
      assert.equal(readFileSync(at(...layout.launcher), 'utf8'), 'launcher');
      assert.deepEqual(readdirSync(out).sort(), [...layout.top].sort());
      if (platform === 'darwin') {
        assert.equal(readFileSync(at(...layout.disclaim), 'utf8'), 'disclaim');
        assert.match(readFileSync(at('BaoCut CLI.app/Contents/Info.plist'), 'utf8'), /com\.baocut\.cli/);
        assert.ok(existsSync(at(...layout.resources, 'icon.icns')));
        assert.ok(existsSync(at(...layout.resources, 'zh-Hans.lproj/InfoPlist.strings')));
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

test('a local rehearsal can swap in freshly built main code', async () => {
  const dir = scratch();
  try {
    const app = await fakeApp(dir, 'darwin');
    const code = path.join(dir, 'fresh-out');
    write(path.join(code, 'main/cli.js'), 'fresh cli');
    write(path.join(code, 'main/runtime.js'), 'fresh runtime');
    write(path.join(code, 'node'), 'node');
    const out = path.join(dir, 'package');
    await stageStandalonePackage({
      platform: 'darwin', app, out, node: path.join(code, 'node'), launchers: launchers(dir), version: '3.17.0', build: 94, nodeVersion: '24.22.1', appCode: code,
    });
    const main = path.join(out, ...standaloneLayout('darwin').app, 'out/main');
    assert.equal(readFileSync(path.join(main, 'runtime.js'), 'utf8'), 'fresh runtime');
    // Code without the CLI entry is refused.
    rmSync(path.join(code, 'main/cli.js'));
    await assert.rejects(stageStandalonePackage({
      platform: 'darwin', app, out: path.join(dir, 'again'), node: path.join(code, 'node'), launchers: launchers(dir), version: '3.17.0', build: 94, nodeVersion: '24.22.1', appCode: code,
    }), /out\/main\/cli\.js/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('signs the launchers before the bundle; the bundle carries the Node entitlements', () => {
  const calls = [];
  const run = (command, args) => {
    calls.push([command, ...args]);
    return '';
  };
  signStandaloneMac('/w', { identity: 'ABC', keychain: '/k.keychain-db', entitlements: '/e.plist' }, run);
  const signed = calls.filter(([, first]) => first === '--force').map((call) => call.at(-1));
  assert.deepEqual(signed, ['/w/BaoCut CLI.app/Contents/MacOS/baocut-cli', '/w/BaoCut CLI.app/Contents/MacOS/baocut-disclaim', '/w/BaoCut CLI.app']);
  const bundle = calls.find((call) => call.at(-1) === '/w/BaoCut CLI.app' && call.includes('--force'));
  assert.deepEqual(bundle.slice(bundle.indexOf('--entitlements'), bundle.indexOf('--entitlements') + 2), ['--entitlements', '/e.plist']);
  for (const call of calls.filter((c) => c.includes('--force'))) {
    assert.ok(call.includes('--options') && call.includes('runtime') && call.includes('--timestamp') && call.includes('/k.keychain-db'));
  }
  assert.deepEqual(calls.at(-1), ['codesign', '--verify', '--deep', '--strict', '--verbose=2', '/w/BaoCut CLI.app']);
  calls.length = 0;
  signStandaloneMac('/w', { local: true }, run);
  for (const call of calls.filter((c) => c.includes('--force'))) {
    assert.equal(call[call.indexOf('--sign') + 1], '-');
    assert.equal(call.includes('runtime'), false);
  }
});

test('Windows archive holds the three top-level entries and a sha256 file', async () => {
  const dir = scratch();
  try {
    const root = path.join(dir, 'package');
    write(path.join(root, 'baocut.cmd'), 'cmd');
    write(path.join(root, 'node.exe'), 'node');
    write(path.join(root, 'resources/app/baocut-standalone.json'), '{}');
    const manifest = { version: '3.17.0', build: 93, target: 'x86_64-pc-windows-msvc', variant: 'cuda' };
    const facts = await archiveStandalone(root, { platform: 'win32', output: dir, manifest });
    assert.equal(facts.file, 'BaoCut-CLI-3.17.0-build.93-x86_64-pc-windows-msvc-cuda.zip');
    assert.equal(readFileSync(path.join(dir, `${facts.file}.sha256`), 'utf8'), `${facts.sha256}  ${facts.file}\n`);
    const listed = spawnSync('tar', ['-t', '-f', path.join(dir, facts.file)], { encoding: 'utf8' });
    assert.equal(listed.status, 0, listed.stderr);
    assert.deepEqual([...new Set(listed.stdout.split('\n').filter(Boolean).map((line) => line.split('/')[0]))].sort(), ['baocut.cmd', 'node.exe', 'resources']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the cli entry joins the App feed: the App parser still reads it, the standalone parser reads cli', () => {
  const target = 'aarch64-apple-darwin';
  const feed = releaseManifest({
    target, variant: 'cpu', version: '3.17.0', build: 93, date: '2026-11-08', notes: 'Notes', format: 'zip',
    url: 'https://example.com/BaoCut.zip', size: 10, sha256: 'b'.repeat(64),
  });
  const entry = { format: 'zip', url: 'https://example.com/BaoCut-CLI.zip', size: 20, sha256: 'c'.repeat(64) };
  const text = addStandaloneToFeed(JSON.stringify(feed), { target, variant: 'cpu', entry });
  const app = parseManifest(text, target, false);
  assert.equal(app.ok, true);
  assert.equal(app.ok && app.info.url, 'https://example.com/BaoCut.zip');
  const cli = parseStandaloneFeed(text, target, 'cpu');
  assert.deepEqual(cli.ok && cli.cli, entry);
  assert.throws(() => addStandaloneToFeed(JSON.stringify(feed), { target, variant: 'cpu', entry: { ...entry, url: 'http://example.com/x.zip' } }), /https/);
});
