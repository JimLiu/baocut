import type { RcAgentToolsMessages } from './rc-agent-tools.ts';

function exportKindLabel(kind: string): string {
  switch (kind) {
    case 'subtitles':
      return '字幕';
    case 'transcript':
      return '文稿';
    case 'audio':
      return '音频';
    case 'video':
      return '成片';
    case 'portable':
      return '便携包';
    case 'project':
      return '工程';
    default:
      return kind;
  }
}

function linkImportAfter(p: { target: string; name: string | null; transcribe: boolean; language: string | null; provider: string | null; model: string | null; captions: boolean }): string {
  const recognition = `${p.language ? `，语言 ${p.language}` : ''}${p.provider ? `（${p.provider}${p.model ? ` ${p.model}` : ''}）` : ''}`;
  if (p.target === 'create') return `，新建视频${p.name ? `「${p.name}」` : '（名字取页面标题）'}并放上时间线${p.transcribe ? `，再转写${recognition}${p.captions ? '、建立字幕层' : ''}` : ''}`;
  if (p.target === 'video') return `，导入视频${p.transcribe ? '并转写' : ''}`;
  if (p.target === 'project') return `，保存到项目的 downloads/${p.transcribe ? '并转写为 TXT 与 SRT 文稿' : ''}`;
  if (p.target === 'download') return `，保存到下载目录${p.transcribe ? '并转写为 TXT 与 SRT 文稿' : ''}`;
  return '';
}

export const zhHans: RcAgentToolsMessages = {
  instructionsNotSet: '会话指导还没有设上：Runtime 装配顺序有误',

  listSeparator: '、',
  clauseSeparator: '；',

  createVideoSummary: (p) => `新建视频「${p.name}」`,
  editsSummary: (p) => `${p.label}（${p.count} 个操作：${p.types}）`,
  captionsSummary: (p) => `给文档 ${p.documentId} 建立${p.bilingual ? '双语' : ''}字幕层`,
  captionsLabel: '建立字幕层',
  undoSummary: (p) => `撤销修改 ${p.transactionId}`,
  undoLatestSummary: '撤销最近的一笔修改',
  deleteVideoSummary: (p) => `删除视频「${p.name}」（${p.path}）：移进回收站，${p.days} 天内可以在 Space 里恢复；链接素材的原文件不动`,
  importPackageSummary: (p) => `打开便携包 ${p.file}`,
  renameVideoLabel: '改视频名',
  putDocumentSummary: (p) => `写入文档 ${p.documentId} 的新版本`,
  newDocumentSummary: (p) => `新建文档（${p.kind}）`,
  updateDocumentLabel: (p) => `更新文档「${p.name}」`,
  newDocumentLabel: (p) => `新建文档「${p.name}」`,
  translationDocumentName: (p) => `${p.language} 译文`,
  importAssetSummary: (p) => `导入素材 ${p.name}${p.place ? ' 并放到时间线上' : ''}`,
  importAssetLabel: (p) => `导入 ${p.name}${p.place ? ' 并放到时间线上' : ''}`,
  replaceCompositionSummary: (p) => `导入 ${p.name}，替换时间线上的片段 ${p.clip}`,
  replaceCompositionLabel: (p) => `把代码画面替换为 ${p.name}`,
  pruneAssetsSummary: (p) => `从视频里删掉没有用到的素材（${p.count} 个）：${p.names}`,
  pruneAssetsLabel: (p) => `清理没有用到的素材（${p.count} 个）`,
  adoptChaptersSummary: (p) => `采用 ${p.asset} 来源自带的章节（${p.count} 个）${p.existing ? `，替换现有的 ${p.existing} 个章节` : ''}`,
  adoptChaptersLabel: '采用来源章节',

  transcribePurpose: (p) => `转写素材 ${p.assetId}`,
  transcribeSummary: (p) => `转写素材 ${p.assetId}${p.provider ? `（${p.provider}${p.model ? ` ${p.model}` : ''}）` : ''}`,
  speechPurpose: (p) => `合成语音（${p.chars} 个字符）`,
  speechSummary: (p) => `合成语音（${p.chars} 个字符${p.provider ? `，${p.provider}` : ''}${p.voice ? `，音色 ${p.voice}` : ''}）`,
  imagePurpose: (p) => `生成图片：${p.prompt}`,
  imageSummary: (p) => `生成图片（${p.count} 张${p.size ? `，${p.size}` : ''}${p.provider ? `，${p.provider}` : ''}）：${p.prompt}`,
  cancelJobSummary: (p) => `取消任务 ${p.jobId}`,
  retryPipelineSummary: (p) => `从失败的那一步重跑流程 ${p.jobId}（${p.pipeline}，第 ${p.attempt} 次）`,
  saveArtifactSummary: (p) => `把产物 ${p.artifactId} 存为 ${p.path}`,
  overwriteArtifactSummary: (p) => `用产物 ${p.artifactId} 覆盖已有文件 ${p.path}`,

  exportSummary: (p) => {
    const range = p.rangeStart !== null ? `，${p.rangeStart}–${p.rangeEnd} 秒` : p.rangeCount !== null ? `，${p.rangeCount} 段` : '';
    const size =
      p.width !== null && p.height !== null
        ? `，${p.width}×${p.height}`
        : p.width !== null
          ? `，宽 ${p.width}`
          : p.height !== null
            ? `，高 ${p.height}`
            : '';
    const source = p.originalOnly ? '，只要原声' : p.dubGroupId ? `，只要配音 ${p.dubGroupId}` : '';
    return `导出${exportKindLabel(p.kind)}（${p.format}${range}${size}${source}）${p.fileName ? `为 ${p.fileName}` : ''}${p.overwrite ? '，覆盖已有文件' : ''}`;
  },

  installToolSummary: (p) =>
    `为了从链接下载视频，安装 ${p.tool} ${p.version}（${p.estimated ? `约 ${p.size}` : p.size}，${p.license}），来自 ${p.url}；之后从 ${p.host} 下载要用它`,
  linkImportSummary: (p) => `用 ${p.tool}${p.version ? ` ${p.version}` : ''} 从 ${p.host} 下载：${p.url}${linkImportAfter(p)}`,
  linkImportConsentSummary: (p) =>
    `允许 BaoCut 使用本机的 ${p.tool}${p.version ? ` ${p.version}` : ''}${p.path ? `（${p.path}）` : ''}从网站下载视频，并从 ${p.host} 下载：${p.url}${linkImportAfter(p)}`,

  downloadSaveSummary: (p) => `把工作目录里的 ${p.source}（${p.size}）复制到下载目录：${p.target}（重名时加序号，不覆盖）`,

  grantSummary: (p) => `把数据交给 ${p.recipients}：${p.items}`,
  grantSummaryItem: (p) => `${p.purpose}（${p.maxCalls === null ? '不限次数' : `至多 ${p.maxCalls} 次`}）`,

  testModelSummary: (p) => `检查本地模型包 ${p.bundleId}：用固定样本完整跑一遍`,
  installModelSummary: (p) =>
    `下载本地模型 ${p.bundleId}：${p.estimated ? `约 ${p.size}（大小未知，按估计）` : p.size}${p.resumed ? `，续传已下载的 ${p.resumed}` : ''}，来自 ${p.source}（${p.parts}）`,

  registerProjectSummary: (p) => `把已有的目录登记为项目 ${p.path}${p.name ? `（${p.name}）` : ''}`,
  createProjectSummary: (p) => `新建项目目录 ${p.path}${p.name ? `（${p.name}）` : ''}`,
};
