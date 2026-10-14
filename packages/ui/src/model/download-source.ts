import {
  DEFAULT_MODELS_ENDPOINT,
  DOWNLOAD_MIRROR_NAME_MAX,
  DOWNLOAD_MIRRORS_MAX,
  isModelScopeEndpoint,
  MODELSCOPE_ENDPOINT,
  type DownloadMirror,
  type ModelInstallPlan,
  type SettingValues,
} from '@baocut/protocol';
import { endpointProblem } from './general-settings.ts';
import { M } from './download-source-copy.ts';

/**
 * 下载来源（架构设计 §6.3「来源」、§12.9；设计稿 model-download-sources.js `BC_DLSRC`、download-sources.jsx）。
 *
 * 两种来源，地址的拼法不同，不能混用：
 * - `models` 模型仓库：模型权重与大多数组件。内置 Hugging Face（存 null）与 ModelScope（存它的基址），镜像按 Hugging Face 的路径提供文件。
 *   在用的写 `models.downloadEndpoint`，添加的镜像存在 `models.downloadMirrors`。
 * - `tools` 工具与运行库：yt-dlp 等外部工具与 GitHub 发布页上的组件（LiteRT-LM 运行时、audio.cpp 引擎）。内置 GitHub（存 null，
 *   各自的官方发布页），镜像按「基址/名称/版本/文件名」提供。在用的写 `tools.downloadEndpoint`，镜像存在 `tools.downloadMirrors`。
 *
 * 镜像列表只是备选清单，Runtime 下载只看在用的那个基址。以前存下的自定义基址不在列表里时照样列成一个镜像（没名字，显示主机名），
 * 编辑或删除它时才写进列表。环境变量优先于在用的选择；Runtime 不告诉界面它设没设，这里只提一句。
 */

export const DOWNLOAD_SOURCE_COPY = M;

export type SourceKind = 'models' | 'tools';
export const SOURCE_KINDS: readonly SourceKind[] = ['models', 'tools'];

/** 环境变量的名字（与 `@baocut/models` 的 `MODELS_ENDPOINT_ENV`、Runtime 的 `BAOCUT_TOOLS_ENDPOINT` 相同）。 */
export const MODELS_ENDPOINT_ENV = 'BAOCUT_MODELS_ENDPOINT';
export const TOOLS_ENDPOINT_ENV = 'BAOCUT_TOOLS_ENDPOINT';
/** 官方发布页的主机：工具与运行库的默认来源。 */
export const GITHUB_ENDPOINT = 'https://github.com';

const KEYS = {
  models: { endpoint: 'models.downloadEndpoint', mirrors: 'models.downloadMirrors', env: MODELS_ENDPOINT_ENV, placeholder: 'https://hf-mirror.example.com' },
  tools: { endpoint: 'tools.downloadEndpoint', mirrors: 'tools.downloadMirrors', env: TOOLS_ENDPOINT_ENV, placeholder: 'https://gh-mirror.example.com' },
} as const;

export function endpointKey(kind: SourceKind): 'models.downloadEndpoint' | 'tools.downloadEndpoint' {
  return KEYS[kind].endpoint;
}
export function mirrorsKey(kind: SourceKind): 'models.downloadMirrors' | 'tools.downloadMirrors' {
  return KEYS[kind].mirrors;
}
export function envName(kind: SourceKind): string {
  return KEYS[kind].env;
}
export function mirrorPlaceholder(kind: SourceKind): string {
  return KEYS[kind].placeholder;
}

/** 一种来源的标题与说明。 */
export function kindTitle(kind: SourceKind): string {
  return kind === 'models' ? M.kindModels : M.kindTools;
}
export function kindDesc(kind: SourceKind): string {
  return kind === 'models' ? M.kindModelsDesc : M.kindToolsDesc;
}

/** 选择器与列表里的一项。 */
export interface DownloadSource {
  /** 内置的是 `hf` / `ms` / `gh`；镜像是 `mirror:<基址>`。 */
  id: string;
  /** 给人看的名字：内置的是名字（不翻译）；镜像是起的名字，没起时是主机。 */
  name: string;
  /** 名字下面的一行小字。 */
  hint: string;
  /** 基址（结尾不带 `/`）。 */
  base: string;
  host: string;
  builtin: boolean;
  /** 选它时 `*.downloadEndpoint` 要存的值。 */
  endpoint: string | null;
  /** 镜像：用户起的名字（可能是空串）；内置的 null。 */
  mirrorName: string | null;
  /** 存着的基址不在列表里（以前在文本框里填的）：列出来，但还没写进镜像列表。 */
  legacy?: boolean;
}

export function trimBase(text: string): string {
  return text.trim().replace(/\/+$/, '');
}

export function hostOf(base: string): string {
  try {
    return new URL(base).host;
  } catch {
    return trimBase(base);
  }
}

/** 填好的镜像在列表里显示的名字：没起名字时是主机名，同 `sourceState`。 */
export function draftName(draft: MirrorDraft): string {
  return draft.name.trim() || hostOf(trimBase(draft.base));
}

function sameBase(a: string, b: string): boolean {
  return trimBase(a).toLowerCase() === trimBase(b).toLowerCase();
}

const HF_HOST = new URL(DEFAULT_MODELS_ENDPOINT).hostname;
const MS_HOST = new URL(MODELSCOPE_ENDPOINT).hostname.replace(/^www\./, '');

function builtins(kind: SourceKind): DownloadSource[] {
  const make = (id: string, name: string, base: string, hint: string, endpoint: string | null): DownloadSource => ({
    id,
    name,
    hint,
    base,
    host: hostOf(base),
    builtin: true,
    endpoint,
    mirrorName: null,
  });
  if (kind === 'tools') return [make('gh', 'GitHub', GITHUB_ENDPOINT, `${M.ghHint} · ${M.isDefault}`, null)];
  return [
    make('hf', 'Hugging Face', DEFAULT_MODELS_ENDPOINT, `${HF_HOST} · ${M.isDefault}`, null),
    make('ms', 'ModelScope', MODELSCOPE_ENDPOINT, `${MS_HOST} · ${M.msHint}`, MODELSCOPE_ENDPOINT),
  ];
}

function mirrorSource(m: DownloadMirror, legacy = false): DownloadSource {
  const base = trimBase(m.base);
  const host = hostOf(base);
  return {
    id: `mirror:${base.toLowerCase()}`,
    name: m.name.trim() || host,
    hint: m.name.trim() ? `${host} · ${M.mirrorHint}` : M.mirrorHint,
    base,
    host,
    builtin: false,
    endpoint: base,
    mirrorName: m.name.trim(),
    ...(legacy ? { legacy: true } : {}),
  };
}

/** 存着的基址对上的内置来源；对不上时 null（是镜像）。 */
function builtinOf(kind: SourceKind, endpoint: string): DownloadSource | null {
  const [first, ...rest] = builtins(kind);
  if (kind === 'models') {
    if (isModelScopeEndpoint(endpoint)) return rest[0]!;
    try {
      const url = new URL(endpoint);
      if ((url.hostname === HF_HOST || url.hostname === `www.${HF_HOST}`) && url.pathname.replace(/\/+$/, '') === '') return first!;
    } catch {
      // 不是网址：合同不让存这样的值，万一有就当镜像列出来。
    }
  }
  return null;
}

export interface SourceState {
  /** 这一种的全部选项：内置的在前，镜像按添加的顺序；以前存下、不在列表里的基址排在最后。 */
  list: DownloadSource[];
  /** 在用的那个。 */
  active: DownloadSource;
}

/** 按两个设置（在用的基址、镜像列表）算出这一种来源的选项与在用的那个。 */
export function sourceState(kind: SourceKind, endpoint: string | null | undefined, mirrors: readonly DownloadMirror[] | null | undefined): SourceState {
  const list = [...builtins(kind), ...(mirrors ?? []).map((m) => mirrorSource(m))];
  const saved = endpoint?.trim();
  if (!saved) return { list, active: list[0]! };
  const builtin = builtinOf(kind, saved);
  if (builtin) return { list, active: list.find((s) => s.id === builtin.id)! };
  const hit = list.find((s) => !s.builtin && sameBase(s.base, saved));
  if (hit) return { list, active: hit };
  const legacy = mirrorSource({ name: '', base: saved }, true);
  return { list: [...list, legacy], active: legacy };
}

/** 选项的一句说明（列表行名下面）。 */
export function sourceDesc(kind: SourceKind, source: DownloadSource): string {
  if (source.id === 'hf') return M.hfDesc;
  if (source.id === 'ms') return M.msDesc;
  if (source.id === 'gh') return M.ghDesc;
  return kind === 'models' ? M.modelsMirrorDesc(source.base) : M.toolsMirrorDesc(source.base);
}

/** 这一种来源下面整行的补充说明：选了 ModelScope 时它的回退与核对；环境变量优先。 */
export function sourceNotes(kind: SourceKind, active: DownloadSource): string[] {
  const notes: string[] = [];
  if (active.id === 'ms') notes.push(M.msNote);
  notes.push(M.envNote(envName(kind)));
  return notes;
}

// ---- 添加、编辑、删除镜像：都算成一批 `settings.set` ----

export type SourcePatch = Partial<Pick<SettingValues, 'models.downloadEndpoint' | 'models.downloadMirrors' | 'tools.downloadEndpoint' | 'tools.downloadMirrors'>>;

export interface MirrorDraft {
  name: string;
  base: string;
}

/** 添加或编辑镜像时哪里不对；能存时 null。`editing` 是正在编辑的那一个（和自己重复不算）。 */
export function mirrorProblem(state: SourceState, draft: MirrorDraft, editing?: DownloadSource | null): string | null {
  const base = trimBase(draft.base);
  if (!base) return M.needBase;
  const bad = endpointProblem(base);
  if (bad) return bad;
  const dup =
    state.list.find((s) => s.id !== editing?.id && sameBase(s.base, base)) ?? (builtinOf(kindOfState(state), base) as DownloadSource | null);
  if (dup) return M.duplicate(dup.name);
  if (draft.name.trim().length > DOWNLOAD_MIRROR_NAME_MAX) return M.nameTooLong(DOWNLOAD_MIRROR_NAME_MAX);
  if (!editing && state.list.filter((s) => !s.builtin && !s.legacy).length >= DOWNLOAD_MIRRORS_MAX) return M.tooMany(DOWNLOAD_MIRRORS_MAX);
  return null;
}

function kindOfState(state: SourceState): SourceKind {
  return state.list[0]!.id === 'gh' ? 'tools' : 'models';
}

/** 选用一个来源。 */
export function choosePatch(kind: SourceKind, source: DownloadSource): SourcePatch {
  return { [endpointKey(kind)]: source.endpoint };
}

/** 存着的镜像（不含以前存下、还没写进列表的那个）。 */
function stored(state: SourceState): DownloadMirror[] {
  return state.list.filter((s) => !s.builtin && !s.legacy).map((s) => ({ name: s.mirrorName ?? '', base: s.base }));
}

/** 添加一个镜像并直接改用它（加镜像多半就是为了用）。以前存下的基址这时也写进列表，免得改用新镜像后它就看不见了。 */
export function addMirrorPatch(kind: SourceKind, state: SourceState, draft: MirrorDraft): SourcePatch {
  const mirror = { name: draft.name.trim(), base: trimBase(draft.base) };
  const legacy = state.list.filter((s) => s.legacy).map((s) => ({ name: '', base: s.base }));
  return { [mirrorsKey(kind)]: [...stored(state), ...legacy, mirror], [endpointKey(kind)]: mirror.base };
}

/** 编辑一个镜像（包括以前存下的那个：编辑后写进列表）。编辑的是在用的那个时，在用的基址跟着改。 */
export function updateMirrorPatch(kind: SourceKind, state: SourceState, target: DownloadSource, draft: MirrorDraft): SourcePatch {
  const mirror = { name: draft.name.trim(), base: trimBase(draft.base) };
  const mirrors = target.legacy ? [...stored(state), mirror] : stored(state).map((m) => (sameBase(m.base, target.base) ? mirror : m));
  const patch: SourcePatch = { [mirrorsKey(kind)]: mirrors };
  if (state.active.id === target.id) patch[endpointKey(kind)] = mirror.base;
  return patch;
}

/** 删掉一个镜像；删的是在用的那个时同一批退回默认来源，`fellBack` 是默认来源的名字（界面多说一句）。 */
export function removeMirrorPatch(kind: SourceKind, state: SourceState, target: DownloadSource): { patch: SourcePatch; fellBack: string | null } {
  const patch: SourcePatch = { [mirrorsKey(kind)]: stored(state).filter((m) => !sameBase(m.base, target.base)) };
  if (state.active.id !== target.id) return { patch, fellBack: null };
  patch[endpointKey(kind)] = null;
  return { patch, fellBack: state.list[0]!.name };
}

// ---- 下载确认框：按来源种类分组 ----

/** 计划里的一个组件属于哪种来源：GitHub 发布页的走工具与运行库，其余走模型仓库。 */
export function kindOfComponent(c: Pick<ModelInstallPlan['components'][number], 'origin'>): SourceKind {
  return c.origin === 'github-release' ? 'tools' : 'models';
}

/** 计划里出现了哪几种来源（按 `SOURCE_KINDS` 的顺序）。 */
export function planKinds(plan: Pick<ModelInstallPlan, 'components'>): SourceKind[] {
  const seen = new Set(plan.components.map(kindOfComponent));
  return SOURCE_KINDS.filter((k) => seen.has(k));
}
