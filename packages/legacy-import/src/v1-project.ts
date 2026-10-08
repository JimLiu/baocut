import { existsSync, readFileSync, mkdirSync, statSync, renameSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { speechSentences } from '@baocut/editor-wasm';
import { planBcutProject } from './bcut-project.ts';
import type { ProjectPlan } from './video-plan.ts';

type ObjectValue = Record<string, any>;
const object = (value: unknown): ObjectValue => (value && typeof value === 'object' && !Array.isArray(value) ? (value as ObjectValue) : {});
const idSet = (value: unknown): ObjectValue => (Array.isArray(value) ? Object.fromEntries(value.map((id) => [id, true])) : object(value));
const number = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Invalid legacy time');
  return value;
};
const language = (value: string = '') =>
  ({
    english: 'en',
    chinese: 'zh',
    japanese: 'ja',
    korean: 'ko',
    french: 'fr',
    german: 'de',
    spanish: 'es',
    russian: 'ru',
    portuguese: 'pt',
  })[value.toLowerCase()] ?? (value.length <= 35 && value ? value : 'und');

/** v1's timeline clock and flat elements follow baocut-app upgrade.rs / legacy_edit_migration.rs. */
export function planV1Project(dir: string, entry: ObjectValue, mediaDir: string): ProjectPlan {
  const doc: ObjectValue = JSON.parse(readFileSync(path.join(dir, 'doc.json'), 'utf8'));
  if (!Array.isArray(doc.words)) throw new Error('Legacy document has no words');
  const resolve = (raw: string) => {
    const direct = path.resolve(dir, raw.startsWith('~/') ? path.join(os.homedir(), raw.slice(2)) : raw);
    const inMedia = path.resolve(dir, 'media', raw);
    return existsSync(direct) || !existsSync(inMedia) ? direct : inMedia;
  };
  let media = typeof entry.src?.path === 'string' ? resolve(entry.src.path) : '';
  let duration = typeof entry.duration === 'number' ? entry.duration : 0;
  if (!media || !existsSync(media)) {
    const pcm = path.join(dir, 'audio16k.pcm');
    if (!existsSync(pcm)) throw new Error('Legacy source media is missing');
    const bytes = statSync(pcm).size;
    if (bytes === 0 || bytes % 4 !== 0) throw new Error('Invalid legacy PCM');
    duration = Math.max(duration, bytes / (4 * 16000));
    mkdirSync(mediaDir, { recursive: true });
    // Permanent derived media, outside staging: the new video links to it.
    media = path.join(mediaDir, 'source.wav');
    if (!existsSync(media)) {
      const temporary = path.join(mediaDir, 'source.partial.wav');
      try {
        execFileSync(
          process.env.BAOCUT_FFMPEG || 'ffmpeg',
          ['-v', 'error', '-f', 'f32le', '-ar', '16000', '-ac', '1', '-i', pcm, '-c:a', 'pcm_s16le', '-y', temporary],
          { timeout: 120_000, stdio: 'pipe' },
        );
        renameSync(temporary, media);
      } finally {
        rmSync(temporary, { force: true });
      }
    }
  }
  const clips: ObjectValue[] = [...(doc.clips ?? [])].sort((a, b) => a.start - b.start);
  for (const clip of clips) {
    number(clip.src);
    number(clip.start);
    number(clip.end);
    if (clip.end <= clip.start) throw new Error('Invalid legacy clip');
    duration = Math.max(duration, clip.src + clip.end - clip.start);
  }
  const sourceTime = (time: number): number => {
    const clip = clips.find((clip) => clip.start - 1e-9 <= time && time <= clip.end + 1e-9);
    return clip ? clip.src + time - clip.start : time;
  };
  let previous = 0;
  const words: ObjectValue[] = doc.words.map((word: ObjectValue) => {
    if (typeof word.id !== 'string' || typeof word.text !== 'string') throw new Error('Invalid legacy word');
    const t0 = Math.max(previous, sourceTime(number(word.t0)));
    const t1 = Math.max(t0, sourceTime(number(word.t1)));
    previous = t1;
    return { ...word, t0, t1, sp: word.sp ?? 's1' };
  });
  duration = Math.max(duration, previous);
  const hidden = idSet(doc.hidden);
  const paragraphBreaks = idSet(doc.paraBreaks);
  const paraBreaks: ObjectValue = {};
  words.forEach((word, i) => {
    if (paragraphBreaks[word.id]) {
      const next = words.slice(i + 1).find((w) => !hidden[w.id]);
      if (next) paraBreaks[next.id] = true;
    }
  });
  const transcript = {
    ...doc,
    words,
    lang: language(entry.lang),
    hidden,
    paraBreaks,
    chapters: (doc.chapters ?? []).map((c: ObjectValue) => ({ ...c, start: sourceTime(number(c.start)), end: sourceTime(number(c.end)) })),
  };
  const kept = clips.filter((clip) => !clip.cut);
  if (clips.length && !kept.length) throw new Error('All legacy clips are cut');
  const outputTime = (time: number) =>
    clips.length ? kept.reduce((sum, c) => sum + Math.max(0, Math.min(time, c.end) - c.start), 0) : time;
  const sources: ObjectValue = {};
  const sourceEntries = Array.isArray(doc.sources) ? doc.sources.map((s: ObjectValue) => [s.id, s]) : Object.entries(object(doc.sources));
  for (const [id, source] of sourceEntries) {
    const s = object(source);
    sources[id] = { ...s, ...(typeof s.path === 'string' ? { path: resolve(s.path) } : {}) };
  }
  sources.main = {
    ...sources.main,
    cuts: clips.filter((c) => c.cut).map((c, i) => ({ id: c.id ?? `cut-${i}`, t0: c.src, t1: c.src + c.end - c.start })),
  };
  const notes: string[] = [];
  const legacyTracks = doc.tracks ?? [
    { id: 'tr-broll', elements: (doc.broll ?? []).map((e: ObjectValue) => ({ ...e, kind: e.kind === 'video' ? 'video' : 'image' })) },
    { id: 'tr-text', elements: (doc.texts ?? []).map((e: ObjectValue) => ({ ...e, kind: 'text' })) },
    ...(doc.watermarks ?? []).map((e: ObjectValue) => ({
      id: `tr-wm-${e.id}`,
      elements: [
        {
          ...e,
          kind: e.kind === 'image' ? 'image' : 'text',
          ...(e.tiled ? { tile: { angle: e.tileAngle, gapX: e.tileGapX, gapY: e.tileGapY, stagger: e.tileStagger } } : {}),
        },
      ],
    })),
  ];
  const tracks = legacyTracks
    .filter((t: ObjectValue) => t.kind !== 'subtitle' && t.id !== 'tr-subs')
    .map((t: ObjectValue) => ({
      ...t,
      kind: t.kind === 'audio' ? 'audio' : 'overlay',
      elements: (t.elements ?? []).flatMap((e: ObjectValue, i: number) => {
        const start = outputTime(e.start ?? 0);
        const end = e.end == null ? undefined : outputTime(e.end);
        if (end !== undefined && end <= start) return [];
        const id = e.id ?? `${t.id}-${i}`;
        let srcId = e.sourceId ?? e.srcId;
        if (typeof e.path === 'string') {
          srcId ??= `source-${id}`;
          sources[srcId] = { kind: e.kind, path: resolve(e.path), width: e.naturalW, height: e.naturalH, duration: e.sourceDuration };
        }
        const animate = e.anim
          ? Object.fromEntries(
              ['enter', 'exit', 'loop']
                .filter((slot) => e.anim[slot])
                .map((slot) => {
                  const animation = { ...e.anim[slot] };
                  if (animation.ease?.kind === 'spring') animation.ease = 'easeOutBack';
                  for (const field of ['edge', 'cycles', 'at'])
                    if (animation[field] !== undefined) {
                      notes.push(`v1-animation-field:${id}:${field}`);
                      delete animation[field];
                    }
                  return [slot, animation];
                }),
            )
          : undefined;
        return [
          {
            ...e,
            id,
            start,
            end,
            srcId,
            animate,
            place: Object.fromEntries(
              ['x', 'y', 'w', 'scale', 'scaleY', 'rot', 'opacity', 'radius'].filter((k) => e[k] !== undefined).map((k) => [k, e[k]]),
            ),
          },
        ];
      }),
    }));
  // v1 translated units are keyed by their first word. Keep that grouping explicitly,
  // rather than pretending they have v2 sentence fingerprints.
  const boundaries = new Set<string>(Object.values(object(doc.trans)).flatMap((table) => Object.keys(object(table))));
  const groups: ObjectValue[][] = [];
  for (const word of words.filter((w) => !hidden[w.id])) {
    const prev = groups.at(-1)?.at(-1);
    if (!prev || boundaries.has(word.id) || doc.breaks?.[prev.id] === 'break' || /[.!?。！？]$/.test(prev.text) || paraBreaks[word.id])
      groups.push([]);
    groups.at(-1)!.push(word);
  }
  const cues = groups.map((group) => ({
    id: `c-${group[0]!.id}`,
    start: group[0]!.t0,
    end: group.at(-1)!.t1,
    text: speechSentences({
      schema: 'baocut.speech/1',
      timescale: 1000000,
      words: group.map((w) => ({
        id: w.id,
        text: w.text,
        start: Math.round(w.t0 * 1000000),
        end: Math.round(w.t1 * 1000000),
        ...(w.glue ? { glue: true } : {}),
      })),
    })
      .sentences.map((sentence) => sentence.text)
      .join(' '),
    words: group,
  }));
  const sentences = groups.map((group) => ({
    id: `s-${group[0]!.id}`,
    sourceWordIds: group.map((w) => w.id),
    paraStart: !!paraBreaks[group[0]!.id],
  }));
  const trans: ObjectValue = {};
  const transCues: ObjectValue[] = [];
  const translated = Object.entries(object(doc.trans));
  for (const [lang, table] of translated) {
    trans[language(lang)] = {};
    const entries = Object.entries(object(table)).sort(
      ([a], [b]) => words.findIndex((w) => w.id === a) - words.findIndex((w) => w.id === b),
    );
    for (const [i, [first, text]] of entries.entries()) {
      const start = words.findIndex((w) => w.id === first);
      const next = words.findIndex((w) => w.id === entries[i + 1]?.[0]);
      if (start < 0 || typeof text !== 'string') {
        notes.push(`v1-translation-unresolved:${lang}:${first}`);
        continue;
      }
      const end = next > start ? next - 1 : words.length - 1;
      trans[language(lang)][`s-${first}`] = text;
      if (lang === translated[0]?.[0])
        transCues.push({ id: `tc-${first}`, sid: `s-${first}`, text, start: words[start]!.t0, end: words[end]!.t1 });
    }
  }
  const subtitleTrack = (doc.tracks ?? []).find((t: ObjectValue) => t.kind === 'subtitle' || t.id === 'tr-subs') ?? {};
  const style = {
    ...(translated.length ? doc.subStyle : (doc.subStyleMono ?? doc.subStyle)),
    mode: translated.length && doc.subShowTrans !== false ? 'bi' : 'orig',
    x: subtitleTrack.x ?? doc.subX ?? 50,
    y: subtitleTrack.y ?? doc.subY ?? 86,
    width: subtitleTrack.w ?? doc.subWidth ?? 90,
    rotation: subtitleTrack.rot ?? doc.subRotation ?? 0,
    ...(doc.captionEmphasis ? { captionEmphasis: doc.captionEmphasis } : {}),
  };
  const plan = planBcutProject(dir, new Set(), {
    'project.json': {
      formatVersion: 'v1',
      title: entry.title ?? path.basename(dir),
      media: { path: media, duration, kind: /\.(mp4|mov|mkv|webm|m4v|avi|ts)$/i.test(media) ? 'video' : 'audio' },
    },
    'transcript.json': { ...transcript, trans },
    'timeline.json': {
      sources,
      clips: kept.map((c, i) => ({ id: c.id ?? `c-${i}`, srcId: c.srcId ?? 'main', in: c.src, out: c.src + c.end - c.start, rate: 1 })),
      tracks,
      main: { place: doc.main, muted: doc.videoTrackMuted === true, background: doc.main?.bg },
    },
    'studio/data.json': { cues, sentences, transCues, meta: { targetLang: { code: language(translated[0]?.[0]) } } },
    'studio/style.json': style,
  });
  if (!plan) throw new Error('Invalid legacy project');
  plan.report.notImported.push(...notes);
  return plan;
}
