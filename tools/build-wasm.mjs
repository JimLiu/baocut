// 把纯语义的 WASM 编出来放到用它的包里：
// - 编辑器预览（bindings/preview-wasm）进界面包，界面以 `?inline` 引入，开发服务器与打包后的 file:// 页面都不用另外取文件；
// - 界面与 Node 共用的编辑语义（bindings/editor-wasm：句子与指纹、舞台的框……）进 @baocut/editor-wasm，浏览器内联、Node 从文件读。
// 预览与导出共用随渲染内核发布的字体（crates/render-raster/assets/fonts）：原生构建编进二进制，WASM 不带，
// 拷到界面包里由界面读了注入（字体有二十多 MB，不内联）。
// 有 binaryen 的 wasm-opt 就再压一遍；没有也能用，只是大一些。
// 用 rustup 的机器上缺 wasm32-unknown-unknown 目标时先补装。

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureCargo } from './cargo-path.mjs';

ensureCargo();

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outputs = [
  { crate: 'preview-wasm', file: 'preview_wasm.wasm', output: 'packages/ui/src/render/generated/preview.wasm', label: '预览 WASM' },
  { crate: 'editor-wasm', file: 'editor_wasm.wasm', output: 'packages/editor-wasm/src/generated/editor.wasm', label: '编辑语义 WASM' },
];

// 打开 WASM 的 SIMD（tiny-skia 的 f32x4 等走 simd128）：预览逐帧光栅化快好几倍。Chromium、Electron 与 Node 都支持。
// 只作用于 wasm32 目标，宿主上的构建脚本与过程宏不受影响。
const env = { ...process.env, CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUSTFLAGS: '-C target-feature=+simd128' };

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', env });
  if (result.error) throw result.error;
  return result.status === 0;
}

// 按仓库目录下生效的工具链查；没有 rustup（例如系统包管理器装的 Rust）时跳过，缺目标由下面的构建报出来。
const targets = spawnSync('rustup', ['target', 'list', '--installed'], { cwd: root, encoding: 'utf8' });
if (targets.status === 0 && !targets.stdout.split(/\r?\n/).includes('wasm32-unknown-unknown')) {
  console.log('> rustup target add wasm32-unknown-unknown');
  if (!run('rustup', ['target', 'add', 'wasm32-unknown-unknown'])) process.exit(1);
}

const cargo = ['build', ...outputs.flatMap(({ crate }) => ['-p', crate]), '--target', 'wasm32-unknown-unknown', '--profile', 'wasm'];
if (!run('cargo', cargo)) {
  console.error('WASM 没有编出来。缺目标的话先运行：rustup target add wasm32-unknown-unknown');
  process.exit(1);
}

// target 目录可能被 .cargo/config.local.toml 挪到别处，向 cargo 要真实位置。
const metadata = spawnSync('cargo', ['metadata', '--format-version', '1', '--no-deps'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
if (metadata.status !== 0) {
  console.error(metadata.stderr);
  process.exit(1);
}
const builtDir = join(JSON.parse(metadata.stdout).target_directory, 'wasm32-unknown-unknown/wasm');

const features = [
  '--enable-bulk-memory',
  '--enable-nontrapping-float-to-int',
  '--enable-sign-ext',
  '--enable-mutable-globals',
  '--enable-simd',
];
let warned = false;
for (const { file, output: relative, label } of outputs) {
  const built = join(builtDir, file);
  const output = join(root, relative);
  mkdirSync(dirname(output), { recursive: true });
  const optimized = spawnSync('wasm-opt', ['-Oz', ...features, built, '-o', output], { cwd: root, stdio: 'inherit' });
  if (optimized.error || optimized.status !== 0) {
    if (optimized.error && !warned) console.warn('没有找到 wasm-opt，直接使用 cargo 的输出');
    warned = true;
    copyFileSync(built, output);
  }
  console.log(`${label}：${output}（${Math.round(statSync(output).size / 1024)} KB）`);
}

const fontSource = join(root, 'crates/render-raster/assets/fonts');
const fontOutput = join(root, 'packages/ui/src/render/generated/fonts');
rmSync(fontOutput, { recursive: true, force: true });
mkdirSync(fontOutput, { recursive: true });
let fontBytes = 0;
const fonts = readdirSync(fontSource).filter((name) => name.endsWith('.ttf'));
for (const name of fonts) {
  copyFileSync(join(fontSource, name), join(fontOutput, name));
  fontBytes += statSync(join(fontOutput, name)).size;
}
console.log(`预览字体：${fontOutput}（${fonts.length} 份，${Math.round(fontBytes / 2 ** 20)} MB）`);
