import { defineCatalog } from '../../message-ref.ts';
import { zhHans } from './rc-web.zh-Hans.ts';
import { zhHant } from './rc-web.zh-Hant.ts';
import { ja } from './rc-web.ja.ts';
import { ko } from './rc-web.ko.ts';
import { es } from './rc-web.es.ts';
import { fr } from './rc-web.fr.ts';
import { de } from './rc-web.de.ts';
import { nl } from './rc-web.nl.ts';
import { ptBR } from './rc-web.pt-BR.ts';
import { it } from './rc-web.it.ts';
import { ru } from './rc-web.ru.ts';
import { pl } from './rc-web.pl.ts';
import { tr } from './rc-web.tr.ts';
import { vi } from './rc-web.vi.ts';

/** 网页服务与上传（services/web-*、multipart-upload、attachments）的拒绝与错误。英文是键与类型的来源，译文在 `rc-web.<语言>.ts`。 */
const en = {
  invalidAccessPath: "The access link path must start with / and contain no #",
  videoTargetNotFound: (p: { videoId: string }) => `Video "${p.videoId}" not found: use a videoId from videos list`,

  // Web 服务（web-service）。
  serviceLabel: 'Web service',
  runtimeNotReady: "Runtime isn't ready yet",
  clientNotBuilt:
    "The web client isn't built yet: run npm run build:web in the repository first (or point BAOCUT_WEB_DIST at the build output folder)",
  browserSession: 'Browser session',
  noLevelOrScope: 'The web service has no access level or video scope: use readOnly and methods to restrict what the browser can do',
  allowlistTooWide: (p: { methods: string }) => `The web service allowlist can only be narrowed within the default set; not in it: ${p.methods}`,
  listSeparator: ', ',
  notRunning: 'The web service is off: start it first (baocut services start web)',
  sessionNotFound: 'No such browser session',
  sessionExpired: 'The browser session has expired: get a new access link from BaoCut',
  loopbackOnly: 'Only loopback addresses are accepted',
  originRejected: 'Origin not accepted',
  loginFailed: 'Sign-in failed',
  loginRequired: 'Sign in with an access link from BaoCut',
  fileNotFound: 'No such file',
  readFailed: "Couldn't read the file",
  // 浏览器里的方法与路径约束（web-handlers）。
  webReadOnly: (p: { method: string }) => `The web service is read-only right now: ${p.method} can't be called from the browser`,
  methodNotAllowed: (p: { method: string }) => `${p.method} can't be called from the browser: use the BaoCut desktop app or CLI`,
  toolMethodNotAllowed: (p: { method: string }) =>
    `${p.method} can't be called from the browser: use this tool in the BaoCut desktop app or CLI`,
  topicNotAllowed: (p: { topic: string }) => `Can't subscribe to ${p.topic} from the browser`,
  projectNotRegistered:
    'The browser can only open registered projects or create new ones in the default projects folder: open other folders in the BaoCut desktop app',
  externalToolUnavailable: (p: { tool: string }) => `External tool ${p.tool} is unavailable right now: fix it in the BaoCut desktop app`,
  saveDirOutsideProject: 'The browser can only save results into registered project folders',
  saveLocationOutsideProject:
    "The save location isn't inside a registered project folder, so the browser can't get results written there: use this in the BaoCut desktop app, or change Settings › Save location to a project folder",
  projectNotFound: "The project doesn't exist",
  fileMissing: "The file doesn't exist",
  importOutsideProject: 'The browser can only add files from the project folder',
  packageNotFound: "The portable package doesn't exist",
  packageOutsideProject: 'The browser can only open portable packages in the project folder',
  videoNotOpen: "The video isn't open",
  videoProjectDirMissing: "The video's project folder doesn't exist",
  videoProjectMissing: "The video's project doesn't exist",
  operationOutsideProject: (p: { ordinal: number }) =>
    `Operation ${p.ordinal}: the browser can only use files in the video's project folder`,
  exportOutsideProject:
    "The browser can only export to folders inside the video's project folder (not the video folder or .bcut)",
  exportDirMissing: "The export folder doesn't exist",
  exportDirRecovery: 'Choose a folder that already exists',
  // 登录页（web-static）。
  loginTitle: 'Sign in to BaoCut',
  loginInstructions: (p: { launch: string; open: string }) =>
    `Run ${p.launch} in a terminal and paste the access code it prints below, or open the access link printed by ${p.open}.`,
  loginCodeOnce: 'An access code works once and expires after two minutes; get a new one if it was used or has expired.',
  accessCode: 'Access code',
  signIn: 'Sign in',
  signingIn: 'Signing in…',
  codeRejected: 'This access code is wrong, already used, or expired: run baocut web open in a terminal to get a new one.',
  cannotReach: "Can't reach BaoCut: make sure BaoCut is still running and the web service hasn't stopped.",
  codeMalformed: "This access code isn't in the right format: paste the string printed by baocut web open in the terminal.",
  // multipart 请求体（multipart-upload）。
  fieldTooLong: (p: { field: string }) => `Field ${p.field} is too long`,
  noNewlineAfterBoundary: 'No line break after the boundary',
  junkAfterBoundary: 'Extra content after the boundary',
  partHeaderTooLong: 'Part headers are too long',
  partNoDisposition: 'Part has no Content-Disposition: form-data',
  singleFileOnly: 'Only one file can be uploaded',
  tooManyFields: 'Too many fields',
  bodyTruncated: 'The request body ended before the closing boundary',
  requestAborted: 'The request was disconnected before it was fully read',
  partHeaderMalformed: 'Malformed part header',
  // 附件上传（attachments）。
  imageTypeUnsupported: (p: { mimeType: string }) => `Unsupported attachment format: ${p.mimeType}`,
  imageSizeInvalid: "Attachment size must be a positive integer (bytes)",
  imageTooLarge: (p: { mb: number }) => `Attachment is too large: ${p.mb} MB at most`,
  uploadUrlNotFound: "The upload URL doesn't exist",
  uploadUrlUsed: 'This upload URL has already been used',
  uploadUrlExpired: 'The upload URL has expired: register the upload again',
  contentTypeMustBe: (p: { mimeType: string }) => `Content-Type must be ${p.mimeType}`,
  contentLengthRequired: 'Content-Length is required',
  contentLengthMismatch: (p: { size: number }) => `Content-Length must equal the registered size ${p.size}`,
  uploadOverflow: 'Exceeded the registered size',
  uploadInterrupted: 'Upload interrupted',
  uploadIncomplete: (p: { received: number; size: number }) => `Only received ${p.received} bytes; ${p.size} were registered`,
  attachmentNotFoundOrExpired: (p: { id: string }) => `Attachment doesn't exist or has expired: ${p.id}`,
  attachmentNotUploaded: (p: { fileName: string }) => `Attachment "${p.fileName}" hasn't finished uploading`,
  attachmentFileMissing: (p: { fileName: string }) => `The file for attachment "${p.fileName}" is gone`,
  attachmentNotFound: "Attachment doesn't exist",
  fileNameLength: (p: { max: number }) => `File name must be 1 to ${p.max} characters`,
  fileNameInvalid: "File name can't contain path separators or control characters",
};

export type RcWebMessages = typeof en;

export const RcWeb = defineCatalog('rcWeb', en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
