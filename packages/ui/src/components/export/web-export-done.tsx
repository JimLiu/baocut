import { useState } from 'react';
import { webExportDownloadPath, type JobRecord } from '@baocut/protocol';
import { Button } from '@react-spectrum/s2';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { exportDir, exportOutputs } from '../../model/export-job.ts';
import { copyToClipboard } from '../editor/transcript-actions.ts';
import { EXPORT_COPY } from './export-copy.ts';
import { Actions } from './export-parts.tsx';

/**
 * 浏览器里导出的完成态（产品设计 §8.3、§5.12）：浏览器打不开本机的文件夹，所以没有「在文件夹中显示」，
 * 给路径、「复制路径」与「下载」（经 Web 服务的 `webExportDownloadPath`）。审片页与完整的 Web 会话共用。
 */

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

/**
 * 完成态的按钮：一个文件时是它的路径、复制路径、下载；几个文件时每个文件在清单里各有「下载」，这里给所在文件夹的路径。
 * `onReset` 给了才有「再导一份」（审片页没有：它只导这一种成片）。
 */
export function WebDoneActions({ job, onReset, onClose }: { job: JobRecord; onReset?: () => void; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const outputs = exportOutputs(job);
  const single = outputs.length === 1 ? outputs[0]!.path : null;
  const path = single ?? exportDir(job);
  return (
    <>
      {path ? <div className={pathBox}>{path}</div> : null}
      <Actions>
        {onReset ? (
          <Button variant="secondary" fillStyle="outline" onPress={onReset}>
            {EXPORT_COPY.again}
          </Button>
        ) : null}
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
        {single ? (
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
