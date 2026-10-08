import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  RpcError,
  TEMPLATE_FILE_MAX_BYTES,
  TEMPLATE_LIMITS,
  TEMPLATE_MANIFEST_FILE,
  TEMPLATE_PROMPT_FILE,
  type TemplateDetail,
  type TemplateDiagnostic,
  type TemplateListResult,
  type TemplateManifest,
  type TemplateOrigin,
  type TemplateSummary,
  templatePromptSlotProblems,
} from '@baocut/protocol';
import { parseTemplateManifest } from '@baocut/protocol/schemas';
import { RcTemplates } from '@baocut/protocol/messages/runtime-core';

/**
 * 创作模板目录（模板包规范 §6）：内置目录（随应用分发）与 Runtime Home 下的 `templates/`（用户自己放的）。
 *
 * - 逐个目录校验，坏模板跳过并记一条诊断，不影响其余模板。
 * - 不缓存：每次 `list`、`get`、`locate` 都重新读目录。几十个小文件的读取可以忽略，用户放进新模板后再列一次就能看到，
 *   `get` 与发句柄也不会用到过期的清单。
 * - 内置与用户目录同 id 时内置的优先，用户的那一份记 `builtin-conflict`（规范 §6）。
 */

/** 清单文件的上限：清单的各项都有长度上限，正常的清单远小于它；超过的不读进内存。 */
const MANIFEST_MAX_BYTES = 64 * 1024;
/** 一个模板目录里最多看多少个条目（含子目录）；超过的整个模板判为不合规，不让一个巨大的目录拖慢列表。 */
const MAX_TEMPLATE_ENTRIES = 256;

/** 一个加载成功的模板。`dir` 是模板目录的绝对路径。 */
export interface LoadedTemplate {
  manifest: TemplateManifest;
  origin: TemplateOrigin;
  dir: string;
  prompt: string;
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

  async list(): Promise<TemplateListResult> {
    const { templates, diagnostics } = await this.scan();
    return { templates: templates.map(summaryOf), diagnostics };
  }

  /** 按 id 取一个可用的模板；没有（或没能加载）时 `not-found`。 */
  async require(id: string): Promise<LoadedTemplate> {
    const found = (await this.scan()).templates.find((t) => t.manifest.id === id);
    if (!found) throw new RpcError('not-found', RcTemplates.templateNotFound({ id }), { code: 'TEMPLATE_NOT_FOUND', templateId: id });
    return found;
  }

  async get(id: string): Promise<TemplateDetail> {
    const template = await this.require(id);
    return { template: summaryOf(template), prompt: template.prompt };
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

export function summaryOf(template: LoadedTemplate): TemplateSummary {
  const { manifest, origin } = template;
  return {
    manifest,
    origin,
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
 * 封面与预览不超过体积上限、没有未登记的文件、目录里没有符号链接。不合规时返回诊断。
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
  let prompt = '';
  if (!files.has(TEMPLATE_PROMPT_FILE)) {
    issues.push(RcTemplates.missingFile({ file: TEMPLATE_PROMPT_FILE }).text);
  } else {
    const bytes = await readCapped(path.join(dir, TEMPLATE_PROMPT_FILE), TEMPLATE_LIMITS.promptBytes);
    const text = bytes === null ? null : decodeUtf8(bytes);
    if (bytes === null) issues.push(RcTemplates.fileOverBytes({ file: TEMPLATE_PROMPT_FILE, limit: TEMPLATE_LIMITS.promptBytes }).text);
    else if (text === null) issues.push(RcTemplates.fileNotUtf8({ file: TEMPLATE_PROMPT_FILE }).text);
    else if (!text.trim()) issues.push(RcTemplates.fileEmpty({ file: TEMPLATE_PROMPT_FILE }).text);
    else {
      prompt = text;
      // 占位符（规范 §2.2、§5.5）：example 的正文与 fields 对得上，scene 的正文不得有 `{{`。
      issues.push(...templatePromptSlotProblems(manifest, text));
    }
  }

  const registered = new Set([TEMPLATE_MANIFEST_FILE, TEMPLATE_PROMPT_FILE, ...registeredFiles(manifest)]);
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
  return { manifest, origin, dir, prompt };
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
