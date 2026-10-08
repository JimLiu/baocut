import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Id, MissingAsset, Sequence, VersionRef } from '@baocut/protocol';
import {
  STAGE_MEDIA_COPY as C,
  assetsFingerprint,
  notePlayback,
  recoveredAssets,
  stageMediaNotice,
  unplayableRefs,
  type MediaOutcome,
  type PlaybackLog,
  type StageMediaNotice,
} from '../../model/stage-media.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { canEdit, useVideo } from '../../state/video-store.ts';
import { EDITOR_COPY as E } from './editor-copy.ts';

/** 卡还在时多久再查一次：盘接上了、文件挪回来了，不用重开视频就能恢复。 */
const POLL_MS = 5000;
/** 源元素取不到地址时，攒一会儿再查（同一时刻往往好几个元素一起失败）。 */
const UNRESOLVED_DEBOUNCE_MS = 400;

export interface StageMedia {
  /** 卡片内容；主媒体都放得出来时是 null。 */
  notice: StageMediaNotice | null;
  /** 这个素材恢复过几次：预览的源元素按它重挂，重新取地址、重新载入。 */
  revived(assetId: Id): number;
  /** 源元素的一次载入结果。稳定的回调。 */
  report(mediaKey: string, ref: VersionRef, outcome: MediaOutcome): void;
  /** 选文件并重新关联卡上那个素材。 */
  relink(): void;
  /** 正在核对内容（大文件要几秒）。 */
  busy: boolean;
  /** 能提交修改（视频已追平）。 */
  canRelink: boolean;
  /** 上一次重新关联失败的原因（引擎的原话）。 */
  error: string | null;
}

/**
 * 主媒体放得出来没有（设计稿 model-stage-media.js）：查 `videos.assetStatus`，并收预览源元素的载入结果。
 *
 * 什么时候查：视频追平（打开、重新连上）、收到 `video.replaced`、素材登记变了（提交了素材类操作，包括别的窗口和智能体）、
 * 窗口回到前台、源元素取不到地址；卡还在时每隔几秒再查一次（盘接上就自动恢复）。只认最后一次查询的结果。
 */
export function useStageMedia(videoId: Id | null, sequence: Sequence): StageMedia {
  const runtime = useRuntime();
  const ready = useVideo((s) => s.video?.status === 'ready');
  const editable = useVideo((s) => canEdit(s.video));
  const replaced = useVideo((s) => s.video?.replaced ?? 0);
  const assets = useVideo((s) => s.video?.state?.video.assets);
  const fingerprint = useMemo(() => (assets ? assetsFingerprint(assets) : ''), [assets]);

  // 结果按视频记：切换视频时不串用上一个视频的结果。
  const [status, setStatus] = useState<{ videoId: Id; missing: MissingAsset[] } | null>(null);
  const [revive, setRevive] = useState<{ videoId: Id | null; counts: Record<Id, number> }>({ videoId: null, counts: {} });
  const [log, setLog] = useState<{ videoId: Id | null; entries: PlaybackLog }>({ videoId: null, entries: {} });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ videoId: Id; assetId: Id; message: string } | null>(null);

  const latest = useRef(0);
  const previous = useRef<{ videoId: Id; missing: MissingAsset[] } | null>(null);
  const check = useCallback(async () => {
    if (!videoId) return;
    const n = ++latest.current;
    let missing: MissingAsset[];
    try {
      ({ missing } = await runtime.client.request('videos.assetStatus', { videoId }));
    } catch {
      return; // 断线或视频关了：重新追平后再查。
    }
    if (n !== latest.current) return;
    const before = previous.current?.videoId === videoId ? previous.current.missing : null;
    previous.current = { videoId, missing };
    const back = recoveredAssets(before, missing);
    if (back.length) {
      setRevive((r) => {
        const counts = r.videoId === videoId ? { ...r.counts } : {};
        for (const id of back) counts[id] = (counts[id] ?? 0) + 1;
        return { videoId, counts };
      });
    }
    setStatus({ videoId, missing });
  }, [runtime, videoId]);

  useEffect(() => {
    if (ready) void check();
  }, [check, ready, replaced, fingerprint]);

  useEffect(() => {
    if (!ready) return;
    const onFocus = () => void check();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [check, ready]);

  // 换了视频（`check` 跟着换）或卸载时撤掉还没到点的那次：不拿上一个视频去查，免得抢掉新视频的结果。
  const unresolvedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (unresolvedTimer.current) clearTimeout(unresolvedTimer.current);
      unresolvedTimer.current = null;
    },
    [check],
  );

  const report = useCallback(
    (mediaKey: string, ref: VersionRef, outcome: MediaOutcome) => {
      if (outcome.kind === 'unresolved') {
        if (unresolvedTimer.current) clearTimeout(unresolvedTimer.current);
        unresolvedTimer.current = setTimeout(() => void check(), UNRESOLVED_DEBOUNCE_MS);
        return;
      }
      setLog((current) => {
        const entries = current.videoId === videoId ? current.entries : {};
        const next = notePlayback(entries, mediaKey, ref, outcome);
        return next === entries && current.videoId === videoId ? current : { videoId, entries: next };
      });
    },
    [videoId, check],
  );

  const missing = status && status.videoId === videoId ? status.missing : null;
  const unplayable = useMemo(() => unplayableRefs(log.videoId === videoId ? log.entries : {}), [log, videoId]);
  const canPick = !!runtime.host.pickFiles;
  const notice = useMemo(
    () => (assets ? stageMediaNotice({ sequence, assets, missing, unplayable, canPick }) : null),
    [sequence, assets, missing, unplayable, canPick],
  );

  // 读不到的还在：隔几秒再查。播放器打不开的不轮询（文件在，查了也一样）。
  const waiting = !!notice && notice.kind !== 'unplayable' && ready;
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => void check(), POLL_MS);
    return () => clearInterval(timer);
  }, [check, waiting]);

  const target = notice?.relink ?? null;
  const relink = useCallback(async () => {
    const pick = runtime.host.pickFiles;
    if (!target || !pick || !videoId || busy) return;
    const [path] = await pick({ title: C.pickTitle(target.name), buttonLabel: C.pickButton });
    if (!path) return;
    setError(null);
    setBusy(true);
    // 失败的原因记在视频 store 里，编辑器随即弹提示并清掉它：在它被清掉之前接住。
    let failure: string | null = null;
    const unsubscribe = useVideo.subscribe((s) => {
      const reason = s.video?.commandError?.message;
      if (reason) failure = reason;
    });
    try {
      const receipt = await runtime.videos.apply([{ type: 'relinkAsset', assetId: target.assetId, path }], C.label(target.name));
      if (!receipt) {
        const reason = failure ?? useVideo.getState().video?.commandError?.message ?? E.notEditableNow;
        setError({ videoId, assetId: target.assetId, message: C.relinkFailed(reason) });
      }
    } finally {
      unsubscribe();
      setBusy(false);
    }
    await check();
  }, [runtime, target, videoId, busy, check]);

  const revived = useCallback((assetId: Id) => (revive.videoId === videoId ? (revive.counts[assetId] ?? 0) : 0), [revive, videoId]);

  return {
    notice,
    revived,
    report,
    relink: () => void relink(),
    busy,
    canRelink: editable,
    error: error && error.videoId === videoId && error.assetId === target?.assetId ? error.message : null,
  };
}
