import type { ExportSettings, Id } from '@baocut/protocol';
import { Button } from '@react-spectrum/s2';
import type { ExportProblem } from '../../model/export-rejection.ts';
import { useExportPlaces } from '../../state/export-store.ts';
import { EXPORT_COPY } from './export-copy.ts';
import { ProblemAlert, usePickDir } from './export-parts.tsx';

/**
 * 被拒或失败之后界面能直接做的那一步（架构设计 §9.11 的拒绝码，Runtime export-service.ts 的 `details`）：
 * - 成片有画不出来的内容：`onUnsupported: 'skip'` 重提（每项记一条警告）；
 * - 便携包有读不到的素材：`missingAssets: 'skip'` 重提（清单里如实标缺失）；
 * - 位置写不进、同名、空间不够、保存失败：换个目录再导；
 * - 几份文档都能导：指定一份再导。
 */
export function RemedyButtons({
  problem,
  settings,
  videoId,
  busy,
  onSubmit,
}: {
  problem: ExportProblem;
  settings: ExportSettings;
  videoId: Id;
  busy: boolean;
  onSubmit: (settings: ExportSettings, dir?: string | null) => void;
}) {
  const pickDir = usePickDir();
  const setDir = useExportPlaces((s) => s.setDir);
  const remedy = problem.remedy;
  if (!remedy) return null;
  switch (remedy.kind) {
    case 'skip-unsupported':
      return settings.kind === 'video' ? (
        <Button variant="secondary" size="S" isPending={busy} onPress={() => onSubmit({ ...settings, onUnsupported: 'skip' as const })}>
          {EXPORT_COPY.skipUnsupported}
        </Button>
      ) : null;
    case 'skip-missing-assets':
      return settings.kind === 'portable' ? (
        <Button variant="secondary" size="S" isPending={busy} onPress={() => onSubmit({ ...settings, missingAssets: 'skip' as const })}>
          {EXPORT_COPY.skipMissing}
        </Button>
      ) : null;
    case 'pick-dir':
      return (
        <Button
          variant="secondary"
          size="S"
          isPending={busy}
          onPress={async () => {
            const dir = await pickDir();
            if (!dir) return;
            setDir(videoId, dir);
            onSubmit(settings, dir);
          }}>
          {EXPORT_COPY.pickDirAndRetry}
        </Button>
      );
    case 'choose-document':
      if (settings.kind !== 'subtitles' && settings.kind !== 'transcript') return null;
      return (
        <>
          {remedy.candidates.slice(0, 4).map((c) => (
            <Button key={c.documentId} variant="secondary" size="S" isPending={busy} onPress={() => onSubmit({ ...settings, documentId: c.documentId })}>
              {EXPORT_COPY.useDocument(c.language ? `${c.name} · ${c.language}` : c.name)}
            </Button>
          ))}
        </>
      );
  }
}

/** 提交被拒：原因加补救按钮。 */
export function RejectedAlert({
  problem,
  settings,
  videoId,
  busy,
  onSubmit,
}: {
  problem: ExportProblem | null;
  settings: ExportSettings | null;
  videoId: Id;
  busy: boolean;
  onSubmit: (settings: ExportSettings, dir?: string | null) => void;
}) {
  if (!problem) return null;
  return (
    <ProblemAlert
      problem={problem}
      actions={settings && problem.remedy ? <RemedyButtons problem={problem} settings={settings} videoId={videoId} busy={busy} onSubmit={onSubmit} /> : null}
    />
  );
}
