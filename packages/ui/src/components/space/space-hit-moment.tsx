import { useEffect, useRef, useState } from 'react';
import { SPACE_HIT_MOMENTS_MAX, type Id, type SpaceHitMoment, type SpaceHitMomentSpan, type SpaceSearchHit } from '@baocut/protocol';
import { ActionButton, Button, ButtonGroup, Content, Dialog, DialogContainer, Heading, ProgressCircle, Text } from '@react-spectrum/s2';
import Pause from '@react-spectrum/s2/icons/Pause';
import Play from '@react-spectrum/s2/icons/Play';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { snippetParts } from '../../model/space-search.ts';
import type { RuntimeSession } from '../../runtime/session.ts';
import { SPACE_COPY as COPY } from './space-copy.ts';

/*
 * 检索命中的那一刻（创作辅助集成设计 §2.1「命中原因与那一刻」；设计稿 space-search.jsx `ResultCard` 的小图与 `Preview` / `Moment`）：
 * 命中行左边是那一刻看得见的那一帧，点开是预览框：就地播这一段（命中前后各 2 秒，命中本身在进度条上标出来）、写为什么命中、
 * 「在时间线打开」。画面与那一段都按视频当前的工作稿由 Runtime 找（`space.hitMoments`），不打开视频；播的是素材原片，没有
 * 时间线上的剪辑、字幕与叠加。
 */

/** `settled`：已经有回音（拿到了或那一批失败了）的命中；不在里面的还在等。 */
type Moments = { revision: string; byKey: Map<string, SpaceHitMoment>; settled: Set<string> };

const momentKey = (hit: Pick<SpaceSearchHit, 'time' | 'documentId'>) =>
  `${hit.time.clock}:${hit.time.start}:${hit.time.end}:${hit.documentId ?? ''}`;

const spanOf = (hit: Pick<SpaceSearchHit, 'time' | 'documentId'>): SpaceHitMomentSpan => ({
  clock: hit.time.clock,
  startSec: hit.time.start,
  endSec: Math.max(hit.time.start, hit.time.end),
  documentId: hit.documentId,
});

/**
 * 一组命中（同一个视频、这一页给出来的几条）的那一刻：分批向 Runtime 要，哪一批先回来先画哪一批；失败了只是不画，不打扰。
 * 没有视频条目时返回 null（不会去要）。
 */
export function useGroupMoments(runtime: RuntimeSession, entryId: Id | null, hits: readonly SpaceSearchHit[]): Moments | null {
  const unique = [...new Map(hits.map((hit) => [momentKey(hit), hit])).values()];
  const key = entryId ? `${entryId}\n${unique.map(momentKey).join('\n')}` : '';
  const [state, setState] = useState<{ key: string; moments: Moments } | null>(null);
  const latest = useRef(unique);
  latest.current = unique;

  useEffect(() => {
    if (!entryId || !key) return;
    let cancelled = false;
    const list = latest.current;
    const empty: Moments = { revision: '', byKey: new Map(), settled: new Set() };
    setState({ key, moments: empty });
    for (let i = 0; i < list.length; i += SPACE_HIT_MOMENTS_MAX) {
      const batch = list.slice(i, i + SPACE_HIT_MOMENTS_MAX);
      void runtime.client
        .request('space.hitMoments', { entryId, spans: batch.map(spanOf) })
        .then(
          (result) => result,
          () => null,
        )
        .then((result) => {
          if (cancelled) return;
          setState((prev) => {
            const base = prev?.key === key ? prev.moments : empty;
            const byKey = new Map(base.byKey);
            const settled = new Set(base.settled);
            batch.forEach((hit, index) => {
              const moment = result?.moments[index];
              if (moment) byKey.set(momentKey(hit), moment);
              settled.add(momentKey(hit));
            });
            return { key, moments: { revision: result?.revision ?? base.revision, byKey, settled } };
          });
        });
    }
    return () => {
      cancelled = true;
    };
  }, [runtime, entryId, key]);

  if (!entryId) return null;
  return state?.key === key ? state.moments : { revision: '', byKey: new Map(), settled: new Set() };
}

export function momentOf(moments: Moments | null, hit: Pick<SpaceSearchHit, 'time' | 'documentId'>): SpaceHitMoment | null {
  return moments?.byKey.get(momentKey(hit)) ?? null;
}

/** 这条命中的那一刻还在路上（已经去要、还没回音）。 */
export function momentPending(moments: Moments | null, hit: Pick<SpaceSearchHit, 'time' | 'documentId'>): boolean {
  return !!moments && !moments.settled.has(momentKey(hit));
}

const frameUrl = (frame: SpaceHitMoment['frame'] | undefined) =>
  frame?.kind === 'image' ? `data:${frame.mimeType};base64,${frame.data}` : null;

const thumb = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  width: 96,
  aspectRatio: '16/9',
  borderRadius: 'sm',
  overflow: 'hidden',
  backgroundColor: 'gray-200',
});
const thumbImage = style({ display: 'block', width: 'full', height: 'full', objectFit: 'cover' });

/** 命中行的小图：那一刻看得见的那一帧；还在取时灰底上转一个圈，没有画面时只是灰底占位（行与行对齐）。 */
export function MomentThumb({ moment, pending }: { moment: SpaceHitMoment | null; pending: boolean }) {
  const url = frameUrl(moment?.frame);
  return (
    <span className={thumb} data-bc-icons="own" aria-hidden>
      {url ? (
        <img className={thumbImage} src={url} alt="" decoding="async" />
      ) : pending ? (
        <ProgressCircle isIndeterminate size="S" aria-label={COPY.momentLoading} />
      ) : null}
    </span>
  );
}

const body = style({ display: 'flex', flexDirection: 'column', gap: 12 });
const stage = style({
  position: 'relative',
  width: 'full',
  aspectRatio: '16/9',
  borderRadius: 'default',
  overflow: 'hidden',
  backgroundColor: 'black',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
});
const media = style({ display: 'block', width: 'full', height: 'full', objectFit: 'contain' });
const controls = style({ display: 'flex', alignItems: 'center', gap: 8 });
const track = style({
  position: 'relative',
  flexGrow: 1,
  height: 6,
  borderRadius: 'full',
  backgroundColor: 'gray-200',
  overflow: 'hidden',
});
const hitSpan = style({ position: 'absolute', top: 0, bottom: 0, backgroundColor: 'accent-800' });
const head = style({ position: 'absolute', top: 0, bottom: 0, width: 2, backgroundColor: 'gray-900' });
const meta = style({ font: 'ui-sm', color: 'gray-700', margin: 0 });
const note = style({ font: 'ui-xs', color: 'gray-600', margin: 0 });
const snippet = style({ font: 'body-sm', color: 'gray-900', margin: 0, overflowWrap: 'anywhere' });
const mark = style({ backgroundColor: 'yellow-400', color: 'gray-900', borderRadius: 'sm' });

/**
 * 命中的预览框：那一刻的画面与就地播放的一段、在哪、为什么命中、原句；「在时间线打开」交回原来的打开路径（跳到那一秒、
 * 必要时按当前版本重新解析）。那一刻还没取到（行上的批量请求没回来或失败了）时单独要一次。
 */
export function HitPreview({
  runtime,
  entryId,
  hit,
  moment,
  revision,
  where,
  why,
  onOpen,
  onClose,
}: {
  runtime: RuntimeSession;
  entryId: Id | null;
  hit: SpaceSearchHit | null;
  moment: SpaceHitMoment | null;
  revision: string | null;
  where: string;
  why: string;
  onOpen: () => void;
  onClose: () => void;
}) {
  return (
    <DialogContainer onDismiss={onClose}>
      {hit ? (
        <Dialog size="M">
          {({ close }) => (
            <>
              <Heading slot="title">{hit.videoName}</Heading>
              <Content>
                <PreviewBody runtime={runtime} entryId={entryId} hit={hit} moment={moment} revision={revision} where={where} why={why} />
              </Content>
              <ButtonGroup>
                <Button variant="secondary" onPress={close}>
                  {COPY.momentClose}
                </Button>
                <Button
                  variant="accent"
                  onPress={() => {
                    close();
                    onOpen();
                  }}>
                  {COPY.momentOpen}
                </Button>
              </ButtonGroup>
            </>
          )}
        </Dialog>
      ) : null}
    </DialogContainer>
  );
}

function PreviewBody({
  runtime,
  entryId,
  hit,
  moment: given,
  revision: givenRevision,
  where,
  why,
}: {
  runtime: RuntimeSession;
  entryId: Id | null;
  hit: SpaceSearchHit;
  moment: SpaceHitMoment | null;
  revision: string | null;
  where: string;
  why: string;
}) {
  const [fetched, setFetched] = useState<{ moment: SpaceHitMoment | null; revision: string | null } | 'loading' | null>(null);
  useEffect(() => {
    if (given || !entryId) return;
    let cancelled = false;
    setFetched('loading');
    runtime.client.request('space.hitMoments', { entryId, spans: [spanOf(hit)] }).then(
      (result) => !cancelled && setFetched({ moment: result.moments[0] ?? null, revision: result.revision }),
      () => !cancelled && setFetched({ moment: null, revision: null }),
    );
    return () => {
      cancelled = true;
    };
  }, [runtime, entryId, hit, given]);
  const loading = !given && fetched === 'loading';
  const moment = given ?? (fetched && fetched !== 'loading' ? fetched.moment : null);
  const revision = given ? givenRevision : fetched && fetched !== 'loading' ? fetched.revision : null;
  const stale = revision !== null && revision !== '' && revision !== hit.indexedRevision;
  return (
    <div className={body}>
      {loading ? (
        <div className={stage}>
          <ProgressCircle isIndeterminate size="S" aria-label={COPY.hitsSearching} />
        </div>
      ) : moment?.clip && entryId ? (
        <MomentPlayer runtime={runtime} entryId={entryId} clip={moment.clip} poster={frameUrl(moment.frame)} />
      ) : (
        <>
          {frameUrl(moment?.frame) ? (
            <div className={stage} data-bc-icons="own">
              <img className={media} src={frameUrl(moment?.frame)!} alt="" />
            </div>
          ) : null}
          <p className={note}>{COPY.momentNoClip}</p>
        </>
      )}
      <p className={meta}>{where}</p>
      <p className={meta}>{COPY.momentWhy(why)}</p>
      <p className={snippet}>
        {snippetParts(hit.snippet, hit.highlights).map((part, i) =>
          part.hit ? (
            <mark key={i} className={mark}>
              {part.text}
            </mark>
          ) : (
            <span key={i}>{part.text}</span>
          ),
        )}
      </p>
      {stale ? <p className={note}>{COPY.hitStale}</p> : null}
    </div>
  );
}

/**
 * 就地播的一段（设计稿 `Moment`）：素材原片从 `from` 播到 `to` 停下，进度条上标出命中本身。点了「播放这一段」才去要媒体地址
 * （`media.resolve` 的视频条目素材，再经 `media.playback` 拿浏览器放得了的地址），之前只画那一帧。
 */
function MomentPlayer({
  runtime,
  entryId,
  clip,
  poster,
}: {
  runtime: RuntimeSession;
  entryId: Id;
  clip: NonNullable<SpaceHitMoment['clip']>;
  poster: string | null;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'playing' | 'paused' | 'failed'>('idle');
  const [error, setError] = useState('');
  const [time, setTime] = useState(clip.from);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  const length = Math.max(0.001, clip.to - clip.from);
  const pct = (t: number) => `${Math.min(100, Math.max(0, ((t - clip.from) / length) * 100))}%`;

  const start = (element: HTMLVideoElement) => {
    if (element.currentTime < clip.from || element.currentTime >= clip.to - 0.05) element.currentTime = clip.from;
    void element.play().then(
      () => setState('playing'),
      () => setState('paused'),
    );
  };

  const play = () => {
    const element = video.current;
    if (url && element) {
      start(element);
      return;
    }
    setState('loading');
    const controller = new AbortController();
    abort.current = controller;
    runtime
      .resolveMedia({ entryId, assetId: clip.assetId, revision: clip.revision })
      .then((handle) => runtime.playbackMedia(handle, controller.signal))
      .then(
        (playable) => !controller.signal.aborted && setUrl(playable.url),
        (e: unknown) => {
          if (controller.signal.aborted) return;
          setError(e instanceof Error ? e.message : String(e));
          setState('failed');
        },
      );
  };

  const pause = () => {
    video.current?.pause();
    setState('paused');
  };

  return (
    <>
      <div className={stage} data-bc-icons="own">
        {url ? (
          <video
            ref={video}
            className={media}
            src={url}
            poster={poster ?? undefined}
            preload="auto"
            playsInline
            onLoadedMetadata={(e) => {
              e.currentTarget.currentTime = clip.from;
              start(e.currentTarget);
            }}
            onTimeUpdate={(e) => {
              const t = e.currentTarget.currentTime;
              setTime(t);
              if (t >= clip.to) {
                e.currentTarget.pause();
                setState('paused');
              }
            }}
            onPause={() => setState((s) => (s === 'playing' ? 'paused' : s))}
            onError={(e) => {
              const failure = e.currentTarget.error;
              setError(failure?.message || `MediaError ${failure?.code ?? ''}`.trim());
              setState('failed');
            }}
          />
        ) : poster ? (
          <img className={media} src={poster} alt="" />
        ) : null}
      </div>
      <div className={controls}>
        <ActionButton size="S" isPending={state === 'loading'} onPress={state === 'playing' ? pause : play}>
          {state === 'playing' ? <Pause /> : <Play />}
          <Text>{state === 'playing' ? COPY.momentPause : COPY.momentPlay}</Text>
        </ActionButton>
        <div className={track} aria-hidden>
          <span className={hitSpan} style={{ left: pct(clip.hitFrom), width: `max(4px, ${pct(clip.hitTo)} - ${pct(clip.hitFrom)})` }} />
          {url ? <span className={head} style={{ left: pct(time) }} /> : null}
        </div>
      </div>
      {state === 'failed' ? <p className={note}>{COPY.momentFailed(error)}</p> : null}
    </>
  );
}
