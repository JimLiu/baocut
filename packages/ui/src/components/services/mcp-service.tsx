import { useEffect, useMemo, useState } from 'react';
import { localizeText, type Id, type McpConnectionInfo, type ServiceStatus } from '@baocut/protocol';
import { Badge, Button, Header, Heading, Link, Menu, MenuItem, MenuSection, MenuTrigger, Switch, Text } from '@react-spectrum/s2';
import ChevronDown from '@react-spectrum/s2/icons/ChevronDown';
import Copy from '@react-spectrum/s2/icons/Copy';
import Refresh from '@react-spectrum/s2/icons/Refresh';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { SERVICE_COPY, SERVICES_PAGE_COPY } from '../../copy.ts';
import { MCP_LEVELS, mcpScope, mcpSub, pickedScope, scopeVideos, levelTitle } from '../../model/services-mcp.ts';
import { serviceBusy, serviceStateLabel } from '../../model/services.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useShell } from '../../state/shell-store.ts';
import { useSpace } from '../../state/space-store.ts';
import { UtilityPage } from '../utility-page.tsx';
import { McpTools } from './mcp-tools.tsx';
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
import { COMMON_COPY, MCP_COPY } from './services-copy.ts';
import { copyText, useConfigureService, useFlipService } from './use-service-actions.ts';

/*
 * MCP 服务详情页（原型 designs/baocut/app/page-services.jsx `McpServicePage`；架构设计 §4.8、§12.8）。
 * 读写 `services.*` 与 `services.mcp.*`：起停、连接信息、客户端令牌、最近请求、开放范围、允许的操作、端口与自动启动。
 * 与原型的不同：
 * - 原型「要更换视频、权限或令牌设置，请先停止服务」——Runtime 每次请求现读策略，运行中改了立即生效，所以不锁；
 * - 原型一把全局令牌、可关掉——Runtime 按客户端发令牌、总是要，所以「需要访问令牌」开着且置灰，令牌在「客户端与令牌」里发；
 * - 原型「已连接的客户端」是在线连接——Runtime 只有已发放的客户端与最近使用时间，没有在线状态；
 * - 「检查服务」置灰：Runtime 没有给界面健康检查。
 */

const pickerBtn = style({ marginTop: 8 });
const labelBlock = style({ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 16 });
const labelFirst = style({ display: 'flex', flexDirection: 'column', gap: 4 });
const labelText = style({ font: 'ui', fontWeight: 'bold', color: 'gray-900' });
const related = style({ margin: 0, marginTop: 24, maxWidth: '[640px]', font: 'ui-sm', color: 'gray-600' });
const notice = style({ margin: 0, marginTop: 8, font: 'ui-xs', color: 'gray-600' });

export function McpServicePage() {
  const go = useShell((s) => s.go);
  const { status, ready, connected, state } = useServiceStatus('mcp');
  const flip = useFlipService('mcp');
  const entries = useSpace((s) => s.entries);
  const videos = useMemo(() => scopeVideos(entries), [entries]);
  const nameOf = useMemo(() => {
    const names = new Map(videos.map((v) => [v.videoId, v.name] as const));
    return (id: Id) => names.get(id);
  }, [videos]);

  const policy = status?.policy ?? { videos: 'all' as const, level: 'ask' as const };
  const scope = mcpScope(policy.videos, videos.length, nameOf);
  const copy = SERVICE_COPY.mcp;

  let heading: string = MCP_COPY.off;
  let subline: string = mcpSub(state, scope, policy.level);
  if (!status) subline = connected ? SERVICES_PAGE_COPY.loading : SERVICES_PAGE_COPY.disconnected;
  else if (state === 'unavailable') {
    heading = SERVICES_PAGE_COPY.unavailableTitle(copy.name);
    subline = COMMON_COPY.unavailableSub;
  } else if (state === 'on') heading = MCP_COPY.on;
  else if (state === 'error') {
    heading = MCP_COPY.error;
    subline = localizeText(status.error, status.errorRef) ?? COMMON_COPY.errorFix;
  } else if (serviceBusy(state)) heading = serviceStateLabel('mcp', state);

  const usable = !!status && state !== 'unavailable';

  return (
    <UtilityPage
      kind="services"
      title={MCP_COPY.title}
      actions={
        <Badge size="S" fillStyle="subtle" variant="neutral">
          {copy.scope}
        </Badge>
      }>
      <p className={lede}>{MCP_COPY.lede}</p>
      <ServiceCard
        id="mcp"
        state={state}
        heading={heading}
        subline={subline}
        disabled={!connected || !ready || !usable}
        onFlip={flip}
        footer={
          usable && status ? (
            <>
              <AutostartCheckbox id="mcp" status={status} />
              <span className={detailXs}>{COMMON_COPY.stopsWithApp}</span>
            </>
          ) : undefined
        }>
        {state === 'error' && status ? <ErrorFix id="mcp" status={status} /> : null}
      </ServiceCard>

      {usable && status ? (
        <>
          <ServiceApprovals serviceId="mcp" />
          <McpConnect status={status} />

          <SectionHead title={MCP_COPY.clientsTitle} />
          <section className={panel}>
            <ServiceClients kind="mcp" clients={status.clients} disabled={!connected} />
          </section>

          <SectionHead title={COMMON_COPY.section.requests} />
          <section className={panel}>
            <RequestList records={status.recentRequests} nameOf={nameOf} />
          </section>

          <McpAccess status={status} videos={videos} scope={scope} />
          <McpTools level={policy.level} />

          <SectionHead title={COMMON_COPY.section.settings} />
          <section className={panel}>
            <PortRow id="mcp" status={status} />
          </section>
        </>
      ) : null}

      <p className={related}>
        {SERVICES_PAGE_COPY.mcpRelated}{' '}
        <Link isStandalone isQuiet onPress={() => go({ tab: 'settings', section: 'skills' })}>
          {SERVICES_PAGE_COPY.mcpRelatedLink}
        </Link>
      </p>
    </UtilityPage>
  );
}

/** 「连接」：地址、配置片段（令牌是占位符）、复制。服务没开着时 Runtime 也给地址与片段，另带一句提示。 */
function McpConnect({ status }: { status: ServiceStatus }) {
  const runtime = useRuntime();
  const [info, setInfo] = useState<McpConnectionInfo | null>(null);
  useEffect(() => {
    let alive = true;
    runtime
      .mcpConnectionInfo()
      .then((next) => alive && setInfo(next))
      .catch(() => alive && setInfo(null));
    return () => {
      alive = false;
    };
  }, [runtime, status.port, status.state]);
  const url = status.endpoint ?? info?.url ?? null;
  return (
    <>
      <SectionHead title={COMMON_COPY.section.connect} />
      <section className={panel}>
        <p className={detail}>{MCP_COPY.connectHint}</p>
        {url ? <CodeLine value={url} copyLabel={MCP_COPY.copyAddress} what={MCP_COPY.address} /> : null}
        {info ? (
          <>
            <Snippet text={info.snippet} />
            <p className={notice}>{info.notice ?? MCP_COPY.snippetNote}</p>
          </>
        ) : null}
        <ActionsRow>
          <Button variant="secondary" size="S" isDisabled={!info} onPress={() => info && copyText(info.snippet, MCP_COPY.snippetLabel)}>
            <Copy />
            <Text>{MCP_COPY.copySnippet}</Text>
          </Button>
          <Button variant="secondary" fillStyle="outline" size="S" isDisabled>
            <Refresh />
            <Text>{MCP_COPY.check}</Text>
          </Button>
        </ActionsRow>
        <PlannedNote>{MCP_COPY.checkReason}</PlannedNote>
      </section>
    </>
  );
}

/** 「允许的操作」与「可访问的视频」：运行中改也立即生效（Runtime 每次请求现读策略）。 */
function McpAccess({ status, videos, scope }: { status: ServiceStatus; videos: { videoId: Id; name: string }[]; scope: string }) {
  const configure = useConfigureService();
  const policy = status.policy ?? { videos: 'all' as const, level: 'ask' as const };
  const all = videos.map((v) => v.videoId);
  const picked = policy.videos === 'all' ? [] : policy.videos.ids;
  const setVideos = (next: typeof policy.videos) => void configure({ serviceId: 'mcp', videos: next }, MCP_COPY.scopeSaved);
  return (
    <>
      <SectionHead title={MCP_COPY.accessSection} aside={COMMON_COPY.liveNote} />
      <section className={panel}>
        <div className={labelFirst}>
          <span className={labelText}>{MCP_COPY.scopeTitle}</span>
          <span className={detail}>{MCP_COPY.scopeDesc}</span>
        </div>
        <MenuTrigger>
          <Button variant="secondary" size="S" styles={pickerBtn}>
            <Text>{scope}</Text>
            <ChevronDown />
          </Button>
          <Menu aria-label={MCP_COPY.scopeTitle}>
            <MenuSection
              selectionMode="single"
              selectedKeys={policy.videos === 'all' ? ['all'] : []}
              onSelectionChange={(keys) => {
                if (keys === 'all' || keys.has('all')) setVideos('all');
              }}>
              <MenuItem id="all" textValue={MCP_COPY.scopeAll}>
                <Text slot="label">{MCP_COPY.scopeAll}</Text>
                <Text slot="description">{MCP_COPY.scopeAllSub(videos.length)}</Text>
              </MenuItem>
            </MenuSection>
            <MenuSection
              selectionMode="multiple"
              selectedKeys={picked}
              onSelectionChange={(keys) => setVideos(keys === 'all' ? 'all' : pickedScope([...keys].map(String), all))}>
              <Header>
                <Heading>{MCP_COPY.scopePick}</Heading>
              </Header>
              {videos.length ? (
                videos.map((v) => (
                  <MenuItem key={v.videoId} id={v.videoId} textValue={v.name}>
                    <Text slot="label">{v.name}</Text>
                  </MenuItem>
                ))
              ) : (
                <MenuItem id="none" textValue={MCP_COPY.scopeNone} isDisabled>
                  <Text slot="label">{MCP_COPY.scopeNone}</Text>
                </MenuItem>
              )}
            </MenuSection>
          </Menu>
        </MenuTrigger>

        <div className={labelBlock}>
          <span className={labelText}>{COMMON_COPY.levelLabel}</span>
          <span className={detail}>{MCP_COPY.levelDesc}</span>
        </div>
        <LevelChoice
          label={COMMON_COPY.levelLabel}
          value={policy.level}
          options={MCP_LEVELS}
          disabled={false}
          onChange={(level) => void configure({ serviceId: 'mcp', level }, COMMON_COPY.levelSaved(levelTitle(level)))}
        />

        <SetRow label={COMMON_COPY.needToken} desc={COMMON_COPY.needTokenDesc} dim>
          <Switch size="S" aria-label={COMMON_COPY.needToken} isSelected isDisabled />
        </SetRow>
        <PlannedNote>{COMMON_COPY.needTokenFixed}</PlannedNote>
      </section>
    </>
  );
}
