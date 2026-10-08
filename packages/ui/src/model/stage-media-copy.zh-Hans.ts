import type { StageMediaMessages } from './stage-media-copy.ts';

export const zhHans: StageMediaMessages = {
  titles: {
    missing: '找不到源文件',
    changed: '源文件变了',
    'outside-project': '源文件在项目目录之外',
    unplayable: '源文件无法播放',
  },
  causes: {
    missing: '文件可能被移动、改名或删掉了，也可能在已经拔掉的硬盘上。',
    changed: '这个位置上的文件已经不是导入时的那一个（大小对不上），可能被覆盖或重新导出过。',
    'outside-project': '登记的位置在视频所在的项目目录之外，BaoCut 不读那里的文件。',
  },
  unplayable: (error: string) => `播放器打不开这个文件：${error}。`,
  tail: { video: '字幕照常可以播放，只是没有画面和原声。', audio: '字幕照常可以播放，只是听不到这段声音。' },
  body: (cause: string, tail: string) => `${cause}${tail}`,
  volume: (volume: string) => `文件在「${volume}」上：接上这个盘就会自动恢复。`,
  more: (count: number) => `还有 ${count} 个视频或音频素材也放不出来。`,
  relinkHint: '选回原来的文件就能找回；BaoCut 会核对内容，内容不同的文件关联不上。',
  desktopOnly: '要找回，在 BaoCut 桌面应用里打开这个视频，用画面上的「重新关联…」选回原来的文件。',
  managed: '这个文件原本收在视频目录里，不能重新关联到别处。',
  oldRevision: '时间线用的是这个素材的旧版本，只有当前版本能重新关联。',
  relink: '重新关联…',
  relinking: '正在核对…',
  pickTitle: (name: string) => `找到「${name}」`,
  pickButton: '重新关联',
  label: (name: string) => `重新关联「${name}」`,
  relinkFailed: (message: string) => `没能重新关联：${message}`,
  decodeFailed: '解码失败',
  unsupported: '格式不受支持',
};
