import type { RuntimeMessages } from './runtime-copy.ts';

export const zhHans: RuntimeMessages = {
  missingContext: 'RuntimeContext 缺失',
  mediaStatus: (status) => `媒体服务返回 ${status}`,
  noRootSequence: '新视频没有主序列',
  edit: {
    importAssets: '导入素材',
    setBackground: '设置背景',
    addWaveform: '加声波',
  },
  waveformName: '声波',
  noDuration: '视频还没有长度，声波没有加上',
  noOpenVideo: '没有打开的视频',
  notCaughtUp: '视频还没有追平，暂时不能修改',
};
