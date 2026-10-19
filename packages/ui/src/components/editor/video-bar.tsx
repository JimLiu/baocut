import { useState, type ReactElement } from 'react';
import { localizeText, type VideoRef, type Sequence } from '@baocut/protocol';
import { EditLabel } from '@baocut/protocol/messages/ui';
import {
  ActionButton,
  ActionMenu,
  MenuItem,
  ProgressCircle,
  StatusLight,
  Text,
  Tooltip,
  TooltipTrigger,
} from '@react-spectrum/s2';
import AIMark from '@react-spectrum/s2/icons/AIMark';
import Close from '@react-spectrum/s2/icons/Close';
import Asset from '@react-spectrum/s2/icons/Asset';
import InfoCircle from '@react-spectrum/s2/icons/InfoCircle';
import OpenIn from '@react-spectrum/s2/icons/OpenIn';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { durationSeconds, formatFps } from '../../model/editor.ts';
import { formatClock } from '../../model/format.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { canEdit, type OpenVideo } from '../../state/video-store.ts';
import { useShell } from '../../state/shell-store.ts';
import { ExportButton } from '../export/export-button.tsx';
import { NameDialog } from '../name-dialog.tsx';
import { TaskPill } from '../task-pill.tsx';
import { useEditorActions } from './editor-context.tsx';
import { EditorVideoInfo } from './video-info.tsx';
import { VersionsButton } from './video-versions.tsx';
import { VIDEO_BAR_COPY as VB } from './video-bar-copy.ts';

/** 视频栏（产品设计 §5.1）：视频名、保存状态；「历史」按钮（video-versions.tsx）打开版本记录与撤销历史，当前修订号写在它的提示里。 */
const bar = style({
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  boxSizing: 'border-box',
  height: 64,
  flexShrink: 0,
  paddingX: 16,
  borderBottomWidth: 2,
  borderTopWidth: 0,
  borderStartWidth: 0,
  borderEndWidth: 0,
  borderStyle: 'solid',
  borderColor: 'gray-100',
  backgroundColor: 'gray-25',
});
const titleBlock = style({ display: 'flex', flexDirection: 'column', minWidth: 0, flexGrow: 1 });
const titleRow = style({ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 });
const nameButton = style({
  font: 'title',
  color: 'neutral',
  margin: 0,
  padding: 0,
  borderWidth: 0,
  backgroundColor: 'transparent',
  textAlign: 'start',
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  cursor: 'default',
  borderRadius: 'sm',
  outlineStyle: { default: 'none', ':focus-visible': 'solid' },
  outlineColor: 'focus-ring',
  outlineWidth: 2,
});
const meta = style({ font: 'ui-xs', color: 'gray-600', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' });
const acts = style({ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 });
const saveText = style({ font: 'ui-sm', color: 'gray-700', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 8 });
const agentText = style({ font: 'ui-sm', color: 'gray-700', display: 'flex', alignItems: 'center', gap: 4, minWidth: 0, maxWidth: 240 });
const agentLabel = style({ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 });

export function VideoBar({ video, sequence }: { video: OpenVideo; sequence: Sequence | null }) {
  const runtime = useRuntime();
  const { apply } = useEditorActions();
  const closeVideo = useShell((s) => s.closeVideo);
  const closeLabel = useShell((s) => (s.route.tab === 'space' ? VB.closeToSpace : VB.closeToHome));
  const [renaming, setRenaming] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const name = video.state?.video.name ?? video.ref?.name ?? VB.untitled;
  const editable = canEdit(video);

  const parts: string[] = [];
  if (sequence) {
    parts.push(formatClock(durationSeconds(sequence), { tenths: true }));
    parts.push(`${sequence.canvas.width}×${sequence.canvas.height}`);
    parts.push(formatFps(sequence.fps));
  }
  if (video.ref) parts.push(video.ref.relPath);

  return (
    <header className={bar}>
      <div className={titleBlock}>
        <div className={titleRow}>
          <TooltipTrigger>
            <button type="button" className={nameButton} disabled={!editable} onClick={() => setRenaming(true)}>
              {name}
            </button>
            <Tooltip>{VB.rename}</Tooltip>
          </TooltipTrigger>
          <Tip label={VB.details}>
            <ActionButton isQuiet size="S" aria-label={VB.details} onPress={() => setShowInfo(true)}>
              <InfoCircle />
            </ActionButton>
          </Tip>
        </div>
        <span className={meta}>{parts.join(' · ')}</span>
      </div>
      <div className={acts}>
        <TaskPill videoId={video.videoId} />
        <SaveState video={video} />
        {video.state ? <VersionsButton video={video} /> : null}
        <ExportButton video={video} sequence={sequence} />
        <ActionMenu aria-label={VB.actions} isQuiet align="end" onAction={(key) => onMenu(String(key), video.ref)}>
          <MenuItem id="space" textValue={VB.showInSpace}>
            <Asset />
            <Text slot="label">{VB.showInSpace}</Text>
          </MenuItem>
          <MenuItem id="reveal" textValue={VB.revealVideoFolder}>
            <OpenIn />
            <Text slot="label">{VB.revealVideoFolder}</Text>
          </MenuItem>
        </ActionMenu>
        <Tip label={closeLabel}>
          <ActionButton isQuiet aria-label={VB.close} onPress={closeVideo}>
            <Close />
          </ActionButton>
        </Tip>
      </div>
      {renaming ? (
        <NameDialog
          title={VB.rename}
          label={VB.nameLabel}
          initial={name}
          submitLabel={VB.save}
          onClose={() => setRenaming(false)}
          onSubmit={async (next) => {
            const receipt = await apply([{ type: 'renameVideo', name: next }], EditLabel.renameVideo());
            if (receipt) setRenaming(false);
          }}
        />
      ) : null}
      {showInfo ? <EditorVideoInfo video={video} sequence={sequence} onClose={() => setShowInfo(false)} /> : null}
    </header>
  );

  function onMenu(key: string, ref: VideoRef | null) {
    if (!ref) return;
    if (key === 'reveal') void runtime.host.revealPath(ref.path);
    else if (key === 'space') {
      const shell = useShell.getState();
      shell.closeVideo();
      shell.go({ tab: 'space', category: 'video', projectId: ref.source.projectId });
    }
  }
}

/** 保存状态：已追平、正在提交、未追平（断线或重新打开中）、打不开（产品设计 §2.6：已连接不等于已追平）。 */
function SaveState({ video }: { video: OpenVideo }) {
  if (video.status === 'error') return <StatusLight variant="negative">{VB.openFailed}</StatusLight>;
  if (video.status === 'stale') return <StatusLight variant="notice">{VB.stale}</StatusLight>;
  if (video.status === 'opening')
    return (
      <span className={saveText}>
        <ProgressCircle size="S" isIndeterminate aria-label={VB.openingAria} />
        {VB.opening}
      </span>
    );
  if (video.inFlight > 0)
    return (
      <span className={saveText}>
        <ProgressCircle size="S" isIndeterminate aria-label={VB.savingAria} />
        {VB.saving}
      </span>
    );
  // 智能体刚改过：说一声改了什么，时间线上的变化才不显得莫名其妙（§1.5 共用一个编辑器）。
  if (video.lastChange?.by === 'agent') {
    const label = localizeText(video.lastChange.label, video.lastChange.labelRef);
    return (
      <span className={agentText} title={VB.agentChanged(label)}>
        <AIMark />
        <span className={agentLabel}>{VB.savedByAgent(label)}</span>
      </span>
    );
  }
  return <span className={saveText}>{VB.saved}</span>;
}

function Tip({ label, children }: { label: string; children: ReactElement }) {
  return (
    <TooltipTrigger>
      {children}
      <Tooltip>{label}</Tooltip>
    </TooltipTrigger>
  );
}
