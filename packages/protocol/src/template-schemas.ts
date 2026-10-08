import { z } from 'zod';
import { ProtocolValidation as V } from './messages/protocol/protocol-validation.ts';
import {
  TEMPLATE_ASSET_EXTENSIONS,
  TEMPLATE_ASSETS_DIR,
  TEMPLATE_ASSET_TYPES,
  TEMPLATE_CATEGORIES,
  TEMPLATE_COVER_EXTENSIONS,
  TEMPLATE_DURATION_MAX,
  TEMPLATE_DURATION_MIN,
  TEMPLATE_DURATION_STEP,
  TEMPLATE_FIGURES,
  TEMPLATE_ID_PATTERN,
  TEMPLATE_KINDS,
  TEMPLATE_LIMITS,
  TEMPLATE_PREVIEW_EXTENSIONS,
  TEMPLATE_RATIOS,
  TEMPLATE_SCHEMA_VERSION,
  TEMPLATE_SKILL_ID_PATTERN,
  TEMPLATE_SOURCES,
  TEMPLATE_TONES,
  TEMPLATE_VERIFICATION_CAPABILITIES,
  TEMPLATE_VERIFICATION_LIMITS,
  TEMPLATE_VERIFICATION_OUTCOMES,
  templateFileExtension,
  templatePathProblem,
  templateSlotProblems,
  type TemplateManifest,
  type TemplateTranslation,
} from './template.ts';

/** 模板清单 `template.json` 的校验（模板包规范 §2–§4）。未知字段一律拒绝。 */

const text = (max: number) =>
  z
    .string()
    .max(max)
    .refine((s) => s.trim().length > 0, { error: () => V.notEmpty().text })
    .refine((s) => s === s.trim(), { error: () => V.noSurroundingSpace().text });

const relativePath = z.string().superRefine((path, ctx) => {
  const problem = templatePathProblem(path);
  if (problem) ctx.addIssue({ code: 'custom', message: problem });
});

/** 根目录下的 `<stem>.<ext>`，扩展名在允许的集合里。 */
const rootFile = (stem: string, extensions: readonly string[]) =>
  relativePath.refine(
    (path) => !path.includes('/') && path.slice(0, path.lastIndexOf('.')) === stem && extensions.includes(templateFileExtension(path)),
    { error: () => V.templateRootFile({ stem, extensions: extensions.join(',') }).text },
  );

const asset = z
  .object({
    path: relativePath.refine((path) => path.startsWith(`${TEMPLATE_ASSETS_DIR}/`), { error: () => V.templateAssetsDir({ dir: TEMPLATE_ASSETS_DIR }).text }),
    type: z.enum(TEMPLATE_ASSET_TYPES),
    note: text(TEMPLATE_LIMITS.note),
  })
  .strict()
  .superRefine((a, ctx) => {
    if (!TEMPLATE_ASSET_EXTENSIONS[a.type].includes(templateFileExtension(a.path)))
      ctx.addIssue({
        code: 'custom',
        path: ['path'],
        message: V.templateAssetExtension({
          type: a.type,
          extensions: TEMPLATE_ASSET_EXTENSIONS[a.type].join(V.listSeparator().text),
        }).text,
      });
  });

/** 待填项（规范 §3.1）：label 不含花括号与换行，才能写成 `{{label}}`。 */
const field = z
  .object({
    label: text(TEMPLATE_LIMITS.fieldLabel).refine((s) => !/[{}\r\n]/.test(s), { error: () => V.templateFieldLabelChars().text }),
    hint: text(TEMPLATE_LIMITS.fieldHint).optional(),
    example: text(TEMPLATE_LIMITS.fieldExample).optional(),
  })
  .strict();

/** BCP 47 语言标签（清单的 `language`，`templates.*` 与发送时的 `language`）。 */
const languageTag = z
  .string()
  .max(35)
  .regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/, { error: () => V.languageTagExample().text });

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, { error: () => V.dateFormat().text })
  .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s), { error: () => V.dateInvalid().text });

const material = z
  .object({
    title: text(TEMPLATE_VERIFICATION_LIMITS.materialTitle),
    url: z
      .string()
      .max(TEMPLATE_VERIFICATION_LIMITS.materialUrl)
      .regex(/^https:\/\/[^\s]+$/, { error: () => V.materialUrlHttps().text }),
    license: text(TEMPLATE_VERIFICATION_LIMITS.materialLicense),
    note: text(TEMPLATE_VERIFICATION_LIMITS.materialNote).optional(),
  })
  .strict();

/** 验证记录（规范 §3.5）。 */
const verification = z
  .object({
    date: isoDate,
    version: z.string().regex(/^\d+\.\d+\.\d+$/, { error: () => V.semver().text }),
    engine: z
      .string()
      .max(TEMPLATE_VERIFICATION_LIMITS.engine)
      .regex(/^[a-z][a-z0-9-]*$/, { error: () => V.engineLowerId().text }),
    input: text(TEMPLATE_VERIFICATION_LIMITS.input),
    materials: z.array(material).max(TEMPLATE_VERIFICATION_LIMITS.materials),
    capabilities: z.array(z.enum(TEMPLATE_VERIFICATION_CAPABILITIES)),
    outcome: z.enum(TEMPLATE_VERIFICATION_OUTCOMES),
    output: z
      .object({
        ratio: z.string().regex(/^[1-9]\d*:[1-9]\d*$/, { error: () => V.ratioFormat().text }),
        durationSeconds: z
          .number()
          .positive()
          .max(TEMPLATE_DURATION_MAX * 2),
      })
      .strict()
      .optional(),
    notes: text(TEMPLATE_VERIFICATION_LIMITS.notes),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (new Set(v.capabilities).size !== v.capabilities.length)
      ctx.addIssue({ code: 'custom', path: ['capabilities'], message: V.capabilitiesDuplicate().text });
    if (v.outcome !== 'fail' && v.output == null)
      ctx.addIssue({ code: 'custom', path: ['output'], message: V.outputMeasured().text });
  });

export const templateManifestSchema = z
  .object({
    schema: z.literal(TEMPLATE_SCHEMA_VERSION),
    id: z.string().max(TEMPLATE_LIMITS.id).regex(TEMPLATE_ID_PATTERN, { error: () => V.templateIdKebab().text }),
    version: z.string().regex(/^\d+\.\d+\.\d+$/, { error: () => V.semver().text }),
    kind: z.enum(TEMPLATE_KINDS),
    title: text(TEMPLATE_LIMITS.title),
    summary: text(TEMPLATE_LIMITS.summary),
    description: text(TEMPLATE_LIMITS.description),
    language: languageTag,
    category: z.enum(TEMPLATE_CATEGORIES),
    ratio: z.enum(TEMPLATE_RATIOS).optional(),
    durationSeconds: z.number().int().min(TEMPLATE_DURATION_MIN).max(TEMPLATE_DURATION_MAX).multipleOf(TEMPLATE_DURATION_STEP).optional(),
    brief: text(TEMPLATE_LIMITS.brief).optional(),
    fields: z.array(field).max(TEMPLATE_LIMITS.fields).optional(),
    skills: z
      .array(
        z
          .string()
          .max(TEMPLATE_LIMITS.skill)
          .regex(TEMPLATE_SKILL_ID_PATTERN, { error: () => V.skillIdChars().text }),
      )
      .max(TEMPLATE_LIMITS.skills)
      .optional(),
    author: text(80),
    source: z.enum(TEMPLATE_SOURCES),
    license: z.string().regex(/^[A-Za-z0-9.+-]+(?: (?:AND|OR|WITH) [A-Za-z0-9.+-]+)*$/, { error: () => V.licenseSpdx().text }),
    tags: z.array(text(TEMPLATE_LIMITS.tag)).max(TEMPLATE_LIMITS.tags),
    cover: z
      .object({
        file: rootFile('cover', TEMPLATE_COVER_EXTENSIONS).optional(),
        tone: z.enum(TEMPLATE_TONES).optional(),
        figure: z.enum(TEMPLATE_FIGURES).optional(),
        kicker: text(TEMPLATE_LIMITS.kicker).optional(),
      })
      .strict()
      .refine((c) => c.file != null || (c.tone != null && c.figure != null), { error: () => V.coverNeedsToneFigure().text }),
    preview: z
      .object({
        file: rootFile('preview', TEMPLATE_PREVIEW_EXTENSIONS).optional(),
        beats: z.array(text(TEMPLATE_LIMITS.beat)).min(TEMPLATE_LIMITS.beatsMin).max(TEMPLATE_LIMITS.beatsMax).optional(),
      })
      .strict()
      .refine((p) => p.file != null || p.beats != null, { error: () => V.previewNeedsBeats().text }),
    assets: z.array(asset).max(TEMPLATE_LIMITS.assets).optional(),
    verification: verification.optional(),
  })
  .strict()
  .superRefine((m, ctx) => {
    if (m.kind === 'scene') {
      for (const key of ['ratio', 'durationSeconds', 'brief'] as const)
        if (m[key] == null) ctx.addIssue({ code: 'custom', path: [key], message: V.sceneTemplateRequired().text });
      // scene 的待填项写在 brief 里；example 的写在 prompt.md 里，由读目录的一方（测试与 Runtime 加载器）对照正文检查。
      if (m.brief != null)
        for (const message of templateSlotProblems(m.brief, m.fields ?? [])) ctx.addIssue({ code: 'custom', path: ['brief'], message });
    } else if (m.brief != null) {
      ctx.addIssue({ code: 'custom', path: ['brief'], message: V.exampleTemplateNoBrief().text });
    }
    const labels = (m.fields ?? []).map((f) => f.label);
    if (new Set(labels).size !== labels.length)
      ctx.addIssue({ code: 'custom', path: ['fields'], message: V.templateFieldLabelsDuplicate().text });
    if (m.skills && new Set(m.skills).size !== m.skills.length)
      ctx.addIssue({ code: 'custom', path: ['skills'], message: V.templateSkillsDuplicate().text });
    if (new Set(m.tags).size !== m.tags.length) ctx.addIssue({ code: 'custom', path: ['tags'], message: V.tagsDuplicate().text });
    const paths = (m.assets ?? []).map((a) => a.path);
    if (new Set(paths).size !== paths.length) ctx.addIssue({ code: 'custom', path: ['assets'], message: V.assetPathsDuplicate().text });
  });

/** 编译期核对：schema 推出的类型与 `TemplateManifest` 一致。 */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const manifestTypeMatches: Same<z.infer<typeof templateManifestSchema>, TemplateManifest> = true;
void manifestTypeMatches;

/** 一种语言的译文 `locales/<语言>.json`（规范 §3.6）：只有文案，未知字段一律拒绝。与 `template.json` 的对照在 `parseTemplateTranslation`。 */
export const templateTranslationSchema = z
  .object({
    title: text(TEMPLATE_LIMITS.title),
    summary: text(TEMPLATE_LIMITS.summary),
    description: text(TEMPLATE_LIMITS.description),
    brief: text(TEMPLATE_LIMITS.brief).optional(),
    fields: z.array(field).max(TEMPLATE_LIMITS.fields).optional(),
    tags: z.array(text(TEMPLATE_LIMITS.tag)).max(TEMPLATE_LIMITS.tags),
    cover: z.object({ kicker: text(TEMPLATE_LIMITS.kicker).optional() }).strict().optional(),
    preview: z
      .object({ beats: z.array(text(TEMPLATE_LIMITS.beat)).min(TEMPLATE_LIMITS.beatsMin).max(TEMPLATE_LIMITS.beatsMax).optional() })
      .strict()
      .optional(),
    assets: z
      .array(z.object({ path: relativePath, note: text(TEMPLATE_LIMITS.note) }).strict())
      .max(TEMPLATE_LIMITS.assets)
      .optional(),
  })
  .strict()
  .superRefine((t, ctx) => {
    const labels = (t.fields ?? []).map((f) => f.label);
    if (new Set(labels).size !== labels.length)
      ctx.addIssue({ code: 'custom', path: ['fields'], message: V.templateFieldLabelsDuplicate().text });
    if (new Set(t.tags).size !== t.tags.length) ctx.addIssue({ code: 'custom', path: ['tags'], message: V.tagsDuplicate().text });
    const paths = (t.assets ?? []).map((a) => a.path);
    if (new Set(paths).size !== paths.length) ctx.addIssue({ code: 'custom', path: ['assets'], message: V.assetPathsDuplicate().text });
  });

const translationTypeMatches: Same<z.infer<typeof templateTranslationSchema>, TemplateTranslation> = true;
void translationTypeMatches;

export type TemplateTranslationResult = { ok: true; translation: TemplateTranslation } | { ok: false; issues: string[] };

/**
 * 读一份译文（已经 JSON.parse 过的值），对照它所属的 `template.json`（规范 §3.6）：scene 必须给 `brief` 且占位符与译文的
 * `fields` 对得上，example 不得有 `brief`；`fields` 与 `beats` 的项数与清单相同；素材只能是清单登记过的。
 * example 的提示词与 `fields` 的对照由读目录的一方查（同 `template.json`）。
 */
export function parseTemplateTranslation(value: unknown, manifest: TemplateManifest): TemplateTranslationResult {
  const result = templateTranslationSchema.safeParse(value);
  if (!result.success)
    return { ok: false, issues: result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`) };
  const t = result.data;
  const issues: string[] = [];
  if (manifest.kind === 'scene') {
    if (t.brief == null) issues.push(`brief: ${V.sceneTemplateRequired().text}`);
    else for (const message of templateSlotProblems(t.brief, t.fields ?? [])) issues.push(`brief: ${message}`);
  } else if (t.brief != null) {
    issues.push(`brief: ${V.exampleTemplateNoBrief().text}`);
  }
  const fieldCount = manifest.fields?.length ?? 0;
  if ((t.fields?.length ?? 0) !== fieldCount) issues.push(`fields: ${V.translationFieldsCount({ count: fieldCount }).text}`);
  const beatCount = manifest.preview.beats?.length ?? 0;
  if ((t.preview?.beats?.length ?? 0) !== beatCount) issues.push(`preview.beats: ${V.translationBeatsCount({ count: beatCount }).text}`);
  const registered = new Set((manifest.assets ?? []).map((a) => a.path));
  for (const a of t.assets ?? []) if (!registered.has(a.path)) issues.push(`assets: ${V.translationAssetUnknown({ path: a.path }).text}`);
  return issues.length ? { ok: false, issues } : { ok: true, translation: t };
}

export type TemplateManifestResult =
  { ok: true; manifest: TemplateManifest } | { ok: false; reason: 'unsupported-schema' | 'invalid'; issues: string[] };

/**
 * 读一份清单（已经 JSON.parse 过的值）。`schema` 不认识时返回 `unsupported-schema`：调用方跳过这个模板并记诊断，
 * 不让整个目录失败。`dirName` 给出时还要求 id 等于目录名。
 */
export function parseTemplateManifest(value: unknown, dirName?: string): TemplateManifestResult {
  const schema = value && typeof value === 'object' ? (value as { schema?: unknown }).schema : undefined;
  if (schema !== TEMPLATE_SCHEMA_VERSION)
    return { ok: false, reason: 'unsupported-schema', issues: [V.unknownSchema({ schema: String(schema) }).text] };
  const result = templateManifestSchema.safeParse(value);
  if (!result.success)
    return { ok: false, reason: 'invalid', issues: result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`) };
  if (dirName != null && result.data.id !== dirName)
    return { ok: false, reason: 'invalid', issues: [V.idFolderMismatch({ id: result.data.id, dir: dirName }).text] };
  return { ok: true, manifest: result.data };
}

// ---- `templates.*` 与发送时挂的模板：入站校验，由 `schemas.ts` 并进方法表 ----

const templateId = z.string().max(TEMPLATE_LIMITS.id).regex(TEMPLATE_ID_PATTERN, { error: () => V.templateIdKebab().text });

/** `conversations.send` 的 `template`（规范 §5.2）。 */
export const templateSendRefSchema = z
  .object({
    id: templateId,
    version: z.string().min(1).max(64).optional(),
    assets: z.array(relativePath).max(TEMPLATE_LIMITS.assets).optional(),
    language: languageTag.optional(),
  })
  .strict();

export const TEMPLATE_PARAM_SCHEMAS = {
  'templates.list': z.object({ language: languageTag.optional() }).strict(),
  'templates.get': z.object({ id: templateId, language: languageTag.optional() }).strict(),
  'templates.openHandle': z.object({ id: templateId, path: relativePath }).strict(),
} as const;
