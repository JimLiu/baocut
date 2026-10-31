import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { configDefaults, defineConfig } from 'vitest/config';
import macros from 'unplugin-parcel-macros';

// designs/ 下是原型自己的测试，不在这里跑。
const include = ['packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.ts', 'tools/*.test.ts'];

// 起 Runtime 或 Electron 离屏宿主的测试文件：每个会再拉起 engine-host、模型 worker、ffmpeg 与 Electron，
// 四个一起跑就把机器压满，Runtime 的启动与关闭、导出请求、别的文件里按时间判定的测试都会超时。
// 按源码认出它们，放进 `process` 项目，等其余测试跑完后低并发地跑。
const PROCESS_HEAVY = /\bstartRuntime\(|\bCompositionHost\b/;
const root = path.dirname(fileURLToPath(import.meta.url));
const processHeavy = fs
  .globSync(include, { cwd: root })
  .filter((file) => PROCESS_HEAVY.test(fs.readFileSync(path.join(root, file), 'utf8')))
  .map((file) => file.split(path.sep).join('/'));
const cores = os.availableParallelism();

export default defineConfig({
  // Component regressions must exercise the same S2 style macro as both clients.
  plugins: [macros.vite()],
  // 与两个客户端相同：PDF 资源按静态字节导入，不作为 JS 或原生 WASM 执行。
  assetsInclude: ['**/*.bcmap', '**/*.pfb', '**/*.wasm'],
  test: {
    // S2 components import CSS, which Node cannot load as an external module.
    server: { deps: { inline: ['@react-spectrum/s2', '@react-spectrum/ai'] } },
    environment: 'node',
    setupFiles: ['tools/vitest-storage.setup.ts'],
    // CLI 的离线目录快照（apps/cli/src/generated/catalog.json，不进 git）：测试前按当前的工具目录写一份。
    globalSetup: ['tools/catalog-snapshot.setup.ts'],
    testTimeout: 15_000,
    // 没有设置下载目录时流程落到主机的 Downloads：测试一律指到每次运行新建的临时目录。
    // 按需下载字体（§9.1）默认不碰网络：没注入字体目录的 Runtime 没有可下载的族。
    env: {
      BAOCUT_DOWNLOADS_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'baocut-test-downloads-')),
      BAOCUT_FONT_DOWNLOADS: 'off',
      // 断言按简体中文的文案写：测试进程与它拉起的 Runtime 都钉在简体中文（@baocut/protocol i18n）。要测英文的用 vi.stubEnv 换掉。
      BAOCUT_LOCALE: 'zh-Hans',
    },
    projects: [
      {
        extends: true,
        test: { name: 'unit', include, exclude: [...configDefaults.exclude, ...processHeavy], maxWorkers: Math.min(4, cores) },
      },
      {
        extends: true,
        test: {
          name: 'process',
          include: processHeavy,
          maxWorkers: Math.min(2, cores),
          // Runtime 的启动与关闭（beforeEach / afterEach）在负载下要十几秒。
          hookTimeout: 60_000,
          sequence: { groupOrder: 1 },
        },
      },
    ],
  },
});
