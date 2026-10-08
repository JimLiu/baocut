import { ActionButton, Badge } from '@react-spectrum/s2';
import ChevronRight from '@react-spectrum/s2/icons/ChevronRight';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { Button as RACButton } from 'react-aria-components';
import { REMOTE_COPY, SERVICE_COPY, SERVICES_PAGE_COPY } from '../../copy.ts';
import { mcpScope, mcpSub, scopeVideos } from '../../model/services-mcp.ts';
import { shareAddresses } from '../../model/services-remote.ts';
import {
  findService,
  SERVICE_IDS,
  serviceBusy,
  serviceLights,
  servicesSummary,
  serviceStateLabel,
  serviceTone,
  type ServiceId,
  type ServiceState,
} from '../../model/services.ts';
import { useConnection } from '../../state/connection-store.ts';
import { useServices } from '../../state/services-store.ts';
import { useShare } from '../../state/share-store.ts';
import { useShell } from '../../state/shell-store.ts';
import { useSpace } from '../../state/space-store.ts';
import { UtilityPage } from '../utility-page.tsx';
import { FlipButton, lede, ServiceLightDot, ServiceLights, ServiceMark } from './service-card.tsx';
import { useFlipService } from './use-service-actions.ts';
import { useServiceStates } from './use-share-status.ts';

/* 服务总览（原型 designs/baocut/app/page-services.jsx `ServicesOverview` / `ServiceItem`，services.css `.svclist` / `.svcitem`）：
   一张卡四行（原型三行，加上从 Web 服务页拆出来的模型接口），行内就地起停，点名字进详情。 */

const actions = style({ display: 'flex', alignItems: 'center', gap: 12 });
const list = style({
  boxSizing: 'border-box',
  maxWidth: '[720px]',
  paddingX: 16,
  paddingY: 4,
  marginTop: 20,
  borderRadius: 'lg',
  backgroundColor: 'gray-50',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'gray-200',
});
const item = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  paddingY: 12,
  borderTopWidth: 0,
  borderXWidth: 0,
  borderBottomWidth: { default: 1, ':last-child': 0 },
  borderStyle: 'solid',
  borderColor: 'gray-100',
});
const main = style({
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  flexGrow: 1,
  flexShrink: 1,
  minWidth: 0,
  padding: 4,
  margin: -4,
  borderWidth: 0,
  borderRadius: 'default',
  backgroundColor: 'transparent',
  font: 'ui',
  color: 'inherit',
  textAlign: 'start',
  cursor: 'default',
  outlineStyle: { default: 'none', isFocusVisible: 'solid' },
  outlineColor: 'focus-ring',
  outlineWidth: 2,
  outlineOffset: 2,
});
const itemTxt = style({ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 });
const itemName = style({ display: 'flex', alignItems: 'center', gap: 8, font: 'ui' });
const itemNameText = style({ fontWeight: 'bold', color: 'gray-900', textDecoration: { default: 'none', isHovered: 'underline' } });
const itemState = style({ display: 'flex', alignItems: 'center', gap: '[6px]', font: 'ui-sm', color: 'gray-700', minWidth: 0 });
const itemLabel = style({ flexShrink: 0, whiteSpace: 'nowrap' });
const itemSep = style({ color: 'gray-400' });
const itemDetail = style({ color: 'gray-600', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 });
// 起停按钮不跟着让位：出错原因很长时左侧那段按比例收缩，按钮会被挤成两行，所以按钮这格不收缩。
const itemAction = style({ display: 'flex', flexShrink: 0, whiteSpace: 'nowrap' });

export function ServicesOverview() {
  const states = useServiceStates();
  const summary = servicesSummary(states);
  return (
    <UtilityPage
      kind="services"
      title={SERVICES_PAGE_COPY.title}
      actions={
        <span className={actions}>
          <ServiceLights lights={serviceLights(states)} />
          <Badge size="S" fillStyle="subtle" variant={summary.tone === 'error' ? 'notice' : summary.tone === 'on' ? 'positive' : 'neutral'}>
            {summary.text}
          </Badge>
        </span>
      }>
      <p className={lede}>{SERVICES_PAGE_COPY.lede}</p>
      <div className={list}>
        {SERVICE_IDS.map((id) => (
          <ServiceItem key={id} id={id} state={states[id]} />
        ))}
      </div>
    </UtilityPage>
  );
}

/**
 * 一行副文：出错说原因；远端算力开着说节点名与地址；MCP 说开放范围与权限（原型 `mcpSub`）；Web 与模型接口开着说地址；
 * Runtime 没有提供的说为什么；其余说这项服务是做什么的。
 */
function useItemDetail(id: ServiceId, state: ServiceState): string {
  const share = useShare((s) => s.status);
  const status = useServices((s) => findService(s.services, id));
  const entries = useSpace((s) => s.entries);
  if (state === 'unavailable') return SERVICES_PAGE_COPY.unavailableDetail;
  if (id === 'remote') {
    if (state === 'error') return share?.error ?? status?.error ?? REMOTE_COPY.subErrorFallback;
    if (state === 'on' && share) return `${share.name} · ${shareAddresses(share)[0] ?? REMOTE_COPY.noAddress}`;
    return SERVICE_COPY.remote.desc;
  }
  if (state === 'error') return status?.error ?? SERVICE_COPY[id].desc;
  if (id === 'mcp' && status?.policy) {
    const videos = scopeVideos(entries);
    const names = new Map(videos.map((v) => [v.videoId, v.name] as const));
    return mcpSub(state, mcpScope(status.policy.videos, videos.length, (v) => names.get(v)), status.policy.level);
  }
  if (state === 'on' && status?.endpoint) return status.endpoint;
  return SERVICE_COPY[id].desc;
}

function ServiceItem({ id, state }: { id: ServiceId; state: ServiceState }) {
  const go = useShell((s) => s.go);
  const connected = useConnection((s) => s.state.status === 'connected');
  const flip = useFlipService(id);
  const detail = useItemDetail(id, state);
  const copy = SERVICE_COPY[id];
  const open = () => go({ tab: 'services', service: id });
  return (
    <div className={item}>
      <RACButton className={(s) => main(s)} onPress={open}>
        {({ isHovered }) => (
          <>
            <ServiceMark id={id} state={state} />
            <span className={itemTxt}>
              <span className={itemName}>
                <span className={itemNameText({ isHovered })}>{copy.name}</span>
                <Badge size="S" fillStyle="subtle" variant="neutral">
                  {copy.scope}
                </Badge>
              </span>
              <span className={itemState}>
                <ServiceLightDot tone={serviceTone(state)} busy={serviceBusy(state)} />
                <span className={itemLabel}>{serviceStateLabel(id, state)}</span>
                <span className={itemSep} aria-hidden="true">
                  ·
                </span>
                <span className={itemDetail} title={detail}>
                  {detail}
                </span>
              </span>
            </span>
          </>
        )}
      </RACButton>
      {state === 'unavailable' ? null : (
        <span className={itemAction}>
          <FlipButton id={id} state={state} size="S" disabled={!connected} onFlip={flip} />
        </span>
      )}
      <ActionButton isQuiet size="S" aria-label={SERVICES_PAGE_COPY.open(copy.name)} onPress={open}>
        <ChevronRight />
      </ActionButton>
    </div>
  );
}
