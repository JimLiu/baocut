import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { JobRecord } from '@baocut/protocol';
import { SpaceArtifactStore, artifactIdsOf, artifactRefsOf, isFilePipelineJob, spaceJobFacts } from './space-artifacts.ts';

function job(partial: Partial<JobRecord>): JobRecord {
  return {
    jobId: 'job_1',
    kind: 'generateImage',
    state: 'completed',
    phase: 'done',
    progress: null,
    videoId: 'v1',
    assetId: null,
    assetRevision: null,
    contentHash: 'sha256:c',
    providerId: 'openai',
    modelId: 'm',
    bundleId: null,
    inputHash: 'sha256:in',
    submitter: { kind: 'connection', id: 'c1' },
    attempt: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:01.000Z',
    startedAt: '2026-01-01T00:00:00.000Z',
    endedAt: '2026-01-01T00:00:01.000Z',
    error: null,
    result: {
      documentId: null,
      artifactId: 'sha256:a',
      outputs: [
        { artifactId: 'sha256:a', mediaType: 'image/png', byteLength: 4, assetId: null, media: { kind: 'image', width: 2, height: 2 } },
        { artifactId: 'sha256:b', mediaType: 'image/png', byteLength: 4, assetId: null, media: { kind: 'image', width: 2, height: 2 } },
      ],
    },
    warnings: [{ code: 'W', message: '提示词原文不该留下' }],
    ...partial,
  } as JobRecord;
}

describe('Space 的产物记录', () => {
  let dir: string;
  let file: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'space-artifacts-'));
    file = path.join(dir, 'store', 'space-artifacts.json');
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('下载结果保留项目关联，文件路径独立，重读后关联仍在', async () => {
    const record = job({ kind: 'pipeline', videoId: null, pipeline: { name: 'link-import', params: { projectId: 'project-a', cookieBrowser: 'chrome', url: 'https://example.com/private' }, steps: [] } as never });
    record.result!.outputs![0]!.path = '/Users/test/Downloads/result.txt';
    const facts = spaceJobFacts(record)!;
    expect(facts.pipeline).toEqual({ name: 'link-import', params: { projectId: 'project-a' } });
    expect(facts.result!.outputs![0]!.path).toBe('/Users/test/Downloads/result.txt');
    const store = new SpaceArtifactStore(file);
    await store.load();
    await store.put([facts]);
    const reopened = new SpaceArtifactStore(file);
    await reopened.load();
    expect(reopened.list()[0]?.pipeline?.params?.projectId).toBe('project-a');
  });

  it('只给文件的转录：结果有发布的文件时当文件流程留下；给了视频的转录（没有输出）不当', async () => {
    const outputs = [
      { artifactId: 'sha256:t', path: '/Users/test/Downloads/clip.txt', mediaType: 'text/plain', byteLength: 6, assetId: null, media: { kind: 'text', entries: 1, durationSec: 1 } },
      { artifactId: 'sha256:s', path: '/Users/test/Downloads/clip.srt', mediaType: 'application/x-subrip', byteLength: 30, assetId: null, media: { kind: 'text', entries: 1, durationSec: 1 } },
    ];
    const record = job({
      jobId: 'job_tf',
      kind: 'pipeline',
      videoId: null,
      pipeline: { name: 'transcribe', steps: [] } as never,
      result: { documentId: null, artifactId: 'sha256:t', outputs } as never,
    });
    expect(isFilePipelineJob(record)).toBe(true);
    const facts = spaceJobFacts(record)!;
    expect(facts.result!.outputs!.map((o) => o.path)).toEqual(outputs.map((o) => o.path));
    expect(artifactIdsOf(facts)).toEqual(['sha256:t', 'sha256:s']);
    const store = new SpaceArtifactStore(file);
    await store.load();
    await store.put([facts]);
    const reread = new SpaceArtifactStore(file);
    expect(await reread.load()).toEqual({ skipped: 0, quarantined: null });
    expect(reread.get('job_tf')).toEqual(facts);

    expect(isFilePipelineJob({ kind: 'pipeline', pipeline: { name: 'transcribe' }, result: { outputs: [] } })).toBe(false);
    expect(isFilePipelineJob({ kind: 'pipeline', pipeline: { name: 'transcribe' }, result: null })).toBe(false);
  });

  it('只留结束了、有结果、会留下产物的任务，只留派生用的字段', () => {
    const facts = spaceJobFacts(job({}))!;
    expect(facts).toMatchObject({ jobId: 'job_1', kind: 'generateImage', state: 'completed', videoId: 'v1' });
    expect(facts).not.toHaveProperty('warnings');
    expect(facts).not.toHaveProperty('contentHash');
    expect(artifactIdsOf(facts)).toEqual(['sha256:a', 'sha256:b']);
    expect(spaceJobFacts(job({ state: 'running' }))).toBeNull();
    expect(spaceJobFacts(job({ state: 'failed', result: null }))).toBeNull();
    expect(spaceJobFacts(job({ kind: 'transcribe' }))).toBeNull();
  });

  it('新建了视频的流程：只留完成了的 create 与它的 videoId，没有产物；重读时照样认得', async () => {
    const step = (name: string, status: 'completed' | 'failed' | 'skipped', output: Record<string, unknown> | null) => ({
      name,
      label: name,
      status,
      jobId: `job_${name}`,
      attempts: 1,
      output,
    });
    const pipeline = job({
      jobId: 'job_p',
      kind: 'pipeline',
      state: 'failed',
      result: null,
      pipeline: {
        name: 'transcribe',
        steps: [
          step('target', 'skipped', null),
          step('create', 'completed', { videoId: 'vid_new', place: { root: '/p', file: 'x' }, assetId: 'a1' }),
          step('transcribe', 'failed', null),
        ],
      } as unknown as JobRecord['pipeline'],
    });
    const facts = spaceJobFacts(pipeline)!;
    expect(facts).toMatchObject({ jobId: 'job_p', kind: 'pipeline', state: 'failed', result: null });
    expect(facts.pipeline).toEqual({
      name: 'transcribe',
      steps: [{ ...step('create', 'completed', null), output: { videoId: 'vid_new' } }],
    });
    expect(artifactIdsOf(facts)).toEqual([]);
    // 还在跑、没有新建视频的流程不留。
    expect(spaceJobFacts({ ...pipeline, state: 'running' })).toBeNull();
    expect(spaceJobFacts({ ...pipeline, pipeline: { ...pipeline.pipeline!, steps: [step('create', 'skipped', null)] } })).toBeNull();

    const store = new SpaceArtifactStore(file);
    await store.load();
    await store.put([facts]);
    const reread = new SpaceArtifactStore(file);
    expect(await reread.load()).toEqual({ skipped: 0, quarantined: null });
    expect(reread.get('job_p')).toEqual(facts);
  });

  it('写入后重读一致；读坏的行跳过；整个文件读不了时改名留存，从空的开始', async () => {
    const store = new SpaceArtifactStore(file);
    expect(await store.load()).toEqual({ skipped: 0, quarantined: null });
    await store.put([spaceJobFacts(job({}))!, spaceJobFacts(job({ jobId: 'job_2' }))!]);
    const again = new SpaceArtifactStore(file);
    await again.load();
    expect(again.list().map((f) => f.jobId)).toEqual(['job_1', 'job_2']);
    await again.remove(['job_1']);
    expect(again.get('job_1')).toBeNull();

    const data = JSON.parse(await fs.readFile(file, 'utf8')) as { jobs: unknown[] };
    data.jobs.push({ jobId: 'bad' }, 'x');
    await fs.writeFile(file, JSON.stringify(data));
    const partial = new SpaceArtifactStore(file);
    expect(await partial.load()).toEqual({ skipped: 2, quarantined: null });
    expect(partial.list().map((f) => f.jobId)).toEqual(['job_2']);

    await fs.writeFile(file, '{ 坏了');
    const broken = new SpaceArtifactStore(file);
    const loaded = await broken.load();
    expect(loaded.quarantined).toMatch(/space-artifacts\.json\.corrupt-\d+$/);
    expect(broken.list()).toEqual([]);
    await expect(fs.readFile(loaded.quarantined!, 'utf8')).resolves.toBe('{ 坏了');
  });
  it('只为清扫保留的引用：结果、步骤与应用里的产物 id，不含输入摘要；重读后还在，清扫起点落盘且不后移', async () => {
    const a = `sha256:${'1'.repeat(64)}`;
    const b = `sha256:${'2'.repeat(64)}`;
    const dub = job({
      jobId: 'job_dub',
      kind: 'pipeline',
      inputHash: `sha256:${'9'.repeat(64)}`,
      result: { documentId: null, artifactId: a },
      pipeline: { name: 'dub', steps: [{ name: 'synthesize', status: 'completed', output: { units: { u1: { artifactId: b } } } }] } as unknown as JobRecord['pipeline'],
    });
    expect(artifactRefsOf(dub)).toEqual({ jobId: 'job_dub', kind: 'pipeline', videoId: 'v1', endedAt: dub.endedAt, artifactIds: [a, b] });
    expect(artifactRefsOf(job({ state: 'running' }))).toBeNull();
    expect(artifactRefsOf(job({ result: null }))).toBeNull();

    const store = new SpaceArtifactStore(file);
    await store.load();
    const since = store.sweepSince();
    await store.putReferences([artifactRefsOf(dub)!]);
    const again = new SpaceArtifactStore(file);
    await again.load();
    expect(again.references()).toEqual([artifactRefsOf(dub)]);
    expect(again.sweepSince()).toBe(since);
    expect([...(await again.referencedArtifactIds())].sort()).toEqual([a, b]);
  });

  it('读坏了改名留存的文件里的产物 id 照样算引用：下次启动不误删', async () => {
    const lost = `sha256:${'3'.repeat(64)}`;
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, `{ "jobs": [{ "result": { "artifactId": "${lost}" } }`);
    const store = new SpaceArtifactStore(file);
    const loaded = await store.load();
    expect(loaded.quarantined).toMatch(/\.corrupt-\d+$/);
    expect(store.list()).toEqual([]);
    expect((await store.referencedArtifactIds()).has(lost)).toBe(true);
    // 下次启动：主文件已是新的，留存的文件还在，引用还在。
    const next = new SpaceArtifactStore(file);
    expect((await next.load()).quarantined).toBeNull();
    expect((await next.referencedArtifactIds()).has(lost)).toBe(true);
  });
});
