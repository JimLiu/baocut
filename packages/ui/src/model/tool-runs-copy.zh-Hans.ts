import type { ToolRunsMessages } from './tool-runs-copy.ts';

/** 中文里夹西文名字时两边留空格。 */
const spaced = (name: string) => (/^[\x20-\x7e]+$/.test(name) ? ` ${name} ` : name);

export const zhHans: ToolRunsMessages = {
  diarizeStep: '识别说话人',

  phaseDone: '已完成',
  phaseQueued: '排队中',
  phaseCancelled: '已取消',
  phaseUnfinished: '没有做完',
  phasePreparing: '正在准备',
  stepAt: (cur, total) => `第 ${cur} / ${total} 步`,
  cancelledAt: (step, at) => `取消在「${step}」· ${at}`,
  stoppedAt: (step, at) => `停在「${step}」· ${at}`,
  runningAt: (step, at) => `正在${step} · ${at}`,
  stepDone: '完成',
  stepStopped: '停在这一步',
  stepRunning: '进行中',
  stepWaiting: '等待',

  costEstimate: (amount, currency) => `约 ${amount} ${currency}`,
  costSubscription: (recipient) => `算在${spaced(recipient)}的订阅里`,
  costFree: '不计费',
  costMetered: (recipient) => `按${spaced(recipient)}的价目计费，这里估不出金额`,
  grantWhat: (kinds, purpose) => `${kinds.join('、')}（${purpose}）`,
  grantLoop: '已经同意过这几项，Runtime 仍然拒绝：去设置 › 隐私里看看这几条授权，或换一个模型。',

  noStructuredOutput: '这只模型不支持结构化输出，翻译用不了',

  captionsCreated: (p) =>
    `建立了${p.language ? `${p.language}字幕层` : '一条可编辑的字幕层'}${p.bilingual ? '，双语显示' : ''}${
      p.disabled ? '（这个素材已有字幕显示着，新的一层先停用）' : ''
    }`,
  captionsExistingTranslation: '这份译文已经有字幕层，没有再建',
  captionsExistingTranscript: '这份文稿已经有字幕层，没有再建',
  captionsNotOnTimeline: '时间线上没有用到这个素材的片段，没有建字幕层',
  captionsEmpty: '没有可显示的字幕，没有建字幕层',
  originalAudio: { duck: '原声压低', mute: '原声静音', keep: '原声保留' },

  thisVideo: '这个视频',
  newVideo: '新视频',
  fallbackVideo: '视频',
  media: '媒体',
  savedFiles: (names) => `文稿与字幕保存到保存位置：${names.join('、')}`,
  transcriptLanguage: (language, model) => `文稿语言：${language}${model ? `（${model}）` : ''}`,
  createdVideoLinked: (video, project) => `新建视频「${video}」${project ? `，放进「${project}」` : ''}；素材留在原处，只做链接`,
  wroteTranscript: (video) => `写进「${video}」：写入一份文稿`,
  speakersFound: (n) => `区分出 ${n} 位说话人，字幕与文稿都标上了名字`,
  wroteTranslation: (video, language, source) => `写进「${video}」：新增一份${language}译文${source ? `（译自${source}文稿）` : ''}，原文没动`,
  unitCount: (n) => `共 ${n} 句`,
  subtitleFileWritten: (file, dir) => `译好的字幕文件 ${file} 写在 ${dir}，条数与时间码不变`,
  bilingualLayout: '双语：每条原文在上、译文在下',
  markupStripped: (n) => `${n} 条原文带的行内标记去掉了`,
  dubTranslated: (language) => `先翻译成${language}：新增一份译文`,
  dubReusedTranslation: (language) => `用了已有的${language}译文`,
  dubWritten: (video, language, engine) => `写进「${video}」：新的一组${language}配音${engine ? `（${engine}）` : ''}，原来的配音保留`,
  dubPlaced: (placed, total) => `放上时间线 ${placed} / ${total} 句`,
  linkCreatedVideo: (video, project) => `新建视频「${video}」${project ? `，放进「${project}」` : ''}；下载的媒体已放上时间线`,
  linkAddedTo: (file, video) => `把 ${file} 加进「${video}」，文件留在下载目录里`,
  linkDownloaded: (file, dir) => `${file} 已下载${dir ? `，在 ${dir}` : ''}`,
  linkTranscribedFiles: '转录完成，已保存 TXT 文稿和 SRT 字幕',
  linkTranscribed: '转写完成，新增一份文稿；这条路径不建字幕层，可以在编辑器的字幕面板里生成',
  replacedTranscript: (video) => `取代「${video}」的文稿：一笔事务，可以撤销`,
  newVideoFrom: (video, project, original) =>
    `新建视频「${video}」${project ? `，放进「${project}」` : ''}，链接同一份素材；${original ? `「${original}」` : '原视频'}和它的译文没动`,
  carryTranslation: (language, kept, reviewed, stale) => `${language}译文：保留 ${kept} 句（已审 ${reviewed}）· 过期 ${stale} 句`,
  carryPins: (reanchored, orphaned) => `字幕 pin：重锚 ${reanchored} 处 · orphaned ${orphaned} 处`,
  carryDub: (language, kept, stale) => `${language}配音：保留 ${kept} 句 · 过期 ${stale} 句`,
  nothingToCarry: '这部视频没有译文、字幕 pin 与配音，没有要结转的',
  refreshHint: '过期的译文用「刷新过期译文」重译',
};
