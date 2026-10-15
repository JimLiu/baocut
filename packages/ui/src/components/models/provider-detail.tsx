import { useEffect, useState, type ReactNode } from 'react';
import type { ModelCapabilitiesView, OnlineCapability, ProviderAccountView, UsageReport } from '@baocut/protocol';
import {
  ActionButton,
  AlertDialog,
  Badge,
  Button,
  DialogContainer,
  Disclosure,
  DisclosurePanel,
  DisclosureTitle,
  Link,
  SegmentedControl,
  SegmentedControlItem,
  Switch,
  Text,
  TextField,
  ToastQueue,
  Tooltip,
  TooltipTrigger,
} from '@react-spectrum/s2';
import AddIcon from '@react-spectrum/s2/icons/Add';
import ChevronLeftIcon from '@react-spectrum/s2/icons/ChevronLeft';
import DeleteIcon from '@react-spectrum/s2/icons/Delete';
import EditIcon from '@react-spectrum/s2/icons/Edit';
import RefreshIcon from '@react-spectrum/s2/icons/Refresh';
import { iconStyle, style } from '@react-spectrum/s2/style' with { type: 'macro' };
import {
  accountBase,
  accountStatus,
  catalogCapabilities,
  hostOf,
  looksLikeEndpoint,
  primaryAccount,
  primaryOrder,
  providerBase,
  providerState,
  stateReady,
  type ApiProvider,
} from '../../model/api-providers.ts';
import { CAPABILITY_SHORT, cloudProviders, refreshAfterKey, refreshKind, refreshLine } from '../../model/models-cloud.ts';
import { probeSupported, probeVerdict } from '../../model/models-probe.ts';
import { formatMoney } from '../../model/usage-format.ts';
import { providerCanClone } from '../../model/voice-capture.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useConnection } from '../../state/connection-store.ts';
import { useShell } from '../../state/shell-store.ts';
import { ModelVoicesLine } from './model-voices-line.tsx';
import { CLOUD_COPY } from './models-copy.ts';
import { ProbeDialog } from './probe-dialog.tsx';
import { AddModelDialog } from './provider-dialogs.tsx';
import {
  accountDetail,
  accountName,
  accountStatusLabel,
  lastUsedText,
  modelLeadText,
  ProviderIcon,
  refreshText,
  TONE_BADGE,
  useProbeRuns,
  type ProbeTarget,
} from './provider-parts.tsx';
import { ADD_PROVIDER_COPY, CAP_SHORT, PROVIDER_DETAIL_COPY, PROVIDERS_COPY, regionLabel, USAGE_COPY } from './providers-copy.ts';

/*
 * API 提供方详情（产品设计 §7.6；设计稿 settings-provider-detail.jsx）：页头（图标、名称、官网、能力、启用开关）、账号、
 * 能力与模型、用量，底部「移除 API 提供方」。
 * 账号有先后：调用总是用第一个启用且有密钥的账号，出错时不自动换下一个（架构设计 §6.2），先后由「设为首选」调整。
 * 「验证并保存」先向这家验证一次（`models.addAccount` 带 `verify`），不通过不保存、把原因写在表单里。地区与端点都按账号存
 * （架构设计 §6.8）：设计稿页头那块「地区」不做，地区只在添加账号时选。
 * 目录里有、还没接入的能力列出来标「尚未接入」，不能测试、不能设为默认。浏览器里只能看、测试与看用量。
 */

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));
const badEndpoint = (url: string) => url.trim() !== '' && !looksLikeEndpoint(url);

const back = style({ marginBottom: 8, marginStart: -8 });
const head = style({ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 });
const headText = style({ display: 'flex', flexDirection: 'column', gap: 2, flexGrow: 1, minWidth: 0 });
const title = style({ margin: 0, fontSize: '[22px]', fontWeight: 'bold', lineHeight: '[28px]', color: 'gray-900', overflowWrap: 'anywhere' });
const sub = style({ font: 'ui-sm', color: 'gray-600', overflowWrap: 'anywhere' });
const mono = style({ font: 'code-xs' });
const offNote = style({ marginTop: 0, marginBottom: 8, font: 'ui-sm', color: 'gray-700' });
const group = style({ marginTop: 24 });
const groupTitle = style({ marginTop: 0, marginBottom: 8, font: 'title-sm', color: 'gray-900' });
const card = style({
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'gray-200',
  borderRadius: 'lg',
  backgroundColor: 'layer-1',
  minWidth: 0,
});
const cardPad = style({ paddingX: 16, paddingY: 12 });
const detailText = style({ margin: 0, font: 'ui-sm', color: 'gray-600', overflowWrap: 'anywhere' });
const smallText = style({ margin: 0, font: 'ui-xs', color: 'gray-600', overflowWrap: 'anywhere' });
const negativeText = style({ margin: 0, font: 'ui-sm', color: 'negative', overflowWrap: 'anywhere' });
const negativeSmall = style({ margin: 0, font: 'ui-xs', color: 'negative', overflowWrap: 'anywhere' });

/** 移除提供方的确认正文：没有账号时不提「0 个账号」。 */
function removeBody(provider: ApiProvider): string {
  const n = provider.accounts.length;
  if (provider.kind === 'custom') return n ? PROVIDER_DETAIL_COPY.removeProviderBodyCustom(n) : PROVIDER_DETAIL_COPY.removeProviderBodyCustomEmpty;
  return n ? PROVIDER_DETAIL_COPY.removeProviderBody(n) : PROVIDER_DETAIL_COPY.removeProviderBodyEmpty;
}

/** 详情页：`addOpen` 时直接展开「添加账号」（从添加 sheet、能力页的「配置」过来）。 */
export function ProviderDetail({ view, provider, addOpen }: { view: ModelCapabilitiesView; provider: ApiProvider; addOpen: boolean }) {
  const runtime = useRuntime();
  const web = runtime.host.platform === 'web';
  const connected = useConnection((s) => s.state.status === 'connected');
  const go = useShell((s) => s.go);
  const replace = useShell((s) => s.replace);
  const [toggling, setToggling] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const copy = PROVIDER_DETAIL_COPY;
  const enabled = provider.config?.enabled ?? false;
  const canEdit = !web && connected;

  const site = provider.vendor.website;
  const openSite = () => {
    if (!site) return;
    const open = runtime.host.openExternal;
    if (open) void open(site).catch((err: Error) => ToastQueue.negative(err.message, { timeout: 5000 }));
    else window.open(site, '_blank', 'noopener,noreferrer');
  };
  const caps = catalogCapabilities(provider)
    .map((c) => CAP_SHORT[c])
    .join(' / ');
  const kindText = provider.kind === 'relay' ? copy.relay : provider.kind === 'custom' ? copy.custom : '';
  const base = providerBase(provider);
  const rest = [caps, kindText].filter(Boolean).join(' · ');

  const toggle = async (next: boolean) => {
    setToggling(true);
    try {
      await runtime.configureModelProvider({ providerId: provider.providerId, enabled: next });
    } catch (err) {
      ToastQueue.negative(copy.toggleFailed(message(err)), { timeout: 5000 });
    } finally {
      setToggling(false);
    }
  };

  const removeProvider = async () => {
    setRemoving(true);
    try {
      await runtime.removeModelProvider(provider.providerId);
      replace({ tab: 'settings', section: 'providers' });
      ToastQueue.positive(copy.providerRemoved(provider.label), { timeout: 3000 });
    } catch (err) {
      ToastQueue.negative(copy.removeFailed(message(err)), { timeout: 5000 });
      setRemoving(false);
    }
  };

  return (
    <div>
      <div className={back}>
        <ActionButton isQuiet size="S" onPress={() => go({ tab: 'settings', section: 'providers' })}>
          <ChevronLeftIcon />
          <Text>{copy.back}</Text>
        </ActionButton>
      </div>
      <header className={head}>
        <ProviderIcon provider={provider} size={32} />
        <span className={headText}>
          <h1 className={title}>{provider.label}</h1>
          <span className={sub}>
            {site ? (
              <Link variant="secondary" onPress={openSite}>
                {hostOf(site)}
              </Link>
            ) : base ? (
              <span className={mono}>{hostOf(base)}</span>
            ) : null}
            {(site || base) && rest ? ' · ' : ''}
            {rest}
          </span>
        </span>
        <Switch aria-label={copy.enable(provider.label)} isSelected={enabled} isDisabled={!canEdit || toggling} onChange={(x) => void toggle(x)} />
      </header>
      {!enabled ? <p className={offNote}>{copy.off}</p> : null}
      {web ? <p className={offNote}>{PROVIDERS_COPY.webNote}</p> : null}

      <Accounts provider={provider} addOpen={addOpen} canEdit={canEdit} />
      <CapModels view={view} provider={provider} />
      <UsageCard provider={provider} />

      <div className={group}>
        <Button variant="negative" fillStyle="outline" size="S" isDisabled={!canEdit} isPending={removing} onPress={() => setConfirmRemove(true)}>
          <DeleteIcon />
          <Text>{copy.removeProvider}</Text>
        </Button>
      </div>
      <DialogContainer onDismiss={() => setConfirmRemove(false)}>
        {confirmRemove ? (
          <AlertDialog
            variant="destructive"
            title={copy.removeProviderTitle(provider.label)}
            primaryActionLabel={copy.removeProvider}
            cancelLabel={copy.cancel}
            onPrimaryAction={() => void removeProvider()}>
            {removeBody(provider)}
          </AlertDialog>
        ) : null}
      </DialogContainer>
    </div>
  );
}

// ---- 账号 ----

const acctList = style({ display: 'flex', flexDirection: 'column' });
const acct = style({
  display: 'flex',
  alignItems: { default: 'center', isEditing: 'start' },
  flexWrap: 'wrap',
  gap: 12,
  paddingX: 16,
  paddingY: 8,
  borderTopWidth: 0,
  borderXWidth: 0,
  borderBottomWidth: 1,
  borderStyle: 'solid',
  borderColor: 'gray-100',
  opacity: { default: 1, isOff: 0.7 },
});
const acctName = style({ display: 'flex', flexDirection: 'column', gap: 2, flexGrow: 1, flexBasis: 0, minWidth: 200 });
const acctNameButton = style({
  display: 'inline-flex',
  alignItems: 'center',
  alignSelf: 'start',
  gap: 4,
  padding: 0,
  borderWidth: 0,
  backgroundColor: 'transparent',
  font: 'ui',
  fontWeight: 'bold',
  color: 'gray-900',
  textAlign: 'start',
  cursor: { default: 'pointer', isDisabled: 'default' },
  borderRadius: 'sm',
  outlineStyle: { default: 'none', ':focus-visible': 'solid' },
  outlineColor: 'focus-ring',
  outlineWidth: 2,
  overflowWrap: 'anywhere',
  '--iconPrimary': { type: 'fill', value: 'currentColor' },
});
const editIcon = iconStyle({ size: 'XS', color: 'neutral' });
const acctEdit = style({ display: 'flex', flexDirection: 'column', gap: 8, width: 'full', maxWidth: 420 });
const rowButtons = style({ display: 'flex', alignItems: 'center', gap: 8 });
const acctSide = style({ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 });
const acctFoot = style({ display: 'flex', flexDirection: 'column', gap: 8, paddingX: 16, paddingY: 12 });
const addForm = style({ display: 'flex', flexDirection: 'column', gap: 12, paddingX: 16, paddingY: 12, borderTopWidth: 0 });
const addGrid = style({ containerType: 'inline-size' });
const addFields = style({ display: 'grid', gridTemplateColumns: { default: '1fr', '@container (min-width: 480px)': '1fr 1fr' }, gap: 12 });
const regionRow = style({ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 });
const regionText = style({ flexGrow: 1, minWidth: 0, font: 'ui-sm', color: 'gray-700' });

function Accounts({ provider, addOpen, canEdit }: { provider: ApiProvider; addOpen: boolean; canEdit: boolean }) {
  const runtime = useRuntime();
  const copy = PROVIDER_DETAIL_COPY;
  const accounts = provider.accounts;
  const primary = primaryAccount(accounts);
  const [adding, setAdding] = useState(canEdit && (addOpen || !accounts.length));
  const [pendingRemove, setPendingRemove] = useState<ProviderAccountView | null>(null);

  const run = async (work: () => Promise<unknown>, done?: string) => {
    try {
      await work();
      if (done) ToastQueue.positive(done, { timeout: 3000 });
      return true;
    } catch (err) {
      ToastQueue.negative(copy.failed(message(err)), { timeout: 5000 });
      return false;
    }
  };

  const remove = async (account: ProviderAccountView) => {
    setPendingRemove(null);
    await run(() => runtime.removeModelAccount(provider.providerId, account.accountId), copy.removed(accountName(account)));
  };

  return (
    <section className={group} aria-label={copy.accounts}>
      <h2 className={groupTitle}>{copy.accounts}</h2>
      <div className={card}>
        {accounts.length ? (
          <div className={acctList} role="list" aria-label={copy.accountsOf(provider.label)}>
            {accounts.map((account, i) => (
              <AccountRow
                key={account.accountId}
                provider={provider}
                account={account}
                index={i}
                primary={primary?.accountId === account.accountId}
                canEdit={canEdit}
                onPatch={(patch) => run(() => runtime.updateModelAccount({ providerId: provider.providerId, accountId: account.accountId, ...patch }))}
                onPrimary={() => void run(() => runtime.arrangeModelAccounts(provider.providerId, primaryOrder(accounts, account.accountId)))}
                onRemove={() => setPendingRemove(account)}
              />
            ))}
          </div>
        ) : (
          <p className={`${detailText} ${cardPad}`}>{provider.kind === 'custom' ? copy.noAccountsCustom : copy.noAccounts}</p>
        )}
        {accounts.length > 1 ? <p className={`${smallText} ${cardPad}`}>{copy.order}</p> : null}
        {adding ? (
          <AddAccountForm provider={provider} onCancel={() => setAdding(false)} onSaved={() => setAdding(false)} />
        ) : (
          <div className={acctFoot}>
            <div>
              <Button variant="secondary" size="S" isDisabled={!canEdit} onPress={() => setAdding(true)}>
                <AddIcon />
                <Text>{copy.addAccount}</Text>
              </Button>
            </div>
          </div>
        )}
      </div>
      <DialogContainer onDismiss={() => setPendingRemove(null)}>
        {pendingRemove ? (
          <AlertDialog
            variant="destructive"
            title={copy.removeTitle(accountName(pendingRemove))}
            primaryActionLabel={copy.removeAccount}
            cancelLabel={copy.cancel}
            onPrimaryAction={() => void remove(pendingRemove)}>
            {accounts.length === 1 ? copy.removeBodyLast(provider.label) : copy.removeBody}
          </AlertDialog>
        ) : null}
      </DialogContainer>
    </section>
  );
}

type AccountPatch = { label?: string | null; enabled?: boolean; endpoint?: string | null };

function AccountRow({
  provider,
  account,
  index,
  primary,
  canEdit,
  onPatch,
  onPrimary,
  onRemove,
}: {
  provider: ApiProvider;
  account: ProviderAccountView;
  index: number;
  primary: boolean;
  canEdit: boolean;
  onPatch: (patch: AccountPatch) => Promise<boolean>;
  onPrimary: () => void;
  onRemove: () => void;
}) {
  const copy = PROVIDER_DETAIL_COPY;
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(account.label ?? '');
  const [endpoint, setEndpoint] = useState(account.endpoint ?? '');
  const [saving, setSaving] = useState(false);
  const status = accountStatus(account, Date.now());
  const display = accountName(account);
  const detail = status.tone !== 'positive' ? accountDetail(account) : '';
  const bad = badEndpoint(endpoint);

  const open = () => {
    setName(account.label ?? '');
    setEndpoint(account.endpoint ?? '');
    setEditing(true);
  };
  const save = async () => {
    if (bad || saving) return;
    setSaving(true);
    const ok = await onPatch({ label: name.trim() || null, endpoint: endpoint.trim() || null });
    setSaving(false);
    if (ok) {
      setEditing(false);
      ToastQueue.positive(copy.updated, { timeout: 3000 });
    }
  };
  const keys = (event: { key: string }) => {
    if (event.key === 'Enter') void save();
    if (event.key === 'Escape') setEditing(false);
  };

  const subParts: ReactNode[] = [];
  if (account.label) subParts.push(<span key="masked" className={mono}>{account.masked}</span>);
  subParts.push(lastUsedText(account));
  if (provider.vendor.regions?.length && account.region) subParts.push(regionLabel(account.region));
  if (account.endpoint)
    subParts.push(
      <span key="endpoint" className={mono} title={account.endpoint}>
        {hostOf(account.endpoint)}
      </span>,
    );
  if (account.credential === 'missing') subParts.push(copy.keyMissing);
  if (detail) subParts.push(detail);

  return (
    <div className={acct({ isOff: !account.enabled, isEditing: editing })} role="listitem">
      <Switch aria-label={copy.enableAccount(display)} isSelected={account.enabled} isDisabled={!canEdit} onChange={(x) => void onPatch({ enabled: x })} />
      <span className={acctName}>
        {editing ? (
          <span className={acctEdit} role="group" aria-label={copy.editGroup(display)}>
            <TextField
              size="S"
              autoFocus
              aria-label={copy.label}
              placeholder={account.masked ? copy.labelPlaceholder(account.masked) : copy.labelPlaceholderNew}
              value={name}
              onChange={setName}
              onKeyDown={keys}
            />
            <TextField
              size="S"
              aria-label={copy.endpoint}
              placeholder={accountBase(provider, { region: account.region ?? null })}
              value={endpoint}
              onChange={setEndpoint}
              onKeyDown={keys}
              isInvalid={bad}
            />
            {bad ? <p className={negativeSmall}>{ADD_PROVIDER_COPY.badUrl}</p> : <p className={smallText}>{copy.endpointEditHint}</p>}
            <span className={rowButtons}>
              <Button variant="accent" size="S" isDisabled={bad} isPending={saving} onPress={() => void save()}>
                {copy.save}
              </Button>
              <Button variant="secondary" size="S" onPress={() => setEditing(false)}>
                {copy.cancel}
              </Button>
            </span>
          </span>
        ) : (
          <button type="button" className={acctNameButton({ isDisabled: !canEdit })} disabled={!canEdit} aria-label={copy.editAccount(display)} onClick={open}>
            {display}
            {canEdit ? <EditIcon styles={editIcon} /> : null}
          </button>
        )}
        <span className={smallText}>
          {subParts.map((part, i) => (
            <span key={i}>
              {i ? ' · ' : ''}
              {part}
            </span>
          ))}
        </span>
      </span>
      <span className={acctSide}>
        {primary ? (
          <Badge variant="accent" size="S" fillStyle="subtle">
            {copy.primary}
          </Badge>
        ) : null}
        <Badge variant={TONE_BADGE[status.tone]} size="S" fillStyle="subtle">
          {accountStatusLabel(status)}
        </Badge>
        {!primary && index > 0 ? (
          <ActionButton isQuiet size="S" isDisabled={!canEdit} onPress={onPrimary}>
            {copy.makePrimary}
          </ActionButton>
        ) : null}
        <TooltipTrigger placement="top" delay={300}>
          <ActionButton isQuiet size="S" aria-label={copy.removeAccount} isDisabled={!canEdit} onPress={onRemove}>
            <DeleteIcon />
          </ActionButton>
          <Tooltip>{copy.removeAccount}</Tooltip>
        </TooltipTrigger>
      </span>
    </div>
  );
}

/** 添加账号：名称、密钥、[地区]、折叠的「端点（高级）」。不过验证时不保存，原因写在按钮上面。 */
function AddAccountForm({ provider, onCancel, onSaved }: { provider: ApiProvider; onCancel: () => void; onSaved: () => void }) {
  const runtime = useRuntime();
  const copy = PROVIDER_DETAIL_COPY;
  const regions = provider.vendor.regions ?? [];
  const [label, setLabel] = useState('');
  const [key, setKey] = useState('');
  const [region, setRegion] = useState(provider.accounts[0]?.region ?? regions[0] ?? '');
  const [endpoint, setEndpoint] = useState('');
  const [endpointOpen, setEndpointOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const bad = badEndpoint(endpoint);

  const verify = async () => {
    if (!key.trim() || bad || busy) return;
    setBusy(true);
    setFailure(null);
    try {
      await runtime.addModelAccount({
        providerId: provider.providerId,
        credential: key.trim(),
        ...(label.trim() ? { label: label.trim() } : {}),
        ...(regions.length && region ? { region } : {}),
        ...(endpoint.trim() ? { endpoint: endpoint.trim() } : {}),
        verify: true,
      });
    } catch (err) {
      setFailure(message(err));
      setBusy(false);
      return;
    }
    setBusy(false);
    ToastQueue.positive(copy.saved(label.trim()), { timeout: 3000 });
    onSaved();
    // 有了密钥顺手取一次模型列表（自建端点与有文本生成的）；取不到的原因由 `models` 主题送回能力行。
    if (refreshAfterKey({ custom: provider.kind === 'custom', capabilities: provider.capabilities })) {
      void runtime.refreshModelProvider(provider.providerId).catch(() => undefined);
    }
  };

  return (
    <div className={addForm} role="group" aria-label={copy.addAccount}>
      <div className={addGrid}>
        <div className={addFields}>
          <TextField size="S" aria-label={copy.label} placeholder={copy.labelPlaceholderNew} value={label} onChange={setLabel} />
          <TextField
            size="S"
            type="password"
            aria-label={copy.key}
            placeholder={copy.keyPlaceholder}
            value={key}
            autoFocus
            onChange={(next) => {
              setKey(next);
              setFailure(null);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void verify();
            }}
          />
        </div>
      </div>
      {regions.length ? (
        <div className={regionRow}>
          <span className={regionText}>{`${copy.region} · ${copy.regionDesc}`}</span>
          <SegmentedControl aria-label={copy.region} selectedKey={region} onSelectionChange={(k) => setRegion(String(k))}>
            {regions.map((r) => (
              <SegmentedControlItem key={r} id={r}>
                {regionLabel(r)}
              </SegmentedControlItem>
            ))}
          </SegmentedControl>
        </div>
      ) : null}
      <Disclosure isQuiet size="S" isExpanded={endpointOpen} onExpandedChange={setEndpointOpen}>
        <DisclosureTitle>{copy.endpointTitle}</DisclosureTitle>
        <DisclosurePanel>
          <div className={acctEdit}>
            <TextField
              size="S"
              aria-label={copy.endpoint}
              placeholder={accountBase(provider, { region: regions.length ? region : null })}
              value={endpoint}
              isInvalid={bad}
              onChange={(next) => {
                setEndpoint(next);
                setFailure(null);
              }}
            />
            {bad ? <p className={negativeSmall}>{ADD_PROVIDER_COPY.badUrl}</p> : <p className={smallText}>{copy.endpointHint}</p>}
          </div>
        </DisclosurePanel>
      </Disclosure>
      {failure ? (
        <p className={negativeText} role="alert">
          {copy.failed(failure)}
        </p>
      ) : null}
      <p className={smallText}>{copy.keyNote}</p>
      <div className={rowButtons}>
        <Button variant="accent" size="S" isDisabled={!key.trim() || bad} isPending={busy} onPress={() => void verify()}>
          {copy.verify}
        </Button>
        <Button variant="secondary" size="S" isDisabled={busy} onPress={onCancel}>
          {copy.cancel}
        </Button>
      </div>
    </div>
  );
}

// ---- 能力与模型 ----

const cap = style({
  paddingX: 16,
  paddingY: 12,
  borderTopWidth: 0,
  borderXWidth: 0,
  borderBottomWidth: { default: 1, ':last-child': 0 },
  borderStyle: 'solid',
  borderColor: 'gray-100',
});
const capHead = style({ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, minHeight: 32 });
const capName = style({ font: 'ui', fontWeight: 'bold', color: 'gray-900' });
const capDesc = style({ flexGrow: 1, flexBasis: 0, minWidth: 160, font: 'ui-xs', color: { default: 'gray-600', isNegative: 'negative' }, overflowWrap: 'anywhere' });
const modelRow = style({
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 8,
  minHeight: 36,
  paddingY: 4,
  opacity: { default: 1, isPlanned: 0.6 },
});
const modelName = style({ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', columnGap: 8, flexGrow: 1, flexBasis: 0, minWidth: 180 });
const modelId = style({ font: 'code-xs', fontWeight: 'bold', color: 'gray-900', overflowWrap: 'anywhere', userSelect: 'text' });
const modelLead = style({ font: 'ui-xs', color: 'gray-600' });
const verdict = style({
  maxWidth: 260,
  font: 'ui-xs',
  textAlign: 'end',
  overflowWrap: 'anywhere',
  color: { default: 'gray-600', tone: { positive: 'green-900', negative: 'negative', neutral: 'gray-600' } },
});

function CapModels({ view, provider }: { view: ModelCapabilitiesView; provider: ApiProvider }) {
  const runtime = useRuntime();
  const web = runtime.host.platform === 'web';
  const copy = PROVIDER_DETAIL_COPY;
  const probes = useProbeRuns();
  const [probe, setProbe] = useState<ProbeTarget | null>(null);
  const [adding, setAdding] = useState<OnlineCapability | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const ready = stateReady(providerState(provider, Date.now()));

  const refresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await runtime.refreshModelProvider(provider.providerId);
    } catch (err) {
      ToastQueue.negative(CLOUD_COPY.refreshFailed(message(err)), { timeout: 5000 });
    } finally {
      setRefreshing(false);
    }
  };

  const probeState = probe ? probes.state(probe.capability, probe.providerId, probe.model.modelId) : undefined;

  return (
    <section className={group} aria-label={copy.caps}>
      <h2 className={groupTitle}>{copy.caps}</h2>
      <div className={card}>
        {catalogCapabilities(provider).map((capability) => {
          const planned = provider.planned.includes(capability);
          const entry = planned ? undefined : cloudProviders(view, capability).find((c) => c.providerId === provider.providerId);
          const models = entry?.models ?? [];
          const defaultRef = view[capability].default;
          const kind = entry ? refreshKind(entry, capability) : null;
          const line = entry ? refreshLine(entry, capability, refreshing) : null;
          const probeOk = probeSupported(capability);
          const desc = planned ? copy.plannedNote : line ? refreshText(line) : models.length ? PROVIDERS_COPY.models(models.length) : copy.noModels;
          const clonable =
            capability === 'synthesizeSpeech' && view.synthesizeSpeech.providers.some((p) => p.providerId === provider.providerId && providerCanClone(p));
          return (
            <div key={capability} className={cap} role="group" aria-label={CAPABILITY_SHORT[capability]}>
              <div className={capHead}>
                <span className={capName}>{CAPABILITY_SHORT[capability]}</span>
                {planned ? (
                  <Badge variant="neutral" size="S" fillStyle="subtle">
                    {copy.planned}
                  </Badge>
                ) : null}
                <span className={capDesc({ isNegative: line?.state === 'failed' })}>{desc}</span>
                {kind ? (
                  <TooltipTrigger placement="top" delay={300}>
                    <ActionButton
                      isQuiet
                      size="S"
                      aria-label={ready ? CLOUD_COPY.refresh[kind] : CLOUD_COPY.refreshNeedsKey(CLOUD_COPY.refresh[kind])}
                      isDisabled={web || !ready || refreshing}
                      onPress={() => void refresh()}>
                      <RefreshIcon />
                    </ActionButton>
                    <Tooltip>{ready ? CLOUD_COPY.refresh[kind] : CLOUD_COPY.refreshNeedsKey(CLOUD_COPY.refresh[kind])}</Tooltip>
                  </TooltipTrigger>
                ) : null}
                {!planned && provider.kind === 'custom' ? (
                  <TooltipTrigger placement="top" delay={300}>
                    <ActionButton isQuiet size="S" aria-label={copy.addModelTo(CAPABILITY_SHORT[capability])} isDisabled={web} onPress={() => setAdding(capability)}>
                      <AddIcon />
                    </ActionButton>
                    <Tooltip>{copy.addModelTo(CAPABILITY_SHORT[capability])}</Tooltip>
                  </TooltipTrigger>
                ) : null}
              </div>
              {models.map((model) => {
                const result = probeVerdict(probes.state(capability, provider.providerId, model.modelId));
                const lead = modelLeadText(capability, model);
                const isDefault = defaultRef?.providerId === provider.providerId && defaultRef.modelId === model.modelId;
                return (
                  <div key={model.modelId} className={modelRow({ isPlanned: planned })}>
                    <span className={modelName}>
                      <span className={modelId}>{model.modelId}</span>
                      {lead ? <span className={modelLead}>{lead}</span> : null}
                    </span>
                    <span className={verdict({ tone: probeOk ? result.tone : 'neutral' })}>{probeOk ? result.text : CLOUD_COPY.probeUnsupported}</span>
                    {isDefault ? (
                      <Badge variant="accent" size="S" fillStyle="subtle">
                        {CLOUD_COPY.defaultChip}
                      </Badge>
                    ) : null}
                    <ActionButton
                      isQuiet
                      size="S"
                      isDisabled={!probeOk || !ready || entry?.available === false}
                      onPress={() => setProbe({ capability, providerId: provider.providerId, providerLabel: provider.label, model })}>
                      {copy.probe}
                    </ActionButton>
                  </div>
                );
              })}
              {clonable ? <ModelVoicesLine target={{ kind: 'cloud', id: provider.providerId }} name={provider.label} /> : null}
            </div>
          );
        })}
        {!ready ? <p className={`${smallText} ${cardPad}`}>{copy.needsAccount}</p> : null}
      </div>
      {adding ? (
        <AddModelDialog
          view={view}
          providerId={provider.providerId}
          label={provider.label}
          initialCapability={adding}
          onClose={() => setAdding(null)}
          onAdded={() => setAdding(null)}
        />
      ) : null}
      {probe ? (
        <ProbeDialog
          capability={probe.capability}
          providerLabel={probe.providerLabel}
          model={probe.model}
          state={probeState ?? { status: 'ready' }}
          onStart={(voice) => void probes.start(probe, voice)}
          onClose={() => setProbe(null)}
        />
      ) : null}
    </section>
  );
}

// ---- 用量卡 ----

const useRow = style({ display: 'grid', gridTemplateColumns: { default: '1fr', '@container (min-width: 420px)': '1fr 1fr' }, gap: 12 });
const useWrap = style({ containerType: 'inline-size', display: 'flex', flexDirection: 'column', gap: 12, paddingX: 16, paddingY: 12 });
const useCell = style({ display: 'flex', flexDirection: 'column', gap: 2 });
const useCalls = style({ font: 'ui', fontWeight: 'bold', color: 'gray-900' });

function usageLine(report: UsageReport): string {
  const t = report.totals;
  const copy = USAGE_COPY;
  const estimated = formatMoney(t.cost.estimated);
  const reported = formatMoney(t.cost.reported);
  return (
    [
      estimated ? copy.cardEstimated(estimated) : '',
      reported ? copy.cardReported(reported) : '',
      t.cost.unknownCalls ? copy.cardUnknown(t.cost.unknownCalls) : '',
      t.failed ? copy.failed(t.failed) : '',
    ]
      .filter(Boolean)
      .join(' · ') || copy.cardNone
  );
}

function UsageCard({ provider }: { provider: ApiProvider }) {
  const runtime = useRuntime();
  const connected = useConnection((s) => s.state.status === 'connected');
  const go = useShell((s) => s.go);
  const [reports, setReports] = useState<{ month: UsageReport; today: UsageReport } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const copy = PROVIDER_DETAIL_COPY;

  useEffect(() => {
    if (!connected) return;
    let live = true;
    Promise.all([
      runtime.modelUsage({ period: '30d', providerId: provider.providerId }),
      runtime.modelUsage({ period: 'today', providerId: provider.providerId }),
    ]).then(
      ([month, today]) => {
        if (live) setReports({ month, today });
      },
      (err) => {
        if (live) setFailure(message(err));
      },
    );
    return () => {
      live = false;
    };
  }, [runtime, connected, provider.providerId]);

  const cell = (label: string, report: UsageReport) => (
    <div className={useCell}>
      <span className={smallText}>{label}</span>
      <span className={useCalls}>{USAGE_COPY.calls(report.totals.calls)}</span>
      <span className={smallText}>{usageLine(report)}</span>
    </div>
  );

  return (
    <section className={group} aria-label={copy.usage}>
      <h2 className={groupTitle}>{copy.usage}</h2>
      <div className={card}>
        <div className={useWrap}>
          {reports ? (
            <div className={useRow}>
              {cell(copy.last30, reports.month)}
              {cell(copy.today, reports.today)}
            </div>
          ) : (
            <p className={failure ? negativeText : detailText} role="status">
              {failure ? USAGE_COPY.loadFailed(failure) : USAGE_COPY.loading}
            </p>
          )}
          <div>
            <Button variant="secondary" size="S" onPress={() => go({ tab: 'settings', section: 'usage', providerId: provider.providerId })}>
              {copy.viewUsage}
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
