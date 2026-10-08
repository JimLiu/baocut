import type { ComponentType } from 'react';
import { ActionButton, Badge, ProgressBar, Text } from '@react-spectrum/s2';
import AIMark from '@react-spectrum/s2/icons/AIMark';
import AudioWave from '@react-spectrum/s2/icons/AudioWave';
import Download from '@react-spectrum/s2/icons/Download';
import Export from '@react-spectrum/s2/icons/Export';
import FolderMoveTo from '@react-spectrum/s2/icons/FolderMoveTo';
import FolderOpen from '@react-spectrum/s2/icons/FolderOpen';
import Image from '@react-spectrum/s2/icons/Image';
import Layers from '@react-spectrum/s2/icons/Layers';
import Microphone from '@react-spectrum/s2/icons/Microphone';
import Search from '@react-spectrum/s2/icons/Search';
import Tools from '@react-spectrum/s2/icons/Tools';
import UserAvatar from '@react-spectrum/s2/icons/UserAvatar';
import Translate from '@react-spectrum/s2/icons/Translate';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { TASK_VIEW_COPY } from '../../copy.ts';
import type { TaskKind, TaskRow, TaskTone } from '../../model/task-list.ts';
import { agoLabel } from '../../model/format.ts';
import { useDirectory } from '../../state/directory-store.ts';
import { useShell } from '../../state/shell-store.ts';
import { AgentIcon } from '../agent-icon.tsx';
import { LegacyImportCardNote } from '../legacy-import/legacy-import-task.tsx';
import { TK } from './tasks-copy.ts';
import { actionLabel, useTaskAction } from './use-task-actions.ts';

/**
 * 种类图标（原型 page-tasks.jsx `KIND`）：转录 mic、语音 wave、图片 image、导出 export；Agent 任务用智能体图标。
 * 原型没画的种类：生成文本 AI、固定流程与其中一步 layers、模型安装 download、模型测试 checkmark、工具安装与更新 tools、音色克隆 user、
 * 智能体自己翻译 translate。导入旧版项目用原型的 projects（FolderOpen）。
 */
export const KIND_ICON: Record<TaskKind, ComponentType> = {
  agent: AgentIcon,
  transcribe: Microphone,
  synthesizeSpeech: AudioWave,
  generateImage: Image,
  generateText: AIMark,
  export: Export,
  pipeline: Layers,
  'pipeline-step': Layers,
  modelInstall: Download,
  modelTest: Search,
  modelsMove: FolderMoveTo,
  toolInstall: Tools,
  toolUpdate: Tools,
  fontDownload: Download,
  voiceClone: UserAvatar,
  agentTranslate: Translate,
  legacyImport: FolderOpen,
};

/** 原型 `.chip--*` 的色调对到 S2 Badge：accent 蓝、info 靛、notice 橙、neutral 灰。 */
const BADGE: Record<TaskTone, 'informative' | 'indigo' | 'notice' | 'neutral' | 'positive' | 'negative'> = {
  accent: 'informative',
  info: 'indigo',
  notice: 'notice',
  neutral: 'neutral',
  positive: 'positive',
  negative: 'negative',
};

/** 种类图标底：失败红、完成绿、取消灰，其余蓝（原型 `.kicon` 的内联色）。 */
const kicon = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  width: 32,
  height: 32,
  borderRadius: 'default',
  backgroundColor: { tone: { blue: 'blue-200', red: 'red-200', green: 'green-200', gray: 'gray-200' } },
  color: { tone: { blue: 'blue-1000', red: 'red-1000', green: 'green-1000', gray: 'gray-800' } },
});

function iconTone(tone: TaskTone): 'blue' | 'red' | 'green' | 'gray' {
  if (tone === 'negative') return 'red';
  if (tone === 'positive') return 'green';
  if (tone === 'neutral') return 'gray';
  return 'blue';
}

export function KindIcon({ row }: { row: Pick<TaskRow, 'kind' | 'tone'> }) {
  const Icon = KIND_ICON[row.kind];
  return (
    <span className={kicon({ tone: iconTone(row.tone) })} aria-hidden="true">
      <Icon />
    </span>
  );
}

export function StatusBadge({ row }: { row: Pick<TaskRow, 'label' | 'tone'> }) {
  return (
    <Badge variant={BADGE[row.tone]} fillStyle="subtle" size="S">
      {row.label}
    </Badge>
  );
}

/** 来源 chip：「Agent」（靛，带智能体图标）与「命令行」（灰）。 */
export function SourceBadge({ chip }: { chip: TaskRow['chip'] }) {
  if (chip === 'agent')
    return (
      <Badge variant="indigo" fillStyle="subtle" size="S">
        <AgentIcon />
        <Text>{TASK_VIEW_COPY.chipAgent}</Text>
      </Badge>
    );
  if (chip === 'cli')
    return (
      <Badge variant="neutral" fillStyle="subtle" size="S">
        {TASK_VIEW_COPY.chipCli}
      </Badge>
    );
  return null;
}

const card = style({
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  paddingX: 16,
  paddingY: 12,
  borderRadius: 'lg',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'gray-200',
  backgroundColor: 'gray-50',
});
const body = style({ flexGrow: 1, flexShrink: 1, minWidth: 0 });
const head = style({ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 });
const title = style({
  font: 'ui',
  fontWeight: 'bold',
  color: 'gray-900',
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
const sub = style({ font: 'ui-xs', color: 'gray-600', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
const bar = style({ marginTop: 8, maxWidth: 320 });

/** 打开会话：会话还在目录里才给（智能体经工具提交的 Job 指回它的会话）。 */
export function useOpenConversation(row: Pick<TaskRow, 'conversationId'>): (() => void) | null {
  const go = useShell((s) => s.go);
  const exists = useDirectory((s) => !!row.conversationId && s.conversations.some((c) => c.id === row.conversationId));
  if (!row.conversationId || !exists) return null;
  const conversationId = row.conversationId;
  return () => go({ tab: 'home', conversationId, projectId: null });
}

/** 任务卡（原型 page-tasks.jsx `TaskCard`）：种类图标、标题 ＋ 状态与来源 chip、「在哪 · 何时」、进度；打开会话 / 详情 / 取消。 */
export function TaskCard({ row, now }: { row: TaskRow; now: number }) {
  const go = useShell((s) => s.go);
  const act = useTaskAction();
  const openConversation = useOpenConversation(row);
  return (
    <div className={card}>
      <KindIcon row={row} />
      <div className={body}>
        <div className={head}>
          <span className={title} title={row.title}>
            {row.title}
          </span>
          <StatusBadge row={row} />
          <SourceBadge chip={row.chip} />
        </div>
        <div className={sub}>{[row.where, agoLabel(row.startedAt, now)].filter(Boolean).join(' · ')}</div>
        {row.progress !== null ? (
          <div className={bar}>
            <ProgressBar
              size="S"
              aria-label={TK.progress(row.title, row.label)}
              isIndeterminate={row.progress === 'indet'}
              value={row.progress === 'indet' ? undefined : row.progress}
            />
          </div>
        ) : null}
        {/* 旧版项目导入没导入的：原因一句、怎么办一句、全部重试 / 全部跳过。 */}
        {row.origin === 'legacy-import' ? <LegacyImportCardNote /> : null}
      </div>
      {openConversation ? (
        <ActionButton isQuiet size="S" onPress={openConversation}>
          {TASK_VIEW_COPY.openConversation}
        </ActionButton>
      ) : null}
      <ActionButton isQuiet size="S" onPress={() => go({ tab: 'tasks', taskId: row.id })}>
        {TASK_VIEW_COPY.details}
      </ActionButton>
      {row.action ? (
        <ActionButton isQuiet size="S" onPress={() => act(row.action!)}>
          {actionLabel(row.action)}
        </ActionButton>
      ) : null}
    </div>
  );
}
