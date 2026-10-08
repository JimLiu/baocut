import { defineCatalog } from '../../message-ref.ts';
import { zhHans } from './speech-bundles.zh-Hans.ts';
import { zhHant } from './speech-bundles.zh-Hant.ts';
import { ja } from './speech-bundles.ja.ts';
import { ko } from './speech-bundles.ko.ts';
import { es } from './speech-bundles.es.ts';
import { fr } from './speech-bundles.fr.ts';
import { de } from './speech-bundles.de.ts';
import { nl } from './speech-bundles.nl.ts';
import { ptBR } from './speech-bundles.pt-BR.ts';
import { it } from './speech-bundles.it.ts';
import { ru } from './speech-bundles.ru.ts';
import { pl } from './speech-bundles.pl.ts';
import { tr } from './speech-bundles.tr.ts';
import { vi } from './speech-bundles.vi.ts';

/** `packages/models/src/speech-bundles.ts` 给人看的文字：语音合成模型包的许可摘要（模型名、许可证名、厂商名不翻译）。 */
const en = {
  qwen3TtsLicense: 'The upstream Qwen3-TTS model card says Apache-2.0, commercial use allowed; the MLX conversion keeps the same license',
  indexTts2License: 'Commercial use allowed, but entities with more than 100 million monthly active users last month or more than 1 billion RMB in revenue last year must apply to bilibili separately; redistribution must include the full agreement; it may not be used to improve commercial models other than IndexTTS',
  indexTts25License: 'Commercial use allowed, but entities with more than 100 million monthly active users last month or more than 1 billion RMB in revenue last year must apply to bilibili separately; redistribution must include the full agreement; the auxiliary weights come from IndexTTS2 under the same agreement',
  gptSovitsLicense: 'The upstream lj1995/GPT-SoVITS model card says MIT, commercial use allowed; the safetensors conversion keeps the same license',
  voxcpm2License: 'The upstream openbmb/VoxCPM2 model card says Apache-2.0, commercial use allowed; the MLX int8 conversion keeps the same license',
  omnivoiceLicense: 'The code is Apache-2.0, but the pretrained weights are released under CC-BY-NC because of their training data (Emilia and others), so non-commercial use only; the MLX int8 conversion is a derivative and falls under the same license',
};

export type ModelsSpeechBundlesMessages = typeof en;

export const ModelsSpeechBundles = defineCatalog('modelsSpeechBundles', en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
