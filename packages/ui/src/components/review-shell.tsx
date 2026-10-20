import { useEffect, useState } from 'react';
import type { Id } from '@baocut/protocol';
import { Button, Content, Heading, IllustratedMessage, ProgressCircle } from '@react-spectrum/s2';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { useRuntime } from '../runtime/context.tsx';
import { useShell } from '../state/shell-store.ts';
import { useVideo } from '../state/video-store.ts';
import { ConnectionBanner } from './connection-banner.tsx';
import { EditorWorkspace } from './editor/editor-workspace.tsx';
import { EDITOR_COPY as E } from './editor/editor-copy.ts';

const frame = style({ display: 'flex', flexDirection: 'column', height: 'screen', backgroundColor: 'gray-25' });
const centered = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 12,
  flexGrow: 1,
  font: 'ui',
  color: 'neutral-subdued',
});

/**
 * 审片页（Web 的 `/review/<videoId>`，架构设计 §12.8、轻量编辑器设计 §4.1）：整个窗口只有这一部视频的编辑器，
 * 没有侧栏、会话、Space 与设置，也没有离开它的入口。默认落在轻量视图，可以切到时间线；改动照常写进视频。
 * 会话本身只订阅设置（RuntimeSession 的审片模式），视频经 `videos.target` 找到再打开。
 */
export function ReviewShell({ videoId }: { videoId: Id }) {
  const runtime = useRuntime();
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const name = useVideo((s) => s.video?.state?.video.name ?? s.video?.ref?.name ?? null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    // 第一次打开落在轻量视图（编辑器按路由上的 `view` 定一次，之后按这部视频记住的选择）。
    useShell.getState().replace({ tab: 'home', conversationId: null, projectId: null, view: 'lite' });
    runtime.client.request('videos.target', { videoId }).then(
      ({ target }) => {
        if (!cancelled) runtime.videos.open(target);
      },
      (cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [runtime, videoId, attempt]);

  useEffect(() => {
    if (name) document.title = `${name} · BaoCut`;
  }, [name]);

  return (
    <div className={frame}>
      <ConnectionBanner />
      {error ? (
        <div className={centered}>
          <IllustratedMessage size="S">
            <Heading>{E.cantOpen}</Heading>
            <Content>{error}</Content>
          </IllustratedMessage>
          <Button variant="secondary" onPress={() => setAttempt((n) => n + 1)}>
            {E.retry}
          </Button>
        </div>
      ) : (
        <ReviewEditor />
      )}
    </div>
  );
}

function ReviewEditor() {
  const opened = useVideo((s) => s.video !== null);
  if (opened) return <EditorWorkspace />;
  return (
    <div className={centered}>
      <ProgressCircle isIndeterminate aria-label={E.openingAria} />
      <span>{E.opening}</span>
    </div>
  );
}
