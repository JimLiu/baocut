import { useMemo, useState } from 'react';
import { localizeText, type Grant } from '@baocut/protocol';
import { AlertDialog, Badge, Button, DialogContainer, Switch, ToastQueue } from '@react-spectrum/s2';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { endedCount, grantFacts, grantStateLabel, grantTitle, listedGrants, revokeConfirmText, revokeResultLine } from '../../model/data-grants.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useConnection } from '../../state/connection-store.ts';
import { useGrants } from '../../state/grants-store.ts';
import { useModels } from '../../state/models-store.ts';
import { useSpace } from '../../state/space-store.ts';
import { GRANTS_COPY } from './data-grants-copy.ts';

/*
 * 设置 → 隐私 →「数据外发授权」（架构设计 §12.5；设计稿没有这一块）：列出发给云端服务商的持续授权，可以撤销。
 * 发放只在两处：启用服务商时默认一条、审批时选「以后都允许」。这里不新建也不改（`grants.create/update` 没有界面）。
 * 分组与行的样式与设置页的 Group / Row 相同。
 */

const group = style({ marginBottom: 48 });
const groupHead = style({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 16 });
const groupTitle = style({ margin: 0, font: 'ui', fontWeight: 'medium', color: 'gray-900' });
const lead = style({ marginTop: -8, marginBottom: 16, font: 'ui-sm', color: 'gray-600' });
const card = style({ paddingX: 16, borderWidth: 1, borderStyle: 'solid', borderColor: 'gray-200', borderRadius: 'xl' });
const row = style({
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  paddingY: 16,
  borderTopWidth: 0,
  borderXWidth: 0,
  borderBottomWidth: { default: 1, ':last-child': 0 },
  borderStyle: 'solid',
  borderColor: 'gray-100',
});
const rowText = style({ flexGrow: 1, minWidth: 0 });
const rowLabel = style({ font: 'ui', fontWeight: 'medium', color: { default: 'gray-900', isEnded: 'gray-600' } });
const rowDesc = style({ marginTop: 4, font: 'ui-sm', color: 'gray-600', overflowWrap: 'anywhere', userSelect: 'text' });
const rowControl = style({ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 });

export function DataGrants() {
  const runtime = useRuntime();
  const connected = useConnection((s) => s.state.status === 'connected');
  const { ready, grants } = useGrants();
  const capabilities = useModels((s) => s.capabilities);
  const entries = useSpace((s) => s.entries);
  const [showEnded, setShowEnded] = useState(false);
  const [revoking, setRevoking] = useState<Grant | null>(null);

  const labels = useMemo(() => {
    const map = new Map<string, string>();
    if (capabilities) for (const view of Object.values(capabilities)) for (const p of view.providers) map.set(p.providerId, p.label);
    return map;
  }, [capabilities]);
  const videoNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of entries) if (e.kind === 'video' && e.ref && 'videoId' in e.ref) map.set(e.ref.videoId, e.name);
    return map;
  }, [entries]);

  const ended = endedCount(grants);
  const list = listedGrants(grants, showEnded);

  const revoke = async (grant: Grant) => {
    try {
      ToastQueue.positive(revokeResultLine(await runtime.revokeGrant(grant.grantId)), { timeout: 5000 });
    } catch (error) {
      ToastQueue.negative(GRANTS_COPY.revokeFailed((error as Error).message), { timeout: 5000 });
    }
  };

  return (
    <section className={group} aria-label={GRANTS_COPY.title}>
      <div className={groupHead}>
        <h2 className={groupTitle}>{GRANTS_COPY.title}</h2>
        {ended ? (
          <Switch size="S" isSelected={showEnded} onChange={setShowEnded}>
            {GRANTS_COPY.showEnded(ended)}
          </Switch>
        ) : null}
      </div>
      <p className={lead}>{GRANTS_COPY.lead}</p>
      <div className={card}>
        {!ready ? (
          <GrantRow label={connected ? GRANTS_COPY.loading : GRANTS_COPY.disconnected} />
        ) : list.length ? (
          list.map((g) => (
            <GrantRow
              key={g.grantId}
              label={grantTitle(g, labels)}
              desc={[localizeText(g.purpose, g.purposeRef), grantFacts(g, g.scope.videoId ? (videoNames.get(g.scope.videoId) ?? null) : null)].filter(Boolean).join(' · ')}
              ended={g.state !== 'active'}>
              {g.state === 'active' ? (
                <Button variant="secondary" size="S" isDisabled={!connected} onPress={() => setRevoking(g)}>
                  {GRANTS_COPY.revoke}
                </Button>
              ) : (
                <Badge variant="neutral" size="S" fillStyle="subtle">
                  {grantStateLabel(g.state)}
                </Badge>
              )}
            </GrantRow>
          ))
        ) : (
          <GrantRow label={grants.length ? GRANTS_COPY.noActive : GRANTS_COPY.none} desc={GRANTS_COPY.emptyDesc} />
        )}
      </div>
      <DialogContainer onDismiss={() => setRevoking(null)}>
        {revoking ? (
          <AlertDialog
            variant="destructive"
            title={GRANTS_COPY.revokeTitle(grantTitle(revoking, labels))}
            primaryActionLabel={GRANTS_COPY.revoke}
            cancelLabel={GRANTS_COPY.cancel}
            onPrimaryAction={() => void revoke(revoking)}>
            {revokeConfirmText(revoking)}
          </AlertDialog>
        ) : null}
      </DialogContainer>
    </section>
  );
}

function GrantRow({ label, desc, ended = false, children }: { label: string; desc?: string; ended?: boolean; children?: React.ReactNode }) {
  return (
    <div className={row}>
      <div className={rowText}>
        <div className={rowLabel({ isEnded: ended })}>{label}</div>
        {desc ? <div className={rowDesc}>{desc}</div> : null}
      </div>
      {children ? <div className={rowControl}>{children}</div> : null}
    </div>
  );
}
