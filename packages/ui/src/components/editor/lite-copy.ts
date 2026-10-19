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
  defaultAutoHint: 'Review for chaptered videos made in a conversation, timeline otherwise',
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
  restart: 'Play from the beginning',
  loopOn: 'Loop: on',
  loopOff: 'Loop: off',
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
