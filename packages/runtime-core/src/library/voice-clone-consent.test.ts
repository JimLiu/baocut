import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { JobManager, TaskRun, TaskSubmission } from '@baocut/jobs';
import { RpcError, type Id, type JobSubmitter } from '@baocut/protocol';
import type { VoiceCloner } from '@baocut/providers';
import { LibraryStore } from '@baocut/runtime-storage/library';
import type { GrantService } from '../grants/grant-service.ts';
import { VoiceCloneService } from './voice-clone-service.ts';

/**
 * 要求说话人本人念授权声明的 Provider（`requiresConsentClip`，架构设计 §5.9）：没有授权声明录音时 `library.createVoiceClone`
 * 在提交前以 `VOICE_CONSENT_CLIP_REQUIRED` 拒绝；有时录音随克隆一起交给适配器。不要求的 Provider 不拿到录音。
 * 任务、授权与 Provider 都是假的，只看克隆服务自己的判断。
 */

const wav = (fill: number) => Buffer.concat([Buffer.from('RIFF\0\0\0\0WAVEfmt ', 'latin1'), Buffer.alloc(64, fill)]);
const user: JobSubmitter = { kind: 'connection', id: 'conn_1' };

describe('克隆要求授权声明录音的 Provider', () => {
  let dir: string;
  let store: LibraryStore;
  let submitted: TaskSubmission[];
  let created: Parameters<VoiceCloner['create']>[0][];

  const cloner = (requiresConsentClip: boolean): VoiceCloner => ({
    providerId: 'consent-provider',
    label: 'Consent Provider',
    version: 'test/1',
    available: () => true,
    requiresConsentClip,
    create: async (input) => {
      created.push(input);
      return { voiceId: `clone-${created.length}` };
    },
    remove: async () => 'deleted',
  });

  const service = (requiresConsentClip: boolean) =>
    new VoiceCloneService({
      store,
      jobs: {
        list: () => [],
        submitTask: async (submission: TaskSubmission) => {
          submitted.push(submission);
          return { jobId: `job-${submitted.length}` as Id };
        },
        artifacts: { put: async () => ({ artifactId: `sha256:${'a'.repeat(64)}` }) },
      } as unknown as JobManager,
      grants: {
        plan: () => ({ status: 'none' }),
        ensureDefault: () => undefined,
        begin: async () => () => undefined,
      } as unknown as GrantService,
      cloner: () => cloner(requiresConsentClip),
      // 这个 Provider 没有公开参考录音的时长范围：录音原样交出，不转 WAV。
      ffmpeg: async () => {
        throw new Error('ffmpeg is not used without sourceSeconds');
      },
      log: { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined } as never,
    });

  const run = (): TaskRun => ({
    jobId: 'job-run' as Id,
    staging: dir,
    signal: new AbortController().signal,
    phase: () => undefined,
    warn: () => undefined,
    command: () => undefined,
  });

  const content = {
    name: '我的声音',
    language: 'en-US',
    transcript: 'hello',
    origin: 'recorded' as const,
    consent: { declared: true, statement: 'mine' },
  };

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-voice-clone-consent-'));
    store = await LibraryStore.open({ dir: path.join(dir, 'library'), validateAudio: async () => ({ durationSec: 6 }) });
    submitted = [];
    created = [];
  });

  afterEach(async () => {
    await store.idle();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('没有授权声明录音时拒绝，不建任务', async () => {
    const { entry } = await store.put({ library: 'voices', content, file: { bytes: wav(1), fileName: 'ref.wav' } });
    const error = await service(true)
      .create({ id: entry.id, providerId: 'consent-provider' }, user)
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(error).toBeInstanceOf(RpcError);
    expect((error as RpcError).code).toBe('conflict');
    expect((error as RpcError).details).toMatchObject({ code: 'VOICE_CONSENT_CLIP_REQUIRED', providerId: 'consent-provider', id: entry.id });
    expect(submitted).toHaveLength(0);
    // 不要求的 Provider 照常提交。
    await service(false).create({ id: entry.id, providerId: 'consent-provider' }, user);
    expect(submitted).toHaveLength(1);
  });

  it('有录音时随克隆交给适配器；不要求的 Provider 拿不到录音', async () => {
    const { entry } = await store.put({
      library: 'voices',
      content: { ...content, consentClip: { language: 'en-US' } },
      file: { bytes: wav(1), fileName: 'ref.wav' },
      consentFile: { bytes: wav(2), fileName: 'consent.wav' },
    });
    await service(true).create({ id: entry.id, providerId: 'consent-provider' }, user);
    expect(submitted).toHaveLength(1);
    await submitted[0]!.run(run());
    expect(created[0]!.consentClip).toMatchObject({ fileName: 'consent.wav', mediaType: 'audio/wav', language: 'en-US', text: null });
    expect(await fs.readFile(created[0]!.consentClip!.file)).toEqual(wav(2));

    await store.removeClone(entry.id, 'consent-provider');
    await service(false).create({ id: entry.id, providerId: 'consent-provider' }, user);
    await submitted[1]!.run(run());
    expect(created[1]!.consentClip).toBeUndefined();
  });
});
