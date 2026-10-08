import type { DubOriginalAudio } from '@baocut/protocol';
import type { DubMessages, DubRegenMessages, TimelineDubMessages } from './dub-copy.ts';

export const jaDub: DubMessages = {
  // 设置页
  title: '翻訳吹き替え',
  back: '戻る',
  web: '翻訳吹き替えにはデスクトップアプリが必要です',
  webBody: 'ブラウザで開いた BaoCut には固定ワークフロー（pipelines.*）がないため、ここでは翻訳吹き替えを開始できません。デスクトップアプリでこの動画を開いてください。',
  summary: (language: string, sentences: number | null, translate: boolean) =>
    `${translate ? `先に ${language} に翻訳してから` : `既存の ${language} の翻訳を使って`}、${sentences === null ? '1 文ずつ' : `${sentences} 文を 1 文ずつ`}音声合成し、それぞれを元の文のタイミングに合わせて、1 つの吹き替えグループとしてタイムラインに書き込みます`,
  language: '吹き替えの言語',
  languagePicker: '吹き替えの言語',
  languageLine: (translate: boolean, sentences: number | null) =>
    `${translate ? 'この言語の翻訳はまだありません · 先に翻訳します' : '既存の翻訳を使用 · 新たに翻訳しません'}${sentences === null ? '' : ` · ${sentences} 文`}`,
  allTaken: '吹き替えできる言語がありません。',
  staleNote: (n: number) =>
    `この翻訳のうち ${n} 文が古くなっています（原文が変更されたか、古いとマークされています）。これらの文は合成されず、完了後のサマリーに一覧表示されます。すべてを吹き替えるには、先に字幕パネルでこれらの文を翻訳し直してください。`,
  source: '原文',
  sourcePicker: '吹き替える文字起こし',
  sourceLine: (language: string, sentences: number | null) => (sentences === null ? language : `${language} · ${sentences} 文`),
  voiceModel: '音声モデル',
  voiceModelPicker: '合成に使う音声モデル',
  voiceModelsLoading: '音声モデルを読み込み中…',
  manageVoiceModels: '音声モデルを管理…',
  ttsMissingTitle: '使用できる音声モデルがまだありません',
  goTts: 'モデル › 音声合成 を開く',
  voice: '既定の声',
  voicePicker: '声が割り当てられていない話者に使用',
  voiceDefault: 'モデルの既定',
  voiceCustom: '声の ID',
  voiceCustomPlaceholder: 'プロバイダのアカウントにある声の ID',
  voiceHint: '下で声が割り当てられている話者はその声を、それ以外の話者はここで選んだ声を使います。',
  voiceCustomEmpty: '先に声の ID を入力するか、別の声を選んでください',
  speakers: '話者',
  speakersAside: (n: number) => `${n} 人`,
  speakersNone: 'この文字起こしには話者の情報がないため、すべての文で上の既定の声を使います。',
  speakersNote: '割り当てはこの動画に保存され（取り消せる編集）、次回の吹き替えでも使われます。優先順位：割り当て → 既定の声 → モデルの既定。',
  speakerLine: (sentences: number) => `${sentences} 文`,
  speakerBinding: (name: string) => `${name} に割り当てる声`,
  bindingNone: 'なし',
  bindingOther: (label: string) => `${label}（別の場所で割り当て）`,
  bindingIgnored: (provider: string) => `割り当てられた声は別のプロバイダのもののため、${provider} では使われません`,
  bindingReadOnly: '動画は読み取り専用のため、話者の声を変更できません。',
  bindingFailed: (message: string) => `話者の声を変更できませんでした：${message}`,
  bindingLoading: '話者に割り当てられた声を読み込み中…',
  bindingReadFailed: (message: string) => `この動画で話者に割り当てられた声を読み取れませんでした：${message}`,
  bindingSaved: (name: string) => `${name} に声を割り当てました`,
  bindingCleared: (name: string) => `${name} の声の割り当てを解除しました`,
  sourceVideo: '割り当て',
  sourceParams: '既定の声',
  sourceDefault: 'モデルの既定',
  effective: (label: string, source: string | null) => (source ? `使用中：${label}（${source}）` : `使用中：${label}`),
  speakerWarning: (reason: string) => `この話者の文は合成されません：${reason}`,
  manageVoices: 'マイボイスを管理…',
  mix: 'ミックス',
  separate: '背景音を分離',
  separateHint: '吹き替えは話し声だけを置き換え、音楽や環境音は残します',
  separateMissing: 'このコンピュータには使用できる分離モデルがありません。オンにしても分離はスキップされ、元の音声全体が処理されます。',
  installSeparate: '分離モデルをインストール…',
  original: '元の音声',
  originalPicker: '吹き替えの再生中に元の音声をどうするか',
  originalLabel: { duck: '下げる', mute: 'ミュート', keep: 'そのまま' },
  mixHint: (o: { separated: boolean; original: DubOriginalAudio; duckDb: number }) =>
    o.original === 'keep'
      ? `元の音声はそのまま、吹き替えと重ねて再生されます${o.separated ? '。そのままにする場合は分離しません' : ''}。`
      : `${o.separated ? '背景音は別トラックになり、元の音声は話し声だけが残って' : '分離しない場合、元の音声全体が'}${o.original === 'mute' ? 'ミュートされます' : ` −${o.duckDb} dB 下げられます`}。吹き替えトラックのヘッダからいつでも元の音声に戻せます。`,
  duckDb: '下げる量（dB）',
  duckLabel: '下げる',
  duckUnit: 'dB',
  translate: '翻訳',
  textModel: 'テキストモデル',
  textModelPicker: '翻訳に使うテキストモデル',
  textModelsLoading: 'テキストモデルを読み込み中…',
  manageTextModels: 'テキストモデルを管理…',
  textMissingTitle: '使用できるテキストモデルがまだありません',
  goLlm: 'モデル › テキスト生成 を開く',
  noStructured: '構造化出力に非対応 · 翻訳には使えません',
  style: 'スタイルのヒント',
  stylePlaceholder: '例：話し言葉で簡潔に。人名は原文のまま',
  styleHint: '任意。最大 500 文字。',
  cta: (language: string) => `${language} に吹き替える`,
  ctaHint: (language: string, stems: { separated: boolean; original: DubOriginalAudio }) => {
    const extra =
      !stems.separated || stems.original === 'keep' ? '' : stems.original === 'duck' ? '、「背景音」、「ボーカル」' : '、「背景音」';
    return `完了すると、タイムラインの「吹き替え · ${language}」${extra}トラックに書き込まれ、ワンクリックで取り消せます。オンラインモデルは呼び出しごとに課金されます。`;
  },
  noSpeechTitle: '吹き替えできる文字起こしがまだありません',
  noSpeech: '吹き替えは文字起こしの文ごとに行います。先に字幕パネルの「字幕を生成」で素材を文字起こししてください。',
  busy: 'この動画は吹き替え中です。終わってから次の吹き替えを開始してください。',
  readOnly: '動画は読み取り専用のため、吹き替えできません。',

  // 运行态
  submitting: '吹き替えを送信中',
  queued: '待機中',
  running: (language: string) => `吹き替え中 · ${language}`,
  stepUnits: (step: 'translate' | 'synthesize', done: number, total: number | null) =>
    `${step === 'translate' ? '翻訳' : '合成'} ${done}${total ? ` / ${total}` : ''} 文`,
  sentences: (running: number, failed: number) => [running ? `${running} 文を合成中` : '', failed ? `${failed} 文が失敗` : ''].filter(Boolean).join(' · '),
  cancel: '吹き替えをキャンセル',
  cancelled: '吹き替えをキャンセルしました',
  cancelFailed: (message: string) => `吹き替えをキャンセルできませんでした：${message}`,
  liveNote: '完了すると Runtime がタイムラインに直接書き込み、いつでもワンクリックで取り消せます。このページを離れてもかまいません。',
  foreign: 'この吹き替えはここから開始されたものではありません。完了したらタイムラインで確認し、取り消すにはエディタの「取り消す」を使ってください。',

  // 授权
  grantTitle: (recipient: string) => `${recipient} に文字起こしを送信する許可がまだありません`,
  grantBody: '吹き替えでは、合成する翻訳（翻訳がない部分は原文も）をプロバイダに送信します。この動画に限定した許可を発行すると続行します。発行しなければ何も送信されません。',
  grantAction: '許可して開始',
  grantRetryAction: '許可して再試行',
  grantDialogTitle: 'データ送信の許可を発行',
  grantDialogIntro: '確定すると、BaoCut はこの許可を記録して吹き替えを続行します：',
  grantConfirm: '許可して続行',
  grantCancel: '今はしない',
  granting: '許可を発行中…',
  grantFailed: (message: string) => `許可を発行できませんでした：${message}`,
  grantStillRefused: '許可を発行しても拒否されました',
  grantNext: '翻訳と合成で別のプロバイダを使う場合は、それぞれに許可が必要です。',
  commands: 'コマンドライン',

  // 问题
  notConfigured: 'まだ吹き替えできません',
  submitFailed: '吹き替えを開始できませんでした',
  failed: '吹き替えに失敗しました',
  interrupted: '吹き替えが中断されました',
  retry: '再試行',
  retryFailed: (message: string) => `再試行できませんでした：${message}`,
  retryCharges: '再試行すると、止まったステップから再開します。「翻訳」で止まった場合はそのステップ全体をやり直すため、翻訳済みのバッチでもモデルが再度呼び出され、再び課金されることがあります。',
  retryPartial: '再試行すると「文ごとの合成」から再開します。合成済みの文は再利用し、失敗した文と未合成の文だけを合成します。',
  retryFree: '再試行すると、止まったステップから再開します。完了済みのステップは再利用され、そのためにモデルを再度呼び出すことはありません。',
  retryFrozen: '話者の声の割り当ては開始時に固定されています。声の修正（クローンし直す、本人の表明を追加する）は再試行に反映されますが、割り当てを変更するには吹き替えをやり直す必要があります。',
  failedUnits: (n: number) => `${n} 文の合成に失敗しました`,
  stoppedAt: (synthesized: number, remaining: number) => `${synthesized} 文を合成した時点で停止しました。残り ${remaining} 文`,
  dismiss: 'OK',

  // 收据
  doneTitle: (language: string) => `${language} に吹き替えました`,
  doneToast: (language: string, placed: number) => `${language} に吹き替えました · ${placed} 文をタイムラインに配置`,
  placed: (placed: number, total: number) => `${placed} / ${total} 文をタイムラインに配置`,
  fitHead: '各文の配置結果',
  speakersHead: '話者の声',
  speakerUnits: (n: number) => `${n} 文`,
  speakerNone: '話者なし',
  voiceFailedHead: 'これらの話者の文は合成されませんでした',
  voiceFailedLine: (name: string, n: number, reason: string) => `${name} · ${n} 文 · ${reason}`,
  voiceFailedFix: 'この吹き替えは完了しているため、再試行できません：この吹き替えグループを取り消す → 声を修正する（クローンし直す、本人の表明を追加する）か割り当てを変更する → もう一度吹き替える。',
  synthesisLine: (calls: number, retries: number, failures: number, reused: number) =>
    [`呼び出し ${calls} 回`, retries ? `再送 ${retries} 回` : '', failures ? `失敗 ${failures} 回` : '', reused ? `${reused} 文を再利用` : '']
      .filter(Boolean)
      .join(' · '),
  translationCreated: '今回新たに作成した翻訳は動画に保存されています（吹き替えを取り消しても削除されません）',
  translationUsed: '既存の翻訳を使用しました',
  glossaryUsed: (n: number) => `用語集を ${n} 個使用`,
  warnings: '注意',
  undo: 'この吹き替えを取り消す',
  undoing: '取り消し中…',
  undone: 'この吹き替えを取り消しました',
  undonePartial: 'この吹き替えのクリップ、ミュート、ダッキングを取り消しました。空の吹き替えトラックと吹き替えプランのドキュメントは動画に残ります（プロトコルにトラックやドキュメントを削除する操作がないため）。',
  undoLabel: (language: string) => `吹き替えを取り消す（${language}）`,
  undoFailed: 'この吹き替えを取り消せませんでした',
  undoNotOpen: 'この吹き替えを取り消すには、先にその動画を開いてください。',
  close: '閉じる',
  again: 'もう一度吹き替える',
  providerFallback: 'このプロバイダ',
  unknownLanguage: '不明な言語',
};

export const jaTimelineDub: TimelineDubMessages = {
  trackLabel: (language: string) => `吹き替え · ${language}`,
  stemTrackLabel: (stem: 'background' | 'vocals', language: string) => `${stem === 'vocals' ? 'ボーカル' : '背景音'} · ${language}`,
  rate: (rate: number, fast: boolean) => `${rate.toFixed(2)}×${fast ? ' · 速すぎ' : ''}`,
  stretching: (rate: number, seconds: number) => `${rate.toFixed(2)}× · ${seconds.toFixed(2)} 秒`,
  tip: (parts: { text: string; speaker: string | null; rate: string; muted: boolean; manual: boolean; editable: boolean }) =>
    [
      parts.text,
      parts.speaker,
      parts.rate,
      parts.muted ? 'ミュート中' : '',
      parts.manual ? '速度を手動で変更済み' : '',
      parts.editable ? '右端をドラッグして長さを変更 · 右クリックでその他' : '',
    ]
      .filter(Boolean)
      .join(' · '),
  menuLabel: (title: string) => `「${title}」の吹き替えメニュー`,
  selection: (n: number) => `${n} 文を選択中`,
  count: (n: number) => (n > 1 ? `この ${n} 文` : 'この文'),
  listen: 'この文を再生',
  listenHint: (timecode: string, seconds: number, rate: string) => `${timecode} · ${seconds.toFixed(1)} 秒${rate ? ` · ${rate}` : ''}`,
  mute: (allMuted: boolean, n: number) => `${n > 1 ? `この ${n} 文` : 'この文'}を${allMuted ? 'ミュート解除' : 'ミュート'}`,
  muteHint: (allMuted: boolean) => (allMuted ? 'これらの文の吹き替えを戻す' : 'これらの文を無音にする · 書き出しにも反映'),
  remove: (n: number) => `${n > 1 ? `この ${n} 文` : 'この文'}を削除`,
  removeHint: '吹き替えトラックから外す · 取り消し可能',
  removeGroup: 'この吹き替えグループを削除',
  removeGroupHint: (bed: boolean) => `${bed ? '背景音とあわせて削除' : 'この言語の吹き替えをすべて削除'} · これによりミュートされていた元の音声は戻ります`,
  labelMute: '吹き替えをミュート',
  labelUnmute: '吹き替えのミュートを解除',
  labelRemove: '吹き替えを削除',
  labelRemoveGroup: (language: string) => `吹き替えを削除（${language}）`,
  labelStretch: '吹き替えの速度を変更',
  muted: (n: number) => `吹き替え ${n} 文をミュートしました`,
  unmuted: (n: number) => `吹き替え ${n} 文のミュートを解除しました`,
  removed: (n: number) => `吹き替え ${n} 文を削除しました`,
  groupRemoved: (language: string) => `「吹き替え · ${language}」を削除しました · 空の吹き替えトラックと吹き替えプランのドキュメントは動画に残ります`,
  planUnread: '吹き替えプランを読み取れませんでした：これによりミュートされていた元の音声は戻っていません。元のクリップでミュートを解除できます',
};

export const jaDubRegen: DubRegenMessages = {
  // ---- 行头 ⋯ ----
  headMenu: (label: string) => `「${label}」トラック`,
  headLine: (c: { total: number; fast: number; muted: number; failed: number; queued: number }) =>
    [
      `${c.total} 文`,
      c.failed ? `${c.failed} 文が未合成` : '',
      c.fast ? `${c.fast} 文が速すぎ` : '',
      c.muted ? `${c.muted} 文がミュート` : '',
      c.queued ? `${c.queued} 文を再生成中` : '',
    ]
      .filter(Boolean)
      .join(' · '),
  listenDub: '吹き替えを聴く',
  listenDubHint: (o: { bed: boolean; duck: boolean; others: boolean }) =>
    `このグループの吹き替え${o.bed ? ' + 背景音' : ''} · ${o.duck ? '元の音声を下げる' : '元の音声をミュート'}${o.others ? ' · ほかの言語はオフ' : ''}`,
  listenDubKeep: 'この吹き替えグループは元の音声を残しており、元の音声がどの部分かを記録していません。「両方を聴く」を使ってください',
  listenOriginal: '元の音声を聴く',
  listenOriginalHint: (others: boolean) => `動画の元の音声を戻す · ${others ? 'すべての吹き替えグループ' : 'この吹き替えグループ'}をミュート`,
  listenBoth: '両方を聴く',
  listenBothHint: (bed: boolean) => `聴き比べ用${bed ? ' · このグループの背景音はオフ' : ''}`,
  sourceLabel: { dub: '吹き替えを聴く', original: '元の音声を聴く', both: '両方を聴く' },
  sourceDone: {
    dub: (language: string) => `「吹き替え · ${language}」を再生中`,
    original: '元の音声を再生中 · 吹き替えはミュート',
    both: '元の音声と吹き替えを同時に再生中',
  },
  regenSome: (n: number) => (n ? `${n} 文を再生成…` : '再生成…'),
  regenSomeHint: (failed: number, fast: number) =>
    failed || fast
      ? `${[failed ? `${failed} 文が未合成` : '', fast ? `${fast} 文が速すぎ` : ''].filter(Boolean).join(' · ')} · 先に翻訳を編集できます`
      : '未合成や速すぎる文はありません',
  redub: 'もう一度吹き替える…',
  redubHint: '翻訳吹き替えを開く：言語や声を変えて、グループ全体をやり直します',
  readOnly: '動画は読み取り専用です',

  // ---- 块菜单 ----
  regenBlocks: (n: number) => `${n > 1 ? `この ${n} 文` : 'この文'}を再生成`,
  regenBlocksHint: '同じ翻訳と声でもう一度合成 · シードを変更 · 以前のテイクは残ります',
  retext: '翻訳を編集して吹き替え直す…',
  retextHint: '先に長さを確認して翻訳を編集し、これらの文だけを吹き替え直します',
  inQueue: '再生成中の文があります',

  // ---- 块 ----
  queued: '再生成中…',
  queuedTip: (text: string) => `${text} · 再生成中`,
  version: (k: number, seed: number | null) => (seed === null ? `テイク ${k}` : `テイク ${k} · シード ${seed}`),

  // ---- 提交与收尾 ----
  submitted: (n: number) => `吹き替え ${n} 文の再生成を開始しました`,
  submitFailed: (message: string) => `再生成を開始できませんでした：${message}`,
  grantRefused: (recipient: string) => `再生成では翻訳を ${recipient} に送信しますが、まだ許可がありません。設定で許可を発行するか、翻訳吹き替えからやり直してください`,
  busy: 'このグループは送信中です。しばらくお待ちください',
  done: (replaced: number, total: number) => (replaced === total ? `吹き替え ${replaced} 文を再生成しました` : `吹き替え ${replaced}/${total} 文を再生成しました`),
  doneNone: '新しいテイクに置き換わった文はありません',
  notPlaced: (status: string, n: number) =>
    status === 'overlong'
      ? `${n} 文は収まらなかったため、以前のテイクを残しました`
      : status === 'stale'
        ? `${n} 文は翻訳が古いため、合成しませんでした`
        : status === 'voice-unavailable'
          ? `${n} 文は声が使用できないため、合成しませんでした`
          : `${n} 文はタイムライン上にありません`,
  failed: (message: string) => `再生成が完了しませんでした：${message}`,
  cancelled: '再生成をキャンセルしました',
  undo: '取り消す',
  undoMissing: 'この再生成で書き込まれた編集が見つかりません。エディタの「取り消す」を使ってください',
  labelRetext: '翻訳を編集（吹き替え直し）',

  // ---- 改译文并重配 ----
  fitTitle: (n: number) => `翻訳を編集して ${n} 文を吹き替え直す`,
  fitIntro: '編集するのは、合成で読み上げられる翻訳文です（編集した文は確認済みになります）。そこから作られた字幕は分割し直されません。各文はシードを変えて再度合成され、以前のテイクは残ります。',
  fitDub: (seconds: number, rate: string) => `吹き替え ${seconds.toFixed(1)} 秒${rate ? ` · ${rate}` : ''}`,
  fitVoice: '未合成：声が使用できません',
  fitOverlong: (seconds: number | null) => (seconds === null ? '未配置：長すぎます' : `未配置：${seconds.toFixed(1)} 秒長すぎます`),
  fitLoading: '翻訳を読み込み中…',
  fitUnreadable: (message: string) => `この吹き替えの翻訳を読み取れませんでした（${message}）。元の翻訳のまま吹き替え直します`,
  fitMissing: 'この文は翻訳にありません。プランの原稿で吹き替え直します',
  fitText: (index: number) => `${index} 番目の文の翻訳`,
  fitCancel: 'キャンセル',
  fitSubmit: (n: number, changed: number) => (changed ? `${changed} 文を編集して ${n} 文を吹き替え直す` : `${n} 文を吹き替え直す`),
  fitBusy: '送信中…',

  // ---- 属性页的版本 ----
  takesTitle: 'テイク',
  takesAside: (n: number) => `${n} テイク`,
  takeCurrent: '現在',
  takeUse: 'このテイクに切り替え',
  takeLine: (seed: number | null, seconds: number | null, tempo: number | null) =>
    [
      seed !== null ? `シード ${seed}` : '',
      seconds !== null ? `${seconds.toFixed(1)} 秒` : '未配置',
      tempo !== null && Math.abs(tempo - 1) >= 0.005 ? `${tempo.toFixed(2)}×` : '',
    ]
      .filter(Boolean)
      .join(' · '),
  takeUnavailable: 'このテイクはタイムライン上にないか、素材が見つかりません',
  takesNote: '再生成するたびにテイクが記録されます。以前のテイクに切り替えるのは取り消せる編集で、再合成はしません。',
  takeName: (k: number) => `テイク ${k}`,
  labelSwitchTake: (k: number) => `吹き替えのテイク ${k} に切り替え`,
  switched: (k: number) => `テイク ${k} に切り替えました`,
  regenThis: 'この文を再生成',
  unreadableFormat: '認識できない形式',
  unreadableNoTranslation: 'プランに翻訳がありません',
};
