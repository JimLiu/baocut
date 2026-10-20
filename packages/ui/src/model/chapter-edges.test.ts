import { describe, expect, it } from 'vitest';
import { chapter, sequence, track, videoItem } from '../testing/sequence-records.ts';
import {
  chipEdge,
  clampEdgeFrame,
  dragEdgeFrame,
  edgeBounds,
  edgeChange,
  nudgeEdgeFrame,
  signedTenths,
  type ChipEdge,
} from './chapter-edges.ts';
import { moveChapterOperation, sequenceChapters, startBounds } from './chapters.ts';
import { liteSegments } from './lite-segments.ts';

const FPS = { num: 30, den: 1 };
// 60 秒的片子（30 fps）；三章：0、20、45 秒。
const seq = sequence([track('v1', 'visual', 1)], [videoItem('c1', 'v1', 0, 1800)], {
  markers: [chapter('m1', 0, 'Intro'), chapter('m2', 600, 'Body'), chapter('m3', 1350, 'Outro')],
});
const chapters = sequenceChapters(seq);
const segments = liteSegments({ chapters, lines: [], duration: 60, title: 'Video' });

describe('chapter edges: bounds', () => {
  it('keeps `gap` frames to the neighbours and the end; the first chapter may start at 0', () => {
    expect(edgeBounds(chapters, 1, 1800, 1)).toEqual({ min: 1, max: 1349 });
    expect(edgeBounds(chapters, 1, 1800, 30)).toEqual({ min: 30, max: 1320 });
    expect(edgeBounds(chapters, 2, 1800, 30)).toEqual({ min: 630, max: 1770 });
    expect(edgeBounds(chapters, 0, 1800, 30)).toEqual({ min: 0, max: 570 });
  });

  it('the chapter band keeps its one-frame rule through startBounds', () => {
    expect(startBounds(chapters, 1, 1800)).toEqual(edgeBounds(chapters, 1, 1800, 1));
    // Neighbours one frame apart: the band can only keep it in place; with a one-second gap edgeBounds reports min > max.
    const tight = sequenceChapters(
      sequence([track('v1', 'visual', 1)], [videoItem('c1', 'v1', 0, 1800)], {
        markers: [chapter('a', 0, 'A'), chapter('b', 1, 'B'), chapter('c', 2, 'C')],
      }),
    );
    expect(startBounds(tight, 1, 1800)).toEqual({ min: 1, max: 1 });
    expect(edgeBounds(tight, 1, 1800, 30)).toEqual({ min: 30, max: -28 });
  });

  it('clamps and rounds to a frame', () => {
    expect(clampEdgeFrame(700.4, { min: 30, max: 1320 })).toBe(700);
    expect(clampEdgeFrame(-5, { min: 30, max: 1320 })).toBe(30);
    expect(clampEdgeFrame(5000, { min: 30, max: 1320 })).toBe(1320);
  });
});

describe('chapter edges: dragging', () => {
  const bounds = { min: 30, max: 1320 };

  it('snaps to the playhead within snapPx, then clamps', () => {
    expect(dragEdgeFrame({ frame: 703, playheadFrame: 700, pxPerFrame: 1, snapPx: 6, bounds })).toEqual({ frame: 700, snapped: true });
    expect(dragEdgeFrame({ frame: 710, playheadFrame: 700, pxPerFrame: 1, snapPx: 6, bounds })).toEqual({ frame: 710, snapped: false });
    expect(dragEdgeFrame({ frame: 5000, playheadFrame: 700, pxPerFrame: 1, snapPx: 6, bounds })).toEqual({ frame: 1320, snapped: false });
  });

  it('does not snap without a scale, and a playhead outside the bounds is not reachable', () => {
    expect(dragEdgeFrame({ frame: 703, playheadFrame: 700, pxPerFrame: 0, snapPx: 6, bounds })).toEqual({ frame: 703, snapped: false });
    expect(dragEdgeFrame({ frame: 12, playheadFrame: 10, pxPerFrame: 1, snapPx: 6, bounds })).toEqual({ frame: 30, snapped: false });
  });
});

describe('chapter edges: chips', () => {
  it('chapter chips get a handle on their right edge, except the last one', () => {
    const edges = segments.map((_, i) => chipEdge(segments, chapters, i, FPS, 1800));
    expect(edges.map((e) => e && [e.index, e.chapter.id, e.bounds])).toEqual([
      [0, 'm2', { min: 30, max: 1320 }],
      [1, 'm3', { min: 630, max: 1770 }],
      null,
    ]);
  });

  it('derived segments (narration, whole video) get no handle', () => {
    const speech = liteSegments({
      chapters: [],
      lines: [
        { id: 'l1', start: 0, end: 2, text: 'one' },
        { id: 'l2', start: 10, end: 12, text: 'two' },
      ],
      duration: 20,
      title: 'Video',
    });
    expect(speech.map((_, i) => chipEdge(speech, [], i, FPS, 600))).toEqual([null, null]);
    const whole = liteSegments({ chapters: [], lines: [], duration: 20, title: 'Video' });
    expect(chipEdge(whole, [], 0, FPS, 600)).toBeNull();
  });

  it('a pair already tighter than one second is not pushed apart, and one with no room has no handle', () => {
    const near = sequenceChapters(
      sequence([track('v1', 'visual', 1)], [videoItem('c1', 'v1', 0, 1800)], {
        markers: [chapter('a', 0, 'A'), chapter('b', 15, 'B'), chapter('c', 900, 'C')],
      }),
    );
    const nearSegments = liteSegments({ chapters: near, lines: [], duration: 60, title: 'Video' });
    // A is half a second long: the boundary may stay where it is or move later, never jump.
    expect(chipEdge(nearSegments, near, 0, FPS, 1800)?.bounds).toEqual({ min: 15, max: 870 });
    const stuck = sequenceChapters(
      sequence([track('v1', 'visual', 1)], [videoItem('c1', 'v1', 0, 1800)], {
        markers: [chapter('a', 0, 'A'), chapter('b', 15, 'B'), chapter('c', 30, 'C')],
      }),
    );
    const stuckSegments = liteSegments({ chapters: stuck, lines: [], duration: 60, title: 'Video' });
    expect(chipEdge(stuckSegments, stuck, 0, FPS, 1800)).toBeNull();
  });

  it('keyboard steps of 1 s and 0.1 s stay inside the bounds', () => {
    const edge = chipEdge(segments, chapters, 0, FPS, 1800) as ChipEdge;
    expect(nudgeEdgeFrame(edge, 600, 1, FPS)).toBe(630);
    expect(nudgeEdgeFrame(edge, 600, -0.1, FPS)).toBe(597);
    expect(nudgeEdgeFrame(edge, 1310, 1, FPS)).toBe(1320);
    expect(nudgeEdgeFrame(edge, 40, -1, FPS)).toBe(30);
    expect(nudgeEdgeFrame(edge, 600, 0.1, { num: 30000, den: 1001 })).toBe(603);
  });

  it('reports the new length and the change of the dragged chip', () => {
    const longer = edgeChange(segments[0]!, 1029, FPS);
    expect(longer.duration).toBeCloseTo(34.3, 6);
    expect(longer.delta).toBeCloseTo(14.3, 6);
    expect(edgeChange(segments[0]!, 540, FPS)).toEqual({ duration: 18, delta: -2 });
    expect([signedTenths(14.3), signedTenths(-2), signedTenths(0), signedTenths(0.04)]).toEqual(['+14.3', '−2.0', '+0.0', '+0.0']);
  });

  it('commits through the same operation as the chapter band', () => {
    const edge = chipEdge(segments, chapters, 0, FPS, 1800) as ChipEdge;
    expect(moveChapterOperation('seq', edge.chapter, 630)).toEqual({
      type: 'upsertChapter',
      sequenceId: 'seq',
      chapterId: 'm2',
      at: { unit: 'frames', value: 630 },
      alignment: 'exact-frame',
    });
  });
});
