import type { TranscriptMessages, TranscriptToolsMessages } from './transcript-copy.ts';

function secondsLabel(seconds: number): string {
  return seconds < 10 ? `${(Math.round(seconds * 10) / 10).toFixed(1)} 秒` : `${Math.round(seconds)} 秒`;
}

export const jaSeconds = secondsLabel;

export const jaTranscript: TranscriptMessages = {
  title: '文字起こし',
  modes: '文字起こしの編集モード',
  modeEdit: 'テキストを編集',
  modeCut: 'メディアをカット',
  hintEdit: '文字起こしのテキストだけを変更し、映像と音声はそのままです。単語をダブルクリックして編集でき、⌫ はテキストだけを削除します。',
  hintCut: 'テキストを選択して ⌫ を押すと、動画、音声、字幕からまとめてカットされます。カットした単語は取り消し線付きで残り、復元できます。',

  emptyTitle: '文字起こしはまだありません',
  emptyNoMedia: '先に動画または音声ファイルを追加してください。文字起こしすると、話した内容がここに表示されます。',
  emptyNotPlaced: '動画または音声がまだタイムラインにありません。タイムラインに配置して文字起こしすると、ここに表示されます。',
  emptyNotTranscribed: 'タイムライン上の素材はまだ文字起こしされていません。字幕パネルで文字起こしすると、ここに表示されます。',
  gotoSubtitle: '字幕パネルで文字起こし',
  addMedia: 'メディアを追加',
  loading: '文字起こしを読み込み中…',
  noWords: 'この文字起こしには表示できる単語がありません。',
  notSpeech: 'この文字起こしの形式を認識できません。',

  stats: (count: number, cut: number) => (cut ? `${count} 語 · カット済み ${cut} 語` : `${count} 語`),
  jump: 'ここへ移動',
  cutWordTitle: 'タイムラインからカット済み',
  partialWordTitle: 'この単語の途中にカットがあり、一部だけがタイムラインに残っています',

  // 选区条
  selected: (count: number, seconds: number | null) =>
    seconds === null ? `${count} 語を選択中` : `${count} 語を選択中 · ${secondsLabel(seconds)}`,
  cut: 'カット',
  restore: '復元',
  editWord: '単語を編集',
  deleteText: 'テキストを削除',
  clear: '選択を解除 · Esc',
  aiFind: 'カット候補を探す',
  aiFindHint: 'AI にフィラーや間を先に探してもらうこともできます',

  // 结果
  cutDone: (seconds: number, ranges: number) =>
    ranges > 1 ? `${secondsLabel(seconds)} をカットしました · ${ranges} か所` : `${secondsLabel(seconds)} をカットしました`,
  cutNothing: '選択した単語はすでにタイムラインにないため、カットするものがありません。',
  cutTooShort: '選択範囲が 1 フレームより短いため、カットできません。',
  restoreDone: (seconds: number) => `${secondsLabel(seconds)} を復元しました`,
  restoreNotRelaid: '一部のカットはタイムライン上に対応するつなぎ目がありません。カットの一覧からは外しましたが、内容は戻していません。',
  restoreRefused: {
    untracked: 'この範囲はカットで削除されたものではないため（クリップの端をドラッグしてトリムした場合など）、復元するカットがありません。タイムラインでクリップの端をドラッグして戻してください。',
    partial: 'この範囲は一部だけがカットで削除されているため、範囲を変更できません。先にカットの帯をクリックして、その部分を復元してください。',
  },
  textSaved: 'テキストを更新しました · 映像と音声は変更なし',
  textDeleted: (count: number) => `${count} 語のテキストを削除しました · 映像と音声は変更なし`,
  stale: (count: number) => `${count} 本の字幕トラックは古い文字起こしから作成されたため、更新されていません。`,
  gotoCaptions: '字幕を開く',
  undo: '取り消す',

  // 时间线剪口
  seamLabel: (seconds: number) => `${secondsLabel(seconds)} をカット済み · クリックして復元`,
  cutLabel: '文字起こしでカット',
  restoreLabel: 'カットした内容を復元',
  liveCopy: 'ここまでの文字起こしをコピー',
  liveCopied: 'ここまでの文字起こしをコピーしました · 文字起こしは続いています',
  liveSpeaker: '認識中',
  liveWaiting: '認識されたテキストは届きしだいここに表示されます。サービスによっては完了時にまとめて返されます。',
  liveNote: '認識されたテキストは段落ごとに表示されます。文字起こしが完了すると編集できます。',
  liveJump: '最新へ戻る',
  liveSaving: '文字起こしを保存中',
};

export const jaTranscriptTools: TranscriptToolsMessages = {
  // 工具菜单（原型 panels.jsx 文稿头上的 ✦，产品设计 §5.10）：整理文稿的四件，和从文稿出发的写作、发布
  toolsMenu: '文字起こしを整える',
  toolsTidy: '文字起こし全体を整える',
  toolsFrom: '文字起こしから始める',
  // 查找替换
  findTip: '検索と置換 · ⌘F',
  findLabel: '検索と置換',
  findPlaceholder: '文字起こし内を検索',
  lockTranslation: '訳文は検索できますが、ここでは編集できません。文字起こしパネルで編集できるのは原文だけです',
  lockLoading: 'この文字起こしの新しいバージョンを読み込み中です。完了してから置換してください',
  replaceLabel: '文字起こしのテキストを置換',
  replaceDone: (count: number) => `${count} 件を置換しました · 映像と音声は変更なし`,
  replaceNothing: '変更が必要な一致はありません',

  // 复制
  copyMenu: '文字起こしをコピー',
  copyAllHead: (lang: string) => `すべてコピー · ${lang}`,
  copyText: 'テキストをコピー',
  copySettings: 'コピー設定',
  copyWithSettings: 'コピー設定どおり',
  copyTextOnly: 'テキストのみコピー',
  textOnly: 'テキストのみ',
  keepCut: 'カットした部分を含む',
  copyConfirm: 'コピー',
  copyTranslationOnly: '訳文だけを表示中は、パネルの内容からコピーします。フロントマターは書かず、カットした部分は含みません。',
  copyScopeHead: (scope: string) => `${scope} をコピー`,
  copied: (scope: string, receipt: string) => `${scope} をコピーしました · ${receipt}`,
  copyFailed: 'コピーできませんでした · ブラウザがクリップボードへのアクセスを拒否しました',
  copyEmpty: 'コピーするものがありません',
  scopeAll: 'すべて',
  scopePara: 'この段落',
  scopeChapter: (title: string) => `「${title}」`,
  scopeSelection: '選択したテキスト',
  copySelection: 'コピー',
  copySelectionTip: '選択したテキストをコピー · ⌘C',

  // 语言视图（设计稿 `langShort` 与「文稿语言」菜单）
  langLabel: '文字起こしの言語',
  langSource: '原文',
  langTranslation: '訳文',
  langBoth: (source: string, translation: string) => `${source} + ${translation}`,
  showBoth: '原文も並べて表示',
  showBothNeedsTranslation: '先に訳文を選んでください',
  showBothHint: '対訳表示',
  noTranslation: '訳文はまだありません',
  noTranslationHint: '字幕パネルの「+ 翻訳先…」から翻訳してください',
  translationNote: '訳文は段落単位でのみ再生に追従します。単語のタイミングは原文にしかないため、単語単位でハイライトすると推測になってしまいます。',
  translationOnly: '訳文だけを表示している間は編集やカットができません。原文または対訳表示に戻して編集してください。',
  noParagraphTranslation: 'この段落には訳文がありません',

  // 段落行（设计稿 `ParaRow`）
  paraMenu: 'この段落…',
  moveUp: '前のチャプターへ移動',
  moveDown: '次のチャプターへ移動',
  play: '段落を再生',
  moveHead: 'チャプターへ移動',
  moveTo: (title: string) => `「${title}」へ移動`,
  moveWith: (count: number) => (count > 1 ? `その側の隣接する段落とまとめて移動します（計 ${count} 段落）` : 'この段落だけを移動します'),
  noPrev: 'この段落より前にチャプターがありません',
  noNext: 'この段落より後にチャプターがありません',
  moveBlocked: '移動するとこのチャプターが空になるか、隣のチャプターの開始位置を越えてしまいます',
  moveLabel: '段落を隣のチャプターへ移動',
  moved: (title: string, count: number) => (count > 1 ? `${count} 段落を「${title}」へ移動しました` : `「${title}」へ移動しました`),
  cutPara: 'この段落をカット',
  cutParaHint: '動画、音声、字幕をまとめてカットします。復元できます',

  // 章节头「这一章…」
  chapterMenu: 'このチャプター…',
  renameChapter: '名前を変更…',
  cutChapter: 'このチャプターをカット',
  cutChapterHint: '動画、音声、字幕をまとめてカットし、後ろのチャプターは前に詰められます',
  cutChapterLabel: 'チャプターをカット',
  cutChapterRefused: {
    empty: 'このチャプターには長さがありません',
    whole: 'このチャプターは動画全体です。カットすると何も残りません',
    'no-tracks': 'タイムライン上に文字起こし済みの素材を使うトラックがないため、カットするものがありません',
  },
  cutChapterDone: (title: string, seconds: number) => `「${title}」をカットしました · ${secondsLabel(seconds)}`,
  removeMarker: 'チャプターマーカーを削除',
  removeMarkerHint: 'マーカーだけを削除し、内容はそのままです',
  find: '検索',
  badRegex: '無効な正規表現',
  noResults: '結果なし',
  previous: '前へ',
  next: '次へ',
  closeFind: '検索を閉じる',
  replaceWith: '置換後',
  matchCase: '大文字と小文字を区別',
  wholeWordShort: '単語',
  wholeWord: '単語単位で一致',
  regex: '正規表現 · 置換テキストはそのまま挿入されます',
  replace: '置換',
  replaceAll: 'すべて置換',
  regexError: (error: string) => `正規表現のエラー：${error}`,
};
