import type { ModelsSpeechBundlesMessages } from './speech-bundles.ts';

export const zhHans: ModelsSpeechBundlesMessages = {
  qwen3TtsLicense: '上游 Qwen3-TTS 模型卡标 Apache-2.0，可商用；MLX 转换包沿用同一许可',
  indexTts2License: '可商用，但上月月活超 1 亿或上年营收超 10 亿元人民币的主体须另向 bilibili 申请；分发须附协议原文；不得用它改进 IndexTTS 以外的商用模型',
  indexTts25License: '可商用，但上月月活超 1 亿或上年营收超 10 亿元人民币的主体须另向 bilibili 申请；分发须附协议原文；辅助权重来自 IndexTTS2，同一协议',
  gptSovitsLicense: '上游 lj1995/GPT-SoVITS 模型卡标 MIT，可商用；safetensors 转换包沿用同一许可',
  voxcpm2License: '上游 openbmb/VoxCPM2 模型卡标 Apache-2.0，可商用；MLX int8 转换包沿用同一许可',
  omnivoiceLicense: '代码 Apache-2.0，但预训练权重因训练数据（Emilia 等）以 CC-BY-NC 发布，只许非商业用途；MLX int8 转换包是它的派生物，受同一许可',
};
