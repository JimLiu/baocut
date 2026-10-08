import { useEffect, useState } from 'react';
import { localizeText, type ServiceStatus, type WebSession } from '@baocut/protocol';
import { ActionButton, AlertDialog, Badge, Button, DialogTrigger, Link, Switch, Text, ToastQueue } from '@react-spectrum/s2';
import Copy from '@react-spectrum/s2/icons/Copy';
import OpenIn from '@react-spectrum/s2/icons/OpenIn';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { SERVICE_COPY, SERVICES_PAGE_COPY } from '../../copy.ts';
import { browserLabel, serviceBusy, serviceStateLabel, webSessionMeta } from '../../model/services.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useShell } from '../../state/shell-store.ts';
import { useNow } from '../use-now.ts';
import { UtilityPage } from '../utility-page.tsx';
import { detailXs, lede, panel, ServiceCard, ServiceLightDot } from './service-card.tsx';
import { AutostartCheckbox, ErrorFix, PortRow, SectionHead, SetRow, useServiceStatus } from './service-parts.tsx';
import { COMMON_COPY, WEB_COPY } from './services-copy.ts';
import { copyText, toastFailure, useConfigureService, useFlipService } from './use-service-actions.ts';

/*
 * Web 服务详情页（原型 designs/baocut/app/page-services.jsx `WebServicePage`；架构设计 §4.8、§12.8）。
 * 浏览器要先用一次性的登录链接进来（`services.web.createAccessLink`：代码在 URL fragment 里，2 分钟内有效、只能用一次），
 * 换到会话 cookie 之后 12 小时内直接打开地址就行。所以「在浏览器中打开」每次发一条新链接交给系统浏览器；
 * 「复制地址」复制不带代码的地址（已登录的浏览器用）；另给「复制登录链接」（要在别的浏览器里登录时用）。
 * 与原型的不同：会话行没有「正在看的页面」（Runtime 不记），改写连接数与过期时间，可以让它退出登录；
 * 端口运行中也能改（按新端口重开）；多了「只读」；原型这一页里的「OpenAI 兼容 API」搬到了「模型接口」页。
 */

const actions = style({ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 12 });
const note = style({ margin: 0, marginTop: 8, maxWidth: '[640px]', font: 'ui-xs', color: 'gray-600' });
const line = style({
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  paddingY: 8,
  borderTopWidth: 0,
  borderXWidth: 0,
  borderBottomWidth: { default: 1, ':last-child': 0 },
  borderStyle: 'solid',
  borderColor: 'gray-100',
});
const who = style({ display: 'flex', flexDirection: 'column', gap: 2, flexGrow: 1, minWidth: 0 });
const name = style({ font: 'ui', fontWeight: 'medium', color: 'gray-900' });
const empty = style({ margin: 0, font: 'ui-sm', color: 'gray-600' });
const related = style({ margin: 0, marginTop: 24, maxWidth: '[640px]', font: 'ui-sm', color: 'gray-600' });

export function WebServicePage() {
  const go = useShell((s) => s.go);
  const { status, ready, connected, state } = useServiceStatus('web');
  const flip = useFlipService('web');
  const copy = SERVICE_COPY.web;
  const usable = !!status && state !== 'unavailable';

  let heading: string = WEB_COPY.off;
  let subline: string = WEB_COPY.offSub;
  let mono = false;
  if (!status) subline = connected ? SERVICES_PAGE_COPY.loading : SERVICES_PAGE_COPY.disconnected;
  else if (state === 'unavailable') {
    heading = SERVICES_PAGE_COPY.unavailableTitle(copy.name);
    subline = COMMON_COPY.unavailableSub;
  } else if (state === 'on' && status.endpoint) {
    heading = WEB_COPY.on;
    subline = status.endpoint;
    mono = true;
  } else if (state === 'error') {
    heading = WEB_COPY.error;
    subline = localizeText(status.error, status.errorRef) ?? COMMON_COPY.errorFix;
  } else if (serviceBusy(state)) {
    heading = serviceStateLabel('web', state);
    subline = `${COMMON_COPY.portLabel} ${status.port ?? ''}`;
  }

  return (
    <UtilityPage
      kind="services"
      title={WEB_COPY.title}
      actions={
        <Badge size="S" fillStyle="subtle" variant="neutral">
          {copy.scope}
        </Badge>
      }>
      <p className={lede}>{WEB_COPY.lede}</p>
      <ServiceCard
        id="web"
        state={state}
        heading={heading}
        subline={subline}
        mono={mono}
        disabled={!connected || !ready || !usable}
        onFlip={flip}
        footer={
          usable && status ? (
            <>
              <AutostartCheckbox id="web" status={status} />
              <span className={detailXs}>{COMMON_COPY.stopsWithApp}</span>
            </>
          ) : undefined
        }>
        {state === 'error' && status ? <ErrorFix id="web" status={status} /> : null}
        {state === 'on' && status ? <WebActions status={status} disabled={!connected} /> : null}
      </ServiceCard>
      {state === 'on' ? <p className={note}>{WEB_COPY.linkNote}</p> : null}

      {usable && status ? (
        <>
          {state === 'on' ? <WebSessions status={status} disabled={!connected} /> : null}
          <SectionHead title={COMMON_COPY.section.settings} />
          <section className={panel}>
            <PortRow id="web" status={status} />
            <ReadOnlyRow status={status} disabled={!connected} />
          </section>
        </>
      ) : null}

      <p className={related}>
        {WEB_COPY.apiMoved}{' '}
        <Link isStandalone isQuiet onPress={() => go({ tab: 'services', service: 'model-api' })}>
          {WEB_COPY.apiMovedLink}
        </Link>
      </p>
    </UtilityPage>
  );
}

/** 卡片里的三个按钮：在浏览器中打开（发一条新的登录链接交给系统浏览器）、复制地址、复制登录链接。 */
function WebActions({ status, disabled }: { status: ServiceStatus; disabled: boolean }) {
  const runtime = useRuntime();
  const [busy, setBusy] = useState<'open' | 'link' | null>(null);
  const withLink = (kind: 'open' | 'link') => {
    setBusy(kind);
    runtime
      .createWebAccessLink()
      .then(({ url }) => {
        if (kind === 'link') return copyText(url, WEB_COPY.linkLabel);
        const open = runtime.host.openExternal;
        if (open) return void open(url).catch(toastFailure);
        if (!window.open(url, '_blank', 'noopener,noreferrer')) {
          copyText(url, WEB_COPY.linkLabel);
          ToastQueue.info(WEB_COPY.openFallback, { timeout: 6000 });
        }
      })
      .catch(toastFailure)
      .finally(() => setBusy(null));
  };
  return (
    <div className={actions}>
      <Button variant="accent" size="S" isDisabled={disabled} isPending={busy === 'open'} onPress={() => withLink('open')}>
        <OpenIn />
        <Text>{WEB_COPY.open}</Text>
      </Button>
      <Button variant="secondary" size="S" isDisabled={!status.endpoint} onPress={() => status.endpoint && copyText(status.endpoint, WEB_COPY.addressLabel)}>
        <Copy />
        <Text>{WEB_COPY.copyAddress}</Text>
      </Button>
      <Button variant="secondary" fillStyle="outline" size="S" isDisabled={disabled} isPending={busy === 'link'} onPress={() => withLink('link')}>
        <Text>{WEB_COPY.copyLink}</Text>
      </Button>
    </div>
  );
}

/**
 * 打开的浏览器会话：`services.web.listSessions`。会话没有自己的主题——`services` 主题的 Web 服务状态变了（登录、退出、
 * 连接数变化都会更新 `clients`）就重读一次。
 */
function WebSessions({ status, disabled }: { status: ServiceStatus; disabled: boolean }) {
  const runtime = useRuntime();
  const now = useNow(60_000);
  const [sessions, setSessions] = useState<WebSession[] | null>(null);
  useEffect(() => {
    let alive = true;
    runtime
      .listWebSessions()
      .then((next) => alive && setSessions(next))
      .catch(() => alive && setSessions(null));
    return () => {
      alive = false;
    };
  }, [runtime, status]);
  const revoke = (sessionId: string) =>
    runtime
      .revokeWebSession(sessionId)
      .then((next) => {
        setSessions(next);
        ToastQueue.neutral(WEB_COPY.revoked, { timeout: 3000 });
      })
      .catch(toastFailure);
  return (
    <>
      <SectionHead title={WEB_COPY.sessionsTitle} />
      <section className={panel}>
        {sessions?.length ? (
          sessions.map((s) => (
            <div key={s.sessionId} className={line}>
              <ServiceLightDot tone={s.connections ? 'on' : 'off'} />
              <span className={who}>
                <span className={name}>{browserLabel(s.userAgent)}</span>
                <span className={detailXs}>{webSessionMeta(s, now)}</span>
              </span>
              <DialogTrigger>
                <ActionButton isQuiet size="S" isDisabled={disabled}>
                  {WEB_COPY.revoke}
                </ActionButton>
                <AlertDialog
                  variant="destructive"
                  title={WEB_COPY.revokeTitle}
                  primaryActionLabel={WEB_COPY.revokeConfirm}
                  cancelLabel={COMMON_COPY.cancel}
                  onPrimaryAction={() => void revoke(s.sessionId)}>
                  {WEB_COPY.revokeBody}
                </AlertDialog>
              </DialogTrigger>
            </div>
          ))
        ) : (
          <p className={empty}>{WEB_COPY.sessionsEmpty}</p>
        )}
      </section>
    </>
  );
}

/** 只读（`services.configure` 的 `readOnly`，立即生效）。方法白名单（`methods`）这一版不在界面上收紧。 */
function ReadOnlyRow({ status, disabled }: { status: ServiceStatus; disabled: boolean }) {
  const configure = useConfigureService();
  const readOnly = status.web?.readOnly ?? false;
  return (
    <SetRow label={WEB_COPY.readOnly} desc={WEB_COPY.readOnlyDesc}>
      <Switch
        size="S"
        aria-label={WEB_COPY.readOnly}
        isSelected={readOnly}
        isDisabled={disabled}
        onChange={(on) => void configure({ serviceId: 'web', readOnly: on }, WEB_COPY.readOnlySaved(on))}
      />
    </SetRow>
  );
}
