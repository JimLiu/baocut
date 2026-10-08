import type { DubOriginalAudio } from '@baocut/protocol';
import type { DubMessages, DubRegenMessages, TimelineDubMessages } from './dub-copy.ts';

export const zhDub: DubMessages = {
  // 设置页
  title: '翻译配音',
  back: '返回',
  web: '翻译配音要在桌面版里用',
  webBody: '浏览器里打开的 BaoCut 不提供固定流程（pipelines.*），这里没法开始翻译配音。在桌面版里打开这个视频再来。',
  summary: (language: string, sentences: number | null, translate: boolean) =>
    `${translate ? '先翻译成' : '用已有的'}${language}${translate ? '' : '译文'}，${sentences === null ? '' : `${sentences} 句`}逐句合成语音、对齐到原句的时间，作为一组配音写进时间线`,
  language: '配成哪种语言',
  languagePicker: '配音语言',
  languageLine: (translate: boolean, sentences: number | null) =>
    `${translate ? '还没有这门语言的译文 · 先翻译' : '用已有译文 · 不再翻译'}${sentences === null ? '' : ` · ${sentences} 句`}`,
  allTaken: '没有能配的语言。',
  staleNote: (n: number) => `这份译文有 ${n} 句过期（原文改过或标了过期）：这几句不合成，完成后在收据里列出。先在字幕面板里重译这几句，再配就齐了。`,
  source: '原文',
  sourcePicker: '配哪一份转写',
  sourceLine: (language: string, sentences: number | null) => (sentences === null ? language : `${language} · ${sentences} 句`),
  voiceModel: '声音模型',
  voiceModelPicker: '合成用的语音模型',
  voiceModelsLoading: '正在读取语音模型…',
  manageVoiceModels: '管理语音模型…',
  ttsMissingTitle: '还没有可用的语音模型',
  goTts: '去模型 › 语音合成',
  voice: '默认音色',
  voicePicker: '没有绑定音色的说话人用',
  voiceDefault: '模型默认',
  voiceCustom: '音色 ID',
  voiceCustomPlaceholder: '服务商账号里的音色 ID',
  voiceHint: '说话人在下面绑定了音色时用绑定的；没绑定的用这里选的。',
  voiceCustomEmpty: '先填音色 ID，或选别的音色',
  speakers: '说话人',
  speakersAside: (n: number) => `${n} 位`,
  speakersNone: '这份转写没有说话人信息：所有句子都用上面的默认音色。',
  speakersNote: '绑定存在这个视频里（一笔能撤销的编辑），下次配音照用；优先级是 绑定 → 默认音色 → 模型默认。',
  speakerLine: (sentences: number) => `${sentences} 句`,
  speakerBinding: (name: string) => `给 ${name} 绑定的音色`,
  bindingNone: '不绑定',
  bindingOther: (label: string) => `${label}（别处绑定的）`,
  bindingIgnored: (provider: string) => `绑定的是别家服务商的音色，用 ${provider} 时不用`,
  bindingReadOnly: '视频是只读的，不能改说话人的音色。',
  bindingFailed: (message: string) => `没能改说话人的音色：${message}`,
  bindingLoading: '正在读取说话人绑定的音色…',
  bindingReadFailed: (message: string) => `没读到这个视频里说话人绑定的音色：${message}`,
  bindingSaved: (name: string) => `已给 ${name} 绑定音色`,
  bindingCleared: (name: string) => `已去掉 ${name} 的音色绑定`,
  sourceVideo: '绑定',
  sourceParams: '默认音色',
  sourceDefault: '模型默认',
  /** 说话人这一行实际用哪个音色；模型默认的 label 自带「模型默认」，不再重复来源。 */
  effective: (label: string, source: string | null) => (source ? `生效：${label}（${source}）` : `生效：${label}`),
  speakerWarning: (reason: string) => `这位说话人的句子不会合成：${reason}`,
  manageVoices: '管理我的声音…',
  mix: '混音',
  separate: '分离背景声',
  separateHint: '配音只替换人声，音乐与环境声留下',
  separateMissing: '本机没有可用的分离模型：打开了也会跳过分离，原声整条处理。',
  installSeparate: '安装分离模型…',
  original: '原声',
  originalPicker: '配音响起时原声怎么处理',
  originalLabel: { duck: '压低', mute: '静音', keep: '不动' },
  /**
   * 混音一节的说明（设计稿 panel-dub-setup.jsx）：分离时背景声单独成轨、原声只剩人声（压低时人声在「人声」轨上压低），
   * 不分离时原声整条静音或压低；`keep` 不动原声，也不分离。
   */
  mixHint: (o: { separated: boolean; original: DubOriginalAudio; duckDb: number }) =>
    o.original === 'keep'
      ? `原声不动，和配音叠在一起${o.separated ? '；不动时不分离' : ''}。`
      : `${o.separated ? '背景声单独成轨，原声只剩人声——' : '不分离时原声整条'}${o.original === 'mute' ? '静音' : `压低到 −${o.duckDb} dB`}，配音轨行头能随时切回原声。`,
  duckDb: '压低多少 dB',
  duckLabel: '压低',
  duckUnit: 'dB',
  translate: '翻译',
  textModel: '文本模型',
  textModelPicker: '翻译用的文本模型',
  textModelsLoading: '正在读取文本模型…',
  manageTextModels: '管理文本模型…',
  textMissingTitle: '还没有可用的文本模型',
  goLlm: '去模型 › 文本生成',
  noStructured: '不支持结构化输出 · 翻译用不了',
  style: '风格提示',
  stylePlaceholder: '例如：口语、简洁；人名保留原文',
  styleHint: '可不填；最多 500 字。',
  cta: (language: string) => `配成 ${language}`,
  /** 按钮下的说明：写进哪几条轨（分离时多「背景声」，压低时再多「人声」）。 */
  ctaHint: (language: string, stems: { separated: boolean; original: DubOriginalAudio }) => {
    const extra =
      !stems.separated || stems.original === 'keep' ? '' : stems.original === 'duck' ? '、「背景声」与「人声」' : '与「背景声」';
    return `完成后写进时间线「配音 · ${language}」${extra}轨，一键可撤销。在线模型按调用计费。`;
  },
  noSpeechTitle: '还没有可以配音的转写',
  noSpeech: '配音按转写的句子逐句进行。先在字幕面板「生成字幕」转录一段素材。',
  busy: '这个视频正在配音，等它结束再开下一次。',
  readOnly: '视频是只读的，不能配音。',

  // 运行态
  submitting: '正在提交配音',
  queued: '排队中',
  running: (language: string) => `配音中 · ${language}`,
  stepUnits: (step: 'translate' | 'synthesize', done: number, total: number | null) =>
    `${step === 'translate' ? '翻译' : '合成'} ${done}${total ? ` / ${total}` : ''} 句`,
  sentences: (running: number, failed: number) => [running ? `${running} 句在合成` : '', failed ? `${failed} 句失败` : ''].filter(Boolean).join(' · '),
  cancel: '取消配音',
  cancelled: '已取消配音',
  cancelFailed: (message: string) => `没能取消配音：${message}`,
  liveNote: '完成后 Runtime 直接写进时间线，随时可一键撤销；可以离开这一页。',
  foreign: '这次配音不是从这里开始的：完成后在时间线上看，撤销用编辑器的撤销。',

  // 授权
  grantTitle: (recipient: string) => `要把文稿交给 ${recipient}，还没有授权`,
  grantBody: '配音会把要合成的译文（缺译文时还有原文）交给服务商。发一条只限这个视频的授权后接着开始；不发就不会外发。',
  grantAction: '发放授权并开始',
  grantRetryAction: '发放授权并重试',
  grantDialogTitle: '发放数据外发授权',
  grantDialogIntro: '确认之后 BaoCut 记下这条授权并接着配音：',
  grantConfirm: '发放并继续',
  grantCancel: '先不发',
  granting: '正在发放授权…',
  grantFailed: (message: string) => `没能发放授权：${message}`,
  grantStillRefused: '发放了授权仍被拒绝',
  grantNext: '翻译与合成交给不同的服务商时要各发一条授权。',
  commands: '命令行做法',

  // 问题
  notConfigured: '还不能配音',
  submitFailed: '没能开始配音',
  failed: '配音失败',
  interrupted: '配音中断了',
  retry: '重试',
  retryFailed: (message: string) => `没能重试：${message}`,
  retryCharges: '重试会从停下的那一步接着做；停在「翻译」时整步重跑，已经翻过的批次会再调用一次模型、可能再计费。',
  retryPartial: '重试会从「逐句合成」接着做：已经合成好的句子复用，只合成失败的和还没合成的。',
  retryFree: '重试会从停下的那一步接着做，前面完成的步骤复用，不会为它们再调用模型。',
  retryFrozen: '说话人的音色绑定在开始时已经冻结：修好音色（重新克隆、补上本人声明）对重试有效；改绑定要重新配音。',
  failedUnits: (n: number) => `${n} 句合成失败`,
  stoppedAt: (synthesized: number, remaining: number) => `停下时已合成 ${synthesized} 句，还剩 ${remaining} 句`,
  dismiss: '知道了',

  // 收据
  doneTitle: (language: string) => `已配成 ${language}`,
  doneToast: (language: string, placed: number) => `已配成${language} · ${placed} 句放上时间线`,
  placed: (placed: number, total: number) => `${placed} / ${total} 句放上时间线`,
  fitHead: '各句的去向',
  speakersHead: '说话人的音色',
  speakerUnits: (n: number) => `${n} 句`,
  speakerNone: '没有说话人',
  voiceFailedHead: '这些说话人的句子没合成',
  voiceFailedLine: (name: string, n: number, reason: string) => `${name} · ${n} 句 · ${reason}`,
  voiceFailedFix: '这次配音已经完成、不能重试：撤销这组配音 → 修好音色（重新克隆、补本人声明）或改绑定 → 重新配音。',
  synthesisLine: (calls: number, retries: number, failures: number, reused: number) =>
    [`调用 ${calls} 次`, retries ? `重发 ${retries} 次` : '', failures ? `失败 ${failures} 次` : '', reused ? `复用 ${reused} 句` : '']
      .filter(Boolean)
      .join(' · '),
  translationCreated: '这次新翻译的译文已经存进视频（撤销配音不会删它）',
  translationUsed: '用的是已有的译文',
  glossaryUsed: (n: number) => `用了 ${n} 张术语表`,
  warnings: '提醒',
  undo: '撤销这组配音',
  undoing: '正在撤销…',
  undone: '已撤销这组配音',
  undonePartial: '已撤销这组配音的实例、静音与闪避；空的配音轨与配音计划文档留在视频里（协议没有删轨道与文档的操作）。',
  undoLabel: (language: string) => `撤销配音（${language}）`,
  undoFailed: '没能撤销这组配音',
  undoNotOpen: '要撤销这组配音，先打开那个视频。',
  close: '关闭',
  again: '再配一次',
  providerFallback: '这家服务商',
  unknownLanguage: '语言未知',
};

export const zhTimelineDub: TimelineDubMessages = {
  trackLabel: (language: string) => `配音 · ${language}`,
  /** 这组配音分离出的分轨的行头（设计稿 model-timeline.js 的「背景声」行）；人声只在原声压低时有。 */
  stemTrackLabel: (stem: 'background' | 'vocals', language: string) => `${stem === 'vocals' ? '人声' : '背景声'} · ${language}`,
  /** 块上的语速角标：1.0× 不写，快过上限写「1.62× · 过快」。 */
  rate: (rate: number, fast: boolean) => `${rate.toFixed(2)}×${fast ? ' · 过快' : ''}`,
  /** 拖右缘时的读数。 */
  stretching: (rate: number, seconds: number) => `${rate.toFixed(2)}× · ${seconds.toFixed(2)} s`,
  tip: (parts: { text: string; speaker: string | null; rate: string; muted: boolean; manual: boolean; editable: boolean }) =>
    [parts.text, parts.speaker, parts.rate, parts.muted ? '已静音' : '', parts.manual ? '手动改过语速' : '', parts.editable ? '拖右缘改时长 · 右键更多' : '']
      .filter(Boolean)
      .join(' · '),
  menuLabel: (title: string) => `「${title}」的配音菜单`,
  selection: (n: number) => `选中 ${n} 句`,
  count: (n: number) => (n > 1 ? `这 ${n} 句` : '这一句'),
  listen: '听这一句',
  listenHint: (timecode: string, seconds: number, rate: string) => `${timecode} · ${seconds.toFixed(1)} s${rate ? ` · ${rate}` : ''}`,
  mute: (allMuted: boolean, n: number) => `${allMuted ? '取消静音' : '静音'}${n > 1 ? `这 ${n} 句` : '这一句'}`,
  muteHint: (allMuted: boolean) => (allMuted ? '恢复这几句的配音' : '这几句不出声 · 导出也不带'),
  remove: (n: number) => `删除${n > 1 ? `这 ${n} 句` : '这一句'}`,
  removeHint: '从配音轨上拿掉 · 可撤销',
  removeGroup: '移除这组配音',
  removeGroupHint: (bed: boolean) => `${bed ? '连同它的背景声一起拿掉' : '这一种语言的配音全部拿掉'} · 这次静音的原声恢复`,
  labelMute: '静音配音',
  labelUnmute: '取消静音配音',
  labelRemove: '删除配音',
  labelRemoveGroup: (language: string) => `移除配音（${language}）`,
  labelStretch: '改配音语速',
  muted: (n: number) => `已静音 ${n} 句配音`,
  unmuted: (n: number) => `已取消静音 ${n} 句配音`,
  removed: (n: number) => `已删除 ${n} 句配音`,
  groupRemoved: (language: string) => `已移除「配音 · ${language}」· 空的配音轨与配音计划文档留在视频里`,
  planUnread: '没读到配音计划：这次静音的原声没能恢复，可以在原声片段上取消静音',
};

export const zhDubRegen: DubRegenMessages = {
  // ---- 行头 ⋯ ----
  headMenu: (label: string) => `「${label}」这条轨`,
  headLine: (c: { total: number; fast: number; muted: number; failed: number; queued: number }) =>
    [
      `${c.total} 句`,
      c.failed ? `${c.failed} 句没合成` : '',
      c.fast ? `${c.fast} 句过快` : '',
      c.muted ? `${c.muted} 句静音` : '',
      c.queued ? `${c.queued} 句重生成中` : '',
    ]
      .filter(Boolean)
      .join(' · '),
  listenDub: '听配音',
  listenDubHint: (o: { bed: boolean; duck: boolean; others: boolean }) =>
    `这组的配音${o.bed ? ' + 背景声' : ''} · ${o.duck ? '原声压低' : '原声静音'}${o.others ? ' · 别的语言关' : ''}`,
  listenDubKeep: '这组配音保留了原声，没有记下原声是哪几段，用「两者都听」',
  listenOriginal: '听原声',
  listenOriginalHint: (others: boolean) => `恢复视频里的原始声音 · ${others ? '所有配音组' : '这组配音'}静音`,
  listenBoth: '两者都听',
  listenBothHint: (bed: boolean) => `对照校听用${bed ? ' · 这组的背景声关' : ''}`,
  sourceLabel: { dub: '听配音', original: '听原声', both: '两者都听' },
  sourceDone: { dub: (language: string) => `在听「配音 · ${language}」`, original: '在听原声 · 配音已静音', both: '原声与配音一起放' },
  regenSome: (n: number) => (n ? `重新生成 ${n} 句…` : '重新生成…'),
  regenSomeHint: (failed: number, fast: number) =>
    failed || fast ? `${[failed ? `${failed} 句没合成` : '', fast ? `${fast} 句过快` : ''].filter(Boolean).join(' · ')} · 可先改译文` : '没有没合成或过快的句',
  redub: '重新配音…',
  redubHint: '打开翻译配音：换语言、换声音，整组重来',
  readOnly: '视频是只读的',

  // ---- 块菜单 ----
  regenBlocks: (n: number) => `重新生成${n > 1 ? `这 ${n} 句` : '这一句'}`,
  regenBlocksHint: '同样的译文与声音再合成一次 · 换个种子 · 旧的一版留着',
  retext: '改译文并重配…',
  retextHint: '先看时长、改译文，再只重配这几句',
  inQueue: '有句子正在重新生成',

  // ---- 块 ----
  queued: '重新生成中…',
  queuedTip: (text: string) => `${text} · 正在重新生成`,
  version: (k: number, seed: number | null) => (seed === null ? `第 ${k} 版` : `第 ${k} 版 · 种子 ${seed}`),

  // ---- 提交与收尾 ----
  submitted: (n: number) => `开始重新生成 ${n} 句配音`,
  submitFailed: (message: string) => `没能开始重新生成：${message}`,
  grantRefused: (recipient: string) => `重新生成要把译文交给 ${recipient}，还没有对应的授权；在设置里发放一条，或从翻译配音重新开始`,
  busy: '这一组正在提交，稍等',
  done: (replaced: number, total: number) => (replaced === total ? `已重新生成 ${replaced} 句配音` : `已重新生成 ${replaced}/${total} 句配音`),
  doneNone: '没有句子换上新的一版',
  notPlaced: (status: string, n: number) =>
    status === 'overlong'
      ? `${n} 句放不下，留着原来的一版`
      : status === 'stale'
        ? `${n} 句译文过期，没有合成`
        : status === 'voice-unavailable'
          ? `${n} 句音色不可用，没有合成`
          : `${n} 句原句不在时间线上`,
  failed: (message: string) => `重新生成没做完：${message}`,
  cancelled: '已取消重新生成',
  undo: '撤销',
  undoMissing: '没找到这次重新生成写入的那一笔，可以用编辑器的撤销',
  labelRetext: '改译文（重配）',

  // ---- 改译文并重配 ----
  fitTitle: (n: number) => `改译文并重配 ${n} 句`,
  fitIntro: '改的是译文里合成念的那一句（改过的标为已校对）；从它生成的字幕不跟着重切。每句再合成一次，换个种子，旧的一版留着。',
  fitDub: (seconds: number, rate: string) => `配音 ${seconds.toFixed(1)} s${rate ? ` · ${rate}` : ''}`,
  fitVoice: '没合成：音色不可用',
  fitOverlong: (seconds: number | null) => (seconds === null ? '没放上：太长' : `没放上：长出 ${seconds.toFixed(1)} s`),
  fitLoading: '正在读译文…',
  fitUnreadable: (message: string) => `读不到这组配音用的译文（${message}），只能照原译文重配`,
  fitMissing: '译文里没有这一句，照计划里的稿重配',
  fitText: (index: number) => `第 ${index} 句的译文`,
  fitCancel: '取消',
  fitSubmit: (n: number, changed: number) => (changed ? `改 ${changed} 句并重配 ${n} 句` : `重配 ${n} 句`),
  fitBusy: '正在提交…',

  // ---- 属性页的版本 ----
  takesTitle: '版本',
  takesAside: (n: number) => `${n} 版`,
  takeCurrent: '当前',
  takeUse: '换回这一版',
  takeLine: (seed: number | null, seconds: number | null, tempo: number | null) =>
    [
      seed !== null ? `种子 ${seed}` : '',
      seconds !== null ? `${seconds.toFixed(1)} s` : '没放上',
      tempo !== null && Math.abs(tempo - 1) >= 0.005 ? `${tempo.toFixed(2)}×` : '',
    ]
      .filter(Boolean)
      .join(' · '),
  takeUnavailable: '这一版没放上时间线，或找不到它的素材',
  takesNote: '每次重新生成记一版；换回旧的一版是一笔可撤销的编辑，不重新合成。',
  takeName: (k: number) => `第 ${k} 版`,
  labelSwitchTake: (k: number) => `换回配音第 ${k} 版`,
  switched: (k: number) => `已换回第 ${k} 版`,
  regenThis: '重新生成这一句',
  unreadableFormat: '格式不认识',
  unreadableNoTranslation: '计划里没有译文',
};
