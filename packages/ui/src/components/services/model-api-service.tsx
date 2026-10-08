import { useEffect, useState } from 'react';
import type { ModelApiConnectionInfo, ModelApiStatus, ServiceStatus } from '@baocut/protocol';
import { localizeText, MODEL_API_DEFAULT_MAX_CONCURRENT, MODEL_API_MAX_CONCURRENT_LIMIT } from '@baocut/protocol';
import { Badge, Button, Checkbox, NumberField, Switch, Text } from '@react-spectrum/s2';
import Copy from '@react-spectrum/s2/icons/Copy';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { SERVICE_COPY, SERVICES_PAGE_COPY } from '../../copy.ts';
import { API_CAPABILITIES, API_ENDPOINTS, CAPABILITY_LABEL, capabilityLine, formatBytes, ROUTING_ROWS } from '../../model/services-api.ts';
import { levelTitle, MCP_LEVELS } from '../../model/services-mcp.ts';
import { serviceBusy, serviceStateLabel, SERVICE_DEFAULT_PORT } from '../../model/services.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useModels } from '../../state/models-store.ts';
import { UtilityPage } from '../utility-page.tsx';
import { ModelApiAliases } from './model-api-aliases.tsx';
import { detail, detailXs, lede, panel, ServiceCard } from './service-card.tsx';
import { ServiceApprovals } from './service-approval-card.tsx';
import { ServiceClients } from './service-clients.tsx';
import {
  ActionsRow,
  AutostartCheckbox,
  CodeLine,
  ErrorFix,
  LevelChoice,
  PlannedNote,
  PortRow,
  RequestList,
  SectionHead,
  SetRow,
  Snippet,
  useServiceStatus,
} from './service-parts.tsx';
import { COMMON_COPY, MODEL_API_COPY } from './services-copy.ts';
import { copyText, useConfigureService, useFlipService } from './use-service-actions.ts';

/*
 * 模型接口服务详情页（原型 designs/baocut/app/page-services-api.jsx `ApiSection`、page-services-api-map.jsx；架构设计 §4.8）。
 * 原型里它是 Web 服务页的一节「OpenAI 兼容 API」（开关 + key + 地址 + 端点 + 模型映射）；Runtime 把它做成独立的服务，
 * 有自己的端口、令牌、等级、路由与别名，所以单独成一页，排在 Web 服务后面。与原型的不同：
 * - 原型一把可换的全局 key、可关——Runtime 按客户端发令牌、总是要：「需要 API key」开着且置灰；
 * - 原型每一类能力能单独关、能挂独立端口——Runtime 没有：开关与「独立端口」置灰；
 * - 原型点端点进详情页看参数、「试一试」——没有端点文档的数据，界面也拿不到令牌明文发请求：省略，原因写在端点段；
 * - 原型只用本机模型——Runtime 能把请求路由到在线服务、局域网节点与智能体，各有开关（「路由」段）。
 */

const methodBadge = style({ flexShrink: 0, width: 40, font: 'code-xs', fontWeight: 'bold', color: { default: 'gray-700', isGet: 'informative-900' } });
const ep = style({ display: 'flex', alignItems: 'baseline', gap: 8, paddingY: 4 });
const epPath = style({ font: 'code-sm', color: 'gray-900', overflowWrap: 'anywhere' });
const epTitle = style({ font: 'ui-xs', color: 'gray-600', marginStart: 'auto', flexShrink: 0 });
const cap = style({
  paddingY: 12,
  borderTopWidth: 0,
  borderXWidth: 0,
  borderBottomWidth: { default: 1, ':last-child': 0 },
  borderStyle: 'solid',
  borderColor: 'gray-100',
});
const capHead = style({ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 });
const capTxt = style({ display: 'flex', flexDirection: 'column', gap: 2, flexGrow: 1, minWidth: 0 });
const capName = style({ font: 'title-sm', color: 'gray-900' });
const capFoot = style({ marginTop: 4 });
const note = style({ margin: 0, marginTop: 8, font: 'ui-xs', color: 'gray-600' });
const concurrency = style({ width: 96 });

const DEFAULT_ROUTING = { online: false, nodes: false, agent: false };

export function ModelApiServicePage() {
  const { status, ready, connected, state } = useServiceStatus('model-api');
  const flip = useFlipService('model-api');
  const runtime = useRuntime();
  const [info, setInfo] = useState<ModelApiConnectionInfo | null>(null);
  const usable = !!status && state !== 'unavailable';
  useEffect(() => {
    if (!usable) return;
    let alive = true;
    runtime
      .modelApiConnectionInfo()
      .then((next) => alive && setInfo(next))
      .catch(() => alive && setInfo(null));
    return () => {
      alive = false;
    };
  }, [runtime, usable, status?.port, status?.state]);

  const copy = SERVICE_COPY['model-api'];
  const base = info?.baseUrl ?? `http://127.0.0.1:${status?.port ?? SERVICE_DEFAULT_PORT['model-api']}/v1`;
  let heading: string = MODEL_API_COPY.off;
  let subline: string = MODEL_API_COPY.offSub(base);
  let mono = false;
  if (!status) subline = connected ? SERVICES_PAGE_COPY.loading : SERVICES_PAGE_COPY.disconnected;
  else if (state === 'unavailable') {
    heading = SERVICES_PAGE_COPY.unavailableTitle(copy.name);
    subline = COMMON_COPY.unavailableSub;
  } else if (state === 'on') {
    heading = MODEL_API_COPY.on;
    subline = base;
    mono = true;
  } else if (state === 'error') {
    heading = MODEL_API_COPY.error;
    subline = localizeText(status.error, status.errorRef) ?? COMMON_COPY.errorFix;
  } else if (serviceBusy(state)) heading = serviceStateLabel('model-api', state);

  return (
    <UtilityPage
      kind="services"
      title={MODEL_API_COPY.title}
      actions={
        <Badge size="S" fillStyle="subtle" variant="neutral">
          {copy.scope}
        </Badge>
      }>
      <p className={lede}>{MODEL_API_COPY.lede}</p>
      <ServiceCard
        id="model-api"
        state={state}
        heading={heading}
        subline={subline}
        mono={mono}
        disabled={!connected || !ready || !usable}
        onFlip={flip}
        footer={
          usable && status ? (
            <>
              <AutostartCheckbox id="model-api" status={status} />
              <span className={detailXs}>{COMMON_COPY.stopsWithApp}</span>
            </>
          ) : undefined
        }>
        {state === 'error' && status ? <ErrorFix id="model-api" status={status} /> : null}
      </ServiceCard>

      {usable && status ? (
        <>
          <ServiceApprovals serviceId="model-api" />

          <SectionHead title={COMMON_COPY.section.connect} />
          <section className={panel}>
            <CodeLine label={MODEL_API_COPY.baseUrl} value={base} copyLabel={MODEL_API_COPY.copyBase} what={MODEL_API_COPY.baseUrl} />
            <p className={note}>
              {MODEL_API_COPY.baseLede}
              {state === 'on' ? '' : ` ${MODEL_API_COPY.baseOff}`}
            </p>
            {info ? <Snippet text={info.snippet} /> : null}
            <ActionsRow>
              <Button variant="secondary" size="S" isDisabled={!info} onPress={() => info && copyText(info.snippet, MODEL_API_COPY.snippetLabel)}>
                <Copy />
                <Text>{MODEL_API_COPY.copySnippet}</Text>
              </Button>
            </ActionsRow>
            <SetRow label={MODEL_API_COPY.needKey} desc={COMMON_COPY.needTokenDesc} dim>
              <Switch size="S" aria-label={MODEL_API_COPY.needKey} isSelected isDisabled />
            </SetRow>
            <PlannedNote>{MODEL_API_COPY.needKeyFixed}</PlannedNote>
          </section>

          <SectionHead title={COMMON_COPY.section.clients} />
          <section className={panel}>
            <ServiceClients kind="model-api" clients={status.clients} disabled={!connected} />
          </section>

          <ApiAccess status={status} />
          <ApiEndpoints api={status.modelApi} />
          <ModelApiAliases aliases={status.modelApi?.aliases ?? []} routing={status.modelApi?.routing ?? DEFAULT_ROUTING} disabled={!connected} />

          <SectionHead title={COMMON_COPY.section.requests} />
          <section className={panel}>
            <RequestList records={status.recentRequests} nameOf={() => undefined} />
          </section>

          <SectionHead title={COMMON_COPY.section.settings} />
          <section className={panel}>
            <PortRow id="model-api" status={status} />
          </section>
        </>
      ) : null}
    </UtilityPage>
  );
}

/** 允许的操作、路由与并发：立即生效。 */
function ApiAccess({ status }: { status: ServiceStatus }) {
  const configure = useConfigureService();
  const level = status.policy?.level ?? 'ask';
  const api = status.modelApi;
  const routing = api?.routing ?? DEFAULT_ROUTING;
  const options = MCP_LEVELS.map((l) => ({ ...l, desc: MODEL_API_COPY.levels[l.level] }));
  return (
    <>
      <SectionHead title={COMMON_COPY.levelLabel} aside={COMMON_COPY.liveNote} />
      <section className={panel}>
        <LevelChoice
          label={COMMON_COPY.levelLabel}
          value={level}
          options={options}
          disabled={false}
          onChange={(next) => void configure({ serviceId: 'model-api', level: next }, COMMON_COPY.levelSaved(levelTitle(next)))}
        />
      </section>

      <SectionHead title={MODEL_API_COPY.routingTitle} />
      <section className={panel}>
        <p className={detail}>{MODEL_API_COPY.routingLede}</p>
        {ROUTING_ROWS.map((r) => (
          <SetRow key={r.key} label={r.label} desc={r.desc}>
            <Switch
              size="S"
              aria-label={r.label}
              isSelected={routing[r.key]}
              onChange={(on) => void configure({ serviceId: 'model-api', routing: { [r.key]: on } }, MODEL_API_COPY.routingSaved)}
            />
          </SetRow>
        ))}
        <SetRow label={MODEL_API_COPY.concurrency} desc={MODEL_API_COPY.concurrencyDesc(MODEL_API_MAX_CONCURRENT_LIMIT)}>
          <NumberField
            aria-label={MODEL_API_COPY.concurrency}
            size="S"
            styles={concurrency}
            minValue={1}
            maxValue={MODEL_API_MAX_CONCURRENT_LIMIT}
            step={1}
            value={api?.maxConcurrentPerClient ?? MODEL_API_DEFAULT_MAX_CONCURRENT}
            onChange={(n) => {
              if (!Number.isInteger(n) || n === api?.maxConcurrentPerClient) return;
              void configure({ serviceId: 'model-api', maxConcurrentPerClient: n });
            }}
          />
        </SetRow>
        {api ? <p className={note}>{MODEL_API_COPY.limits(formatBytes(api.maxUploadBytes), formatBytes(api.maxJsonBytes))}</p> : null}
      </section>
    </>
  );
}

/** 端点：按能力分组，每组写此刻能路由到几个模型。能力开关与独立端口置灰（Runtime 没有）。 */
function ApiEndpoints({ api }: { api: ModelApiStatus | undefined }) {
  const view = useModels((s) => s.capabilities);
  const routing = api?.routing ?? DEFAULT_ROUTING;
  const rows = (capability: (typeof API_ENDPOINTS)[number]['capability']) =>
    API_ENDPOINTS.filter((e) => e.capability === capability).map((e) => (
      <div key={e.path} className={ep}>
        <span className={methodBadge({ isGet: e.method === 'GET' })}>{e.method}</span>
        <code className={epPath}>/v1{e.path}</code>
        <span className={epTitle}>{e.title}</span>
      </div>
    ));
  return (
    <>
      <SectionHead title={MODEL_API_COPY.endpointsTitle} />
      <section className={panel}>
        <p className={detail}>{MODEL_API_COPY.endpointsLede}</p>
        <div className={cap}>
          <div className={capHead}>
            <span className={capTxt}>
              <span className={capName}>{MODEL_API_COPY.modelsGroup}</span>
              <span className={detailXs}>{MODEL_API_COPY.modelsGroupSub}</span>
            </span>
          </div>
          {rows(null)}
        </div>
        {API_CAPABILITIES.map((c) => (
          <div key={c} className={cap}>
            <div className={capHead}>
              <span className={capTxt}>
                <span className={capName}>{CAPABILITY_LABEL[c]}</span>
                <span className={detailXs}>{view ? capabilityLine(view, c, routing) : MODEL_API_COPY.modelsLoading}</span>
              </span>
              <Switch size="S" aria-label={MODEL_API_COPY.capSwitch(CAPABILITY_LABEL[c])} isSelected isDisabled />
            </div>
            {rows(c)}
            <div className={capFoot}>
              <Checkbox size="S" isSelected={false} isDisabled>
                {MODEL_API_COPY.ownPort}
              </Checkbox>
            </div>
          </div>
        ))}
        <PlannedNote>{MODEL_API_COPY.endpointsFixed}</PlannedNote>
      </section>
    </>
  );
}
