'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const T = require('./timeline-mapping.js');

const fixture = JSON.parse(fs.readFileSync(
  path.resolve(__dirname, '../../../../core/fixtures/timeline-map-contract.json'),
  'utf8',
));
const projection = T.buildProjection(fixture.timeline, fixture.sourceDurations);

test('JavaScript projection matches the shared Rust/Swift contract', () => {
  const expected = fixture.expect;
  assert.equal(projection.duration, expected.duration);
  for (const [srcId, wanted] of Object.entries(expected.views)) {
    const view = projection.views[srcId];
    assert.equal(view.viewDuration, wanted.duration);
    assert.deepEqual(view.keptSpans, wanted.keptSpans);
    for (const row of wanted.sourceToView) assert.equal(T.sourceToView(view, row.source), row.view);
    for (const row of wanted.viewToSource) assert.equal(T.viewToSource(view, row.view, row.bias), row.source);
  }
  assert.deepEqual(
    projection.clips.map(({ id, timelineStart, timelineEnd }) => ({ id, timelineStart, timelineEnd })),
    expected.clips,
  );
  for (const row of expected.sourceToTimeline) {
    assert.deepEqual(T.sourceToTimeline(projection, row.srcId, row.source), row.timeline);
  }
  for (const row of expected.timelineToSource) {
    const actual = T.timelineToSource(projection, row.timeline, row.bias);
    assert.deepEqual({ srcId: actual.srcId, source: actual.sourceTime }, { srcId: row.srcId, source: row.source });
  }
  for (const row of expected.events) {
    assert.deepEqual(
      T.clampSourceEvent(projection, row.srcId, row.start, row.end, row.minimumDuration)
        .map(({ clipId, timelineStart, timelineEnd }) => ({ clipId, timelineStart, timelineEnd })),
      row.mapped,
    );
  }
});

test('Studio wire projection preserves seam direction and media routing', () => {
  const wire = {
    duration: projection.duration,
    views: Object.fromEntries(Object.entries(projection.views).map(([id, view]) => [id, {
      viewDuration: view.viewDuration,
      cuts: view.cuts,
      keptSpans: view.keptSpans.map((span) => ({ t0: span.sourceStart, t1: span.sourceEnd, viewStart: span.viewStart })),
    }])),
    clips: projection.clips.map((clip) => ({
      id: clip.id, srcId: clip.srcId, in: clip.sourceIn, out: clip.sourceOut, rate: clip.rate,
      tlStart: clip.timelineStart, tlEnd: clip.timelineEnd, viewIn: clip.viewIn, viewOut: clip.viewOut,
      segments: clip.segments.map((segment) => ({
        srcStart: segment.sourceStart, srcEnd: segment.sourceEnd,
        tlStart: segment.timelineStart, tlEnd: segment.timelineEnd,
      })),
    })),
  };
  const restored = T.fromStudio(wire);
  assert.deepEqual(T.timelineToSource(restored, 20, 'following'), { srcId: 'src-a', sourceTime: 2, clipId: 'c2' });
  assert.equal(T.mediaURL('main'), '__bcut/media');
  assert.equal(T.mediaURL('src-a'), '__bcut/media?src=src-a');
  assert.deepEqual(T.playbackStep(restored, 'c1', 15), {
    timelineTime: 10, seekSource: 20, clipId: 'c1', srcId: 'main',
  });
  assert.deepEqual(T.playbackStep(restored, 'c1', 30), {
    timelineTime: 20, seekSource: null, clipId: 'c1', srcId: 'main', clipEnded: true,
  });
});

test('translation cues stay single across a collapsed cut but separate across reuse', () => {
  const rows = T.projectTimedItems({
    main: { transCues: [{ id: 's-1#0', start: 9, end: 21, text: 'visible translation' }] },
  }, projection, 'transCues');
  assert.deepEqual(rows.map((row) => ({ clipId: row.clipId, start: row.start, end: row.end })), [
    { clipId: 'c1', start: 9, end: 11 },
    { clipId: 'c3', start: 22, end: 23 },
  ]);
});
