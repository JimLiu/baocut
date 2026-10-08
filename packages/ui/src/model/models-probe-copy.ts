import { defineMessages } from '@baocut/protocol';
import { zhHans } from './models-probe-copy.zh-Hans.ts';
import { zhHant } from './models-probe-copy.zh-Hant.ts';
import { ja } from './models-probe-copy.ja.ts';
import { ko } from './models-probe-copy.ko.ts';
import { es } from './models-probe-copy.es.ts';
import { fr } from './models-probe-copy.fr.ts';
import { de } from './models-probe-copy.de.ts';
import { nl } from './models-probe-copy.nl.ts';
import { ptBR } from './models-probe-copy.pt-BR.ts';
import { it } from './models-probe-copy.it.ts';
import { ru } from './models-probe-copy.ru.ts';
import { pl } from './models-probe-copy.pl.ts';
import { tr } from './models-probe-copy.tr.ts';
import { vi } from './models-probe-copy.vi.ts';

/** 云端模型测试对话框的文案（英文是键与类型的来源，译文在 `models-probe-copy.<语言>.ts`）。数字都已格式化。 */

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const en = {
  /** 测试合成念的一句（显示在对话框里，也发给模型念）。 */
  speechText: 'Hello, this is a BaoCut speech synthesis test.',
  noResult: 'The task finished, but no result came back.',
  failed: 'The task failed.',
  cancelled: 'The task was cancelled.',
  interrupted: "The Runtime restarted, so this test didn't finish.",
  unknownOutcome: "The Runtime restarted before this call got a response, so the result is unknown.",
  /** 结果的一行事实：秒数已保留一位小数。 */
  audioFacts: (seconds: string, khz: number, type: string) => `${seconds} s · ${khz} kHz · ${type}`,
  videoFacts: (width: number, height: number, seconds: string, type: string) => `${width} × ${height} · ${seconds} s · ${type}`,
  textFacts: (entries: number, seconds: string, type: string) => `${plural(entries, 'entry', 'entries')} · ${seconds} s · ${type}`,
  packageFacts: (files: number, type: string) => `${plural(files, 'file', 'files')} · ${type}`,
  projectFacts: (clips: number, seconds: string, type: string) => `${plural(clips, 'clip', 'clips')} · ${seconds} s · ${type}`,
  /** 文本结果：多少字、多少 token（已按当前语言分组）。 */
  chars: (count: string) => `${count} characters`,
  inputTokens: (count: string) => `${count} input tokens`,
  outputTokens: (count: string) => `${count} output tokens`,
  hitLimit: 'Reached the output limit',
  filtered: "Blocked by the provider's content filter",
  /** 模型行上的判词。 */
  untested: 'Not tested',
  testing: 'Testing…',
  passed: 'Test passed',
  passedIn: (seconds: number) => `Test passed · ${seconds} s`,
};

export type ModelsProbeMessages = typeof en;

export const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
