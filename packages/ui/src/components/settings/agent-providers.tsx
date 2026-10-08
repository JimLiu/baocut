import { useEffect, useState } from 'react';
import { isBuiltinDriverId, type DriverId } from '@baocut/protocol';
import { ActionButton, Button, Disclosure, DisclosurePanel, DisclosureTitle, ProgressBar, Text, ToastQueue } from '@react-spectrum/s2';
import AlertTriangle from '@react-spectrum/s2/icons/AlertTriangle';
import ChevronDown from '@react-spectrum/s2/icons/ChevronDown';
import ChevronRight from '@react-spectrum/s2/icons/ChevronRight';
import CheckmarkCircle from '@react-spectrum/s2/icons/CheckmarkCircle';
import Code from '@react-spectrum/s2/icons/Code';
import Refresh from '@react-spectrum/s2/icons/Refresh';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { Button as RACButton } from 'react-aria-components';
import { agoLabel } from '../../model/format.ts';
import { configureAgent, detectAgents, watchAgentSetup } from '../../runtime/agent-commands.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useConnection } from '../../state/connection-store.ts';
import { HOME, useShell } from '../../state/shell-store.ts';
import { AgentCatalogSection } from './agent-catalog-section.tsx';
import { AGENT_COPY, AGENT_FAQ, MORE_PROVIDERS, providersMeta } from './agent-copy.ts';
import { Panel, SectionHeading } from './agent-panels.tsx';
import { AgentProviderCard } from './agent-provider-card.tsx';
import { agentOverview, groupDrivers, isInstalled, moreSummary, setupDoneToast } from './agent-setup.ts';

// 状态卡（settings-agent.css .agset-status）：卡片本身是中性的一层，只有左边 40px 的图标块按状态变色。
const status = style({
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 16,
  marginTop: 24,
  padding: 20,
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'gray-200',
  borderRadius: 'lg',
  backgroundColor: 'layer-1',
});
const statusIcon = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  size: 40,
  borderRadius: 'lg',
  backgroundColor: { default: 'gray-100', isReady: 'green-200', isAttention: 'orange-200' },
  color: { default: 'gray-700', isReady: 'green-1000', isAttention: 'orange-1000' },
  '--iconPrimary': { type: 'fill', value: 'currentColor' },
});
const statusText = style({ flexGrow: 1, flexBasis: 0, minWidth: 220 });
const statusTitle = style({ margin: 0, font: 'title-sm', color: 'gray-900' });
const statusBody = style({ marginTop: 4, marginBottom: 0, font: 'ui-sm', color: 'gray-700' });
const empty = style({ padding: 20, font: 'ui-sm', color: 'gray-600' });
const meta = style({ marginTop: 8, font: 'ui-xs', color: 'gray-600', textAlign: 'end' });
// 「更多」折叠段的开关（settings-agent.css .agset-more）：一整条描边按钮，展开后下面再接一张同样的卡。
const more = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: 'full',
  marginTop: 8,
  paddingX: 16,
  paddingY: 12,
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'gray-200',
  borderRadius: 'lg',
  backgroundColor: { default: 'transparent', isHovered: 'gray-100' },
  font: 'ui-sm',
  color: 'gray-800',
  textAlign: 'start',
  cursor: 'default',
  outlineStyle: { default: 'none', isFocusVisible: 'solid' },
  outlineColor: 'focus-ring',
  outlineWidth: 2,
  outlineOffset: 2,
  '--iconPrimary': { type: 'fill', value: 'gray-700' },
});
const moreText = style({ display: 'flex', flexDirection: 'column', gap: 4, flexGrow: 1, minWidth: 0 });
const moreTitle = style({ font: 'ui-xs', fontWeight: 'bold', color: 'gray-900' });
const moreSub = style({ font: 'ui-xs', color: 'gray-600' });
const moreAct = style({ flexShrink: 0, font: 'ui-xs', color: 'gray-700' });
const morePanel = style({ marginTop: 8 });
const catalog = style({ marginTop: 28 });
const faq = style({ marginTop: 28 });
// 常见问题一条一条之间一条分隔线，第一条上面不画（.agset-disclosure）。
const faqItem = style({
  paddingY: 4,
  borderTopWidth: { default: 1, ':first-child': 0 },
  borderXWidth: 0,
  borderBottomWidth: 0,
  borderStyle: 'solid',
  borderColor: 'gray-200',
});
const faqBody = style({ margin: 0, font: 'ui-sm', color: 'gray-700' });
const faqLink = style({ marginTop: 8 });

/**
 * Agent 提供方（page-settings-agent.jsx:112-157，产品设计 §7.6）：状态卡、每家一张卡、「更多」折叠段、添加更多 Agent、常见问题。
 * 主列表是检测到的、常驻的内置几家与用户添加的；收进「更多」的四家没检测到时折叠，装上了自己挪进主列表。
 */
export function AgentProviders() {
  const runtime = useRuntime();
  const connected = useConnection((s) => s.state.status === 'connected');
  const drivers = useConnection((s) => s.drivers);
  // 还在首次探测、没有任何结果的 Driver：没有卡片可画，用上面的进度条表示检测中。
  const checking = useConnection((s) => s.checking);
  const go = useShell((s) => s.go);
  const [expanded, setExpanded] = useState<DriverId | null>(null);
  const [scanning, setScanning] = useState(false);
  const [enabling, setEnabling] = useState(false);
  const [showMore, setShowMore] = useState(false);

  // 设置页里运行的安装、升级命令：这一页开着时订阅它的输出与结果；成功跑完（Runtime 已重新检测）弹一句。
  useEffect(
    () =>
      watchAgentSetup(runtime, (run, view) => {
        const now = view?.drivers.find((d) => d.id === run.driverId);
        const toast = now ? setupDoneToast(run, now) : null;
        if (toast) ToastQueue[toast.tone](toast.text, { timeout: 4000 });
      }),
    [runtime],
  );

  const groups = groupDrivers(drivers ?? []);
  const list = [...groups.main, ...groups.more];
  // 还没有就绪的、又有 Driver 在首次探测时不下结论（同 `homeGate`），状态卡先不出。
  const settled = !!drivers && (!checking.length || drivers.some((d) => d.state === 'ready'));
  const overview = drivers && settled ? agentOverview(drivers) : null;
  // 还在首次探测的没有 source 可看：内置的算内置，刚添加的算添加的。
  const pendingAdded = checking.filter((id) => !isBuiltinDriverId(id)).length;
  const checkedAt = list.map((d) => d.checkedAt).sort().at(-1);

  const rescan = async () => {
    setScanning(true);
    try {
      const view = await detectAgents(runtime);
      const n = view.drivers.filter(isInstalled).length;
      ToastQueue.neutral(AGENT_COPY.scanDone(n), { timeout: 3000 });
    } catch (error) {
      ToastQueue.negative(AGENT_COPY.scanFailed((error as Error).message), { timeout: 5000 });
    } finally {
      setScanning(false);
    }
  };

  const heroAct = async () => {
    if (!overview?.driverId) return;
    if (overview.action === 'start') return go(HOME);
    if (overview.action === 'open') return setExpanded(overview.driverId);
    if (overview.action === 'enable') {
      setEnabling(true);
      try {
        await configureAgent(runtime, overview.driverId, { enabled: true });
      } catch (error) {
        ToastQueue.negative(AGENT_COPY.enableFailed((error as Error).message), { timeout: 5000 });
      } finally {
        setEnabling(false);
      }
    }
  };

  return (
    <>
      {overview ? (
        <section className={status} aria-label={AGENT_COPY.statusLabel}>
          <span className={statusIcon({ isReady: overview.state === 'ready', isAttention: overview.state === 'attention' })} aria-hidden>
            {overview.state === 'ready' ? <CheckmarkCircle /> : overview.state === 'attention' ? <AlertTriangle /> : <Code />}
          </span>
          <div className={statusText}>
            <h2 className={statusTitle}>{overview.title}</h2>
            <p className={statusBody}>{overview.body}</p>
          </div>
          {overview.cta ? (
            <Button variant="accent" isDisabled={overview.action === 'enable' && (!connected || enabling)} onPress={() => void heroAct()}>
              {overview.cta}
            </Button>
          ) : null}
        </section>
      ) : null}

      <SectionHeading
        title={AGENT_COPY.providersHeading}
        hint={AGENT_COPY.providersHint}
        action={
          <ActionButton isQuiet size="S" isDisabled={!connected || scanning} onPress={() => void rescan()}>
            <Refresh />
            <Text>{scanning ? AGENT_COPY.scanning : AGENT_COPY.rescan}</Text>
          </ActionButton>
        }
      />
      {scanning || checking.length ? (
        <ProgressBar aria-label={AGENT_COPY.scanProgress} isIndeterminate size="S" styles={style({ width: 'full', marginBottom: 8 })} />
      ) : null}
      <Panel label={AGENT_COPY.providersHeading} flush>
        {drivers === null || (groups.main.length === 0 && checking.length) ? (
          <div className={empty}>{connected ? AGENT_COPY.scanning : AGENT_COPY.emptyDisconnected}</div>
        ) : list.length === 0 ? (
          <div className={empty}>{AGENT_COPY.emptyNoDrivers}</div>
        ) : groups.main.length === 0 ? (
          <div className={empty}>{AGENT_COPY.emptyNoneFound}</div>
        ) : (
          groups.main.map((driver) => (
            <AgentProviderCard
              key={driver.id}
              driver={driver}
              connected={connected}
              open={expanded === driver.id}
              onToggle={(open) => setExpanded(open ? driver.id : null)}
            />
          ))
        )}
      </Panel>
      {groups.more.length ? (
        <>
          <RACButton className={more} aria-expanded={showMore} aria-controls="agent-more-providers" onPress={() => setShowMore((v) => !v)}>
            {showMore ? <ChevronDown /> : <ChevronRight />}
            <span className={moreText}>
              <span className={moreTitle}>{MORE_PROVIDERS.title(groups.more.length)}</span>
              <span className={moreSub}>{MORE_PROVIDERS.sub(moreSummary(groups.more))}</span>
            </span>
            <span className={moreAct}>{showMore ? MORE_PROVIDERS.collapse : MORE_PROVIDERS.expand}</span>
          </RACButton>
          {showMore ? (
            <div id="agent-more-providers" className={morePanel}>
              <Panel label={MORE_PROVIDERS.title(groups.more.length)} flush>
                {groups.more.map((driver) => (
                  <AgentProviderCard
                    key={driver.id}
                    driver={driver}
                    connected={connected}
                    open={expanded === driver.id}
                    onToggle={(open) => setExpanded(open ? driver.id : null)}
                  />
                ))}
              </Panel>
            </div>
          ) : null}
        </>
      ) : null}
      {list.length ? (
        <div className={meta}>
          {providersMeta(
            checkedAt ? agoLabel(checkedAt) : null,
            groups.builtin + checking.length - pendingAdded,
            groups.added + pendingAdded,
            groups.found,
          )}
        </div>
      ) : null}

      <div className={catalog}>
        <AgentCatalogSection onAdded={setExpanded} />
      </div>

      <div className={faq}>
        <Panel label={AGENT_COPY.faqLabel}>
          {AGENT_FAQ.map((item) => (
            <div key={item.key} className={faqItem}>
              <Disclosure isQuiet size="S">
                <DisclosureTitle>{item.title}</DisclosureTitle>
                <DisclosurePanel>
                  <p className={faqBody}>{item.body}</p>
                  {item.link === 'models' ? (
                    <div className={faqLink}>
                      <ActionButton isQuiet size="S" onPress={() => go({ tab: 'models', category: 'llm', page: 'cloud' })}>
                        {AGENT_COPY.goCloudModels}
                      </ActionButton>
                    </div>
                  ) : item.link === 'skills' ? (
                    <div className={faqLink}>
                      <ActionButton isQuiet size="S" onPress={() => go({ tab: 'settings', section: 'skills' })}>
                        {AGENT_COPY.goSkills}
                      </ActionButton>
                    </div>
                  ) : null}
                </DisclosurePanel>
              </Disclosure>
            </div>
          ))}
        </Panel>
      </div>
    </>
  );
}
