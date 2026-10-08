import { BUILTIN_VOICES, TRANSCRIBE_SELF_TEST, builtinVoiceFile, resolveModelAssetsDir, selfTestSampleFile } from '@baocut/models/assets';

/**
 * 主进程产物的自检入口（`npm run check:model-assets`，`tools/check-model-assets.mjs`）：随 `out/main` 构建，应用自己不加载它。
 * 检查脚本用 Electron 自带的 Node（与 Runtime 同样经 `ELECTRON_RUN_AS_NODE`）运行这一份，它在 bundle 里调 Runtime 用的同一个
 * 解析函数，把模型数据目录和每个随应用分发的文件（自测样本、目录里的每只内置音色）解析到的路径写成一行 JSON；在不在由脚本核对。
 */
const files = [
  { asset: TRANSCRIBE_SELF_TEST.asset, file: selfTestSampleFile(TRANSCRIBE_SELF_TEST) },
  ...BUILTIN_VOICES.map((voice) => ({ asset: voice.asset, file: builtinVoiceFile(voice) })),
];
process.stdout.write(`${JSON.stringify({ dir: resolveModelAssetsDir(), files })}\n`);
