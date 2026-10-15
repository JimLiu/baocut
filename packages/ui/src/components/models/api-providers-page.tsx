import { useEffect, useRef, useState } from 'react';
import type { ModelCapabilitiesView, OnlineCapability } from '@baocut/protocol';
import {
  ActionButton,
  Badge,
  Button,
  ButtonGroup,
  Content,
  Dialog,
  DialogContainer,
  Heading,
  SearchField,
  Text,
  TextField,
  ToastQueue,
} from '@react-spectrum/s2';
import AddIcon from '@react-spectrum/s2/icons/Add';
import ChevronLeftIcon from '@react-spectrum/s2/icons/ChevronLeft';
import ChevronRightIcon from '@react-spectrum/s2/icons/ChevronRight';
import { iconStyle, style } from '@react-spectrum/s2/style' with { type: 'macro' };
import {
  endpointOwner,
  findApiProvider,
  hostOf,
  looksLikeEndpoint,
  providerBase,
  providerCatalog,
  providerModelCount,
  providerRows,
  type ApiProvider,
  type CatalogCard,
  type ProviderRow,
} from '../../model/api-providers.ts';
import { customDraftReady, customProviderRequest, type CustomProviderDraft } from '../../model/models-cloud.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useConnection } from '../../state/connection-store.ts';
import { useModels } from '../../state/models-store.ts';
import { useShell, type ProvidersFrom } from '../../state/shell-store.ts';
import { PageStatus } from './model-parts.tsx';
import { CUSTOM_COPY, MODELS_PAGE_COPY } from './models-copy.ts';
import { KindControl } from './provider-dialogs.tsx';
import { ProviderDetail } from './provider-detail.tsx';
import { accountSummary, ProviderIcon, StateDot, stateLabel } from './provider-parts.tsx';
import { ADD_PROVIDER_COPY, CAP_SHORT, PROVIDERS_COPY, providerTag, regionLabel } from './providers-copy.ts';

/*
 * 设置 › 模型 › API 提供方（产品设计 §7.6；设计稿 settings-providers.jsx）：一行一家已添加的 API 提供方，能用的排前，底部
 * 「添加 API 提供方」；选一行进它的详情（provider-detail.tsx）。添加 sheet 顶部搜索，分模型厂商、中转平台与自建端点
 * （OpenAI 兼容）；选一张卡 = 没添加的先启用（还没有账号），再进详情并直接展开「添加账号」。
 * 路由的 `from`（产品设计 §7.6）在页面挂上时读一次：列表页 `add` 打开 sheet、`custom` 打开并聚焦自建端点的名称；详情里 `add`
 * 展开「添加账号」。读过就从地址里去掉，免得后退、刷新时再弹一次。浏览器里只能看：添加、启停、账号都要 Web 白名单之外的方法。
 */

export const intro = style({ marginBottom: 24 });
export const pageTitle = style({ margin: 0, fontSize: '[22px]', fontWeight: 'bold', lineHeight: '[28px]', color: 'gray-900' });
export const pageLede = style({ marginTop: 4, marginBottom: 0, font: 'ui', color: 'gray-600' });
export const webNote = style({ marginTop: 0, marginBottom: 16, font: 'ui-sm', color: 'gray-800', overflowWrap: 'anywhere' });

const list = style({
  marginBottom: 16,
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'gray-200',
  borderRadius: 'lg',
  backgroundColor: 'layer-1',
  overflow: 'hidden',
});
const row = style({
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  width: 'full',
  boxSizing: 'border-box',
  paddingX: 16,
  paddingY: 12,
  borderWidth: 0,
  borderBottomWidth: 1,
  borderStyle: 'solid',
  borderColor: 'gray-100',
  backgroundColor: { default: 'transparent', ':hover': 'gray-75' },
  textAlign: 'start',
  font: 'ui',
  color: 'gray-900',
  cursor: 'pointer',
  outlineStyle: { default: 'none', ':focus-visible': 'solid' },
  outlineColor: 'focus-ring',
  outlineWidth: 2,
  outlineOffset: -2,
});
const lastRow = style({ borderBottomWidth: 0 });
const rowName = style({ display: 'flex', flexDirection: 'column', gap: 2, flexGrow: 1, minWidth: 0 });
const rowTitle = style({ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 'bold' });
const rowSub = style({ font: 'ui-xs', color: 'gray-600', overflowWrap: 'anywhere' });
const rowAccount = style({
  flexShrink: 1,
  minWidth: 0,
  maxWidth: 200,
  font: { default: 'ui-sm', isMono: 'code-xs' },
  color: 'gray-700',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
const rowState = style({ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, font: 'ui-sm', color: 'gray-700' });
const chevron = style({ display: 'flex', flexShrink: 0, color: 'gray-600', '--iconPrimary': { type: 'fill', value: 'currentColor' } });
const chevronIcon = iconStyle({ size: 'S' });
const tag = style({
  paddingX: 4,
  borderRadius: 'sm',
  backgroundColor: 'gray-100',
  font: 'ui-xs',
  fontWeight: 'normal',
  color: 'gray-700',
});
const foot = style({ display: 'flex', alignItems: 'center', gap: 12 });
const empty = style({ marginTop: 0, marginBottom: 16, font: 'ui-sm', color: 'gray-600' });

/** 详情与「没找到」的「回到 API 提供方」。 */
export function BackToProviders({ label }: { label: string }) {
  const go = useShell((s) => s.go);
  return (
    <ActionButton isQuiet size="S" onPress={() => go({ tab: 'settings', section: 'providers' })}>
      <ChevronLeftIcon />
      <Text>{label}</Text>
    </ActionButton>
  );
}

/** 设置 › 模型 › API 提供方：`providerId` 有值进那一家的详情。 */
export function ProvidersSection({ providerId, from }: { providerId?: string; from?: ProvidersFrom }) {
  const view = useModels((s) => s.capabilities);
  const connected = useConnection((s) => s.state.status === 'connected');
  const replace = useShell((s) => s.replace);
  // 挂上时的 `from`：设置页按分节与提供方给滚动区换 key，所以每次进来都是新挂上。
  const [arrival] = useState(from);
  useEffect(() => {
    if (from) replace({ tab: 'settings', section: 'providers', ...(providerId ? { providerId } : {}) });
  }, [from, providerId, replace]);

  if (!view) return <PageStatus>{connected ? MODELS_PAGE_COPY.loading : MODELS_PAGE_COPY.offline}</PageStatus>;
  if (providerId) {
    const provider = findApiProvider(view, providerId);
    // 刚从添加 sheet 过来时，「已启用」可能还没经 `models` 主题回来：照样进详情。
    if (provider && (provider.added || arrival === 'add')) return <ProviderDetail view={view} provider={provider} addOpen={arrival === 'add'} />;
    return (
      <>
        <header className={intro}>
          <h1 className={pageTitle}>{PROVIDERS_COPY.title}</h1>
          <p className={pageLede}>{PROVIDERS_COPY.missing}</p>
        </header>
        <BackToProviders label={PROVIDERS_COPY.back} />
      </>
    );
  }
  return <ProviderList view={view} sheet={arrival ?? null} />;
}

function ProviderList({ view, sheet: initial }: { view: ModelCapabilitiesView; sheet: ProvidersFrom | null }) {
  const web = useRuntime().host.platform === 'web';
  const connected = useConnection((s) => s.state.status === 'connected');
  const go = useShell((s) => s.go);
  const [sheet, setSheet] = useState<ProvidersFrom | null>(web ? null : initial);
  const rows = providerRows(view, Date.now());

  return (
    <>
      <header className={intro}>
        <h1 className={pageTitle}>{PROVIDERS_COPY.title}</h1>
        <p className={pageLede}>{PROVIDERS_COPY.intro}</p>
      </header>
      {web ? <p className={webNote}>{PROVIDERS_COPY.webNote}</p> : null}
      {rows.length ? (
        <div className={list} role="list" aria-label={PROVIDERS_COPY.label}>
          {rows.map((r, i) => (
            <div role="listitem" key={r.provider.providerId}>
              <ListRow
                view={view}
                row={r}
                last={i === rows.length - 1}
                onOpen={() => go({ tab: 'settings', section: 'providers', providerId: r.provider.providerId })}
              />
            </div>
          ))}
        </div>
      ) : (
        <p className={empty}>{PROVIDERS_COPY.empty}</p>
      )}
      <div className={foot}>
        <Button variant="secondary" size="S" isDisabled={web || !connected} onPress={() => setSheet('add')}>
          <AddIcon />
          <Text>{PROVIDERS_COPY.add}</Text>
        </Button>
      </div>
      {sheet ? <AddProviderSheet view={view} focusCustom={sheet === 'custom'} onClose={() => setSheet(null)} /> : null}
    </>
  );
}

function ListRow({ view, row: { provider, state }, last, onOpen }: { view: ModelCapabilitiesView; row: ProviderRow; last: boolean; onOpen: () => void }) {
  const label = stateLabel(state);
  const summary = accountSummary(provider);
  const tagText = providerTag(provider.kind);
  const host = hostOf(providerBase(provider));
  const sub = [host, PROVIDERS_COPY.models(providerModelCount(view, provider.providerId)), provider.capabilities.map((c) => CAP_SHORT[c]).join(' / ')]
    .filter(Boolean)
    .join(' · ');
  return (
    <button type="button" className={`${row} ${last ? lastRow : ''}`} aria-label={PROVIDERS_COPY.open(provider.label, label)} onClick={onOpen}>
      <ProviderIcon provider={provider} />
      <span className={rowName}>
        <span className={rowTitle}>
          {provider.label}
          {tagText ? <span className={tag}>{tagText}</span> : null}
        </span>
        <span className={rowSub}>{sub}</span>
      </span>
      {summary.text && summary.text !== label ? <span className={rowAccount({ isMono: summary.mono })}>{summary.text}</span> : null}
      <span className={rowState}>
        <StateDot state={state} />
        {label}
      </span>
      <span className={chevron} aria-hidden>
        <ChevronRightIcon styles={chevronIcon} />
      </span>
    </button>
  );
}

// ---- 添加 API 提供方 ----

const sheetBody = style({ display: 'flex', flexDirection: 'column', gap: 20, minWidth: 0 });
const sheetHead = style({ margin: 0, marginBottom: 8, font: 'ui', fontWeight: 'bold', color: 'gray-900' });
const sheetNote = style({ marginTop: -4, marginBottom: 8, font: 'ui-xs', color: 'gray-600' });
const grid = style({ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8 });
const card = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minWidth: 0,
  padding: 12,
  borderWidth: 1,
  borderStyle: { default: 'solid', isCustom: 'dashed' },
  borderColor: { default: 'gray-200', ':hover': 'gray-400' },
  borderRadius: 'lg',
  backgroundColor: 'layer-1',
  textAlign: 'start',
  font: 'ui',
  color: 'gray-900',
  cursor: 'pointer',
  outlineStyle: { default: 'none', ':focus-visible': 'solid' },
  outlineColor: 'focus-ring',
  outlineWidth: 2,
});
const cardName = style({ display: 'flex', flexDirection: 'column', gap: 2, flexGrow: 1, minWidth: 0 });
/** 名字长时让名字换行，「已添加」不被挤短。 */
const badgeKeep = style({ flexShrink: 0 });
const cardTitle = style({ fontWeight: 'bold', overflowWrap: 'anywhere' });
const cardSub = style({ font: 'ui-xs', color: 'gray-600', overflowWrap: 'anywhere' });
const plus = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  size: 20,
  color: 'gray-700',
  '--iconPrimary': { type: 'fill', value: 'currentColor' },
});
const customGrid = style({ display: 'grid', gridTemplateColumns: { default: '1fr', '@container (min-width: 520px)': '1fr 1fr' }, gap: 12 });
const customWrap = style({ containerType: 'inline-size', display: 'flex', flexDirection: 'column', gap: 12 });
const notice = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'start',
  gap: 8,
  padding: 12,
  borderRadius: 'lg',
  backgroundColor: 'gray-100',
});
const noteText = style({ margin: 0, font: 'ui-sm', color: 'gray-700', overflowWrap: 'anywhere' });
const errorText = style({ margin: 0, font: 'ui-sm', color: 'negative', overflowWrap: 'anywhere' });

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** 「配置」一家（添加 sheet 选卡、能力页组头的按钮、地址撞上内置那家时）：没添加的先启用（还没有账号），再进详情展开「添加账号」。 */
export function useConfigureProvider() {
  const runtime = useRuntime();
  const go = useShell((s) => s.go);
  return async (provider: Pick<ApiProvider, 'providerId' | 'added'>): Promise<boolean> => {
    try {
      if (!provider.added) await runtime.configureModelProvider({ providerId: provider.providerId, enabled: true });
    } catch (err) {
      ToastQueue.negative(ADD_PROVIDER_COPY.failed(message(err)), { timeout: 5000 });
      return false;
    }
    go({ tab: 'settings', section: 'providers', providerId: provider.providerId, from: 'add' });
    return true;
  };
}

function AddProviderSheet({ view, focusCustom, onClose }: { view: ModelCapabilitiesView; focusCustom: boolean; onClose: () => void }) {
  const runtime = useRuntime();
  const go = useShell((s) => s.go);
  const configure = useConfigureProvider();
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<CustomProviderDraft>({ name: '', url: '', modelId: '', capability: 'generateText', voiceIds: '' });
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const customRef = useRef<HTMLElement | null>(null);
  const patch = (next: Partial<CustomProviderDraft>) => {
    setFailure(null);
    setDraft((old) => ({ ...old, ...next }));
  };

  const copy = ADD_PROVIDER_COPY;
  const catalog = providerCatalog(view, query, (c) => CAP_SHORT[c], [copy.customCard, copy.custom, copy.protocolValue]);
  const owner = draft.url.trim() ? endpointOwner(view, draft.url) : null;
  const badUrl = draft.url.trim() !== '' && !looksLikeEndpoint(draft.url);
  const ready = customDraftReady(draft) && !owner && !busy;

  /** 滚到自建端点那一节并聚焦名称（对话框的内容在打开后一帧才挂上）。 */
  const toCustom = () => {
    let tries = 0;
    const tick = () => {
      const section = customRef.current;
      const input = section?.querySelector('input');
      if (!input && tries++ < 30) return void requestAnimationFrame(tick);
      section?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      input?.focus({ preventScroll: true });
    };
    requestAnimationFrame(tick);
  };
  useEffect(() => {
    if (focusCustom) toCustom();
  }, [focusCustom]);

  const pick = async (provider: ApiProvider) => {
    setBusy(provider.providerId);
    const ok = await configure(provider);
    setBusy(null);
    if (ok) onClose();
  };

  const addCustom = async () => {
    if (!ready) return;
    setBusy('custom');
    setFailure(null);
    const request = customProviderRequest(view, draft);
    try {
      await runtime.configureModelProvider({ ...request, enabled: true });
      onClose();
      go({ tab: 'settings', section: 'providers', providerId: request.providerId, from: 'add' });
    } catch (err) {
      setFailure(copy.failed(message(err)));
    } finally {
      setBusy(null);
    }
  };

  const openOwner = (provider: ApiProvider) => {
    if (provider.kind !== 'custom' && !provider.added) return void pick(provider);
    onClose();
    go({ tab: 'settings', section: 'providers', providerId: provider.providerId });
  };

  const cardFor = ({ provider, capabilities }: CatalogCard) => {
    const sub = capabilities.map((c) => CAP_SHORT[c]).join(' / ') + (provider.vendor.regions?.length ? ` · ${provider.vendor.regions.map(regionLabel).join(' / ')}` : '');
    return (
      <button
        key={provider.providerId}
        type="button"
        className={card({ isCustom: false })}
        disabled={busy !== null}
        aria-busy={busy === provider.providerId}
        onClick={() => void pick(provider)}>
        <ProviderIcon provider={provider} />
        <span className={cardName}>
          <span className={cardTitle}>{provider.label}</span>
          <span className={cardSub}>{sub}</span>
        </span>
        {provider.added ? (
          <Badge variant="neutral" size="S" fillStyle="subtle" styles={badgeKeep}>
            {copy.added}
          </Badge>
        ) : null}
      </button>
    );
  };
  const customCard = (
    <button key="custom" type="button" className={card({ isCustom: true })} aria-label={copy.customCardLabel} onClick={toCustom}>
      <span className={plus} aria-hidden>
        <AddIcon />
      </span>
      <span className={cardName}>
        <span className={cardTitle}>{copy.customCard}</span>
        <span className={cardSub}>{copy.customCardDesc}</span>
      </span>
    </button>
  );

  const ownerNotice = owner ? (
    owner.kind === 'custom' ? (
      <div className={notice}>
        <p className={noteText}>{CUSTOM_COPY.taken(owner.label)}</p>
        <Button variant="secondary" size="S" onPress={() => openOwner(owner)}>
          {CUSTOM_COPY.takenAction(owner.label)}
        </Button>
      </div>
    ) : (
      <div className={notice}>
        <p className={noteText}>{copy.builtin(owner.label)}</p>
        <Button variant="secondary" size="S" isPending={busy === owner.providerId} onPress={() => openOwner(owner)}>
          {owner.added ? copy.builtinOpen(owner.label) : copy.builtinAction(owner.label)}
        </Button>
      </div>
    )
  ) : null;

  return (
    <DialogContainer onDismiss={onClose}>
      <Dialog size="L">
        {({ close }) => (
          <>
            <Heading slot="title">{copy.title}</Heading>
            <Content>
              <div className={sheetBody}>
                <SearchField aria-label={copy.search} placeholder={copy.searchPlaceholder} value={query} onChange={setQuery} />
                {catalog.vendors.length || catalog.custom ? (
                  <section aria-label={copy.vendors}>
                    <h3 className={sheetHead}>{copy.vendors}</h3>
                    <div className={grid}>
                      {catalog.vendors.map(cardFor)}
                      {catalog.custom ? customCard : null}
                    </div>
                  </section>
                ) : null}
                {catalog.relays.length ? (
                  <section aria-label={copy.relays}>
                    <h3 className={sheetHead}>{copy.relays}</h3>
                    <p className={sheetNote}>{copy.relaysNote}</p>
                    <div className={grid}>{catalog.relays.map(cardFor)}</div>
                  </section>
                ) : null}
                {!catalog.vendors.length && !catalog.relays.length && !catalog.custom ? <p className={noteText}>{copy.noMatch(query.trim())}</p> : null}
                <section aria-label={copy.custom} ref={customRef} className={customWrap}>
                  <div>
                    <h3 className={sheetHead}>{copy.custom}</h3>
                    <p className={sheetNote}>{copy.customNote}</p>
                  </div>
                  <div className={customGrid}>
                    <TextField label={copy.name} placeholder={copy.namePlaceholder} value={draft.name} onChange={(name) => patch({ name })} maxLength={60} />
                    <TextField
                      label={copy.url}
                      type="url"
                      placeholder={CUSTOM_COPY.urlPlaceholder}
                      value={draft.url}
                      onChange={(url) => patch({ url })}
                      isInvalid={badUrl}
                      errorMessage={copy.badUrl}
                    />
                    <TextField label={copy.protocol} value={copy.protocolValue} isReadOnly />
                    <TextField label={copy.model} value={draft.modelId} onChange={(modelId) => patch({ modelId })} />
                  </div>
                  <KindControl label={copy.capability} value={draft.capability} onChange={(capability: OnlineCapability) => patch({ capability })} />
                  {draft.capability === 'synthesizeSpeech' ? (
                    <TextField
                      label={CUSTOM_COPY.voices}
                      placeholder={CUSTOM_COPY.voicesPlaceholder}
                      value={draft.voiceIds}
                      onChange={(voiceIds) => patch({ voiceIds })}
                    />
                  ) : null}
                  {ownerNotice}
                  {failure ? (
                    <p className={errorText} role="alert">
                      {failure}
                    </p>
                  ) : null}
                  <div>
                    <Button variant="accent" size="S" isDisabled={!ready} isPending={busy === 'custom'} onPress={() => void addCustom()}>
                      {copy.addCustom}
                    </Button>
                  </div>
                </section>
              </div>
            </Content>
            <ButtonGroup>
              <Button variant="secondary" onPress={close}>
                {copy.close}
              </Button>
            </ButtonGroup>
          </>
        )}
      </Dialog>
    </DialogContainer>
  );
}
