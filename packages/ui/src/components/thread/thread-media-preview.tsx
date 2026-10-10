import { useEffect, useRef, useState } from 'react';
import type { MediaHandle, MediaTarget } from '@baocut/protocol';
import { ActionButton, LinkButton, ToastQueue } from '@react-spectrum/s2';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { useRuntime } from '../../runtime/context.tsx';
import { conversationVisible, useShell } from '../../state/shell-store.ts';
import { useDirectory } from '../../state/directory-store.ts';
import { useSpace } from '../../state/space-store.ts';
import { useImagePreview } from '../../state/image-preview-store.ts';
import { markdownAbsolutePath, markdownFilePath, markdownOpenAction } from '../../model/markdown-file-link.ts';
import { pauseOtherPreviews } from '../../model/image-preview.ts';
import { resolvedPreviewMode } from '../../model/file-preview.ts';
import { IMAGE as M } from '../image-preview-copy.ts';
import { CompactPlayer } from '../media/compact-player.tsx';
import { InlineImageGallery } from '../media/image-lightbox.tsx';
import { previewMemoryKey, targetKey } from '../../model/media.ts';
import { S } from '../shell-copy.ts';

const inline = style({ display: 'inline-flex', flexDirection: 'column', maxWidth: 'full', gap: 8, verticalAlign: 'top' });
const media = style({ display: 'block', width: 'full', maxWidth: '[480px]', maxHeight: '[320px]', objectFit: 'contain', borderRadius: 'default' });
const actions = style({ display: 'flex', flexWrap: 'wrap', gap: 8 });

/**
 * 打开回复里的文件路径（显式链接、行内路径与正文媒体同一套，见 `markdownOpenAction`）：文件标签，或桌面端查看器不支持的
 * 类型交给系统默认应用（打不开时在文件夹中显示）。
 */
export function openMarkdownPath(path: string, scope: { conversationId: string; cwd: string | null }, runtime: ReturnType<typeof useRuntime>): void {
  const action = markdownOpenAction(path, scope, useSpace.getState().entries, useDirectory.getState(), { desktop: !!runtime.host.openFile });
  if (action.kind === 'pane') {
    useShell.getState().openPane({ kind: 'file', target: action.target });
    return;
  }
  const absolute = action.path;
  void runtime.host.openFile!(absolute).then(async (error) => {
    if (error === null) await runtime.host.revealPath(absolute);
    else if (error) ToastQueue.negative(S.filePreview.failed(error));
  }).catch((error: Error) => ToastQueue.negative(S.filePreview.failed(error.message)));
}

/**
 * Markdown 本机媒体用受限句柄；点图开文件标签，视频在正文播放。定位与文件链接相同：桌面端工作目录外、没有条目的图片按
 * 本机路径取句柄；浏览器仍按会话路径请求，由 Runtime 报告不可用。查看器不支持的类型不取句柄，按钮交给系统默认应用。
 */
export function ThreadMediaPreview({ src, alt, scope, block, offset }: { block: number; offset: number; src: string; alt: string; scope: { conversationId: string; cwd: string | null; mediaGroup: string } }) {
  const path = markdownFilePath(src);
  if (!path) return <img className={media} src={src} alt={alt} loading="lazy" />;
  return <LocalThreadMedia key={src} path={path} alt={alt} scope={scope} block={block} offset={offset} />;
}
function LocalThreadMedia({ path, alt, scope, block, offset }: { block: number; offset: number; path: string; alt: string; scope: { conversationId: string; cwd: string | null; mediaGroup: string } }) {
  const runtime = useRuntime(), video = useRef<HTMLVideoElement>(null), audio = useRef<HTMLAudioElement>(null);
  const [loaded, setLoaded] = useState<{ handle: MediaHandle; target: MediaTarget } | null>(null);
  const [failed, setFailed] = useState(false);
  const visible = useShell(s => conversationVisible(s, scope.conversationId));
  const name = path.split(/[\\/]/).pop() || alt;
  useEffect(() => {
    let cancelled = false;
    const action = markdownOpenAction(path, scope, useSpace.getState().entries, useDirectory.getState(), { desktop: !!runtime.host.openFile });
    if (action.kind === 'system') {
      setFailed(true);
      return;
    }
    const target = action.target;
    void runtime.resolveMedia(target).then(handle => {
      if (cancelled) return;
      setLoaded({ handle, target });
      if (resolvedPreviewMode(name, handle, null) === 'image') useImagePreview.getState().register(scope.mediaGroup, { target, name, handle, conversationId:scope.conversationId, generated:true, order: [block, offset] });
    }).catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [runtime, path, name, scope, block, offset]);
  useEffect(() => { if (!visible) { video.current?.pause(); audio.current?.pause(); } }, [visible]);
  useEffect(() => { const element = video.current, sound = audio.current; return () => { element?.pause(); sound?.pause(); }; }, [loaded]);
  const open = () => {
    video.current?.pause(); audio.current?.pause();
    useImagePreview.getState().activate(scope.mediaGroup);
    if (loaded) useShell.getState().openPane({ kind: 'file', target: loaded.target });
    else openMarkdownPath(path, scope, runtime);
  };
  const mode = loaded && resolvedPreviewMode(name, loaded.handle, null);
  if (failed || !loaded || (mode !== 'image' && mode !== 'video' && mode !== 'audio')) return <span className={inline}>
    <ActionButton onPress={open}>{alt || name}</ActionButton>{failed ? <span role="status">{S.filePreview.unsupported}</span> : null}
  </span>;
  if(mode==='image')return <InlineImageGallery candidate={{target:loaded.target,name,handle:loaded.handle,conversationId:scope.conversationId,generated:true,order:[block,offset]}} group={scope.mediaGroup} conversationId={scope.conversationId}/>;
  return <span className={inline} style={{width:'100%',maxWidth:mode==='audio'?512:704}}><CompactPlayer handle={loaded.handle} fileName={name} kind={mode} memoryKey={previewMemoryKey(loaded.target,useSpace.getState().entries,useDirectory.getState().conversations)} active={visible} onOpenTab={open} path={markdownAbsolutePath(path,scope.cwd)??path}/></span>;
}
