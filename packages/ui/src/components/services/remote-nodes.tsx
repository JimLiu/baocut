import { useState, type Key } from 'react';
import { NODE_DEFAULT_PORT, type DiscoveredNode, type PairedNode } from '@baocut/protocol';
import {
  ActionButton,
  AlertDialog,
  Badge,
  Button,
  ButtonGroup,
  Content,
  Dialog,
  DialogContainer,
  Form,
  Heading,
  Menu,
  MenuItem,
  MenuSection,
  MenuTrigger,
  Text,
  TextField,
  ToastQueue,
} from '@react-spectrum/s2';
import Copy from '@react-spectrum/s2/icons/Copy';
import Delete from '@react-spectrum/s2/icons/Delete';
import DeviceMultiscreen from '@react-spectrum/s2/icons/DeviceMultiscreen';
import More from '@react-spectrum/s2/icons/More';
import Search from '@react-spectrum/s2/icons/Search';
import { iconStyle, style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { REMOTE_COPY, SERVICES_PAGE_COPY } from '../../copy.ts';
import {
  hostPort,
  nodeCardView,
  normalizePairingCode,
  pairErrorMessage,
  parseNodeAddress,
  unpairedNearby,
} from '../../model/services-remote.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useConnection } from '../../state/connection-store.ts';
import { useShare } from '../../state/share-store.ts';
import { detail, detailXs, sectionTitle, ServiceLightDot } from './service-card.tsx';
import { pairNode, unpairNode } from './share-commands.ts';
import { useNodesPolling } from './use-share-status.ts';

/*
 * 远端算力 ›「使用其他电脑」（原型 designs/baocut/app/page-shell.jsx `NodeCard` 与 RemotePage 的 nodes 页签）。
 * 已配对读 `nodes.list`（页签开着时轮询），附近读 `nodes.discover`（只在点「查找附近的电脑」时扫一次），
 * 配对走 `nodes.pair`，取消配对走 `nodes.remove`。原型菜单里的「诊断这台节点」没有后端（没有 doctor 方法）：
 * 不画，改成卡片下方按 `problem` 拼的一句「为什么用不了、怎么办」。
 */

/** 原型 `Card layer`，padding 12，上下 8。 */
const nodeCard = style({
  boxSizing: 'border-box',
  paddingX: 12,
  paddingY: 12,
  marginTop: 8,
  borderRadius: 'lg',
  backgroundColor: 'gray-50',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'gray-200',
});
const nodeRow = style({ display: 'flex', alignItems: 'center', gap: 8 });
const nodeTxt = style({ display: 'flex', flexDirection: 'column', gap: 2, flexGrow: 1, minWidth: 0 });
const nodeName = style({ font: 'title-sm', color: 'gray-900', overflowWrap: 'anywhere' });
const nodeMeta = style({ font: 'ui-xs', color: 'gray-600', overflowWrap: 'anywhere', userSelect: 'text' });
const problemText = style({ margin: 0, marginTop: 8, paddingStart: 16, font: 'ui-sm', color: 'gray-700' });
const nearbyIcon = style({ display: 'flex', flexShrink: 0, color: 'gray-700', '--iconPrimary': { type: 'fill', value: 'currentColor' } });
const empty = style({
  boxSizing: 'border-box',
  paddingX: 16,
  paddingY: 16,
  marginTop: 8,
  borderRadius: 'lg',
  borderWidth: 1,
  borderStyle: 'dashed',
  borderColor: 'gray-300',
});
const emptyTitle = style({ display: 'block', font: 'title-sm', color: 'gray-900' });
const note = style({ margin: 0, marginTop: 8, maxWidth: '[640px]', font: 'ui-sm', color: 'gray-600' });
const actionsRow = style({ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 });
const dialogBody = style({ display: 'flex', flexDirection: 'column', gap: 12 });
const dialogError = style({ margin: 0, font: 'ui-sm', color: 'negative' });
const codeField = style({ width: 160 });

/** 配对对话框的对象：附近找到的一台（地址已知），或按地址添加（地址要用户填）。 */
type PairTarget = { kind: 'nearby'; name: string; host: string; port: number } | { kind: 'address' };

export function RemoteNodes() {
  useNodesPolling();
  const runtime = useRuntime();
  const connected = useConnection((s) => s.state.status === 'connected');
  const nodes = useShare((s) => s.nodes);
  const [found, setFound] = useState<DiscoveredNode[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [target, setTarget] = useState<PairTarget | null>(null);
  const nearby = found ? unpairedNearby(found, nodes ?? []) : null;

  const discover = () => {
    setSearching(true);
    runtime
      .discoverNodes()
      .then(setFound)
      .catch((error: Error) => ToastQueue.negative(SERVICES_PAGE_COPY.failed(error.message), { timeout: 5000 }))
      .finally(() => setSearching(false));
  };

  return (
    <>
      <h2 className={sectionTitle}>{REMOTE_COPY.paired}</h2>
      {nodes === null ? (
        <p className={note}>{connected ? SERVICES_PAGE_COPY.loading : SERVICES_PAGE_COPY.disconnected}</p>
      ) : nodes.length ? (
        nodes.map((node) => <NodeCard key={node.nodeId} node={node} />)
      ) : (
        <div className={empty}>
          <span className={emptyTitle}>{REMOTE_COPY.pairedEmptyTitle}</span>
          <p className={note}>{REMOTE_COPY.pairedEmptyBody}</p>
        </div>
      )}

      <h2 className={sectionTitle}>{REMOTE_COPY.nearby}</h2>
      {searching ? (
        <p className={note}>{REMOTE_COPY.searching}</p>
      ) : nearby === null ? (
        <p className={note}>{REMOTE_COPY.nearbyIdle}</p>
      ) : nearby.length ? (
        nearby.map((node) => (
          <div key={node.nodeId ?? hostPort(node.host, node.port)} className={nodeCard}>
            <div className={nodeRow}>
              <span className={nearbyIcon} aria-hidden="true">
                <DeviceMultiscreen styles={iconStyle({ size: 'S' })} />
              </span>
              <span className={nodeTxt}>
                <span className={nodeName}>{node.name}</span>
                <span className={nodeMeta}>{hostPort(node.host, node.port)}</span>
              </span>
              <Button
                variant="accent"
                size="S"
                isDisabled={!connected}
                aria-label={REMOTE_COPY.pairLabel(node.name)}
                onPress={() => setTarget({ kind: 'nearby', name: node.name, host: node.host, port: node.port })}>
                {REMOTE_COPY.pair}
              </Button>
            </div>
          </div>
        ))
      ) : (
        <p className={note}>{REMOTE_COPY.nearbyNone}</p>
      )}
      <div className={actionsRow}>
        <Button variant="secondary" size="S" isPending={searching} isDisabled={!connected} onPress={discover}>
          <Search />
          <Text>{REMOTE_COPY.search}</Text>
        </Button>
        <Button variant="secondary" size="S" isDisabled={!connected} onPress={() => setTarget({ kind: 'address' })}>
          {REMOTE_COPY.addByAddress}
        </Button>
      </div>

      {target ? <PairDialog target={target} onClose={() => setTarget(null)} /> : null}
    </>
  );
}

function NodeCard({ node }: { node: PairedNode }) {
  const runtime = useRuntime();
  const connected = useConnection((s) => s.state.status === 'connected');
  const [confirm, setConfirm] = useState(false);
  const view = nodeCardView(node);
  const name = node.alias || node.name;

  const onAction = (key: Key) => {
    if (key === 'copy') {
      navigator.clipboard.writeText(view.address).then(
        () => ToastQueue.neutral(REMOTE_COPY.copied(view.address), { timeout: 3000 }),
        () => ToastQueue.negative(REMOTE_COPY.copyFailed, { timeout: 5000 }),
      );
    } else if (key === 'unpair') setConfirm(true);
  };

  return (
    <div className={nodeCard}>
      <div className={nodeRow}>
        <ServiceLightDot tone={view.tone} />
        <span className={nodeTxt}>
          <span className={nodeName}>{name}</span>
          <span className={nodeMeta}>{view.meta}</span>
        </span>
        <Badge size="S" fillStyle="subtle" variant={view.chip.variant}>
          {view.chip.text}
        </Badge>
        <MenuTrigger>
          <ActionButton isQuiet size="S" aria-label={REMOTE_COPY.more(name)}>
            <More />
          </ActionButton>
          <Menu aria-label={REMOTE_COPY.more(name)} onAction={onAction}>
            <MenuSection>
              <MenuItem id="copy" textValue={REMOTE_COPY.copyAddress}>
                <Copy />
                <Text slot="label">{REMOTE_COPY.copyAddress}</Text>
              </MenuItem>
            </MenuSection>
            <MenuSection>
              <MenuItem id="unpair" textValue={REMOTE_COPY.unpair} isDisabled={!connected}>
                <Delete />
                <Text slot="label">{REMOTE_COPY.unpair}…</Text>
              </MenuItem>
            </MenuSection>
          </Menu>
        </MenuTrigger>
      </div>
      {view.problem ? <p className={problemText}>{view.problem}</p> : null}
      <DialogContainer onDismiss={() => setConfirm(false)}>
        {confirm ? (
          <AlertDialog
            variant="destructive"
            title={REMOTE_COPY.unpairTitle(name)}
            primaryActionLabel={REMOTE_COPY.unpair}
            cancelLabel={REMOTE_COPY.cancel}
            onPrimaryAction={() =>
              void unpairNode(runtime, node.nodeId).then(
                () => ToastQueue.positive(REMOTE_COPY.unpairDone, { timeout: 3000 }),
                (error: Error) => ToastQueue.negative(SERVICES_PAGE_COPY.failed(error.message), { timeout: 5000 }),
              )
            }>
            {REMOTE_COPY.unpairBody}
          </AlertDialog>
        ) : null}
      </DialogContainer>
    </div>
  );
}

/**
 * 配对对话框：附近的一台只问配对码；按地址添加先问地址再问码。校验不过的写在对应输入框下；
 * `nodes.pair` 失败的原因（码不对、锁定、版本、连不上）写在对话框里，不关对话框、不吞输入。
 * 状态放在 Dialog 外层：S2 的 Dialog 会把 children 在几个 slot 里各渲染一遍。
 */
function PairDialog({ target, onClose }: { target: PairTarget; onClose: () => void }) {
  const runtime = useRuntime();
  const connected = useConnection((s) => s.state.status === 'connected');
  const [address, setAddress] = useState('');
  const [code, setCode] = useState('');
  const [addressError, setAddressError] = useState<string | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (close: () => void) => {
    if (busy) return;
    let host: string;
    let port: number;
    if (target.kind === 'address') {
      const parsed = parseNodeAddress(address);
      if ('error' in parsed) {
        setAddressError(parsed.error);
        return;
      }
      ({ host, port } = parsed);
    } else ({ host, port } = target);
    setAddressError(null);
    const normalized = normalizePairingCode(code);
    if (!normalized) {
      setCodeError(REMOTE_COPY.codeInvalid);
      return;
    }
    setCodeError(null);
    setFailure(null);
    setBusy(true);
    try {
      await pairNode(runtime, { host, port, code: normalized });
      ToastQueue.positive(REMOTE_COPY.pairedToast, { timeout: 4000 });
      close();
    } catch (error) {
      setFailure(pairErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogContainer onDismiss={onClose}>
      <Dialog size="S">
        {({ close }) => (
          <>
            <Heading slot="title">{target.kind === 'nearby' ? REMOTE_COPY.pairTitle(target.name) : REMOTE_COPY.addTitle}</Heading>
            <Content>
              <Form
                onSubmit={(event) => {
                  event.preventDefault();
                  void submit(close);
                }}>
                <div className={dialogBody}>
                  <p className={detail}>{REMOTE_COPY.pairBody}</p>
                  {target.kind === 'address' ? (
                    <TextField
                      label={REMOTE_COPY.addressLabel}
                      value={address}
                      onChange={(value) => {
                        setAddress(value);
                        setAddressError(null);
                      }}
                      placeholder={REMOTE_COPY.addressPlaceholder}
                      description={REMOTE_COPY.addressHint(NODE_DEFAULT_PORT)}
                      isInvalid={addressError !== null}
                      errorMessage={addressError ?? undefined}
                      autoComplete="off"
                      autoFocus
                    />
                  ) : (
                    <span className={detailXs}>{hostPort(target.host, target.port)}</span>
                  )}
                  <TextField
                    label={REMOTE_COPY.codeLabel}
                    value={code}
                    onChange={(value) => {
                      setCode(value);
                      setCodeError(null);
                    }}
                    placeholder={REMOTE_COPY.codePlaceholder}
                    isInvalid={codeError !== null}
                    errorMessage={codeError ?? undefined}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={9}
                    autoFocus={target.kind === 'nearby'}
                    styles={codeField}
                  />
                  {failure ? (
                    <p className={dialogError} role="alert">
                      {failure}
                    </p>
                  ) : null}
                </div>
              </Form>
            </Content>
            <ButtonGroup>
              <Button variant="secondary" onPress={close}>
                {REMOTE_COPY.cancel}
              </Button>
              <Button variant="accent" isPending={busy} isDisabled={!connected} onPress={() => void submit(close)}>
                {busy ? REMOTE_COPY.pairing : REMOTE_COPY.pair}
              </Button>
            </ButtonGroup>
          </>
        )}
      </Dialog>
    </DialogContainer>
  );
}
