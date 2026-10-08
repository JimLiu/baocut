import type { ModelsBundleRegistryMessages } from './bundle-registry.ts';

export const ja: ModelsBundleRegistryMessages = {
  speakerDiarizationLabel: '話者分離',
  qwen3AsrLicense:
    '上流の Qwen3-ASR のモデルカードには Apache-2.0 と記載されており、商用利用が可能です。MLX 量子化バンドルも同じライセンスを引き継いでいます',
  qwen3AlignerLicense:
    '上流の Qwen3-ForcedAligner のモデルカードには Apache-2.0 と記載されており、商用利用が可能です。MLX 量子化バンドルも同じライセンスを引き継いでいます',
  wespeakerLicense:
    'クレジット表記を条件に商用利用が可能です。クレジット：話者埋め込みモデル wespeaker-voxceleb-resnet34-LM は WeSpeaker（wenet-e2e/wespeaker、Wang ほか、ICASSP 2023）によるもので、VoxCeleb で学習され、pyannote.audio（Bredin、Interspeech 2023）で CC-BY-4.0 のもと公開されています。これはその MLX 変換版（aufklarer/WeSpeaker-ResNet34-LM-MLX）です',
  pyannoteLicense:
    '上流の pyannote/segmentation-3.0 には MIT と記載されており、商用利用が可能です。声紋モデル WeSpeaker は別途 CC-BY-4.0 です（WeSpeaker と pyannote.audio のクレジット表記が必要）',
  whisperV3CoremlLicense:
    '上流の openai/whisper-large-v3 のモデルカードには Apache-2.0 と記載されており、商用利用が可能です。WhisperKit の Core ML 変換リポジトリには MIT と記載されています',
  whisperTurboCoremlLicense:
    '上流の openai/whisper-large-v3-turbo のモデルカードには MIT と記載されており、商用利用が可能です。Core ML 変換版も MIT です',
  whisperV3MlxLicense:
    '上流の openai/whisper-large-v3 のモデルカードには Apache-2.0 と記載されており、商用利用が可能です。mlx-community の MLX 変換リポジトリも Apache-2.0 です',
  whisperTurboMlxLicense:
    '上流の openai/whisper-large-v3-turbo のモデルカードには MIT と記載されており、商用利用が可能です。mlx-community の MLX 変換リポジトリには Apache-2.0 と記載されています',
  htdemucsLicense:
    '上流の facebookresearch/demucs（コードと重み）は MIT で、商用利用が可能です。MLX 変換版のモデルカードにはライセンスの記載がありません',
  whisperV3GgmlLicense:
    '上流の openai/whisper-large-v3 のモデルカードには Apache-2.0 と記載されており、商用利用が可能です。whisper.cpp の GGML 変換リポジトリには MIT と記載されています',
  whisperTurboGgmlLicense:
    '上流の openai/whisper-large-v3-turbo のモデルカードには MIT と記載されており、商用利用が可能です。GGML 変換版も MIT です',
  mossLicense: '上流のモデルカードには Apache-2.0 と記載されており、商用利用が可能です',
};
