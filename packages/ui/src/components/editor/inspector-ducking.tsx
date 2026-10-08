import type { AudioItem, VideoItem } from '@baocut/protocol';
import { ActionButton, Disclosure, DisclosurePanel, DisclosureTitle, Picker, PickerItem } from '@react-spectrum/s2';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import {
  DUCK_LIMITS,
  changeOperation,
  disableOperations,
  duckingRuleFor,
  enableOperations,
  isDefault,
  isOwnRule,
  resetOperation,
  ruleValues,
  singleTrigger,
  triggerOptions,
} from '../../model/ducking-panel.ts';
import { Note, PRow, SwitchCard, ValueRow } from './inspector-controls.tsx';
import type { ItemPageProps } from './inspector-sections.tsx';
import { INSPECTOR_COPY as IC } from './inspector-copy.ts';

const grow = style({ flexGrow: 1, minWidth: 0 });
const footer = style({ display: 'flex', alignItems: 'center', gap: 8, font: 'ui-xs', color: 'gray-600' });
const footerText = style({ flexGrow: 1 });

/**
 * 压低原声（视频格式规范 §3.9 的闪避）：选中的片段在另一条轨道发声时自动压低。规则存在序列上，压低多少、压下与回升
 * 的快慢都在这一张卡里；改动松手即提交。预览与导出用同一份增益包络（帧计划算好的增益）。
 */
export function DuckingCard({ item, sequence, edit, canChange }: ItemPageProps<AudioItem | VideoItem>) {
  const rule = duckingRuleFor(sequence, item);
  const options = triggerOptions(sequence, item);
  const on = !!rule?.enabled;
  const trigger = rule ? singleTrigger(rule) : null;
  // 规则跟着的轨道已经没有发声的片段（或被删掉）时，也列出来，否则选择框是空的。
  const listed = trigger && !options.some((o) => o.key === trigger) ? [...options, { key: trigger, label: IC.silentTrack }] : options;
  const values = rule ? ruleValues(rule) : null;
  const shared = !!rule && !isOwnRule(rule, item);
  const change = (patch: Parameters<typeof changeOperation>[2]) => rule && edit.commit([changeOperation(sequence, rule, patch)]);
  return (
    <>
      <SwitchCard
        title={IC.ducking}
        isOn={on}
        isDisabled={!canChange || (!rule && !options.length)}
        onToggle={(next) => {
          const operations = next ? enableOperations(sequence, item, options[0]?.key ?? '') : disableOperations(sequence, item);
          if (operations.length) edit.commit(operations);
        }}>
        {rule && values ? (
          <>
            <PRow label={IC.duckUnder}>
              <Picker
                aria-label={IC.duckUnderTrack}
                size="S"
                styles={grow}
                placeholder={IC.duckSeveral}
                selectedKey={trigger}
                isDisabled={!canChange || !listed.length}
                onSelectionChange={(key) => key !== null && key !== trigger && change({ trigger: String(key) })}>
                {listed.map((option) => (
                  <PickerItem key={option.key} id={option.key}>
                    {option.label}
                  </PickerItem>
                ))}
              </Picker>
            </PRow>
            {trigger === null ? (
              <Note>
                {rule.trigger.kind === 'speech'
                  ? IC.duckSpeech
                  : IC.duckItems}
              </Note>
            ) : null}
            <ValueRow
              label={IC.duckDepth}
              value={values.depth}
              {...DUCK_LIMITS.depth}
              unit="dB"
              isDisabled={!canChange}
              onCommit={(depth) => change({ depth })}
            />
            <Disclosure isQuiet size="S">
              <DisclosureTitle>{IC.advanced}</DisclosureTitle>
              <DisclosurePanel>
                <ValueRow
                  label={IC.attack}
                  value={values.attack}
                  {...DUCK_LIMITS.attack}
                  step={0.01}
                  digits={2}
                  unit={IC.seconds}
                  isDisabled={!canChange}
                  onCommit={(attack) => change({ attack })}
                />
                <ValueRow
                  label={IC.release}
                  value={values.release}
                  {...DUCK_LIMITS.release}
                  step={0.05}
                  digits={2}
                  unit={IC.seconds}
                  isDisabled={!canChange}
                  onCommit={(release) => change({ release })}
                />
              </DisclosurePanel>
            </Disclosure>
            <div className={footer}>
              <span className={footerText}>{isDefault(rule) ? IC.usingDefaults : IC.usingYours}</span>
              {!isDefault(rule) ? (
                <ActionButton isQuiet size="S" isDisabled={!canChange} onPress={() => edit.commit([resetOperation(sequence, rule)])}>
                  {IC.restoreDefaults}
                </ActionButton>
              ) : null}
            </div>
            {shared ? <Note>{IC.duckShared}</Note> : null}
          </>
        ) : null}
      </SwitchCard>
      {!rule && !options.length ? <Note>{IC.duckNothing}</Note> : null}
    </>
  );
}
