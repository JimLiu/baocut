import { describe, expect, it } from 'vitest';
import { RpcError } from '@baocut/protocol';
import { explainExportError, exportErrorCode } from './export-rejection.ts';

describe('导出被拒', () => {
  it('画不出来的内容逐项列出，成片可以跳过它们重提', () => {
    const error = new RpcError('invalid-request', '有 2 项内容导出画不出来：……', {
      code: 'EXPORT_UNSUPPORTED_CONTENT',
      items: [
        { itemId: 'i1', scope: 'layer', layerKind: 'composition', reason: 'no-prerender', message: '合成「片头」没有预渲染替身' },
        { itemId: 'i2', scope: 'effect', layerKind: 'video', effectId: 'e1', reason: 'unknown-effect', message: '认不出的效果 lut' },
      ],
      remedy: "去掉或替换这些内容；或者用 onUnsupported: 'skip' 跳过它们（每项记一条警告）",
    });
    const problem = explainExportError(error, { kind: 'video', stage: 'rejected' });
    expect(exportErrorCode(error)).toBe('EXPORT_UNSUPPORTED_CONTENT');
    expect(problem.title).toBe('有内容导出时画不出来');
    expect(problem.items).toEqual(['合成「片头」没有预渲染替身', '认不出的效果 lut']);
    expect(problem.hint).toContain('onUnsupported');
    expect(problem.remedy).toEqual({ kind: 'skip-unsupported' });
  });

  it('便携包缺素材：列出名字与原因，可以跳过缺失的重提', () => {
    const problem = explainExportError(
      new RpcError('conflict', '有 1 个素材版本读不到', {
        code: 'ASSET_MISSING',
        items: [{ assetId: 'a1', revision: '2', name: 'b-roll.mov', reason: 'missing', path: '/Volumes/外置/b-roll.mov' }],
        recovery: '重新链接（relinkAsset）或找回文件；也可以用 missingAssets: skip 导出，清单里如实标缺失',
      }),
      { kind: 'portable', stage: 'rejected' },
    );
    expect(problem.items).toEqual(['b-roll.mov · 文件不在']);
    expect(problem.remedy).toEqual({ kind: 'skip-missing-assets' });
    expect(problem.hint).toContain('missingAssets');
  });

  it('成片缺素材只给路径与说明，没有跳过这一步', () => {
    const problem = explainExportError(new RpcError('conflict', '链接的素材「a」不在原来的位置', { code: 'ASSET_MISSING', assetId: 'a', path: '/x/a.mov' }), {
      kind: 'video',
      stage: 'rejected',
    });
    expect(problem.items).toEqual(['/x/a.mov']);
    expect(problem.remedy).toBeNull();
    expect(problem.hint).toBe('找回文件，或在素材里重新链接它，再导一次。');
  });

  it('工具缺失：照原话给出补救', () => {
    const problem = explainExportError(
      new RpcError('conflict', '成片导出需要 ffmpeg', { code: 'EXPORT_TOOL_MISSING', missing: 'ffmpeg', remedy: '安装 ffmpeg（含 ffprobe）' }),
      { kind: 'video', stage: 'rejected' },
    );
    expect(problem).toMatchObject({ title: '这台电脑缺导出要用的工具', items: ['缺：ffmpeg'], hint: '安装 ffmpeg（含 ffprobe）', remedy: null });
  });

  it('几份文档都能导出：给出候选让用户选一份', () => {
    const problem = explainExportError(
      new RpcError('invalid-request', '有几份文档都可以导出', {
        code: 'EXPORT_SOURCE_AMBIGUOUS',
        candidates: [
          { documentId: 'd1', kind: 'speech', name: '采访 A', language: 'zh' },
          { documentId: 'd2', kind: 'speech', name: '采访 B', language: null },
        ],
      }),
      { kind: 'transcript', stage: 'rejected' },
    );
    expect(problem.items).toEqual(['采访 A · zh', '采访 B']);
    expect(problem.remedy).toEqual({
      kind: 'choose-document',
      candidates: [
        { documentId: 'd1', name: '采访 A', language: 'zh' },
        { documentId: 'd2', name: '采访 B', language: null },
      ],
    });
  });

  it('位置写不进、空间不够：换个位置', () => {
    expect(
      explainExportError(new RpcError('conflict', '写不进', { code: 'EXPORT_DESTINATION_UNWRITABLE', path: '/ro/x.mp4', recovery: '换一个可写的目录' }), {
        kind: 'video',
        stage: 'rejected',
      }),
    ).toMatchObject({ items: ['/ro/x.mp4'], hint: '换一个可写的目录', remedy: { kind: 'pick-dir' } });
    expect(
      explainExportError(new RpcError('conflict', '盘满', { code: 'EXPORT_INSUFFICIENT_SPACE', dir: '/d', required: 3 * 1024 ** 3, available: 512 * 1024 ** 2 }), {
        kind: 'portable',
        stage: 'rejected',
      }),
    ).toMatchObject({ items: ['需要约 3.0 GB，只剩 512 MB'], remedy: { kind: 'pick-dir' } });
  });

  it('范围里没东西：写出那一段', () => {
    const problem = explainExportError(
      new RpcError('invalid-request', '导出范围里没有任何文字', { code: 'EXPORT_NOTHING_TO_EXPORT', range: { start: 12, end: 30.5 } }),
      { kind: 'subtitles', stage: 'rejected' },
    );
    expect(problem.items).toEqual(['0:12.0–0:30.5']);
  });

  it('任务失败：逐个列出没保存成的文件', () => {
    const problem = explainExportError(
      {
        code: 'EXPORT_PARTIALLY_PUBLISHED',
        message: '1 个文件没有导出，1 个已经发布',
        details: { failed: [{ fileName: '访谈.part2.mp4', code: 'EXPORT_VALIDATION_FAILED', problems: ['帧数不对', '时长差 0.4 秒'] }] },
      },
      { kind: 'video', stage: 'failed' },
    );
    expect(problem).toMatchObject({ code: 'EXPORT_PARTIALLY_PUBLISHED', title: '只保存了一部分文件', items: ['访谈.part2.mp4：帧数不对；时长差 0.4 秒'] });
  });

  it('资源准入放不下：列出缺的维度', () => {
    const problem = explainExportError(
      { message: '这次导出要的内存超过这台电脑的容量', details: { code: 'RESOURCE_ADMISSION_UNSATISFIABLE', dimensions: ['memory', 'scratchDisk'] } },
      { kind: 'video', stage: 'rejected' },
    );
    expect(problem).toMatchObject({
      code: 'RESOURCE_ADMISSION_UNSATISFIABLE',
      title: '这台电脑的资源放不下这次导出',
      items: ['不够：内存', '不够：临时文件所在的磁盘空间'],
      remedy: null,
    });
  });

  it('认不出的错误：照原话', () => {
    expect(explainExportError(new Error('连接断了'), { kind: 'audio', stage: 'rejected' })).toEqual({
      code: null,
      title: '导出没有开始',
      message: '连接断了',
      items: [],
      hint: null,
      remedy: null,
    });
  });
});
