import { describe, expect, it } from 'vitest';
import { LINK_IMPORT_PIPELINE } from '@baocut/jobs';
import { pipelineNext } from './job-tools.ts';

/** 固定流程完成之后的 next（`jobs_inspect` / `jobs_wait`）：说的要与这次实际做的一致。 */
describe('下载完成的 next', () => {
  it('新建的视频：媒体已放上时间线', () => {
    const next = pipelineNext(LINK_IMPORT_PIPELINE, { createdVideo: true, videoId: 'vid_1', transcribeJobId: null }, 'vid_1')!;
    expect(next).toContain('新建了视频');
    expect(next).toContain('已放上时间线');
    expect(next).not.toContain('已有的视频');
  });

  it('导入到已有的视频（createdVideo 为 false 或旧记录没有它）：不说新建，说明空时间线才放上', () => {
    for (const summary of [{ createdVideo: false, videoId: 'vid_1' }, { videoId: 'vid_1' }, null]) {
      const next = pipelineNext(LINK_IMPORT_PIPELINE, summary, 'vid_1')!;
      expect(next).toContain('导入到已有的视频');
      expect(next).not.toContain('新建');
    }
  });

  it('转写进视频：有 documentId 时指向它；建了字幕层时不再叫去 captions_create', () => {
    const base = { createdVideo: true, videoId: 'vid_1', transcribeJobId: 'job_t' };
    const plain = pipelineNext(LINK_IMPORT_PIPELINE, base, 'vid_1')!;
    expect(plain).toContain('videos_inspect');
    expect(plain).toContain('captions_create');
    const withDocument = pipelineNext(LINK_IMPORT_PIPELINE, { ...base, documentId: 'doc_1', captions: { status: 'disabled' } }, 'vid_1')!;
    expect(withDocument).toContain('summary.documentId');
    expect(withDocument).toContain('captions_create');
    const captioned = pipelineNext(
      LINK_IMPORT_PIPELINE,
      { ...base, documentId: 'doc_1', captions: { status: 'created', documentId: 'doc_c' } },
      'vid_1',
    )!;
    expect(captioned).toContain('字幕层也建好了');
    expect(captioned).not.toContain('captions_create');
  });

  it('只下载：不导入视频', () => {
    expect(pipelineNext(LINK_IMPORT_PIPELINE, { createdVideo: false, videoId: null }, null)).toContain('没有导入视频');
  });
});
