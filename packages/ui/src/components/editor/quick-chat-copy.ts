import { defineMessages } from '@baocut/protocol';
import { zhHans } from './quick-chat-copy.zh-Hans.ts';
import { zhHant } from './quick-chat-copy.zh-Hant.ts';
import { ja } from './quick-chat-copy.ja.ts';
import { ko } from './quick-chat-copy.ko.ts';
import { es } from './quick-chat-copy.es.ts';
import { fr } from './quick-chat-copy.fr.ts';
import { de } from './quick-chat-copy.de.ts';
import { nl } from './quick-chat-copy.nl.ts';
import { ptBR } from './quick-chat-copy.pt-BR.ts';
import { it } from './quick-chat-copy.it.ts';
import { ru } from './quick-chat-copy.ru.ts';
import { pl } from './quick-chat-copy.pl.ts';
import { tr } from './quick-chat-copy.tr.ts';
import { vi } from './quick-chat-copy.vi.ts';

/** 视频右下角悬浮会话的文案。译文在 `quick-chat-copy.zh-Hans.ts`。 */
const en = {
  label: 'This video’s session',
  open: 'Open this video’s session',
  fresh: 'New session',
  expand: 'Expand session on the left',
  minimize: 'Minimize',
  about: (name: string) => `About “${name}”`,
  placeholder: 'What do you want to do with this video? Type / for tools',
  hint: 'The Agent works on it right here',
  failed: (message: string) => `Couldn’t send: ${message}`,
  untitled: 'Video',
  send: 'Send',
};

export type QuickChatMessages = typeof en;
export const QUICK_CHAT_COPY = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
