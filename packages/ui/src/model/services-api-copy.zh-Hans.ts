import type { ServicesApiMessages } from './services-api-copy.ts';

export const zhHans: ServicesApiMessages = {
  capabilities: {
    transcribe: '转录',
    synthesizeSpeech: '合成语音',
    generateImage: '生成图片',
    generateText: '生成文本',
  },
  endpoints: {
    models: '列出模型',
    model: '查询一个模型',
    info: '服务信息与接口版本',
    transcriptions: '转录音频',
    speech: '合成语音',
    images: '生成图片',
    chat: '生成文本（对话）',
  },
  routing: {
    online: { label: '在线服务', desc: '把请求转给已连接的云端服务（会产生费用，数据离开这台电脑）' },
    nodes: { label: '局域网节点', desc: '把请求转给已配对的其他电脑' },
    agent: { label: '智能体', desc: '把请求转给本机已登录的智能体运行时（例如 Codex）' },
  },
  modelsAvailable: (n) => `${n} 个模型可用`,
  notRouted: '有可用的模型，但它们所在的那一类还没有打开路由；现在请求会得到 503',
  noModels: '还没有可用的模型；现在请求会得到 503',
  defaultModel: '默认模型',
  target: (provider, model) => `${provider} · ${model}`,
  aliasProviderMissing: '找不到这个服务商，请求会得到 404',
  aliasNotRouted: '这一类还没有打开路由，请求会得到 404',
  aliasProviderUnavailable: '这个服务商现在不可用',
  aliasModelUnavailable: '这个模型现在不可用',
  targetNotRouted: '没打开路由',
  targetUnavailable: '现在不可用',
  aliasNameEmpty: '填一个名字，比如 whisper-1',
  aliasNameSlash: '名字里不能有「/」：<服务商>/<模型> 是规范写法，别名不能和它撞',
  aliasNameChars: '名字只能用字母、数字与 . _ : -，并且以字母或数字开头',
  aliasNameTaken: (name) => `已经有「${name}」了；要改目标，先删掉那一行`,
};
