import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import {
  CodeBundleError,
  computeContentHash,
  inspectBundle,
  listBundleFiles,
  parseRate,
  scanNetworkReferences,
  synthesizeManifest,
} from './bundle-inspect.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(here, 'fixtures');
const repo = path.resolve(here, '../../..');
const sha = (data: string | Buffer) => crypto.createHash('sha256').update(data).digest('hex');

const tmpDirs: string[] = [];
const tmp = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'baocut-inspect-test-'));
  tmpDirs.push(dir);
  return dir;
};
afterAll(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

/** 在临时目录里按 { 相对路径: 内容 } 写一棵树。 */
function tree(files: Record<string, string | Buffer>): string {
  const dir = tmp();
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  return dir;
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(CodeBundleError);
    return (error as CodeBundleError).code;
  }
  throw new Error('expected a CodeBundleError');
}

const SIMPLE_HTML =
  '<!doctype html><div data-composition-id="main" data-width="320" data-height="180" data-fps="30" data-duration="1"></div>';

describe('listBundleFiles', () => {
  it('递归列出、按 path 排序、算每个文件的 sha256', async () => {
    const dir = tree({ 'index.html': SIMPLE_HTML, 'b/z.js': 'z', 'a.css': 'body{}', 'dependency.lock': '' });
    const entries = await listBundleFiles(dir);
    expect(entries.map((e) => e.path)).toEqual(['a.css', 'b/z.js', 'dependency.lock', 'index.html']);
    expect(entries[1]).toEqual({ path: 'b/z.js', size: 1, sha256: sha('z') });
  });

  it('符号链接 → BUNDLE_SYMLINK（文件与目录都算）', async () => {
    const dir = tree({ 'index.html': SIMPLE_HTML });
    fs.symlinkSync(path.join(dir, 'index.html'), path.join(dir, 'alias.html'));
    expect(await codeOf(listBundleFiles(dir))).toBe('BUNDLE_SYMLINK');
    const dir2 = tree({ 'index.html': SIMPLE_HTML, 'real/a.js': 'a' });
    fs.symlinkSync(path.join(dir2, 'real'), path.join(dir2, 'linked'));
    expect(await codeOf(listBundleFiles(dir2))).toBe('BUNDLE_SYMLINK');
  });

  it('白名单外的扩展名、点文件、node_modules → BUNDLE_FILE_NOT_ALLOWED', async () => {
    expect(await codeOf(listBundleFiles(tree({ 'index.html': SIMPLE_HTML, 'tool.exe': 'MZ' })))).toBe('BUNDLE_FILE_NOT_ALLOWED');
    expect(await codeOf(listBundleFiles(tree({ 'index.html': SIMPLE_HTML, '.env': 'X=1' })))).toBe('BUNDLE_FILE_NOT_ALLOWED');
    expect(await codeOf(listBundleFiles(tree({ 'index.html': SIMPLE_HTML, 'node_modules/x/index.js': '' })))).toBe(
      'BUNDLE_FILE_NOT_ALLOWED',
    );
    // 扩展名不分大小写；按名字放行的固定文件。
    const ok = await listBundleFiles(tree({ 'INDEX.HTML': SIMPLE_HTML, 'build.recipe.json': '{}', 'dependency.lock': '' }));
    expect(ok).toHaveLength(3);
  });

  it('超过上限 → BUNDLE_TOO_LARGE', async () => {
    const dir = tree({ 'a.js': 'a', 'b.js': 'b', 'c.js': 'c' });
    expect(await codeOf(listBundleFiles(dir, { limits: { maxFiles: 2 } }))).toBe('BUNDLE_TOO_LARGE');
    expect(await codeOf(listBundleFiles(dir, { limits: { maxFileBytes: 0 } }))).toBe('BUNDLE_TOO_LARGE');
    expect(await codeOf(listBundleFiles(dir, { limits: { maxTotalBytes: 2 } }))).toBe('BUNDLE_TOO_LARGE');
    expect(await codeOf(listBundleFiles(dir, { limits: { maxPathLength: 3 } }))).toBe('BUNDLE_TOO_LARGE');
    expect(await listBundleFiles(dir, { limits: { maxFiles: 3 } })).toHaveLength(3);
  });
});

describe('computeContentHash', () => {
  it('与手算的公式一致：排序、键顺序、紧凑 JSON，跳过三个不参与摘要的文件', () => {
    const a = { path: 'index.html', size: 5, sha256: sha('hello') };
    const b = { path: 'b.js', size: 1, sha256: sha('b') };
    const expected =
      'sha256-' + sha(`[{"path":"b.js","size":1,"sha256":"${sha('b')}"},{"path":"index.html","size":5,"sha256":"${sha('hello')}"}]`);
    const unhashed = ['bundle.manifest.json', 'files.manifest.json', 'verification.json'].map((p) => ({
      path: p,
      size: 1,
      sha256: sha(p),
    }));
    // 键顺序打乱、顺序打乱，结果不变。
    const shuffled = [{ sha256: a.sha256, size: a.size, path: a.path }, ...unhashed, b];
    expect(computeContentHash(shuffled)).toBe(expected);
    // 子目录里同名的文件参与摘要。
    expect(computeContentHash([a, b, { path: 'sub/verification.json', size: 1, sha256: sha('x') }])).not.toBe(expected);
  });
});

describe('scanNetworkReferences', () => {
  it('找到绝对 URL 与会加载的协议相对 URL；注释与 xmlns 不算', async () => {
    const dir = tree({
      'index.html': [
        '<!doctype html>',
        '<!-- <script src="https://commented.example/x.js"></script> -->',
        '<script src="https://cdn.example.com/lib.js"></script>',
        '<a href="https://example.com/page">link</a>',
        '<img src="//cdn.example.com/a.png">',
        '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"></svg>',
        '<script>',
        '  // fetch("https://line-comment.example/x")',
        '  /* new URL("https://block-comment.example/") */',
        '  const ns = "http://www.w3.org/2000/svg";',
        "  fetch('wss://socket.example/feed');",
        "  const relative = 'a//b';",
        '</script>',
      ].join('\n'),
      'style.css': '@import "//fonts.example.com/font.css";\nbody { background: url(https://img.example/bg.png); }',
    });
    const entries = await listBundleFiles(dir);
    const refs = await scanNetworkReferences(dir, entries);
    expect(refs).toEqual([
      { path: 'index.html', line: 3, text: 'https://cdn.example.com/lib.js' },
      { path: 'index.html', line: 4, text: 'https://example.com/page' },
      { path: 'index.html', line: 5, text: '//cdn.example.com/a.png' },
      { path: 'index.html', line: 11, text: 'wss://socket.example/feed' },
      { path: 'style.css', line: 1, text: '//fonts.example.com/font.css' },
      { path: 'style.css', line: 2, text: 'https://img.example/bg.png' },
    ]);
  });
});

describe('inspectBundle', () => {
  async function bundleWithManifest(mutate?: (manifest: Record<string, unknown>) => void) {
    const dir = tree({ 'index.html': SIMPLE_HTML, 'dependency.lock': '', 'build.recipe.json': '{}' });
    const entries = await listBundleFiles(dir);
    fs.writeFileSync(path.join(dir, 'files.manifest.json'), JSON.stringify(entries));
    const manifest = synthesizeManifest({
      entry: 'index.html',
      width: 320,
      height: 180,
      fps: { num: 30, den: 1 },
      durationFrames: 30,
      alpha: false,
      contract: 'hyperframes/1',
      entries: await listBundleFiles(dir),
    }) as unknown as Record<string, unknown>;
    mutate?.(manifest);
    fs.writeFileSync(path.join(dir, 'bundle.manifest.json'), JSON.stringify(manifest));
    return dir;
  }

  it('有效清单：通过，root 指向源目录', async () => {
    const dir = await bundleWithManifest();
    const bundle = await inspectBundle(dir);
    expect(bundle.synthesized).toBe(false);
    expect(bundle.root).toBe(path.resolve(dir));
    expect(bundle.compositionId).toBe('main');
    expect(bundle.manifest.bundleId).toMatch(/^bundle_[0-9a-f]{16}$/);
    expect(bundle.totalBytes).toBe(bundle.entries.reduce((s, e) => s + e.size, 0));
  });

  it('形状不对 → BUNDLE_MANIFEST_INVALID（带 zod issues）；未知合同或引擎 → BUNDLE_CONTRACT_UNSUPPORTED', async () => {
    const invalid = await bundleWithManifest((m) => {
      m.extra = true;
      (m.permissions as Record<string, unknown>).network = 'allow';
    });
    const error = await inspectBundle(invalid).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CodeBundleError);
    expect((error as CodeBundleError).code).toBe('BUNDLE_MANIFEST_INVALID');
    expect(Array.isArray((error as CodeBundleError).details)).toBe(true);
    const contract = await bundleWithManifest((m) => {
      (m.runtime as Record<string, unknown>).contract = 'lottie/9';
    });
    expect(await codeOf(inspectBundle(contract))).toBe('BUNDLE_CONTRACT_UNSUPPORTED');
    const remotion = await bundleWithManifest((m) => {
      m.runtime = { engine: 'remotion', entry: 'index.html', compositionId: 'main' };
    });
    expect(await codeOf(inspectBundle(remotion))).toBe('BUNDLE_CONTRACT_UNSUPPORTED');
    const notJson = tree({ 'index.html': SIMPLE_HTML, 'bundle.manifest.json': '{' });
    expect(await codeOf(inspectBundle(notJson))).toBe('BUNDLE_MANIFEST_INVALID');
  });

  it('文件被改 → BUNDLE_HASH_MISMATCH；入口不在包里 → BUNDLE_ENTRY_MISSING', async () => {
    const dir = await bundleWithManifest();
    fs.appendFileSync(path.join(dir, 'index.html'), '<!-- edited -->');
    const error = (await inspectBundle(dir).catch((e: unknown) => e)) as CodeBundleError;
    expect(error.code).toBe('BUNDLE_HASH_MISMATCH');
    expect(error.details).toMatchObject({ expected: expect.stringMatching(/^sha256-/), actual: expect.stringMatching(/^sha256-/) });
    // 改清单本身或验证报告不影响摘要。
    const ok = await bundleWithManifest();
    fs.writeFileSync(path.join(ok, 'verification.json'), '{}');
    await expect(inspectBundle(ok)).resolves.toBeTruthy();
    const missing = await bundleWithManifest((m) => {
      (m.runtime as Record<string, unknown>).entry = 'dist/index.html';
    });
    expect(await codeOf(inspectBundle(missing))).toBe('BUNDLE_ENTRY_MISSING');
  });

  it('没有清单时在暂存副本里合成，源目录不变', async () => {
    const source = path.join(fixtures, 'hyperframes-basic');
    const before = fs.readdirSync(source).sort();
    const staging = path.join(tmp(), 'staged');
    const bundle = await inspectBundle(source, { stagingDir: staging, manifest: { alpha: true } });
    expect(fs.readdirSync(source).sort()).toEqual(before);
    expect(bundle.synthesized).toBe(true);
    expect(bundle.root).toBe(staging);
    expect(fs.readdirSync(staging).sort()).toEqual([
      'build.recipe.json',
      'bundle.manifest.json',
      'dependency.lock',
      'files.manifest.json',
      'index.html',
    ]);
    expect(bundle.manifest.intrinsic).toEqual({ width: 1280, height: 720, fps: { num: 30, den: 1 }, durationFrames: 60 });
    expect(bundle.manifest.runtime).toEqual({ engine: 'browser', contract: 'hyperframes/1', entry: 'index.html', frameworkHints: [] });
    expect(bundle.manifest.output.alpha).toBe(true);
    expect(bundle.compositionId).toBe('main');
    // files.manifest.json 的内容就是参与摘要的条目；暂存目录再检查一遍是自洽的。
    const listed = JSON.parse(fs.readFileSync(path.join(staging, 'files.manifest.json'), 'utf8'));
    expect('sha256-' + sha(JSON.stringify(listed))).toBe(bundle.manifest.contentHash);
    const again = await inspectBundle(staging);
    expect(again.synthesized).toBe(false);
    expect(again.manifest).toEqual(bundle.manifest);
  });

  it('合成时识别原生合同；尺寸未知 → BUNDLE_MANIFEST_INVALID；不允许合成时同样报错', async () => {
    const native = await inspectBundle(path.join(fixtures, 'baocut-native'));
    tmpDirs.push(native.root);
    expect(native.manifest.runtime).toMatchObject({ contract: 'baocut/1' });
    expect(await codeOf(inspectBundle(path.join(fixtures, 'root-missing')))).toBe('BUNDLE_MANIFEST_INVALID');
    const overridden = await inspectBundle(path.join(fixtures, 'root-missing'), {
      manifest: { width: 1280, height: 720, fps: 29.97, durationFrames: 60 },
    });
    tmpDirs.push(overridden.root);
    expect(overridden.manifest.intrinsic.fps).toEqual({ num: 30000, den: 1001 });
    expect(await codeOf(inspectBundle(path.join(fixtures, 'hyperframes-basic'), { allowSynthesize: false }))).toBe(
      'BUNDLE_MANIFEST_INVALID',
    );
  });

  it('静态网络引用 → BUNDLE_NETWORK_REFERENCE；strictNetwork: false 时只记录', async () => {
    const error = (await inspectBundle(path.join(fixtures, 'network-static')).catch((e: unknown) => e)) as CodeBundleError;
    expect(error.code).toBe('BUNDLE_NETWORK_REFERENCE');
    expect(error.details).toEqual([{ path: 'index.html', line: 15, text: 'https://example.invalid/lib.js' }]);
    const lenient = await inspectBundle(path.join(fixtures, 'network-static'), { strictNetwork: false });
    tmpDirs.push(lenient.root);
    expect(lenient.networkReferences).toHaveLength(1);
    // 运行期才拼出来的 URL 静态扫描看不到。
    const runtime = await inspectBundle(path.join(fixtures, 'network-runtime'));
    tmpDirs.push(runtime.root);
    expect(runtime.networkReferences).toEqual([]);
  });

  it('接受 motion-graphics 的 build-bundle.mjs 产出的包', async () => {
    const out = tmp();
    const html = path.join(repo, 'skills/motion-graphics/exemplars/lower-third/16x9.html');
    const run = spawnSync(
      process.execPath,
      [path.join(repo, 'skills/motion-graphics/scripts/build-bundle.mjs'), '--html', html, '--out', out],
      {
        encoding: 'utf8',
      },
    );
    expect(run.status, run.stderr).toBe(0);
    const bundle = await inspectBundle(path.join(out, '1'));
    expect(bundle.synthesized).toBe(false);
    expect(bundle.manifest.runtime).toMatchObject({ contract: 'hyperframes/1', entry: 'index.html' });
    expect(bundle.entries.map((e) => e.path)).toEqual([
      'build.recipe.json',
      'bundle.manifest.json',
      'dependency.lock',
      'files.manifest.json',
      'index.html',
    ]);
  });
});

describe('parseRate', () => {
  it('整数、NTSC 小数与分数', () => {
    expect(parseRate('30')).toEqual({ num: 30, den: 1 });
    expect(parseRate('29.97')).toEqual({ num: 30000, den: 1001 });
    expect(parseRate('24000/1001')).toEqual({ num: 24000, den: 1001 });
    expect(parseRate('12.5')).toEqual({ num: 25, den: 2 });
    expect(parseRate('abc')).toBeNull();
  });
});
