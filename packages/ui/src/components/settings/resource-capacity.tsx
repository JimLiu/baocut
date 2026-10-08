import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { ResourcesSnapshot } from '@baocut/protocol';
import { Button, NumberField, ToastQueue } from '@react-spectrum/s2';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import {
  CAPACITY_LIMITS,
  autoPlaceholder,
  capacityForm,
  capacityRows,
  capacitySetting,
  demandLine,
  sameCapacity,
  type CapacityForm,
} from '../../model/resource-capacity.ts';
import { jobWaitText } from '../../model/localized-text.ts';
import { kindLabel } from '../../model/task-list.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useConnection } from '../../state/connection-store.ts';
import { useJobs } from '../../state/jobs-store.ts';
import { useSetting } from '../../state/settings-store.ts';
import { RESOURCE_COPY } from './resource-capacity-copy.ts';

/*
 * 设置 → 诊断 →「资源调度」（架构设计 §7.6、§7.7；设计稿没有这一块）：机器的容量与来源、谁在用、谁在等；
 * 内存、GPU 内存与 CPU 线程可以手动设上限（偏好设置 `resources.capacity`，留空为自动）。`jobs.resources` 是请求不是主题，
 * 这一节开着时每 5 秒取一次，任务有进出、改了设置也立即重取。分组与行的样式与设置页的 Group / Row 相同。
 */

const group = style({ marginBottom: 48 });
const groupHead = style({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 16 });
const groupTitle = style({ margin: 0, font: 'ui', fontWeight: 'medium', color: 'gray-900' });
const lead = style({ marginTop: -8, marginBottom: 16, font: 'ui-sm', color: 'gray-600' });
const card = style({ paddingX: 16, borderWidth: 1, borderStyle: 'solid', borderColor: 'gray-200', borderRadius: 'xl' });
const subhead = style({ marginTop: 24, marginBottom: 12, font: 'ui-sm', fontWeight: 'medium', color: 'gray-700' });
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
const rowLabel = style({ font: 'ui', fontWeight: 'medium', color: 'gray-900' });
const rowDesc = style({ marginTop: 4, font: 'ui-sm', color: 'gray-600', overflowWrap: 'anywhere', userSelect: 'text' });
const rowControl = style({ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 });
const rowValue = style({ font: 'ui', color: 'gray-800', userSelect: 'text' });
const field = style({ width: 144 });

const POLL_MS = 5000;

const FIELD_OF = { memory: 'memoryGB', gpuMemory: 'gpuMemoryGB', cpuThreads: 'cpuThreads' } as const;

export function ResourceCapacity() {
  const runtime = useRuntime();
  const connected = useConnection((s) => s.state.status === 'connected');
  const setting = useSetting('resources.capacity');
  const jobs = useJobs((s) => s.jobs);
  const [snapshot, setSnapshot] = useState<ResourcesSnapshot | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setSnapshot(await runtime.client.request('jobs.resources', {}));
      setFailed(null);
    } catch (error) {
      setFailed((error as Error).message);
    }
  }, [runtime]);

  // 任务有进出时（jobs 镜像变了）、设置变了时立即重取；其余时候按间隔取。
  const live = jobs
    .filter((j) => j.state === 'running' || j.state === 'queued')
    .map((j) => `${j.jobId}:${j.state}`)
    .join(',');
  useEffect(() => {
    if (!connected) return;
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [connected, load, live, setting]);

  const save = async (next: CapacityForm) => {
    const value = capacitySetting(next);
    if (sameCapacity(value, setting)) return;
    try {
      await runtime.client.request('settings.set', { values: { 'resources.capacity': value } });
      await load();
    } catch (error) {
      ToastQueue.negative(RESOURCE_COPY.saveFailed((error as Error).message), { timeout: 5000 });
    }
  };

  const form = capacityForm(setting);
  const overridden = setting !== null && capacitySetting(form) !== null;
  const titleOf = (owner: string, label: string) => {
    const job = jobs.find((j) => j.jobId === owner);
    return job ? kindLabel(job.kind) : label;
  };

  return (
    <section className={group} aria-label={RESOURCE_COPY.title}>
      <div className={groupHead}>
        <h2 className={groupTitle}>{RESOURCE_COPY.title}</h2>
        {overridden ? (
          <Button variant="secondary" size="S" isDisabled={!connected} onPress={() => void save({ memoryGB: null, gpuMemoryGB: null, cpuThreads: null })}>
            {RESOURCE_COPY.resetAll}
          </Button>
        ) : null}
      </div>
      <p className={lead}>{RESOURCE_COPY.lead}</p>
      <div className={card}>
        {!connected ? (
          <Row label={RESOURCE_COPY.disconnected} />
        ) : !snapshot ? (
          <Row label={failed ? RESOURCE_COPY.loadFailed : RESOURCE_COPY.loading} desc={failed ?? undefined} />
        ) : (
          capacityRows(snapshot).map((r) => {
            const key = r.dimension === 'scratchDisk' ? null : FIELD_OF[r.dimension];
            return (
              <Row key={r.dimension} label={`${r.label} · ${r.total}`} desc={r.desc}>
                {key ? (
                  <NumberField
                    aria-label={RESOURCE_COPY.limitOf(r.label, RESOURCE_COPY.unit[key])}
                    size="S"
                    styles={field}
                    placeholder={autoPlaceholder(snapshot, key)}
                    minValue={CAPACITY_LIMITS[key].min}
                    maxValue={CAPACITY_LIMITS[key].max}
                    step={key === 'cpuThreads' ? 1 : 0.5}
                    formatOptions={key === 'cpuThreads' ? { maximumFractionDigits: 0 } : { maximumFractionDigits: 1 }}
                    value={form[key] ?? NaN}
                    onChange={(value) => void save({ ...form, [key]: Number.isNaN(value) ? null : value })}
                  />
                ) : (
                  <span className={rowValue}>{RESOURCE_COPY.notSettable}</span>
                )}
              </Row>
            );
          })
        )}
      </div>
      {snapshot ? (
        <>
          <div className={subhead}>{RESOURCE_COPY.inUseAndQueued}</div>
          <div className={card}>
            {snapshot.leases.length || snapshot.waiting.length ? (
              <>
                {snapshot.leases.map((l) => (
                  <Row key={l.leaseId} label={titleOf(l.owner, l.label)} desc={RESOURCE_COPY.inUse(demandLine(l.demand))} />
                ))}
                {snapshot.waiting.map((w) => (
                  <Row
                    key={`wait:${w.owner}`}
                    label={titleOf(w.owner, w.label)}
                    desc={RESOURCE_COPY.queued(jobWaitText(w.wait), demandLine(w.demand))}
                  />
                ))}
              </>
            ) : (
              <Row label={RESOURCE_COPY.idle} />
            )}
          </div>
        </>
      ) : null}
    </section>
  );
}

function Row({ label, desc, children }: { label: string; desc?: string; children?: ReactNode }) {
  return (
    <div className={row}>
      <div className={rowText}>
        <div className={rowLabel}>{label}</div>
        {desc ? <div className={rowDesc}>{desc}</div> : null}
      </div>
      {children ? <div className={rowControl}>{children}</div> : null}
    </div>
  );
}
