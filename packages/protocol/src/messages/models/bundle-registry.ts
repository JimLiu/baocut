import { defineCatalog } from '../../message-ref.ts';
import { zhHans } from './bundle-registry.zh-Hans.ts';
import { zhHant } from './bundle-registry.zh-Hant.ts';
import { ja } from './bundle-registry.ja.ts';
import { ko } from './bundle-registry.ko.ts';
import { es } from './bundle-registry.es.ts';
import { fr } from './bundle-registry.fr.ts';
import { de } from './bundle-registry.de.ts';
import { nl } from './bundle-registry.nl.ts';
import { ptBR } from './bundle-registry.pt-BR.ts';
import { it } from './bundle-registry.it.ts';
import { ru } from './bundle-registry.ru.ts';
import { pl } from './bundle-registry.pl.ts';
import { tr } from './bundle-registry.tr.ts';
import { vi } from './bundle-registry.vi.ts';

/** `packages/models/src/bundle-registry.ts` 给人看的文字：模型包名字与许可摘要（模型名、许可证名、仓库名不翻译）。 */
const en = {
  speakerDiarizationLabel: 'Speaker diarization',
  qwen3AsrLicense: 'The upstream Qwen3-ASR model card says Apache-2.0, commercial use allowed; the MLX quantized bundle keeps the same license',
  qwen3AlignerLicense: 'The upstream Qwen3-ForcedAligner model card says Apache-2.0, commercial use allowed; the MLX quantized bundle keeps the same license',
  wespeakerLicense: 'Commercial use allowed with attribution. Attribution: the speaker embedding model wespeaker-voxceleb-resnet34-LM comes from WeSpeaker (wenet-e2e/wespeaker; Wang et al., ICASSP 2023), trained on VoxCeleb and released in pyannote.audio (Bredin, Interspeech 2023) under CC-BY-4.0; this is its MLX conversion (aufklarer/WeSpeaker-ResNet34-LM-MLX)',
  pyannoteLicense: 'Upstream pyannote/segmentation-3.0 says MIT, commercial use allowed; the voiceprint model WeSpeaker is separately CC-BY-4.0 (credit WeSpeaker and pyannote.audio)',
  whisperV3CoremlLicense: 'The upstream openai/whisper-large-v3 model card says Apache-2.0, commercial use allowed; the WhisperKit Core ML conversion repository says MIT',
  whisperTurboCoremlLicense: 'The upstream openai/whisper-large-v3-turbo model card says MIT, commercial use allowed; the Core ML conversion is also MIT',
  whisperV3MlxLicense: 'The upstream openai/whisper-large-v3 model card says Apache-2.0, commercial use allowed; the mlx-community MLX conversion repository is also Apache-2.0',
  whisperTurboMlxLicense: 'The upstream openai/whisper-large-v3-turbo model card says MIT, commercial use allowed; the mlx-community MLX conversion repository says Apache-2.0',
  htdemucsLicense: 'Upstream facebookresearch/demucs (code and weights) is MIT, commercial use allowed; the MLX conversion model card does not state a license',
  whisperV3GgmlLicense: 'The upstream openai/whisper-large-v3 model card says Apache-2.0, commercial use allowed; the whisper.cpp GGML conversion repository says MIT',
  whisperTurboGgmlLicense: 'The upstream openai/whisper-large-v3-turbo model card says MIT, commercial use allowed; the GGML conversion is also MIT',
  mossLicense: 'The upstream model card says Apache-2.0, commercial use allowed',
};

export type ModelsBundleRegistryMessages = typeof en;

export const ModelsBundleRegistry = defineCatalog('modelsBundleRegistry', en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
