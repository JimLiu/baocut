import { defineCatalog } from '../../message-ref.ts';
import { zhHans } from './protocol-validation.zh-Hans.ts';
import { zhHant } from './protocol-validation.zh-Hant.ts';
import { ja } from './protocol-validation.ja.ts';
import { ko } from './protocol-validation.ko.ts';
import { es } from './protocol-validation.es.ts';
import { fr } from './protocol-validation.fr.ts';
import { de } from './protocol-validation.de.ts';
import { nl } from './protocol-validation.nl.ts';
import { ptBR } from './protocol-validation.pt-BR.ts';
import { it } from './protocol-validation.it.ts';
import { ru } from './protocol-validation.ru.ts';
import { pl } from './protocol-validation.pl.ts';
import { tr } from './protocol-validation.tr.ts';
import { vi } from './protocol-validation.vi.ts';

/** 入站参数与清单校验的说明（zod schema 的 issue、模板与 skill 的路径检查、JSON Schema 编译）。 */
const en = {
  /** 把几项连成一串时的分隔符。 */
  listSeparator: ', ',
  notEmpty: "Can't be empty",
  noSurroundingSpace: "Can't start or end with whitespace",
  absolutePath: 'Must be an absolute path',
  noNul: "Can't contain NUL",
  languageTagInvalid: 'Not a valid BCP 47 language tag',
  amountInvalid: 'Amount must be a non-negative decimal with at most 6 decimal places',
  dataKindsDuplicate: "Data kinds can't repeat",
  timeRangeOrder: 'timeRange.fromSeconds must be less than toSeconds',
  nameChars: 'name may contain only letters, digits, underscores, and hyphens (up to 64)',
  secretChars: 'The key may contain only visible ASCII characters without whitespace',
  accountIdChars: 'Account ID may contain only lowercase letters, digits, and hyphens',
  regionChars: 'region may contain only lowercase letters, digits, and hyphens',
  endpointInvalid: 'Endpoint must be an http(s) URL without a username, query, or fragment',
  imageSize: 'Size must be WIDTHxHEIGHT',
  imageSizeOrRatio: 'Size must be WIDTHxHEIGHT or W:H',
  libraryIdChars: 'Entry ID may contain only letters, digits, underscores, and hyphens',
  colorHex: 'Color must be #RRGGBB or #RRGGBBAA',
  driverIdStart: 'Agent ID must start with a lowercase letter and contain only lowercase letters, digits, and hyphens',
  driverIdBuiltin: 'This ID belongs to a built-in Agent; choose another',
  envNameChars: "Environment variable names use letters, digits, and underscores, and can't start with a digit",
  driverIdChars: 'Agent ID may contain only lowercase letters, digits, and hyphens',
  effortChars: 'Reasoning effort may contain only lowercase letters, digits, and hyphens',
  downloadEndpoint: 'Download source must be a base URL starting with http(s)://, without a username, password, query, or fragment',
  fontEndpoint: 'Font download source must be a base URL starting with https://, without a username, password, query, or fragment',
  rangeOrder: 'The end of the range must be greater than the start',
  rangeOrRanges: 'Give only one of `range` and `ranges`',
  wavNoBitrate: 'WAV has no bitrate',
  crfOrBitrate: 'Give only one of `crf` and `bitrateKbps`',
  codecFormat: 'MP4 uses h264 or hevc; WebM uses vp9',
  fpsMax: 'Frame rate is at most 240',
  fileNameNoFolder: "File name can't include folders",
  projectOrConversation: 'Give exactly one of projectId and conversationId',
  descriptionEmpty: "Description can't be empty",
  speechTextEmpty: "Text can't be empty; when material is given, pass an empty string for text",
  voiceOneOf: 'Give only one of voice, reference, and voiceDescription',
  promptEmpty: "Prompt can't be empty",
  textMessagesEmpty: 'At least one non-empty user or assistant message is required',
  rangeStartEnd: 'range.start must be less than range.end',
  toolNameChars: 'Tool names may contain only lowercase letters, digits, and hyphens',
  toolIdChars: 'Tool ID may contain only lowercase letters, digits, and hyphens',
  searchNeedsQuery: 'Give a search term or a speaker',
  skillIdChars: 'Skill ID may contain only lowercase letters, digits, and single hyphens',
  pathEmpty: 'Path is empty',
  pathTooLong: 'Path is too long',
  pathBadChars: 'Path contains a backslash or control characters',
  pathBadSegments: "Path can't contain empty segments, . or ..",
  skillPathRelative: 'Path must be relative to the skill folder',
  templatePathRelative: 'Path must be relative to the template folder',
  templateRootFile: (p: { stem: string; extensions: string }) => `Must be ${p.stem}.{${p.extensions}} in the template folder`,
  templateAssetsDir: (p: { dir: string }) => `Assets must be under ${p.dir}/`,
  templateAssetExtension: (p: { type: string; extensions: string }) => `${p.type} assets must use ${p.extensions}`,
  dateFormat: 'Write dates as YYYY-MM-DD',
  dateInvalid: 'Not a valid date',
  materialUrlHttps: 'Material URLs must be https links',
  semver: 'Version must be semver, e.g. 1.0.0',
  engineLowerId: 'Write the Agent as a lowercase ID, e.g. codex',
  ratioFormat: 'Write the aspect ratio as W:H',
  capabilitiesDuplicate: 'Duplicate capabilities',
  outputMeasured: 'When there is an export, give its measured aspect ratio and duration',
  templateIdKebab: 'Template ID must be kebab-case',
  languageTagExample: 'Language tag must be BCP 47, e.g. zh-CN',
  licenseSpdx: 'License must be an SPDX identifier',
  coverNeedsToneFigure: 'Without a cover image, give tone and figure',
  previewNeedsBeats: 'Without a preview video, give beats',
  sceneTemplateRequired: 'Required for scene templates',
  tagsDuplicate: 'Duplicate tags',
  assetPathsDuplicate: 'Duplicate asset paths',
  unknownSchema: (p: { schema: string }) => `Unknown schema: ${p.schema}`,
  idFolderMismatch: (p: { id: string; dir: string }) => `id: ${p.id} doesn't match the folder name ${p.dir}`,
  jsonSchemaNotObject: 'schema must be an object',
  jsonSchemaTooLarge: (p: { max: number }) => `schema is larger than ${p.max} bytes`,
  jsonSchemaRootType: "schema root must be type: 'object'",
  jsonSchemaInvalid: (p: { error: string }) => `Invalid schema: ${p.error}`,
  jsonSchemaIssue: (p: { path: string; message: string }) => `${p.path}: ${p.message}`,
  jsonSchemaRoot: '(root)',
  amountInvalidValue: (p: { amount: string }) => `Amount must be a non-negative decimal with at most 6 decimal places: ${p.amount}`,
  templateFieldLabelChars: "Field labels can't contain {, } or line breaks",
  templateFieldLabelsDuplicate: "Duplicate field labels",
  templateSkillsDuplicate: "Duplicate skills",
  exampleTemplateNoBrief: "Showcase examples don't take a brief; write placeholders in prompt.md",
  templateSlotUndeclared: (p: { label: string }) => `{{${p.label}}} isn't declared in fields`,
  templateFieldUnused: (p: { label: string }) => `Field "${p.label}" isn't used as {{${p.label}}}`,
  templateSlotUnclosed: "There's a {{ that isn't closed; write placeholders as {{label}}",
  templateScenePromptSlots: "A scene template's prompt.md can't contain {{ placeholders; put them in brief",
  translationFieldsCount: (p: { count: number }) => `Must have as many fields as template.json (${p.count})`,
  translationBeatsCount: (p: { count: number }) => `Must have as many beats as template.json (${p.count})`,
  translationAssetUnknown: (p: { path: string }) => `Not an asset listed in template.json: ${p.path}`,
};

export type ProtocolValidationMessages = typeof en;

export const ProtocolValidation = defineCatalog('protocolValidation', en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
