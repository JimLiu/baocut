/**
 * 随应用分发、按路径读的模型数据的窄入口（`@baocut/models/assets`）：解析函数、自测样本与内置音色目录，不带模型包的其余模块。
 * 桌面端构建产物的检查入口（`apps/desktop/src/main/model-assets-check.ts`）只引这一处，免得把整个模型包挪进共享 chunk。
 */
export { MODEL_ASSETS_ENV, modelAssetPath, resolveModelAssetsDir } from './model-assets.ts';
export { TRANSCRIBE_SELF_TEST, selfTestSampleFile, type SelfTestSample } from './self-test-sample.ts';
export { BUILTIN_VOICES, builtinVoiceFile, type BuiltinVoice } from './speech-voices.ts';
