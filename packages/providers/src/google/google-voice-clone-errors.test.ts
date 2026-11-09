import { describe, expect, it } from 'vitest';
import { classifyGoogleVoiceClone } from './google-voice-clone-errors.ts';

/**
 * Gemini 复刻音色被拒时的归类（架构设计 §6.4「音色克隆的请求」）。原话没有文档，下面的错误体按 Google 错误体的形状
 * （`{ error: { code, message, status, details[] } }`）与文档里的规则编写，每条注明是哪种规则。
 */

const errorInfo = (reason: string, metadata: Record<string, string> = {}) => ({
  '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
  reason,
  domain: 'generativelanguage.googleapis.com',
  metadata: { service: 'generativelanguage.googleapis.com', ...metadata },
});
const badRequest = (field: string, description: string) => ({
  '@type': 'type.googleapis.com/google.rpc.BadRequest',
  fieldViolations: [{ field, description }],
});
const google = (code: number, status: string, message: string, details: unknown[] = []) =>
  JSON.stringify({ error: { code, message, status, ...(details.length > 0 ? { details } : {}) } });

type Expected = string | { code: string; reason: string };
const rejected = (reason: string): Expected => ({ code: 'PROVIDER_REJECTED', reason });

const CASES: Array<[name: string, status: number, body: string, expected: Expected]> = [
  // 说话人核验
  [
    'speaker verification failed',
    400,
    google(400, 'INVALID_ARGUMENT', 'Speaker verification failed: the voice in the consent audio does not match the source audio.'),
    rejected('speaker-mismatch'),
  ],
  [
    'different people',
    400,
    google(400, 'FAILED_PRECONDITION', 'The consent audio and the source audio appear to come from different people.'),
    rejected('speaker-mismatch'),
  ],
  [
    'reason code only',
    400,
    google(400, 'INVALID_ARGUMENT', 'Request contains an invalid argument.', [errorInfo('SPEAKER_MISMATCH')]),
    rejected('speaker-mismatch'),
  ],
  [
    'voice verification reason',
    400,
    google(400, 'FAILED_PRECONDITION', 'Voice replication request failed verification.', [errorInfo('VOICE_VERIFICATION_FAILED')]),
    rejected('speaker-mismatch'),
  ],
  // 授权声明
  [
    'consent statement missing',
    400,
    google(400, 'INVALID_ARGUMENT', 'Consent verification failed: the consent audio does not contain the required consent statement.'),
    rejected('consent-unrecognized'),
  ],
  ['consent verification, no speaker', 400, google(400, 'FAILED_PRECONDITION', 'Consent verification failed.'), rejected('consent-unrecognized')],
  [
    'wrong language',
    400,
    google(400, 'INVALID_ARGUMENT', "The consent statement was not recognized in language 'en-US'."),
    rejected('consent-unrecognized'),
  ],
  [
    'bad language_code',
    400,
    google(400, 'INVALID_ARGUMENT', `Invalid value at 'voice.language_code' (TYPE_STRING), "xx-YY"`, [
      badRequest('voice.language_code', `Invalid value at 'voice.language_code' (TYPE_STRING), "xx-YY"`),
    ]),
    rejected('consent-unrecognized'),
  ],
  ['consent clip too long', 400, google(400, 'INVALID_ARGUMENT', 'Consent audio is too long.'), rejected('consent-unrecognized')],
  // 参考录音的时长
  [
    'source too short',
    400,
    google(400, 'INVALID_ARGUMENT', 'Source audio is too short: expected between 10 and 30 seconds of speech, got 4.2 seconds.'),
    rejected('source-duration'),
  ],
  [
    'source too long (field violation)',
    400,
    google(400, 'INVALID_ARGUMENT', 'Request contains an invalid argument.', [
      badRequest('voice.replicated.source_audio', 'Audio duration must not exceed 30s.'),
    ]),
    rejected('source-duration'),
  ],
  // 合成或水印
  [
    'AI-generated',
    400,
    google(400, 'INVALID_ARGUMENT', 'The source audio appears to be AI-generated and cannot be used for voice replication.'),
    rejected('synthetic-audio'),
  ],
  ['SynthID', 400, google(400, 'FAILED_PRECONDITION', 'SynthID watermark detected in source_audio.'), rejected('synthetic-audio')],
  [
    'C2PA',
    400,
    google(400, 'FAILED_PRECONDITION', 'Audio with C2PA content credentials indicating synthetic origin is not allowed.'),
    rejected('synthetic-audio'),
  ],
  // 音频本身
  ['unsupported mime type', 400, google(400, 'INVALID_ARGUMENT', 'Unsupported MIME type: audio/ogg'), rejected('audio-invalid')],
  ['mime_type field', 400, google(400, 'INVALID_ARGUMENT', "Invalid value at 'voice.replicated.consent_audio.mime_type'"), rejected('audio-invalid')],
  ['undecodable', 400, google(400, 'INVALID_ARGUMENT', 'Unable to decode consent_audio.'), rejected('audio-invalid')],
  [
    'payload too large',
    400,
    google(400, 'INVALID_ARGUMENT', 'Request payload size exceeds the limit: 20971520 bytes.'),
    rejected('audio-invalid'),
  ],
  ['413 from the front end', 413, '<html><title>413 Request Entity Too Large</title></html>', rejected('audio-invalid')],
  // 音色个数
  [
    'maximum number of voices (429)',
    429,
    google(429, 'RESOURCE_EXHAUSTED', 'You have reached the maximum number of voices (200) for this project. Delete unused voices and try again.'),
    rejected('voice-limit'),
  ],
  ['voice limit (400)', 400, google(400, 'FAILED_PRECONDITION', 'Voice limit reached for project.'), rejected('voice-limit')],
  [
    'stored voices quota',
    429,
    google(
      429,
      'RESOURCE_EXHAUSTED',
      "Quota exceeded for quota metric 'Stored voices' and limit 'Stored voices per project' of service 'generativelanguage.googleapis.com' for consumer 'project_number:123'.",
      [errorInfo('RATE_LIMIT_EXCEEDED', { quota_metric: 'generativelanguage.googleapis.com/stored_voices', quota_limit: 'StoredVoicesPerProject' })],
    ),
    rejected('voice-limit'),
  ],
  // 用不了这项功能
  [
    'paid tier only',
    403,
    google(403, 'PERMISSION_DENIED', 'Voice replication is only available for projects on a paid tier.'),
    rejected('feature-unavailable'),
  ],
  [
    'free tier not in country',
    400,
    google(
      400,
      'FAILED_PRECONDITION',
      'Gemini API free tier is not available in your country. Please enable billing on your project in Google AI Studio.',
    ),
    rejected('feature-unavailable'),
  ],
  ['user location', 400, google(400, 'FAILED_PRECONDITION', 'User location is not supported for the API use.'), rejected('feature-unavailable')],
  ['caller lacks permission', 403, google(403, 'PERMISSION_DENIED', 'The caller does not have permission'), rejected('feature-unavailable')],
  [
    'free tier quota is zero',
    429,
    google(
      429,
      'RESOURCE_EXHAUSTED',
      'You exceeded your current quota, please check your plan and billing details. For more information on this error, head to: https://ai.google.dev/gemini-api/docs/rate-limits.',
      [
        {
          '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
          violations: [{ quotaMetric: 'generativelanguage.googleapis.com/voice_replication_free_tier_requests', quotaId: 'VoiceReplicationRequestsPerDayPerProject-FreeTier', quotaValue: '0' }],
        },
      ],
    ),
    rejected('feature-unavailable'),
  ],
  // 密钥
  [
    'invalid key',
    400,
    google(400, 'INVALID_ARGUMENT', 'API key not valid. Please pass a valid API key.', [errorInfo('API_KEY_INVALID')]),
    'PROVIDER_AUTH_FAILED',
  ],
  ['expired key', 400, google(400, 'INVALID_ARGUMENT', 'API key expired. Please renew the API key.', [errorInfo('API_KEY_INVALID')]), 'PROVIDER_AUTH_FAILED'],
  [
    'API disabled for the project',
    403,
    google(403, 'PERMISSION_DENIED', 'Generative Language API has not been used in project 123 before or it is disabled.', [errorInfo('SERVICE_DISABLED')]),
    'PROVIDER_AUTH_FAILED',
  ],
  ['401', 401, google(401, 'UNAUTHENTICATED', 'Request had invalid authentication credentials.'), 'PROVIDER_AUTH_FAILED'],
  // 限速
  [
    'rate limit on the voices endpoint',
    429,
    google(
      429,
      'RESOURCE_EXHAUSTED',
      'Quota exceeded for metric: generativelanguage.googleapis.com/voice_replication_requests, limit: 10 per minute. Please retry in 21s.',
    ),
    'PROVIDER_QUOTA_EXCEEDED',
  ],
  ['plain resource exhausted', 429, google(429, 'RESOURCE_EXHAUSTED', 'Resource has been exhausted (e.g. check quota).'), 'PROVIDER_QUOTA_EXCEEDED'],
  // 认不出
  [
    'unknown field',
    400,
    google(400, 'INVALID_ARGUMENT', `Invalid JSON payload received. Unknown name "stor" at 'voice': Cannot find field.`),
    'PROVIDER_REJECTED',
  ],
  ['generic precondition', 400, google(400, 'FAILED_PRECONDITION', 'Precondition check failed.'), 'PROVIDER_REJECTED'],
  ['not found', 404, google(404, 'NOT_FOUND', 'Method not found.'), 'PROVIDER_REJECTED'],
  ['not JSON', 400, 'Bad Request', 'PROVIDER_REJECTED'],
];

describe('classifyGoogleVoiceClone', () => {
  it.each(CASES)('%s', (_name, status, body, expected) => {
    expect(classifyGoogleVoiceClone(status, body)).toEqual(expected);
  });
});
