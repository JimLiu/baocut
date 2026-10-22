import { describe, expect, it } from 'vitest';
import { chapter, sequence, track, videoItem } from '../testing/sequence-records.ts';
import { clampEdgeFrame, dragEdgeFrame, edgeBounds } from './chapter-edges.ts';
import { sequenceChapters, startBounds } from './chapters.ts';

// 60 秒的片子（30 fps）；三章：0、20、45 秒。
const seq = sequence([track('v1', 'visual', 1)], [videoItem('c1', 'v1', 0, 1800)], {
  markers: [chapter('m1', 0, 'Intro'), chapter('m2', 600, 'Body'), chapter('m3', 1350, 'Outro')],
});
const chapters = sequenceChapters(seq);

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
