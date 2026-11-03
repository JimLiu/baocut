import { useState, type ReactNode } from 'react';
import { intlLocale, type LinkCookieBrowser } from '@baocut/protocol';
import { ActionButton, AlertDialog, Button, DialogContainer, Text } from '@react-spectrum/s2';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import Lock from '@react-spectrum/s2/icons/Lock';
import { cookieBrowserLabel } from '../../model/link-cookies.ts';
import { M } from '../../model/system-access-copy.ts';
import { useFullDiskAccess } from '../../state/system-access-store.ts';
import { S } from '../shell-copy.ts';

/*
 * macOS 的完全磁盘访问权限（产品设计 §7.9；设计稿 settings-downloader.jsx 的 FullDiskNotice）：
 * 授权卡（设置 › 视频下载与下载视频页）、下载前问一次的对话框、失败卡上的按钮、设置 › 隐私与权限里的一行。
 * 只有桌面端在 macOS 上、Runtime 在这台电脑上并报告「未允许」时才出现；Web 与别的系统保持原来的文字说明。
 */

const card = style({
  display: 'flex',
  gap: 12,
  padding: 12,
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'gray-200',
  borderRadius: 'xl',
  backgroundColor: 'gray-25',
  minWidth: 0,
});
const cardIcon = style({ flexShrink: 0, marginTop: 2, color: 'gray-700' });
const cardBody = style({ display: 'flex', flexDirection: 'column', alignItems: 'start', gap: 8, minWidth: 0 });
const cardTitle = style({ font: 'ui', fontWeight: 'bold', color: 'gray-900', overflowWrap: 'anywhere' });
const cardText = style({ font: 'ui-xs', color: 'gray-600', overflowWrap: 'anywhere' });
const cardButtons = style({ display: 'flex', flexWrap: 'wrap', gap: 8 });

const namesOf = (ids: readonly LinkCookieBrowser[]) =>
  new Intl.ListFormat(intlLocale('en'), { type: 'conjunction' }).format(ids.map(cookieBrowserLabel));

/** 授权卡：说清为什么要、点一下直接去系统设置；去过之后改成「启用后重新启动」。`browsers` 是这次要用、又没授权的浏览器。 */
export function FullDiskNotice({ browsers }: { browsers: readonly LinkCookieBrowser[] }) {
  const access = useFullDiskAccess();
  if (!access.missing || !browsers.length) return null;
  const opened = access.step === 'opened';
  return (
    <div className={card} role="group" aria-label={M.settingLabel}>
      <span className={cardIcon}>
        <Lock />
      </span>
      <div className={cardBody}>
        <span className={cardTitle}>{opened ? M.openedTitle : M.cardTitle(namesOf(browsers))}</span>
        <span className={cardText}>{opened ? M.openedBody : M.cardBody}</span>
        <div className={cardButtons}>
          <Button size="S" variant="accent" onPress={() => void (opened ? access.restart() : access.open())}>
            {opened ? M.restart : M.open}
          </Button>
          {opened ? (
            <ActionButton size="S" isQuiet onPress={() => void access.open()}>
              <Text>{M.openAgain}</Text>
            </ActionButton>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * 失败卡（读不到浏览器 Cookie，或系统拒绝访问某个位置）上的按钮：`details.systemAccess` 为 `fullDiskAccess` 时才有，
 * 只在能直接带去系统设置时显示；授权后回到应用，按钮旁的「重试」照常使用。
 */
export function OpenAccessButton({ size = 'S', children }: { size?: 'S' | 'M'; children?: ReactNode }) {
  const access = useFullDiskAccess();
  if (!access.actionable || access.granted) return null;
  const opened = access.step === 'opened';
  return (
    <Button size={size} variant="accent" onPress={() => void (opened ? access.restart() : access.open())}>
      {children ?? (opened ? M.restart : M.open)}
    </Button>
  );
}

/** 下载前的询问：`guard(needs, proceed)` 在这次运行里还没问过、确实缺授权时弹出对话框，否则直接 `proceed(false)`。 */
export function useFullDiskAsk() {
  const access = useFullDiskAccess();
  const [asking, setAsking] = useState<{ needs: readonly LinkCookieBrowser[]; skip: () => void } | null>(null);
  return {
    asking,
    close: () => setAsking(null),
    /** `proceed(true)` 是「这次跳过」：调用方把需要授权的浏览器从这一次下载里去掉。 */
    guard(needs: readonly LinkCookieBrowser[], proceed: (skipNeeds: boolean) => void) {
      if (access.missing && needs.length && !access.asked) {
        access.markAsked();
        setAsking({ needs, skip: () => proceed(true) });
      } else proceed(false);
    },
  };
}

/**
 * 开始下载前问一次（这次运行里问过就不再弹）：打开系统设置，或「这次跳过」——把需要授权的浏览器从这一次下载里去掉，用其余的继续。
 * 关掉对话框（取消）什么都不做。
 */
export function FullDiskAskDialog({ ask }: { ask: ReturnType<typeof useFullDiskAsk> }) {
  const access = useFullDiskAccess();
  const asking = ask.asking;
  return (
    <DialogContainer onDismiss={ask.close}>
      {asking ? (
        <AlertDialog
          title={M.askTitle(namesOf(asking.needs))}
          primaryActionLabel={M.open}
          secondaryActionLabel={M.skip}
          cancelLabel={S.common.cancel}
          onPrimaryAction={() => void access.open()}
          onSecondaryAction={asking.skip}>
          {M.askBody(namesOf(asking.needs))}
        </AlertDialog>
      ) : null}
    </DialogContainer>
  );
}
