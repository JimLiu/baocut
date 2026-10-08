import { describe, expect, it } from 'vitest';
import type { JobRecord, ToolCandidate, ToolCandidateDocument } from '@baocut/protocol';
import {
  blockReason,
  defaultTargetLang,
  documentsByEntry,
  duplicateNote,
  eligibleCount,
  langsText,
  pick,
  pickerRows,
  sourceDocument,
  failedTranscribeJob,
  newVideoName,
  replaceImpact,
  retargetOptions,
  retryParamsOf,
  spaceTranscribeAction,
  tagsOf,
  targetLangs,
  transcribeState,
  translationOptions,
} from './tool-targets.ts';

/* 设计稿 model-tool-targets.test.js 的思路：能选的在前、置灰写原因、标注与「不覆盖」提示、译文的「第 N 份」。 */

function doc(patch: Partial<ToolCandidateDocument> = {}): ToolCandidateDocument {
  return {
    kind: 'speech',
    documentId: 'doc_zh',
    name: '文稿',
    language: 'zh',
    wordTiming: true,
    onTimeline: true,
    translations: [],
    dubs: [],
    ...patch,
  };
}

function candidate(patch: Partial<ToolCandidate> = {}): ToolCandidate {
  return {
    entryId: 'ent_1',
    videoId: 'vid_1',
    name: '访谈第一集',
    projectId: 'prj_1',
    lastActivityAt: '2026-10-01T00:00:00Z',
    indexed: true,
    indexedRevision: 'r3',
    documents: [],
    ...patch,
  };
}

function job(patch: Partial<JobRecord>): JobRecord {
  return {
    jobId: 'job_1',
    kind: 'transcribe',
    state: 'running',
    phase: null,
    progress: null,
    videoId: 'vid_1',
    assetId: null,
    assetRevision: null,
    contentHash: '',
    providerId: 'local',
    modelId: 'whisper',
    bundleId: null,
    inputHash: '',
    submitter: { kind: 'connection', id: 'app' },
    attempt: 1,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
    startedAt: null,
    endedAt: null,
    error: null,
    result: null,
    warnings: [],
    ...patch,
  } as JobRecord;
}

describe('视频选择器的候选行', () => {
  it('语言写中文名，同一种多份时记 ×N', () => {
    expect(langsText(['en', 'en', 'ja'])).toBe('英语 ×2、日语');
    expect(langsText([null])).toBe('未知语言');
  });

  it('标注：文稿 / 译文 / 配音各一枚', () => {
    const tags = tagsOf([
      doc({
        translations: [{ documentId: 'tr_en', language: 'en', units: 10, staleUnits: 0 }],
        dubs: [{ groupId: 'g1', language: 'en', translationId: 'tr_en' }],
      }),
    ]);
    expect(tags.map((t) => t.label)).toEqual(['文稿 · 中文', '译文 · 英语', '配音 · 英语']);
    expect(tagsOf([])).toEqual([]);
  });

  it('转录状态从 jobs 推：在跑、在排队、最近一次失败；之后又成功的不算失败', () => {
    expect(transcribeState('vid_1', [job({ state: 'running' })])).toBe('running');
    expect(transcribeState('vid_1', [job({ state: 'queued' })])).toBe('queued');
    expect(transcribeState('vid_1', [job({ kind: 'pipeline', pipeline: { name: 'transcribe' } as JobRecord['pipeline'], state: 'running' })])).toBe('running');
    expect(transcribeState('vid_1', [job({ state: 'failed' })])).toBe('failed');
    expect(
      transcribeState('vid_1', [
        job({ jobId: 'a', state: 'failed', updatedAt: '2026-10-01T00:00:00Z' }),
        job({ jobId: 'b', state: 'completed', updatedAt: '2026-10-02T00:00:00Z' }),
      ]),
    ).toBeNull();
    expect(transcribeState('vid_2', [job({ state: 'running' })])).toBeNull();
    expect(transcribeState(null, [job({ state: 'running' })])).toBeNull();
  });

  it('置灰原因：转录只拦正在转录的；要文稿的工具按转录状态说明；链接导入都能选', () => {
    const none = { documents: [], indexed: true };
    expect(blockReason('transcribe', none, null)).toBeNull();
    expect(blockReason('transcribe', none, 'running')).toBe('正在转录，完成后可以重新转录');
    expect(blockReason('transcribe', none, 'queued')).toBe('已在转录队列里');
    expect(blockReason('translate-subtitles', none, 'running')).toBe('正在转录，完成后才能选');
    expect(blockReason('dub', none, 'queued')).toBe('在转录队列里，转录完成后才能选');
    expect(blockReason('dub', none, 'failed')).toBe('上次转录失败，先重新转录');
    expect(blockReason('dub', none, null)).toBe('还没有文稿，先转录');
    expect(blockReason('dub', { documents: [], indexed: false }, null)).toBeNull();
    expect(blockReason('dub', { documents: [doc()], indexed: true }, 'failed')).toBeNull();
    expect(blockReason('link-import', none, 'running')).toBeNull();
  });

  it('能选的排在前面，同组保持 Runtime 的顺序；按名字搜索；预选', () => {
    const list = [
      candidate({ entryId: 'a', videoId: 'va', name: '片花', documents: [] }),
      candidate({ entryId: 'b', videoId: 'vb', name: '访谈第一集', documents: [doc()] }),
      candidate({ entryId: 'c', videoId: 'vc', name: '访谈第二集', indexed: false, documents: [] }),
    ];
    const rows = pickerRows('translate-subtitles', list, []);
    expect(rows.map((r) => [r.entryId, r.eligible])).toEqual([
      ['b', true],
      ['c', true],
      ['a', false],
    ]);
    expect(rows[1]!.tags.map((t) => t.key)).toEqual(['pending']);
    expect(eligibleCount(rows)).toBe(2);
    expect(pickerRows('translate-subtitles', list, [], '访谈').map((r) => r.entryId)).toEqual(['b', 'c']);
    expect(pickerRows('translate-subtitles', list, [], '  片花 ').map((r) => r.entryId)).toEqual(['a']);
    expect(pick(rows, 'c')).toBe('c');
    expect(pick(rows, 'a')).toBe('b');
    expect(pick(rows, null)).toBe('b');
    expect(pick(pickerRows('dub', [list[0]!], []), null)).toBeNull();
  });

  it('转录的候选不列文稿：用有文稿规则的候选补上标注与不覆盖提示', () => {
    const extra = documentsByEntry([candidate({ entryId: 'b', documents: [doc()] })]);
    const rows = pickerRows('transcribe', [candidate({ entryId: 'b', documents: [] })], [], '', extra);
    expect(rows[0]!.tags.map((t) => t.label)).toEqual(['文稿 · 中文']);
    expect(duplicateNote('transcribe', rows[0]!)).toMatch(
      /^这部视频已有中文文稿。默认新建一部视频.*选「取代这部视频的文稿」会换掉当前文稿/,
    );
  });
});

describe('写进已有视频', () => {
  const row = {
    documents: [
      doc({
        translations: [
          { documentId: 'tr_en1', language: 'en', units: 62, staleUnits: 0 },
          { documentId: 'tr_en2', language: 'en', units: 60, staleUnits: 2 },
          { documentId: 'tr_ja', language: 'ja', units: 58, staleUnits: 0 },
        ],
        dubs: [{ groupId: 'g1', language: 'en', translationId: 'tr_en1' }],
      }),
    ],
  };

  it('不覆盖提示：同语言已有译文或配音时说明会新增一份', () => {
    expect(duplicateNote('translate-subtitles', row, 'en')).toBe('这个视频已有英语译文。这次会新增一份，原来的保留，用哪一份在编辑器里选。');
    expect(duplicateNote('translate-subtitles', row, 'fr')).toBeNull();
    expect(duplicateNote('dub', row, 'en')).toBe('这个视频已有英语配音。这次会新增一组，原来的保留。');
    expect(duplicateNote('dub', row, 'ja')).toBeNull();
    expect(duplicateNote('transcribe', { documents: [] })).toBeNull();
    expect(duplicateNote('transcribe', null)).toBeNull();
  });

  it('翻译配音可选的译文：同语言多份时加「第 N 份」，标出来源文稿', () => {
    const options = translationOptions(row);
    expect(options.map((o) => o.label)).toEqual(['英语译文 第 1 份', '英语译文 第 2 份', '日语译文']);
    expect(options[0]!.sub).toBe('译自中文文稿');
    expect(options[1]).toMatchObject({ id: 'tr_en2', documentId: 'doc_zh', stale: 2 });
    expect(translationOptions(null)).toEqual([]);
  });

  it('目标语言去掉文稿自己的语言；文稿默认取最近的一份', () => {
    const two = { documents: [doc({ documentId: 'd1', language: 'en' }), doc({ documentId: 'd2', language: 'zh' })] };
    expect(sourceDocument(two)?.documentId).toBe('d2');
    expect(sourceDocument(two, 'd1')?.documentId).toBe('d1');
    expect(sourceDocument({ documents: [] })).toBeNull();
    expect(targetLangs(['zh-Hans', 'en', 'ja'], doc({ language: 'zh' }))).toEqual(['en', 'ja']);
    expect(targetLangs(['zh-Hans', 'en'], null)).toEqual(['zh-Hans', 'en']);
  });

  it('目标语言的缺省：选过的还能选就用它；原文是英语时译成简体中文，其余译成英语', () => {
    expect(defaultTargetLang(['en', 'ja'], 'ja', 'zh')).toBe('ja');
    expect(defaultTargetLang(['en', 'ja'], 'ko', 'zh')).toBe('en');
    expect(defaultTargetLang(['zh-Hans', 'ja'], null, 'en-US')).toBe('zh-Hans');
    expect(defaultTargetLang(['zh-Hans', 'ja'], null, null)).toBe('zh-Hans');
    expect(defaultTargetLang([], null, null)).toBeNull();
  });
});

describe('重新转录的落点（产品设计 §5.11）', () => {
  const row = {
    documents: [
      doc({
        translations: [
          { documentId: 'tr_en', language: 'en', units: 62, staleUnits: 0 },
          { documentId: 'tr_ja', language: 'ja', units: 58, staleUnits: 3 },
        ],
        dubs: [
          { groupId: 'g1', language: 'en', translationId: 'tr_en' },
          { groupId: 'g2', language: 'en', translationId: 'tr_en' },
        ],
      }),
    ],
  };

  it('已有文稿才有落点：新建视频在前（缺省），取代在后', () => {
    expect(retargetOptions({ documents: [] })).toBeNull();
    expect(retargetOptions(null)).toBeNull();
    expect(retargetOptions(row)!.map((o) => [o.key, o.label])).toEqual([
      ['new-video', '新建视频'],
      ['replace', '取代这部视频的文稿'],
    ]);
    expect(newVideoName('访谈第一集')).toBe('访谈第一集 · 重新转录');
  });

  it('影响卡：每种译文一行写句数，配音按语言数组；有译文才写规则；总是写可以撤销', () => {
    const im = replaceImpact(row);
    expect(im.translations).toEqual(['英语 · 62 句', '日语 · 58 句']);
    expect(im.dubs).toEqual(['英语 · 2 组 · 句子译文不变的保留，标可能不一致']);
    expect(im.rule).toMatch(/「刷新过期译文」/);
    expect(im.undo).toBe('一笔事务，可以撤销');
    const bare = replaceImpact({ documents: [doc()] });
    expect(bare.translations).toEqual([]);
    expect(bare.rule).toBeNull();
  });
});

describe('Space 视频条目的转录动作（产品设计 §4.4）', () => {
  it('转录中、排队、源文件缺失不给；失败给重试；有文稿重新转录，没有给转录；不知道时不给', () => {
    expect(spaceTranscribeAction('running', true, false)).toBeNull();
    expect(spaceTranscribeAction('queued', false, false)).toBeNull();
    expect(spaceTranscribeAction(null, true, true)).toBeNull();
    expect(spaceTranscribeAction('failed', true, false)).toBe('retry');
    expect(spaceTranscribeAction('failed', null, false)).toBe('retry');
    expect(spaceTranscribeAction(null, true, false)).toBe('redo');
    expect(spaceTranscribeAction(null, false, false)).toBe('first');
    expect(spaceTranscribeAction(null, null, false)).toBeNull();
  });

  it('重试带上最近一次失败的转录，流程任务优先；之后又成功过的不算', () => {
    const child = job({ jobId: 'child', state: 'failed', updatedAt: '2026-10-03T00:00:00Z' });
    const parent = job({
      jobId: 'parent',
      kind: 'pipeline',
      providerId: 'pipeline',
      modelId: 'transcribe',
      state: 'failed',
      updatedAt: '2026-10-02T00:00:00Z',
      pipeline: {
        name: 'transcribe',
        params: { provider: 'openai', model: 'gpt-4o-transcribe', language: 'en', diarize: true },
      } as unknown as JobRecord['pipeline'],
    });
    expect(failedTranscribeJob('vid_1', [child, parent])?.jobId).toBe('parent');
    expect(failedTranscribeJob('vid_1', [child])?.jobId).toBe('child');
    expect(failedTranscribeJob('vid_1', [parent, job({ jobId: 'ok', state: 'completed', updatedAt: '2026-10-04T00:00:00Z' })])).toBeNull();
    expect(failedTranscribeJob(null, [parent])).toBeNull();
    expect(retryParamsOf(parent)).toEqual({ provider: 'openai', model: 'gpt-4o-transcribe', language: 'en', diarize: true });
    // 流程父任务记录上的 Provider 与模型不是转写用的：参数里没写时不拿它们兜底。
    expect(
      retryParamsOf(job({ kind: 'pipeline', pipeline: { name: 'transcribe', params: {} } as unknown as JobRecord['pipeline'] })),
    ).toEqual({
      provider: null,
      model: null,
      language: null,
      diarize: null,
    });
    expect(retryParamsOf(child)).toEqual({ provider: 'local', model: 'whisper', language: null, diarize: null });
  });
});
