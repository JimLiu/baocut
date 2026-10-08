import type { ModelsBundleRegistryMessages } from './bundle-registry.ts';

export const zhHans: ModelsBundleRegistryMessages = {
  speakerDiarizationLabel: '说话人区分',
  qwen3AsrLicense: '上游 Qwen3-ASR 模型卡标 Apache-2.0，可商用；MLX 量化包沿用同一许可',
  qwen3AlignerLicense: '上游 Qwen3-ForcedAligner 模型卡标 Apache-2.0，可商用；MLX 量化包沿用同一许可',
  wespeakerLicense: '可商用但须署名。署名：说话人嵌入模型 wespeaker-voxceleb-resnet34-LM 出自 WeSpeaker（wenet-e2e/wespeaker；Wang 等，ICASSP 2023），在 VoxCeleb 上训练，由 pyannote.audio（Bredin，Interspeech 2023）封装发布，许可 CC-BY-4.0；这里用的是它的 MLX 格式转换（aufklarer/WeSpeaker-ResNet34-LM-MLX）',
  pyannoteLicense: '上游 pyannote/segmentation-3.0 标 MIT，可商用；声纹模型 WeSpeaker 另标 CC-BY-4.0（须署名 WeSpeaker 与 pyannote.audio）',
  whisperV3CoremlLicense: '上游 openai/whisper-large-v3 模型卡标 Apache-2.0，可商用；WhisperKit 的 CoreML 转换仓库标 MIT',
  whisperTurboCoremlLicense: '上游 openai/whisper-large-v3-turbo 模型卡标 MIT，可商用；CoreML 转换包同为 MIT',
  whisperV3MlxLicense: '上游 openai/whisper-large-v3 模型卡标 Apache-2.0，可商用；mlx-community 的 MLX 转换仓库同为 Apache-2.0',
  whisperTurboMlxLicense: '上游 openai/whisper-large-v3-turbo 模型卡标 MIT，可商用；mlx-community 的 MLX 转换仓库标 Apache-2.0',
  htdemucsLicense: '上游 facebookresearch/demucs（代码与权重）MIT，可商用；MLX 转换包的模型卡未标许可',
  whisperV3GgmlLicense: '上游 openai/whisper-large-v3 模型卡标 Apache-2.0，可商用；whisper.cpp 的 GGML 转换仓库标 MIT',
  whisperTurboGgmlLicense: '上游 openai/whisper-large-v3-turbo 模型卡标 MIT，可商用；GGML 转换包同为 MIT',
  mossLicense: '上游模型卡标 Apache-2.0，可商用',
};
