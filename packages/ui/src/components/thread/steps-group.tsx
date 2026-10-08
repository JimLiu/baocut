import { memo, useRef, useState, type ReactNode } from 'react';
import type { TimelineItem } from '@baocut/protocol';
import { ResponseStatus, ResponseStatusPanel, ResponseStatusTitle } from '@react-spectrum/ai';
import { PixelLoader } from '@react-spectrum/ai/loader';
import AlertTriangle from '@react-spectrum/s2/icons/AlertTriangle';
import Asset from '@react-spectrum/s2/icons/Asset';
import AudioWave from '@react-spectrum/s2/icons/AudioWave';
import Bookmark from '@react-spectrum/s2/icons/Bookmark';
import Checkmark from '@react-spectrum/s2/icons/Checkmark';
import Collection from '@react-spectrum/s2/icons/Collection';
import Cut from '@react-spectrum/s2/icons/Cut';
import Data from '@react-spectrum/s2/icons/Data';
import Delete from '@react-spectrum/s2/icons/Delete';
import Download from '@react-spectrum/s2/icons/Download';
import Export from '@react-spectrum/s2/icons/Export';
import FileText from '@react-spectrum/s2/icons/FileText';
import Image from '@react-spectrum/s2/icons/Image';
import Key from '@react-spectrum/s2/icons/Key';
import Layers from '@react-spectrum/s2/icons/Layers';
import ListBulleted from '@react-spectrum/s2/icons/ListBulleted';
import SaveFloppy from '@react-spectrum/s2/icons/SaveFloppy';
import Text from '@react-spectrum/s2/icons/Text';
import Transcript from '@react-spectrum/s2/icons/Transcript';
import Translate from '@react-spectrum/s2/icons/Translate';
import Undo from '@react-spectrum/s2/icons/Undo';
import Video from '@react-spectrum/s2/icons/Video';
import ChevronDown from '@react-spectrum/s2/icons/ChevronDown';
import ChevronRight from '@react-spectrum/s2/icons/ChevronRight';
import Clock from '@react-spectrum/s2/icons/Clock';
import Edit from '@react-spectrum/s2/icons/Edit';
import Folder from '@react-spectrum/s2/icons/Folder';
import Lightbulb from '@react-spectrum/s2/icons/Lightbulb';
import More from '@react-spectrum/s2/icons/More';
import Search from '@react-spectrum/s2/icons/Search';
import Tools from '@react-spectrum/s2/icons/Tools';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { T } from './thread-copy.ts';
import type { BaoCutStepKind } from '../../model/agent-tool-steps.ts';
import { diffLines, looksLikeDiff, nextToolStatus, stepError, stepMeta } from '../../model/agent-turn.ts';
import { changedFiles, stepsSummary, toolStep, type StepKind, type StepsBlock } from '../../model/thread.ts';
import { useShell } from '../../state/shell-store.ts';
import { loaderIcon, loaderSequence } from './agent-loader-icons.ts';
import { CopyButton } from './copy-button.tsx';
import './agent-thread.css';

type Step = StepsBlock['items'][number];
type ToolCall = Extract<TimelineItem, { kind: 'tool-call' }>;

const group = style({ display: 'flex', flexDirection: 'column', gap: 4, marginStart: 36 });
const files = style({ display: 'flex', flexWrap: 'wrap', gap: 4, paddingX: 8 });
const fileLink = style({
  padding: 0,
  borderStyle: 'none',
  backgroundColor: 'transparent',
  font: 'ui-xs',
  color: { default: 'accent', isHovered: 'accent-900' },
  textDecoration: { default: 'none', isHovered: 'underline' },
  cursor: 'pointer',
});

const KIND_ICON: Record<StepKind, ReactNode> = {
  command: <Tools />,
  read: <Folder />,
  edit: <Edit />,
  search: <Search />,
  other: <More />,
};

/** BaoCut 自己的工具按类别取图标（agent-tool-steps.ts）。 */
const TOOL_ICON: Record<BaoCutStepKind, ReactNode> = {
  'video-list': <ListBulleted />,
  'video-create': <Video />,
  'video-read': <Video />,
  'video-delete': <Delete />,
  'document-read': <FileText />,
  translate: <Translate />,
  cut: <Cut />,
  import: <Asset />,
  'edit-video': <Edit />,
  undo: <Undo />,
  captions: <Text />,
  transcribe: <Transcript />,
  speech: <AudioWave />,
  image: <Image />,
  models: <Data />,
  'model-install': <Download />,
  export: <Export />,
  download: <Download />,
  'downloads-save': <SaveFloppy />,
  job: <Layers />,
  artifact: <SaveFloppy />,
  space: <Collection />,
  'space-search': <Search />,
  skill: <Bookmark />,
  grant: <Key />,
  contract: <Checkmark />,
};

/**
 * 一组执行步骤：S2 AI 的 ResponseStatus 收成一句话（「读取了 2 个文件、运行了命令」），点开是步骤行；
 * 正在跑的那一条在折叠时也露在下面（产品设计 §3.2.2）。
 * 跑着时标题前是正在跑的那一步类别的第一个像素图，静止不动（agent-thread.css 停掉它的动画）；动画只留在正在跑的那一行。
 */
export const StepsGroup = memo(function StepsGroup({
  items,
  live,
  conversationId,
  cwd,
}: {
  items: StepsBlock['items'];
  live: boolean;
  conversationId: string;
  cwd?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const failed = items.filter((i) => i.kind === 'tool-call' && i.status === 'failed').length;
  const current = live
    ? items.findLast((i) => (i.kind === 'tool-call' && i.status === 'running') || (i.kind === 'reasoning' && i.streaming))
    : undefined;
  const summary = stepsSummary(items, cwd);
  const title = [current ? T.steps.working(summary) : summary, failed ? T.steps.failed(failed) : null].filter(Boolean).join(' · ');
  const icon = loaderIcon(current?.kind === 'tool-call' ? stepLoaderKey(current, cwd) : 'thinking');
  return (
    <section className={`${group} bc-steps-group`}>
      <ResponseStatus status={current ? 'pending' : 'success'} isExpanded={open} onExpandedChange={setOpen}>
        <ResponseStatusTitle pixelLoader={icon}>{title}</ResponseStatusTitle>
        <ResponseStatusPanel>
          <ol className="bc-steps">
            {items.map((item) => (
              <StepRow key={item.id} item={item} conversationId={conversationId} cwd={cwd} />
            ))}
          </ol>
        </ResponseStatusPanel>
      </ResponseStatus>
      {!open && current ? (
        <ol className="bc-steps">
          <StepRow item={current} conversationId={conversationId} cwd={cwd} />
        </ol>
      ) : null}
    </section>
  );
});

/** 步骤的加载图形键：BaoCut 自己的工具按它的类别（与图标同一个优先级），其余按通用类别。 */
function stepLoaderKey(item: ToolCall, cwd?: string | null): string {
  const step = toolStep(item, cwd);
  return step.tool ?? step.kind;
}

/** 14px 的像素图放进与类别图标同尺寸的画布，换图标时这一行不动。 */
function RowLoader({ kind }: { kind: string }) {
  return (
    <span className="bc-step__ic bc-step__loader">
      <PixelLoader icon={loaderSequence(kind)} size={14} />
    </span>
  );
}

const StepRow = memo(function StepRow({ item, conversationId, cwd }: { item: Step; conversationId: string; cwd?: string | null }) {
  return item.kind === 'reasoning' ? <ReasoningRow item={item} /> : <ToolRow item={item} conversationId={conversationId} cwd={cwd} />;
});

/** 思考只露第一行（去掉 Markdown 加粗），全文在展开里。 */
function firstLine(text: string): string {
  const line = text.trim().split('\n')[0] ?? '';
  return line.replace(/\*\*/g, '').trim();
}

function ReasoningRow({ item }: { item: Extract<Step, { kind: 'reasoning' }> }) {
  const [open, setOpen] = useState(false);
  const head = firstLine(item.text);
  const more = item.text.trim() !== head;
  return (
    <li className="bc-step">
      <button type="button" className="bc-step__row" aria-expanded={more ? open : undefined} onClick={() => more && setOpen((v) => !v)}>
        {item.streaming ? (
          <RowLoader kind="reasoning" />
        ) : (
          <span className="bc-step__ic">
            <Lightbulb />
          </span>
        )}
        <span className={`bc-step__label${item.streaming ? ' bc-shimmer' : ''}`}>{T.steps.thinking}</span>
        <span className="bc-step__sum">{head}</span>
        {more ? <span className="bc-step__chev">{open ? <ChevronDown /> : <ChevronRight />}</span> : null}
      </button>
      {open ? (
        <div className="bc-step__detail">
          <p className="bc-step__reasoning">{item.text.trim()}</p>
        </div>
      ) : null}
    </li>
  );
}

/** 状态一旦失败，不再被这一行之后收到的更新改回。 */
function useLatchedStatus(status: ToolCall['status']): ToolCall['status'] {
  const latched = useRef<ToolCall['status'] | null>(null);
  latched.current = nextToolStatus(latched.current, status);
  return latched.current;
}

function ToolRow({ item, conversationId, cwd }: { item: ToolCall; conversationId: string; cwd?: string | null }) {
  const [open, setOpen] = useState(false);
  const openPane = useShell((s) => s.openPane);
  const status = useLatchedStatus(item.status);
  const step = toolStep(item, cwd);
  const failed = status === 'failed';
  const running = status === 'running';
  const changed = status === 'completed' ? changedFiles(item) : [];
  const icon = failed ? <AlertTriangle /> : status === 'interrupted' ? <Clock /> : step.tool ? TOOL_ICON[step.tool] : KIND_ICON[step.kind];
  const loaderKey = step.tool ?? step.kind;
  return (
    <li className={`bc-step${failed ? ' is-failed' : ''}`}>
      <button type="button" className="bc-step__row" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {running ? <RowLoader kind={loaderKey} /> : <span className="bc-step__ic">{icon}</span>}
        <span className={`bc-step__label${running ? ' bc-shimmer' : ''}`}>{step.label}</span>
        <span className="bc-step__sum">{step.summary}</span>
        {stepMeta(item, status).map((meta) => (
          <span key={meta.text} className={`bc-step__meta${meta.code ? ' bc-step__meta--code' : ''}`}>
            {meta.text}
          </span>
        ))}
        <span className="bc-step__chev">{open ? <ChevronDown /> : <ChevronRight />}</span>
      </button>
      {open ? (
        <div className="bc-step__detail">
          {changed.length ? (
            <div className={files}>
              {changed.map((file) => (
                <button
                  key={file.path}
                  type="button"
                  className={fileLink({})}
                  onClick={() => openPane({ kind: 'file', target: { conversationId, path: file.path } })}>
                  {T.steps.viewFile(file.path.slice(file.path.lastIndexOf('/') + 1))}
                </button>
              ))}
            </div>
          ) : null}
          {item.detail ? <Section title={T.steps.input} text={item.detail} /> : null}
          {failed || status === 'declined' ? (
            <section className="bc-step__sec bc-step__sec--err">
              <header>{T.steps.error}</header>
              <pre tabIndex={0}>{stepError(item, status)}</pre>
            </section>
          ) : null}
          {item.output ? (
            <Section title={T.steps.output} text={item.output} diff={looksLikeDiff(item.output)} />
          ) : running ? (
            <div className="bc-step__skel" role="status" aria-label={T.steps.waiting}>
              <span />
              <span />
              <span />
            </div>
          ) : status === 'completed' ? (
            <p className="bc-step__none">{T.steps.noOutput}</p>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function Section({ title, text, diff = false }: { title: string; text: string; diff?: boolean }) {
  return (
    <section className="bc-step__sec">
      <header>
        <span>{title}</span>
        <CopyButton text={text} />
      </header>
      {diff ? (
        <pre tabIndex={0}>
          {diffLines(text).map((line, i) => (
            <span key={i} className={`bc-step__dl bc-step__dl--${line.type}`}>
              {line.text || ' '}
              {'\n'}
            </span>
          ))}
        </pre>
      ) : (
        <pre tabIndex={0}>{text}</pre>
      )}
    </section>
  );
}
