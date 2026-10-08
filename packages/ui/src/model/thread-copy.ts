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

/** 会话线程里执行步骤的文案（model/thread.ts；译文在 `thread-copy.<语言>.ts`）。 */
const en = {
  /** BaoCut 自己的视频工具（MCP 服务名 `baocut`）写成动作。 */
  videoTools: {
    videos_list: 'List videos',
    videos_create: 'New video',
    videos_inspect: 'Read video',
    edits_apply: 'Edit video',
    edits_undo: 'Undo edits',
  } as Record<string, string>,
  /** 视频工具的动作带上它的说明。 */
  toolTitle: (action: string, label: string) => `${action}: ${label}`,
  steps: { command: 'Run command', read: 'Read file', edit: 'Edit file', search: 'Search', other: 'Other tool' },
  /** 组头摘要的各个短语（按首次出现的顺序由 `summary` 连起来）。 */
  phrase: {
    command: 'ran commands',
    read: (count: number) => `read ${count} ${count === 1 ? 'file' : 'files'}`,
    edit: (count: number) => `edited ${count} ${count === 1 ? 'file' : 'files'}`,
    search: 'searched',
    video: (count: number) => `committed ${count} video ${count === 1 ? 'edit' : 'edits'}`,
    tool: 'called tools',
  },
  summary: (phrases: readonly string[]) => {
    const text = phrases.join(', ');
    return text.charAt(0).toUpperCase() + text.slice(1);
  },
  thinking: 'Thinking',
  stepsFallback: 'Steps',
};
export type ThreadMessages = typeof en;
export const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
