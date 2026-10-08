import type { ToolTargetsMessages } from './tool-targets-copy.ts';

export const zhHans: ToolTargetsMessages = {
  unknownLanguage: '未知语言',
  langCount: (label, count) => `${label} ×${count}`,
  joinLangs: (labels) => labels.join('、'),
  tagTranscript: (langs) => `文稿 · ${langs}`,
  tagTranslation: (langs) => `译文 · ${langs}`,
  tagDub: (langs) => `配音 · ${langs}`,
  tagPending: '内容还没读完，开始时自动选文稿',
  blockTranscribing: '正在转录，完成后可以重新转录',
  blockQueued: '已在转录队列里',
  blockTranscribingWait: '正在转录，完成后才能选',
  blockQueuedWait: '在转录队列里，转录完成后才能选',
  blockFailed: '上次转录失败，先重新转录',
  blockNoTranscript: '还没有文稿，先转录',
  duplicateTranscript: (langs) =>
    `这部视频已有${langs}文稿。默认新建一部视频，这部视频和它的译文不动；选「取代这部视频的文稿」会换掉当前文稿，译文按原文配对结转、原文变了的标为过期，一笔可撤销。`,
  duplicateTranslation: (lang) => `这个视频已有${lang}译文。这次会新增一份，原来的保留，用哪一份在编辑器里选。`,
  duplicateDub: (lang) => `这个视频已有${lang}配音。这次会新增一组，原来的保留。`,
  duplicateTitle: {
    transcribe: '已有文稿',
    'translate-subtitles': '不覆盖原来的译文',
    dub: '不覆盖原来的配音',
  },
  translationOption: (lang, nth) => `${lang}译文${nth === null ? '' : ` 第 ${nth} 份`}`,
  translatedFrom: (lang) => `译自${lang}文稿`,
  destNewVideo: '新建视频',
  destNewVideoNote: '同一项目里的新视频，链接同一份素材；这部视频和它的译文不动',
  destReplace: '取代这部视频的文稿',
  destReplaceNote: '换掉当前文稿，译文、字幕与配音在同一笔事务里结转，可以撤销',
  newVideoName: (name) => `${name} · 重新转录`,
  impactTranslation: (lang, units) => `${lang} · ${units} 句`,
  impactDub: (lang, groups) => `${lang} · ${groups} 组 · 句子译文不变的保留，标可能不一致`,
  impactRule:
    '原文没变的句子保留译文与审阅状态，对齐降为句级；原文变了或配不上的标为过期，转录完成后用「刷新过期译文」重译。具体几句在结果里报告。',
  impactUndo: '一笔事务，可以撤销',
};
