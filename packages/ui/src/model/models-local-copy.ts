import { defineMessages, type ModelBundleReason, type ModelBundleStatus } from '@baocut/protocol';
import { zhHans } from './models-local-copy.zh-Hans.ts';
import { zhHant } from './models-local-copy.zh-Hant.ts';
import { ja } from './models-local-copy.ja.ts';
import { ko } from './models-local-copy.ko.ts';
import { es } from './models-local-copy.es.ts';
import { fr } from './models-local-copy.fr.ts';
import { de } from './models-local-copy.de.ts';
import { nl } from './models-local-copy.nl.ts';
import { ptBR } from './models-local-copy.pt-BR.ts';
import { it } from './models-local-copy.it.ts';
import { ru } from './models-local-copy.ru.ts';
import { pl } from './models-local-copy.pl.ts';
import { tr } from './models-local-copy.tr.ts';
import { vi } from './models-local-copy.vi.ts';

/** 模型 › 本地模型的文案（英文是键与类型的来源，译文在 `models-local-copy.<语言>.ts`）。 */
const en = {
  /** 模型包不可用或文件不对的原因（行上的标签）。 */
  reason: {
    unsupported: 'Not supported on this computer',
    resource: 'Turned off',
    'worker-missing': 'Model Worker missing',
    'missing-manifest': 'Manifest missing',
    'missing-file': 'Files missing',
    'size-mismatch': 'File size mismatch',
    'hash-mismatch': 'Checksum mismatch',
    incomplete: 'Components missing',
    'load-failed': "Couldn't load",
    relocating: 'Moving',
  } as Record<ModelBundleReason, string>,
  chipDefault: 'Default',
  chipLoading: 'Loading',
  chipReady: 'Loaded',
  chipBusy: 'Running',
  chipUnloading: 'Unloading',
  chipUnavailable: 'Unavailable',
  /** 装好了、还缺的可选组件（行上的标签）。 */
  chipMissing: (names: string[]) => `Missing ${names.join(', ')}`,
  /** 模型包的用途。 */
  capability: {
    transcribe: 'Transcribe',
    align: 'Align',
    synthesize: 'Synthesize',
    image: 'Image',
    separate: 'Separate',
    diarize: 'Speaker diarization',
  } as Record<ModelBundleStatus['capability'], string>,
  /** 默认菜单里「不设默认，用出厂默认」那一项。 */
  auto: 'Automatic',
  /** 存着的默认指向一只没装的模型包。 */
  notInstalled: (name: string) => `${name} (not installed)`,
  /** 带自己许可的组件给人看的名字；没列的用组件名。 */
  componentName: { aligner: 'Forced aligner', speaker: 'Speaker embedding', vad: 'VAD (voice activity detection)' } as Record<string, string>,
  weights: 'Model weights',
};

export type ModelsLocalMessages = typeof en;

export const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
