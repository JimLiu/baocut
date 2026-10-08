import type { ModelsLocalMessages } from './models-local-copy.ts';

export const zhHans: ModelsLocalMessages = {
  reason: {
    unsupported: '这台电脑不支持',
    resource: '已停用',
    'worker-missing': '缺 Model Worker',
    'missing-manifest': '缺清单',
    'missing-file': '缺文件',
    'size-mismatch': '文件大小不符',
    'hash-mismatch': '校验不符',
    incomplete: '缺组件',
    'load-failed': '加载失败',
    relocating: '正在移动',
  },
  chipDefault: '默认',
  chipLoading: '正在加载',
  chipReady: '已加载',
  chipBusy: '正在运行',
  chipUnloading: '正在卸载',
  chipUnavailable: '不可用',
  capability: {
    transcribe: '转写',
    align: '对齐',
    synthesize: '合成',
    image: '生图',
    separate: '分离',
    diarize: '说话人区分',
  },
  auto: '自动选择',
  notInstalled: (name) => `${name}（未安装）`,
  componentName: { aligner: 'Forced aligner', speaker: '声纹嵌入', vad: 'VAD 语音活动检测' },
  weights: '模型权重',
};
