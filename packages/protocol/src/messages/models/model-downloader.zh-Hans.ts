import type { ModelsModelDownloaderMessages } from './model-downloader.ts';

export const zhHans: ModelsModelDownloaderMessages = {
  remedyNoSpace: '模型目录所在的磁盘空间不足：清理出足够的空间（或在设置里把模型目录换到别的磁盘）后再安装',
  remedyNetwork: '网络连不上或下载中断：检查网络后再次安装，已经下载的部分会续传；也可以在「设置 › 通用」的「模型下载来源」里换镜像',
  remedyIntegrity: '下载的文件与清单的大小或 sha256 不符（来源或镜像的内容不对）：坏的文件已删除，换一个下载来源后再安装',
  remedySource: '下载来源没有这个文件或拒绝访问：检查「设置 › 通用」的「模型下载来源」（或环境变量 BAOCUT_MODELS_ENDPOINT）指向的镜像是否完整',
  remedyManifestIncomplete: '这个模型包的内置清单缺少可信的 sha256，不能安装：等待更新 BaoCut',
  downloadFailed: (p: { file: string; reason: string }) => `下载 ${p.file} 失败：${p.reason}`,
  integrityMismatch: (p: { file: string }) => `${p.file} 的大小或 sha256 与清单不符`,
  sourceHttp: (p: { file: string; status: number }) => `下载来源对 ${p.file} 返回 HTTP ${p.status}`,
  diskFull: '写入模型文件时磁盘满了',
};
