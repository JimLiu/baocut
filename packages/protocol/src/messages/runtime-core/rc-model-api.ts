import { defineCatalog } from '../../message-ref.ts';
import { zhHans } from './rc-model-api.zh-Hans.ts';
import { zhHant } from './rc-model-api.zh-Hant.ts';
import { ja } from './rc-model-api.ja.ts';
import { ko } from './rc-model-api.ko.ts';
import { es } from './rc-model-api.es.ts';
import { fr } from './rc-model-api.fr.ts';
import { de } from './rc-model-api.de.ts';
import { nl } from './rc-model-api.nl.ts';
import { ptBR } from './rc-model-api.pt-BR.ts';
import { it } from './rc-model-api.it.ts';
import { ru } from './rc-model-api.ru.ts';
import { pl } from './rc-model-api.pl.ts';
import { tr } from './rc-model-api.tr.ts';
import { vi } from './rc-model-api.vi.ts';

/**
 * 模型接口服务（services/model-api-*）的错误。英文是键与类型的来源，译文在 `rc-model-api.<语言>.ts`。
 * 错误体（OpenAI 的 `{ error: { message } }`）只带当前语言的文字，没有引用字段。
 */
const en = {
  serviceLabel: 'Model API service',
  notRunning: "The model API service is off: start it first (baocut services start model-api), or clients can't connect.",
  aliasNotFound: (p: { alias: string }) => `No alias "${p.alias}"`,
  internalError: 'Internal error',
  jobNotCompleted: "The task didn't finish",
  jobCancelled: 'The task was cancelled in BaoCut',
  hostNotAllowed: 'Host is not a loopback address',
  originNotAllowed: "Requests from web pages aren't accepted",
  authRequired: 'Missing or invalid token: use Authorization: Bearer <token> (create a client for this app in BaoCut)',
  methodNotAllowed: (p: { path: string; method: string }) => `${p.path} only accepts ${p.method}`,
  endpointNotFound: (p: { path: string }) => `No such endpoint: ${p.path}`,
  modelNotFound: (p: { model: string }) => `No model "${p.model}": GET /v1/models lists the available models`,
  readOnly: 'This service is query-only',
  readOnlyHint: 'This service is query-only (GET /v1/models): in BaoCut, change the model API service level to ask or auto',
  tooManyRequests: (p: { limit: number }) =>
    `This client already has ${p.limit} ${p.limit === 1 ? 'request' : 'requests'} in flight: wait for them to finish before sending more`,
  multipartRequired: 'The request body must be multipart/form-data (fields file and model)',
  uploadTooLarge: (p: { limit: number }) => `The upload exceeds the limit (${p.limit} bytes)`,
  multipartInvalid: (p: { reason: string }) => `Malformed multipart body: ${p.reason}`,
  fileFieldMissing: 'Missing file field file',
  fileEmpty: 'The uploaded file is empty',
  bodyTooLarge: (p: { limit: number }) => `The request body exceeds the limit (${p.limit} bytes)`,
  invalidJson: 'The request body is not valid JSON',
  transcriptMissing: 'The transcription output is missing',
  speechMissing: 'The synthesized audio is missing',
  imageMissing: 'The generated image is missing',
  textMissing: 'The generated text is missing',
  // 审批摘要（服务审批里给用户看）。
  summaryTranscribe: (p: { size: string; model: string }) => `Transcribe ${p.size} of audio, model ${p.model}`,
  summarySpeech: (p: { model: string; voice: string | null; chars: number }) =>
    `Synthesize speech, model ${p.model}${p.voice ? `, voice ${p.voice}` : ''}, ${p.chars} ${p.chars === 1 ? 'character' : 'characters'}`,
  summaryImages: (p: { count: number; model: string; promptChars: number }) =>
    `Generate ${p.count} ${p.count === 1 ? 'image' : 'images'}, model ${p.model}, ${p.promptChars}-character prompt`,
  summaryChat: (p: { model: string; messages: number; chars: number; structured: boolean }) =>
    `Text generation, model ${p.model}, ${p.messages} ${p.messages === 1 ? 'message' : 'messages'}, ${p.chars} ${p.chars === 1 ? 'character' : 'characters'}${p.structured ? ', structured output' : ''}`,
  defaultModel: 'default model',
  modelWithCanonical: (p: { name: string; canonical: string }) => `${p.name} (${p.canonical})`,
  grantPurpose: (p: { endpoint: string }) => `Model API service: ${p.endpoint}`,
  grantRequiredAsk: (p: { reason: string }) => `${p.reason}: ask the user to issue a grant in BaoCut`,
  approvalDenied: 'The user denied this request in BaoCut',
  approvalTimeout:
    "The user didn't confirm this request in time, so it was treated as denied: ask the user to watch for the confirmation in BaoCut and try again",
  approvalCancelled: 'This request was cancelled before it was confirmed (the service stopped)',
  // 请求体字段检查（model-api-openai）。
  fieldMissing: (p: { key: string }) => `Missing ${p.key}`,
  fieldNotString: (p: { key: string }) => `${p.key} must be a string`,
  fieldEmpty: (p: { key: string }) => `${p.key} can't be empty`,
  fieldNotNumber: (p: { key: string }) => `${p.key} must be a number`,
  fieldNotInteger: (p: { key: string; min: number }) => `${p.key} must be an integer no less than ${p.min}`,
  bodyNotObject: 'The request body must be a JSON object',
  onlySupports: (p: { field: string; values: string }) => `${p.field} only supports ${p.values}`,
  listSeparator: ', ',
  speechStreamUnsupported: 'Streaming speech is not supported (stream_format can only be audio)',
  libraryVoiceUnsupported: "The model API service can't use voices from the user library (library:<id>); use the provider's voice ID",
  imageUrlUnsupported: "response_format only supports b64_json: this service doesn't provide image URLs; images are returned in the response",
  imageStreamUnsupported: 'Streaming images is not supported',
  messagesNotArray: 'messages must be a non-empty array',
  textOnlyChat: (p: { key: string }) => `${p.key} is not supported: this service only offers text-only chat`,
  nOnlyOne: 'n can only be 1',
  logprobsUnsupported: 'logprobs is not supported',
  streamNotBoolean: 'stream must be a boolean',
  messageNotObject: (p: { index: number }) => `messages[${p.index}] must be an object`,
  roleUnsupported: (p: { index: number }) => `messages[${p.index}].role only supports system, developer, user, assistant`,
  toolCallsUnsupported: 'Tool calls are not supported',
  textContentOnly: (p: { index: number }) => `messages[${p.index}] only supports text content`,
  contentInvalid: (p: { index: number }) => `messages[${p.index}].content must be a string or an array of text parts`,
  responseFormatNotObject: 'response_format must be an object',
  jsonSchemaInvalid: 'response_format.json_schema.schema must be a JSON Schema object',
  responseFormatTypeUnsupported: 'response_format.type only supports text, json_object, json_schema',
  transcriptionStreamUnsupported: 'Streaming transcription is not supported',
  granularitiesInvalid: 'timestamp_granularities can only be word, segment',
  // 模型路由（model-api-routing）。
  capabilityTranscribe: 'transcription',
  capabilitySynthesizeSpeech: 'speech synthesis',
  capabilityGenerateImage: 'image generation',
  capabilityGenerateText: 'text generation',
  capabilitySeparateAudio: 'vocal separation',
  modelNotFoundFor: (p: { capability: string; model: string }) =>
    `No model "${p.model}" is available for ${p.capability}: GET /v1/models lists the available models`,
  hintEnableOnline: (p: { capability: string }) => `Set up and enable an online service for ${p.capability} in BaoCut first`,
  hintNoLocalModel: (p: { capability: string }) =>
    `There's no local model for ${p.capability}; to pass requests to an online service, turn on online routing for the model API service in BaoCut (baocut services configure model-api --route-online on) and enable an online service`,
  capabilityUnavailable: (p: { capability: string; hint: string }) => `This service can't do ${p.capability} right now: ${p.hint}`,
};

export type RcModelApiMessages = typeof en;

export const RcModelApi = defineCatalog('rcModelApi', en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
