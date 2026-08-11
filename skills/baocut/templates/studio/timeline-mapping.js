// BaoCut timeline mapping twin. Keep behavior aligned with bcut-timeline;
// timeline-map-contract.json is consumed by Rust, this module, and Swift.
((root, factory) => {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BCS_TIMELINE = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const EPSILON = 1e-9;

  const finite = (value) => typeof value === 'number' && Number.isFinite(value);
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

  function cutSet(duration, cuts) {
    if (!finite(duration) || duration < 0) throw new Error('source duration 非法');
    const sorted = (cuts || []).map((cut) => ({ ...cut })).sort((a, b) => a.t0 - b.t0 || a.t1 - b.t1);
    let previousEnd = 0, viewStart = 0;
    const keptSpans = [];
    for (const cut of sorted) {
      if (!finite(cut.t0) || !finite(cut.t1) || cut.t0 < previousEnd || cut.t1 <= cut.t0 || cut.t1 > duration) {
        throw new Error(`cut ${cut.id || ''} 必须排序、互不重叠且位于 source 时长内`);
      }
      if (cut.t0 > previousEnd) {
        keptSpans.push({ sourceStart: previousEnd, sourceEnd: cut.t0, viewStart });
        viewStart += cut.t0 - previousEnd;
      }
      previousEnd = cut.t1;
    }
    if (previousEnd < duration) keptSpans.push({ sourceStart: previousEnd, sourceEnd: duration, viewStart });
    const viewDuration = keptSpans.length
      ? keptSpans[keptSpans.length - 1].viewStart + keptSpans[keptSpans.length - 1].sourceEnd - keptSpans[keptSpans.length - 1].sourceStart
      : 0;
    return { duration, cuts: sorted, keptSpans, viewDuration };
  }

  function sourceToView(view, sourceTime) {
    if (!finite(sourceTime) || sourceTime < 0 || sourceTime > view.duration) return null;
    if (view.cuts.some((cut) => sourceTime >= cut.t0 && sourceTime < cut.t1)) return null;
    return sourceToViewAtSeam(view, sourceTime);
  }

  function sourceToViewAtSeam(view, sourceTime) {
    if (!finite(sourceTime)) return 0;
    const time = clamp(sourceTime, 0, view.duration);
    let removed = 0;
    for (const cut of view.cuts) {
      if (cut.t1 <= time) removed += cut.t1 - cut.t0;
      else if (time >= cut.t0) { removed += time - cut.t0; break; }
      else break;
    }
    return time - removed;
  }

  function viewToSource(view, viewTime, bias = 'preceding') {
    if (!finite(viewTime)) return 0;
    const time = clamp(viewTime, 0, view.viewDuration);
    if (!view.keptSpans.length) return bias === 'following' ? view.duration : 0;
    for (let index = 0; index < view.keptSpans.length; index += 1) {
      const span = view.keptSpans[index];
      const viewEnd = span.viewStart + span.sourceEnd - span.sourceStart;
      if (time > span.viewStart && time < viewEnd) return span.sourceStart + time - span.viewStart;
      if (time === span.viewStart) {
        if (bias === 'following') return span.sourceStart;
        return index > 0 ? view.keptSpans[index - 1].sourceEnd : 0;
      }
      if (time === viewEnd) {
        const following = view.keptSpans[index + 1];
        if (bias === 'following' && following && following.viewStart === time) return following.sourceStart;
        if (bias === 'following' && span.sourceEnd < view.duration) return view.duration;
        return span.sourceEnd;
      }
    }
    return view.duration;
  }

  function keptIntersections(view, start, end, minimumDuration = 0) {
    if (!finite(start) || !finite(end) || start >= end) return [];
    const low = clamp(start, 0, view.duration), high = clamp(end, 0, view.duration);
    return view.keptSpans.flatMap((span) => {
      const sourceStart = Math.max(low, span.sourceStart);
      const sourceEnd = Math.min(high, span.sourceEnd);
      return sourceEnd > sourceStart && sourceEnd - sourceStart >= Math.max(0, minimumDuration)
        ? [{ sourceStart, sourceEnd }]
        : [];
    });
  }

  function buildProjection(document, sourceDurations) {
    const rawSources = document.sources || {};
    const ids = new Set([...Object.keys(sourceDurations || {}), ...Object.keys(rawSources)]);
    const views = {};
    for (const srcId of [...ids].sort()) {
      const source = rawSources[srcId] || {};
      const duration = finite((sourceDurations || {})[srcId]) ? sourceDurations[srcId] : source.duration;
      views[srcId] = cutSet(duration, source.cuts || []);
    }
    if (!views.main) throw new Error('source 不存在：main');
    const rawClips = (document.clips && document.clips.length)
      ? document.clips
      : [{ id: 'c1', srcId: 'main', in: 0, out: views.main.duration, rate: 1 }];
    let timelineCursor = 0;
    const clips = rawClips.map((raw) => {
      const srcId = raw.srcId || 'main';
      const view = views[srcId];
      if (!view) throw new Error(`source 不存在：${srcId}`);
      const sourceIn = raw.in, sourceOut = raw.out, rate = raw.rate == null ? 1 : raw.rate;
      if (!finite(sourceIn) || !finite(sourceOut) || sourceIn < 0 || sourceOut <= sourceIn || sourceOut > view.duration + EPSILON || !finite(rate) || rate <= 0) {
        throw new Error(`clip ${raw.id} 的区间或 rate 非法`);
      }
      let segmentCursor = timelineCursor;
      const segments = keptIntersections(view, sourceIn, sourceOut, 0).map(({ sourceStart, sourceEnd }) => {
        const timelineEnd = segmentCursor + (sourceEnd - sourceStart) / rate;
        const segment = { sourceStart, sourceEnd, timelineStart: segmentCursor, timelineEnd };
        segmentCursor = timelineEnd;
        return segment;
      });
      if (!segments.length || segmentCursor - timelineCursor <= EPSILON) throw new Error(`clip 扣除 cuts 后为空：${raw.id}`);
      const clip = {
        id: raw.id, srcId, sourceIn, sourceOut, rate,
        viewIn: sourceToViewAtSeam(view, sourceIn),
        viewOut: sourceToViewAtSeam(view, sourceOut),
        timelineStart: timelineCursor, timelineEnd: segmentCursor, segments,
      };
      timelineCursor = segmentCursor;
      return clip;
    });
    return { duration: timelineCursor, views, clips, tracks: document.tracks || [], main: document.main || null };
  }

  function fromStudio(projected) {
    if (!projected || !Array.isArray(projected.clips)) return null;
    const views = {};
    for (const [srcId, raw] of Object.entries(projected.views || {})) {
      const keptSpans = (raw.keptSpans || []).map((span) => ({
        sourceStart: span.sourceStart == null ? span.t0 : span.sourceStart,
        sourceEnd: span.sourceEnd == null ? span.t1 : span.sourceEnd,
        viewStart: span.viewStart,
      }));
      const duration = finite(raw.duration)
        ? raw.duration
        : Math.max(0, ...(raw.cuts || []).map((cut) => cut.t1), ...keptSpans.map((span) => span.sourceEnd));
      views[srcId] = { duration, cuts: raw.cuts || [], keptSpans, viewDuration: raw.viewDuration || 0, kind: raw.kind || null };
    }
    const clips = projected.clips.map((clip) => ({
      id: clip.id, srcId: clip.srcId || 'main', sourceIn: clip.sourceIn == null ? clip.in : clip.sourceIn,
      sourceOut: clip.sourceOut == null ? clip.out : clip.sourceOut, rate: clip.rate || 1,
      viewIn: clip.viewIn, viewOut: clip.viewOut,
      timelineStart: clip.timelineStart == null ? clip.tlStart : clip.timelineStart,
      timelineEnd: clip.timelineEnd == null ? clip.tlEnd : clip.timelineEnd,
      segments: (clip.segments || []).map((segment) => ({
        sourceStart: segment.sourceStart == null ? segment.srcStart : segment.sourceStart,
        sourceEnd: segment.sourceEnd == null ? segment.srcEnd : segment.sourceEnd,
        timelineStart: segment.timelineStart == null ? segment.tlStart : segment.timelineStart,
        timelineEnd: segment.timelineEnd == null ? segment.tlEnd : segment.timelineEnd,
      })),
    }));
    return { duration: projected.duration || 0, views, clips, tracks: projected.tracks || [], main: projected.main || null, rev: projected.rev || 0 };
  }

  function clipSourceToTimeline(clip, sourceTime) {
    for (const segment of clip.segments) {
      if (sourceTime >= segment.sourceStart && sourceTime < segment.sourceEnd) {
        return segment.timelineStart + (sourceTime - segment.sourceStart) / clip.rate;
      }
    }
    const last = clip.segments[clip.segments.length - 1];
    return last && sourceTime === last.sourceEnd ? last.timelineEnd : null;
  }

  function sourceToTimeline(projection, srcId, sourceTime) {
    return projection.clips
      .filter((clip) => clip.srcId === srcId)
      .map((clip) => clipSourceToTimeline(clip, sourceTime))
      .filter((time) => time != null);
  }

  function playbackStep(projection, clipId, sourceTime, tolerance = 0.001) {
    const clip = projection && projection.clips.find((candidate) => candidate.id === clipId);
    if (!clip || !finite(sourceTime)) return null;
    for (let index = 0; index < clip.segments.length; index += 1) {
      const segment = clip.segments[index];
      if (sourceTime < segment.sourceStart - tolerance) {
        return { timelineTime: segment.timelineStart, seekSource: segment.sourceStart, clipId, srcId: clip.srcId };
      }
      if (sourceTime < segment.sourceEnd - tolerance) {
        return {
          timelineTime: segment.timelineStart + (Math.max(sourceTime, segment.sourceStart) - segment.sourceStart) / clip.rate,
          seekSource: null, clipId, srcId: clip.srcId,
        };
      }
      const following = clip.segments[index + 1];
      if (following && sourceTime < following.sourceStart - tolerance) {
        return { timelineTime: following.timelineStart, seekSource: following.sourceStart, clipId, srcId: clip.srcId };
      }
    }
    return { timelineTime: clip.timelineEnd, seekSource: null, clipId, srcId: clip.srcId, clipEnded: true };
  }

  function timelineToSource(projection, timelineTime, bias = 'preceding') {
    if (!projection || !finite(timelineTime) || !projection.clips.length) return null;
    const time = clamp(timelineTime, 0, projection.duration);
    let clip = projection.clips.find((candidate) => candidate.timelineEnd > time
      || (bias === 'preceding' && candidate.timelineEnd === time));
    if (!clip) clip = projection.clips[projection.clips.length - 1];
    let segment = clip.segments.find((candidate) => candidate.timelineEnd > time
      || (bias === 'preceding' && candidate.timelineEnd === time));
    if (!segment) segment = clip.segments[clip.segments.length - 1];
    let sourceTime;
    if (time <= segment.timelineStart) sourceTime = segment.sourceStart;
    else if (time >= segment.timelineEnd) sourceTime = segment.sourceEnd;
    else sourceTime = segment.sourceStart + (time - segment.timelineStart) * clip.rate;
    return { srcId: clip.srcId, sourceTime, clipId: clip.id };
  }

  function clampSourceEvent(projection, srcId, start, end, minimumDuration = 0) {
    if (!finite(start) || !finite(end) || start >= end) return [];
    const output = [];
    for (const clip of projection.clips.filter((candidate) => candidate.srcId === srcId)) {
      for (const segment of clip.segments) {
        if (segment.sourceEnd <= start || segment.sourceStart >= end) continue;
        const sourceStart = Math.max(start, segment.sourceStart);
        const sourceEnd = Math.min(end, segment.sourceEnd);
        if ((sourceEnd - sourceStart) / clip.rate < Math.max(0, minimumDuration)) continue;
        output.push({
          clipId: clip.id, srcId, sourceStart, sourceEnd,
          timelineStart: segment.timelineStart + (sourceStart - segment.sourceStart) / clip.rate,
          timelineEnd: segment.timelineStart + (sourceEnd - segment.sourceStart) / clip.rate,
        });
      }
    }
    return output;
  }

  function projectTimedItems(sourceDocs, projection, key, minimumDuration = 0.01) {
    if (!projection) return [];
    const output = [];
    for (const [srcId, source] of Object.entries(sourceDocs || {})) {
      for (const item of source[key] || []) {
        for (const mapped of clampSourceEvent(projection, srcId, item.start, item.end, minimumDuration)) {
          output.push({
            ...item,
            id: `${srcId}:${mapped.clipId}:${item.id}:${mapped.timelineStart}`,
            sourceId: srcId,
            sourceItemId: item.id,
            clipId: mapped.clipId,
            sourceStart: mapped.sourceStart,
            sourceEnd: mapped.sourceEnd,
            start: mapped.timelineStart,
            end: mapped.timelineEnd,
          });
        }
      }
    }
    output.sort((left, right) => left.start - right.start || left.end - right.end || left.id.localeCompare(right.id));
    if (key !== 'transCues') return output;
    const merged = [];
    for (const item of output) {
      const previous = merged[merged.length - 1];
      if (previous
        && previous.sourceId === item.sourceId
        && previous.clipId === item.clipId
        && previous.sourceItemId === item.sourceItemId
        && previous.text === item.text
        && Math.abs(previous.end - item.start) <= EPSILON) {
        previous.end = item.end;
        previous.sourceEnd = item.sourceEnd;
      } else {
        merged.push({ ...item });
      }
    }
    return merged;
  }

  function mediaURL(srcId) {
    return srcId && srcId !== 'main' ? `__bcut/media?src=${encodeURIComponent(srcId)}` : '__bcut/media';
  }

  return {
    buildProjection, fromStudio, sourceToView, sourceToViewAtSeam, viewToSource,
    sourceToTimeline, timelineToSource, clampSourceEvent, projectTimedItems, playbackStep, mediaURL,
  };
});
