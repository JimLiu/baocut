import type { ReactNode } from 'react';
import { ActionButton, Button, Text, ToastQueue } from '@react-spectrum/s2';
import Folder from '@react-spectrum/s2/icons/Folder';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { modelWarning, noModelText, saveDirLabel } from '../../model/tool-frame.ts';
import type { ToolModelOption } from '../../model/tools-models.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useSetting } from '../../state/settings-store.ts';
import { ModelLine } from './tool-model.tsx';
import { detail, Section, SectionLink } from './tool-parts.tsx';
import { FRAME_COPY } from './tools-copy.ts';

/*
 * 工具页统一骨架的几行（产品设计 §2.7；设计稿 tool-frame.jsx `ToolModelRow`）：输入 → 模型 → 选项 → 保存位置 → 开始。
 * 「模型」一行列出这种能力已配置的本机与云端模型；没有能用的时这一行给「去设置」，主按钮旁写原因（`modelReason`），不整页挡住。
 * 「保存位置」一行（`ToolSaveDirRow`）写这次结果保存到哪，「更改…」只改这一次；写进已有视频的运行与 Web 服务（不给保存位置）没有这一行。
 */

const warnLine = style({ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, minWidth: 0 });
const warnText = style({ flexGrow: 1, flexBasis: 0, minWidth: 160, font: 'ui-sm', color: 'orange-900', margin: 0 });
const emptyText = style({ flexGrow: 1, flexBasis: 0, minWidth: 160, font: 'ui-sm', color: 'gray-700', margin: 0 });

/** 一句提醒加「去设置」。 */
function SettingsLine({ text, warn, onSettings }: { text: string; warn: boolean; onSettings: () => void }) {
  return (
    <div className={warnLine}>
      <p className={warn ? warnText : emptyText}>{text}</p>
      <Button variant="secondary" size="S" onPress={onSettings}>
        {FRAME_COPY.goSettings}
      </Button>
    </div>
  );
}

/**
 * 「模型」一行。`noun` 是这种模型的叫法（也是 Picker 的无障碍名）；`manage` 是右上角去模型页的那一句。`localGate` 为 true 时本机模型没装好的提醒
 * 由页面自己给（生成图片有就地的下载卡），这里不再重复。`children` 接在 Picker 下面（推理强度、下载卡……）。
 */
export function ModelRow<M>({
  title = FRAME_COPY.model,
  noun,
  manage,
  onSettings,
  options,
  selected,
  onSelect,
  factsOf,
  disableUnusable,
  localGate = false,
  local = true,
  children,
}: {
  /** 这一节的标题；一页有两只模型（翻译配音的文本模型与配音引擎）时各写各的。 */
  title?: string;
  noun: string;
  manage: string;
  onSettings: () => void;
  options: readonly ToolModelOption<M>[];
  selected: ToolModelOption<M> | null;
  onSelect: (option: ToolModelOption<M>) => void;
  factsOf: (option: ToolModelOption<M>) => string;
  disableUnusable?: boolean;
  localGate?: boolean;
  /** 这种能力有没有本机模型（空态那句据此说要不要「安装一个本机模型」）。 */
  local?: boolean;
  children?: ReactNode;
}) {
  const warning = localGate && selected?.local ? null : modelWarning(selected);
  return (
    <Section title={title} aside={<SectionLink onPress={onSettings}>{manage}</SectionLink>}>
      {options.length ? (
        <>
          <ModelLine label={noun} options={options} selected={selected} onSelect={onSelect} factsOf={factsOf} disableUnusable={disableUnusable} />
          {warning ? <SettingsLine text={warning} warn onSettings={onSettings} /> : null}
          {children}
        </>
      ) : (
        <SettingsLine text={noModelText(noun, local)} warn={false} onSettings={onSettings} />
      )}
    </Section>
  );
}

const saveLine = style({ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, minWidth: 0, '--iconPrimary': { type: 'fill', value: 'gray-700' } });
const saveText = style({ flexGrow: 1, flexBasis: 0, minWidth: 160, font: 'ui-sm', color: 'gray-900', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
const savePath = style({ font: 'code-xs', color: 'gray-900' });

/**
 * 保存位置一行（设计稿 tool-frame.jsx `ToolSaveDirRow`）：「保存到 …」、是不是设置里的默认、「更改…」（系统的选文件夹面板，
 * 只改这一次，不写回设置）与「改回默认」。`saveDirectory` 是 `tools.list` 给的保存位置；为 null（Web 服务不给）时不画。
 */
export function SaveDirRow({
  saveDirectory,
  override,
  onChange,
  note,
}: {
  saveDirectory: string | null;
  override: string | null;
  onChange: (dir: string | null) => void;
  /** 这一行下面那句的前半（缺省：结果作为 Space 条目出现……）。 */
  note?: string;
}) {
  const runtime = useRuntime();
  const setting = useSetting('downloads.directory');
  if (saveDirectory === null) return null;
  const dir = override?.trim() || saveDirectory;
  const pick = () => {
    runtime.host.pickDirectory({ title: FRAME_COPY.pickTitle }).then(
      (next) => {
        if (next) onChange(next);
      },
      (error: unknown) => ToastQueue.negative(FRAME_COPY.pickFailed(error instanceof Error ? error.message : String(error)), { timeout: 5000 }),
    );
  };
  return (
    <Section title={FRAME_COPY.saveTitle}>
      <div className={saveLine}>
        <Folder aria-hidden />
        <span className={saveText} title={dir}>
          {FRAME_COPY.saveTo}
          <span className={savePath}>{saveDirLabel(dir)}</span>
        </span>
        {override ? (
          <SectionLink onPress={() => onChange(null)}>{FRAME_COPY.backToDefault}</SectionLink>
        ) : (
          <span className={detail}>{setting ? FRAME_COPY.settingDir : FRAME_COPY.defaultDir}</span>
        )}
        <ActionButton isQuiet size="S" onPress={pick}>
          <Text>{FRAME_COPY.change}</Text>
        </ActionButton>
      </div>
      <span className={detail}>
        {FRAME_COPY.saveFoot(note ?? FRAME_COPY.saveNote, !!override)}
      </span>
    </Section>
  );
}
