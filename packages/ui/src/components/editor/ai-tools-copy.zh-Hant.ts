import type { AiToolsMessages } from './ai-tools-copy.ts';

export const zhHant: AiToolsMessages = {
  back: '返回',

  // 设置态
  who: '使用',
  whoAgent: '交給 Agent',
  whoModel: '直接呼叫模型',
  whoModelSub: 'Runtime 目前還沒有這項工作的流程，因此只能交給 Agent',
  scope: '範圍',
  scopeAll: '整部影片',
  scopeChapter: (index: number, label: string) => `第 ${index} 章 · ${label}`,
  scopeNoChapters: '時間軸上還沒有章節，因此只能選擇整部影片',
  byAgent: '由 Agent 完成',
  cta: '交給 Agent',
  queued: 'Agent 忙碌中 · 訊息已排入佇列，會在這一輪結束時傳送',
  noConversation: '這部影片不在任何專案或對話中，因此無法交給 Agent。',
  createFailed: (message: string) => `無法建立對話：${message}`,

  // 勾选项与自定义
  prePolish: '先潤飾（自動分段）',
  prePolishOn: '章節會依段落分組',
  prePolishOff: '未潤飾的逐字稿只有 1 個段落，因此章節會很粗略',
  staleEdited: '原文中已編輯的句子',
  staleEditedSub: '你修改了逐字稿中的文字，但譯文仍是舊的',
  staleCut: '原文中被剪掉的句子',
  staleCutSub: '剪除時刪掉了句子的一部分；請依剪除後的原文重新翻譯',
  staleNone: '請至少勾選一項',
  staleOnly: (language: string) => `只處理${language}譯文`,
  retranscribeModel: 'Agent 會從這台電腦上已安裝的語音模型中挑選；要指定模型，請在下方的指示中說明。',
  retranscribeSpeakers: '轉錄後辨識說話者',

  // 写作与发布
  platform: '發布平台',
  platformPlaceholder: '要發布的平台（選填）；會遵循該平台的規範，並提醒你檢查',
  titleCount: '候選數量',
  titleCountNote: (min: number, max: number) => `${min}–${max} 個，每個角度都不同`,
  coverCount: '數量',
  coverIdea: '最想傳達的一件事',
  coverIdeaPlaceholder: '什麼會讓人想點開這部影片（選填）；留空則由 Agent 從逐字稿中找出',
  coverRatio: '長寬比',
  coverRatioProject: '與影片畫布相同',
  coverText: '封面文字',

  // 还做不了的
  soon: '即將推出',
  chaptersPolishFirst: '請先潤飾並分段，再產生章節',

  session: '對話',
  promptLabel: '要對 Agent 說的話',
  promptPlaceholder: '要做什麼、怎麼做；@ 引用章節或說話者',
  restoreDefault: '恢復預設',
  skillNote: '這個工具的做法',
  noSkill: '沒掛 skill：只按上面的提示詞做。',
  addSkillBack: '加回這個工具的 skill',
  sentNew: '已交給 Agent · 新對話',
  sentCurrent: '已交給 Agent · 接著目前對話',
  agentCardTitle: '不在下面列表裡的活，用一句話交給 Agent',
  agentCardSomeAgent: 'Agent',
  agentCardOutside: '打開這部影片所在的對話，影片作為上下文 →',
  noTranscriptTitle: '這部影片還沒有文稿',
  noTranscriptBody: '這裡的工具都從文稿出發：潤飾、分章、寫總結、起標題都要先有轉錄。',
  goTranscribe: '去轉錄',
  stateRunning: '執行中',
  stateReview: '待處理',
  agentCardNew: (agent) => `新開一條對話，這部影片作為上下文；在本機 ${agent} 裡跑，寫入前會先問你 →`,
  stateChapters: (count) => `${count} 章`,
};
