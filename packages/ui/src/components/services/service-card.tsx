import type { ReactNode } from 'react';
import { Button, Text } from '@react-spectrum/s2';
import Play from '@react-spectrum/s2/icons/Play';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { serviceQuickAction, serviceTone, type ServiceId, type ServiceLight, type ServiceState } from '../../model/services.ts';
import { ServiceIcon, StopIcon } from './service-icon.tsx';
import { COMMON_COPY } from './services-copy.ts';

/*
 * 服务页共用的块（原型 designs/baocut/app/page-services.jsx `ServiceCard` / `Lede`、services.css `.svc*`）。
 * 卡片沿用原型的 `Card layer`：圆角 10、gray-50 底、1px gray-200 边。
 */

export const lede = style({ margin: 0, maxWidth: '[640px]', font: 'body-sm', color: 'gray-600' });
export const strong = style({ fontWeight: 'bold', color: 'gray-800' });
export const detail = style({ margin: 0, font: 'ui-sm', color: 'gray-600', overflowWrap: 'anywhere' });
export const detailXs = style({ margin: 0, font: 'ui-xs', color: 'gray-600' });
export const panel = style({
  boxSizing: 'border-box',
  maxWidth: '[640px]',
  padding: 16,
  marginTop: 12,
  borderRadius: 'lg',
  backgroundColor: 'gray-50',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'gray-200',
});
/** 原型 `.t-section`：11px 粗体、灰、字距略开。 */
export const sectionTitle = style({ margin: 0, marginTop: 24, font: 'ui-xs', fontWeight: 'bold', color: 'gray-600', letterSpacing: '[0.04em]' });

const card = style({
  boxSizing: 'border-box',
  maxWidth: '[640px]',
  padding: 16,
  marginTop: 20,
  borderRadius: 'lg',
  backgroundColor: 'gray-50',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'gray-200',
});
const head = style({ display: 'flex', alignItems: 'center', gap: 12 });
const txt = style({ display: 'flex', flexDirection: 'column', gap: 2, flexGrow: 1, minWidth: 0 });
const title = style({ font: 'title-sm', color: 'gray-900' });
// `font` 简写带运行时条件时宏会编成静态字符串，所以等宽与否分成两个类。
const sub = style({ font: 'ui-sm', color: 'gray-600', overflowWrap: 'anywhere', userSelect: 'text' });
const subMono = style({ font: 'code-sm', color: 'gray-600', overflowWrap: 'anywhere', userSelect: 'text' });
const foot = style({
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  columnGap: 12,
  rowGap: 4,
  marginTop: 12,
  paddingTop: 12,
  borderTopWidth: 1,
  borderXWidth: 0,
  borderBottomWidth: 0,
  borderStyle: 'solid',
  borderColor: 'gray-100',
});

/** 状态块：40×40、圆角 10；在跑绿底、出错橙底，图标跟着换色（services.css `.svc__mark`）。 */
const mark = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  size: 40,
  borderRadius: 'lg',
  backgroundColor: { tone: { off: 'gray-100', on: 'green-200', error: 'orange-200' } },
  color: { tone: { off: 'gray-700', on: 'green-1000', error: 'orange-1000' } },
  '--iconPrimary': { type: 'fill', value: 'currentColor' },
});

export function ServiceMark({ id, state }: { id: ServiceId; state: ServiceState }) {
  const tone = serviceTone(state);
  return (
    // 图标块里的标识图形统一 20px（产品设计 §2.1）
    <span className={mark({ tone })} data-bc-icons="primary" aria-hidden="true">
      <ServiceIcon id={id} error={tone === 'error'} />
    </span>
  );
}

/** 一颗 6px 的状态灯（services.css `.svclight`）：灰 = 关着、绿 = 在跑、橙 = 出错，起停中深一档灰。 */
const lightDot = style({
  display: 'inline-block',
  flexShrink: 0,
  size: 6,
  borderRadius: 'full',
  backgroundColor: { tone: { off: 'gray-500', on: 'green-900', error: 'orange-900' }, busy: 'gray-600' },
});
const lightsRow = style({ display: 'inline-flex', alignItems: 'center', gap: 4 });

export function ServiceLightDot({ tone, busy = false }: { tone: ServiceLight['tone']; busy?: boolean }) {
  return <span className={lightDot({ tone, busy })} aria-hidden="true" />;
}

/** 总览标题旁的一排灯，一项服务一颗（原型 `window.SvcLights`）。 */
export function ServiceLights({ lights }: { lights: ServiceLight[] }) {
  return (
    <span className={lightsRow} role="img" aria-label={COMMON_COPY.lightsLabel(lights.map((l) => l.label))}>
      {lights.map((l) => (
        <span key={l.id} title={l.label} style={{ display: 'inline-flex' }}>
          <ServiceLightDot tone={l.tone} busy={l.busy} />
        </span>
      ))}
    </span>
  );
}

/**
 * 详情页顶上的服务卡：状态块 + 标题 / 副行 + 一个起停按钮 + 页脚。按钮按状态给：开着给停、关着给起、出错给「重新…」、
 * 起停中给禁用的「正在…」、没有后端的不给按钮（原因写在副行里）。
 */
export function ServiceCard({
  id,
  state,
  heading,
  subline,
  mono = false,
  disabled = false,
  onFlip,
  footer,
  children,
}: {
  id: ServiceId;
  state: ServiceState;
  heading: ReactNode;
  subline: ReactNode;
  mono?: boolean;
  /** 没连上 Runtime 时起停按钮置灰。 */
  disabled?: boolean;
  onFlip?: (on: boolean) => void;
  footer?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className={card}>
      <div className={head}>
        <ServiceMark id={id} state={state} />
        <span className={txt}>
          <span className={title}>{heading}</span>
          <span className={mono ? subMono : sub}>{subline}</span>
        </span>
        <FlipButton id={id} state={state} disabled={disabled} onFlip={onFlip} size="M" />
      </div>
      {children}
      {footer ? <div className={foot}>{footer}</div> : null}
    </section>
  );
}

/** 起停按钮（服务卡与总览行共用）。 */
export function FlipButton({
  id,
  state,
  disabled,
  onFlip,
  size,
}: {
  id: ServiceId;
  state: ServiceState;
  disabled: boolean;
  onFlip?: (on: boolean) => void;
  size: 'S' | 'M';
}) {
  const action = serviceQuickAction(id, state);
  // 没有后端的服务不给起停按钮（原因写在旁边），免得像是「暂时按不了」。
  if (action.kind === 'unavailable') return null;
  if (action.kind === 'busy') {
    return (
      <Button variant="secondary" size={size} isDisabled>
        {action.label}
      </Button>
    );
  }
  if (action.kind === 'stop') {
    return (
      <Button variant="secondary" size={size} isDisabled={disabled} onPress={() => onFlip?.(false)}>
        <StopIcon />
        <Text>{action.label}</Text>
      </Button>
    );
  }
  return (
    <Button
      variant="accent"
      size={size}
      isDisabled={disabled || !onFlip}
      onPress={() => onFlip?.(true)}>
      <Play />
      <Text>{action.label}</Text>
    </Button>
  );
}
