import type { SpaceEntry } from '@baocut/protocol';
import { ActionButton, Menu, MenuItem, MenuTrigger, Text } from '@react-spectrum/s2';
import Refresh from '@react-spectrum/s2/icons/Refresh';
import Tools from '@react-spectrum/s2/icons/Tools';
import type { ToolId } from '../../model/tool-catalog.ts';
import { ENTRY_TOOL_COPY as COPY } from '../tools/tools-copy.ts';
import type { EntryTools } from '../tools/use-entry-tools.ts';

/*
 * Space 查看框里与工具有关的几样（产品设计 §4.5、§2.7「页面」；设计稿 space-viewer.jsx）：事实里写做出它的工具与所在位置，
 * 底栏有「用工具处理…」（进工具页时这个条目已经选好）与「再做一次」（回到参数已填好的工具页，视频工具打开那次运行）。
 */

/** 事实表里的「工具」「位置」两行；`term` / `value` 用查看框自己的样式。 */
export function ToolFacts({ tools, term, value }: { tools: EntryTools | null; term: string; value: string }) {
  if (!tools) return null;
  const { origin, location } = tools;
  return (
    <>
      {origin ? (
        <>
          <dt className={term}>{COPY.factTool}</dt>
          <dd className={value}>{origin.toolName}</dd>
        </>
      ) : null}
      {location && (origin || location.isSaveDir) ? (
        <>
          <dt className={term}>{COPY.factPlace}</dt>
          <dd className={value}>
            {location.label}
            {location.isSaveDir ? COPY.saveDir : ''}
          </dd>
        </>
      ) : null}
    </>
  );
}

/** 底栏的「用工具处理…」与「再做一次 / 重试」。按下先关掉查看框再去工具页。 */
export function ToolActions({ entry, tools, onClose }: { entry: SpaceEntry; tools: EntryTools | null; onClose: () => void }) {
  if (!tools) return null;
  const rerun = tools.origin?.rerun ?? null;
  const pick = (id: ToolId) => {
    onClose();
    tools.openTool(id);
  };
  return (
    <>
      {tools.tools.length ? (
        <MenuTrigger>
          <ActionButton isQuiet>
            <Tools />
            <Text>{COPY.menu}</Text>
          </ActionButton>
          <Menu aria-label={COPY.menuLabel(entry.name)} onAction={(key) => pick(String(key) as ToolId)}>
            {tools.tools.map((t) => (
              <MenuItem key={t.id} id={t.id} textValue={t.name}>
                <Text slot="label">{t.name}</Text>
              </MenuItem>
            ))}
          </Menu>
        </MenuTrigger>
      ) : null}
      {rerun ? (
        <ActionButton
          isQuiet
          aria-description={rerun.mode === 'refill' ? COPY.rerunHint : undefined}
          onPress={() => {
            onClose();
            tools.rerun();
          }}>
          <Refresh />
          <Text>{rerun.label}</Text>
        </ActionButton>
      ) : null}
    </>
  );
}
