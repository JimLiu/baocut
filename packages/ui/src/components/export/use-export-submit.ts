import { useRef, useState } from 'react';
import type { AssetRecord, DocumentRecord, ExportSettings, Id, Sequence } from '@baocut/protocol';
import { ToastQueue } from '@react-spectrum/s2';
import { tabOfKind, type ExportTab } from '../../model/export-job.ts';
import { explainExportError, type ExportProblem } from '../../model/export-rejection.ts';
import { defaultFileNames, exportTargetDir } from '../../model/export-settings.ts';
import { pickExportDestination } from '../../model/export-destination.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useExportPlaces } from '../../state/export-store.ts';
import { EXPORT_COPY } from './export-copy.ts';

/** 弹层各页要读的视频事实（编辑器打开着的那个视频）。 */
export interface ExportEnv {
  videoId: Id;
  videoName: string;
  sequence: Sequence;
  documents: Record<Id, DocumentRecord>;
  assets: Record<Id, AssetRecord>;
  /** 编辑器播放头（秒）：范围的「取此刻」与默认勾的那一段。 */
  playhead: number;
  selection: readonly Id[];
  /** 已追平、能提交（打开中、断线时不能导）。 */
  ready: boolean;
  /** 成片没挑位置时导到这里：原视频所在的文件夹（`exportSourceDir`）；Web、素材在视频目录里时 null，交给 Runtime 的缺省。 */
  sourceDir: string | null;
}

export interface ExportSubmit {
  busy: boolean;
  /** 上一次提交被拒的原因；没有被拒时 null。 */
  problem: ExportProblem | null;
  /** 被拒的那份设置：补救（跳过、换位置、指定文档）在它上面改了重提。 */
  rejected: ExportSettings | null;
  submit(settings: ExportSettings, dir?: string | null): Promise<void>;
  /** 一次导几份（音频页「每种配音各一份」）：逐份提交，弹层盯第一份。 */
  submitEach(parts: readonly ExportPart[], dir?: string | null): Promise<void>;
  dismiss(): void;
}

/** 几份里的一份：设置，加上可选的固定文件名（只出一个文件时）。 */
export interface ExportPart {
  settings: ExportSettings;
  fileName?: string | null;
}

/**
 * 桌面端先确认保存目的地，取消时不建任务；Web 沿用 Runtime 目的地。
 * 提交一次导出（`exports.create`，架构设计 §9.11）：通过了就是一条 Job，交给弹层盯着它的进度；
 * 被拒时没有建任务，按 Runtime 的拒绝码整理成一句标题、逐项清单与能做的补救。不重试、不伪造结果。
 */
export function useExportSubmit(env: ExportEnv, onStarted: (jobId: Id, tab: ExportTab) => void): ExportSubmit {
  const runtime = useRuntime();
  const savedDir = useExportPlaces((s) => s.dirs[env.videoId] ?? null);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [problem, setProblem] = useState<ExportProblem | null>(null);
  const [rejected, setRejected] = useState<ExportSettings | null>(null);
  // 几份里第一份就被拒（还没有建任务）：补救（换个位置）拿着被拒的那份重提时，从它起把剩下的几份一起重提。
  const [batch, setBatch] = useState<{ rejected: ExportSettings; parts: readonly ExportPart[] } | null>(null);
  const placeFor = (settings: ExportSettings, dir: string | null | undefined) => exportTargetDir(settings.kind, dir, savedDir, env.sourceDir);
  const namesFor = (settings: ExportSettings) => defaultFileNames(env.videoName, settings, env.documents, env.sequence);
  const pickDestination = async (names: readonly string[], target: string | null) => {
    try {
      return await pickExportDestination(runtime.host, names, target, EXPORT_COPY);
    } catch (error) {
      ToastQueue.negative(EXPORT_COPY.pickFailed(error instanceof Error ? error.message : String(error)), { timeout: 5000 });
      return null;
    }
  };

  const submit = async (settings: ExportSettings, dir?: string | null) => {
    if (batch && settings === batch.rejected) return submitEach(batch.parts, dir);
    if (pending.current) return;
    pending.current = true;
    setBatch(null);
    const target = placeFor(settings, dir);
    setBusy(true);
    setProblem(null);
    try {
      const destination = await pickDestination(namesFor(settings), target);
      if (!destination) return;
      const jobId = await runtime.createExport({ videoId: env.videoId, settings, destination });
      setRejected(null);
      onStarted(jobId, tabOfKind(settings.kind));
    } catch (error) {
      setRejected(settings);
      setProblem(explainExportError(error, { kind: settings.kind, stage: 'rejected', documents: env.documents }));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };

  /**
   * 逐份 `exports.create`（各是一条任务）。都提交了：弹层盯第一份，其余在任务里，提示一句。
   * 第一份就被拒：和单份一样在页内说明与补救，补救时剩下的几份一起重提；提交了几份之后才被拒：弹层已经去盯第一份了，
   * 用提示说清楚后面几份没导。
   */
  const submitEach = async (parts: readonly ExportPart[], dir?: string | null) => {
    if (!parts.length || pending.current) return;
    pending.current = true;
    setBusy(true);
    setProblem(null);
    setBatch(null);
    const started: Id[] = [];
    try {
      const names = parts.flatMap((part) => part.fileName ? [part.fileName] : namesFor(part.settings));
      const picked = await pickDestination(names, placeFor(parts[0]!.settings, dir));
      if (!picked) return;
      for (const [index, part] of parts.entries()) {
        const destination = { ...(part.fileName ? { fileName: part.fileName } : {}), ...picked };
        try {
          started.push(
            await runtime.createExport({ videoId: env.videoId, settings: part.settings, ...(Object.keys(destination).length ? { destination } : {}) }),
          );
        } catch (error) {
          const explained = explainExportError(error, { kind: part.settings.kind, stage: 'rejected', documents: env.documents });
          if (!started.length) {
            setRejected(part.settings);
            setProblem(explained);
            setBatch({ rejected: part.settings, parts: parts.slice(index) });
          } else {
            ToastQueue.negative(EXPORT_COPY.eachPartial(started.length, parts.length - started.length, explained.title), { timeout: 10000 });
          }
          break;
        }
      }
      if (started.length) {
        setRejected(null);
        if (started.length === parts.length && parts.length > 1) ToastQueue.neutral(EXPORT_COPY.eachStarted(parts.length), { timeout: 6000 });
        onStarted(started[0]!, tabOfKind(parts[0]!.settings.kind));
      }
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };

  return {
    busy,
    problem,
    rejected,
    submit,
    submitEach,
    dismiss: () => {
      setProblem(null);
      setRejected(null);
      setBatch(null);
    },
  };
}
