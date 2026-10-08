import type { RcFontsMessages } from './rc-fonts.ts';

export const zhHans: RcFontsMessages = {
  manageOnlyInAppOrCli: '只能在桌面界面或 CLI 里下载、删除与清点字体',
  catalogueInvalid: '字体目录的格式不对',

  remedyNetwork: '网络连不上或下载中断：检查网络后再下载；也可以在「设置 › 字体」的「样式表地址」与「字体文件地址」里换镜像',
  remedySource: '字体服务没有给出这个字体的文件：检查族名与字重，或设置里的镜像地址',
  remedyIntegrity: '下载的不是能用的字体（族名对不上、读不出来或太大）：坏的文件已删除，换一个镜像后再下载',
  remedyNoSpace: 'Runtime Home 所在的磁盘空间不足：清理出空间后再下载',

  diskFullWriting: (p) => `写入 ${p.what} 时磁盘满了`,
  sourceHttpStatus: (p) => `字体服务对 ${p.what} 返回 HTTP ${p.status}`,
  downloadFailed: (p) => `下载 ${p.what} 失败：${p.reason}`,
  overByteLimit: (p) => `${p.what} 超过 ${p.limit} 字节的上限`,

  downloadCancelled: '字体下载已取消',
  cancelled: '下载已取消',
  offlineStrict: '严格离线模式下不下载字体',
  autoDownloadOff: '自动下载字体已关闭（「设置 › 字体」里的「自动下载字体」）',
  downloadFailedOutcome: (p) => `下载失败：${p.reason}`,
  notInCatalogue: (p) => `字体目录里没有「${p.family}」`,
  noNeedToDownload: (p) => `「${p.family}」${p.bundled ? '随应用自带' : '本机已安装'}，不用下载`,
  inUseByExport: (p) => `「${p.family}」正被还没结束的导出使用，导出结束后再删`,

  sampleLabel: (p) => `${p.family} 的样张`,
  sampleCss: (p) => `${p.label}样式表`,
  noSampleBlock: (p) => `字体服务的回应里没有${p.label}`,
  sampleNotOnHost: (p) => `${p.label}不在设置的字体文件主机上`,
  sampleNotUsable: (p) => `下载的${p.label}不是能用的字体`,

  faceLabel: (p) => `${p.family} ${p.weight}${p.italic ? ' 斜体' : ''}`,
  faceCss: (p) => `${p.label} 的字体样式表`,
  noFaceBlock: (p) => `字体服务的回应里没有 ${p.label}`,
  faceSplit: (p) => `字体服务把 ${p.label} 切成了按字符的分片，BaoCut 还不能合并分片`,
  faceNotOnHost: (p) => `${p.label} 的文件不在设置的字体文件主机上`,
  faceNotUsable: (p) => `下载的 ${p.label} 不是能用的字体`,
  familyMismatch: (p) => `下载的 ${p.label} 的族名对不上`,
};
