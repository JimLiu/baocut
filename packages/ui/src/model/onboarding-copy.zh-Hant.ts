import type { OnboardingMessages } from './onboarding-copy.ts';

export const zhHant: OnboardingMessages = {
  dialogLabel: '歡迎使用 BaoCut',
  stepsLabel: '引導步驟',
  step: {
    agent: '連接 Agent',
    asr: '語音辨識',
    tts: '語音合成',
    semantic: '語意搜尋',
    image: '影像生成',
    music: '音樂生成',
  },
  title: {
    agent: '歡迎使用 BaoCut',
    asr: '下載語音辨識模型',
    tts: '下載語音合成模型',
    semantic: '安裝語意搜尋',
    image: '下載影像生成模型',
    music: '下載音樂生成模型',
  },
  lead: {
    agent: '說出想做的影片，Agent 幫你轉錄、加字幕、翻譯、配音和剪輯。BaoCut 呼叫這台電腦上的 Agent（例如 Claude Code、Codex），用你自己的帳號，不另外收費。',
    asr: '轉錄、加字幕和剪口播影片，都要先把說的話轉成文字。模型裝在這台電腦上，不連網也能用。',
    tts: '語音合成模型能把文字念出來、用一段錄音克隆聲音，也能為翻譯後的影片配音。先挑一兩個下載，其餘之後在 設定 › 語音合成 裡下載。',
    semantic: '依意思找講話內容和畫面：Space 搜尋、寫作依主題選材、配畫面、翻譯記憶都會用到它。裝好後會在背景為既有的影片建立索引。',
    image: '在本機用一句話生成圖片，做封面、配圖都行。模型很大，生成也慢。',
    music: '在本機依風格或歌詞生成配樂和歌曲，結果可以直接加到影片的音樂軌。生成很慢，30 秒約需幾分鐘。',
  },
  where: {
    tts: {
      title: '在 工具 › 生成語音 裡使用',
      body: '寫一段文字，或選 Space 裡的文件、字幕，挑好模型和音色就能生成。還沒下載的模型在那裡也能下載。',
    },
    image: { title: '在 工具 › 生成圖片 裡使用', body: '寫一句描述就能出圖；Agent 做封面時也會用到它。' },
    music: { title: '在 工具 › 生成音樂 裡使用', body: '選風格、寫歌詞，生成的音樂會存進 Space，可以加到影片裡。' },
  },
  diarizes: '轉錄時同時區分說話者',
  needsDiarization: (pack) => `要區分說話者，另外下載「${pack}」`,
  familyNote: {
    'qwen3-tts-1.7b-customvoice': '9 種預設音色 · 可用一句話指定風格',
    'qwen3-tts-0.6b-base': '用 3 秒參考錄音克隆聲音',
    voxcpm2: '參考錄音克隆 · 可描述風格 · 30 種語言與粵語',
    'qwen-image-2.1-turbo': '蒸餾版 · 固定 8 步 · 比基礎版快 2 倍多',
    'qwen-image-2.1': '基礎版 · 步數多，較慢',
    'yue2-3b': '依風格或歌詞生成 · 30 秒約需幾分鐘',
  },
  recommended: '推薦',
  installed: '已安裝',
  missingParts: '缺少元件',
  planLine: (parts) => `一起下載：${parts}`,
  downloading: (name) => `正在下載 ${name}`,
  inBackground: '在背景下載',
  bgNote: '下載前會先列出來源和存放位置，確認後才開始；下載在背景進行，不用等下載完。',
  asrAlt: '不想下載？也可以之後在 設定 › API 供應商 裡加入雲端語音辨識。',
  unsupported: '這台電腦無法執行這類模型，這一步可以直接略過。',
  semanticParts: (text, multimodal) => `${text} + ${multimodal}`,

  agentListLabel: '這台電腦上的 Agent',
  agentChecking: '正在檢查這台電腦上的 Agent…',
  agentMissingBody: '勾選想用的，BaoCut 會在背景安裝；裝好後用你既有的帳號登入一次就能用。',
  agentNote: '勾選的都會出現在新對話的 Agent 選單裡；安裝在背景進行，不用等裝完。預設用哪一個、安裝更多，在 設定 › Agent 供應商 裡調整。',
  agentInstalled: '本機已安裝',
  agentFix: (problem) => `${problem} · 在 設定 › Agent 供應商 裡處理`,
  agentManual: '只能在終端機裡依官方說明安裝 · 說明在 設定 › Agent 供應商',
  agentNotInstalled: (plan) => (plan ? `未安裝 · 裝好後用你既有的 ${plan} 登入` : '未安裝'),
  agentWillInstall: (method, command, login) => `用 ${method} 在背景安裝（${command}）· 裝好後在終端機裡執行 ${login} 登入`,
  agentInstalling: (method, login) => `正在用 ${method} 在背景安裝 · 裝好後在終端機裡執行 ${login} 登入`,
  agentInstallingLabel: (name) => `正在安裝 ${name}`,
  agentInstallFailed: '沒有裝成 · 詳情在背景任務裡',

  next: '下一步',
  finish: '完成',
  skip: '略過',
  exit: '離開引導',
  install: (n) => `背景安裝 ${n} 個並繼續`,
  download: (size, last) => `背景下載${size ? ` ${size} ` : ''}並${last ? '完成' : '繼續'}`,
  bg: {
    one: (kind, name, pct) => {
      const tail = pct === null ? '' : ` ${pct}%`;
      return `背景正在${kind === 'install' ? '安裝' : kind === 'download' ? '下載' : '下載和安裝'} ${name}${tail}`;
    },
    many: (kind, n) => `背景正在${kind === 'install' ? '安裝' : kind === 'download' ? '下載' : '下載和安裝'} ${n} 個`,
    idle: (kind) => `背景${kind === 'install' ? '安裝' : kind === 'download' ? '下載' : '下載和安裝'}`,
    done: (kind, n) => `${n} 個${kind === 'install' ? '已裝好' : kind === 'download' ? '已下載' : '已完成'}`,
    failed: (kind, n) => `${n} 個${kind === 'install' ? '沒裝成' : kind === 'download' ? '沒下載成' : '沒成功'}`,
  },
  closedToast: (models, agents) => {
    const parts = [...(models ? [`${models} 個模型在背景下載`] : []), ...(agents ? [`${agents} 個 Agent 在背景安裝`] : [])];
    return `${parts.join('，')}，完成後就能使用`;
  },
  viewTasks: '查看背景任務',
};
