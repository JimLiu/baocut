import { defineMessages } from '@baocut/protocol';
import { zhHans } from './thread-copy.zh-Hans.ts';
import { zhHant } from './thread-copy.zh-Hant.ts';
import { ja } from './thread-copy.ja.ts';
import { ko } from './thread-copy.ko.ts';
import { es } from './thread-copy.es.ts';
import { fr } from './thread-copy.fr.ts';
import { de } from './thread-copy.de.ts';
import { nl } from './thread-copy.nl.ts';
import { ptBR } from './thread-copy.pt-BR.ts';
import { it } from './thread-copy.it.ts';
import { ru } from './thread-copy.ru.ts';
import { pl } from './thread-copy.pl.ts';
import { tr } from './thread-copy.tr.ts';
import { vi } from './thread-copy.vi.ts';

/** 会话线程（消息、步骤组、修改卡、复制按钮）的文案。英文写在这里，译文在 `thread-copy.zh-Hans.ts`。 */
const en = {
  /** 名字后面括注说明，如「片段（3 个）」。 */
  withDetail: (text: string, detail: string) => `${text} (${detail})`,
  copy: 'Copy',
  copied: 'Copied',
  copyFailed: 'Couldn’t copy. Try again',
  copyCode: 'Copy code',
  copyReply: 'Copy this reply',
  change: {
    added: (n: number) => `Added ${n}`,
    updated: (n: number) => `Changed ${n}`,
    deleted: (n: number) => `Deleted ${n}`,
    duration: (clock: string) => `Duration ${clock}`,
    durationChange: (before: string, after: string) => `Duration ${before} → ${after}`,
    revision: (before: number | string, after: number | string) => `Version ${before} → ${after}`,
    locked: 'The video can’t be changed right now',
    undoStep: (videoName: string, label: string) => `Undid a step in “${videoName}”: ${label}`,
    changed: (videoName: string, label: string) => `Changed “${videoName}”: ${label}`,
    aria: (label: string) => `Video change: ${label}`,
  },
  message: {
    contextTitle: 'Editor state sent with the message',
    context: (videoName: string, revision: number | string, playhead: string, selected: number) =>
      `“${videoName}” · Version ${revision} · Playhead ${playhead}${selected ? ` · ${selected} ${selected === 1 ? 'clip' : 'clips'} selected` : ''}`,
  },
  output: {
    aria: (name: string, detail: string) => `${name}, ${detail}`,
  },
  steps: {
    /** 几步一起跑时，摘要行在那一步的类别名后面写的（`n` 是在跑的步数）。 */
    more: (n: number) => `${n} running`,
    failed: (n: number) => `${n} failed`,
    thinking: 'Thinking',
    viewFile: (name: string) => `View ${name}`,
    input: 'Input',
    error: 'Error',
    output: 'Output',
    waiting: 'Waiting for output',
    noOutput: 'No output',
  },
};

export type ThreadMessages = typeof en;

export const T = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
