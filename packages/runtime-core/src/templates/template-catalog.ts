import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LOCALES,
  RpcError,
  TEMPLATE_FILE_MAX_BYTES,
  TEMPLATE_LIMITS,
  TEMPLATE_LOCALES_DIR,
  TEMPLATE_MANIFEST_FILE,
  TEMPLATE_PROMPT_FILE,
  getLocale,
  localeOfTag,
  localizeTemplateManifest,
  pickTemplateLanguage,
  templatePromptSlotProblems,
  templateTranslationFile,
  templateTranslationFiles,
  type Locale,
  type TemplateDetail,
  type TemplateDiagnostic,
  type TemplateListResult,
  type TemplateManifest,
  type TemplateOrigin,
  type TemplateSummary,
  type TemplateTranslation,
} from '@baocut/protocol';
import { parseTemplateManifest, parseTemplateTranslation } from '@baocut/protocol/schemas';
import { RcTemplates } from '@baocut/protocol/messages/runtime-core';

/**
 * 创作模板目录（模板包规范 §6）：内置目录（随应用分发）与 Runtime Home 下的 `templates/`（用户自己放的）。
 *
 * - 逐个目录校验，坏模板跳过并记一条诊断，不影响其余模板。
 * - 不缓存：每次 `list`、`get`、`locate` 都重新读目录。几十个小文件的读取可以忽略，用户放进新模板后再列一次就能看到，
 *   `get` 与发句柄也不会用到过期的清单。
 * - 内置与用户目录同 id 时内置的优先，用户的那一份记 `builtin-conflict`（规范 §6）。
 * - 语言版本（规范 §3.6）：`locales/` 里的译文加载时全部校验，任何一份不合规整个模板跳过；`list`、`get` 与发送时
 *   按请求的语言（缺省为 Runtime 的界面语言）挑一份套到清单上。
 */

/** 清单文件的上限：清单的各项都有长度上限，正常的清单远小于它；超过的不读进内存。 */
const MANIFEST_MAX_BYTES = 64 * 1024;
/** 一个模板目录里最多看多少个条目（含子目录）；超过的整个模板判为不合规，不让一个巨大的目录拖慢列表。 */
const MAX_TEMPLATE_ENTRIES = 256;

/** 一个加载成功的模板。`dir` 是模板目录的绝对路径；`manifest` 与 `prompt` 是 `template.json` 与 `prompt.md` 原样。 */
export interface LoadedTemplate {
  manifest: TemplateManifest;
  origin: TemplateOrigin;
  dir: string;
  prompt: string;
  /** `locales/` 里的译文，按 `LOCALES` 的顺序。 */
  translations: ReadonlyMap<Locale, TemplateTranslationEntry>;
}

/** 一种语言的译文：`locales/<语言>.json` 的文案与 `locales/<语言>.md` 的提示词。 */
export interface TemplateTranslationEntry {
  translation: TemplateTranslation;
  prompt: string;
}

/** 某种语言下的模板：清单套上译文、提示词换成译文；没有合适的译文时就是 `template.json` 与 `prompt.md`。 */
export interface LocalizedTemplate {
  manifest: TemplateManifest;
  prompt: string;
  /** 有哪些语言版本：`template.json` 的 `language` 在前，译文按 `LOCALES` 的顺序。 */
  languages: string[];
}

/** 按 `language`（缺省为 Runtime 的界面语言）挑语言版本（规范 §3.6）。 */
export function localizeTemplate(template: LoadedTemplate, language?: string | null): LocalizedTemplate {
  const { manifest, translations } = template;
  const available = [...translations.keys()];
  const languages = [manifest.language, ...available];
  const locale = pickTemplateLanguage(manifest.language, available, language ?? getLocale());
  const entry = locale ? translations.get(locale) : undefined;
  if (!locale || !entry) return { manifest, prompt: template.prompt, languages };
  return { manifest: localizeTemplateManifest(manifest, locale, entry.translation), prompt: entry.prompt, languages };
}

export interface TemplateScan {
  templates: LoadedTemplate[];
  diagnostics: TemplateDiagnostic[];
}

export interface TemplateCatalogOptions {
  /** 内置模板目录；null 表示没有（找不到随包的目录）。 */
  builtinDir: string | null;
  /** 用户模板目录 `<BAOCUT_HOME>/templates`。不存在时当作空目录，不替用户创建。 */
  userDir: string;
}

/**
 * 找内置模板目录：`BAOCUT_TEMPLATES_DIR` 环境变量；打包后的应用里是 `<resources>/templates`；开发时从本模块往上找
 * 同时有 `package.json` 与 `templates/` 的目录（仓库根）。都没有时 null。
 */
export function resolveBuiltinTemplatesDir(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.BAOCUT_TEMPLATES_DIR) return env.BAOCUT_TEMPLATES_DIR;
  const resources = (process as { resourcesPath?: string }).resourcesPath;
  if (resources) {
    const bundled = path.join(resources, 'templates');
    if (isDirectory(bundled)) return bundled;
  }
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const candidate = path.join(dir, 'templates');
    if (fs.existsSync(path.join(dir, 'package.json')) && isDirectory(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function isDirectory(dir: string): boolean {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

export class TemplateCatalog {
  readonly #options: TemplateCatalogOptions;

  constructor(options: TemplateCatalogOptions) {
    this.#options = options;
  }

  get builtinDir(): string | null {
    return this.#options.builtinDir;
  }

  get userDir(): string {
    return this.#options.userDir;
  }

  /** 两个来源合在一起：内置的在前；用户目录里与内置同 id 的跳过。 */
  async scan(): Promise<TemplateScan> {
    const builtin = this.#options.builtinDir ? await scanTemplateDir(this.#options.builtinDir, 'builtin') : EMPTY_SCAN;
    const user = await scanTemplateDir(this.#options.userDir, 'user');
    const taken = new Set(builtin.templates.map((t) => t.manifest.id));
    const templates = [...builtin.templates];
    const diagnostics = [...builtin.diagnostics, ...user.diagnostics];
    for (const template of user.templates) {
      if (taken.has(template.manifest.id)) {
        diagnostics.push({
          code: 'builtin-conflict',
          origin: 'user',
          dir: path.basename(template.dir),
          path: template.dir,
          message: RcTemplates.builtinConflict({ id: template.manifest.id }).text,
          issues: [],
        });
      } else {
        templates.push(template);
      }
    }
    return { templates, diagnostics };
  }

  /** 目录；每个模板换成 `language`（缺省为 Runtime 的界面语言）挑中的语言版本。 */
  async list(language?: string | null): Promise<TemplateListResult> {
    const { templates, diagnostics } = await this.scan();
    return { templates: templates.map((t) => summaryOf(t, language)), diagnostics };
  }

  /** 按 id 取一个可用的模板；没有（或没能加载）时 `not-found`。 */
  async require(id: string): Promise<LoadedTemplate> {
    const found = (await this.scan()).templates.find((t) => t.manifest.id === id);
    if (!found) throw new RpcError('not-found', RcTemplates.templateNotFound({ id }), { code: 'TEMPLATE_NOT_FOUND', templateId: id });
    return found;
  }

  async get(id: string, language?: string | null): Promise<TemplateDetail> {
    const template = await this.require(id);
    return { template: summaryOf(template, language), prompt: localizeTemplate(template, language).prompt };
  }

  /**
   * 模板随附文件的位置：只认清单登记的 `cover.file`、`preview.file` 与 `assets[].path`。媒体通道发句柄时再做一次真实路径检查。
   */
  async locate(id: string, file: string): Promise<{ root: string; file: string }> {
    const template = await this.require(id);
    if (!registeredFiles(template.manifest).includes(file)) {
      throw new RpcError('not-found', RcTemplates.fileNotRegistered({ id, file }), {
        code: 'TEMPLATE_FILE_NOT_FOUND',
        templateId: id,
        path: file,
      });
    }
    return { root: template.dir, file };
  }
}

const EMPTY_SCAN: TemplateScan = { templates: [], diagnostics: [] };

export function summaryOf(template: LoadedTemplate, language?: string | null): TemplateSummary {
  const { manifest, origin } = template;
  const localized = localizeTemplate(template, language);
  return {
    manifest: localized.manifest,
    origin,
    languages: localized.languages,
    files: { cover: manifest.cover.file != null, preview: manifest.preview.file != null, assets: manifest.assets?.length ?? 0 },
  };
}

/** 清单登记的随附文件（不含清单与 `prompt.md`）。 */
function registeredFiles(manifest: TemplateManifest): string[] {
  return [manifest.cover.file, manifest.preview.file, ...(manifest.assets ?? []).map((a) => a.path)].filter((f): f is string => f != null);
}

/**
 * 读一个目录来源（规范 §6）：每个子目录是一个模板。不是目录的条目与隐藏条目忽略；符号链接不跟随（记诊断，说明为什么没出现）；
 * 同一来源里 id 重复的两个都跳过。目录不存在时为空。
 */
export async function scanTemplateDir(dir: string, origin: TemplateOrigin): Promise<TemplateScan> {
  // 相对路径（例如环境变量里写的）先解析成绝对路径：诊断给的是绝对路径，目录内的检查也按它比较。
  const root = path.resolve(dir);
  const entries = await fsp.readdir(root, { withFileTypes: true }).catch(() => []);
  const diagnostics: TemplateDiagnostic[] = [];
  const loaded: LoadedTemplate[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith('.')) continue;
    const dir = path.join(root, entry.name);
    if (entry.isSymbolicLink()) {
      diagnostics.push(diagnostic('invalid', origin, dir, RcTemplates.dirIsSymlink().text, []));
      continue;
    }
    if (!entry.isDirectory()) continue;
    const result = await loadTemplate(dir, origin);
    if ('code' in result) diagnostics.push(result);
    else loaded.push(result);
  }
  const counts = new Map<string, number>();
  for (const t of loaded) counts.set(t.manifest.id, (counts.get(t.manifest.id) ?? 0) + 1);
  const templates: LoadedTemplate[] = [];
  for (const t of loaded) {
    if ((counts.get(t.manifest.id) ?? 0) > 1) {
      diagnostics.push(diagnostic('duplicate-id', origin, t.dir, RcTemplates.duplicateId({ id: t.manifest.id }).text, []));
    } else {
      templates.push(t);
    }
  }
  return { templates, diagnostics };
}

function diagnostic(
  code: TemplateDiagnostic['code'],
  origin: TemplateOrigin,
  dir: string,
  message: string,
  issues: string[],
): TemplateDiagnostic {
  return { code, origin, dir: path.basename(dir), path: dir, message, issues };
}

/**
 * 读并校验一个模板目录（规范 §2–§4）：清单合规、id 等于目录名、`prompt.md` 是非空的 UTF-8 且不超限、占位符与待填项对得上、登记的文件都在、
 * 封面与预览不超过体积上限、`locales/` 里的译文成对且合规（§3.6）、没有未登记的文件、目录里没有符号链接。不合规时返回诊断。
 */
export async function loadTemplate(dir: string, origin: TemplateOrigin): Promise<LoadedTemplate | TemplateDiagnostic> {
  const invalid = (issues: string[]) => diagnostic('invalid', origin, dir, RcTemplates.templateInvalid().text, issues);

  const listing = await listTemplateFiles(dir);
  if ('problem' in listing) return invalid([listing.problem]);
  const { files } = listing;

  if (!files.has(TEMPLATE_MANIFEST_FILE)) return invalid([RcTemplates.missingFile({ file: TEMPLATE_MANIFEST_FILE }).text]);
  const manifestBytes = await readCapped(path.join(dir, TEMPLATE_MANIFEST_FILE), MANIFEST_MAX_BYTES);
  if (manifestBytes === null) return invalid([RcTemplates.fileOverBytes({ file: TEMPLATE_MANIFEST_FILE, limit: MANIFEST_MAX_BYTES }).text]);
  const manifestText = decodeUtf8(manifestBytes);
  if (manifestText === null) return invalid([RcTemplates.fileNotUtf8({ file: TEMPLATE_MANIFEST_FILE }).text]);
  let raw: unknown;
  try {
    raw = JSON.parse(manifestText);
  } catch {
    return invalid([RcTemplates.fileNotJson({ file: TEMPLATE_MANIFEST_FILE }).text]);
  }
  const parsed = parseTemplateManifest(raw, path.basename(dir));
  if (!parsed.ok) {
    return parsed.reason === 'unsupported-schema'
      ? diagnostic('unsupported-schema', origin, dir, RcTemplates.unsupportedSchema().text, parsed.issues)
      : invalid(parsed.issues);
  }
  const { manifest } = parsed;

  const issues: string[] = [];
  // 占位符（规范 §2.2、§5.5）：example 的正文与 fields 对得上，scene 的正文不得有 `{{`。
  const prompt = (await readPrompt(dir, files, TEMPLATE_PROMPT_FILE, issues)) ?? '';
  if (prompt) issues.push(...templatePromptSlotProblems(manifest, prompt));

  const registered = new Set([TEMPLATE_MANIFEST_FILE, TEMPLATE_PROMPT_FILE, ...registeredFiles(manifest)]);
  const translations = await loadTranslations(dir, files, manifest, issues);
  for (const locale of translations.locales) for (const file of Object.values(templateTranslationFiles(locale))) registered.add(file);
  for (const file of registeredFiles(manifest)) {
    if (!files.has(file)) issues.push(RcTemplates.registeredFileMissing({ file }).text);
    else if (!inside(dir, file)) issues.push(RcTemplates.pathOutsideTemplate({ file }).text);
  }
  for (const file of files) if (!registered.has(file)) issues.push(RcTemplates.unregisteredFile({ file }).text);
  for (const [key, file] of [
    ['cover', manifest.cover.file],
    ['preview', manifest.preview.file],
  ] as const) {
    if (file == null || !files.has(file)) continue;
    const { size } = await fsp.stat(path.join(dir, file));
    if (size > TEMPLATE_FILE_MAX_BYTES[key]) issues.push(RcTemplates.fileOverBytesActual({ file, limit: TEMPLATE_FILE_MAX_BYTES[key], size }).text);
  }

  if (issues.length) return invalid(issues);
  return { manifest, origin, dir, prompt, translations: translations.entries };
}

/**
 * `locales/` 里的译文（规范 §3.6）：每种出货语言一对 `<语言小写>.json` 与 `.md`，不得与 `template.json` 同一种语言；
 * 文案对照清单校验，提示词照 `prompt.md` 的规则、占位符对照译文的 `fields`。问题写进 `issues`；`locales` 是认出来的语言
 * （它们的文件算登记过），`entries` 是合规的译文。认不出的文件留给未登记文件的检查。
 */
async function loadTranslations(
  dir: string,
  files: ReadonlySet<string>,
  manifest: TemplateManifest,
  issues: string[],
): Promise<{ locales: Locale[]; entries: Map<Locale, TemplateTranslationEntry> }> {
  const present = new Set<Locale>();
  for (const file of files) {
    if (!file.startsWith(`${TEMPLATE_LOCALES_DIR}/`)) continue;
    const hit = templateTranslationFile(file);
    if (hit) present.add(hit.locale);
  }
  const base = localeOfTag(manifest.language);
  const locales = LOCALES.filter((locale) => present.has(locale));
  const entries = new Map<Locale, TemplateTranslationEntry>();
  for (const locale of locales) {
    const { text: textFile, prompt: promptFile } = templateTranslationFiles(locale);
    if (locale === base) {
      issues.push(RcTemplates.translationForBaseLanguage({ file: textFile, language: manifest.language }).text);
      continue;
    }
    const before = issues.length;
    let translation: TemplateTranslation | null = null;
    const raw = await readJson(dir, files, textFile, issues);
    if (raw !== undefined) {
      const parsed = parseTemplateTranslation(raw, manifest);
      if (parsed.ok) translation = parsed.translation;
      else issues.push(...parsed.issues.map((issue) => `${textFile}: ${issue}`));
    }
    const prompt = await readPrompt(dir, files, promptFile, issues);
    if (prompt && translation)
      issues.push(...templatePromptSlotProblems({ kind: manifest.kind, fields: translation.fields }, prompt).map((issue) => `${promptFile}: ${issue}`));
    if (translation && prompt && issues.length === before) entries.set(locale, { translation, prompt });
  }
  return { locales, entries };
}

/** 读一份提示词（`prompt.md` 或译文的 `.md`）：要在、非空、合法 UTF-8、不超过上限；不合规时记问题、返回 null。 */
async function readPrompt(dir: string, files: ReadonlySet<string>, file: string, issues: string[]): Promise<string | null> {
  if (!files.has(file)) {
    issues.push(RcTemplates.missingFile({ file }).text);
    return null;
  }
  const bytes = await readCapped(path.join(dir, file), TEMPLATE_LIMITS.promptBytes);
  const text = bytes === null ? null : decodeUtf8(bytes);
  if (bytes === null) issues.push(RcTemplates.fileOverBytes({ file, limit: TEMPLATE_LIMITS.promptBytes }).text);
  else if (text === null) issues.push(RcTemplates.fileNotUtf8({ file }).text);
  else if (!text.trim()) issues.push(RcTemplates.fileEmpty({ file }).text);
  else return text;
  return null;
}

/** 读一份 JSON（译文文案）：要在、不超过清单的上限、合法 UTF-8 与 JSON；不合规时记问题、返回 undefined。 */
async function readJson(dir: string, files: ReadonlySet<string>, file: string, issues: string[]): Promise<unknown> {
  if (!files.has(file)) {
    issues.push(RcTemplates.missingFile({ file }).text);
    return undefined;
  }
  const bytes = await readCapped(path.join(dir, file), MANIFEST_MAX_BYTES);
  if (bytes === null) {
    issues.push(RcTemplates.fileOverBytes({ file, limit: MANIFEST_MAX_BYTES }).text);
    return undefined;
  }
  const text = decodeUtf8(bytes);
  if (text === null) {
    issues.push(RcTemplates.fileNotUtf8({ file }).text);
    return undefined;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    issues.push(RcTemplates.fileNotJson({ file }).text);
    return undefined;
  }
}

/**
 * 模板目录里的全部普通文件（相对路径，`/` 分隔）。点开头的条目忽略；遇到符号链接或别的特殊文件、条目过多时整个模板不合规：
 * 不跟随链接，也就不会读到目录外的东西。
 */
async function listTemplateFiles(dir: string): Promise<{ files: Set<string> } | { problem: string }> {
  const files = new Set<string>();
  let seen = 0;
  const walk = async (abs: string, rel: string): Promise<string | null> => {
    const entries = await fsp.readdir(abs, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      if (++seen > MAX_TEMPLATE_ENTRIES) return RcTemplates.tooManyEntries({ limit: MAX_TEMPLATE_ENTRIES }).text;
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) return RcTemplates.noSymlinks({ path: relPath }).text;
      if (entry.isDirectory()) {
        const problem = await walk(path.join(abs, entry.name), relPath);
        if (problem) return problem;
      } else if (entry.isFile()) {
        files.add(relPath);
      } else {
        return RcTemplates.notRegularFile({ path: relPath }).text;
      }
    }
    return null;
  };
  try {
    const problem = await walk(dir, '');
    return problem ? { problem } : { files };
  } catch (error) {
    return { problem: RcTemplates.cannotReadDir({ code: (error as NodeJS.ErrnoException).code ?? 'error' }).text };
  }
}

/** 相对路径解析后仍在目录内（清单校验已经挡掉 `..` 与绝对路径，这里再兜一次）。 */
function inside(dir: string, file: string): boolean {
  const resolved = path.resolve(dir, file);
  return resolved.startsWith(dir.endsWith(path.sep) ? dir : dir + path.sep);
}

/** 读文件，超过 `max` 字节时返回 null（只读到 `max + 1` 字节为止）。 */
async function readCapped(file: string, max: number): Promise<Buffer | null> {
  const handle = await fsp.open(file, 'r');
  try {
    const buffer = Buffer.alloc(max + 1);
    let length = 0;
    for (;;) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
      if (bytesRead === 0) break;
      length += bytesRead;
      if (length > max) return null;
    }
    return buffer.subarray(0, length);
  } finally {
    await handle.close();
  }
}

function decodeUtf8(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}
