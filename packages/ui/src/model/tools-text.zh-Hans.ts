import type { ToolsTextMessages } from './tools-text.ts';

export const zhHans: ToolsTextMessages = {
  emptyInput: '请先输入生成要求',
  tooLong: (max) => `一次最多输入 ${max} 字符`,
  sample: '写一段 30 秒的城市漫游视频旁白，语气自然，突出街道、咖啡馆和黄昏。',
  counter: (n, max) => `${n} / ${max} 字符`,
  connectTextModel: '请先连接一个文本模型',
  connectFirst: (provider) => `先连接 ${provider}`,
  effortFixed: '推理强度 · 这只模型不能调',
  effort: (label) => `推理强度 · ${label}（模型页设的默认）`,
  auto: '自动',
  headerChip: (provider) => `联网 · ${provider} · 按 token 计费`,
  fileStem: '生成文本',
  chars: (n) => `${n} 字`,
  outputTokens: (n) => `输出 ${n} token`,
  truncated: '到了输出上限，后面被截断',
};
