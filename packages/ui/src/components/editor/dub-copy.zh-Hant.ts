import type { DubOriginalAudio } from '@baocut/protocol';
import type { DubMessages, DubRegenMessages, TimelineDubMessages } from './dub-copy.ts';

export const zhHantDub: DubMessages = {
  // 设置页
  title: '翻譯配音',
  back: '返回',
  web: '翻譯配音需要桌面版',
  webBody: '在瀏覽器中開啟的 BaoCut 不提供固定流程（pipelines.*），因此無法在這裡開始翻譯配音。請在桌面版中開啟這部影片。',
  summary: (language: string, count: number | null, translate: boolean) =>
    `${translate ? `先翻譯成${language}，再` : `使用現有的${language}譯文，`}${count === null ? '' : `為 ${count} 句`}逐句合成語音，將每句對齊到原句的時間，並作為一組配音寫入時間軸`,
  language: '配音語言',
  languagePicker: '配音語言',
  languageLine: (translate: boolean, count: number | null) =>
    `${translate ? '還沒有這個語言的譯文 · 先翻譯' : '使用現有譯文 · 不重新翻譯'}${count === null ? '' : ` · ${count} 句`}`,
  allTaken: '沒有可以配音的語言。',
  staleNote: (n: number) =>
    `這份譯文有 ${n} 句已過期（原文已修改或被標為過期）。這些句子不會合成，並會列在摘要中。如需完整的配音，請先在字幕面板中重新翻譯這些句子。`,
  source: '原文',
  sourcePicker: '要配音的逐字稿',
  sourceLine: (language: string, count: number | null) => (count === null ? language : `${language} · ${count} 句`),
  voiceModel: '語音模型',
  voiceModelPicker: '合成用的語音模型',
  voiceModelsLoading: '正在載入語音模型…',
  manageVoiceModels: '管理語音模型…',
  ttsMissingTitle: '還沒有可用的語音模型',
  goTts: '開啟「模型 › 語音合成」',
  voice: '預設音色',
  voicePicker: '用於沒有指定音色的說話者',
  voiceDefault: '模型預設',
  voiceCustom: '音色 ID',
  voiceCustomPlaceholder: '供應商帳號中的音色 ID',
  voiceHint: '下方已指定音色的說話者使用自己的音色；其餘說話者使用這裡選擇的音色。',
  voiceCustomEmpty: '請先輸入音色 ID，或選擇其他音色',
  speakers: '說話者',
  speakersAside: (n: number) => `${n} 位`,
  speakersNone: '這份逐字稿沒有說話者資訊，因此每一句都使用上方的預設音色。',
  speakersNote: '指定的音色會儲存在這部影片中（一筆可以還原的編輯），下次配音時沿用。優先順序：指定 → 預設音色 → 模型預設。',
  speakerLine: (count: number) => `${count} 句`,
  speakerBinding: (name: string) => `指定給 ${name} 的音色`,
  bindingNone: '無',
  bindingOther: (label: string) => `${label}（在其他地方指定）`,
  bindingIgnored: (provider: string) => `指定的音色屬於其他供應商，使用 ${provider} 時不會套用`,
  bindingReadOnly: '影片為唯讀，無法變更說話者的音色。',
  bindingFailed: (message: string) => `無法變更說話者的音色：${message}`,
  bindingLoading: '正在載入說話者的音色…',
  bindingReadFailed: (message: string) => `無法讀取這部影片中為說話者指定的音色：${message}`,
  bindingSaved: (name: string) => `已為 ${name} 指定音色`,
  bindingCleared: (name: string) => `已移除 ${name} 的音色指定`,
  sourceVideo: '指定',
  sourceParams: '預設音色',
  sourceDefault: '模型預設',
  effective: (label: string, source: string | null) => (source ? `使用：${label}（${source}）` : `使用：${label}`),
  speakerWarning: (reason: string) => `這位說話者的句子不會合成：${reason}`,
  manageVoices: '管理我的音色…',
  mix: '混音',
  separate: '分離背景聲',
  separateHint: '配音只取代人聲，音樂與環境音會保留',
  separateMissing: '這台電腦上沒有可用的分離模型；即使開啟也會略過分離，原聲整段一起處理。',
  installSeparate: '安裝分離模型…',
  original: '原聲',
  originalPicker: '配音播放時如何處理原聲',
  originalLabel: { duck: '壓低', mute: '靜音', keep: '保留' },
  mixHint: (o: { separated: boolean; original: DubOriginalAudio; duckDb: number }) =>
    o.original === 'keep'
      ? `原聲保持原樣，在配音底下播放${o.separated ? '；保留原聲時不會分離' : ''}。`
      : `${o.separated ? '背景聲獨立成一條軌道，原聲只留下人聲，人聲會' : '不分離時，整段原聲會'}${o.original === 'mute' ? '靜音' : `壓低 −${o.duckDb} dB`}。你隨時可以在配音軌道的軌道標頭切回原聲。`,
  duckDb: '壓低多少（dB）',
  duckLabel: '壓低',
  duckUnit: 'dB',
  translate: '翻譯',
  textModel: '文字模型',
  textModelPicker: '翻譯用的文字模型',
  textModelsLoading: '正在載入文字模型…',
  manageTextModels: '管理文字模型…',
  textMissingTitle: '還沒有可用的文字模型',
  goLlm: '開啟「模型 › 文字生成」',
  noStructured: '不支援結構化輸出 · 無法用於翻譯',
  style: '風格提示',
  stylePlaceholder: '例如：口語、簡潔；人名保留原文',
  styleHint: '選填；最多 500 字。',
  cta: (language: string) => `配成${language}`,
  ctaHint: (language: string, stems: { separated: boolean; original: DubOriginalAudio }) => {
    const extra =
      !stems.separated || stems.original === 'keep' ? '' : stems.original === 'duck' ? '、「背景聲」和「人聲」' : '和「背景聲」';
    return `完成後會寫入時間軸上的「配音 · ${language}」${extra}軌道，一鍵即可還原。線上模型依呼叫次數計費。`;
  },
  noSpeechTitle: '還沒有可以配音的逐字稿',
  noSpeech: '配音會依逐字稿逐句進行。請先在字幕面板中用「生成字幕」轉錄一段素材。',
  busy: '這部影片已有配音正在進行，請等它完成後再開始另一次。',
  readOnly: '影片為唯讀，無法配音。',

  // 运行态
  submitting: '正在送出配音',
  queued: '排隊中',
  running: (language: string) => `配音中 · ${language}`,
  stepUnits: (step: 'translate' | 'synthesize', done: number, total: number | null) =>
    `已${step === 'translate' ? '翻譯' : '合成'} ${done}${total ? ` / ${total}` : ''} 句`,
  sentences: (running: number, failed: number) =>
    [running ? `${running} 句合成中` : '', failed ? `${failed} 句失敗` : ''].filter(Boolean).join(' · '),
  cancel: '取消配音',
  cancelled: '已取消配音',
  cancelFailed: (message: string) => `無法取消配音：${message}`,
  liveNote: '完成後 Runtime 會直接寫入時間軸，你隨時可以還原。可以離開這個頁面。',
  foreign: '這次配音不是從這裡開始的。完成後請到時間軸上查看；要還原請使用編輯器的「還原」。',

  // 授权
  grantTitle: (recipient: string) => `還沒有將逐字稿傳送給 ${recipient} 的授權`,
  grantBody:
    '配音會將要合成的譯文（缺少譯文時則為原文）傳送給供應商。請授權僅限這部影片的資料外傳以繼續；未授權就不會傳送任何內容。',
  grantAction: '授權並開始',
  grantRetryAction: '授權並重試',
  grantDialogTitle: '授權資料外傳',
  grantDialogIntro: '確認後，BaoCut 會記錄這項授權並繼續配音：',
  grantConfirm: '授權並繼續',
  grantCancel: '暫時不要',
  granting: '正在授權…',
  grantFailed: (message: string) => `無法授權：${message}`,
  grantStillRefused: '授權後仍遭拒絕',
  grantNext: '翻譯與合成使用不同的供應商時，各需要一項授權。',
  commands: '命令列',

  // 问题
  notConfigured: '目前還無法配音',
  submitFailed: '無法開始配音',
  failed: '配音失敗',
  interrupted: '配音已中斷',
  retry: '重試',
  retryFailed: (message: string) => `無法重試：${message}`,
  retryCharges:
    '重試會從停止的步驟接續。如果停在「翻譯」，整個步驟會重新執行；已翻譯的批次會再次呼叫模型，可能再次計費。',
  retryPartial: '重試會從「逐句合成」接續：已合成的句子會沿用，只合成失敗或剩下的句子。',
  retryFree: '重試會從停止的步驟接續；先前完成的步驟會沿用，不會再次呼叫模型。',
  retryFrozen:
    '說話者的音色指定在開始時就已固定：修正音色（重新克隆、補上本人聲明）對重試有效，但變更指定需要重新配音。',
  failedUnits: (n: number) => `${n} 句合成失敗`,
  stoppedAt: (synthesized: number, remaining: number) => `已合成 ${synthesized} 句後停止，還剩 ${remaining} 句`,
  dismiss: '好',

  // 收据
  doneTitle: (language: string) => `已配成${language}`,
  doneToast: (language: string, placed: number) => `已配成${language} · ${placed} 句已放上時間軸`,
  placed: (placed: number, total: number) => `${placed} / ${total} 句已放上時間軸`,
  fitHead: '每句的去向',
  speakersHead: '說話者的音色',
  speakerUnits: (n: number) => `${n} 句`,
  speakerNone: '沒有說話者',
  voiceFailedHead: '這些說話者的句子沒有合成',
  voiceFailedLine: (name: string, n: number, reason: string) => `${name} · ${n} 句 · ${reason}`,
  voiceFailedFix:
    '這次配音已完成，無法重試：還原這組配音 → 修正音色（重新克隆、補上本人聲明）或變更指定 → 重新配音。',
  synthesisLine: (calls: number, retries: number, failures: number, reused: number) =>
    [
      `呼叫 ${calls} 次`,
      retries ? `重新傳送 ${retries} 次` : '',
      failures ? `失敗 ${failures} 次` : '',
      reused ? `沿用 ${reused} 句` : '',
    ]
      .filter(Boolean)
      .join(' · '),
  translationCreated: '這次新產生的譯文已儲存在影片中（還原配音不會刪除它）',
  translationUsed: '使用了現有的譯文',
  glossaryUsed: (n: number) => `使用了 ${n} 份術語表`,
  warnings: '警告',
  undo: '還原這組配音',
  undoing: '正在還原…',
  undone: '已還原配音',
  undonePartial:
    '已還原這組配音的片段、靜音與壓低。空的配音軌道與配音計畫文件仍留在影片中（協定沒有刪除軌道或文件的操作）。',
  undoLabel: (language: string) => `還原配音（${language}）`,
  undoFailed: '無法還原這組配音',
  undoNotOpen: '要還原這組配音，請先開啟那部影片。',
  close: '關閉',
  again: '重新配音',
  providerFallback: '這家供應商',
  unknownLanguage: '未知語言',
};

export const zhHantTimelineDub: TimelineDubMessages = {
  trackLabel: (language: string) => `配音 · ${language}`,
  stemTrackLabel: (stem: 'background' | 'vocals', language: string) => `${stem === 'vocals' ? '人聲' : '背景聲'} · ${language}`,
  rate: (rate: number, fast: boolean) => `${rate.toFixed(2)}×${fast ? ' · 過快' : ''}`,
  stretching: (rate: number, seconds: number) => `${rate.toFixed(2)}× · ${seconds.toFixed(2)} s`,
  tip: (parts: { text: string; speaker: string | null; rate: string; muted: boolean; manual: boolean; editable: boolean }) =>
    [
      parts.text,
      parts.speaker,
      parts.rate,
      parts.muted ? '已靜音' : '',
      parts.manual ? '已手動變更語速' : '',
      parts.editable ? '拖曳右緣可變更長度 · 按右鍵查看更多' : '',
    ]
      .filter(Boolean)
      .join(' · '),
  menuLabel: (title: string) => `「${title}」的配音選單`,
  selection: (n: number) => `已選取 ${n} 句`,
  count: (n: number) => (n > 1 ? `這 ${n} 句` : '這一句'),
  listen: '播放這一句',
  listenHint: (timecode: string, seconds: number, rate: string) => `${timecode} · ${seconds.toFixed(1)} s${rate ? ` · ${rate}` : ''}`,
  mute: (allMuted: boolean, n: number) => `將${n > 1 ? `這 ${n} 句` : '這一句'}${allMuted ? '取消靜音' : '靜音'}`,
  muteHint: (allMuted: boolean): string => (allMuted ? '回復這些句子的配音' : '這些句子不出聲 · 匯出時也一樣'),
  remove: (n: number) => `刪除${n > 1 ? `這 ${n} 句` : '這一句'}`,
  removeHint: '從配音軌道移除 · 可以還原',
  removeGroup: '移除這組配音',
  removeGroupHint: (bed: boolean) => `${bed ? '連同它的背景聲一起移除' : '移除這個語言的所有配音'} · 因它而靜音的原聲會回復`,
  labelMute: '將配音靜音',
  labelUnmute: '取消配音靜音',
  labelRemove: '刪除配音',
  labelRemoveGroup: (language: string) => `移除配音（${language}）`,
  labelStretch: '變更配音語速',
  muted: (n: number) => `已將 ${n} 句配音靜音`,
  unmuted: (n: number) => `已取消 ${n} 句配音的靜音`,
  removed: (n: number) => `已刪除 ${n} 句配音`,
  groupRemoved: (language: string) => `已移除「配音 · ${language}」· 空的配音軌道與配音計畫文件仍留在影片中`,
  planUnread: '無法讀取配音計畫：因它而靜音的原聲沒有回復。你可以在原始片段上取消靜音。',
};

export const zhHantDubRegen: DubRegenMessages = {
  // ---- 行头 ⋯ ----
  headMenu: (label: string) => `「${label}」軌道`,
  headLine: (c: { total: number; fast: number; muted: number; failed: number; queued: number }) =>
    [
      `${c.total} 句`,
      c.failed ? `${c.failed} 句未合成` : '',
      c.fast ? `${c.fast} 句過快` : '',
      c.muted ? `${c.muted} 句已靜音` : '',
      c.queued ? `${c.queued} 句重新生成中` : '',
    ]
      .filter(Boolean)
      .join(' · '),
  listenDub: '聽配音',
  listenDubHint: (o: { bed: boolean; duck: boolean; others: boolean }) =>
    `這組的配音${o.bed ? ' + 背景聲' : ''} · ${o.duck ? '原聲壓低' : '原聲靜音'}${o.others ? ' · 其他語言關閉' : ''}`,
  listenDubKeep: '這組配音保留了原聲，沒有記錄原聲是哪些部分；請使用「兩者都聽」',
  listenOriginal: '聽原聲',
  listenOriginalHint: (others: boolean) => `回復影片的原聲 · ${others ? '所有配音組' : '這組配音'}靜音`,
  listenBoth: '兩者都聽',
  listenBothHint: (bed: boolean) => `用於對照${bed ? ' · 這組的背景聲關閉' : ''}`,
  sourceLabel: { dub: '聽配音', original: '聽原聲', both: '兩者都聽' },
  sourceDone: {
    dub: (language: string) => `正在聽「配音 · ${language}」`,
    original: '正在聽原聲 · 配音已靜音',
    both: '原聲與配音一起播放',
  },
  regenSome: (n: number) => (n ? `重新生成 ${n} 句…` : '重新生成…'),
  regenSomeHint: (failed: number, fast: number) =>
    failed || fast
      ? `${[failed ? `${failed} 句未合成` : '', fast ? `${fast} 句過快` : ''].filter(Boolean).join(' · ')} · 可以先修改譯文`
      : '沒有未合成或過快的句子',
  redub: '重新配音…',
  redubHint: '開啟翻譯配音：變更語言或音色，整組重做',
  readOnly: '影片為唯讀',

  // ---- 块菜单 ----
  regenBlocks: (n: number) => `重新生成${n > 1 ? `這 ${n} 句` : '這一句'}`,
  regenBlocksHint: '用相同的譯文與音色再合成一次 · 新的種子 · 保留舊版本',
  retext: '修改譯文並重新配音…',
  retextHint: '先檢查長度並修改譯文，再只為這些句子重新配音',
  inQueue: '有句子正在重新生成',

  // ---- 块 ----
  queued: '重新生成中…',
  queuedTip: (text: string) => `${text} · 重新生成中`,
  version: (k: number, seed: number | null) => (seed === null ? `第 ${k} 版` : `第 ${k} 版 · 種子 ${seed}`),

  // ---- 提交与收尾 ----
  submitted: (n: number) => `已開始重新生成 ${n} 句配音`,
  submitFailed: (message: string) => `無法開始重新生成：${message}`,
  grantRefused: (recipient: string) =>
    `重新生成會將譯文傳送給 ${recipient}，但目前還沒有授權。請在設定中授權，或從翻譯配音重新開始`,
  busy: '這組正在送出，請稍候',
  done: (replaced: number, total: number) =>
    replaced === total ? `已重新生成 ${replaced} 句配音` : `已重新生成 ${replaced}/${total} 句配音`,
  doneNone: '沒有句子換上新版本',
  notPlaced: (status: string, n: number) =>
    status === 'overlong'
      ? `${n} 句放不下，已保留先前的版本`
      : status === 'stale'
        ? `${n} 句的譯文已過期，沒有合成`
        : status === 'voice-unavailable'
          ? `${n} 句的音色無法使用，沒有合成`
          : `${n} 句不在時間軸上`,
  failed: (message: string) => `重新生成未完成：${message}`,
  cancelled: '已取消重新生成',
  undo: '還原',
  undoMissing: '找不到這次重新生成寫入的編輯，請使用編輯器的「還原」',
  labelRetext: '修改譯文（重新配音）',

  // ---- 改译文并重配 ----
  fitTitle: (n: number) => `修改譯文並為 ${n} 句重新配音`,
  fitIntro:
    '你修改的是要唸出來的譯文句子（修改過的會標為已校對）；由它產生的字幕不會重新切分。每一句都會用新的種子重新合成，並保留舊版本。',
  fitDub: (seconds: number, rate: string) => `配音 ${seconds.toFixed(1)} s${rate ? ` · ${rate}` : ''}`,
  fitVoice: '未合成：音色無法使用',
  fitOverlong: (seconds: number | null) => (seconds === null ? '未放上：太長' : `未放上：超出 ${seconds.toFixed(1)} s`),
  fitLoading: '正在載入譯文…',
  fitUnreadable: (message: string) => `無法讀取這組配音的譯文（${message}）；只能依原本的譯文重新配音`,
  fitMissing: '譯文中沒有這一句；將依計畫中的稿子重新配音',
  fitText: (index: number) => `第 ${index} 句的譯文`,
  fitCancel: '取消',
  fitSubmit: (n: number, changed: number) => (changed ? `修改 ${changed} 句並為 ${n} 句重新配音` : `為 ${n} 句重新配音`),
  fitBusy: '正在送出…',

  // ---- 属性页的版本 ----
  takesTitle: '版本',
  takesAside: (n: number) => `${n} 版`,
  takeCurrent: '目前',
  takeUse: '切換到這一版',
  takeLine: (seed: number | null, seconds: number | null, tempo: number | null) =>
    [
      seed !== null ? `種子 ${seed}` : '',
      seconds !== null ? `${seconds.toFixed(1)} s` : '未放上',
      tempo !== null && Math.abs(tempo - 1) >= 0.005 ? `${tempo.toFixed(2)}×` : '',
    ]
      .filter(Boolean)
      .join(' · '),
  takeUnavailable: '這一版不在時間軸上，或找不到它的素材',
  takesNote: '每次重新生成都會記錄一個版本；切回舊版本是一筆可以還原的編輯，不會重新合成。',
  takeName: (k: number) => `第 ${k} 版`,
  labelSwitchTake: (k: number) => `切換到配音第 ${k} 版`,
  switched: (k: number) => `已切換到第 ${k} 版`,
  regenThis: '重新生成這一句',
  unreadableFormat: '無法辨識的格式',
  unreadableNoTranslation: '計畫中沒有譯文',
};
