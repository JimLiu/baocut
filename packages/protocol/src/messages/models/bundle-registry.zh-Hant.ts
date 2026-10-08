import type { ModelsBundleRegistryMessages } from './bundle-registry.ts';

export const zhHant: ModelsBundleRegistryMessages = {
  speakerDiarizationLabel: '說話者區分',
  qwen3AsrLicense: '上游 Qwen3-ASR 模型卡標示 Apache-2.0，可商用；MLX 量化包沿用相同授權',
  qwen3AlignerLicense: '上游 Qwen3-ForcedAligner 模型卡標示 Apache-2.0，可商用；MLX 量化包沿用相同授權',
  wespeakerLicense: '可商用，但須標示出處。出處：說話者嵌入模型 wespeaker-voxceleb-resnet34-LM 來自 WeSpeaker（wenet-e2e/wespeaker；Wang 等人，ICASSP 2023），以 VoxCeleb 訓練，並由 pyannote.audio（Bredin，Interspeech 2023）以 CC-BY-4.0 授權發布；這裡使用的是它的 MLX 格式轉換（aufklarer/WeSpeaker-ResNet34-LM-MLX）',
  pyannoteLicense: '上游 pyannote/segmentation-3.0 標示 MIT，可商用；聲紋模型 WeSpeaker 另標示 CC-BY-4.0（須標示 WeSpeaker 與 pyannote.audio 的出處）',
  whisperV3CoremlLicense: '上游 openai/whisper-large-v3 模型卡標示 Apache-2.0，可商用；WhisperKit 的 Core ML 轉換儲存庫標示 MIT',
  whisperTurboCoremlLicense: '上游 openai/whisper-large-v3-turbo 模型卡標示 MIT，可商用；Core ML 轉換同樣是 MIT',
  whisperV3MlxLicense: '上游 openai/whisper-large-v3 模型卡標示 Apache-2.0，可商用；mlx-community 的 MLX 轉換儲存庫同樣是 Apache-2.0',
  whisperTurboMlxLicense: '上游 openai/whisper-large-v3-turbo 模型卡標示 MIT，可商用；mlx-community 的 MLX 轉換儲存庫標示 Apache-2.0',
  htdemucsLicense: '上游 facebookresearch/demucs（程式碼與權重）為 MIT，可商用；MLX 轉換的模型卡未標示授權',
  whisperV3GgmlLicense: '上游 openai/whisper-large-v3 模型卡標示 Apache-2.0，可商用；whisper.cpp 的 GGML 轉換儲存庫標示 MIT',
  whisperTurboGgmlLicense: '上游 openai/whisper-large-v3-turbo 模型卡標示 MIT，可商用；GGML 轉換同樣是 MIT',
  mossLicense: '上游模型卡標示 Apache-2.0，可商用',
};
