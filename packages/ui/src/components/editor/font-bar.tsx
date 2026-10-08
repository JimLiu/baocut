import { useEffect, useMemo, useState, type ReactElement } from 'react';
import type { Id } from '@baocut/protocol';
import { ActionButton, Button, ProgressBar, Text, Tooltip, TooltipTrigger } from '@react-spectrum/s2';
import AlertTriangle from '@react-spectrum/s2/icons/AlertTriangle';
import CheckmarkCircle from '@react-spectrum/s2/icons/CheckmarkCircle';
import Close from '@react-spectrum/s2/icons/Close';
import Download from '@react-spectrum/s2/icons/Download';
import Refresh from '@react-spectrum/s2/icons/Refresh';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { KERNEL_FALLBACK, familyKey, fontBar, liveFontJobs, liveRow, type FontRow } from '../../model/font-library.ts';
import { useRuntime } from '../../runtime/context.tsx';
import {
  cancelBatch,
  dismissBatch,
  downloadBatch,
  downloadFamily,
  leaveVideoFonts,
  openVideoFonts,
  skipCurrent,
  startFontLibrarySync,
  useFontLibrary,
} from '../../state/font-library-store.ts';
import { useJobs } from '../../state/jobs-store.ts';
import { useSetting } from '../../state/settings-store.ts';
import { useShell } from '../../state/shell-store.ts';
import { toastError } from './font-detail.tsx';
import { FONT_COPY as FC } from './font-copy.ts';

/**
 * 打开视频时的字体条（产品设计 §5.9「字体」；原型 font-downloads.jsx 的 FontOpenStrip）：舞台上方一条，整部视频只有这一处
 * 说字体下载的事。Runtime 清点用到的族（`fonts.usage`，按自动下载的设置开始下载；十分钟内失败过的不自动重试），这里念
 * 进行中（第几个、族名与进度，跳过这个 / 全部取消）、全到了（3 秒后自己收起）、没取到（查看：族 → 回退字体 · 原因，可重试）
 * 与自动下载关着（下载 / 设置）。下载期间画面照回退字体画，到了就换上（预览自己要字体）。
 */

const strip = style({
  flexShrink: 0,
  marginTop: '[10px]',
  marginX: 12,
  paddingX: 12,
  paddingY: '[6px]',
  borderRadius: 'default',
  font: 'ui-sm',
  backgroundColor: { default: 'gray-100', tone: { ready: 'green-100', notice: 'orange-100' } },
  color: { default: 'gray-900', tone: { ready: 'green-1000', notice: 'orange-1000' } },
});
const line = style({ display: 'flex', alignItems: 'center', gap: 8, minHeight: 24 });
const text = style({ flexGrow: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
const meta = style({ color: 'gray-700' });
const mono = style({ fontFamily: 'code' });
const bar = style({ width: 'full', marginTop: 4 });
const list = style({ display: 'grid', gap: 4, marginTop: '[6px]', marginBottom: 0, padding: 0, listStyleType: 'none' });
const item = style({ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 });
const detail = style({ flexGrow: 1, minWidth: 0, color: 'gray-700', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
const icon = style({ display: 'flex', flexShrink: 0 });
const nowrap = style({ flexShrink: 0 });

export function FontBar({ videoId }: { videoId: Id | null }) {
  const { client, host } = useRuntime();
  // 浏览器会话没有 `fonts.*`：Web 入口不清点、不画这一条。
  const web = host.platform === 'web';
  const auto = useSetting('fonts.autoDownload');
  const settingsLoaded = auto !== null;
  const batch = useFontLibrary((s) => s.batch);
  const statuses = useFontLibrary((s) => s.statuses);
  const usage = useFontLibrary((s) => (videoId ? s.usage[videoId] : undefined));
  const jobs = useJobs((s) => s.jobs);
  const [open, setOpen] = useState(false);

  useEffect(() => (web ? undefined : startFontLibrarySync(client)), [client, web]);
  // 打开视频时清点一次（设置镜像到了才知道自动下载开没开）。
  useEffect(() => {
    if (web || !settingsLoaded || !videoId) return;
    void openVideoFonts(client, videoId, auto !== false).catch(() => {});
    return () => leaveVideoFonts(videoId);
    // 只在打开时清点：之后改设置不重新清点。
  }, [client, videoId, settingsLoaded, web]);

  const live = useMemo(() => liveFontJobs(jobs), [jobs]);
  const shown = useMemo(() => {
    if (!batch || batch.videoId !== videoId) return null;
    const byName = new Map<string, FontRow>();
    for (const family of batch.families) {
      const status = statuses[familyKey(family)];
      if (status) byName.set(familyKey(family), liveRow(status, live.get(familyKey(family))));
    }
    const fallbackOf = (family: string) =>
      usage?.families.find((f) => familyKey(f.family) === familyKey(family))?.fallback ?? usage?.fallback ?? KERNEL_FALLBACK;
    return fontBar(batch, byName, fallbackOf);
  }, [batch, videoId, statuses, live, usage]);

  const kind = shown?.kind;
  useEffect(() => {
    if (kind !== 'ready') return;
    const timer = setTimeout(dismissBatch, 3000);
    return () => clearTimeout(timer);
  }, [kind]);

  if (!shown) return null;
  const tone = shown.kind === 'ready' ? 'ready' : shown.kind === 'running' ? undefined : 'notice';
  const goSettings = () => useShell.getState().go({ tab: 'settings', section: 'fonts' });
  return (
    <div className={strip({ tone })} role="status" aria-live="polite">
      <div className={line}>
        <span className={icon}>
          {shown.kind === 'ready' ? <CheckmarkCircle /> : shown.kind === 'running' ? <Download /> : <AlertTriangle />}
        </span>
        <span className={text}>
          {shown.title}
          {shown.kind === 'running' ? (
            <span className={meta}>
              {' '}
              · {shown.count} · {shown.current} <span className={mono}>{shown.progress}</span>
            </span>
          ) : null}
        </span>
        {shown.kind === 'running' ? (
          <>
            <ActionButton isQuiet size="S" styles={nowrap} onPress={() => void skipCurrent(client).catch(toastError)}>
              {FC.skipThis}
            </ActionButton>
            <Tip text={FC.cancelAllTip}>
              <ActionButton isQuiet size="S" aria-label={FC.cancelAll} onPress={() => void cancelBatch(client).catch(toastError)}>
                <Close />
              </ActionButton>
            </Tip>
          </>
        ) : null}
        {shown.kind === 'missed' ? (
          <>
            <ActionButton isQuiet size="S" styles={nowrap} onPress={() => setOpen(!open)}>
              {open ? FC.collapse : FC.view}
            </ActionButton>
            <Tip text={FC.gotIt}>
              <ActionButton isQuiet size="S" aria-label={FC.gotIt} onPress={dismissBatch}>
                <Close />
              </ActionButton>
            </Tip>
          </>
        ) : null}
        {shown.kind === 'off' ? (
          <>
            <Button variant="secondary" size="S" onPress={() => void downloadBatch(client).catch(toastError)}>
              {FC.download}
            </Button>
            <ActionButton isQuiet size="S" styles={nowrap} onPress={goSettings}>
              {FC.settings}
            </ActionButton>
            <Tip text={FC.gotIt}>
              <ActionButton isQuiet size="S" aria-label={FC.gotIt} onPress={dismissBatch}>
                <Close />
              </ActionButton>
            </Tip>
          </>
        ) : null}
      </div>
      {shown.kind === 'running' ? (
        <ProgressBar
          aria-label={FC.progress}
          size="S"
          styles={bar}
          value={shown.value ?? undefined}
          isIndeterminate={shown.value === null}
        />
      ) : null}
      {(shown.kind === 'missed' && open) || shown.kind === 'off' ? (
        <ul className={list}>
          {shown.rows.map((r) => (
            <li key={r.family} className={item}>
              <b>{r.family}</b>
              <span className={detail}>
                → {r.fallback} · {r.reason}
              </span>
              {shown.kind === 'missed' ? (
                <ActionButton isQuiet size="S" styles={nowrap} onPress={() => void downloadFamily(client, r.family).catch(toastError)}>
                  <Refresh />
                  <Text>{FC.retry}</Text>
                </ActionButton>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function Tip({ text: label, children }: { text: string; children: ReactElement }) {
  return (
    <TooltipTrigger placement="top">
      {children}
      <Tooltip>{label}</Tooltip>
    </TooltipTrigger>
  );
}
