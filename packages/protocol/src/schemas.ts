import { z } from 'zod';
import { ProtocolValidation as V } from './messages/protocol/protocol-validation.ts';
import type { RpcMethod } from './methods.ts';
import { SETTING_KEYS, type SettingKey, type SettingValues } from './settings.ts';
import { MODEL_API_MAX_CONCURRENT_LIMIT, SERVICE_IDS, SERVICE_LEVELS } from './services.ts';
import { AGENT_MODES, LEGACY_AGENT_MODES, normalizeAgentMode } from './access.ts';
import { GRANT_DATA_KINDS } from './grants.ts';
import { LANGUAGE_PREFERENCES } from './i18n.ts';
import { USAGE_PERIODS } from './usage.ts';
import { MAX_SELECTED_GLOSSARIES, MAX_SPEAKER_VOICES } from './library.ts';
import { WEB_METHOD_PATTERN } from './web.ts';
import { SPACE_PARAM_SCHEMAS } from './space-schemas.ts';
import { EXTERNAL_TOOL_PARAM_SCHEMAS } from './external-tools-schemas.ts';
import { TEMPLATE_PARAM_SCHEMAS, templateSendRefSchema } from './template-schemas.ts';
import { SKILL_PARAM_SCHEMAS, skillSendRefSchema } from './skill-schemas.ts';
import { FONT_PARAM_SCHEMAS } from './fonts-schemas.ts';
import { COMPOSITION_PARAM_SCHEMAS } from './code-bundle-schemas.ts';
import { TOOL_CATALOGUE_PARAM_SCHEMAS } from './tool-catalogue-schemas.ts';
import { DRIVER_ID_PATTERN, isBuiltinDriverId } from './domain.ts';
import { ATTACHMENT_UPLOAD_MIME_TYPES, ATTACHMENT_MIME_TYPES, MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS_PER_MESSAGE, MAX_PROJECT_FILES_LIMIT } from './limits.ts';

/**
 * 入站校验（Runtime 侧）。单独的子路径导出，界面打包不带上 zod。
 * 只校验客户端能发来的东西；出站 DTO 由类型约束。
 */

const id = z.string().min(1).max(200);
const seq = z.string().regex(/^\d+$/);
const topic = z.union([
  z.literal('directory'),
  z.literal('tasks'),
  z.literal('space'),
  z.literal('jobs'),
  z.literal('models'),
  z.literal('settings'),
  z.literal('services'),
  z.literal('library'),
  z.literal('grants'),
  z.literal('agent-setup'),
  z.literal('agents'),
  z.string().regex(/^conversation:[A-Za-z0-9_-]+$/),
  z.string().regex(/^video:[A-Za-z0-9_-]+$/),
]);
const empty = z.object({}).strict();
/** 访问模式：新值与仍被接受的旧值（架构设计 §3.12）。换成新值由收到的一方做（`normalizeAgentMode`）。 */
const agentMode = z.enum([...AGENT_MODES, ...LEGACY_AGENT_MODES]);
const serviceId = z.enum(SERVICE_IDS);
/** 模型接口服务的别名：外部程序用的模型名，不含 `/`（`<providerId>/<modelId>` 是规范写法）。 */
export const modelApiAlias = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/);
const filePath = z.string().min(1).max(4096);
const fileTarget = z.union([
  z.object({ entryId: id }).strict(),
  z.object({ conversationId: id, path: filePath }).strict(),
  z.object({ projectId: id, path: filePath }).strict(),
]);
const revision = z.string().regex(/^\d+$/);
const assetTarget = { videoId: id, assetId: id, revision: revision.optional() };
const attachmentTarget = z.object({ conversationId: id, attachmentId: id }).strict();
const mediaTarget = z.union([fileTarget, attachmentTarget, z.object(assetTarget).strict()]);
const positiveInt = z.number().int().positive();
/**
 * 编辑操作只在这里查外形；字段与语义由引擎校验（架构设计 §13.2：单源定义），
 * 引擎拒绝未知字段并按操作序号报错。
 */
const editOperation = z.looseObject({ type: z.string().min(1).max(50) });
const undoTarget = z.union([z.enum(['undo', 'redo']), z.object({ transaction: id }).strict()]);
/** BCP 47 语言标签：交给 `Intl.getCanonicalLocales` 判断。 */
const languageTag = z
  .string()
  .min(1)
  .max(35)
  .refine((tag) => {
    try {
      return Intl.getCanonicalLocales(tag).length === 1;
    } catch {
      return false;
    }
  }, { error: () => V.languageTagInvalid().text });
const bundleId = z.string().min(1).max(200);
/** Provider：`local`、`node:<nodeId 或别名>`、`openai`、`google`、`custom:<slug>`；认不认识由 Runtime 判断。 */
const providerId = z.string().trim().min(1).max(300);
const modelId = z.string().trim().min(1).max(200);
const serviceCapability = z.enum(['transcribe', 'synthesizeSpeech', 'generateImage', 'generateText', 'separateAudio']);
/** 有在线 Provider 的能力（`ONLINE_CAPABILITIES`）：自建服务商声明的模型与模型接口的别名只能是这几种。 */
const onlineCapability = z.enum(['transcribe', 'synthesizeSpeech', 'generateImage', 'generateText']);
/** 数据外发的授权（架构设计 §12.5）。金额是十进制字符串，不用浮点数。 */
const money = z
  .object({
    amount: z.string().regex(/^\d{1,12}(\.\d{1,6})?$/, { error: () => V.amountInvalid().text }),
    currency: z.string().regex(/^[A-Z]{3}$/),
  })
  .strict();
const grantDataKinds = z
  .array(z.enum(GRANT_DATA_KINDS))
  .min(1)
  .max(GRANT_DATA_KINDS.length)
  .refine((kinds) => new Set(kinds).size === kinds.length, { error: () => V.dataKindsDuplicate().text });
const grantScope = z.object({ videoId: id.nullable() }).strict();
const grantPurpose = z.string().trim().min(1).max(200);
const grantMaxCalls = z.number().int().positive().max(1_000_000);
const approvalGrantChoice = z.discriminatedUnion('persist', [
  z.object({ persist: z.literal(false) }).strict(),
  z
    .object({
      persist: z.literal(true),
      scope: z.enum(['video', 'all']).optional(),
      maxCalls: grantMaxCalls.nullable().optional(),
      budgetCap: money.nullable().optional(),
      expiresAt: z.iso.datetime({ offset: true }).nullable().optional(),
    })
    .strict(),
]);
/** 任务合同（架构设计 §3.2）。数组都有上限：合同交给智能体，不能无限长。 */
const contractScope = z
  .object({
    videoId: id.nullable(),
    videoRevision: revision.nullable(),
    sequenceId: id.nullable(),
    itemIds: z.array(id).max(200),
    timeRange: z
      .object({ fromSeconds: z.number().finite().nonnegative(), toSeconds: z.number().finite().nonnegative() })
      .strict()
      .refine((r) => r.fromSeconds < r.toSeconds, { error: () => V.timeRangeOrder().text })
      .nullable(),
  })
  .partial()
  .strict();
const contractConstraints = z
  .array(
    z
      .object({
        constraintId: id.optional(),
        kind: z.enum(['content', 'style', 'duration', 'format', 'language', 'other']),
        text: z.string().trim().min(1).max(2000),
      })
      .strict(),
  )
  .max(50);
const frameCount = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const protectionTarget = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('video') }).strict(),
  z.object({ kind: z.literal('entity'), entityId: id }).strict(),
  z
    .object({
      kind: z.literal('property'),
      entityId: id,
      propertyPaths: z
        .array(z.string().regex(/^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*$/))
        .min(1)
        .max(20),
    })
    .strict(),
  z
    .object({
      kind: z.literal('interval'),
      sequenceId: id,
      span: z.object({ fromFrame: frameCount, durationFrames: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }).strict(),
      trackIds: z.array(id).min(1).max(50).optional(),
    })
    .strict(),
]);
const contractProtections = z
  .array(z.object({ protectionId: id.optional(), videoId: id, target: protectionTarget, note: z.string().max(500).optional() }).strict())
  .max(50);
const contractDeliverables = z
  .array(
    z
      .object({
        kind: z.enum(['preview', 'video-change', 'video-file', 'subtitle', 'audio', 'package']),
        requiredStage: z.enum(['candidate-ready', 'committed', 'published']),
        language: languageTag.optional(),
        variantId: id.optional(),
      })
      .strict(),
  )
  .max(20);
const contractBudget = z.object({ maxCalls: grantMaxCalls.nullable(), cap: money.nullable() }).strict();
const contractChecks = z
  .array(
    z
      .object({
        checkId: id.optional(),
        kind: z.enum(['review', 'quality']),
        description: z.string().trim().min(1).max(1000),
        required: z.boolean(),
      })
      .strict(),
  )
  .max(50);
const contractInput = z
  .object({
    scope: contractScope.optional(),
    constraints: contractConstraints.optional(),
    protectedRefs: contractProtections.optional(),
    deliverables: contractDeliverables.optional(),
    budget: contractBudget.optional(),
    acceptanceChecks: contractChecks.optional(),
  })
  .strict();
const contractPatch = contractInput.extend({ autonomy: agentMode.optional() }).strict();
/** 任务合同的修改（`tasks.updateContract` 的 `patch`；智能体的 `tasks_update_contract` 工具也按它校验）。 */
export const taskContractPatchSchema = contractPatch;
const editorContext = z
  .object({
    videoId: id,
    videoName: z.string().max(200),
    videoPath: filePath,
    revision,
    selection: z.array(id).max(200),
    playheadSeconds: z.number().finite().nonnegative(),
  })
  .strict();

const textEffort = z.enum(['minimal', 'low', 'medium', 'high']);
/** 文本消息：只有文本。单条与总长的上限按模型的上下文在供应商那里检查（`INPUT_TOO_LONG`），这里只挡住明显过大的请求。 */
/** Space 里的一个条目作为输入（§7.9）：Runtime 在方法层换成文件或文字。 */
const spaceEntryInput = z.object({ entryId: id }).strict();
const textMessage = z
  .object({
    role: z.enum(['system', 'user', 'assistant']),
    content: z.string().max(2_000_000),
  })
  .strict();
/** JSON Schema 本身在提交时编译检查（不合法的是 `invalid-request`）；这里只要求是对象。 */
const textResponseFormat = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text') }).strict(),
  z
    .object({
      type: z.literal('json'),
      schema: z.record(z.string(), z.unknown()),
      name: z
        .string()
        .regex(/^[A-Za-z0-9_-]{1,64}$/, { error: () => V.nameChars().text })
        .optional(),
    })
    .strict(),
]);
/** API key：只允许可见的 ASCII（不含空白与换行），进请求头前不必再转义。 */
const credential = z
  .string()
  .max(4096)
  .regex(/^[\x21-\x7e]+$/, { error: () => V.secretChars().text });
/** 账号（架构设计 §6.8）：随机的短 id，名字可选，region 是目录里预设的地区名。 */
const accountId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/, { error: () => V.accountIdChars().text });
const accountLabel = z.string().trim().min(1).max(100);
const accountRegion = z.string().regex(/^[a-z][a-z0-9-]{0,31}$/, { error: () => V.regionChars().text });
const endpoint = z
  .string()
  .max(2048)
  .refine((value) => {
    try {
      const url = new URL(value);
      return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password && !url.search && !url.hash;
    } catch {
      return false;
    }
  }, { error: () => V.endpointInvalid().text });
const speechFormat = z.enum(['mp3', 'wav', 'flac']);
const imageFormat = z.enum(['png', 'jpeg', 'webp']);
/** `WIDTHxHEIGHT`。 */
const imageSize = z.string().regex(/^[1-9]\d{1,4}x[1-9]\d{1,4}$/, { error: () => V.imageSize().text });
/** `WIDTHxHEIGHT` 或宽高比 `W:H`。 */
const imageSizeOrRatio = z.string().regex(/^(?:[1-9]\d{1,4}x[1-9]\d{1,4}|[1-9]\d{0,2}:[1-9]\d{0,2})$/, { error: () => V.imageSizeOrRatio().text });
const voiceId = z.string().trim().min(1).max(200);
/** 供应商的 seed 都在 32 位无符号整数之内。 */
const seed = z.number().int().min(0).max(4_294_967_295);
// ---- 用户库（架构设计 §5.9）：这里只查外形；规范化与语义检查（空术语、重复、文件内容）在库里做 ----
const libraryName = z.enum(['glossaries', 'voices', 'brand']);
const libraryId = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/, { error: () => V.libraryIdChars().text });
const libraryVersion = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const libraryRef = z.object({ library: libraryName, id: libraryId, version: libraryVersion.optional() }).strict();
const libraryEntryName = z.string().trim().min(1).max(200);
const libraryTerm = z.string().trim().min(1).max(200);
const libraryTerms = 5000;
const glossaryContent = z.discriminatedUnion('kind', [
  z
    .object({
      name: libraryEntryName,
      kind: z.literal('transcription'),
      language: languageTag.nullable(),
      defaultEnabled: z.boolean(),
      terms: z.array(z.object({ canonical: libraryTerm, misheard: z.array(libraryTerm).max(50) }).strict()).max(libraryTerms),
    })
    .strict(),
  z
    .object({
      name: libraryEntryName,
      kind: z.literal('translation'),
      sourceLanguage: languageTag.nullable(),
      targetLanguage: languageTag,
      defaultEnabled: z.boolean(),
      terms: z
        .array(z.object({ source: libraryTerm, target: libraryTerm, note: z.string().max(1000).nullable() }).strict())
        .max(libraryTerms),
    })
    .strict(),
]);
const voiceContentInput = z
  .object({
    name: libraryEntryName,
    language: languageTag.nullable(),
    transcript: z.string().max(10_000),
    origin: z.enum(['recorded', 'imported']),
    consent: z.object({ declared: z.boolean(), statement: z.string().max(2000).nullable().optional() }).strict(),
  })
  .strict();
const brandContentInput = z.union([
  z.object({ name: libraryEntryName, kind: z.enum(['image', 'video', 'sticker', 'font']) }).strict(),
  z
    .object({
      name: libraryEntryName,
      kind: z.literal('color'),
      value: z.string().regex(/^#(?:[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/, { error: () => V.colorHex().text }),
    })
    .strict(),
  z
    .object({
      name: libraryEntryName,
      kind: z.literal('captionStyle'),
      style: z.looseObject({ schema: z.string().trim().min(1).max(200) }),
    })
    .strict(),
  // 保留的种类：收下外形，由 Runtime 带着说明拒绝（LIBRARY_KIND_RESERVED）。
  z.looseObject({ name: libraryEntryName, kind: z.literal('overlayTemplate') }),
]);
const librarySource = z.union([
  z.object({ path: filePath }).strict(),
  z.object({ artifactId: z.string().regex(/^sha256:[0-9a-f]{64}$/) }).strict(),
]);
const libraryPutCommon = {
  id: libraryId.optional(),
  expectedVersion: libraryVersion.optional(),
  source: librarySource.optional(),
  commandId: id.optional(),
};
const declaredModel = z
  .object({
    modelId,
    label: z.string().trim().min(1).max(100).optional(),
    capability: onlineCapability.optional(),
    maxInputBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
    maxDurationSec: z.number().positive().max(1_000_000).nullable().optional(),
    wordTimestamps: z.enum(['native', 'none']).optional(),
    acceptsHint: z.boolean().optional(),
    voices: z.array(voiceId).max(100).optional(),
    maxInputChars: z.number().int().positive().max(1_000_000).optional(),
    formats: z.array(speechFormat).min(1).optional(),
    sizes: z.array(imageSize).max(100).optional(),
    maxCount: z.number().int().min(1).max(10).optional(),
    maxPromptChars: z.number().int().positive().max(1_000_000).optional(),
    contextTokens: z.number().int().positive().max(100_000_000).optional(),
    maxOutputTokens: z.number().int().positive().max(10_000_000).optional(),
    efforts: z.array(textEffort).max(4).optional(),
    structuredOutput: z.boolean().optional(),
  })
  .strict();
/** 节点协议的客户端标识：令牌是 `<clientId>.<secret>`，所以不能含 `.`。 */
const nodeClientId = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
/** 本机给已配对节点起的别名：`models.transcribe` 的 `node` 与 CLI 用它指代节点。 */
const nodeAlias = z.string().trim().min(1).max(63);
/** Driver id 只校验写法：是否注册了由 Runtime 判断（没注册的以 `driver-unavailable` 拒绝）。 */
const driverId = z.string().regex(DRIVER_ID_PATTERN, { error: () => V.driverIdStart().text });
/** 用户添加的 ACP 智能体（`agents.addProvider`）：不得与内置的重名。 */
const customDriverId = driverId.refine((id) => !isBuiltinDriverId(id), { error: () => V.driverIdBuiltin().text });
const envName = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,127}$/, { error: () => V.envNameChars().text });
const installKind = z.enum(['script', 'brew', 'npm']);
/** 模型与强度 id 由 Agent 给出，这里只限长度；null = 用 Agent 的默认。 */
const agentModel = z.string().trim().min(1).max(200).nullable();
const agentEffort = z.string().trim().min(1).max(50).nullable();
const attachmentIds = z.array(id).max(MAX_ATTACHMENTS_PER_MESSAGE);
const languageOption = z.union([
  z.object({ mode: z.literal('assert'), tag: languageTag }).strict(),
  z.object({ mode: z.literal('prefer'), tag: languageTag.nullable() }).strict(),
]);
const tick = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

/** 本机的绝对路径：POSIX 路径、Windows 盘符或 UNC 共享路径。不含 NUL。 */
const absolutePath = z
  .string()
  .max(4096)
  .regex(/^(?:\/|[A-Za-z]:[\\/]|\\\\[^\\/\0]+[\\/][^\\/\0]+(?:[\\/]|$))[^\0]*$/, { error: () => V.absolutePath().text });

/**
 * 偏好设置每个键的取值（架构设计 §5.10）。键、类型、默认值与说明见 `settings.ts`；这里只管校验。
 * 写入与读取（文件里的旧值）都过这一份：不合的值不保存，读到时按默认值处理。
 */
export const settingValueSchemas = {
  'agent.defaultDriver': z
    .string()
    .regex(/^[a-z][a-z0-9-]{0,62}$/, { error: () => V.driverIdChars().text })
    .nullable(),
  'agent.defaultModel': z.string().trim().min(1).max(200).nullable(),
  'agent.defaultEffort': z
    .string()
    .regex(/^[a-z][a-z0-9-]{0,31}$/, { error: () => V.effortChars().text })
    .nullable(),
  // 旧值（controlled、authorized）照样接受，存成新值；文件里留下的旧值读入时同样换成新值。
  'agent.defaultAccessMode': agentMode.transform(normalizeAgentMode),
  'ui.language': z.enum(LANGUAGE_PREFERENCES),
  'captions.maxLineLength': z.object({ cjk: z.number().int().min(4).max(60), other: z.number().int().min(10).max(120) }).strict(),
  'transcribe.afterComplete': z.enum(['open-video', 'notify', 'nothing']),
  'downloads.directory': absolutePath.nullable(),
  'models.dir': absolutePath.nullable(),
  'models.downloadEndpoint': z
    .string()
    .max(500)
    .refine(isDownloadEndpoint, { error: () => V.downloadEndpoint().text })
    .nullable(),
  'tools.downloadEndpoint': z
    .string()
    .max(500)
    .refine(isDownloadEndpoint, { error: () => V.downloadEndpoint().text })
    .nullable(),
  'fonts.autoDownload': z.boolean(),
  'fonts.cssEndpoint': z
    .string()
    .max(500)
    .refine(isHttpsEndpoint, { error: () => V.fontEndpoint().text })
    .nullable(),
  'fonts.fileEndpoint': z
    .string()
    .max(500)
    .refine(isHttpsEndpoint, { error: () => V.fontEndpoint().text })
    .nullable(),
  'space.trashRetentionDays': z.number().int().min(1).max(3650),
  'cache.maxSizeMiB': z.number().int().min(256).max(1024 * 1024),
  'runtime.idleExitMinutes': z.number().int().min(1).max(1440),
  'resources.capacity': z
    .object({
      memoryMiB: z
        .number()
        .int()
        .min(512)
        .max(16 * 1024 * 1024)
        .nullable(),
      gpuMemoryMiB: z
        .number()
        .int()
        .min(0)
        .max(16 * 1024 * 1024)
        .nullable(),
      cpuThreads: z.number().int().min(1).max(4096).nullable(),
    })
    .strict()
    .nullable(),
  'updates.autoCheck': z.boolean(),
  'updates.autoDownload': z.boolean(),
  'diagnostics.enabled': z.boolean(),
  'offline.strict': z.boolean(),
} satisfies { [K in SettingKey]: z.ZodType<SettingValues[K]> };

/** 模型下载来源的基址：`http(s)://`，不带凭据、查询参数与片段（凭据不得出现在 URL 里）。 */
function isDownloadEndpoint(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password && !url.search && !url.hash;
}

/** 字体下载来源的基址：只认 `https://`（字体文件按字体解析之后直接进渲染器，不经明文连接取），其余同上。 */
export function isHttpsEndpoint(value: string): boolean {
  return isDownloadEndpoint(value) && new URL(value).protocol === 'https:';
}

/** `settings.set` 的 `values`：只接受注册过的键；`null` 表示恢复默认值。 */
export const settingsPatchSchema = z
  .object(
    Object.fromEntries(SETTING_KEYS.map((key) => [key, z.union([z.null(), settingValueSchemas[key]]).optional()])) as {
      [K in SettingKey]: z.ZodOptional<z.ZodUnion<[z.ZodNull, (typeof settingValueSchemas)[K]]>>;
    },
  )
  .strict();

// ---- 导出（架构设计 §9.13） ----

const exportSeconds = z.number().finite().min(0).max(1_000_000);
const exportRange = z
  .object({ start: exportSeconds, end: exportSeconds })
  .strict()
  .refine((r) => r.end > r.start, { error: () => V.rangeOrder().text });
const exportScope = {
  purpose: z.enum(['deliverable', 'preview']).optional(),
  sequenceId: id.optional(),
  range: exportRange.optional(),
  ranges: z.array(exportRange).min(1).max(64).optional(),
};
const textExportOptions = {
  documentId: id.optional(),
  language: languageTag.optional(),
  bilingual: z.union([z.boolean(), z.object({ documentId: id.optional(), language: languageTag.optional() }).strict()]).optional(),
  maxCharsPerLine: z.number().int().min(8).max(200).optional(),
  timestamps: z.boolean().optional(),
  scopeItemIds: z.array(id).min(1).max(1000).optional(),
};
/** 文稿独有的选项（`TranscriptExportOptions`）：字幕不认，给了以 `invalid-request` 拒绝。 */
const transcriptExportOptions = {
  frontmatter: z.boolean().optional(),
  chapters: z.boolean().optional(),
  speakers: z.boolean().optional(),
  skipCut: z.boolean().optional(),
};
const audioExportOptions = {
  sampleRate: z.union([z.literal(22050), z.literal(32000), z.literal(44100), z.literal(48000)]).optional(),
  channels: z.union([z.literal(1), z.literal(2)]).optional(),
  bitrateKbps: z.number().int().min(32).max(320).optional(),
  loudness: z
    .object({
      integratedLufs: z.number().min(-70).max(0),
      truePeakDb: z.number().min(-20).max(0),
    })
    .strict()
    .nullable()
    .optional(),
};
/** 声音来源（音频与成片导出）：混音、只要原声，或只要一组配音。 */
const audioExportSource = z.union([z.enum(['mix', 'original']), z.object({ dubGroupId: z.string().min(1).max(128) }).strict()]);
const oneRange = (s: { range?: unknown; ranges?: unknown }) => s.range === undefined || s.ranges === undefined;
const subtitleExportSettings = z
  .object({ kind: z.literal('subtitles'), format: z.enum(['srt', 'vtt', 'ass', 'json']), ...exportScope, ...textExportOptions })
  .strict()
  .refine(oneRange, { error: () => V.rangeOrRanges().text });
const transcriptExportSettings = z
  .object({
    kind: z.literal('transcript'),
    format: z.enum(['md', 'txt', 'json']),
    ...exportScope,
    ...textExportOptions,
    ...transcriptExportOptions,
  })
  .strict()
  .refine(oneRange, { error: () => V.rangeOrRanges().text });
/** `exports.renderText` 只排字幕与文稿：别的种类在这里就以 `invalid-request` 拒绝。 */
const textExportSettings = z.union([subtitleExportSettings, transcriptExportSettings]);
const exportSettings = z.union([
  subtitleExportSettings,
  transcriptExportSettings,
  z
    .object({
      kind: z.literal('audio'),
      format: z.enum(['wav', 'mp3', 'm4a']),
      ...exportScope,
      ...audioExportOptions,
      source: audioExportSource.optional(),
    })
    .strict()
    .refine(oneRange, { error: () => V.rangeOrRanges().text })
    .refine((s) => s.format !== 'wav' || s.bitrateKbps === undefined, { error: () => V.wavNoBitrate().text }),
  z
    .object({
      kind: z.literal('video'),
      format: z.enum(['mp4', 'webm']),
      ...exportScope,
      codec: z.enum(['h264', 'hevc', 'vp9']).optional(),
      width: z.number().int().min(16).max(7680).optional(),
      height: z.number().int().min(16).max(4320).optional(),
      fps: z
        .object({ num: z.number().int().min(1).max(240_000), den: z.number().int().min(1).max(100_000) })
        .strict()
        .optional(),
      crf: z.number().int().min(0).max(63).optional(),
      bitrateKbps: z.number().int().min(100).max(200_000).optional(),
      burnCaptions: z.boolean().optional(),
      onUnsupported: z.enum(['fail', 'skip']).optional(),
      audio: z.object(audioExportOptions).strict().optional(),
      source: audioExportSource.optional(),
    })
    .strict()
    .refine(oneRange, { error: () => V.rangeOrRanges().text })
    .refine((s) => s.crf === undefined || s.bitrateKbps === undefined, { error: () => V.crfOrBitrate().text })
    .refine((s) => s.codec === undefined || (s.format === 'webm') === (s.codec === 'vp9'), { error: () => V.codecFormat().text })
    .refine((s) => s.fps === undefined || s.fps.num / s.fps.den <= 240, { error: () => V.fpsMax().text }),
  z
    .object({
      kind: z.literal('portable'),
      format: z.literal('baocut').optional(),
      purpose: exportScope.purpose,
      missingAssets: z.enum(['fail', 'skip']).optional(),
    })
    .strict(),
  z.object({ kind: z.literal('project'), format: z.literal('xmeml'), purpose: exportScope.purpose, sequenceId: id.optional() }).strict(),
]);
const exportDestination = z
  .object({
    dir: filePath.optional(),
    fileName: z
      .string()
      .trim()
      .min(1)
      .max(255)
      .refine((n) => !/[/\\\0]/.test(n) && n !== '.' && n !== '..', { error: () => V.fileNameNoFolder().text })
      .optional(),
    overwrite: z.boolean().optional(),
  })
  .strict();

export const helloFrameSchema = z.object({
  type: z.literal('hello'),
  protocolVersion: z.string(),
  token: z.string(),
  client: z.object({
    kind: z.enum(['desktop', 'cli', 'agent']),
    name: z.string().max(100),
    version: z.string().max(50),
  }),
});

export const requestFrameSchema = z.object({
  type: z.literal('request'),
  id: z.string().min(1).max(100),
  method: z.string().min(1).max(100),
  params: z.unknown(),
});

/** `projects.files.create` 写入的文本上限（UTF-16 码元数，约 1 MiB）：起始页新建的是一份网页骨架，不是上传通道。 */
const MAX_PROJECT_FILE_CREATE_CHARS = 1024 * 1024;
const projectFileCreate = {
  name: z.string().min(1).max(255),
  content: z.string().max(MAX_PROJECT_FILE_CREATE_CHARS),
  dir: z.string().max(4096).optional(),
};

export const methodParamSchemas = {
  'runtime.info': empty,
  'runtime.status': empty,
  'runtime.stop': empty,
  'agents.list': empty,
  'agents.detect': z.object({ driverId: driverId.optional() }),
  'agents.configure': z.object({
    driverId,
    enabled: z.boolean().optional(),
    defaultModel: agentModel.optional(),
    defaultEffort: agentEffort.optional(),
    executable: filePath.nullable().optional(),
  }),
  'agents.setDefault': z.object({ driverId }),
  'agents.addProvider': z
    .object({
      id: customDriverId,
      name: z.string().trim().min(1).max(100),
      // 第一个元素是可执行文件，其余是参数（架构设计 §3.11）。
      command: z.array(z.string().min(1).max(4096).refine((a) => !a.includes('\0'), { error: () => V.noNul().text })).min(1).max(64),
      env: z.record(envName, z.string().max(8192).refine((v) => !v.includes('\0'), { error: () => V.noNul().text })).optional(),
      commandId: id.optional(),
    })
    .strict(),
  'agents.removeProvider': z.object({ id: driverId }).strict(),
  'agents.updatePreferences': z.object({
    policy: z.object({ read: z.boolean(), bcutro: z.boolean(), loop: z.boolean() }).partial().strict().optional(),
    modelAutoUpdate: z.boolean().optional(),
  }),
  'agents.removeRule': z.object({ rule: z.string().min(1).max(500) }),
  'agents.respondToApproval': z.object({
    conversationId: id,
    approvalId: id,
    decision: z.enum(['accept', 'accept-for-session', 'accept-always', 'decline']),
  }),
  'agents.interrupt': z.object({ conversationId: id }),
  // 参数里不收命令：命令由 Runtime 从探测结果里取（架构设计 §12.9）。多给的字段直接拒绝。
  'agents.runSetup': z
    .object({ driverId, action: z.enum(['install', 'upgrade']), kind: installKind, commandId: id })
    .strict(),
  'agents.cancelSetup': z.object({ runId: id }).strict(),
  'agents.openTerminal': z
    .object({ driverId, action: z.enum(['login', 'install', 'upgrade']), kind: installKind.optional() })
    .strict(),
  'projects.list': empty,
  'projects.open': z.object({ path: z.string().min(1).max(4096) }),
  'projects.create': z.object({ name: z.string().max(100).optional(), commandId: id.optional() }),
  'projects.update': z.object({
    projectId: id,
    name: z.string().trim().min(1).max(100).optional(),
    pinned: z.boolean().optional(),
    archived: z.boolean().optional(),
  }),
  'projects.files.list': z
    .object({
      conversationId: id,
      dir: z.string().max(4096).optional(),
      query: z.string().max(200).optional(),
      limit: z.number().int().min(1).max(MAX_PROJECT_FILES_LIMIT).optional(),
    })
    .strict(),
  'projects.files.create': z.union([
    z.object({ conversationId: id, ...projectFileCreate }).strict(),
    z.object({ projectId: id, ...projectFileCreate }).strict(),
  ]),
  'conversations.list': empty,
  'conversations.create': z.object({
    projectId: id.nullable().optional(),
    title: z.string().max(200).optional(),
    commandId: id.optional(),
    driverId: driverId.optional(),
    model: agentModel.optional(),
    effort: agentEffort.optional(),
    accessMode: agentMode.nullable().optional(),
  }),
  'conversations.get': z.object({ conversationId: id }),
  'conversations.update': z.object({
    conversationId: id,
    title: z.string().trim().min(1).max(200).optional(),
    pinned: z.boolean().optional(),
    archived: z.boolean().optional(),
    driverId: driverId.optional(),
    model: agentModel.optional(),
    effort: agentEffort.optional(),
    accessMode: agentMode.nullable().optional(),
    pendingReferences: z.null().optional(),
  }),
  'conversations.markRead': z.object({ conversationId: id }),
  'conversations.delete': z.object({ conversationId: id }),
  'conversations.send': z.object({
    conversationId: id,
    text: z.string().min(1).max(100_000),
    commandId: id,
    accessMode: agentMode.optional(),
    autonomy: agentMode.optional(),
    context: editorContext.optional(),
    attachments: attachmentIds.optional(),
    contract: contractInput.optional(),
    template: templateSendRefSchema.optional(),
    skill: skillSendRefSchema.optional(),
  }),
  'conversations.steer': z.object({
    conversationId: id,
    text: z.string().min(1).max(100_000),
    commandId: id,
    attachments: attachmentIds.optional(),
  }),
  'attachments.prepare': z.object({
    fileName: z.string().trim().min(1).max(255),
    mimeType: z.enum(ATTACHMENT_UPLOAD_MIME_TYPES),
    size: z.number().int().positive().max(MAX_ATTACHMENT_BYTES),
  }),
  'tasks.stop': z.object({ taskId: id }),
  'tasks.create': z
    .object({
      conversationId: id,
      goal: z.string().min(1).max(100_000),
      commandId: id,
      accessMode: agentMode.optional(),
      context: editorContext.optional(),
      contract: contractInput.optional(),
    })
    .strict(),
  'tasks.getContract': z.object({ taskId: id, revision: z.number().int().positive().optional() }).strict(),
  'tasks.listContracts': z.union([z.object({ conversationId: id }).strict(), z.object({ taskId: id }).strict()]),
  'tasks.updateContract': z
    .object({ taskId: id, expectedRevision: z.number().int().positive(), commandId: id, patch: contractPatch })
    .strict(),
  'tasks.changeGoal': z
    .object({ taskId: id, goal: z.string().min(1).max(100_000), previousWork: z.enum(['stop', 'keep']), commandId: id })
    .strict(),
  'tasks.recordCheck': z
    .object({
      taskId: id,
      checkId: id,
      outcome: z.enum(['passed', 'failed', 'skipped']),
      note: z.string().max(2000).optional(),
      commandId: id.optional(),
    })
    .strict(),
  'tasks.listChecks': z.object({ taskId: id }).strict(),
  'approvals.list': empty,
  'approvals.respond': z.object({ approvalId: id, decision: z.enum(['allow', 'deny']), grant: approvalGrantChoice.optional() }).strict(),
  'grants.list': z.object({ recipient: providerId.optional(), videoId: id.optional(), includeEnded: z.boolean().optional() }).strict(),
  'grants.create': z
    .object({
      dataKinds: grantDataKinds,
      recipient: providerId,
      scope: grantScope.optional(),
      purpose: grantPurpose,
      budgetMode: z.enum(['estimate-cap', 'per-call-unknown-cost']),
      budgetCap: money.nullable().optional(),
      maxCalls: grantMaxCalls.nullable().optional(),
      expiresAt: z.iso.datetime({ offset: true }).nullable().optional(),
      taskId: id.nullable().optional(),
    })
    .strict(),
  'grants.update': z
    .object({
      grantId: id,
      dataKinds: grantDataKinds.optional(),
      scope: grantScope.optional(),
      purpose: grantPurpose.optional(),
      budgetCap: money.nullable().optional(),
      maxCalls: grantMaxCalls.nullable().optional(),
      expiresAt: z.iso.datetime({ offset: true }).nullable().optional(),
    })
    .strict(),
  'grants.revoke': z.object({ grantId: id }).strict(),
  'grants.usage': z.object({ grantId: id }).strict(),
  'space.update': z.object({
    entryId: id,
    favorite: z.boolean().optional(),
    displayName: z.string().trim().max(200).nullable().optional(),
    trashed: z.boolean().optional(),
  }),
  'space.rescan': empty,
  ...SPACE_PARAM_SCHEMAS,
  ...EXTERNAL_TOOL_PARAM_SCHEMAS,
  ...TOOL_CATALOGUE_PARAM_SCHEMAS,
  ...TEMPLATE_PARAM_SCHEMAS,
  ...SKILL_PARAM_SCHEMAS,
  'media.resolve': mediaTarget,
  'media.playback': z.object({ url: z.string().min(1).max(8192) }).strict(),
  'media.subtitles': fileTarget,
  'media.peaks': z.object(assetTarget).strict(),
  'media.thumbnail': z.object({ ...assetTarget, at: z.number().finite().nonnegative().max(1_000_000) }).strict(),
  ...FONT_PARAM_SCHEMAS,
  ...COMPOSITION_PARAM_SCHEMAS,
  'videos.create': z
    .object({
      projectId: id.optional(),
      conversationId: id.optional(),
      name: z.string().trim().min(1).max(100).optional(),
      fps: z
        .object({ num: positiveInt.max(1_000_000), den: positiveInt.max(1_000_000) })
        .strict()
        .optional(),
      width: positiveInt.max(16_384).optional(),
      height: positiveInt.max(16_384).optional(),
      commandId: id.optional(),
    })
    .strict(),
  'videos.open': fileTarget,
  'videos.importPackage': z
    .object({
      projectId: id.optional(),
      conversationId: id.optional(),
      path: filePath,
      commandId: id.optional(),
    })
    .strict()
    .refine((p) => (p.projectId === undefined) !== (p.conversationId === undefined), { error: () => V.projectOrConversation().text }),
  'videos.close': z.object({ videoId: id }).strict(),
  'videos.delete': z.union([fileTarget, z.object({ videoId: id }).strict()]),
  'videos.restore': z.object({ entryId: id }).strict(),
  'videos.history': z.object({ videoId: id, limit: positiveInt.max(1000).optional() }).strict(),
  'videos.assetStatus': z.object({ videoId: id }).strict(),
  'documents.read': z.object({ videoId: id, documentId: id, revision: revision.optional() }).strict(),
  'edits.apply': z
    .object({
      videoId: id,
      commandId: id,
      expectedRevision: revision,
      operations: z.array(editOperation).min(1).max(500),
      label: z.string().trim().min(1).max(200).optional(),
    })
    .strict(),
  'edits.undo': z.object({ videoId: id, commandId: id, target: undoTarget, expectedRevision: revision.optional() }).strict(),
  'edits.undoState': z.object({ videoId: id }).strict(),
  'edits.applySpeakers': z
    .object({
      videoId: id,
      jobId: id,
      commandId: id,
      names: z.record(id, z.string().trim().min(1).max(100)).optional(),
    })
    .strict(),
  'models.list': empty,
  'models.transcribe': z
    .object({
      videoId: id,
      assetId: id,
      revision: revision.optional(),
      provider: providerId.optional(),
      model: modelId.optional(),
      bundleId: bundleId.optional(),
      language: languageOption.optional(),
      track: z.number().int().nonnegative().max(64).optional(),
      hint: z.string().max(1200).optional(),
      diarize: z.boolean().optional(),
      glossaries: z
        .array(z.object({ id: libraryId, version: libraryVersion.optional() }).strict())
        .max(20)
        .optional(),
      node: z.string().trim().min(1).max(200).optional(),
      commandId: id.optional(),
    })
    .strict(),
  'models.synthesizeSpeech': z
    .object({
      // 上限按模型在提交时检查（`maxInputChars`）；这里只挡住明显过大的请求。
      // 给了 `material` 时 `text` 是空字符串，由 Runtime 换成条目的文字（见下面的整体检查）。
      text: z.string().max(200_000),
      voice: voiceId.optional(),
      provider: providerId.optional(),
      model: modelId.optional(),
      language: languageTag.optional(),
      format: speechFormat.optional(),
      instructions: z.string().max(4096).optional(),
      speed: z.number().min(0.1).max(10).optional(),
      seed: seed.optional(),
      // 本地模型的声音方式（§6.1）：参考录音加原文、一句描述；三种给法互斥，模型是否接受在提交时按描述检查。
      reference: z
        .object({ file: absolutePath, transcript: z.string().max(4096).optional() })
        .strict()
        .optional(),
      voiceDescription: z
        .string()
        .max(1000)
        .refine((t) => t.trim().length > 0, { error: () => V.descriptionEmpty().text })
        .optional(),
      cfg: z.number().min(0).max(100).optional(),
      steps: z.number().int().min(1).max(1000).optional(),
      videoId: id.optional(),
      name: z.string().trim().min(1).max(200).optional(),
      // 保存位置（§7.9）：结果另存一份可读名字的副本。
      saveDir: absolutePath.optional(),
      // Space 条目作为素材（§7.9）：文档或字幕条目的文字当 `text`。
      material: spaceEntryInput.optional(),
      commandId: id.optional(),
    })
    .strict()
    .refine((r) => (r.material ? r.text === '' : r.text.trim().length > 0), {
      error: () => V.speechTextEmpty().text,
      path: ['text'],
    })
    .refine((r) => [r.voice, r.reference, r.voiceDescription].filter((v) => v !== undefined).length <= 1, {
      error: () => V.voiceOneOf().text,
    }),
  'models.generateImage': z
    .object({
      prompt: z
        .string()
        .max(200_000)
        .refine((t) => t.trim().length > 0, { error: () => V.promptEmpty().text }),
      size: imageSizeOrRatio.optional(),
      count: z.number().int().min(1).max(10).optional(),
      format: imageFormat.optional(),
      seed: seed.optional(),
      steps: z.number().int().min(1).max(1000).optional(),
      provider: providerId.optional(),
      model: modelId.optional(),
      videoId: id.optional(),
      name: z.string().trim().min(1).max(200).optional(),
      // 保存位置（§7.9）：结果另存一份可读名字的副本。
      saveDir: absolutePath.optional(),
      commandId: id.optional(),
    })
    .strict(),
  'models.generateText': z
    .object({
      messages: z
        .array(textMessage)
        .min(1)
        .max(1000)
        .refine(
          (messages) => messages.some((m) => m.role !== 'system' && m.content.trim().length > 0),
          { error: () => V.textMessagesEmpty().text },
        ),
      responseFormat: textResponseFormat.optional(),
      maxOutputTokens: z.number().int().positive().max(10_000_000).optional(),
      temperature: z.number().min(0).max(2).optional(),
      effort: textEffort.optional(),
      seed: seed.optional(),
      provider: providerId.optional(),
      model: modelId.optional(),
      // 保存位置（§7.9）：结果另存一份可读名字的副本。
      saveDir: absolutePath.optional(),
      // Space 条目作为素材（§7.9）：文字接在最后一条用户消息后面。
      material: spaceEntryInput.optional(),
      commandId: id.optional(),
    })
    .strict(),
  'models.refreshProvider': z.object({ providerId }).strict(),
  'models.setCapabilityParameters': z
    .object({
      capability: z.literal('generateText'),
      effort: textEffort.nullable().optional(),
      concurrency: z.number().int().min(1).max(32).nullable().optional(),
    })
    .strict(),
  'models.enable': z.object({ bundleId }).strict(),
  'models.install': z.object({ bundleId, confirmBytes: z.number().int().min(0).optional(), commandId: id.optional() }).strict(),
  'models.cancelInstall': z.object({ bundleId, discard: z.boolean().optional() }).strict(),
  'models.remove': z.object({ bundleId }).strict(),
  'models.repair': z.object({ bundleId, confirmBytes: z.number().int().min(0).optional(), commandId: id.optional() }).strict(),
  'models.test': z.object({ bundleId, commandId: id.optional() }).strict(),
  'models.getDir': empty,
  'models.inspectDir': z.object({ path: absolutePath.nullable() }).strict(),
  'models.setDir': z.object({ path: absolutePath.nullable(), mode: z.enum(['move', 'switch']), commandId: id.optional() }).strict(),
  'models.capabilities': empty,
  'models.configure': z
    .object({
      providerId,
      enabled: z.boolean().optional(),
      credential: credential.nullable().optional(),
      endpoint: endpoint.nullable().optional(),
      models: z.array(declaredModel).max(50).optional(),
      label: z.string().trim().min(1).max(100).optional(),
      verify: z.boolean().optional(),
    })
    .strict(),
  'models.removeProvider': z.object({ providerId }).strict(),
  'models.addAccount': z
    .object({
      providerId,
      credential,
      label: accountLabel.optional(),
      region: accountRegion.optional(),
      endpoint: endpoint.optional(),
      verify: z.boolean().optional(),
    })
    .strict(),
  'models.updateAccount': z
    .object({
      providerId,
      accountId,
      label: accountLabel.nullable().optional(),
      credential: credential.optional(),
      enabled: z.boolean().optional(),
      region: accountRegion.nullable().optional(),
      endpoint: endpoint.nullable().optional(),
      verify: z.boolean().optional(),
    })
    .strict(),
  'models.removeAccount': z.object({ providerId, accountId }).strict(),
  'models.arrangeAccounts': z.object({ providerId, order: z.array(accountId).min(1).max(50) }).strict(),
  'models.usage': z.object({ period: z.enum(USAGE_PERIODS), providerId: providerId.optional() }).strict(),
  'models.setDefault': z.object({ capability: serviceCapability, providerId: providerId.nullable(), modelId: modelId.optional() }).strict(),
  'jobs.inspect': z.object({ jobId: id }).strict(),
  'jobs.cancel': z.object({ jobId: id }).strict(),
  'jobs.list': z.object({ videoId: id.optional(), children: z.boolean().optional() }).strict(),
  'jobs.resources': z.object({}).strict(),
  'jobs.reconcile': z.object({ jobId: id, decision: z.enum(['retry', 'discard', 'apply']) }).strict(),
  'exports.create': z
    .object({ videoId: id, settings: exportSettings, destination: exportDestination.optional(), commandId: id.optional() })
    .strict(),
  'exports.get': z.object({ jobId: id }).strict(),
  'exports.list': z.object({ videoId: id.optional() }).strict(),
  'exports.renderText': z.object({ videoId: id, settings: textExportSettings }).strict(),
  'pipelines.list': z.object({}).strict(),
  'pipelines.start': z
    .object({ pipeline: z.string().min(1).max(64), params: z.record(z.string(), z.unknown()), commandId: id.optional() })
    .strict(),
  'pipelines.retry': z.object({ jobId: id }).strict(),
  'catalog.list': z.object({}).strict(),
  'catalog.agentSkill': z.object({}).strict(),
  // `project` 只收绝对路径：`--project` 的相对路径由 CLI 按 cwd 解析好再发。
  'catalog.call': z
    .object({ name: z.string().min(1).max(100), args: z.unknown(), cwd: absolutePath, project: absolutePath.nullable().optional() })
    .strict(),
  'artifacts.openHandle': z.object({ artifactId: z.string().regex(/^sha256:[0-9a-f]{64}$/) }).strict(),
  'library.list': z.object({ library: libraryName.optional(), kind: z.string().min(1).max(50).optional() }).strict(),
  'library.get': libraryRef,
  'library.put': z.discriminatedUnion('library', [
    z.object({ library: z.literal('glossaries'), content: glossaryContent, ...libraryPutCommon }).strict(),
    z.object({ library: z.literal('voices'), content: voiceContentInput, ...libraryPutCommon }).strict(),
    z.object({ library: z.literal('brand'), content: brandContentInput, ...libraryPutCommon }).strict(),
  ]),
  'library.remove': z.object({ library: libraryName, id: libraryId }).strict(),
  'library.import': z.object({ path: filePath, commandId: id.optional() }).strict(),
  'library.export': z.object({ entry: libraryRef, path: filePath }).strict(),
  'library.applyToVideo': z
    .object({
      videoId: id,
      entry: libraryRef,
      commandId: id,
      expectedRevision: revision.optional(),
      name: z.string().trim().min(1).max(200).optional(),
      captionItemIds: z.array(id).min(1).max(1000).optional(),
      sequenceId: id.optional(),
    })
    .strict(),
  'library.getVideoSelection': z.object({ videoId: id }).strict(),
  'library.setVideoSelection': z
    .object({
      videoId: id,
      commandId: id,
      expectedRevision: revision.optional(),
      glossaries: z
        .object({
          transcribe: z.array(libraryId).max(MAX_SELECTED_GLOSSARIES).optional(),
          translate: z.array(libraryId).max(MAX_SELECTED_GLOSSARIES).optional(),
        })
        .strict()
        .optional(),
      speakerVoices: z
        .array(
          z
            .object({
              documentId: id,
              speakerId: z.string().min(1).max(128),
              voice: z.string().trim().min(1).max(256),
              providerId: z.string().min(1).max(100).optional(),
            })
            .strict(),
        )
        .max(MAX_SPEAKER_VOICES)
        .optional(),
    })
    .strict(),
  'library.openHandle': libraryRef,
  'library.createVoiceClone': z
    .object({
      id: libraryId,
      providerId: z.string().min(1).max(100),
      name: z.string().trim().min(1).max(100).optional(),
      commandId: id.optional(),
    })
    .strict(),
  'library.removeVoiceClone': z
    .object({ id: libraryId, providerId: z.string().min(1).max(100), localOnly: z.boolean().optional() })
    .strict(),
  'nodes.share.start': z
    .object({
      // 0 表示由系统挑一个空闲端口（测试与诊断用）。
      port: z.number().int().min(0).max(65_535).optional(),
      name: z.string().trim().min(1).max(63).optional(),
      allowAnySource: z.boolean().optional(),
    })
    .strict(),
  'nodes.share.stop': empty,
  'nodes.share.status': empty,
  'nodes.share.pairingCode': empty,
  'nodes.share.revoke': z.object({ clientId: nodeClientId }).strict(),
  // 认不认识这种能力由节点服务判断（同样是 invalid-request，说明里列出可共享的能力）。
  'nodes.share.setCapability': z.object({ capability: z.string().trim().min(1).max(64), enabled: z.boolean() }).strict(),
  'nodes.discover': z.object({ timeoutMs: z.number().int().min(100).max(10_000).optional() }).strict(),
  'nodes.pair': z
    .object({
      host: z.string().trim().min(1).max(255),
      port: z.number().int().min(1).max(65_535),
      code: z.string().trim().min(1).max(32),
      alias: nodeAlias.optional(),
    })
    .strict(),
  'nodes.list': empty,
  'nodes.remove': z.object({ nodeId: id }).strict(),
  'services.list': empty,
  'services.start': z.object({ serviceId }).strict(),
  'services.stop': z.object({ serviceId }).strict(),
  'services.configure': z
    .object({
      serviceId,
      autostart: z.boolean().optional(),
      // 0 表示由系统挑一个空闲端口（测试与诊断用）。
      port: z.number().int().min(0).max(65_535).optional(),
      level: z.enum(SERVICE_LEVELS).optional(),
      videos: z.union([z.literal('all'), z.object({ ids: z.array(id).max(1000) }).strict()]).optional(),
      routing: z
        .object({ online: z.boolean().optional(), nodes: z.boolean().optional(), agent: z.boolean().optional() })
        .strict()
        .optional(),
      maxConcurrentPerClient: z.number().int().min(1).max(MODEL_API_MAX_CONCURRENT_LIMIT).optional(),
      readOnly: z.boolean().optional(),
      methods: z.array(z.string().max(100).regex(WEB_METHOD_PATTERN)).max(200).nullable().optional(),
    })
    .strict(),
  'services.respondToApproval': z.object({ approvalId: id, decision: z.enum(['allow', 'deny']) }).strict(),
  'services.mcp.createClient': z.object({ name: z.string().trim().min(1).max(100) }).strict(),
  'services.mcp.listClients': empty,
  'services.mcp.revokeClient': z.object({ clientId: id }).strict(),
  'services.mcp.connectionInfo': z.object({ clientId: id.optional() }).strict(),
  'services.modelApi.createClient': z.object({ name: z.string().trim().min(1).max(100) }).strict(),
  'services.modelApi.listClients': empty,
  'services.modelApi.revokeClient': z.object({ clientId: id }).strict(),
  'services.modelApi.connectionInfo': z.object({ clientId: id.optional() }).strict(),
  'services.modelApi.setAlias': z
    .object({
      alias: modelApiAlias,
      capability: onlineCapability,
      providerId: z.string().trim().min(1).max(200),
      modelId: z.string().trim().min(1).max(200).optional(),
    })
    .strict(),
  'services.modelApi.removeAlias': z.object({ alias: modelApiAlias }).strict(),
  'services.web.createAccessLink': z.object({ video: id.optional() }).strict(),
  'services.web.listSessions': empty,
  'services.web.revokeSession': z.object({ sessionId: id }).strict(),
  'settings.get': z.object({ keys: z.array(z.enum(SETTING_KEYS)).max(SETTING_KEYS.length).optional() }).strict(),
  'settings.set': z.object({ values: settingsPatchSchema }).strict(),
  subscribe: z.object({ topic, afterSeq: seq.optional() }),
  unsubscribe: z.object({ topic }),
} satisfies Record<RpcMethod, z.ZodType>;

// ---- 节点协议（节点协议规范 §4、§5）：节点服务校验请求体，发起端也可以拿来自检 ----

/** `POST /v1/pair` 的请求体。 */
export const nodePairRequestSchema = z
  .object({
    code: z.string().max(32),
    clientId: nodeClientId,
    clientName: z.string().trim().min(1).max(100),
  })
  .strict();

/** `POST /v1/jobs` 的请求体（`NodeJobRequest`）。媒体上限与磁盘空间是准入检查，不在这里。 */
export const nodeJobRequestSchema = z
  .object({
    clientJobId: z.string().min(1).max(200),
    kind: z.literal('transcribe'),
    bundleId,
    input: z
      .object({
        contentHash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
        byteLength: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
        mediaType: z.string().regex(/^(audio|video)\/[A-Za-z0-9.+_-]{1,100}$/),
        track: z.number().int().nonnegative().max(64),
        range: z
          .object({ start: tick, end: tick })
          .strict()
          .refine((r) => r.start < r.end, { error: () => V.rangeStartEnd().text })
          .nullable(),
      })
      .strict(),
    options: z
      .object({
        language: languageOption,
        diarize: z.boolean(),
        hint: z.string().max(1200).optional(),
        timescale: z.number().int().positive().max(1_000_000_000),
      })
      .strict(),
  })
  .strict();

export {
  templateManifestSchema,
  parseTemplateManifest,
  templateTranslationSchema,
  parseTemplateTranslation,
  templateSendRefSchema,
  type TemplateManifestResult,
  type TemplateTranslationResult,
} from './template-schemas.ts';
export { skillSendRefSchema } from './skill-schemas.ts';
