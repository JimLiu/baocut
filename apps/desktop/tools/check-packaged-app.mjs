// 打包产物的自检：用应用自己的可执行文件以 Node 方式（`ELECTRON_RUN_AS_NODE`，与主进程启动 Runtime 的方式一样）运行 asar 里的
// `out/main/runtime.js --self-check --probe`，环境变量按主进程的做法（`src/main/packaged-resources.ts`）给出。Runtime 用它找东西的同一批
// 解析函数报告每个 Worker、凭据助手、内置模板与 skill、模型数据、Web 客户端与 editor.wasm 解析到哪里，并把每个原生程序起一次、走一遍
// 握手（缺 DLL、架构不对在这里暴露）；代码包的离屏宿主也起一次（应用的可执行文件带 `--composition-host`，走主进程入口的宿主分支）。
// 只能在包的目标平台上跑（CI 的 Windows runner）。
//
//   node apps/desktop/tools/check-packaged-app.mjs <应用目录>   应用目录是 BaoCut.exe 所在的目录（win-unpacked 或安装目录）
//   node apps/desktop/tools/check-packaged-app.mjs --dev        对开发构建（out/main，用 node_modules 里的 Electron）跑一遍，不给资源目录
//
// 不启动 Runtime、不碰应用数据目录、不联网。退出码：0 通过，1 不通过，2 起不来。

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { packagedResourceEnv, packagedResources } from '../src/main/packaged-resources.ts';
import { DISTRIBUTED_NOTICES } from '../../../tools/third-party-notices.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TIMEOUT_MS = 120_000;

const arg = process.argv[2];
if (!arg) {
  console.error('用法：check-packaged-app.mjs <应用目录> | --dev');
  process.exit(2);
}

const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
// 别让外面的覆盖顶掉要检查的解析。
for (const name of [
  'BAOCUT_ENGINE_HOST',
  'BAOCUT_MODEL_WORKER',
  'BAOCUT_EXPORT_WORKER',
  'BAOCUT_SPEECH_WORKER',
  'BAOCUT_CREDENTIAL_HELPER',
  'BAOCUT_BIN_DIR',
  'BAOCUT_TEMPLATES_DIR',
  'BAOCUT_SKILLS_DIR',
  'BAOCUT_AGENT_SKILLS_DIR',
  'BAOCUT_MODEL_ASSETS_DIR',
  'BAOCUT_WEB_DIST',
  'BAOCUT_ELECTRON',
]) {
  delete env[name];
}

let command;
let script;
if (arg === '--dev') {
  command = (await import('electron')).default;
  script = path.resolve(HERE, '../out/main/runtime.js');
} else {
  const appDir = path.resolve(arg);
  command = path.join(appDir, process.platform === 'win32' ? 'BaoCut.exe' : 'BaoCut');
  const resources = path.join(appDir, 'resources');
  for (const { source, fileName } of DISTRIBUTED_NOTICES) {
    const file = path.join(resources, fileName);
    if (!existsSync(file) || !readFileSync(file).equals(readFileSync(path.resolve(HERE, '../../..', source)))) {
      console.error(`第三方声明缺失或与源码不一致：resources/${fileName}`);
      process.exit(1);
    }
  }
  script = path.join(resources, 'app.asar', 'out', 'main', 'runtime.js');
  Object.assign(env, packagedResourceEnv(packagedResources(resources)));
}
if (!existsSync(command)) {
  console.error(`没有 ${command}`);
  process.exit(2);
}

const run = spawnSync(command, [script, '--self-check', '--probe'], { env, encoding: 'utf8', timeout: TIMEOUT_MS, windowsHide: true });
if (run.error || run.stdout.trim() === '') {
  console.error(`自检没有跑起来（${run.error?.message ?? `退出码 ${run.status}`}）\n${run.stderr ?? ''}`);
  process.exit(2);
}
const report = JSON.parse(run.stdout.trim().split('\n').at(-1));
console.log(JSON.stringify(report, null, 2));
if (report.problems.length > 0) {
  console.error(`不通过：\n- ${report.problems.join('\n- ')}`);
  process.exit(1);
}
console.log('通过');
