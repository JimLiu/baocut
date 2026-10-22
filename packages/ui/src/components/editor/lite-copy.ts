import { defineMessages } from '@baocut/protocol';
import { zhHans } from './lite-copy.zh-Hans.ts';
import { zhHant } from './lite-copy.zh-Hant.ts';
import { ja } from './lite-copy.ja.ts';
import { ko } from './lite-copy.ko.ts';
import { es } from './lite-copy.es.ts';
import { fr } from './lite-copy.fr.ts';
import { de } from './lite-copy.de.ts';
import { nl } from './lite-copy.nl.ts';
import { ptBR } from './lite-copy.pt-BR.ts';
import { it } from './lite-copy.it.ts';
import { ru } from './lite-copy.ru.ts';
import { pl } from './lite-copy.pl.ts';
import { tr } from './lite-copy.tr.ts';
import { vi } from './lite-copy.vi.ts';

/**
 * 轻量编辑器（轻量编辑器设计 §3–§6）的文案：顶栏的视图切换与「默认打开」、片条、走带、舞台条的侧栏开关、侧栏的分段与逐句。
 * 译文在 `lite-copy.zh-Hans.ts` 等。
 */
const en = {
  /** 顶栏：审片 / 时间线（视图在代码里仍叫 lite）。 */
  viewGroup: 'Editor view',
  viewLite: 'Review',
  viewTimeline: 'Timeline',
  /** 视频菜单里的「默认打开」。 */
  defaultOpen: 'Open videos in',
  defaultAuto: 'Automatic',
  defaultAutoHint: 'Review, unless you switched this video to the timeline last time',
  defaultLite: 'Review view',
  defaultTimeline: 'Timeline view',
  /** 片条。 */
  chips: 'Segments',
  chipLabel: (title: string, range: string) => `${title}, ${range}. Click to jump, drag to scrub`,
  segmentCount: (n: number) => `${n} segment${n === 1 ? '' : 's'}`,
  /** 片条上章节边界的把手（轻量编辑器设计 §3.2）：悬停提示、可访问名、秒数、松手后的提示。 */
  edgeHint: 'Drag to move the boundary with the next chapter',
  edgeLabel: (title: string, duration: string) =>
    `End of “${title}”, ${duration}. Drag, or use the arrow keys, to move the boundary with the next chapter`,
  seconds: (value: string) => `${value}s`,
  edgeMoved: (title: string, duration: string) => `“${title}” is now ${duration}`,
  /** 走带。 */
  prevSegment: 'Previous segment',
  nextSegment: 'Next segment',
  loop: 'Loop',
  loopWhole: 'Loop whole video',
  loopSegment: 'Loop current segment',
  loopOff: "Don't loop",
  zoomFit: 'Fit all segments',
  zoomSegment: 'Fit current segment',
  zoomPlayhead: 'Zoom to playhead',
  /** 舞台条。 */
  showSide: 'Show the lines panel',
  hideSide: 'Hide the lines panel',
  /** 舞台条左端的图层开关（轻量编辑器设计 §3.4）：钮名、有关着的开关时的提示、配乐那一个开关。 */
  layers: 'Layers',
  layersPartlyHidden: 'Layers: some are hidden',
  layerMusic: 'Music',
  /** 侧栏。 */
  side: 'Lines',
  sourceChapter: 'By chapter',
  sourceSpeech: 'By pauses in the narration',
  sourceWhole: 'Whole video',
  sourceSpeechHint: 'No chapters yet, so segments follow the pauses in the narration.',
  sourceWholeHint: 'No chapters or transcript yet, so the whole video is one segment.',
  noLines: 'No transcript yet',
  noLinesHint: 'Transcribe the video in the timeline editor to see its lines here.',
  noLinesInSegment: 'No lines in this segment.',
  /** 侧栏顶上转录、翻译运行态头里的那句说明（轻量编辑器设计 §3「侧栏」）。 */
  transcribingNote: 'When transcription finishes, the lines appear here sentence by sentence.',
  translatingNote: 'When translation finishes, each line shows its translation below the original.',
  /** 段里章节表脚本的折叠钮（轻量编辑器设计 §3「侧栏」）。 */
  script: 'Script',
  /** 侧栏分页（视频里有脚本时，轻量编辑器设计 §3「侧栏」）与头上的「字幕样式」。 */
  sideTabs: 'Side panel',
  subtitleStyle: 'Subtitle style',
  subtitleStyleTip: 'Change how subtitles look—the same settings as the Subtitles panel in the timeline',
  subtitleStyleHidden: 'Subtitles are hidden. Turn them on under Layers to change their style',
  subtitleStyleNone: 'This video has no subtitles yet',
  backTo: (page: string) => `Back to ${page}`,
  /** 脚本页。 */
  versionN: (n: number) => `Version ${n}`,
  scriptVersions: 'Script versions',
  scriptVersionsButton: (n: number) => `Script versions · ${n}`,
  playing: 'Now playing',
  scriptHintAgent: 'To change the script, ask in the conversation. Each change is saved as a new version. Read-only here.',
  scriptHint: 'The script is read-only here. Each change is saved as a new version.',
  scriptLoading: 'Loading the script…',
  scriptUnreadable: (schema: string) => `This script is in a format that can’t be shown here (${schema}).`,
  /** 脚本版本页。 */
  versionCount: (n: number) => `${n} version${n === 1 ? '' : 's'}`,
  current: 'Current',
  byYou: 'You',
  byAgent: 'Agent',
  versionCreated: 'Written when the video was made',
  versionRestored: (n: number) => `Restored version ${n}`,
  versionUnchanged: 'Text unchanged',
  /** 改了哪几个小节：`shown` 是前两个小节名，`total` 是一共几处。 */
  versionChanged: (shown: string[], total: number) =>
    `Changed ${shown.map((s) => `“${s}”`).join(', ')}${total > shown.length ? ` and ${total - shown.length} more` : ''}`,
  sectionStart: 'Opening',
  showChanges: (n: number) => `Show changes · ${n}`,
  firstVersion: 'First version',
  changeAdded: 'New',
  changeChanged: 'Edited',
  changeRemoved: 'Removed',
  restore: 'Restore this version',
  restoreTitle: (n: number) => `Restore version ${n}?`,
  restoreBody: (n: number, when: string) =>
    `The script goes back to version ${n} (${when}) and is saved as a new version. All versions stay, so you can go back again anytime. Only the script changes—visuals, narration and subtitles stay as they are.`,
  restoreBodyAgent: ' To redo a part, ask in the conversation.',
  cancel: 'Cancel',
  restored: (n: number, m: number) => `Restored version ${n}, saved as version ${m}`,
  whyLatest: 'This is the current script',
  whyNoop: (n: number) => `The script already matches version ${n}, so restoring it changes nothing`,
  versionLoading: 'Loading this version…',
  lineLabel: (time: string, text: string) => `${time}, ${text}`,
  range: (start: string, end: string) => `${start} – ${end}`,
};

export type LiteMessages = typeof en;
export const LITE_COPY = defineMessages(en, {
  'zh-Hans': zhHans,
  'zh-Hant': zhHant,
  ja,
  ko,
  es,
  fr,
  de,
  nl,
  'pt-BR': ptBR,
  it,
  ru,
  pl,
  tr,
  vi,
});
