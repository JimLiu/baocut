import type { ToolTargetsMessages } from './tool-targets-copy.ts';

export const zhHant: ToolTargetsMessages = {
  unknownLanguage: '未知語言',
  langCount: (label, count) => `${label} ×${count}`,
  joinLangs: (labels) => labels.join('、'),
  tagTranscript: (langs) => `逐字稿 · ${langs}`,
  tagTranslation: (langs) => `譯文 · ${langs}`,
  tagDub: (langs) => `配音 · ${langs}`,
  tagPending: '仍在讀取內容，開始時會自動選擇逐字稿',
  blockTranscribing: '正在轉錄，完成後可以重新轉錄',
  blockQueued: '已在轉錄佇列中',
  blockTranscribingWait: '正在轉錄，完成後才能選擇',
  blockQueuedWait: '在轉錄佇列中，轉錄完成後才能選擇',
  blockFailed: '上次轉錄失敗，請先重新轉錄',
  blockNoTranscript: '還沒有逐字稿，請先轉錄',
  duplicateTranscript: (langs) =>
    `這部影片已有${langs}逐字稿。預設會新建一部影片，這部影片和它的譯文不動；選「取代這部影片的逐字稿」會換掉目前的逐字稿，譯文按原文配對結轉、原文變了的標為過期，一筆可復原。`,
  duplicateTranslation: (lang) => `這部影片已有${lang}譯文。這次會新增一份，並保留原有的譯文；要使用哪一份，可在編輯器中選擇。`,
  duplicateDub: (lang) => `這部影片已有${lang}配音。這次會新增一組，並保留原有的配音。`,
  duplicateTitle: {
    transcribe: '已有逐字稿',
    'translate-subtitles': '原有的譯文會保留',
    dub: '原有的配音會保留',
  },
  translationOption: (lang, nth) => `${lang}譯文${nth === null ? '' : ` 第 ${nth} 份`}`,
  translatedFrom: (lang) => `譯自${lang}逐字稿`,
  destNewVideo: '新建影片',
  destNewVideoNote: '同一專案裡的新影片，連結同一份素材；這部影片和它的譯文不動',
  destReplace: '取代這部影片的逐字稿',
  destReplaceNote: '換掉目前的逐字稿，譯文、字幕與配音在同一筆交易裡結轉，可以復原',
  newVideoName: (name) => `${name} · 重新轉錄`,
  impactTranslation: (lang, units) => `${lang} · ${units} 句`,
  impactDub: (lang, groups) => `${lang} · ${groups} 組 · 譯文沒變的句子保留配音，標為可能不一致`,
  impactRule:
    '原文沒變的句子保留譯文與審閱狀態，對齊降為句級；原文變了或配不上的標為過期，轉錄完成後用「更新過期譯文」重譯。實際幾句會在結果裡報告。',
  impactUndo: '一筆交易，可以復原',
};
