import { describe, expect, it } from 'vitest';
import type { SemanticCoverage, SemanticEstimate, SemanticIndexStatus } from '@baocut/protocol';
import { M } from './semantic-copy.ts';
import { coverageLine, entryNote, etaLine, indexState, pausedNote, reasonText, visualCostLine, visualCoverageLine } from './semantic-status.ts';

const text = (patch: Partial<SemanticCoverage> = {}): SemanticCoverage => ({
  channel: 'text',
  eligible: 3,
  indexed: 3,
  pending: 0,
  failed: 0,
  missingInput: 0,
  excluded: 0,
  stale: 0,
  knownScopeComplete: true,
  ...patch,
});

const status = (patch: Partial<SemanticIndexStatus> = {}): SemanticIndexStatus => ({
  model: { bundleId: 'embeddinggemma2-text@litert-lm', label: 'EmbeddingGemma 2 Text 270M', encoderProfileId: 'p', embeddingSpaceId: 's', device: 'cpu' },
  reason: null,
  channels: { text: { enabled: true, available: true }, visual: { enabled: false, available: false }, audio: { enabled: false, available: false } },
  coverage: [text()],
  cacheBytes: 0,
  paused: false,
  pauseReason: null,
  estimates: [],
  jobId: null,
  ...patch,
});

describe('每个入口的那一句', () => {
  it('能用且索引跟上时不画；状态还没取到时也不画', () => {
    expect(entryNote('search', status())).toBeNull();
    expect(entryNote('search', null)).toBeNull();
  });

  it('没装模型：各入口写自己的退路，给去设置；按主题选材整个置灰', () => {
    const none = status({ model: null, reason: 'MODEL_NOT_INSTALLED' });
    expect(entryNote('search', none)).toEqual({ tone: 'info', text: M.entry.search.not, settingsLink: true, blocking: false });
    expect(entryNote('topic', none)).toMatchObject({ text: M.entry.topic.not, blocking: true });
    expect(entryNote('shorts', none)).toMatchObject({ text: M.entry.shorts.not, blocking: true, settingsLink: true });
    // 没给原因时也按没装算
    expect(entryNote('tm', status({ model: null }))?.text).toBe(M.entry.tm.not);
  });

  it('索引在更新或暂停时是不阻塞的提醒；暂停时能去设置恢复', () => {
    expect(entryNote('search', status({ coverage: [text({ indexed: 2, pending: 1 })] }))).toEqual({
      tone: 'notice',
      text: M.note.stale,
      settingsLink: false,
      blocking: false,
    });
    expect(entryNote('retakes', status({ paused: true }))).toMatchObject({ tone: 'notice', text: M.note.paused, settingsLink: true });
  });

  it('结果自己带回的原因优先：写退路与原因；认不出的原因码照写', () => {
    expect(entryNote('tm', status(), 'DISABLED')).toEqual({
      tone: 'info',
      text: M.note.degraded(M.entry.tm.fallback, M.reason.DISABLED),
      settingsLink: true,
      blocking: false,
    });
    expect(entryNote('tm', status(), 'MEMORY_UNAVAILABLE')).toMatchObject({ settingsLink: false });
    expect(entryNote('search', status(), 'INDEX_PARTIAL')).toMatchObject({ tone: 'notice', text: M.note.stale });
    expect(reasonText('SOMETHING_NEW')).toBe(M.unknownReason('SOMETHING_NEW'));
    expect(entryNote('terms', status(), 'SOMETHING_NEW')?.text).toBe(M.note.degraded(M.entry.terms.fallback, M.unknownReason('SOMETHING_NEW')));
  });
});

describe('完整性按通道写', () => {
  it('就绪、部分、没有文稿', () => {
    expect(coverageLine([text()])).toBe(M.coverage.ready);
    expect(coverageLine([text({ missingInput: 1 })])).toBe(M.coverage.readyWith(M.coverage.missing(1)));
    expect(coverageLine([text({ indexed: 1, pending: 1, failed: 1, missingInput: 2 })])).toBe(
      M.coverage.partial(1, 3, [M.coverage.queued(1), M.coverage.failed(1), M.coverage.missing(2)].join(M.coverage.separator)),
    );
    expect(coverageLine([text({ eligible: 0, indexed: 0, missingInput: 4 })])).toBe(M.coverage.noTranscripts);
    expect(coverageLine([text({ eligible: 0, indexed: 0 })])).toBe(M.coverage.empty);
    expect(coverageLine([])).toBe(M.coverage.none);
  });

  it('没纳入语义索引的项目与没有文稿分开写', () => {
    expect(coverageLine([text({ excluded: 2 })])).toBe(M.coverage.readyWith(M.coverage.excluded(2)));
    expect(coverageLine([text({ missingInput: 1, excluded: 2 })])).toBe(
      M.coverage.readyWith([M.coverage.missing(1), M.coverage.excluded(2)].join(M.coverage.separator)),
    );
    expect(coverageLine([text({ eligible: 0, indexed: 0, excluded: 3 })])).toBe(M.coverage.notIncluded);
  });

  it('已建的落后于当前版本时不算就绪', () => {
    expect(coverageLine([text({ stale: 1 })])).toBe(M.coverage.partial(3, 3, M.coverage.outdated(1)));
  });
});

describe('设置页的状态格', () => {
  it('没有模型或索引没开、暂停、更新中、已跟上', () => {
    expect(indexState(status({ model: null }))).toBe('unavailable');
    expect(indexState(status({ reason: 'INDEX_NOT_READY' }))).toBe('unavailable');
    expect(indexState(status({ paused: true }))).toBe('paused');
    expect(indexState(status({ coverage: [text({ pending: 1, indexed: 2 })] }))).toBe('updating');
    expect(indexState(status())).toBe('ready');
  });
});

describe('自动停下与还要多久', () => {
  const estimate = (patch: Partial<SemanticEstimate> = {}): SemanticEstimate => ({
    channel: 'text',
    ifEnabled: false,
    videos: 3,
    unknownDuration: 0,
    sourceSeconds: 4260,
    frames: null,
    seconds: 95,
    basis: 'measured',
    vectorBytes: null,
    ...patch,
  });

  it('用电池、过热降频写原因；过热不给设置入口（关不掉）', () => {
    expect(entryNote('search', status({ paused: true, pauseReason: 'battery' }))).toMatchObject({ text: M.note.battery, settingsLink: true });
    expect(entryNote('search', status({ paused: true, pauseReason: 'thermal' }))).toMatchObject({ text: M.note.thermal, settingsLink: false });
    expect(entryNote('search', status({ paused: true, pauseReason: 'user' }))).toMatchObject({ text: M.note.paused, settingsLink: true });
    expect(pausedNote({ pauseReason: null })).toBe(M.note.paused);
  });

  it('量过的速度、参考速度、还没有速度；时长未知的另写；没有待建的不写', () => {
    expect(etaLine(estimate())).toBe(M.settings.eta.measured(3, M.settings.eta.minutes(2)));
    expect(etaLine(estimate({ basis: 'default', seconds: 30 }))).toBe(M.settings.eta.reference(3, M.settings.eta.lessThanMinute));
    expect(etaLine(estimate({ seconds: null, basis: null, unknownDuration: 1 }))).toBe(M.settings.eta.noRate(3));
    expect(etaLine(estimate({ seconds: 5400, unknownDuration: 2 }))).toBe(M.settings.eta.withUnknown(M.settings.eta.measured(3, M.settings.eta.hours('1.5')), 2));
    expect(etaLine(estimate({ videos: 0, seconds: 0 }))).toBeNull();
    expect(etaLine(null)).toBeNull();
  });
});

describe('画面一路', () => {
  const visual = (patch: Partial<SemanticCoverage> = {}): SemanticCoverage => text({ channel: 'visual', ...patch });
  const cost = (patch: Partial<SemanticEstimate> = {}): SemanticEstimate => ({
    channel: 'visual',
    ifEnabled: true,
    videos: 12,
    unknownDuration: 0,
    sourceSeconds: 6600,
    frames: 825,
    seconds: 908,
    basis: 'default',
    vectorBytes: 1689600,
    ...patch,
  });

  it('画面在建时设置页的状态是更新中，各入口不受影响', () => {
    const building = status({ coverage: [text(), visual({ indexed: 1, pending: 2 })] });
    expect(indexState(building)).toBe('updating');
    expect(entryNote('search', building)).toBeNull();
    expect(indexState(status({ coverage: [text(), visual({ eligible: 0, indexed: 0 })] }))).toBe('ready');
  });

  it('画面完整性：就绪、部分；没有要建画面的视频时不写', () => {
    expect(visualCoverageLine([text(), visual()])).toBe(M.coverage.visualReady);
    expect(visualCoverageLine([text(), visual({ indexed: 1, pending: 2 })])).toBe(M.coverage.visualPartial(1, 3, M.coverage.queued(2)));
    expect(visualCoverageLine([text(), visual({ eligible: 0, indexed: 0 })])).toBeNull();
    expect(visualCoverageLine([text()])).toBeNull();
  });

  it('打开之前写视频、帧数、首次要多久与向量大小；时长都不知道时只写估不出', () => {
    const c = M.settings.cost;
    expect(visualCostLine(cost())).toBe(
      c.cacheNote([c.head(12, M.settings.eta.hours('1.8'), 825), c.firstRun(M.settings.eta.minutes(15), false), c.vectors('2 MB')].join(c.separator)),
    );
    expect(visualCostLine(cost({ unknownDuration: 1, basis: 'measured', vectorBytes: 1000 }))).toBe(
      c.cacheNote(
        [c.head(12, M.settings.eta.hours('1.8'), 825), c.unknown(1), c.firstRun(M.settings.eta.minutes(15), true), c.vectors(null)].join(c.separator),
      ),
    );
    expect(visualCostLine(cost({ frames: 0, sourceSeconds: 0, unknownDuration: 2, videos: 2 }))).toBe(c.noLength(2));
    expect(visualCostLine(cost({ videos: 0 }))).toBeNull();
  });
});
