import { useState } from 'react';
import type { MediaTarget, MediaHandle } from '@baocut/protocol';
import { ActionButton, Button, ToastQueue, Tooltip, TooltipTrigger } from '@react-spectrum/s2';
import FileText from '@react-spectrum/s2/icons/FileText';
import OpenIn from '@react-spectrum/s2/icons/OpenIn';
import { iconStyle, style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { WORKSPACE_COPY } from '../copy.ts';
import { S } from './shell-copy.ts';
import { previewMemoryKey, targetKey } from '../model/media.ts';
import { entryPath, formatBytes, KIND_LABEL, kindOfFileName } from '../model/space.ts';
import { entryOfTarget } from '../model/workspace.ts';
import { useRuntime } from '../runtime/context.tsx';
import { useDirectory } from '../state/directory-store.ts';
import { useShell } from '../state/shell-store.ts';
import { useSpace } from '../state/space-store.ts';
import { FilePreview, DocumentViewControl } from './file-preview.tsx';
import { useSaveDownload } from './media/save-download.ts';
import { PANEL as M } from './panel-copy.ts';
import { type FilePreviewMode } from '../model/file-preview.ts';
import { markdownAbsolutePath } from '../model/markdown-file-link.ts';
import { generatedImageGallery } from '../model/image-preview.ts';
import { useImagePreview } from '../state/image-preview-store.ts';
import { IMAGE } from './image-preview-copy.ts';
import { itemKey } from '../model/workspace.ts';
import { DESIGN } from '../model/design-copy.ts';
import { DESIGN_SYSTEM } from '../model/design-system-copy.ts';
import { DOCS } from '../model/docs-copy.ts';
import { SLIDES } from '../model/slides-copy.ts';

const pane = style({ display: 'flex', flexDirection: 'column', flexGrow: 1, minWidth: 0, minHeight: 0 });
/** 单文件头（原型 home-workspace.css `.home-resource__bar`）。 */
const bar = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 8,
  flexShrink: 0,
  minHeight: 56,
  boxSizing: 'border-box',
  paddingX: 16,
  paddingY: 12,
  borderBottomWidth: 2,
  borderTopWidth: 0,
  borderStartWidth: 0,
  borderEndWidth: 0,
  borderStyle: 'solid',
  borderColor: 'gray-100',
});
const headIcon = iconStyle({ size: 'M' });
const headText = style({ display: 'flex', flexDirection: 'column', gap: 4, flexGrow: 1, minWidth: 0 });
const name = style({ font: 'ui', fontWeight: 'bold', color: 'gray-900', overflowWrap: 'anywhere' });
const meta = style({ font: 'ui-sm', color: 'gray-600' });
const body = style({ flexGrow: 1, minHeight: 0, overflowY: 'auto', paddingX: 24, paddingY: 16 });
const playerBody = style({ display: 'flex', flexDirection: 'column', flexGrow: 1, minHeight: 0, paddingX: 16, paddingY: 16 });
/** 页脚路径（原型 `.home-resource__path`）。 */
const footer = style({
  flexShrink: 0,
  paddingX: 16,
  paddingY: 8,
  font: 'ui-xs',
  color: 'gray-600',
  overflowWrap: 'anywhere',
  borderTopWidth: 1,
  borderBottomWidth: 0,
  borderStartWidth: 0,
  borderEndWidth: 0,
  borderStyle: 'solid',
  borderColor: 'gray-100',
});
const missing = style({ display: 'flex', alignItems: 'center', justifyContent: 'center', flexGrow: 1, font: 'ui', color: 'gray-600' });

/**
 * 功能区的单个文件（产品设计 §3.3，原型 home-workspace.jsx `WorkspaceFiles` 的单文件视图）：头部是图标、文件名与类别，
 * 「在 Space 中显示」与「在文件夹中显示」；视频与音频用播放器，其余用查看器；页脚是磁盘上的路径。宽度由功能区决定。
 * 桌面端工作目录之外的本机文件（`{ localPath }`）只读预览，保留「用默认应用打开」与「在文件夹中显示」，不在 Space 中显示。
 */
export function FilePane({ target, conversationId, fileNameHint, active = true }: { active?:boolean; fileNameHint?:string; target: MediaTarget; conversationId?: string | null }) {
  const runtime = useRuntime();
  const save = useSaveDownload();
  const [source, setSource] = useState(false);
  const [resolved, setResolved] = useState<{ handle: MediaHandle; mode: FilePreviewMode | null } | null>(null);
  const go = useShell((s) => s.go);
  const entries = useSpace((s) => s.entries);
  const projects = useDirectory((s) => s.projects);
  const conversations = useDirectory((s) => s.conversations);
  const groups = useImagePreview(s => s.groups);
  const activeGroup = useImagePreview(s => s.activeGroups[targetKey(target)]);
  const entry = entryOfTarget(entries, target);
  if ('entryId' in target && !entry) return <div className={missing}>{WORKSPACE_COPY.fileMissing}</div>;

  // 桌面端工作目录之外的本机文件（`{ localPath }`）：没有来源目录，名字取路径的最后一段，按绝对路径打开与定位。
  const local = 'localPath' in target ? target.localPath : null;
  const relPath = 'path' in target ? target.path : local ? (local.split(/[\\/]/).pop() ?? '') : (entry?.relPath ?? '');
  const fileName = entry?.fileName ?? resolved?.handle.fileName ?? fileNameHint ?? relPath.split(/[\\/]/).pop()!;
  const kind = entry?.kind ?? kindOfFileName(fileName);
  const conversation = 'conversationId' in target ? conversations.find((c) => c.id === target.conversationId) : undefined;
  const projectId = 'projectId' in target ? target.projectId : (entry?.source.projectId ?? conversation?.projectId ?? null);
  const root = 'projectId' in target ? projects.find((p) => p.id === target.projectId)?.path : conversation?.cwd;
  const absolute = local ?? (entry ? entryPath(entry, { projects, conversations }) : 'path' in target ? markdownAbsolutePath(relPath, root ?? null) : null);
  const mode = resolved?.mode;
  const detectedKind = resolved?.handle.contentKind;
  const typeLabel = detectedKind ? ({ text: KIND_LABEL.document, pdf: KIND_LABEL.document, image: KIND_LABEL.image, audio: KIND_LABEL.audio, video: KIND_LABEL['video-file'], archive: '', binary: '' })[detectedKind] : kind ? KIND_LABEL[kind] : '';
  const metadata = [typeLabel, resolved ? formatBytes(resolved.handle.size) : ''].filter(Boolean).join(' · ');
  // 项目里的文件从会话还是从 Space 打开，播放位置记在一处。
  const memoryKey = previewMemoryKey(target,entries,conversations);
  const gallery = (activeGroup ? groups[activeGroup] : undefined)
    ?? generatedImageGallery({ target, name: fileName }, entries);
  // 打开的是一份幻灯片的 `deck.json`：可以改用幻灯片编辑器打开它所在的目录（docs/design/slides §8.1）。是不是合法的 deck 由 slides.open 判断。
  const deckDir = 'path' in target && /(^|[\\/])deck\.json$/.test(target.path) ? target.path.replace(/[\\/]?deck\.json$/, '') : null;
  const openDeck = () => {
    if (deckDir === null || !('path' in target)) return;
    const deck = 'projectId' in target ? { projectId: target.projectId, path: deckDir } : { conversationId: target.conversationId, path: deckDir };
    useShell.getState().openPane({ kind: 'slides', target: deck });
  };
  // 打开的是一份设计稿的 `canvas.json`：同样改用设计稿编辑器打开它所在的目录（docs/design/canvas §8.1）；认不认得出由 design.open 判断。
  const canvasDir = 'path' in target && /(^|[\\/])canvas\.json$/.test(target.path) ? target.path.replace(/[\\/]?canvas\.json$/, '') : null;
  const openCanvas = () => {
    if (canvasDir === null || !('path' in target)) return;
    const canvas = 'projectId' in target ? { projectId: target.projectId, path: canvasDir } : { conversationId: target.conversationId, path: canvasDir };
    useShell.getState().openPane({ kind: 'design', target: canvas });
  };
  // 打开的是一套设计系统的 `design-system.json`：改用设计系统编辑器打开它所在的目录（docs/design/canvas §10）；认不认得出由 designSystem.open 判断。
  const systemDir =
    'path' in target && /(^|[\\/])design-system\.json$/.test(target.path) ? target.path.replace(/[\\/]?design-system\.json$/, '') : null;
  const openSystem = () => {
    if (systemDir === null || !('path' in target)) return;
    const system = 'projectId' in target ? { projectId: target.projectId, path: systemDir } : { conversationId: target.conversationId, path: systemDir };
    useShell.getState().openPane({ kind: 'design-system', target: system });
  };
  // 打开的是一份协作文档的 `doc.json`：改用协作文档编辑器打开它所在的目录（docs/design/docs §8）；认不认得出由 docs.open 判断。
  const docDir = 'path' in target && /(^|[\\/])doc\.json$/.test(target.path) ? target.path.replace(/[\\/]?doc\.json$/, '') : null;
  const openDoc = () => {
    if (docDir === null || !('path' in target)) return;
    const doc = 'projectId' in target ? { projectId: target.projectId, path: docDir } : { conversationId: target.conversationId, path: docDir };
    useShell.getState().openPane({ kind: 'docs', target: doc });
  };

  return (
    <section className={pane} aria-label={S.filePane.label(entry?.name ?? fileName)}>
      <header className={bar}>
        <FileText styles={headIcon} />
        <div className={headText}>
          <strong className={name}>{entry?.name ?? fileName}</strong>
          {metadata ? <span className={meta}>{metadata}</span> : null}
        </div>
        {mode && mode !== 'image' && mode !== 'audio' && mode !== 'video' && <DocumentViewControl mode={mode} source={source} onChange={setSource} />}
        {deckDir !== null && <ActionButton isQuiet onPress={openDeck}>{SLIDES.openInEditor}</ActionButton>}
        {canvasDir !== null && <ActionButton isQuiet onPress={openCanvas}>{DESIGN.openInEditor}</ActionButton>}
        {systemDir !== null && <ActionButton isQuiet onPress={openSystem}>{DESIGN_SYSTEM.openInEditor}</ActionButton>}
        {docDir !== null && <ActionButton isQuiet onPress={openDoc}>{DOCS.openInEditor}</ActionButton>}
        {resolved && <Button variant="secondary" onPress={() => save.media(resolved.handle.url, fileName)}>{IMAGE.download}</Button>}
        {absolute && kind && runtime.host.openFile && <ActionButton isQuiet onPress={() => {
          void runtime.host.openFile!(absolute).then(async error => {
            if (error === null) await runtime.host.revealPath(absolute);
            else if (error) ToastQueue.negative(S.filePreview.failed(error));
          }).catch((error: Error) => ToastQueue.negative(S.filePreview.failed(error.message)));
        }}>{M.openDefault}</ActionButton>}
        {'attachmentId' in target || local ? null : <ActionButton isQuiet onPress={() => go({ tab: 'space', category: 'all', projectId })}>
          {WORKSPACE_COPY.showInSpace}
        </ActionButton>}
        {absolute ? (
          <TooltipTrigger>
            <ActionButton isQuiet aria-label={WORKSPACE_COPY.reveal} onPress={() => void runtime.host.revealPath(absolute)}>
              <OpenIn />
            </ActionButton>
            <Tooltip>{WORKSPACE_COPY.reveal}</Tooltip>
          </TooltipTrigger>
        ) : null}
      </header>
      <div className={mode === 'audio' || mode === 'video' || mode === 'image' ? playerBody : `${body} bc-scroll`}>
        <FilePreview filePath={absolute??undefined} active={active} key={JSON.stringify(target)} target={target} fileName={fileName} sourceMode={source}
          imagePanel={{ conversationId, gallery, onSelect: image => useShell.getState().replaceFilePane(itemKey({ kind: 'file', target }), image.target) }}
          playback={{ memoryKey }} onResolved={(handle, mode) => setResolved({ handle, mode })} />
      </div>
      <footer className={footer}>{absolute ?? (relPath || fileName)}</footer>
    </section>
  );
}
