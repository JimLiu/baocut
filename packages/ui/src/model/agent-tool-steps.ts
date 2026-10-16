import { defineMessages, live, type TimelineItem } from '@baocut/protocol';
import { zhHans } from './agent-tool-steps.zh-Hans.ts';
import { zhHant } from './agent-tool-steps.zh-Hant.ts';
import { ja } from './agent-tool-steps.ja.ts';
import { ko } from './agent-tool-steps.ko.ts';
import { es } from './agent-tool-steps.es.ts';
import { fr } from './agent-tool-steps.fr.ts';
import { de } from './agent-tool-steps.de.ts';
import { nl } from './agent-tool-steps.nl.ts';
import { ptBR } from './agent-tool-steps.pt-BR.ts';
import { it } from './agent-tool-steps.it.ts';
import { ru } from './agent-tool-steps.ru.ts';
import { pl } from './agent-tool-steps.pl.ts';
import { tr } from './agent-tool-steps.tr.ts';
import { vi } from './agent-tool-steps.vi.ts';

/** 步骤行的文案（英文是键与类型的来源，译文在 `agent-tool-steps.zh-Hans.ts`）。 */
const en = {
  label: {
    translate: 'Translate',
    cut: 'Cut',
    importAssets: 'Import assets',
    searchOnlineAssets: 'Search online assets',
    downloadOnlineAsset: 'Download online asset',
    makeSoundEffect: 'Make sound effect',
    analyzeAudio: 'Analyze audio',
    editVideo: 'Edit video',
    listVideos: 'List videos',
    newVideo: 'New video',
    readVideo: 'Read video',
    deleteVideo: 'Delete video',
    readTranscript: 'Read transcript',
    undoEdit: 'Undo edit',
    captions: 'Create subtitle layer',
    transcribe: 'Transcribe',
    dub: 'Translate & dub',
    mergeFiles: 'Merge files',
    extractAudio: 'Extract audio',
    compressFiles: 'Compress files',
    speech: 'Synthesize speech',
    image: 'Generate images',
    models: 'View models',
    installModel: 'Download local model',
    export: 'Export',
    downloadVideo: 'Download video',
    saveToDownloads: 'Save to Downloads',
    viewTask: 'View task',
    cancelTask: 'Cancel task',
    saveOutput: 'Save output',
    browseSpace: 'Browse Space',
    searchSpace: 'Search Space',
    findSpeech: 'Find relevant speech',
    locateHit: 'Locate search result',
    indexStatus: 'Check semantic index',
    buildIndex: 'Build semantic index',
    relatedVideos: 'Find related videos',
    findFrames: 'Find matching frames',
    findRetakes: 'Find retakes',
    checkTerms: 'Check terms',
    topicShifts: 'Find topic shifts',
    readSkill: 'Read skill',
    requestGrant: 'Request grant',
    readContract: 'Read task contract',
    refineContract: 'Refine task contract',
    recordCheck: 'Record acceptance check',
    renameSession: 'Rename session',
    listProjects: 'List projects',
    newProject: 'New project',
    moveToNewProject: 'Move to new project',
    checkSlides: 'Check slides',
    importSlideAsset: 'Import slide image',
    checkDesign: 'Check design',
    importDesignAsset: 'Import design asset',
    checkDesignSystem: 'Check design system',
    importDesignSystemAsset: 'Import design system asset',
    createDoc: 'Create doc',
    editDoc: 'Edit doc',
    addToDoc: 'Add to doc',
    commentInDoc: 'Comment in doc',
    readDoc: 'Read doc',
    readDocComments: 'Read doc comments',
    deleteFromDoc: 'Delete from doc',
    uploadToDoc: 'Upload to doc',
    exportDoc: 'Export doc',
  },
  exportKind: {
    subtitles: 'Subtitles',
    transcript: 'Transcript',
    audio: 'Audio',
    video: 'Export',
    portable: 'Portable package',
    project: 'Project file',
  } as Record<string, string>,
  places: (n: number) => (n === 1 ? '1 place' : `${n} places`),
  count: (n: number) => `${n}`,
  bilingual: 'Bilingual',
  images: (n: number) => (n === 1 ? '1 image' : `${n} images`),
  files: (n: number) => (n === 1 ? '1 file' : `${n} files`),
};
export type AgentToolStepsMessages = typeof en;
const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });

/**
 * 会话线程里 BaoCut 自己的工具（Runtime 的 MCP 工具通道，服务名 `baocut`）在步骤行上怎么念（产品设计 §3.2.2，
 * 原型 model-agent-tools.js）：不写「其他工具」，而是这一类自己的名字加一句摘要（「转录 · large-v3」「生成图片 · 4 张」）。
 *
 * 工具名以 Runtime 的工具目录为准（packages/runtime-core/src/agent-tools）；摘要只取参数里现成的字段，没有就只给类别名。
 * 原型里有、参数里没有的（转录的时长、翻译的句数、剪辑的原因）不写。
 */

type ToolCall = Extract<TimelineItem, { kind: 'tool-call' }>;

/** 步骤行的类别键：图标按它取；`stepsSummary` 仍按「调用了工具」归纳。 */
export type BaoCutStepKind =
  | 'video-list'
  | 'video-create'
  | 'video-read'
  | 'video-delete'
  | 'document-read'
  | 'translate'
  | 'cut'
  | 'import'
  | 'edit-video'
  | 'undo'
  | 'captions'
  | 'transcribe'
  | 'speech'
  | 'image'
  | 'models'
  | 'model-install'
  | 'export'
  | 'download'
  | 'downloads-save'
  | 'job'
  | 'artifact'
  | 'space'
  | 'space-search'
  | 'skill'
  | 'grant'
  | 'contract'
  | 'conversation'
  | 'project'
  | 'slides'
  | 'design'
  | 'design-system'
  | 'docs';

export interface BaoCutStep {
  kind: BaoCutStepKind;
  label: string;
  summary: string;
}

type Args = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const join = (...parts: (string | null | undefined)[]) => parts.filter((p) => p != null && p !== '').join(' · ');
const base = (p: unknown) => (str(p) ?? '').split(/[\\/]/).filter(Boolean).pop() ?? '';

/** 链接的站点：`https://www.youtube.com/watch?…` → `youtube.com`。 */
function host(url: unknown): string | null {
  const m = /^https?:\/\/([^/?#]+)/i.exec(str(url) ?? '');
  return m ? m[1]!.replace(/^www\./i, '') : null;
}

const EXPORT_KIND: Record<string, string> = live(() => M.exportKind);

const CUT_OPS = new Set(['removeRange', 'addCuts', 'deleteItems']);

/** `edits_apply`：按操作分类别。写一份译文是「翻译」，删区间与加剪口是「剪辑」，导入素材是「导入素材」，其余是「修改视频」。 */
function editStep(a: Args): BaoCutStep {
  const ops = Array.isArray(a.operations) ? (a.operations as Args[]) : [];
  const translation = ops.find((op) => op?.type === 'putDocument' && op.kind === 'translation');
  if (translation) return { kind: 'translate', label: M.label.translate, summary: str(translation.language) ?? '' };
  const cuts = ops.filter((op) => CUT_OPS.has(String(op?.type)));
  if (cuts.length && cuts.length === ops.length) {
    const count = cuts.reduce((n, op) => n + (op.type === 'addCuts' && Array.isArray(op.cuts) ? op.cuts.length : 1), 0);
    return { kind: 'cut', label: M.label.cut, summary: M.places(count) };
  }
  const imports = ops.filter((op) => op?.type === 'importAsset');
  if (imports.length && imports.length === ops.length) {
    return {
      kind: 'import',
      label: M.label.importAssets,
      summary: imports.length === 1 ? (str(imports[0]!.name) ?? base(imports[0]!.path)) : M.count(imports.length),
    };
  }
  return { kind: 'edit-video', label: M.label.editVideo, summary: str(a.label) ?? '' };
}

const CATALOG: Record<string, (a: Args) => BaoCutStep> = {
  videos_list: () => ({ kind: 'video-list', label: M.label.listVideos, summary: '' }),
  videos_create: (a) => ({ kind: 'video-create', label: M.label.newVideo, summary: str(a.name) ?? '' }),
  videos_inspect: (a) => ({ kind: 'video-read', label: M.label.readVideo, summary: str(a.video) ?? '' }),
  videos_delete: (a) => ({ kind: 'video-delete', label: M.label.deleteVideo, summary: str(a.video) ?? '' }),
  documents_read: (a) => ({ kind: 'document-read', label: M.label.readTranscript, summary: str(a.video) ?? '' }),
  edits_apply: editStep,
  edits_undo: () => ({ kind: 'undo', label: M.label.undoEdit, summary: '' }),
  captions_create: (a) => ({ kind: 'captions', label: M.label.captions, summary: a.bilingual === true ? M.bilingual : '' }),
  transcribe: (a) => ({ kind: 'transcribe', label: M.label.transcribe, summary: str(a.model) ?? str(a.provider) ?? host(a.url) ?? base(a.file) }),
  translate: (a) => ({ kind: 'translate', label: M.label.translate, summary: str(a.to) ?? '' }),
  dub: (a) => ({ kind: 'speech', label: M.label.dub, summary: join(str(a.to), str(a.voice)) }),
  transcode: (a) => ({
    kind: 'export',
    label: a.merge === true ? M.label.mergeFiles : a.extractAudio === true ? M.label.extractAudio : M.label.compressFiles,
    summary: Array.isArray(a.files) ? M.files(a.files.length) : '',
  }),
  speak: (a) => ({ kind: 'speech', label: M.label.speech, summary: str(a.voice) ?? '' }),
  image: (a) => ({ kind: 'image', label: M.label.image, summary: M.images(num(a.count) ?? 1) }),
  models_capabilities: () => ({ kind: 'models', label: M.label.models, summary: '' }),
  models_install: (a) => ({ kind: 'model-install', label: M.label.installModel, summary: str(a.bundleId) ?? '' }),
  export: (a) => ({
    kind: 'export',
    label: M.label.export,
    summary: join(EXPORT_KIND[String(a.kind)] ?? null, str(a.format)?.toUpperCase()),
  }),
  download: (a) => ({ kind: 'download', label: M.label.downloadVideo, summary: host(a.url) ?? '' }),
  assets_search: (a) => ({ kind: 'space-search', label: M.label.searchOnlineAssets, summary: str(a.query) ?? '' }),
  assets_download: (a) => ({ kind: 'download', label: M.label.downloadOnlineAsset, summary: str(a.name) ?? str(a.id) ?? '' }),
  assets_sfx: (a) => ({ kind: 'import', label: M.label.makeSoundEffect, summary: str(a.name) ?? str(a.recipe) ?? '' }),
  assets_analyze: (a) => ({ kind: 'video-read', label: M.label.analyzeAudio, summary: str(a.asset) ?? base(a.path) }),
  downloads_save: (a) => ({ kind: 'downloads-save', label: M.label.saveToDownloads, summary: str(a.name) ?? base(a.path) }),
  jobs_inspect: () => ({ kind: 'job', label: M.label.viewTask, summary: '' }),
  jobs_cancel: () => ({ kind: 'job', label: M.label.cancelTask, summary: '' }),
  artifacts_save: (a) => ({ kind: 'artifact', label: M.label.saveOutput, summary: str(a.path) ?? '' }),
  space_list: () => ({ kind: 'space', label: M.label.browseSpace, summary: '' }),
  space_search: (a) => ({ kind: 'space-search', label: M.label.searchSpace, summary: str(a.query) ?? '' }),
  // 本机语义检索与索引（只读的检索、取材与相关视频；催建索引）。
  space_search_v2: (a) => ({ kind: 'space-search', label: M.label.searchSpace, summary: str(a.query) ?? '' }),
  space_resolve_search_hit: () => ({ kind: 'space-search', label: M.label.locateHit, summary: '' }),
  speech_relevant: (a) => ({ kind: 'space-search', label: M.label.findSpeech, summary: str(a.intent) ?? '' }),
  space_related_videos: (a) => ({ kind: 'space-search', label: M.label.relatedVideos, summary: str(a.videoId) ?? '' }),
  videos_match_frames: (a) => ({ kind: 'space-search', label: M.label.findFrames, summary: str(a.text) ?? '' }),
  space_index_status: () => ({ kind: 'space', label: M.label.indexStatus, summary: '' }),
  space_index_build: () => ({ kind: 'space', label: M.label.buildIndex, summary: '' }),
  speech_retakes: (a) => ({ kind: 'document-read', label: M.label.findRetakes, summary: str(a.video) ?? '' }),
  speech_glossary_candidates: (a) => ({ kind: 'document-read', label: M.label.checkTerms, summary: str(a.video) ?? '' }),
  speech_topic_boundaries: (a) => ({ kind: 'document-read', label: M.label.topicShifts, summary: str(a.video) ?? '' }),
  skills_read: (a) => ({ kind: 'skill', label: M.label.readSkill, summary: str(a.id) ?? '' }),
  grants_request: () => ({ kind: 'grant', label: M.label.requestGrant, summary: '' }),
  tasks_contract: () => ({ kind: 'contract', label: M.label.readContract, summary: '' }),
  tasks_update_contract: () => ({ kind: 'contract', label: M.label.refineContract, summary: '' }),
  tasks_record_check: (a) => ({ kind: 'contract', label: M.label.recordCheck, summary: str(a.checkId) ?? '' }),
  conversations_set_title: (a) => ({ kind: 'conversation', label: M.label.renameSession, summary: str(a.title) ?? '' }),
  // 项目：新建念项目名（没给时念目录名）；把会话放进新项目念用户给的名字，没给时只给类别名。
  projects_list: () => ({ kind: 'project', label: M.label.listProjects, summary: '' }),
  projects_create: (a) => ({ kind: 'project', label: M.label.newProject, summary: str(a.name) ?? base(a.path) }),
  projects_adopt_session: (a) => ({ kind: 'project', label: M.label.moveToNewProject, summary: str(a.name) ?? '' }),
  // 幻灯片（docs/design/slides §7.2）：摘要是 deck 目录名与图片文件名。
  slides_check: (a) => ({ kind: 'slides', label: M.label.checkSlides, summary: base(a.path) }),
  slides_import_asset: (a) => ({ kind: 'slides', label: M.label.importSlideAsset, summary: base(a.path) }),
  // 设计稿（docs/design/canvas §7.2）：摘要是设计稿目录名与素材文件名。
  design_check: (a) => ({ kind: 'design', label: M.label.checkDesign, summary: base(a.path) }),
  design_import_asset: (a) => ({ kind: 'design', label: M.label.importDesignAsset, summary: base(a.path) }),
  // 设计系统（docs/design/canvas §10.5）：摘要是设计系统目录名，导入素材的是文件名与素材组。
  design_system_check: (a) => ({ kind: 'design-system', label: M.label.checkDesignSystem, summary: base(a.path) }),
  design_system_import_asset: (a) => ({
    kind: 'design-system',
    label: M.label.importDesignSystemAsset,
    summary: join(base(a.path), str(a.group)),
  }),
  // 协作文档（docs/design/docs）：摘要是文档目录名；新建文档时是新文档的名字，上传与导出另带文件名。
  docs_batch: (a) => {
    const create = (a.container as Args | undefined)?.create as Args | undefined;
    return create
      ? { kind: 'docs', label: M.label.createDoc, summary: str(create.name) ?? base(a.doc) }
      : { kind: 'docs', label: M.label.editDoc, summary: base(a.doc) };
  },
  docs_create: (a) => ({ kind: 'docs', label: a.object === 'utterance' ? M.label.commentInDoc : M.label.addToDoc, summary: base(a.doc) }),
  docs_read: (a) => ({ kind: 'docs', label: M.label.readDoc, summary: base(a.doc) }),
  docs_update: (a) => ({ kind: 'docs', label: M.label.editDoc, summary: base(a.doc) }),
  docs_query: (a) => ({ kind: 'docs', label: M.label.readDocComments, summary: base(a.doc) }),
  docs_delete: (a) => ({ kind: 'docs', label: M.label.deleteFromDoc, summary: base(a.doc) }),
  docs_upload: (a) => ({ kind: 'docs', label: M.label.uploadToDoc, summary: join(base(a.doc), base(a.path)) }),
  docs_export: (a) => ({ kind: 'docs', label: M.label.exportDoc, summary: join(base(a.doc), base(a.to)) }),
};

/** 工具名：MCP 的 `baocut.<tool>`；不是 BaoCut 的工具返回 null。 */
export function baocutToolName(item: Pick<ToolCall, 'tool' | 'title'>): string | null {
  if (item.tool !== 'mcp' || !item.title.startsWith('baocut.')) return null;
  return item.title.slice('baocut.'.length);
}

/** 一次 BaoCut 工具调用在步骤行上的类别名与摘要；不认得的工具返回 null（照原来的写法）。 */
export function baocutStep(item: Pick<ToolCall, 'tool' | 'title' | 'detail'>): BaoCutStep | null {
  const name = baocutToolName(item);
  const describe = name ? CATALOG[name] : undefined;
  if (!describe) return null;
  let args: Args = {};
  try {
    const parsed = item.detail ? (JSON.parse(item.detail) as unknown) : null;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) args = parsed as Args;
  } catch {
    args = {};
  }
  const step = describe(args);
  return { ...step, summary: step.summary.trim() };
}
