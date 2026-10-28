import type { ProvidersAgentMessages } from './providers-agent.ts';

export const zhHans: ProvidersAgentMessages = {
  codexUpgradeHint: '升级 Codex CLI（例如 npm install -g @openai/codex@latest），然后重新检查',
  codexImageModel: 'Codex 图片生成（模型由 Codex 与账号决定）',
  codexImageNotes:
    '用本机已登录的 Codex 账号生成：每次一张 PNG，同一时间只跑一个任务，通常要一两分钟；尺寸与 seed 不能指定（给了就拒绝），' +
    '像素尺寸以生成结果为准；用的是订阅额度，剩余额度未知。启用即同意把提示词发给 Codex 的账号。',
  codexImageNotesApiKey:
    "Codex 用 API key 等非 ChatGPT 订阅方式登录：画图可能用不了，费用记在那个账号上、不在订阅里。BaoCut 不会自动选它，想试请手动选。每次一张 PNG，尺寸与 seed 不能指定。",
  imagesOnly: (p) => `${p.label} 只能生成图片`,
  onePngOnly: (p) => `${p.label} 一次只生成一张 PNG，不接受尺寸与 seed`,
  unavailable: (p) => `${p.label} 不可用：${p.message}`,
  sessionNotStarted: (p) => `${p.label} 的会话没有启动：${p.error}`,
  timedOut: (p) => `${p.label} 在 ${p.minutes} 分钟内没有完成，已中断`,
  exited: (p) => `${p.label} 意外退出：${p.message}`,
  notCompleted: (p) => `${p.label} 没有完成这次生成：${p.reason}`,
  turnInterrupted: '回合被中断',
  noImage: (p) => `${p.label} 没有生成图片`,
  noImageReply: (p) => `${p.label} 没有生成图片：${p.reply}`,
  unknownError: '未知错误',
  processExited: '进程退出',
  turnNotStarted: (p) => `回合没有开始：${p.error}`,
  codexTextModel: "Codex 文本生成（模型由 Codex 与账号决定）",
  codexTextNotes:
    "用本机已登录的 Codex 账号生成文字：同一时间只跑一个请求，每次开一个新的 Codex 会话，比 API 慢。推理强度、temperature、seed 与输出长度不能指定。用的是订阅额度，剩余额度未知。启用即同意把提示词（包括其中的逐字稿等内容）发给 Codex 的账号。",
  codexTextNotesApiKey:
    "Codex 用 API key 等非 ChatGPT 订阅方式登录：费用记在那个账号上、不在订阅里。同一时间只跑一个请求；推理强度、temperature、seed 与输出长度不能指定。",
};
