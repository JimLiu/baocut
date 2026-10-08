import { useState } from 'react';
import type { ShareStatus } from '@baocut/protocol';
import { ActionButton, AlertDialog, Badge, Button, DialogTrigger, Switch, ToastQueue } from '@react-spectrum/s2';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { REMOTE_COPY, SERVICE_COPY, SERVICES_PAGE_COPY } from '../../copy.ts';
import {
  jobsLabel,
  localTranscribeModels,
  pairingView,
  remoteTaskRows,
  remoteTaskSummary,
  shareAddresses,
  shareClientMeta,
  type RemoteTaskRow,
} from '../../model/services-remote.ts';
import { serviceBusy, serviceStateLabel, shareState } from '../../model/services.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useConnection } from '../../state/connection-store.ts';
import { useModels } from '../../state/models-store.ts';
import { useShare } from '../../state/share-store.ts';
import { useNow } from '../use-now.ts';
import { detail, detailXs, panel, ServiceCard } from './service-card.tsx';
import { renewPairingCode, revokeShareClient, setShareCapability } from './share-commands.ts';
import { useFlipShare } from './use-share-status.ts';

/*
 * 远端算力 ›「共享这台 Mac」（原型 designs/baocut/app/page-shell.jsx `RemotePage` 的 share 页签，services.css `.pairblk` / `.rtask__chips`）。
 * 读写的都是 `nodes.share.*`。原型里这个版本没有后端的几项没画：配对码开关（pairMode=open）、并发任务数、
 * OpenAI 兼容端点、「打开 BaoCut 时自动开始共享」勾选（共享开着时 Runtime 启动就自动继续，写成页脚的一句事实）。
 */

const note = style({ margin: 0, marginTop: 8, maxWidth: '[640px]', font: 'ui-sm', color: 'gray-600' });
const footRight = style({ marginStart: 'auto', font: 'ui-xs', color: 'gray-600' });
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
/** 原型 ui.css `.setrow`：一行一项，标签 + 副文在左，值或控件在右，1px gray-100 分隔。 */
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
const rowLabel = style({ font: 'ui', fontWeight: 'medium', color: 'gray-900' });
const rowDesc = style({ font: 'ui-xs', color: 'gray-600', overflowWrap: 'anywhere' });
const rowMono = style({ font: 'code-sm', color: 'gray-700', userSelect: 'text', overflowWrap: 'anywhere', whiteSpace: 'pre-line', textAlign: 'end' });
const chips = style({ display: 'flex', flexWrap: 'wrap', justifyContent: 'end', gap: '[6px]', maxWidth: '[60%]' });
const pairblk = style({
  marginTop: 4,
  marginBottom: 8,
  paddingX: 16,
  paddingY: 12,
  borderRadius: 'lg',
  backgroundColor: 'gray-75',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'gray-200',
});
const pairHead = style({ font: 'ui', fontWeight: 'medium', color: 'gray-900' });
const pairBody = style({ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 });
const pairCode = style({
  display: 'block',
  font: 'code-sm',
  fontSize: '[22px]',
  fontWeight: 'bold',
  letterSpacing: '[0.08em]',
  color: 'gray-900',
  userSelect: 'text',
});
const sectionHead = style({ display: 'flex', alignItems: 'center', gap: 8, marginTop: 16 });
const sectionName = style({ flexGrow: 1, font: 'title-sm', color: 'gray-900' });

export function RemoteShare() {
  const connected = useConnection((s) => s.state.status === 'connected');
  const status = useShare((s) => s.status);
  const phase = useShare((s) => s.phase);
  const flip = useFlipShare();
  const state = shareState(status, phase);
  const busy = serviceBusy(state);

  let heading: string = REMOTE_COPY.cardOff;
  let subline: string = REMOTE_COPY.subOff;
  if (!status) subline = connected ? SERVICES_PAGE_COPY.loading : SERVICES_PAGE_COPY.disconnected;
  else if (busy) {
    heading = serviceStateLabel('remote', state);
    subline = status.name;
  } else if (state === 'error') {
    heading = serviceStateLabel('remote', state);
    subline = status.error ?? REMOTE_COPY.subErrorFallback;
  } else if (state === 'on') {
    heading = REMOTE_COPY.cardOn;
    subline = `${status.name} · ${shareAddresses(status)[0] ?? REMOTE_COPY.noAddress}`;
  }

  return (
    <>
      <ServiceCard
        id="remote"
        state={state}
        heading={heading}
        subline={subline}
        mono={state === 'on'}
        disabled={!connected || !status}
        onFlip={flip}
        footer={
          <>
            <span className={detailXs}>{REMOTE_COPY.foot}</span>
            <span className={footRight}>{REMOTE_COPY.footRight}</span>
          </>
        }>
        {state === 'error' ? (
          <div className={fix}>
            <span className={`${detail} ${grow}`}>{REMOTE_COPY.errorFix}</span>
            <Button variant="secondary" size="S" isDisabled={!connected} onPress={() => flip(false)}>
              {SERVICE_COPY.remote.stop}
            </Button>
          </div>
        ) : null}
      </ServiceCard>
      <p className={note}>{REMOTE_COPY.privacy}</p>
      {status && state === 'on' ? <ShareDetails status={status} /> : <p className={note}>{REMOTE_COPY.offHint}</p>}
    </>
  );
}

function ShareDetails({ status }: { status: ShareStatus }) {
  const runtime = useRuntime();
  const connected = useConnection((s) => s.state.status === 'connected');
  const capabilities = useModels((s) => s.capabilities);
  const rows = remoteTaskRows(status, localTranscribeModels(capabilities));
  const addresses = shareAddresses(status);

  const toggle = (task: RemoteTaskRow, enabled: boolean) => {
    if (!task.capability) return;
    setShareCapability(runtime, task.capability, enabled)
      .then(() => ToastQueue.neutral(enabled ? REMOTE_COPY.taskOn(task.name) : REMOTE_COPY.taskOff(task.name), { timeout: 3000 }))
      .catch((error: Error) => ToastQueue.negative(SERVICES_PAGE_COPY.failed(error.message), { timeout: 5000 }));
  };

  return (
    <section className={panel} aria-label={REMOTE_COPY.cardOn}>
      <div className={row}>
        <span className={rowName}>
          <span className={rowLabel}>{REMOTE_COPY.nodeName}</span>
        </span>
        <span className={rowMono}>{status.name}</span>
      </div>
      <div className={row}>
        <span className={rowName}>
          <span className={rowLabel}>{REMOTE_COPY.address}</span>
        </span>
        <span className={rowMono}>{addresses.length ? addresses.join('\n') : REMOTE_COPY.noAddress}</span>
      </div>
      <PairingBlock status={status} />

      <div className={sectionHead}>
        <span className={sectionName}>{REMOTE_COPY.tasksTitle}</span>
        <span className={detailXs}>{remoteTaskSummary(rows)}</span>
      </div>
      {rows.map((task) => (
        <div key={task.key} className={row}>
          <span className={rowName}>
            <span className={rowLabel}>{task.name}</span>
            {task.desc ? <span className={rowDesc}>{task.desc}</span> : null}
          </span>
          {task.models.length ? (
            <span className={chips}>
              {task.models.map((model) => (
                <Badge key={model} size="S" fillStyle="subtle" variant="neutral">
                  {model}
                </Badge>
              ))}
            </span>
          ) : null}
          <Switch
            size="S"
            aria-label={REMOTE_COPY.taskSwitch(task.name)}
            isSelected={task.on}
            isDisabled={task.disabled || !connected}
            onChange={(enabled) => toggle(task, enabled)}
          />
        </div>
      ))}
      <div className={row}>
        <span className={rowName}>
          <span className={rowLabel}>{REMOTE_COPY.status}</span>
        </span>
        <span className={rowMono}>{jobsLabel(status.jobs)}</span>
      </div>

      <div className={sectionHead}>
        <span className={sectionName}>{REMOTE_COPY.clientsTitle}</span>
      </div>
      {status.clients.length ? (
        status.clients.map((client) => <ClientRow key={client.clientId} client={client} />)
      ) : (
        <p className={note}>{REMOTE_COPY.clientsEmpty}</p>
      )}
    </section>
  );
}

function PairingBlock({ status }: { status: ShareStatus }) {
  const runtime = useRuntime();
  const connected = useConnection((s) => s.state.status === 'connected');
  const now = useNow(1000);
  const view = pairingView(status.pairing, now);
  const [busy, setBusy] = useState(false);
  const renew = () => {
    setBusy(true);
    renewPairingCode(runtime)
      .then(() => ToastQueue.positive(REMOTE_COPY.regenerated, { timeout: 3000 }))
      .catch((error: Error) => ToastQueue.negative(SERVICES_PAGE_COPY.failed(error.message), { timeout: 5000 }))
      .finally(() => setBusy(false));
  };
  return (
    <div className={pairblk}>
      <div className={pairHead}>{REMOTE_COPY.pairingTitle}</div>
      <div className={pairBody}>
        <span className={grow}>
          {view.kind === 'code' ? (
            <>
              <span className={pairCode}>{view.code}</span>
              <span className={detailXs}>{view.hint}</span>
            </>
          ) : (
            <span className={detail}>{view.text}</span>
          )}
        </span>
        <Button variant="secondary" size="S" isPending={busy} isDisabled={!connected} onPress={renew}>
          {view.kind === 'none' ? REMOTE_COPY.generate : REMOTE_COPY.regenerate}
        </Button>
      </div>
    </div>
  );
}

function ClientRow({ client }: { client: ShareStatus['clients'][number] }) {
  const runtime = useRuntime();
  const connected = useConnection((s) => s.state.status === 'connected');
  const now = useNow(60_000);
  const revoke = () =>
    revokeShareClient(runtime, client.clientId)
      .then(() => ToastQueue.neutral(REMOTE_COPY.revoked(client.name), { timeout: 3000 }))
      .catch((error: Error) => ToastQueue.negative(SERVICES_PAGE_COPY.failed(error.message), { timeout: 5000 }));
  return (
    <div className={row}>
      <span className={rowName}>
        <span className={rowLabel}>{client.name}</span>
        <span className={rowDesc}>{shareClientMeta(client, now)}</span>
      </span>
      <DialogTrigger>
        <ActionButton isQuiet size="S" isDisabled={!connected} aria-label={REMOTE_COPY.revokeLabel(client.name)}>
          {REMOTE_COPY.revoke}
        </ActionButton>
        <AlertDialog
          variant="destructive"
          title={REMOTE_COPY.revokeTitle(client.name)}
          primaryActionLabel={REMOTE_COPY.revoke}
          cancelLabel={REMOTE_COPY.cancel}
          onPrimaryAction={() => void revoke()}>
          {REMOTE_COPY.revokeBody}
        </AlertDialog>
      </DialogTrigger>
    </div>
  );
}
