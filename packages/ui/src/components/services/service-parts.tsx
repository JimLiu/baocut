import { useEffect, useState, type ReactNode } from 'react';
import type { Id, ServiceLevel, ServiceRequestRecord, ServiceStatus } from '@baocut/protocol';
import { ActionButton, Button, Checkbox, Text, TextField, Tooltip, TooltipTrigger } from '@react-spectrum/s2';
import { ToggleButton, ToggleButtonGroup } from 'react-aria-components';
import Copy from '@react-spectrum/s2/icons/Copy';
import Lock from '@react-spectrum/s2/icons/Lock';
import { iconStyle, style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { agoLabel } from '../../model/format.ts';
import { outcomeLabel, requestLine } from '../../model/services-mcp.ts';
import { isPortError, parsePort, runtimeServiceId, SERVICE_DEFAULT_PORT, servicePorts, serviceBusy, statusState, type ServiceId } from '../../model/services.ts';
import { useConnection } from '../../state/connection-store.ts';
import { useServices } from '../../state/services-store.ts';
import { useShare } from '../../state/share-store.ts';
import { useNow } from '../use-now.ts';
import { detail, detailXs } from './service-card.tsx';
import { COMMON_COPY } from './services-copy.ts';
import { copyText, useConfigureService } from './use-service-actions.ts';

/*
 * MCP / 模型接口 / Web 三页共用的零件（原型 designs/baocut/app/services.css `.svc__sec` / `.svc__panel` / `.svc__line` /
 * `.svc__fix` / `.svc__port`，ui.css `.setrow`、`.agset-code`；page-services.jsx 的 `Row` 与「连接」「最近请求」块）。
 */

const sec = style({ display: 'flex', alignItems: 'center', gap: 8, maxWidth: '[640px]', marginTop: 24 });
const secTitle = style({ flexGrow: 1, margin: 0, font: 'ui-xs', fontWeight: 'bold', color: 'gray-600', letterSpacing: '[0.04em]' });

/** 分节标题（原型 `.t-section.svc__sec`），右边可带一句状态。 */
export function SectionHead({ title, aside }: { title: string; aside?: ReactNode }) {
  return (
    <div className={sec}>
      <h3 className={secTitle}>{title}</h3>
      {aside ? (
        <span className={detailXs} role="status">
          {aside}
        </span>
      ) : null}
    </div>
  );
}

/** 原型 ui.css `.setrow`：标签 + 说明在左，控件在右，1px gray-100 分隔。 */
const row = style({
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  paddingY: '[10px]',
  borderTopWidth: 0,
  borderXWidth: 0,
  borderBottomWidth: { default: 1, ':last-child': 0 },
  borderStyle: 'solid',
  borderColor: 'gray-100',
});
const rowName = style({ display: 'flex', flexDirection: 'column', gap: 2, flexGrow: 1, flexShrink: 1, minWidth: 0 });
const rowLabel = style({ font: 'ui', fontWeight: 'medium', color: { default: 'gray-900', isDim: 'gray-600' } });
const rowDesc = style({ font: 'ui-xs', color: 'gray-600', overflowWrap: 'anywhere' });
const rowTail = style({ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 });

export function SetRow({ label, desc, dim = false, children }: { label: ReactNode; desc?: ReactNode; dim?: boolean; children?: ReactNode }) {
  return (
    <div className={row}>
      <span className={rowName}>
        <span className={rowLabel({ isDim: dim })}>{label}</span>
        {desc ? <span className={rowDesc}>{desc}</span> : null}
      </span>
      {children ? <span className={rowTail}>{children}</span> : null}
    </div>
  );
}

const plannedRow = style({ display: 'flex', alignItems: 'start', gap: 8, marginTop: 8, font: 'ui-xs', color: 'gray-600' });
const plannedIcon = iconStyle({ size: 'S', color: 'neutral', marginTop: 2 });

/** 置灰的控件旁边那一句：为什么这一版做不到（同工具页 `plannedReason` 的做法，写实话）。 */
export function PlannedNote({ children }: { children: ReactNode }) {
  return (
    <p className={plannedRow}>
      <Lock styles={plannedIcon} />
      <span>{children}</span>
    </p>
  );
}

/** 原型 `.agset-code`：一行等宽文字 + 复制按钮。 */
const code = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  marginTop: 8,
  paddingStart: 12,
  paddingEnd: 4,
  paddingY: 4,
  borderRadius: 'default',
  backgroundColor: 'gray-75',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'gray-200',
});
const codeLabel = style({ flexShrink: 0, font: 'ui-xs', color: 'gray-600' });
const codeText = style({ flexGrow: 1, minWidth: 0, font: 'code-sm', color: 'gray-900', overflowWrap: 'anywhere', userSelect: 'text' });

export function CodeLine({ label, value, copyLabel, what }: { label?: string; value: string; copyLabel: string; what: string }) {
  return (
    <div className={code}>
      {label ? <span className={codeLabel}>{label}</span> : null}
      <code className={codeText}>{value}</code>
      <TooltipTrigger delay={400}>
        <ActionButton isQuiet size="S" aria-label={copyLabel} onPress={() => copyText(value, what)}>
          <Copy />
        </ActionButton>
        <Tooltip>{copyLabel}</Tooltip>
      </TooltipTrigger>
    </div>
  );
}

/** 多行的配置片段（JSON 或环境变量），只读、可选中。 */
const pre = style({
  margin: 0,
  marginTop: 8,
  padding: 12,
  borderRadius: 'default',
  backgroundColor: 'gray-75',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'gray-200',
  font: 'code-xs',
  color: 'gray-800',
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
  userSelect: 'text',
});

export function Snippet({ text }: { text: string }) {
  return <pre className={pre}>{text}</pre>;
}

const actionsRow = style({ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 12 });
export function ActionsRow({ children }: { children: ReactNode }) {
  return <div className={actionsRow}>{children}</div>;
}

/** 一项 Runtime 服务的状态与连接（页面共用）。 */
export function useServiceStatus(id: Exclude<ServiceId, 'remote'>) {
  const runtimeId = runtimeServiceId(id);
  const status = useServices((s) => s.services.find((x) => x.serviceId === runtimeId));
  const ready = useServices((s) => s.ready);
  const connected = useConnection((s) => s.state.status === 'connected');
  return { status, ready, connected, state: statusState(status) };
}

// ---- 端口、自动启动、出错时的补救 ----

const portField = style({ width: 96 });

/**
 * 端口一行（原型 `.svc__port`）：失焦或回车时提交。和其他 BaoCut 服务撞口的当场说是谁；
 * Runtime 立即生效——开着时按新端口重开（原型要先停服务，这里不用）。起停中不能改。
 */
export function PortRow({ id, status }: { id: Exclude<ServiceId, 'remote'>; status: ServiceStatus }) {
  const configure = useConfigureService();
  const services = useServices((s) => s.services);
  const share = useShare((s) => s.status);
  const connected = useConnection((s) => s.state.status === 'connected');
  const port = status.port ?? SERVICE_DEFAULT_PORT[id];
  const [draft, setDraft] = useState(String(port));
  const [error, setError] = useState('');
  useEffect(() => setDraft(String(port)), [port]);
  const busy = serviceBusy(statusState(status));
  const commit = () => {
    const parsed = parsePort(draft, id, servicePorts(services, share));
    if (parsed.error !== undefined) return setError(parsed.error);
    setError('');
    if (parsed.port !== port) void configure({ serviceId: runtimeServiceId(id), port: parsed.port }, COMMON_COPY.portSaved(parsed.port));
  };
  const live = status.state === 'on';
  return (
    <SetRow
      label={COMMON_COPY.portLabel}
      desc={error || (busy ? COMMON_COPY.portBusy : live ? COMMON_COPY.portLive : COMMON_COPY.portIdle(SERVICE_DEFAULT_PORT[id]))}>
      <TextField
        aria-label={COMMON_COPY.portLabel}
        size="S"
        inputMode="numeric"
        styles={portField}
        value={draft}
        isInvalid={!!error}
        isDisabled={busy || !connected}
        onChange={(v) => {
          setDraft(v);
          setError('');
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
        }}
      />
    </SetRow>
  );
}

/** 「打开 BaoCut 时自动启动」（随 Runtime 启动，`services.configure` 的 `autostart`）。 */
export function AutostartCheckbox({ id, status }: { id: Exclude<ServiceId, 'remote'>; status: ServiceStatus }) {
  const configure = useConfigureService();
  const connected = useConnection((s) => s.state.status === 'connected');
  return (
    <Checkbox
      size="S"
      isSelected={status.autostart}
      isDisabled={!connected}
      onChange={(autostart) => void configure({ serviceId: runtimeServiceId(id), autostart })}>
      {COMMON_COPY.autostart}
    </Checkbox>
  );
}

const fix = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  marginTop: 12,
  paddingX: 12,
  paddingY: 8,
  borderRadius: 'default',
  backgroundColor: 'gray-75',
});
const grow = style({ flexGrow: 1, minWidth: 0 });

/** 出错时卡片里的补救一行（原型 `.svc__fix`）：换个端口再试，或一键换回默认端口。只在原因是端口的事时出现。 */
export function ErrorFix({ id, status }: { id: Exclude<ServiceId, 'remote'>; status: ServiceStatus }) {
  const configure = useConfigureService();
  const connected = useConnection((s) => s.state.status === 'connected');
  const fallback = SERVICE_DEFAULT_PORT[id];
  if (!isPortError(status)) return null;
  return (
    <div className={fix}>
      <span className={`${detail} ${grow}`}>{COMMON_COPY.errorFix}</span>
      {status.port !== fallback ? (
        <Button
          variant="secondary"
          size="S"
          isDisabled={!connected}
          onPress={() => void configure({ serviceId: runtimeServiceId(id), port: fallback }, COMMON_COPY.portReset(fallback))}>
          {COMMON_COPY.resetPort}
        </Button>
      ) : null}
    </div>
  );
}

// ---- 允许的操作（三档） ----

/** 三列等宽，窄了换成一列（原型 services.css `.svc__access3`）。 */
const levels = style({
  display: 'grid',
  gridTemplateColumns: { default: '1fr', sm: ['1fr', '1fr', '1fr'] },
  gap: 8,
  marginTop: 12,
});
/** 一档（原型 settings-agent.css `.agm-access__option`，选中是蓝底蓝边）。 */
const levelOption = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'start',
  gap: 2,
  padding: 12,
  borderRadius: 'lg',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: { default: 'gray-300', isHovered: 'gray-400', isSelected: 'blue-900', isDisabled: 'gray-200' },
  backgroundColor: { default: 'transparent', isHovered: 'gray-100', isSelected: 'blue-100', isDisabled: 'transparent' },
  textAlign: 'start',
  cursor: 'default',
  transition: 'default',
  outlineStyle: { default: 'none', isFocusVisible: 'solid' },
  outlineColor: 'focus-ring',
  outlineWidth: 2,
  outlineOffset: 2,
});
const levelTitle = style({ font: 'ui', fontWeight: 'bold', color: { default: 'gray-900', isDisabled: 'disabled' } });
const levelDesc = style({ font: 'ui-xs', color: { default: 'gray-600', isDisabled: 'disabled' } });

/**
 * 三档等级（原型 `.agm-access.svc__access3` 三选一）：react-aria 的 ToggleButtonGroup（同 tools/image-tool.tsx 的画幅选择）。
 * S2 SelectBoxGroup 的横排一行只放得下一个、竖排又不显示说明，所以不用它。立即生效。
 */
export function LevelChoice({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: ServiceLevel;
  options: readonly { level: ServiceLevel; title: string; desc: string }[];
  disabled: boolean;
  onChange: (level: ServiceLevel) => void;
}) {
  return (
    <ToggleButtonGroup
      aria-label={label}
      className={levels}
      selectionMode="single"
      disallowEmptySelection
      isDisabled={disabled}
      selectedKeys={[value]}
      onSelectionChange={(keys) => {
        const next = [...keys][0];
        if (next !== undefined && next !== value) onChange(next as ServiceLevel);
      }}>
      {options.map((o) => (
        <ToggleButton key={o.level} id={o.level} className={(rp) => levelOption(rp)}>
          {({ isDisabled }) => (
            <>
              <span className={levelTitle({ isDisabled })}>{o.title}</span>
              <span className={levelDesc({ isDisabled })}>{o.desc}</span>
            </>
          )}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}

// ---- 最近请求 ----

const line = style({
  display: 'flex',
  alignItems: 'baseline',
  gap: 12,
  paddingY: 8,
  borderTopWidth: 0,
  borderXWidth: 0,
  borderBottomWidth: { default: 1, ':last-child': 0 },
  borderStyle: 'solid',
  borderColor: 'gray-100',
});
const call = style({ flexGrow: 1, minWidth: 0, font: 'code-sm', color: 'gray-800', overflowWrap: 'anywhere' });
const meta = style({ flexShrink: 0, font: 'ui-xs', color: { default: 'gray-600', isBad: 'negative' } });

/** 最近的外部请求（Runtime 留最近 20 条，新的在前）：工具 · 目标视频，调用方 · 多久前 · 结果。不含参数正文。 */
export function RequestList({ records, nameOf }: { records: readonly ServiceRequestRecord[]; nameOf: (id: Id) => string | undefined }) {
  const now = useNow(60_000);
  if (!records.length) return <p className={detail}>{COMMON_COPY.noRequests}</p>;
  return (
    <div>
      {records.map((r, i) => (
        <div key={`${r.at}-${i}`} className={line}>
          <code className={call}>{requestLine(r, nameOf)}</code>
          <span className={meta({ isBad: r.outcome !== 'ok' })}>
            {COMMON_COPY.requestMeta(r.clientName, agoLabel(r.at, now), outcomeLabel(r.outcome))}
          </span>
        </div>
      ))}
    </div>
  );
}
