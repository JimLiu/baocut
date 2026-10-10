import type { AiToolsMessages } from './ai-tools-copy.ts';

export const zhHans: AiToolsMessages = {
  back: '返回',

  // 设置态
  who: '用',
  whoAgent: '交给 Agent',
  whoModel: '直接调模型',
  whoModelSub: '这一项 Runtime 还没有对应的流程，只能交给 Agent',
  scope: '范围',
  scopeAll: '整篇',
  scopeChapter: (index: number, label: string) => `第 ${index} 章 · ${label}`,
  scopeNoChapters: '时间线上还没有章节，只能整篇',
  cta: '交给 Agent',
  queued: 'Agent 正在忙 · 这句话已排队，等这一轮结束再发',
  noConversation: '这个视频不在任何项目或会话里，没法交给 Agent。',
  createFailed: (message: string) => `没能新建会话：${message}`,

  // 勾选项与自定义
  prePolish: '先润色一遍（自动分段）',
  prePolishOn: '章节按段落聚合',
  prePolishOff: '还没润色过的文稿只有 1 段，章节会很粗',
  staleEdited: '原文改过的句子',
  staleEditedSub: '你在文稿里改过字，译文还是旧的',
  staleCut: '原文被剪切的句子',
  staleCutSub: '剪口播剪掉了半句；按剪后的原文重译',
  staleNone: '至少勾一类',
  staleOnly: (language: string) => `只处理${language}这一份译文`,
  retranscribeModel: '用哪个语音模型由 Agent 按本机装好的模型挑；想指定就写在下面的指令里。',
  /** 重新转录「更多选项」开着识别说话人、要由「说话人区分」来做时，加进发给 Agent 的那句话（设计稿 panel-aitools.jsx）。 */
  retranscribeSpeakers: '转写后识别说话人',

  // 写作与发布
  platform: '发到哪',
  platformPlaceholder: '要发的平台，可空；按它的规定写，写完提醒你核对',
  titleCount: '候选数',
  titleCountNote: (min: number, max: number) => `${min}–${max} 个，角度各不相同`,
  coverCount: '出几张',
  coverIdea: '要说的一件事',
  coverIdeaPlaceholder: '这支视频最想让人点开的那一点；可空，空着就让 Agent 从文稿里找',
  coverRatio: '画幅',
  coverRatioProject: '跟视频画布',
  coverText: '封面字',

  // 还做不了的
  soon: '即将推出',
  chaptersPolishFirst: '先润色并分段，再生成章节',

  session: '会话',
  promptLabel: '要对 Agent 说的话',
  promptPlaceholder: '要做什么、怎么做；@ 引用章节或说话人',
  restoreDefault: '恢复默认',
  skillNote: '这个工具的做法',
  noSkill: '没挂 skill：只按上面的提示词做。',
  addSkillBack: '加回这个工具的 skill',
  sentNew: '已交给 Agent · 新会话',
  sentCurrent: '已交给 Agent · 接着当前会话',
  agentCardTitle: '不在下面列表里的活，用一句话交给 Agent',
  agentCardSomeAgent: 'Agent',
  agentCardOutside: '打开这部视频所在的会话，视频作为上下文 →',
  noTranscriptTitle: '这部视频还没有文稿',
  noTranscriptBody: '这里的工具都从文稿出发：润色、分章、写总结、起标题都要先有转录。',
  goTranscribe: '去转录',
  stateRunning: '在跑',
  stateReview: '待处理',
  agentCardNew: (agent) => `新开一条会话，这部视频作为上下文；在本机 ${agent} 里跑，写入前会先问你 →`,
  stateChapters: (count) => `${count} 章`,
};
