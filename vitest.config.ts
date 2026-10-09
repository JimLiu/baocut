import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // 与两个客户端相同：PDF 资源按静态字节导入，不作为 JS 或原生 WASM 执行。
  assetsInclude: ['**/*.bcmap', '**/*.pfb', '**/*.wasm'],
  test: {
    // designs/ 下是原型自己的测试，不在这里跑。
    include: ['packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.ts', 'tools/*.test.ts'],
    environment: 'node',
    setupFiles: ['tools/vitest-storage.setup.ts'],
    // Runtime tests also spawn native workers, ffmpeg and Electron processes.
    maxWorkers: Math.min(4, os.availableParallelism()),
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
  },
});
