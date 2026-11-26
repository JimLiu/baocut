import { useState } from 'react';
import { webExportDownloadPath, type JobRecord } from '@baocut/protocol';
import { Button } from '@react-spectrum/s2';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { exportOutputs } from '../../model/export-job.ts';
import { copyToClipboard } from '../editor/transcript-actions.ts';
import { EXPORT_COPY } from './export-copy.ts';
import { Actions } from './export-parts.tsx';

/** 审片页导出的完成态（产品设计 §5.12）：路径、复制路径、下载（经 Web 服务的 `webExportDownloadPath`）。 */

const pathBox = style({ marginTop: 12, padding: 8, borderRadius: 'default', backgroundColor: 'gray-100', font: 'code-xs', color: 'gray-800', overflowWrap: 'anywhere' });

/** 让浏览器下载这条导出的第 `index` 个文件（Web 服务给附件）。 */
export function downloadExport(job: Pick<JobRecord, 'jobId'>, index = 0): void {
  const a = document.createElement('a');
  a.href = webExportDownloadPath(job.jobId, index);
  a.download = '';
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
}

/** 完成态在审片页的按钮：复制路径、下载、完成（没有「在文件夹中显示」）。 */
export function ReviewDoneActions({ job, onClose }: { job: JobRecord; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const path = exportOutputs(job)[0]?.path ?? null;
  return (
    <>
      {path ? <div className={pathBox}>{path}</div> : null}
      <Actions>
        {path ? (
          <Button
            variant="secondary"
            onPress={async () => {
              if (!(await copyToClipboard(path, null))) return;
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}>
            {copied ? EXPORT_COPY.pathCopied : EXPORT_COPY.copyPath}
          </Button>
        ) : null}
        {path ? (
          <Button variant="secondary" onPress={() => downloadExport(job)}>
            {EXPORT_COPY.download}
          </Button>
        ) : null}
        <Button variant="accent" onPress={onClose}>
          {EXPORT_COPY.done}
        </Button>
      </Actions>
    </>
  );
}
