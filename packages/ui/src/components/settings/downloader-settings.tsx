import type { ReactNode } from 'react';
import { cookieBrowsersSetting, type LinkCookieBrowser } from '@baocut/protocol';
import { ActionButton, Checkbox, ToastQueue } from '@react-spectrum/s2';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { allBrowsersState, cookieNotes, fullDiskNeeds, NO_COOKIE_BROWSERS, toggleAllBrowsers, toggleBrowser } from '../../model/link-cookies.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useCookieBrowserChoice } from '../../state/cookie-browsers-store.ts';
import { FullDiskNotice } from '../system-access/full-disk-access.tsx';
import { useFullDiskAccess } from '../../state/system-access-store.ts';
import { DownloaderCard, useDownloaderTool } from '../start/downloader-card.tsx';
import { LINK_TOOL_COPY } from '../tools/tools-copy.ts';
import { M as GENERAL } from './general-settings-copy.ts';
import { M } from './downloader-settings-copy.ts';
import { useSaveSettings, useSettingsReady } from './save-settings.ts';

/*
 * 设置 › 视频下载（产品设计 §2.7「下载视频」；设计稿 settings-downloader.jsx）：yt-dlp 的状态与维护，以及网站登录（浏览器 Cookie）。
 * 下载视频工具、从链接转录与智能体的下载都按这里的网站登录（`downloads.cookieBrowsers`）。默认带 Cookie，用所有检测到的浏览器；
 * 全部勾上存「所有浏览器」（之后新检测到的也算在内），都不勾是匿名下载。
 *
 * 浏览器里（Web）只看不改：不检测下载工具（`externalTools.*` 只开放浏览器列表），复选框置灰（`settings.set` 不开放）。
 */

const lead = style({ marginTop: -8, marginBottom: 24, font: 'ui-sm', color: 'gray-600' });
const group = style({ marginBottom: 48 });
const groupHead = style({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 16 });
const groupTitle = style({ margin: 0, font: 'ui', fontWeight: 'medium', color: 'gray-900' });
const card = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: 16,
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'gray-200',
  borderRadius: 'xl',
  minWidth: 0,
});
const text = style({ margin: 0, font: 'ui-sm', color: 'gray-700', overflowWrap: 'anywhere' });
const note = style({ margin: 0, font: 'ui-xs', color: 'gray-600', overflowWrap: 'anywhere' });
const strongNote = style({ margin: 0, font: 'ui-sm', color: 'gray-800', overflowWrap: 'anywhere' });
const browserRow = style({ display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 16, rowGap: 4, minWidth: 0 });
/** 下载工具卡片自带上边距（链接页里接在表单下面），放在这一节里时去掉。 */
const flush = style({ marginTop: -12 });

export function DownloaderSettings() {
  const web = useRuntime().host.platform === 'web';
  return (
    <>
      <p className={lead}>{M.lead}</p>
      <Group title={M.toolGroup}>{web ? <p className={text}>{GENERAL.downloaderWeb}</p> : <ToolCard />}</Group>
      <CookieGroup web={web} />
    </>
  );
}

function Group({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className={group} aria-label={title}>
      <div className={groupHead}>
        <h2 className={groupTitle}>{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** yt-dlp：检测到的版本、来源与安装方式，重新检测、准备下载工具、指定位置，按原安装方式更新（与链接导入的卡片同一个）。 */
function ToolCard() {
  const view = useDownloaderTool(true);
  return (
    <div className={flush}>
      <DownloaderCard view={view} />
    </div>
  );
}

/**
 * 网站登录：只列出检测到的浏览器（最近用过的在前），最前面是「所有浏览器」（全选 / 半选）；勾选即存为设置。
 * 下面按勾选写清楚怎么试、读了什么，以及 Runtime 所在主机要的系统授权。
 */
function CookieGroup({ web }: { web: boolean }) {
  const choice = useCookieBrowserChoice(true);
  const save = useSaveSettings();
  const ready = useSettingsReady();
  const { browsers: detected, list } = choice;
  // 授权卡只在桌面端（有 `systemAccess` 桥）出现；Web 看不到这个状态，说明里保留去系统设置的文字步骤。
  const access = useFullDiskAccess().status;
  const needs = fullDiskNeeds(list, choice.platform, detected, access);
  const all = allBrowsersState(list, detected);
  const first = choice.pending && !detected.length;
  const locked = web || !ready;
  const change = (next: LinkCookieBrowser[]) => void save({ 'downloads.cookieBrowsers': cookieBrowsersSetting(next, detected) });
  const redetect = () => choice.detect((n) => ToastQueue.neutral(LINK_TOOL_COPY.detected(n), { timeout: 4000 }));
  return (
    <Group
      title={LINK_TOOL_COPY.cookies}
      aside={
        <ActionButton isQuiet size="S" isDisabled={choice.pending} onPress={redetect}>
          {choice.pending ? LINK_TOOL_COPY.detecting : LINK_TOOL_COPY.redetect}
        </ActionButton>
      }>
      <div className={card}>
        <p className={text}>{M.cookiesLead}</p>
        {first ? (
          <p className={note}>{LINK_TOOL_COPY.detectingFirst}</p>
        ) : choice.state === 'failed' ? (
          <p className={note}>{LINK_TOOL_COPY.detectFailed(choice.error)}</p>
        ) : !detected.length ? (
          <p className={note}>{NO_COOKIE_BROWSERS}</p>
        ) : (
          <>
            <div className={browserRow} role="group" aria-label={LINK_TOOL_COPY.browsersLabel}>
              <Checkbox
                size="S"
                isDisabled={locked}
                isSelected={all.selected}
                isIndeterminate={all.indeterminate}
                onChange={() => change(toggleAllBrowsers(list, detected))}>
                {LINK_TOOL_COPY.allBrowsers}
              </Checkbox>
              {detected.map((b) => (
                <Checkbox key={b.id} size="S" isDisabled={locked} isSelected={list.includes(b.id)} onChange={(on) => change(toggleBrowser(list, b.id, on, detected))}>
                  {b.label}
                </Checkbox>
              ))}
            </div>
            {needs.length ? <FullDiskNotice browsers={needs} /> : null}
            {cookieNotes(list, choice.platform, detected, access).map((line) => (
              <p key={line} className={note}>
                {line}
              </p>
            ))}
          </>
        )}
        {web ? <p className={strongNote}>{GENERAL.webNote}</p> : null}
      </div>
    </Group>
  );
}
