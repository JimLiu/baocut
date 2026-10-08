import { defineMessages } from '@baocut/protocol';
import type { RestoreRefusal } from '../../model/transcript-cut.ts';
import { zhSeconds, zhTranscript, zhTranscriptTools } from './transcript-copy.zh-Hans.ts';
import { zhHantSeconds, zhHantTranscript, zhHantTranscriptTools } from './transcript-copy.zh-Hant.ts';
import { jaSeconds, jaTranscript, jaTranscriptTools } from './transcript-copy.ja.ts';
import { koSeconds, koTranscript, koTranscriptTools } from './transcript-copy.ko.ts';
import { esSeconds, esTranscript, esTranscriptTools } from './transcript-copy.es.ts';
import { frSeconds, frTranscript, frTranscriptTools } from './transcript-copy.fr.ts';
import { deSeconds, deTranscript, deTranscriptTools } from './transcript-copy.de.ts';
import { nlSeconds, nlTranscript, nlTranscriptTools } from './transcript-copy.nl.ts';
import { ptBRSeconds, ptBRTranscript, ptBRTranscriptTools } from './transcript-copy.pt-BR.ts';
import { itSeconds, itTranscript, itTranscriptTools } from './transcript-copy.it.ts';
import { ruSeconds, ruTranscript, ruTranscriptTools } from './transcript-copy.ru.ts';
import { plSeconds, plTranscript, plTranscriptTools } from './transcript-copy.pl.ts';
import { trSeconds, trTranscript, trTranscriptTools } from './transcript-copy.tr.ts';
import { viSeconds, viTranscript, viTranscriptTools } from './transcript-copy.vi.ts';

/** 秒数的短写：不足 10 秒留一位小数。 */
const enSeconds = (seconds: number): string =>
  seconds < 10 ? `${(Math.round(seconds * 10) / 10).toFixed(1)}s` : `${Math.round(seconds)}s`;

const UNITS = defineMessages({ seconds: enSeconds }, { 'zh-Hans': { seconds: zhSeconds }, 'zh-Hant': { seconds: zhHantSeconds }, ja: { seconds: jaSeconds }, ko: { seconds: koSeconds }, es: { seconds: esSeconds }, fr: { seconds: frSeconds }, de: { seconds: deSeconds }, nl: { seconds: nlSeconds }, 'pt-BR': { seconds: ptBRSeconds }, it: { seconds: itSeconds }, ru: { seconds: ruSeconds }, pl: { seconds: plSeconds }, tr: { seconds: trSeconds }, vi: { seconds: viSeconds } });

/** 秒数的短写（按当前语言）：不足 10 秒留一位小数。 */
export function secondsLabel(seconds: number): string {
  return UNITS.seconds(seconds);
}

const words = (n: number) => `${n} word${n === 1 ? '' : 's'}`;

/**
 * 文稿面板与时间线剪口的文案。原型：panels.jsx `TranscriptPanel`、panel-transcript-cut.jsx（CutBar、CutFloat、CutMenu）。
 * 模式名照产品设计 §5.7 的表：「改原文」「剪辑音画」。英文在这里，译文在 `transcript-copy.zh-Hans.ts`。
 */
const en = {
  title: 'Transcript',
  modes: 'Transcript editing mode',
  modeEdit: 'Edit text',
  modeCut: 'Cut media',
  /** 模式标签下面那一句：这个模式改的是什么、⌫ 做什么（§5.7：同一个删除键在不同模式下含义不同）。 */
  hintEdit: 'Changes the transcribed text only; video and audio stay as they are. Double-click a word to edit it; ⌫ deletes text only.',
  hintCut: 'Select some text and press ⌫ to cut it from the video, audio, and subtitles together. Cut words stay struck through and can be restored.',

  emptyTitle: 'No transcript yet',
  emptyNoMedia: 'Add a video or audio file first. Once it’s transcribed, the spoken words appear here.',
  emptyNotPlaced: 'The video or audio isn’t on the timeline yet. Place it there and transcribe it, and the transcript appears here.',
  emptyNotTranscribed: 'The assets on the timeline haven’t been transcribed. Transcribe them in the Subtitles panel and the transcript appears here.',
  gotoSubtitle: 'Transcribe in Subtitles',
  addMedia: 'Add media',
  loading: 'Loading transcript…',
  noWords: 'This transcript has no words to show.',
  notSpeech: 'This transcript’s format isn’t recognized.',

  /** 一份转写的小标题：素材名 + 统计。 */
  stats: (count: number, cut: number) => (cut ? `${words(count)} · ${cut} cut` : words(count)),
  jump: 'Jump here',
  cutWordTitle: 'Cut from the timeline',
  partialWordTitle: 'A cut falls inside this word; only part of it is left on the timeline',

  // 选区条
  selected: (count: number, seconds: number | null) =>
    seconds === null ? `${words(count)} selected` : `${words(count)} selected · ${secondsLabel(seconds)}`,
  cut: 'Cut',
  restore: 'Restore',
  editWord: 'Edit word',
  deleteText: 'Delete text',
  clear: 'Clear selection · Esc',
  aiFind: 'Find cuts',
  aiFindHint: 'Or let AI find filler words and pauses first',

  // 结果
  cutDone: (seconds: number, ranges: number) =>
    ranges > 1 ? `Cut ${secondsLabel(seconds)} · ${ranges} ranges` : `Cut ${secondsLabel(seconds)}`,
  cutNothing: 'The selected words are no longer on the timeline; there’s nothing to cut.',
  cutTooShort: 'The selection is shorter than one frame and can’t be cut.',
  restoreDone: (seconds: number) => `Restored ${secondsLabel(seconds)}`,
  restoreNotRelaid: 'Some cuts have no matching seam on the timeline. They were removed from the cut list, but the content wasn’t put back.',
  restoreRefused: {
    untracked: 'This range wasn’t removed with a cut (for example, it was trimmed by dragging a clip edge), so there’s no cut to restore. Drag the clip edge on the timeline to bring it back.',
    partial: 'Only part of this range was removed with a cut, so its range can’t be changed. Click the cut band to restore that part first.',
  } satisfies Record<RestoreRefusal, string>,
  textSaved: 'Text updated · video and audio unchanged',
  textDeleted: (count: number) => `Deleted the text of ${words(count)} · video and audio unchanged`,
  /** 改原文之后，由旧版本生成的字幕过期了；不自动重新生成（任务约定）。 */
  stale: (count: number) =>
    count === 1 ? '1 subtitle track was made from an older transcript and wasn’t updated.' : `${count} subtitle tracks were made from an older transcript and weren’t updated.`,
  gotoCaptions: 'Open Subtitles',
  undo: 'Undo',

  // 时间线剪口
  seamLabel: (seconds: number) => `Cut ${secondsLabel(seconds)} · click to restore`,
  cutLabel: 'Cut in transcript',
  restoreLabel: 'Restore cut content',

  // 转录中的实时文稿（原型 panels.jsx `LiveTranscript`）：只读，转录完成后才能编辑。
  liveCopy: 'Copy what’s transcribed so far',
  liveCopied: 'Copied what’s transcribed so far · transcription is still running',
  /** 实时段落还没有说话人。 */
  liveSpeaker: 'Recognizing',
  /** 还一段都没有：不流式返回的服务要到最后才一起给，不许诺「几秒后」。 */
  liveWaiting: 'Recognized text appears here as it comes in. Some services return it all when they finish.',
  liveNote: 'Recognized text appears paragraph by paragraph. You can edit it when transcription finishes.',
  liveJump: 'Jump to latest',
  liveSaving: 'Saving transcript',
};

export type TranscriptMessages = typeof en;
export const TRANSCRIPT_COPY = defineMessages(en, { 'zh-Hans': zhTranscript, 'zh-Hant': zhHantTranscript, ja: jaTranscript, ko: koTranscript, es: esTranscript, fr: frTranscript, de: deTranscript, nl: nlTranscript, 'pt-BR': ptBRTranscript, it: itTranscript, ru: ruTranscript, pl: plTranscript, tr: trTranscript, vi: viTranscript });

/**
 * 文稿的查找替换、复制、语言视图、段落行与章节头菜单。原型：panels.jsx `TranscriptPanel`（页头的查找、复制、语言钮）、
 * `ParaRow`（↑ ↓、播放、⋯）、`ScopeMenu`（复制这一段 / 这一章）。
 */
const tools = {
  // 工具菜单（原型 panels.jsx 文稿头上的 ✦，产品设计 §5.10）：整理文稿的四件，和从文稿出发的写作、发布
  toolsMenu: 'Tidy transcript',
  toolsTidy: 'Tidy the whole transcript',
  toolsFrom: 'Start from the transcript',
  // 查找替换
  findTip: 'Find and replace · ⌘F',
  findLabel: 'Find and replace',
  findPlaceholder: 'Find in transcript',
  /** 当前命中改不了的原因（设计稿 `lockHint`）：译文只查不改；转写的新版本还没取到时先不改，免得盖掉新版本。 */
  lockTranslation: 'Translations can be searched but not edited here—the Transcript panel only edits the original',
  lockLoading: 'A newer version of this transcript is still loading; replace after it finishes',
  replaceLabel: 'Replace transcript text',
  replaceDone: (count: number) => `Replaced ${count} ${count === 1 ? 'match' : 'matches'} · video and audio unchanged`,
  replaceNothing: 'No matches need changing',

  // 复制
  copyMenu: 'Copy transcript',
  copyAllHead: (lang: string) => `Copy all · ${lang}`,
  copyText: 'Copy text',
  copySpeaker: 'With speakers',
  copyTimed: 'With timecodes and speakers',
  copyScopeHead: (scope: string) => `Copy ${scope}`,
  copied: (scope: string, receipt: string) => `Copied ${scope} · ${receipt}`,
  copyFailed: 'Couldn’t copy · the browser denied clipboard access',
  copyEmpty: 'Nothing to copy',
  scopeAll: 'all',
  scopePara: 'this paragraph',
  scopeChapter: (title: string) => `“${title}”`,
  scopeSelection: 'selected text',
  copySelection: 'Copy',
  copySelectionTip: 'Copy selected text · ⌘C',

  // 语言视图（设计稿 `langShort` 与「文稿语言」菜单）
  langLabel: 'Transcript language',
  langSource: 'Original',
  langTranslation: 'Translation',
  langBoth: (source: string, translation: string) => `${source} + ${translation}`,
  showBoth: 'Show original alongside',
  showBothNeedsTranslation: 'Choose a translation first',
  showBothHint: 'Side by side',
  noTranslation: 'No translations yet',
  noTranslationHint: 'Translate from the Subtitles panel with “+ Translate to…”',
  translationNote: 'Translations follow playback by paragraph only—word timings exist only in the original, so word-level highlighting would be made up.',
  translationOnly: 'You can’t edit or cut while viewing only a translation; switch back to the original or side by side to edit.',
  noParagraphTranslation: 'This paragraph has no translation',

  // 段落行（设计稿 `ParaRow`）
  paraMenu: 'This paragraph…',
  moveUp: 'Move to previous chapter',
  moveDown: 'Move to next chapter',
  play: 'Play paragraph',
  moveHead: 'Move to chapter',
  moveTo: (title: string) => `Move to “${title}”`,
  moveWith: (count: number) => (count > 1 ? `Moves together with its neighbors on that side, ${count} paragraphs in all` : 'Moves only this paragraph'),
  /** 挪不了的原因：章节是连续的时间区间，只挪跨过的那一条边界。 */
  noPrev: 'There’s no chapter before this paragraph',
  noNext: 'There’s no chapter after this paragraph',
  moveBlocked: 'Moving it would leave this chapter empty or cross the start of the neighboring chapter',
  moveLabel: 'Move paragraph to neighboring chapter',
  moved: (title: string, count: number) => (count > 1 ? `Moved ${count} paragraphs to “${title}”` : `Moved to “${title}”`),
  cutPara: 'Cut this paragraph',
  cutParaHint: 'Cuts video, audio, and subtitles together; can be restored',

  // 章节头「这一章…」
  chapterMenu: 'This chapter…',
  renameChapter: 'Rename…',
  cutChapter: 'Cut this chapter',
  cutChapterHint: 'Cuts video, audio, and subtitles together; later chapters move up',
  cutChapterLabel: 'Cut chapter',
  cutChapterRefused: {
    empty: 'This chapter has no length',
    whole: 'This chapter is the whole video; cutting it would leave nothing',
    'no-tracks': 'No track on the timeline uses the transcribed assets, so there’s nothing to cut',
  } satisfies Record<'empty' | 'whole' | 'no-tracks', string>,
  cutChapterDone: (title: string, seconds: number) => `Cut “${title}” · ${secondsLabel(seconds)}`,
  removeMarker: 'Delete chapter marker',
  removeMarkerHint: 'Deletes only the marker; content stays',
  find: 'Find',
  badRegex: 'Invalid regex',
  noResults: 'No results',
  previous: 'Previous',
  next: 'Next',
  closeFind: 'Close find',
  replaceWith: 'Replace with',
  matchCase: 'Match case',
  wholeWordShort: 'Word',
  wholeWord: 'Match whole word',
  regex: 'Regular expression · replacement text is inserted literally',
  replace: 'Replace',
  replaceAll: 'Replace all',
  regexError: (error: string) => `Regex error: ${error}`,
};

export type TranscriptToolsMessages = typeof tools;
export const TRANSCRIPT_TOOLS_COPY = defineMessages(tools, { 'zh-Hans': zhTranscriptTools, 'zh-Hant': zhHantTranscriptTools, ja: jaTranscriptTools, ko: koTranscriptTools, es: esTranscriptTools, fr: frTranscriptTools, de: deTranscriptTools, nl: nlTranscriptTools, 'pt-BR': ptBRTranscriptTools, it: itTranscriptTools, ru: ruTranscriptTools, pl: plTranscriptTools, tr: trTranscriptTools, vi: viTranscriptTools });
