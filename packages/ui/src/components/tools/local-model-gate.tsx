import { useState } from 'react';
import { Button } from '@react-spectrum/s2';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { localNotDownloaded } from '../../model/tools-image.ts';
import type { ToolModelOption } from '../../model/tools-models.ts';
import { useModels } from '../../state/models-store.ts';
import { useShell } from '../../state/shell-store.ts';
import { InstallDialog } from '../models/install-dialog.tsx';
import { IMAGE_LOCAL_COPY } from '../models/models-copy.ts';
import { Gate, SectionLink } from './tool-parts.tsx';
import { GATE_COPY } from './tools-copy.ts';

/*
 * 选中的本机模型还不能用时的门卡（设计稿 image-gen.jsx `EngineGate` 的本机分支）：没下载的给「下载…」（走设置页同一个
 * 安装对话框，先看大小与许可）、下载中写进度；这个平台或构建跑不了的只给「换用可用的云端模型」。都带「管理本地模型…」。
 */

const progress = style({ font: 'ui-sm', color: 'gray-800' });

export function LocalModelGate<M>({
  selected,
  options,
  onSwitch,
}: {
  selected: ToolModelOption<M> | null;
  options: readonly ToolModelOption<M>[];
  onSwitch: (option: ToolModelOption<M>) => void;
}) {
  const go = useShell((s) => s.go);
  const bundles = useModels((s) => s.bundles);
  const [installing, setInstalling] = useState(false);
  if (!selected || selected.usable || !selected.local) return null;

  // 回落只落到云端（设计稿 `preferred`）。
  const alt = options.find((o) => o.usable && !o.local);
  const switchButton = alt ? (
    <Button variant="secondary" size="S" onPress={() => onSwitch(alt)}>
      {GATE_COPY.switchTo(`${alt.provider} · ${alt.modelId}`)}
    </Button>
  ) : null;
  const manage = <SectionLink onPress={() => go({ tab: 'models', category: 'image', page: 'local' })}>{GATE_COPY.manageLocal}</SectionLink>;
  const bundle = bundles.find((b) => b.bundleId === selected.modelId) ?? null;

  if (selected.why !== localNotDownloaded() || !bundle) {
    return (
      <Gate
        title={GATE_COPY.localUnavailable(selected.label)}
        body={GATE_COPY.localUnavailableBody(selected.why ?? '')}
        actions={
          <>
            {switchButton}
            {manage}
          </>
        }
      />
    );
  }

  const install = bundle.install;
  const running = install && install.state !== 'paused';
  const pct = install?.totalBytes ? Math.min(100, Math.floor((install.receivedBytes / install.totalBytes) * 100)) : null;
  return (
    <>
      <Gate
        title={GATE_COPY.download(selected.label)}
        body={install?.state === 'paused' ? GATE_COPY.downloadBodyPaused : GATE_COPY.downloadBody}
        actions={
          <>
            {running ? (
              <span className={progress} role="status">
                {GATE_COPY.downloading(pct)}
              </span>
            ) : (
              <Button variant="accent" size="S" onPress={() => setInstalling(true)}>
                {install?.state === 'paused' ? GATE_COPY.resume : GATE_COPY.downloadButton}
              </Button>
            )}
            {switchButton}
            {manage}
          </>
        }
      />
      {installing ? (
        <InstallDialog
          bundleId={bundle.bundleId}
          name={selected.label}
          license={bundle.license ?? null}
          licenseUse={IMAGE_LOCAL_COPY.licenseUse}
          mode="install"
          onClose={() => setInstalling(false)}
        />
      ) : null}
    </>
  );
}
