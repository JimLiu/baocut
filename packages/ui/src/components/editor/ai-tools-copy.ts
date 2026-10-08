import { defineMessages } from '@baocut/protocol';
import { zhHans } from './ai-tools-copy.zh-Hans.ts';
import { zhHant } from './ai-tools-copy.zh-Hant.ts';
import { ja } from './ai-tools-copy.ja.ts';
import { ko } from './ai-tools-copy.ko.ts';
import { es } from './ai-tools-copy.es.ts';
import { fr } from './ai-tools-copy.fr.ts';
import { de } from './ai-tools-copy.de.ts';
import { nl } from './ai-tools-copy.nl.ts';
import { ptBR } from './ai-tools-copy.pt-BR.ts';
import { it } from './ai-tools-copy.it.ts';
import { ru } from './ai-tools-copy.ru.ts';
import { pl } from './ai-tools-copy.pl.ts';
import { tr } from './ai-tools-copy.tr.ts';
import { vi } from './ai-tools-copy.vi.ts';

/** 编辑器里工具页的文案（原型 panel-aitools.jsx、panel-aitools-flows.jsx `RunCta`、tool-setup.jsx、panel-aitools-write.jsx）。译文在 `ai-tools-copy.zh-Hans.ts`。 */
const en = {
  back: 'Back',

  // 设置态
  who: 'Use',
  whoAgent: 'Hand off to the Agent',
  whoAgentSub: 'Runs in this video’s session',
  whoModel: 'Call a model directly',
  whoModelSub: 'The Runtime has no workflow for this yet, so only the Agent can do it',
  scope: 'Scope',
  scopeAll: 'Whole video',
  scopeChapter: (index: number, label: string) => `Chapter ${index} · ${label}`,
  scopeNoChapters: 'The timeline has no chapters yet, so only the whole video is available',
  byAgent: 'Done by the Agent',
  preview: 'What will be sent to the Agent',
  cta: 'Hand off to the Agent',
  ctaHint: 'Sends the message above to this video’s session, and the Agent starts right away. Adjust it above first if needed.',
  ctaNoVideo: 'The video isn’t open yet, so there’s nothing to hand off.',
  sent: 'Handed off to the Agent · running in the session',
  queued: 'The Agent is busy · the message is queued and will be sent when this turn ends',
  sendFailed: (message: string) => `Couldn’t send: ${message}`,
  noConversation: 'This video isn’t in any project or session, so it can’t be handed off to the Agent.',
  createFailed: (message: string) => `Couldn’t create a session: ${message}`,

  // 勾选项与自定义
  prePolish: 'Polish first (auto paragraphs)',
  prePolishOn: 'Chapters are grouped by paragraph',
  prePolishOff: 'An unpolished transcript has only 1 paragraph, so chapters will be coarse',
  noteTitle: 'Custom instructions (optional)',
  notePlaceholder: 'Extra requirements, such as keeping it conversational or not changing brand names…',
  staleEdited: 'Sentences edited in the original',
  staleEditedSub: 'You changed words in the transcript, but the translation is still the old one',
  staleCut: 'Sentences cut from the original',
  staleCutSub: 'A cut removed part of a sentence; retranslate from the cut original',
  staleNone: 'Check at least one',
  staleOnly: (language: string) => `Only the ${language} translation`,
  retranscribeModel: 'The Agent picks a speech model from those installed on this computer; to choose one, say so in the instructions below.',
  /** 重新转录「更多选项」开着识别说话人、要由「说话人区分」来做时，加进发给 Agent 的那句话（设计稿 panel-aitools.jsx）。 */
  retranscribeSpeakers: 'Identify speakers after transcribing',

  // 写作与发布
  length: 'Length',
  style: 'Style',
  styleCustom: 'Describe how to write it, in your own words',
  view: 'Point of view',
  viewAuto: 'Auto: the Agent decides from the video’s source',
  language: 'Language',
  languageWrite: 'Same as the interface',
  languagePublish: 'Same as the transcript',
  platform: 'Where to post',
  platformPlaceholder: 'The platform to post on (optional); it follows that platform’s rules and reminds you to check',
  titleCount: 'Candidates',
  titleCountNote: (min: number, max: number) => `${min}–${max}, each from a different angle`,
  coverCount: 'How many',
  coverIdea: 'The one thing to say',
  coverIdeaPlaceholder: 'What would make people click this video (optional); leave it blank to let the Agent find it in the transcript',
  coverRatio: 'Aspect ratio',
  coverRatioProject: 'Same as the video canvas',
  coverText: 'Cover text',
  writeNote: 'Anything else (optional)',
  writeNotePlaceholder: 'For example, lead with the conclusion or mention the guest’s name',
  titleNote: 'One requirement (optional)',
  titleNotePlaceholder: 'For example, no questions, or include the guest’s name',
  coverNotePlaceholder: 'For example, no red, or put the person on the right',

  // 还做不了的
  soon: 'Coming soon',
  chaptersPolishFirst: 'Polish and split into paragraphs first, then generate chapters',
};

export type AiToolsMessages = typeof en;
export const AI_TOOLS_COPY = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
