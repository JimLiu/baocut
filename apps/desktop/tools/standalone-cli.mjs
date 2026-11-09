// 独立命令行包（CLI 独立使用与发布 §9）：从同一次构建、已经签好名的 App 拼出来，不另编一遍。Worker、资源目录与 App 逐字节相同，
// `app.asar` 解开成 `app/`（只留 `out/main`、`node_modules` 与 `package.json`：没有 Electron，渲染进程与 preload 用不上），
// 换上随包的 Node（大版本与 App 里 Electron 自带的相同）与按独立包编的启动器，再写包内清单（protocol 的 `standalone-cli.ts`）。
//
// macOS：`BaoCut CLI.app`（`com.baocut.cli`，Node 是外壳的主程序）。先签启动器与 disclaim 助手，再签整个外壳（Node 带
// `build/entitlements.standalone-node.mac.plist`）；`Resources/bin` 里的程序沿用 App 里的签名，作为资源封进外壳。正式包随后公证、
// staple，再按 App 的做法 `ditto -c -k --keepParent` 归档、解开核对一遍；`--local` 用临时签名，不公证。
// Windows：`baocut.cmd`、`node.exe` 与 `resources\`，未签名（§14），用 `tar -a` 打成 zip。只在 Windows 上实际跑过检查之后才算数。
//
//   node apps/desktop/tools/standalone-cli.mjs --app <BaoCut.app 或 win-unpacked> --out <目录> [--node <node 可执行文件>]
//     [--app-code <apps/desktop/out>] [--version <x.y.z> --build <n>] [--variant cpu] [--local | --sign-sha1 <SHA-1> [--sign-keychain <钥匙串>]
//     [--notary-profile <名字>]] [--feed <appcast 文件> --download-base-url <https 地址>] [--no-check]
//
// `--app-code` 用本地刚编好的 `out/main` 替换 App 里的那份（本地演练：装好的 App 还没有独立包的代码）；`--version`/`--build` 只给演练用，
// 正式包照 App asar 里的 package.json（`baocutBuild` 等）。`--feed` 把 `cli` 条目写进已有的更新源，并用独立包与 App 两边的解析器读回。
// 退出码：0 成功，1 失败。
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, cpSync, createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { parseManifest } from '../src/main/app-update-rules.ts';
import { RESOURCE_DIRS, packagedResourceEnv, packagedResources } from '../src/main/packaged-resources.ts';
import { DISTRIBUTED_NOTICES } from '../../../tools/third-party-notices.ts';
import {
  PACKAGE_KIND_ENV,
  STANDALONE_APP_NAME,
  STANDALONE_BUNDLE_ID,
  STANDALONE_MANIFEST_FILE,
  STANDALONE_PACKAGE_KIND,
  STANDALONE_PRODUCT,
  parseStandaloneFeed,
  parseStandaloneManifest,
  standaloneArchiveName,
  standaloneLayout,
} from '../../../packages/protocol/src/standalone-cli.ts';
import { stageStandaloneCli } from './desktop-cli.mjs';
import { runMac } from './macos-distribution.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP = path.resolve(HERE, '..');
const ROOT = path.resolve(DESKTOP, '../..');
export const STANDALONE_ENTITLEMENTS = path.join(DESKTOP, 'build/entitlements.standalone-node.mac.plist');
const TARGET_BY_PLATFORM = { darwin: 'aarch64-apple-darwin', win32: 'x86_64-pc-windows-msvc' };
/** `app.asar` 里独立包不要的部分：没有 Electron，就没有渲染进程与 preload。 */
const DROPPED_APP_PARTS = [['out', 'renderer'], ['out', 'preload']];

const escapeXml = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** 外壳的 Info.plist：Node 是主程序，不在程序坞里出现（LSUIElement）；局域网说明与 App 相同（Runtime 会发现远端算力节点）。 */
export function standaloneInfoPlist({ version, build, minimumSystemVersion = '14.0' }) {
  const entries = [
    ['CFBundleDevelopmentRegion', 'en'],
    ['CFBundleDisplayName', STANDALONE_APP_NAME],
    ['CFBundleExecutable', 'node'],
    ['CFBundleIconFile', 'icon.icns'],
    ['CFBundleIdentifier', STANDALONE_BUNDLE_ID],
    ['CFBundleInfoDictionaryVersion', '6.0'],
    ['CFBundleName', STANDALONE_APP_NAME],
    ['CFBundlePackageType', 'APPL'],
    ['CFBundleShortVersionString', version],
    ['CFBundleVersion', String(build)],
    ['LSMinimumSystemVersion', minimumSystemVersion],
    ['LSUIElement', true],
    ['NSHumanReadableCopyright', `Copyright © ${new Date().getUTCFullYear()} BaoCut`],
    ['NSLocalNetworkUsageDescription', 'BaoCut discovers and connects to local compute devices for transcription and generation.'],
    ['NSBonjourServices', ['_baocut-node._tcp']],
  ];
  const value = (v) =>
    v === true ? '<true/>' : Array.isArray(v) ? `<array>${v.map((item) => `<string>${escapeXml(item)}</string>`).join('')}</array>` : `<string>${escapeXml(v)}</string>`;
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    ...entries.map(([key, v]) => `  <key>${key}</key>${value(v)}`),
    '</dict>',
    '</plist>',
    '',
  ].join('\n');
}

/** App 的资源目录（macOS `Contents/Resources`，Windows `resources`）。 */
export function appResources(app, platform) {
  return path.join(app, platform === 'darwin' ? 'Contents/Resources' : 'resources');
}

/** App 的版本、build、变体与源码提交：读 asar 里打包时写的 package.json（`baocutBuild` 等，app-update-ipc.ts 读的同一份）。 */
export async function appRelease(app, platform) {
  const { extractFile } = await import('@electron/asar');
  const pkg = JSON.parse(extractFile(path.join(appResources(app, platform), 'app.asar'), 'package.json').toString('utf8'));
  return { version: pkg.version, build: pkg.baocutBuild ?? 0, variant: pkg.baocutVariant ?? 'cpu', sourceCommit: pkg.baocutSourceCommit ?? null };
}

function copyTree(from, to, platform) {
  if (!existsSync(from)) throw new Error(`Missing ${from}`);
  mkdirSync(path.dirname(to), { recursive: true });
  // ditto keeps the embedded signatures and extended attributes of the signed Worker binaries exactly as they are.
  if (platform === 'darwin' && process.platform === 'darwin') runMac('ditto', [from, to]);
  else cpSync(from, to, { recursive: true, verbatimSymlinks: true });
}

/**
 * 在 `out` 下搭出包根（macOS 是 `BaoCut CLI.app` 所在的目录）。`app` 是已经构建好的 App；`launchers` 是 `stageStandaloneCli` 的结果。
 * 返回包根与清单。纯文件操作，签名另做。
 */
export async function stageStandalonePackage({ platform, app, out, node, launchers, version, build, variant = 'cpu', sourceCommit = null, appCode = null, nodeVersion }) {
  const layout = standaloneLayout(platform);
  if (!layout) throw new Error(`Unsupported standalone platform: ${platform}`);
  const at = (segments) => path.join(out, ...segments);
  const from = appResources(app, platform);
  const resources = at(layout.resources);
  mkdirSync(resources, { recursive: true });
  for (const dir of Object.values(RESOURCE_DIRS)) copyTree(path.join(from, dir), path.join(resources, dir), platform);
  // 声明从源码取（与 check-packaged-app.mjs 核对的同一份），不依赖 App 里那份是否齐全。
  for (const { source, fileName } of DISTRIBUTED_NOTICES) {
    mkdirSync(path.dirname(path.join(resources, fileName)), { recursive: true });
    copyFileSync(path.join(ROOT, source), path.join(resources, fileName));
  }
  const appDir = at(layout.app);
  const { extractAll } = await import('@electron/asar');
  extractAll(path.join(from, 'app.asar'), appDir);
  for (const part of DROPPED_APP_PARTS) rmSync(path.join(appDir, ...part), { recursive: true, force: true });
  if (appCode) {
    rmSync(path.join(appDir, 'out', 'main'), { recursive: true, force: true });
    cpSync(path.join(appCode, 'main'), path.join(appDir, 'out', 'main'), { recursive: true });
  }
  for (const entry of ['cli.js', 'runtime.js']) {
    if (!existsSync(path.join(appDir, 'out', 'main', entry))) throw new Error(`Missing out/main/${entry} in the app code`);
  }
  const manifest = { schema: 1, product: STANDALONE_PRODUCT, version, build, target: TARGET_BY_PLATFORM[platform], variant, sourceCommit, node: nodeVersion };
  const text = `${JSON.stringify(manifest, null, 2)}\n`;
  if (!parseStandaloneManifest(text)) throw new Error('Standalone manifest does not parse back');
  writeFileSync(path.join(appDir, STANDALONE_MANIFEST_FILE), text);
  mkdirSync(path.dirname(at(layout.node)), { recursive: true });
  copyFileSync(node, at(layout.node));
  chmodSync(at(layout.node), 0o755);
  copyFileSync(launchers.launcher, at(layout.launcher));
  chmodSync(at(layout.launcher), 0o755);
  if (layout.disclaim) {
    copyFileSync(launchers.disclaim, at(layout.disclaim));
    chmodSync(at(layout.disclaim), 0o755);
  }
  if (platform === 'darwin') {
    const contents = path.join(out, layout.top[0], 'Contents');
    writeFileSync(path.join(contents, 'Info.plist'), standaloneInfoPlist({ version, build }));
    writeFileSync(path.join(contents, 'PkgInfo'), 'APPL????');
    copyFileSync(path.join(from, 'icon.icns'), path.join(resources, 'icon.icns'));
    copyTree(path.join(DESKTOP, 'build/localizations'), resources, platform);
  }
  return { root: out, manifest };
}

/** 包里 Node 的版本；与 App 里 Electron 自带的 Node 大版本不同就不打（代码按那个 Node 构建与测试）。 */
export function nodeVersionOf(node) {
  const run = spawnSync(node, ['-p', 'process.versions.node'], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '' } });
  if (run.status !== 0) throw new Error(`Cannot run ${node}: ${run.stderr || run.error?.message}`);
  return run.stdout.trim();
}

export function electronNodeVersion(app, platform) {
  const executable = platform === 'darwin' ? path.join(app, 'Contents/MacOS/BaoCut') : path.join(app, 'BaoCut.exe');
  if ((platform === 'darwin') !== (process.platform === 'darwin') || (platform === 'win32') !== (process.platform === 'win32')) return null;
  const run = spawnSync(executable, ['-p', 'process.versions.node'], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '', ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true });
  if (run.status !== 0) throw new Error(`Cannot run ${executable} as Node: ${run.stderr || run.error?.message}`);
  return run.stdout.trim();
}

/** macOS 签名：先签启动器与 disclaim 助手，再签外壳（主程序 Node 带 JIT 权限）；`local` 用临时签名、不开 hardened runtime。 */
export function signStandaloneMac(root, { identity, keychain, local = false, entitlements = STANDALONE_ENTITLEMENTS }, run = runMac) {
  const layout = standaloneLayout('darwin');
  const bundle = path.join(root, layout.top[0]);
  const common = ['--force', '--sign', local ? '-' : identity, ...(keychain ? ['--keychain', keychain] : []), ...(local ? ['--timestamp=none'] : ['--options', 'runtime', '--timestamp'])];
  for (const segments of [layout.launcher, layout.disclaim]) run('codesign', [...common, path.join(root, ...segments)]);
  run('codesign', [...common, '--entitlements', entitlements, bundle]);
  run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', bundle]);
  return bundle;
}

/** 正式包：公证、staple，并让 Gatekeeper 评估一遍。 */
export function notarizeStandaloneMac(bundle, { output, profile, keychain }, run = runMac) {
  const submission = path.join(output, 'cli-notary-submission.zip');
  run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', bundle, submission]);
  const auth = ['--keychain-profile', profile, ...(keychain ? ['--keychain', keychain] : [])];
  const raw = run('xcrun', ['notarytool', 'submit', submission, ...auth, '--wait', '--output-format', 'json']);
  writeFileSync(path.join(output, 'cli-notary-result.json'), raw);
  const notary = JSON.parse(raw);
  run('xcrun', ['notarytool', 'log', notary.id, ...auth, path.join(output, 'cli-notary-log.json')]);
  if (notary.status !== 'Accepted') throw new Error(`Standalone CLI notarization ${notary.status}; see cli-notary-log.json`);
  run('xcrun', ['stapler', 'staple', bundle]);
  run('xcrun', ['stapler', 'validate', bundle]);
  run('spctl', ['--assess', '--type', 'execute', '--verbose=4', bundle]);
  rmSync(submission, { force: true });
  return notary.id;
}

export async function fileFacts(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return { file: path.basename(file), size: statSync(file).size, sha256: hash.digest('hex') };
}

/** 打成 zip（macOS 带外壳本身，Windows 是包根下的三项），并写 `.sha256`。 */
export async function archiveStandalone(root, { platform, output, manifest }, run = runMac) {
  const layout = standaloneLayout(platform);
  const zip = path.join(output, standaloneArchiveName(manifest));
  rmSync(zip, { force: true });
  if (platform === 'darwin') run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', path.join(root, layout.top[0]), zip]);
  else {
    const tar = spawnSync('tar', ['-a', '-c', '-f', zip, '-C', root, ...layout.top], { encoding: 'utf8' });
    if (tar.status !== 0) throw new Error(`tar failed: ${tar.stderr || tar.error?.message}`);
  }
  const facts = await fileFacts(zip);
  writeFileSync(`${zip}.sha256`, `${facts.sha256}  ${facts.file}\n`);
  return { format: 'zip', ...facts };
}

/** 解开的包真跑一遍：Runtime 的自检（不起 Runtime、不碰数据目录），再用 check-bundled-cli.mjs 离线跑 CLI。只在目标平台上做。 */
export function checkStandalone(root, platform) {
  const layout = standaloneLayout(platform);
  const resources = path.join(root, ...layout.resources);
  const home = mkdtempSync(path.join(os.tmpdir(), 'baocut-standalone-check-'));
  let report = null;
  try {
    const env = {
      PATH: process.env.PATH ?? '', HOME: home, USERPROFILE: home, BAOCUT_HOME: path.join(home, 'runtime'), TMPDIR: home,
      ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
      ...packagedResourceEnv(packagedResources(resources), platform), [PACKAGE_KIND_ENV]: STANDALONE_PACKAGE_KIND,
    };
    const self = spawnSync(path.join(root, ...layout.node), [path.join(root, ...layout.app, 'out/main/runtime.js'), '--self-check', '--probe'], {
      env, encoding: 'utf8', timeout: 180_000, windowsHide: true, maxBuffer: 16 * 1024 * 1024,
    });
    const last = self.stdout?.trim().split('\n').at(-1);
    try { report = last ? JSON.parse(last) : null; } catch { report = null; }
    if (!report || !Array.isArray(report.problems)) throw new Error(`Standalone self-check did not run (${self.status}): ${self.error?.message ?? ''}\n${self.stderr ?? ''}`);
    if (report.problems.length > 0) throw new Error(`Standalone self-check failed:\n- ${report.problems.join('\n- ')}`);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
  const bundled = path.join(root, ...(platform === 'darwin' ? layout.top : []));
  const cli = spawnSync(process.execPath, [path.join(HERE, 'check-bundled-cli.mjs'), bundled], { encoding: 'utf8', timeout: 180_000, windowsHide: true });
  if (cli.status !== 0) throw new Error(`Standalone CLI check failed: ${cli.stderr || cli.stdout}`);
  return { selfCheck: report, cli: JSON.parse(cli.stdout.trim().split('\n').at(-1)) };
}

/** 把 `cli` 条目加进已经写好的更新源，用两边的解析器读回：App 照旧认得出 `app`，独立包读得到 `cli`。 */
export function addStandaloneToFeed(text, { target, variant, entry }) {
  const feed = JSON.parse(text);
  const next = `${JSON.stringify({ ...feed, cli: entry }, null, 2)}\n`;
  const app = parseManifest(next, target, false, variant === 'cpu' ? null : variant);
  if (!app.ok) throw new Error(`App feed no longer parses with the cli entry: ${app.error} ${app.detail}`);
  const cli = parseStandaloneFeed(next, target, variant);
  if (!cli.ok) throw new Error(`Standalone feed entry does not parse: ${cli.error} ${cli.detail}`);
  return next;
}

/**
 * 出一个独立包：搭目录、签名（macOS）、公证（正式包）、归档、解开再核对一遍。返回归档的事实与清单，`verifiedRoot` 是解开核对过的那份。
 * `downloadBase` 给了时同时返回更新源里的 `cli` 条目。
 */
export async function buildStandaloneCli({
  platform, app, output, node = process.execPath, appCode = null, version, build, variant = 'cpu',
  local = false, signingSha1, keychain, profile, downloadBase = null, check = true,
}) {
  const layout = standaloneLayout(platform);
  if (!layout) throw new Error(`Unsupported standalone platform: ${platform}`);
  const own = await appRelease(app, platform);
  // 演练时可以覆盖版本与 build（同一个 App 出两个 build 来试更新）；正式包照 App 的。
  const release = { version: version ?? own.version, build: build ?? own.build };
  // build 0 是本机临时包（App 也不检查更新）：签名核对不了，`baocut update` 只在指定了更新源时放行。
  if (!release.version || !Number.isSafeInteger(release.build) || release.build < 0) throw new Error('Standalone package needs the App version and build');
  if (variant !== own.variant) throw new Error(`App is the ${own.variant} variant, not ${variant}`);
  const nodeVersion = nodeVersionOf(node);
  const electron = electronNodeVersion(app, platform);
  if (electron && electron.split('.')[0] !== nodeVersion.split('.')[0]) {
    throw new Error(`Bundled Node ${nodeVersion} is not the major version of the App's Electron Node ${electron}`);
  }
  const work = mkdtempSync(path.join(os.tmpdir(), 'baocut-standalone-'));
  try {
    const launchers = stageStandaloneCli(path.join(work, 'launchers'), platform);
    const staged = path.join(work, 'package');
    const { manifest } = await stageStandalonePackage({ platform, app, out: staged, node, launchers, ...release, variant, sourceCommit: appCode ? null : own.sourceCommit, appCode, nodeVersion });
    let notarySubmissionId = null;
    if (platform === 'darwin') {
      const bundle = signStandaloneMac(staged, { identity: signingSha1, keychain, local });
      if (!local) notarySubmissionId = notarizeStandaloneMac(bundle, { output, profile, keychain });
    }
    const archive = await archiveStandalone(staged, { platform, output, manifest });
    const verifiedRoot = path.join(output, 'cli-verified-extraction');
    rmSync(verifiedRoot, { recursive: true, force: true });
    mkdirSync(verifiedRoot, { recursive: true });
    if (platform === 'darwin') {
      runMac('ditto', ['-x', '-k', path.join(output, archive.file), verifiedRoot]);
      const bundle = path.join(verifiedRoot, layout.top[0]);
      runMac('codesign', ['--verify', '--deep', '--strict', '--verbose=2', bundle]);
      if (!local) {
        runMac('xcrun', ['stapler', 'validate', bundle]);
        runMac('spctl', ['--assess', '--type', 'execute', '--verbose=4', bundle]);
      }
    } else {
      const tar = spawnSync('tar', ['-x', '-f', path.join(output, archive.file), '-C', verifiedRoot], { encoding: 'utf8' });
      if (tar.status !== 0) throw new Error(`tar -x failed: ${tar.stderr || tar.error?.message}`);
    }
    const unpackedManifest = parseStandaloneManifest(readFileSync(path.join(verifiedRoot, ...layout.app, STANDALONE_MANIFEST_FILE), 'utf8'));
    if (!unpackedManifest || unpackedManifest.build !== manifest.build) throw new Error('Unpacked standalone package lost its manifest');
    const checked = check && process.platform === platform ? checkStandalone(verifiedRoot, platform) : null;
    const entry = downloadBase
      ? { format: 'zip', url: `${downloadBase.replace(/\/+$/, '')}/${encodeURIComponent(archive.file)}`, size: archive.size, sha256: archive.sha256 }
      : null;
    return {
      manifest, archive, entry, verifiedRoot, checked: Boolean(checked), notarySubmissionId,
      notarized: platform === 'darwin' && !local, signature: platform !== 'darwin' ? 'none' : local ? 'ad-hoc' : 'developer-id',
      unpackedBytes: treeBytes(verifiedRoot),
    };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

function treeBytes(dir) {
  const run = spawnSync('du', ['-sk', dir], { encoding: 'utf8' });
  return run.status === 0 ? Number(run.stdout.split(/\s+/)[0]) * 1024 : null;
}

async function main() {
  const { values: options } = parseArgs({
    options: {
      app: { type: 'string' },
      'app-code': { type: 'string' },
      node: { type: 'string' },
      out: { type: 'string' },
      version: { type: 'string' },
      build: { type: 'string' },
      variant: { type: 'string', default: 'cpu' },
      platform: { type: 'string', default: process.platform },
      local: { type: 'boolean', default: false },
      'sign-sha1': { type: 'string' },
      'sign-keychain': { type: 'string' },
      'notary-profile': { type: 'string', default: process.env.BAOCUT_NOTARY_PROFILE || 'baocut-notary' },
      feed: { type: 'string' },
      'download-base-url': { type: 'string' },
      'no-check': { type: 'boolean', default: false },
    },
  });
  if (!options.app || !options.out) throw new Error('Usage: standalone-cli.mjs --app <BaoCut.app | win-unpacked> --out <dir> [options]');
  const platform = options.platform;
  if (platform === 'darwin' && !options.local && !/^[A-F0-9]{40}$/.test(options['sign-sha1'] ?? '')) throw new Error('--sign-sha1 (full uppercase SHA-1) or --local is required on macOS');
  if (options.feed && !options['download-base-url']) throw new Error('--feed needs --download-base-url');
  if (options['download-base-url'] && !/^https:\/\/[^\s?#]+$/.test(options['download-base-url'])) throw new Error('--download-base-url must be https without a query');
  const output = path.resolve(options.out);
  mkdirSync(output, { recursive: true });
  const result = await buildStandaloneCli({
    platform, app: path.resolve(options.app), output, node: options.node ? path.resolve(options.node) : process.execPath,
    appCode: options['app-code'] ? path.resolve(options['app-code']) : null,
    version: options.version, build: options.build ? Number(options.build) : undefined, variant: options.variant,
    local: options.local, signingSha1: options['sign-sha1'], keychain: options['sign-keychain'], profile: options['notary-profile'],
    downloadBase: options['download-base-url'] ?? null, check: !options['no-check'],
  });
  if (options.feed && result.entry) {
    const target = TARGET_BY_PLATFORM[platform];
    writeFileSync(options.feed, addStandaloneToFeed(readFileSync(options.feed, 'utf8'), { target, variant: options.variant, entry: result.entry }));
  }
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
