import { useState, type ReactNode } from 'react';
import type { ModelBundleStatus } from '@baocut/protocol';
import { Button, ProgressBar, Text } from '@react-spectrum/s2';
import Download from '@react-spectrum/s2/icons/Download';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { downloadView } from '../../model/models-install.ts';
import type { ModelCategory } from '../../model/settings-nav.ts';
import { localNotDownloaded } from '../../model/tools-image.ts';
import type { ToolModelOption } from '../../model/tools-models.ts';
import { useModels } from '../../state/models-store.ts';
import { useShell } from '../../state/shell-store.ts';
import { InstallDialog } from '../models/install-dialog.tsx';
import { IMAGE_LOCAL_COPY } from '../models/models-copy.ts';
import { Gate, SectionLink } from './tool-parts.tsx';
import { GATE_COPY } from './tools-copy.ts';

/*
 * 选中的本机模型还不能用时的门卡（设计稿 image-gen.jsx `EngineGate` 的本机分支、panel-tts.jsx `TtsModelGate`）：没下载的给
 * 「下载 {大小}」（走设置页同一个安装对话框，先看大小与许可）、下载中给进度条；这个平台或构建跑不了的只给「换用可用的云端模型」。
 * 都带「管理本地模型…」。
 */

const progress = style({ display: 'flex', alignItems: 'center', gap: 8, font: 'ui-sm', color: 'gray-800' });
const progressBar = style({ width: 120 });

/**
 * 本机模型包的就地下载卡：标题「先下载 X · 大小」，没在下时给下载（停在一半时给继续下载），在下时给进度。`extra` 是调用方再塞的按钮
 * （换用别的模型），`category` 决定「管理本地模型…」去设置的哪一类。装好后调用方不再渲染它。
 */
export function LocalDownloadGate({
  bundle,
  name,
  category,
  body,
  licenseUse,
  extra,
}: {
  bundle: ModelBundleStatus;
  name: string;
  category: ModelCategory;
  body: (paused: boolean) => string;
  /** 不许商用时安装对话框里那一句（默认语音合成的说法）。 */
  licenseUse?: string;
  extra?: ReactNode;
}) {
  const go = useShell((s) => s.go);
  const [installing, setInstalling] = useState(false);
  const view = downloadView(bundle);
  const label = view.state === 'running' ? GATE_COPY.downloading(view.percent) : null;
  return (
    <>
      <Gate
        title={view.size ? `${GATE_COPY.download(name)} · ${view.size}` : GATE_COPY.download(name)}
        body={body(view.state === 'paused')}
        actions={
          <>
            {label ? (
              <span className={progress} role="status">
                <ProgressBar
                  size="S"
                  aria-label={label}
                  isIndeterminate={view.percent === null}
                  {...(view.percent === null ? {} : { value: view.percent })}
                  styles={progressBar}
                />
                {label}
              </span>
            ) : (
              <Button variant="accent" size="S" onPress={() => setInstalling(true)}>
                <Download />
                <Text>
                  {view.state === 'paused' ? GATE_COPY.resume : view.size ? GATE_COPY.downloadSize(view.size) : GATE_COPY.downloadButton}
                </Text>
              </Button>
            )}
            {extra}
            <SectionLink onPress={() => go({ tab: 'models', category, page: 'local' })}>{GATE_COPY.manageLocal}</SectionLink>
          </>
        }
      />
      {installing ? (
        <InstallDialog
          bundleId={bundle.bundleId}
          name={name}
          license={bundle.license ?? null}
          {...(licenseUse ? { licenseUse } : {})}
          mode="install"
          onClose={() => setInstalling(false)}
        />
      ) : null}
    </>
  );
}

/** 生图（工具页与编辑器的生图面板）选中的本机模型的门卡；回落只落到云端（设计稿 `preferred`）。 */
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
  if (!selected || selected.usable || !selected.local) return null;

  const alt = options.find((o) => o.usable && !o.local);
  const switchButton = alt ? (
    <Button variant="secondary" size="S" onPress={() => onSwitch(alt)}>
      {GATE_COPY.switchTo(`${alt.provider} · ${alt.modelId}`)}
    </Button>
  ) : null;
  const bundle = bundles.find((b) => b.bundleId === selected.modelId) ?? null;

  if (selected.why !== localNotDownloaded() || !bundle) {
    return (
      <Gate
        title={GATE_COPY.localUnavailable(selected.label)}
        body={GATE_COPY.localUnavailableBody(selected.why ?? '')}
        actions={
          <>
            {switchButton}
            <SectionLink onPress={() => go({ tab: 'models', category: 'image', page: 'local' })}>{GATE_COPY.manageLocal}</SectionLink>
          </>
        }
      />
    );
  }

  return (
    <LocalDownloadGate
      bundle={bundle}
      name={selected.label}
      category="image"
      body={(paused) => (paused ? GATE_COPY.downloadBodyPaused : GATE_COPY.downloadBody)}
      licenseUse={IMAGE_LOCAL_COPY.licenseUse}
      extra={switchButton}
    />
  );
}
