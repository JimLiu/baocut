import { getLocale, parseHfFileAddress, type AudioCppAddableFamily, type AudioCppAddablePackage, type ModelAddParams, type ModelBundleStatus, type ModelLicense } from '@baocut/protocol';
import { M } from './models-added-copy.ts';
import { M as TTS } from './models-tts-local-copy.ts';

/**
 * 设置 › 模型 › 本地模型的「添加模型」（设计稿 settings-add-model.jsx、model-audiocpp.js；架构设计 §6.3）的纯逻辑：
 * 对话框里的分组、搜索、族的说法、自己指定文件的表单，以及添加进来的模型在行上怎么删、怎么移出列表。
 */

export type AddGroup = 'tts' | 'music' | 'sep' | 'idle';
/** 能添加的组：能力页上有入口、对话框先看的那一组。 */
export type AddableGroup = Exclude<AddGroup, 'idle'>;
export type AddTab = AddGroup | 'custom';

/** 上游标的成熟度 → 标签；`supported`（或没标）不标。 */
export function statusLabel(status: string | null): string | null {
  if (status === 'experimental') return M.status.experimental;
  if (status === 'community') return M.status.community;
  if (status === 'testing' || status === 'wip') return M.status.testing;
  return null;
}

/** 许可要不要单独提醒：不可商用（「仅限非商用」）或商用条件不明（「商用待核实」）；可商用的不提醒。 */
export function licenseFlag(license: Pick<ModelLicense, 'commercialUse'> | null | undefined): 'nc' | 'check' | null {
  if (!license) return null;
  return license.commercialUse === false ? 'nc' : license.commercialUse === true ? null : 'check';
}

/** 语言标签的显示名：先用内置模型行的简称，没有简称的语言（上游列的多）写界面语言里的全名；`Intl` 也不认得时写标签本身。 */
function languageShort(code: string): string {
  const short = TTS.languageShort(code);
  if (short !== code) return short;
  try {
    return new Intl.DisplayNames([getLocale()], { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** 上游写的不是语言 ID 的几个说法词。 */
const LANGUAGE_WORDS = new Set(['auto', 'multilingual', 'language_agnostic', 'model_dependent', 'music', 'nospeech']);

/** 语言一句（设计稿 `langLine`）：个数、自动、或几种语言的简称；多于五种只写前四种和总数。 */
export function languagesLine(languages: readonly string[]): string {
  const real = languages.filter((l) => l !== 'auto' && l !== 'music' && l !== 'nospeech');
  if (!real.length) return languages.includes('auto') ? M.languages.auto : '';
  if (real.length === 1) {
    const only = real[0]!;
    const count = /^(\d+)\s*(\+)?\s*languages?$/i.exec(only);
    if (count) return count[2] ? M.languages.atLeast(Number(count[1])) : M.languages.count(Number(count[1]));
    if (only === 'multilingual') return M.languages.multilingual;
    if (only === 'language_agnostic') return M.languages.any;
    if (only === 'model_dependent') return M.languages.modelDependent;
  }
  const names = [...new Set(real.filter((l) => !LANGUAGE_WORDS.has(l)).map(languageShort))];
  return names.length > 5 ? M.languages.more(names.slice(0, 4), names.length) : names.join(' / ');
}

/**
 * 特点一句（设计稿 `traitsLine`）：能怎么出声，再加语言。分离不分语言：能添加的分离族写分成什么、跟内置的比（`M.sepTraits`），
 * 不写速度（各平台差得多）。
 */
export function traitsLine(family: Pick<AudioCppAddableFamily, 'traits' | 'languages'> & Partial<Pick<AudioCppAddableFamily, 'group' | 'family'>>): string {
  if (family.group === 'sep') return M.sepTraits[family.family ?? ''] ?? '';
  const t = family.traits;
  const out: string[] = [];
  if (t.clone) out.push(M.traits.clone);
  if (t.design) out.push(M.traits.design);
  if (t.voices) out.push(M.traits.voices(t.voices));
  if (t.style) out.push(M.traits.style);
  if (t.emotion) out.push(M.traits.emotion);
  if (t.lyrics) out.push(M.traits.lyrics);
  if (t.instrumental) out.push(M.traits.instrumental);
  const lang = languagesLine(family.languages);
  if (lang) out.push(lang);
  return out.join(' · ');
}

/** 上游任务名；认不出的照原样。 */
export function tasksLine(tasks: readonly string[]): string {
  return tasks.map((t) => M.tasks[t] ?? t).join(', ');
}

/** 「暂时用不上」那一句。 */
export function idleText(family: Pick<AudioCppAddableFamily, 'idle' | 'tasks'>): string {
  switch (family.idle) {
    case 'recognize':
      return M.idle.recognize;
    case 'separate-slow':
    case 'separate-stems':
    case 'separate-speakers':
      return M.idle[family.idle];
    case 'music-request':
      return M.idle['music-request'];
    case 'engine-route':
      return M.idle['engine-route'];
    default:
      return M.idle.other(tasksLine(family.tasks));
  }
}

/** 一族能不能加：`open` 还有没内置也没加过的包；`done` 都内置或加过了；`nopkg` 上游没有能下载的包；`idle` 暂时用不上。 */
export function familyState(family: Pick<AudioCppAddableFamily, 'group' | 'packages'>): 'open' | 'done' | 'nopkg' | 'idle' {
  if (family.group === 'idle') return 'idle';
  if (!family.packages.length) return 'nopkg';
  return family.packages.every((p) => p.state !== null) ? 'done' : 'open';
}

const STATUS_RANK: Record<string, number> = { supported: 0, stable: 0, experimental: 1, testing: 2, wip: 2, community: 3 };
const STATE_RANK = { open: 0, idle: 0, nopkg: 1, done: 2 } as const;

/** 搜索用的文字：族 ID、名字、语言、特点、包名与精度。 */
function haystack(family: AudioCppAddableFamily): string {
  return [family.family, family.name, languagesLine(family.languages), traitsLine(family), ...family.packages.map((p) => `${p.name} ${p.precision ?? ''}`)].join(' ').toLowerCase();
}

/**
 * 按组与搜索词筛（设计稿 `search`）：能添加的在前（内置与加过的排后面），再按上游成熟度（supported 在前、社区排后），同档按名字。
 */
export function searchFamilies(families: readonly AudioCppAddableFamily[], query: string, group: AddGroup): AudioCppAddableFamily[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const rank = (f: AudioCppAddableFamily) => STATUS_RANK[f.status ?? ''] ?? 4;
  return families
    .filter((f) => f.group === group)
    .filter((f) => {
      const hay = haystack(f);
      return words.every((w) => hay.includes(w));
    })
    .sort((a, b) => STATE_RANK[familyState(a)] - STATE_RANK[familyState(b)] || rank(a) - rank(b) || a.name.localeCompare(b.name));
}

export function groupCount(families: readonly AudioCppAddableFamily[], group: AddGroup): number {
  return families.filter((f) => f.group === group).length;
}

/** 能力页入口那一句：这一组里内置之外还能加的族数（内置的族也还有别的精度，那一句另说）。 */
export function moreCount(families: readonly AudioCppAddableFamily[], group: AddableGroup): number {
  return families.filter((f) => f.group === group && f.packages.length && !f.packages.some((p) => p.state === 'builtin')).length;
}

/** 一族先选中的包：第一个还能加的，没有就是上游推荐的那个。 */
export function firstPackage(family: Pick<AudioCppAddableFamily, 'packages'>): AudioCppAddablePackage | null {
  return family.packages.find((p) => p.state === null) ?? family.packages.find((p) => p.default) ?? family.packages[0] ?? null;
}

/** 包的精度标签（`Q8_0`、`BF16`）；上游没写时 null。 */
export function precisionLabel(pkg: Pick<AudioCppAddablePackage, 'precision'>): string | null {
  return pkg.precision ? pkg.precision.toUpperCase() : null;
}

/** 包名去掉末尾的「GGUF」。 */
export function packageName(pkg: Pick<AudioCppAddablePackage, 'name'>): string {
  return pkg.name.replace(/\s+GGUF$/i, '');
}

/** 同一族里精度之外还有不同大小的模型（Qwen3-TTS 0.6B / 1.7B 等）：选项写包名。 */
export function packagesNamed(family: Pick<AudioCppAddableFamily, 'packages'>): boolean {
  const labels = new Set(family.packages.map((p) => precisionLabel(p) ?? p.id));
  return labels.size < family.packages.length;
}

/** 文件名（去掉目录与 `.gguf`）。 */
export function baseName(path: string): string {
  return path.split(/[\\/]/).pop()!.replace(/\.gguf$/i, '');
}

/** 「自己指定文件」的表单。 */
export interface CustomForm {
  source: 'repo-file' | 'local-file';
  address: string;
  path: string;
  family: string | null;
  label: string;
}

export type CustomProblem = 'address' | 'file' | 'family';

/** 表单 → `models.add` 的参数；不完整时给出缺的那几项。 */
export function customParams(form: CustomForm): { ok: true; params: ModelAddParams } | { ok: false; problems: CustomProblem[] } {
  const problems: CustomProblem[] = [];
  if (form.source === 'repo-file' && !parseHfFileAddress(form.address).ok) problems.push('address');
  if (form.source === 'local-file' && !form.path) problems.push('file');
  if (!form.family) problems.push('family');
  if (problems.length) return { ok: false, problems };
  const label = form.label.trim();
  const family = form.family!;
  const params: ModelAddParams =
    form.source === 'repo-file'
      ? { source: 'repo-file', family, address: form.address.trim(), ...(label ? { label } : {}) }
      : { source: 'local-file', family, path: form.path, ...(label ? { label } : {}) };
  return { ok: true, params };
}

/** 地址那一栏下面的说明或错误：认出来时写仓库、修订与文件。 */
export function addressHint(address: string, tried: boolean): { help: string; error: string | null } {
  const parsed = parseHfFileAddress(address);
  if (parsed.ok) return { help: M.urlParsed(parsed.repo, parsed.revision, parsed.path), error: null };
  return { help: M.urlHelp, error: tried ? M.urlErrors[parsed.code] : null };
}

/** 原地引用的本机文件（`local-file` 添加的组件）；不是的给 null。 */
export function inPlaceFile(bundle: Pick<ModelBundleStatus, 'components' | 'added'>): string | null {
  if (bundle.added?.kind !== 'local-file') return null;
  return bundle.components?.find((c) => c.origin === 'local-file')?.file ?? bundle.added.source;
}

/** 行上「添加自」那一句。 */
export function addedSource(bundle: Pick<ModelBundleStatus, 'added'>): string | null {
  const a = bundle.added;
  if (!a) return null;
  if (a.kind === 'catalog') return M.sourceCatalog(a.familyName);
  if (a.kind === 'repo-file') return M.sourceRepoFile(a.source, a.familyName);
  return M.sourceLocalFile(a.familyName);
}

/**
 * 删除按钮做什么（设计稿 settings-local.jsx `remove` / `unlist`）：
 * - `remove`：内置的模型包，照旧删除；
 * - `remove-unlist`：添加的、下载过的，删掉文件后一并移出列表（确认框多写一句）；
 * - `unlist-in-place`：原地引用的本机文件，只移出列表、不删文件（确认框写明文件留在哪）；
 * - `unlist`：添加的、还没下载的，盘上没有它的东西，直接移出列表、不用确认；
 * - null：这一刻不给（正在下载）。
 */
export type RemoveFlow = 'remove' | 'remove-unlist' | 'unlist-in-place' | 'unlist';

export function removeFlow(bundle: Pick<ModelBundleStatus, 'added' | 'install'>, ownFiles: boolean): RemoveFlow | null {
  const installing = !!bundle.install && bundle.install.state !== 'paused';
  if (installing) return null;
  if (!bundle.added) return ownFiles ? 'remove' : null;
  if (bundle.added.kind === 'local-file') return 'unlist-in-place';
  if (ownFiles) return 'remove-unlist';
  // 暂停着的下载：先丢掉已下载的部分（`models.unlist` 会一并丢掉），这里也直接移出列表。
  return 'unlist';
}

/** 添加进来的模型在行上的标签：「已添加」，许可商用不明的再加「商用待核实」（不可商用的「仅限非商用」由 `ttsChips` 标）。 */
/** 许可一句：可商用的只写名字；别的写 Runtime 给的提要（提要以许可名开头时不再重复名字）。 */
export function licenseLine(license: Pick<ModelLicense, 'name' | 'summary' | 'commercialUse'>): string {
  if (license.commercialUse === true) return license.name;
  return license.summary.startsWith(license.name) ? license.summary : `${license.name} · ${license.summary}`;
}

export function addedChips(bundle: Pick<ModelBundleStatus, 'added' | 'license'>): { label: string; tone: 'neutral' | 'notice' }[] {
  const chips: { label: string; tone: 'neutral' | 'notice' }[] = [];
  if (bundle.added) chips.push({ label: M.chipAdded, tone: 'neutral' });
  if (licenseFlag(bundle.license) === 'check') chips.push({ label: M.chipCheckLicense, tone: 'notice' });
  return chips;
}
