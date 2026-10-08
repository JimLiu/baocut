import { useState } from 'react';
import { Button, Disclosure, DisclosurePanel, DisclosureTitle, ProgressBar, Switch } from '@react-spectrum/s2';
import Download from '@react-spectrum/s2/icons/Download';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import type { ModelBundleStatus, TranscribeModelInfo } from '@baocut/protocol';
import { inlineInstallMode } from '../../model/models-install.ts';
import { fmtSize } from '../../model/task-facts.ts';
import {
  speakerCopy,
  speakerGateLine,
  speakerPackFacts,
  speakerPackId,
  speakerPackInstalled,
  speakerSwitch,
  type SpeakerPackFacts,
  type SpeakerSwitch,
} from '../../model/transcribe-speakers.ts';
import { useModels } from '../../state/models-store.ts';
import { InstallDialog } from '../models/install-dialog.tsx';
import { detail } from './tool-parts.tsx';
import { TRANSCRIBE_TOOL_COPY } from './tools-copy.ts';

/*
 * 语音模型下面的「更多选项」：识别说话人（设计稿 tool-transcribe.jsx `AsrMoreOptions`、tools.css `.asrmore`）。转录工具页与
 * 重新转录共用。默认收起，标题带当前状态，收起时也看得见为什么开始不了。拨开了又没装「说话人区分」时就地给下载（走模型页
 * 同一个安装对话框），下完就开着。
 */

const subtitle = style({ marginStart: 8, font: 'ui-sm', fontWeight: 'normal', color: 'gray-600' });
const body = style({ display: 'flex', flexDirection: 'column', alignItems: 'start', gap: 4 });
const gate = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  alignSelf: 'stretch',
  marginTop: 4,
  paddingY: 8,
  paddingX: 12,
  borderRadius: 'default',
  backgroundColor: 'orange-100',
  font: 'ui-xs',
  color: 'orange-1000',
});
const gateText = style({ flexGrow: 1, minWidth: 0 });
const bar = style({ width: 120 });

export interface SpeakerState {
  s: SpeakerSwitch;
  pack: ModelBundleStatus | null;
  facts: SpeakerPackFacts;
  /** 就地下载说话人模型走下载还是补齐（`inlineInstallMode`）。 */
  mode: 'install' | 'complete';
}

/** 这只语音模型的「识别说话人」此刻的样子：`pick` 是用户亲手拨的值（null 为没拨过）。 */
export function useSpeakerState(info: TranscribeModelInfo | null | undefined, pick: boolean | null): SpeakerState {
  const bundles = useModels((s) => s.bundles);
  const id = speakerPackId(info);
  const pack = id ? (bundles.find((b) => b.bundleId === id) ?? null) : null;
  return {
    s: speakerSwitch(info, pick, speakerPackInstalled(info, pack)),
    pack,
    facts: speakerPackFacts(pack, fmtSize),
    mode: pack ? inlineInstallMode(pack, bundles) : 'install',
  };
}

export function AsrMoreOptions({ state, name, onPick }: { state: SpeakerState; name: string; onPick: (on: boolean) => void }) {
  const { s, pack, facts } = state;
  // 打开对话框时定下下载还是补齐，下载中不换计划。
  const [installing, setInstalling] = useState<'install' | 'complete' | null>(null);
  const copy = speakerCopy(s, name, facts);
  const install = pack?.install;
  const running = !!install && install.state !== 'paused';
  const pct = running
    ? install.totalBytes
      ? Math.min(100, Math.floor((install.receivedBytes / install.totalBytes) * 100))
      : null
    : undefined;
  return (
    <>
      <Disclosure isQuiet size="S">
        <DisclosureTitle>
          {TRANSCRIBE_TOOL_COPY.more}
          <span className={subtitle}>{copy.summary}</span>
        </DisclosureTitle>
        <DisclosurePanel>
          <div className={body}>
            <Switch size="S" isSelected={s.on} isDisabled={s.locked} onChange={onPick}>
              {TRANSCRIBE_TOOL_COPY.speakers}
            </Switch>
            <span className={detail}>{copy.note}</span>
            {s.missing ? (
              <div className={gate} role={running ? 'status' : undefined}>
                <span className={gateText}>{speakerGateLine(facts, pct)}</span>
                {running ? (
                  <ProgressBar
                    size="S"
                    styles={bar}
                    aria-label={speakerGateLine(facts, pct)}
                    isIndeterminate={pct === null}
                    value={pct ?? undefined}
                  />
                ) : pack ? (
                  <Button variant="secondary" size="S" onPress={() => setInstalling(state.mode)}>
                    <Download />
                    {install?.state === 'paused' ? TRANSCRIBE_TOOL_COPY.resumePack : TRANSCRIBE_TOOL_COPY.downloadPack}
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
        </DisclosurePanel>
      </Disclosure>
      {installing && pack ? (
        <InstallDialog
          bundleId={pack.bundleId}
          name={facts.name}
          license={pack.license ?? null}
          mode={installing}
          onClose={() => setInstalling(null)}
        />
      ) : null}
    </>
  );
}
