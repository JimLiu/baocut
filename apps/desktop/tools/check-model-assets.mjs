// 主进程产物的模型数据检查（`npm run check:model-assets`）：随应用分发、按路径读的模型数据（自测样本、内置音色的参考录音）
// 在构建出来的 `out/main` 里解析到的位置真有文件。规则见仓库约定 §2；检查依赖什么见开发流程 §2。
//
// 用 Electron 自带的 Node（`ELECTRON_RUN_AS_NODE`，与桌面端启动 Runtime 的方式一样）运行产物里的自检入口
// `out/main/model-assets-check.js`，它调 Runtime 用的同一个解析函数，打出一行 JSON；这里逐个核对文件。跑两遍：
// 1. 原地：开发时的构建（`npm run dev`、`npm start`）从仓库里找到 `packages/models/assets`；
// 2. 模拟打包：把 `out/main` 复制到仓库外的临时目录，模型数据复制到 `<临时>/resources/model-assets`，按主进程打包后的做法给出
//    `BAOCUT_MODEL_ASSETS_DIR`，要求每个文件都解析到那里；同一份副本不给环境变量时什么都不该找到（证明不是靠仓库兜住的）。
// 不启动 Runtime、不碰应用数据目录、不联网。退出码：0 通过，1 不通过，2 起不来。

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_MAIN = resolve(HERE, '../out/main');
const SOURCE_ASSETS = resolve(HERE, '../../../packages/models/assets');
const ENTRY = 'model-assets-check.js';
const TIMEOUT_MS = 30_000;

if (!existsSync(join(OUT_MAIN, ENTRY))) {
  console.error(`没有 ${join(OUT_MAIN, ENTRY)}：先运行 npm run build`);
  process.exit(2);
}
const { default: electron } = await import('electron');

/** 用 Electron 的 Node 跑一次自检入口；`assetsDir` 为 null 时不给 `BAOCUT_MODEL_ASSETS_DIR`。 */
function resolveIn(mainDir, assetsDir) {
  const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
  delete env.BAOCUT_MODEL_ASSETS_DIR;
  if (assetsDir) env.BAOCUT_MODEL_ASSETS_DIR = assetsDir;
  const run = spawnSync(electron, [join(mainDir, ENTRY)], { env, encoding: 'utf8', timeout: TIMEOUT_MS });
  if (run.error || run.status !== 0) {
    console.error(`自检入口没有跑起来（${run.error?.message ?? `退出码 ${run.status}`}）\n${run.stderr ?? ''}`);
    process.exit(2);
  }
  return JSON.parse(run.stdout.trim().split('\n').at(-1));
}

function isFile(file) {
  try {
    const stat = statSync(file);
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}

function inside(dir, file) {
  const rel = relative(dir, file);
  return rel !== '' && !rel.startsWith('..') && !rel.startsWith(sep);
}

const problems = [];
const report = [];

// 1. 原地。
const local = resolveIn(OUT_MAIN, null);
if (local.files.length < 2) problems.push(`原地：只解析出 ${local.files.length} 个文件，应有自测样本与内置音色`);
if (local.dir !== SOURCE_ASSETS) problems.push(`原地：模型数据目录是 ${local.dir}，应是仓库里的 ${SOURCE_ASSETS}`);
for (const { asset, file } of local.files) {
  if (!file || !isFile(file)) problems.push(`原地：${asset} 解析到 ${file ?? '（找不到目录）'}，那里没有文件`);
}
report.push(`原地：${local.files.length} 个文件都在 ${local.dir}`);

// 2. 模拟打包。
const temp = mkdtempSync(join(tmpdir(), 'baocut-model-assets-'));
try {
  const main = join(temp, 'app', 'out', 'main');
  const assets = join(temp, 'resources', 'model-assets');
  cpSync(OUT_MAIN, main, { recursive: true });
  cpSync(SOURCE_ASSETS, assets, { recursive: true });
  const packaged = resolveIn(main, assets);
  if (packaged.files.length !== local.files.length)
    problems.push(`模拟打包：解析出 ${packaged.files.length} 个文件，原地是 ${local.files.length} 个`);
  for (const { asset, file } of packaged.files) {
    if (!file || !inside(assets, file) || !isFile(file))
      problems.push(`模拟打包：${asset} 解析到 ${file ?? '（找不到目录）'}，不是 ${assets} 里的文件`);
  }
  report.push(`模拟打包：${packaged.files.length} 个文件都在 <resources>/model-assets`);
  const bare = resolveIn(main, null);
  if (bare.dir !== null) problems.push(`模拟打包：不给 BAOCUT_MODEL_ASSETS_DIR 时还找到了 ${bare.dir}（应该找不到）`);
} finally {
  rmSync(temp, { recursive: true, force: true });
}

if (problems.length > 0) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`模型数据检查通过：\n  ${report.join('\n  ')}`);
