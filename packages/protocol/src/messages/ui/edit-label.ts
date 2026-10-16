import { defineCatalog } from '../../message-ref.ts';
import { languageName } from './language-name.ts';
import { zhHans } from './edit-label.zh-Hans.ts';
import { zhHant } from './edit-label.zh-Hant.ts';
import { ja } from './edit-label.ja.ts';
import { ko } from './edit-label.ko.ts';
import { es } from './edit-label.es.ts';
import { fr } from './edit-label.fr.ts';
import { de } from './edit-label.de.ts';
import { nl } from './edit-label.nl.ts';
import { ptBR } from './edit-label.pt-BR.ts';
import { it } from './edit-label.it.ts';
import { ru } from './edit-label.ru.ts';
import { pl } from './edit-label.pl.ts';
import { tr } from './edit-label.tr.ts';
import { vi } from './edit-label.vi.ts';

const noun: Record<string, string> = { video: 'video', image: 'image', audio: 'audio' };

/**
 * 编辑器提交编辑事务时给的修改名（`edits.apply` 的 `label` 与 `labelRef`，命令与协议规范 §3.1）：历史、撤销提示、改动卡片
 * 与 Agent 读到的都按读者的语言重新生成。素材名、元素名这类内容作为字符串参数原样传；`language` 参数是语言标签，按读者的
 * 语言显示语言名。键发布后不改名、不复用。
 */
const en = {
  // 时间线：片段与轨道
  addClip: 'Add clip',
  addSoundtrack: 'Add soundtrack',
  importAndAdd: 'Import and add assets',
  moveClips: 'Move clips',
  moveTrack: 'Move track',
  hideTrack: 'Hide track',
  showTrack: 'Show track',
  muteTrack: 'Mute track',
  unmuteTrack: 'Unmute',
  lockTrack: 'Lock track',
  unlockTrack: 'Unlock track',
  cutClips: 'Cut clips',
  pasteClips: 'Paste clips',
  duplicateClips: 'Duplicate clips',
  deleteClips: 'Delete clips',
  splitClip: 'Split clip',
  nudgeClip: 'Nudge clip timing',
  disableClip: 'Disable clip',
  enableClip: 'Enable clip',
  removeSpan: 'Delete span from all tracks',
  detachAudio: 'Detach audio',
  changeStacking: 'Change stacking order',
  // 素材
  replaceAsset: (p: { kind: string }) => `Replace ${noun[p.kind] ?? p.kind}`,
  collectAsset: 'Collect into video folder',
  importAssets: 'Import assets',
  setBackground: 'Set background',
  addWaveform: 'Add waveform',
  relinkAsset: (p: { name: string }) => `Relink “${p.name}”`,
  addNamed: (p: { name: string }) => `Add ${p.name}`,
  // 画面
  alignClips: 'Align clips',
  distributeClips: 'Distribute clips',
  fillCanvas: 'Fill canvas',
  fitCanvas: 'Fit canvas',
  flip: 'Flip',
  move: 'Move',
  resize: 'Resize',
  scale: 'Scale',
  rotate: 'Rotate',
  reframe: 'Reframe',
  groupMove: 'Move together',
  groupScale: 'Scale together',
  resetRotation: 'Reset rotation',
  editText: 'Edit text',
  nudgePosition: 'Nudge position',
  applyFramingToAll: 'Apply to whole short',
  zoomFraming: 'Zoom framing',
  freePlacement: 'Switch to free placement',
  aspectRatio: (p: { ratio: string }) => `Aspect ratio ${p.ratio}`,
  /** `aspectRatio` 的 `ratio`：原始画幅。 */
  originalRatio: 'Original',
  renameVideo: 'Rename video',
  // 字幕
  applySubtitleStyle: 'Apply subtitle style',
  editSubtitleStyle: 'Edit subtitle style',
  importSubtitles: 'Import subtitles',
  generateSubtitles: 'Generate subtitles',
  rewriteSubtitle: 'Edit subtitle',
  splitSubtitle: 'Split subtitle',
  mergeSubtitles: 'Merge subtitles',
  replaceSubtitleText: 'Replace subtitle text',
  dropSubtitle: 'Remove subtitles from the canvas',
  landSubtitle: 'Put subtitles back on the canvas',
  flipSubtitle: 'Swap subtitle order',
  /** `language` 是目标语言的自称（各语言的读者看到的一样），没有目标语言时传 `unnamedTranslation`。 */
  translateTo: (p: { language: string }) => `Translate to ${p.language}`,
  unnamedTranslation: 'Translation',
  editTranslation: 'Edit translation',
  markTranslationStale: 'Mark translation out of date',
  clearTranslationStale: 'Clear out-of-date mark',
  unifyGlossaryTerms: 'Use glossary translations',
  // 文字稿与章节
  cutText: 'Cut in transcript',
  restoreText: 'Restore cut content',
  editTranscript: 'Edit text',
  replaceText: 'Replace transcript text',
  moveText: 'Move paragraph to neighboring chapter',
  cutChapter: 'Cut chapter',
  retimeCut: 'Change cut range',
  addChapter: 'Add chapter',
  renameChapter: 'Rename chapter',
  removeChapter: 'Delete chapter',
  moveChapter: 'Move chapter start',
  // 配音
  editDubText: 'Edit translation (revoice)',
  switchDubTake: (p: { take: number }) => `Switch to voice-over take ${p.take}`,
  hearDub: 'Hear voice-over',
  hearOriginal: 'Hear original',
  hearBoth: 'Hear both',
  /** `language` 是语言标签。 */
  undoDub: (p: { language: string }) => `Undo voice-over (${languageName('en', p.language)})`,
  muteDub: 'Mute voice-over',
  unmuteDub: 'Unmute voice-over',
  removeDub: 'Delete voice-over',
  /** `language` 是语言标签，配音组没记语言时为空。 */
  removeDubGroup: (p: { language: string }) => `Remove voice-over (${languageName('en', p.language)})`,
  removeThisDubGroup: 'Remove this voice-over group',
  stretchDub: 'Change voice-over speed',
  // 模板层（视频格式规范 §3.17）
  applyTemplate: (p: { name: string }) => `Apply template “${p.name}”`,
  removeTemplate: 'Remove template',
  editTemplate: 'Edit template',
  editTemplateLayout: 'Edit template layout',
  lockTemplateRatio: 'Lock aspect ratio to template',
  unlockTemplateRatio: 'Unlock template aspect ratio',
};

export type EditLabelMessages = typeof en;

export const EditLabel = defineCatalog('editLabel', en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
