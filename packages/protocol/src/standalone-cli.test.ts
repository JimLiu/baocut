import { describe, expect, it } from 'vitest';
import { feedUrl } from '../../../apps/desktop/src/main/app-update-rules.ts';
import {
  parseStandaloneFeed,
  parseStandaloneManifest,
  standaloneArchiveName,
  standaloneFeedUrl,
  standaloneLayout,
  standaloneVersionDir,
  standaloneVersionsRoot,
} from './standalone-cli.ts';

/** CLI 独立使用与发布 §9：独立包的清单、布局与更新源条目。 */

const manifest = {
  schema: 1,
  product: 'baocut-cli',
  version: '3.17.0',
  build: 93,
  target: 'aarch64-apple-darwin',
  variant: 'cpu',
  sourceCommit: 'a'.repeat(40),
  node: '24.11.1',
};

const feed = (overrides: Record<string, unknown> = {}, cli: unknown = { format: 'zip', url: 'https://github.com/jimliu/baocut/releases/download/x/BaoCut-CLI.zip', size: 123, sha256: 'AB'.repeat(32) }) =>
  JSON.stringify({ schema: 1, target: 'aarch64-apple-darwin', version: '3.17.0', build: 93, minimumSystemVersion: '14.0', app: { format: 'zip' }, cli, ...overrides });

describe('standalone manifest', () => {
  it('读成形的清单；字段不对时 null', () => {
    expect(parseStandaloneManifest(JSON.stringify(manifest))).toEqual(manifest);
    expect(parseStandaloneManifest(JSON.stringify({ ...manifest, sourceCommit: null }))?.sourceCommit).toBeNull();
    for (const bad of [{ schema: 2 }, { product: 'baocut' }, { version: '3.17' }, { build: -1 }, { target: 'x86_64-apple-darwin' }, { variant: 'CUDA' }, { sourceCommit: 'abc' }, { node: 'v24' }]) {
      expect(parseStandaloneManifest(JSON.stringify({ ...manifest, ...bad }))).toBeNull();
    }
    expect(parseStandaloneManifest('not json')).toBeNull();
  });

  it('版本目录与归档名：标准版不带变体后缀', () => {
    expect(standaloneVersionDir(manifest)).toBe('3.17.0-build.93');
    expect(standaloneArchiveName({ ...manifest, target: 'aarch64-apple-darwin' })).toBe('BaoCut-CLI-3.17.0-build.93-aarch64-apple-darwin.zip');
    expect(standaloneArchiveName({ ...manifest, target: 'x86_64-pc-windows-msvc', variant: 'cuda' })).toBe('BaoCut-CLI-3.17.0-build.93-x86_64-pc-windows-msvc-cuda.zip');
  });

  it('布局照 App：app/ 与 web/ 同在资源目录下；macOS 的外壳只有一项', () => {
    const mac = standaloneLayout('darwin')!;
    expect(mac.top).toEqual(['BaoCut CLI.app']);
    expect(mac.app.slice(0, -1)).toEqual(mac.resources);
    expect(mac.launcher).toEqual(['BaoCut CLI.app', 'Contents', 'MacOS', 'baocut-cli']);
    const win = standaloneLayout('win32')!;
    expect(win.app).toEqual(['resources', 'app']);
    expect(win.disclaim).toBeNull();
    expect(standaloneLayout('linux')).toBeNull();
    expect(standaloneVersionsRoot('darwin')).toEqual({ base: 'home', segments: ['.local', 'share', 'baocut', 'versions'] });
    expect(standaloneVersionsRoot('win32')).toEqual({ base: 'localAppData', segments: ['BaoCut', 'cli', 'versions'] });
  });
});

describe('standalone feed entry', () => {
  it('更新源的地址与 App 的相同', () => {
    expect(standaloneFeedUrl('aarch64-apple-darwin', 'cpu')).toBe(feedUrl('aarch64-apple-darwin', 'cpu'));
    expect(standaloneFeedUrl('x86_64-pc-windows-msvc', 'vulkan')).toBe(feedUrl('x86_64-pc-windows-msvc', 'vulkan'));
  });

  it('读 cli 条目，sha256 转小写', () => {
    const result = parseStandaloneFeed(feed(), 'aarch64-apple-darwin', 'cpu');
    expect(result).toMatchObject({ ok: true, version: '3.17.0', build: 93, minimumSystemVersion: '14.0', cli: { format: 'zip', size: 123, sha256: 'ab'.repeat(32) } });
  });

  it('没有 cli 条目（旧的源）、目标或变体不对、地址不是 https 时拒绝', () => {
    expect(parseStandaloneFeed(feed({ cli: undefined }), 'aarch64-apple-darwin', 'cpu')).toMatchObject({ ok: false, error: 'missing' });
    expect(parseStandaloneFeed(feed({ target: 'x86_64-pc-windows-msvc' }), 'aarch64-apple-darwin', 'cpu')).toMatchObject({ ok: false, error: 'target' });
    expect(parseStandaloneFeed(feed({ variant: 'cuda' }), 'aarch64-apple-darwin', 'cpu')).toMatchObject({ ok: false, error: 'target' });
    expect(parseStandaloneFeed(feed({ schema: 2 }), 'aarch64-apple-darwin', 'cpu')).toMatchObject({ ok: false, error: 'schema' });
    expect(parseStandaloneFeed(feed({ build: 0 }), 'aarch64-apple-darwin', 'cpu')).toMatchObject({ ok: false, error: 'release' });
    const local = { format: 'zip', url: 'file:///tmp/BaoCut-CLI.zip', size: 1, sha256: '0'.repeat(64) };
    expect(parseStandaloneFeed(feed({}, local), 'aarch64-apple-darwin', 'cpu')).toMatchObject({ ok: false, error: 'artifact' });
    expect(parseStandaloneFeed(feed({}, local), 'aarch64-apple-darwin', 'cpu', true)).toMatchObject({ ok: true });
    expect(parseStandaloneFeed(feed({}, { ...local, url: 'https://x/y.zip', sha256: 'zz' }), 'aarch64-apple-darwin', 'cpu')).toMatchObject({ ok: false, error: 'artifact' });
    expect(parseStandaloneFeed('{', 'aarch64-apple-darwin', 'cpu')).toMatchObject({ ok: false, error: 'decode' });
  });
});
