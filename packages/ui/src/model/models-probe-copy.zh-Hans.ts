import type { ModelsProbeMessages } from './models-probe-copy.ts';

export const zhHans: ModelsProbeMessages = {
  speechText: '你好，这是一段 BaoCut 的语音合成测试。',
  noResult: '任务完成了，但没有拿到结果。',
  failed: '任务失败了。',
  cancelled: '任务已取消。',
  interrupted: 'Runtime 重启，这次测试没有做完。',
  unknownOutcome: 'Runtime 重启时这次调用还没有回音，结果不明。',
  audioFacts: (seconds, khz, type) => `${seconds} 秒 · ${khz} kHz · ${type}`,
  videoFacts: (width, height, seconds, type) => `${width} × ${height} · ${seconds} 秒 · ${type}`,
  textFacts: (entries, seconds, type) => `${entries} 条 · ${seconds} 秒 · ${type}`,
  packageFacts: (files, type) => `${files} 个文件 · ${type}`,
  projectFacts: (clips, seconds, type) => `${clips} 个片段 · ${seconds} 秒 · ${type}`,
  chars: (count) => `${count} 字`,
  inputTokens: (count) => `输入 ${count} token`,
  outputTokens: (count) => `输出 ${count} token`,
  hitLimit: '到了输出上限',
  filtered: '被服务商的内容过滤拦下',
  untested: '尚未测试',
  testing: '正在测试…',
  passed: '测试通过',
  passedIn: (seconds) => `测试通过 · ${seconds} 秒`,
};
