import { useEffect, useMemo } from 'react';
import type { Id, JobRecord } from '@baocut/protocol';
import AlertTriangle from '@react-spectrum/s2/icons/AlertTriangle';
import Download from '@react-spectrum/s2/icons/Download';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import {
  exportFontFallbacks,
  exportFontNote,
  exportFontPhase,
  familyKey,
  liveFontJobs,
  liveRow,
  type FontRow,
} from '../../model/font-library.ts';
import { useRuntime } from '../../runtime/context.tsx';
import {
  downloadFamily,
  exportUsageKey,
  refreshExportUsage,
  refreshFamilies,
  refreshUsage,
  startFontLibrarySync,
  useFontLibrary,
} from '../../state/font-library-store.ts';
import { useJobs } from '../../state/jobs-store.ts';
import { useSetting } from '../../state/settings-store.ts';
import { toastError } from '../editor/font-detail.tsx';
import { TextLink } from './export-parts.tsx';

/**
 * 导出与按需下载的字体（产品设计 §5.9「字体」、§8.1；原型 export.jsx 与 font-downloads.jsx 的 ExportFontNote）：
 * - 导出前（视频页顶上）：用到的族里还在下载的（导出先等）、没下载成功的（用回退字体代替，可重试）、没下载的（自动下载开着时
 *   导出开始先下载，关着时用回退字体导出，可以现在下载）；
 * - 导出中：准备阶段念「下载字体 · 族 百分比」；
 * - 导出完：没取到的族列出用什么代替与原因（Runtime 的 `FONT_NOT_DOWNLOADED` 警告）。
 * 下载不成不拦导出、也不要先选替代字体：照回退字体导出，给出警告（产品设计 §12 已定）。只在桌面端：浏览器会话没有 `fonts.*`。
 */

const notes = style({ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 });
const note = style({
  display: 'flex',
  alignItems: 'center',
  gap: '[6px]',
  font: 'ui-xs',
  color: { default: 'gray-700', isNotice: 'orange-1000' },
  minWidth: 0,
  overflowWrap: 'anywhere',
});
const grow = style({ flexGrow: 1, minWidth: 0 });
const icon = style({ display: 'flex', flexShrink: 0 });
const doneNote = style({
  display: 'flex',
  alignItems: 'center',
  gap: '[6px]',
  marginTop: 12,
  font: 'ui-xs',
  color: 'orange-1000',
  overflowWrap: 'anywhere',
});

/**
 * 导出面板视频页顶上的字体提示：打开时、切换「烧录字幕」时按这次导出的参数再清点一次（不下载）。字幕不烧进画面时，
 * 只有字幕用的族不列、不给下载（导出也不会下载它们）。
 */
export function ExportFontNote({ videoId, burnCaptions }: { videoId: Id; burnCaptions: boolean }) {
  const { client, host } = useRuntime();
  const web = host.platform === 'web';
  const usage = useFontLibrary((s) => s.exportUsage[exportUsageKey(videoId, burnCaptions)]);
  const statuses = useFontLibrary((s) => s.statuses);
  const jobs = useJobs((s) => s.jobs);
  const auto = useSetting('fonts.autoDownload') !== false;

  useEffect(() => (web ? undefined : startFontLibrarySync(client)), [client, web]);
  useEffect(() => {
    if (!web) void refreshExportUsage(client, videoId, burnCaptions).catch(() => {});
  }, [client, videoId, burnCaptions, web]);

  const lines = useMemo(() => {
    if (!usage) return [];
    const live = liveFontJobs(jobs);
    const byName = new Map<string, FontRow>();
    for (const f of usage.families) {
      const status = statuses[familyKey(f.family)] ?? f.status;
      byName.set(familyKey(f.family), liveRow(status, live.get(familyKey(f.family))));
    }
    return exportFontNote(usage.families, byName, auto);
  }, [usage, statuses, jobs, auto]);

  if (web || !lines.length) return null;
  return (
    <div className={notes}>
      {lines.map((l) => (
        <div key={l.tone + l.families.join()} className={note({ isNotice: l.tone === 'notice' })}>
          <span className={icon}>{l.tone === 'notice' ? <AlertTriangle /> : <Download />}</span>
          <span className={grow}>{l.text}</span>
          {l.action ? (
            <TextLink onPress={() => l.families.forEach((family) => void downloadFamily(client, family).catch(toastError))}>
              {l.action}
            </TextLink>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/**
 * 导出在下载字体时（任务阶段 `downloading`）念「下载字体 · 族 百分比」。导出自己下载的 face 不是 `fontDownload` 任务，
 * 在下哪一个按族的状态（`downloading`）找：这段时间每隔一会儿按这个视频用到的族重新取状态。
 */
export function useExportFontPhase(job: JobRecord): string | null {
  const { client } = useRuntime();
  const videoId = job.videoId;
  const usage = useFontLibrary((s) => (videoId ? s.usage[videoId] : undefined));
  const statuses = useFontLibrary((s) => s.statuses);
  const downloading = job.state === 'running' && job.phase === 'downloading';
  const families = useMemo(() => usage?.families.map((f) => f.family) ?? [], [usage]);

  useEffect(() => {
    if (!downloading || !videoId) return;
    let stopped = false;
    const tick = async () => {
      if (!usage) await refreshUsage(client, videoId).catch(() => {});
      const names = useFontLibrary.getState().usage[videoId]?.families.map((f) => f.family) ?? [];
      if (!stopped && names.length) await refreshFamilies(client, names).catch(() => {});
    };
    void tick();
    const timer = setInterval(() => void tick(), 1500);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [client, downloading, videoId, usage]);

  if (!downloading) return null;
  const now = families.map((f) => statuses[familyKey(f)]).filter((s) => s?.state === 'downloading');
  return exportFontPhase(job, now as NonNullable<(typeof now)[number]>[]);
}

/** 导出完成：没取到的族用什么代替、为什么（不拦导出，事后说清楚）。 */
export function ExportFontFallbacks({ job }: { job: JobRecord }) {
  const text = exportFontFallbacks(job.warnings);
  if (!text) return null;
  return (
    <div className={doneNote}>
      <span className={icon}>
        <AlertTriangle />
      </span>
      <span className={grow}>{text}</span>
    </div>
  );
}
