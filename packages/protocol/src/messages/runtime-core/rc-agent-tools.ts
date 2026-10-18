import { defineCatalog } from '../../message-ref.ts';
import { zhHans } from './rc-agent-tools.zh-Hans.ts';
import { zhHant } from './rc-agent-tools.zh-Hant.ts';
import { ja } from './rc-agent-tools.ja.ts';
import { ko } from './rc-agent-tools.ko.ts';
import { es } from './rc-agent-tools.es.ts';
import { fr } from './rc-agent-tools.fr.ts';
import { de } from './rc-agent-tools.de.ts';
import { nl } from './rc-agent-tools.nl.ts';
import { ptBR } from './rc-agent-tools.pt-BR.ts';
import { it } from './rc-agent-tools.it.ts';
import { ru } from './rc-agent-tools.ru.ts';
import { pl } from './rc-agent-tools.pl.ts';
import { tr } from './rc-agent-tools.tr.ts';
import { vi } from './rc-agent-tools.vi.ts';

/**
 * 智能体工具（agent-tools/）给用户看的文字：审批卡里的摘要、外发授权的用途、写进视频历史的修改说明。工具说明、错误与给智能体的
 * 下一步只给模型看，不在这里。英文是键与类型的来源，译文在 `rc-agent-tools.<语言>.ts`。
 */

/** 导出种类在摘要里的说法。 */
function exportKindLabel(kind: string): string {
  switch (kind) {
    case 'subtitles':
      return 'subtitles';
    case 'transcript':
      return 'transcript';
    case 'audio':
      return 'audio';
    case 'video':
      return 'video file';
    case 'portable':
      return 'portable package';
    case 'project':
      return 'project file';
    default:
      return kind;
  }
}

/** 从链接导入的摘要结尾：下载之后做什么。 */
function linkImportAfter(p: { target: string; name: string | null; transcribe: boolean; language: string | null; provider: string | null; model: string | null; captions: boolean; dir?: string | null }): string {
  // 文件放进指定目录：导入视频的照常说完，再说文件放在哪。
  if (p.dir && (p.target === 'create' || p.target === 'video')) return `${linkImportAfter({ ...p, dir: null })}, keeping the downloaded file in ${p.dir}`;
  const recognition = `${p.language ? `, language ${p.language}` : ''}${p.provider ? ` (${p.provider}${p.model ? ` ${p.model}` : ''})` : ''}`;
  if (p.target === 'create') {
    return `, create video${p.name ? ` "${p.name}"` : ' (named after the page title)'} and add it to the timeline${p.transcribe ? `, then transcribe it${recognition}${p.captions ? ' and create a subtitle layer' : ''}` : ''}`;
  }
  if (p.target === 'video') return `, import it into the video${p.transcribe ? ' and transcribe it' : ''}`;
  if (p.target === 'project') return `, save to the project's downloads/${p.transcribe ? ' and transcribe to TXT and SRT' : ''}`;
  if (p.target === 'download') return `, save to the Downloads folder${p.transcribe ? ' and transcribe to TXT and SRT' : ''}`;
  if (p.target === 'folder') return `, save to ${p.dir}${p.transcribe ? ' and transcribe to TXT and SRT' : ''}`;
  return '';
}

/** 读取哪些浏览器的登录 Cookie（智能体显式给了 `cookieBrowsers` 时）。 */
function linkImportCookies(p: { cookies: string | null }): string {
  return p.cookies ? `; use website sign-in cookies from ${p.cookies}` : '';
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

const en = {
  instructionsNotSet: 'Session instructions have not been set: Runtime assembly order is incorrect',

  /** 列表里各项之间的分隔。 */
  listSeparator: ', ',
  /** 几段说明之间的分隔。 */
  clauseSeparator: '; ',

  createVideoSummary: (p: { name: string }) => `Create video "${p.name}"`,
  slidesImportAssetSummary: (p: { file: string; deck: string }) => `Add "${p.file}" to the slides "${p.deck}"`,
  designImportAssetSummary: (p: { file: string; canvas: string }) => `Add "${p.file}" to the design "${p.canvas}"`,
  designSystemImportAssetSummary: (p: { file: string; system: string }) => `Add "${p.file}" to the design system "${p.system}"`,
  docsEditSummary: (p: { doc: string }) => `Edit the doc "${p.doc}"`,
  docsCreateSummary: (p: { doc: string }) => `Create the doc "${p.doc}"`,
  docsCommentSummary: (p: { doc: string }) => `Comment in the doc "${p.doc}"`,
  docsDeleteSummary: (p: { doc: string }) => `Delete from the doc "${p.doc}"`,
  docsUploadSummary: (p: { file: string; doc: string }) => `Add "${p.file}" to the doc "${p.doc}"`,
  docsExportSummary: (p: { file: string; doc: string }) => `Export the doc "${p.doc}" as Markdown to "${p.file}"`,
  editsSummary: (p: { label: string; count: number; types: string }) =>
    `${p.label} (${plural(p.count, 'operation', 'operations')}: ${p.types})`,
  captionsSummary: (p: { documentId: string; bilingual: boolean }) =>
    `Add a ${p.bilingual ? 'bilingual ' : ''}subtitle layer for document ${p.documentId}`,
  /** 建立字幕层这笔修改在视频历史与撤销里的说明。 */
  captionsLabel: 'Add subtitle layer',
  undoSummary: (p: { transactionId: string }) => `Undo edit ${p.transactionId}`,
  undoLatestSummary: 'Undo the latest edit',
  saveVersionSummary: (p: { name: string }) => `Save the current state as version "${p.name}"`,
  restoreVersionSummary: (p: { version: number }) => `Restore version ${p.version}`,
  restoreBeforeVersionSummary: (p: { version: number }) => `Restore to before version ${p.version}`,
  deleteVideoSummary: (p: { name: string; path: string; days: number }) =>
    `Delete video "${p.name}" (${p.path}): move it to the Trash, where it can be restored in Space for ${plural(p.days, 'day', 'days')}. Original files of linked assets stay where they are`,
  importPackageSummary: (p: { file: string }) => `Open portable package ${p.file}`,
  /** 打开便携包时给了 name、改视频名这笔修改在视频历史里的说明。 */
  renameVideoLabel: 'Rename video',
  putDocumentSummary: (p: { documentId: string }) => `Write a new version of document ${p.documentId}`,
  newDocumentSummary: (p: { kind: string }) => `Create a document (${p.kind})`,
  /** 写文档这笔修改在视频历史与撤销里的说明（智能体没有给 label 时）。 */
  updateDocumentLabel: (p: { name: string }) => `Update document "${p.name}"`,
  newDocumentLabel: (p: { name: string }) => `Create document "${p.name}"`,
  /** 新建译文没有给名字时，说明里用的名字。 */
  translationDocumentName: (p: { language: string }) => `${p.language} translation`,
  importAssetSummary: (p: { name: string; place: boolean }) => `Import asset ${p.name}${p.place ? ' and add it to the timeline' : ''}`,
  /** 导入素材这笔修改在视频历史与撤销里的说明。 */
  importAssetLabel: (p: { name: string; place: boolean }) => `Import ${p.name}${p.place ? ' and add it to the timeline' : ''}`,
  /** 下载网上素材只存文件（`assets_download` 给 `outDir`）：确认摘要，`target` 是计划写入的路径。 */
  openMediaSaveSummary: (p: { title: string; source: string; license: string; target: string }) => `Download "${p.title}" from ${p.source} (${p.license}) to ${p.target} (numbered if the name is taken, never overwritten)`,
  /** 下载网上素材（`assets_download`）：确认摘要；这笔修改的说明用 importAssetLabel。 */
  openMediaDownloadSummary: (p: { title: string; source: string; license: string; place: boolean }) => `Download "${p.title}" from ${p.source} (${p.license}) and import it${p.place ? ' onto the timeline' : ''}`,
  /** 程序化音效（`assets_sfx`）：确认摘要。`recipe` 是配方名（不翻译）。 */
  sfxSummary: (p: { recipe: string; place: boolean }) => `Generate the "${p.recipe}" sound effect and import it${p.place ? ' onto the timeline' : ''}`,
  /** 原地替换代码画面（`compositions_import` 带 `replace`）：确认摘要与这笔修改在视频历史里的说明。 */
  replaceCompositionSummary: (p: { name: string; clip: string }) => `Import ${p.name} and swap it into clip ${p.clip} on the timeline`,
  replaceCompositionLabel: (p: { name: string }) => `Replace the motion graphic with ${p.name}`,
  /** 清理没有引用的素材（`assets_prune` 带 `apply`）：确认摘要与这笔修改在视频历史里的说明。`names` 是素材名的列表。 */
  pruneAssetsSummary: (p: { count: number; names: string }) => `Remove unused assets from the video (${p.count}): ${p.names}`,
  pruneAssetsLabel: (p: { count: number }) => `Remove unused assets (${p.count})`,
  /** 采用来源章节（`chapters_adopt`）：确认摘要与这笔修改在视频历史里的缺省说明。`existing` 是会被替换的现有章节数。 */
  adoptChaptersSummary: (p: { count: number; existing: number; asset: string }) =>
    `Use the source chapters of ${p.asset} (${p.count})${p.existing ? `, replacing the current chapters (${p.existing})` : ''}`,
  adoptChaptersLabel: 'Adopt source chapters',

  transcribePurpose: (p: { assetId: string }) => `Transcribe asset ${p.assetId}`,
  transcribeSummary: (p: { assetId: string; provider: string | null; model: string | null }) =>
    `Transcribe asset ${p.assetId}${p.provider ? ` (${p.provider}${p.model ? ` ${p.model}` : ''})` : ''}`,
  speechPurpose: (p: { chars: number }) => `Synthesize speech (${plural(p.chars, 'character', 'characters')})`,
  speechSummary: (p: { chars: number; provider: string | null; voice: string | null }) =>
    `Synthesize speech (${plural(p.chars, 'character', 'characters')}${p.provider ? `, ${p.provider}` : ''}${p.voice ? `, voice ${p.voice}` : ''})`,
  imageInputsSpaceUnavailable: 'The Space catalog isn’t ready yet, so input images can’t be given as Space entries',
  imageInputsPurpose: (p: { prompt: string; inputs: number }) => `Generate image (input images: ${p.inputs}): ${p.prompt}`,
  imagePurpose: (p: { prompt: string }) => `Generate image: ${p.prompt}`,
  musicPurpose: (p: { style: string }) => `Generate music: ${p.style}`,
  musicSummary: (p: { mode: string; seconds: number | null; provider: string | null; style: string }) => `Generate ${p.mode === 'song' ? 'a song' : 'instrumental music'}${p.seconds ? `, up to ${p.seconds} s` : ''}${p.provider ? `, ${p.provider}` : ''}: ${p.style}`,
  imageSummary: (p: { count: number; size: string | null; provider: string | null; prompt: string }) =>
    `Generate ${plural(p.count, 'image', 'images')}${p.size ? `, ${p.size}` : ''}${p.provider ? `, ${p.provider}` : ''}: ${p.prompt}`,
  cancelJobSummary: (p: { jobId: string }) => `Cancel task ${p.jobId}`,
  retryPipelineSummary: (p: { jobId: string; pipeline: string; attempt: number }) =>
    `Rerun pipeline ${p.jobId} (${p.pipeline}, attempt ${p.attempt}) from the step that failed`,
  saveArtifactSummary: (p: { artifactId: string; path: string }) => `Save output ${p.artifactId} as ${p.path}`,
  overwriteArtifactSummary: (p: { artifactId: string; path: string }) =>
    `Overwrite the existing file ${p.path} with output ${p.artifactId}`,

  exportSummary: (p: {
    kind: string;
    format: string;
    rangeStart: number | null;
    rangeEnd: number | null;
    rangeCount: number | null;
    width: number | null;
    height: number | null;
    originalOnly: boolean;
    dubGroupId: string | null;
    fileName: string | null;
    overwrite: boolean;
  }) => {
    const range =
      p.rangeStart !== null ? `, ${p.rangeStart}–${p.rangeEnd}s` : p.rangeCount !== null ? `, ${plural(p.rangeCount, 'range', 'ranges')}` : '';
    const size =
      p.width !== null && p.height !== null
        ? `, ${p.width}×${p.height}`
        : p.width !== null
          ? `, width ${p.width}`
          : p.height !== null
            ? `, height ${p.height}`
            : '';
    const source = p.originalOnly ? ', original audio only' : p.dubGroupId ? `, voice-over ${p.dubGroupId} only` : '';
    return `Export ${exportKindLabel(p.kind)} (${p.format}${range}${size}${source})${p.fileName ? ` as ${p.fileName}` : ''}${p.overwrite ? ', overwriting the existing file' : ''}`;
  },

  installToolSummary: (p: { tool: string; version: string; size: string; estimated: boolean; license: string; url: string; host: string }) =>
    `Install ${p.tool} ${p.version} (${p.estimated ? `about ${p.size}` : p.size}, ${p.license}) from ${p.url} to download videos from links; downloading from ${p.host} needs it`,
  linkImportSummary: (p: { tool: string; version: string; host: string; url: string; target: string; name: string | null; transcribe: boolean; language: string | null; provider: string | null; model: string | null; captions: boolean; cookies: string | null; dir: string | null }) =>
    `Download from ${p.host} with ${p.tool}${p.version ? ` ${p.version}` : ''}: ${p.url}${linkImportAfter(p)}${linkImportCookies(p)}`,
  linkImportConsentSummary: (p: {
    tool: string;
    version: string;
    path: string;
    host: string;
    url: string;
    target: string;
    name: string | null;
    transcribe: boolean;
    language: string | null;
    provider: string | null;
    model: string | null;
    captions: boolean;
    cookies: string | null;
    dir: string | null;
  }) =>
    `Allow BaoCut to use ${p.tool}${p.version ? ` ${p.version}` : ''} on this computer${p.path ? ` (${p.path})` : ''} to download videos from websites, and download from ${p.host}: ${p.url}${linkImportAfter(p)}${linkImportCookies(p)}`,

  downloadSaveSummary: (p: { source: string; size: string; target: string }) =>
    `Copy ${p.source} (${p.size}) from the working folder to the Downloads folder: ${p.target} (numbered if the name is taken, never overwritten)`,

  grantSummary: (p: { recipients: string; items: string }) => `Share data with ${p.recipients}: ${p.items}`,
  grantSummaryItem: (p: { purpose: string; maxCalls: number | null }) =>
    `${p.purpose} (${p.maxCalls === null ? 'no call limit' : `up to ${plural(p.maxCalls, 'call', 'calls')}`})`,

  testModelSummary: (p: { bundleId: string }) => `Check local model bundle ${p.bundleId}: run it end to end on a fixed sample`,
  installModelSummary: (p: { bundleId: string; size: string; estimated: boolean; resumed: string | null; source: string; parts: string }) =>
    `Download local model ${p.bundleId}: ${p.estimated ? `about ${p.size} (size unknown, estimated)` : p.size}${p.resumed ? `, resuming ${p.resumed} already downloaded` : ''}, from ${p.source} (${p.parts})`,

  registerProjectSummary: (p: { path: string; name: string | null }) =>
    `Register the existing folder ${p.path} as a project${p.name ? ` (${p.name})` : ''}`,
  createProjectSummary: (p: { path: string; name: string | null }) => `Create project folder ${p.path}${p.name ? ` (${p.name})` : ''}`,
  adoptSessionSummary: (p: { name: string | null }) =>
    `Create a project ${p.name ? `“${p.name}”` : 'named after the first video'} and move this session’s videos and files into it`,
  /** 派生子视频（videos_derive）的审批摘要；from、to 是时间线上的 mm:ss。 */
  deriveVideoSummary: (p: { name: string; from: string; to: string }) => `Create a child video "${p.name}" from ${p.from}–${p.to} of this video`,
  /** 子视频里派生那笔修改在历史与撤销里的说明；name 是父视频名。 */
  deriveVideoLabel: (p: { name: string }) => `Derive from "${p.name}"`,
  /** 子视频里派生来源文档（kind derivation）的名字。 */
  derivationDocumentName: 'Derivation source',
  /** videos.derive 的错误（错误码 DERIVE_RANGE_EMPTY、DERIVE_UNSUPPORTED_ITEM、DERIVE_PARENT_UNPLACED）。 */
  deriveRangeEmpty: 'The range is empty after snapping to frames',
  deriveUnsupportedItem: (p: { kind: string }) => `The range contains a clip that can’t be copied into a child video (${p.kind})`,
  deriveParentUnplaced: 'This video isn’t inside a project or session folder, so a child video can’t be created next to it',
  /** videos.shots 的错误（错误码 SHOTS_RANGE_EMPTY、SHOTS_RANGE_TOO_LONG）；minutes 是区间长度的上限。 */
  shotsRangeEmpty: 'The range is empty after snapping to frames',
  shotsRangeTooLong: (p: { minutes: number }) => `The range is longer than ${p.minutes} minutes; detect shots in shorter pieces`,
};

export type RcAgentToolsMessages = typeof en;

export const RcAgentTools = defineCatalog('rcAgentTools', en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
