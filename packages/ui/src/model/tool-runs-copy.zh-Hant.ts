import type { ToolRunsMessages } from './tool-runs-copy.ts';

const spaced = (name: string) => (/^[\x20-\x7e]+$/.test(name) ? ` ${name} ` : name);

export const zhHant: ToolRunsMessages = {
  diarizeStep: '辨識說話者',

  phaseDone: '已完成',
  phaseQueued: '排隊中',
  phaseCancelled: '已取消',
  phaseUnfinished: '未完成',
  phasePreparing: '準備中',
  stepAt: (cur, total) => `第 ${cur} / ${total} 步`,
  cancelledAt: (step, at) => `已在「${step}」取消 · ${at}`,
  stoppedAt: (step, at) => `停在「${step}」 · ${at}`,
  runningAt: (step, at) => `${step} · ${at}`,
  stepDone: '完成',
  stepStopped: '停在這一步',
  stepRunning: '進行中',
  stepWaiting: '等待中',

  costEstimate: (amount, currency) => `約 ${amount} ${currency}`,
  costSubscription: (recipient) => `包含在你的${spaced(recipient)}訂閱中`,
  costFree: '免費',
  costMetered: (recipient) => `依${spaced(recipient)}的價格計費，這裡無法估算金額`,
  grantWhat: (kinds, purpose) => `${kinds.join('、')}（${purpose}）`,
  grantLoop: '你已經同意過這幾項，但 Runtime 仍然拒絕。請到「設定 › 隱私與權限」檢查這幾項授權，或換用其他模型。',

  noStructuredOutput: '這個模型不支援結構化輸出，因此無法翻譯',

  captionsCreated: (p) =>
    `已建立${p.language ? `${p.language}字幕層` : '一個可編輯的字幕層'}${p.bilingual ? '，以雙語顯示' : ''}${
      p.disabled ? '（這個素材已經顯示著字幕，新的字幕層先停用）' : ''
    }`,
  captionsExistingTranslation: '這份譯文已經有字幕層，未再建立',
  captionsExistingTranscript: '這份逐字稿已經有字幕層，未再建立',
  captionsNotOnTimeline: '時間軸上沒有使用這個素材的片段，未建立字幕層',
  captionsEmpty: '沒有可顯示的字幕，未建立字幕層',
  originalAudio: { duck: '原聲已壓低', mute: '原聲已靜音', keep: '原聲已保留' },

  thisVideo: '這部影片',
  newVideo: '新影片',
  fallbackVideo: '影片',
  media: '媒體',
  savedFiles: (names) => `逐字稿與字幕已儲存：${names.join('、')}`,
  transcriptLanguage: (language, model) => `逐字稿語言：${language}${model ? `（${model}）` : ''}`,
  createdVideoLinked: (video, project) => `已建立影片「${video}」${project ? `，放在「${project}」中` : ''}；素材保留在原處，只建立連結`,
  wroteTranscript: (video) => `已為「${video}」寫入一份逐字稿`,
  speakersFound: (n) => `辨識出 ${n} 位說話者；字幕與逐字稿都已標上名字`,
  wroteTranslation: (video, language, source) =>
    `已為「${video}」新增一份${language}譯文${source ? `（譯自${source}逐字稿）` : ''}；原文未變更`,
  unitCount: (n) => `${n} 句`,
  subtitleFileWritten: (file, dir) => `譯好的字幕檔 ${file} 已儲存在 ${dir}；字幕條數與時間碼不變`,
  bilingualLayout: '雙語：原文在上、譯文在下',
  markupStripped: (n) => `已移除 ${n} 條原文字幕中的行內標記`,
  dubTranslated: (language) => `先翻譯成${language}：已新增一份譯文`,
  dubReusedTranslation: (language) => `使用了現有的${language}譯文`,
  dubWritten: (video, language, engine) =>
    `已為「${video}」新增一組${language}配音${engine ? `（${engine}）` : ''}；先前的配音仍保留`,
  dubPlaced: (placed, total) => `已將 ${placed} / ${total} 句放上時間軸`,
  linkCreatedVideo: (video, project) => `已建立影片「${video}」${project ? `，放在「${project}」中` : ''}；下載的媒體已放上時間軸`,
  linkAddedTo: (file, video) => `已將 ${file} 加入「${video}」；檔案保留在下載資料夾中`,
  linkDownloaded: (file, dir) => `已下載 ${file}${dir ? ` 到 ${dir}` : ''}`,
  linkTranscribedFiles: '轉錄完成，已儲存 TXT 逐字稿和 SRT 字幕',
  linkTranscribed: '轉錄完成，已新增一份逐字稿。這個流程不會建立字幕層；你可以在編輯器的字幕面板中生成',
  replacedTranscript: (video) => `已取代「${video}」的逐字稿：一筆交易，可以復原`,
  newVideoFrom: (video, project, original) =>
    `已新建影片「${video}」${project ? `，放進「${project}」` : ''}，連結同一份素材；${original ? `「${original}」` : '原影片'}和它的譯文沒動`,
  carryTranslation: (language, kept, reviewed, stale) => `${language}譯文：保留 ${kept} 句（已審 ${reviewed}）· 過期 ${stale} 句`,
  carryPins: (reanchored, orphaned) => `字幕 pin：重新錨定 ${reanchored} 處 · orphaned ${orphaned} 處`,
  carryDub: (language, kept, stale) => `${language}配音：保留 ${kept} 句 · 過期 ${stale} 句`,
  nothingToCarry: '這部影片沒有譯文、字幕 pin 與配音，沒有要結轉的',
  refreshHint: '過期的譯文請用「更新過期譯文」重譯',
};
