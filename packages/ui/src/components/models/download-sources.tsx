import { useState } from 'react';
import {
  ActionButton,
  AlertDialog,
  Button,
  DialogContainer,
  Disclosure,
  DisclosurePanel,
  DisclosureTitle,
  Picker,
  PickerItem,
  Radio,
  RadioGroup,
  Text,
  TextField,
} from '@react-spectrum/s2';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import Add from '@react-spectrum/s2/icons/Add';
import Delete from '@react-spectrum/s2/icons/Delete';
import Edit from '@react-spectrum/s2/icons/Edit';
import {
  DOWNLOAD_SOURCE_COPY as M,
  SOURCE_KINDS,
  addMirrorPatch,
  choosePatch,
  draftName,
  endpointKey,
  kindDesc,
  kindTitle,
  mirrorPlaceholder,
  mirrorProblem,
  mirrorsKey,
  removeMirrorPatch,
  sourceDesc,
  sourceNotes,
  sourceState,
  updateMirrorPatch,
  type DownloadSource,
  type MirrorDraft,
  type SourceKind,
  type SourcePatch,
  type SourceState,
} from '../../model/download-source.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useSetting } from '../../state/settings-store.ts';
import { useShell } from '../../state/shell-store.ts';
import { useSaveSettings, useSettingsReady } from '../settings/save-settings.ts';
import { SectionLink } from '../tools/tool-parts.tsx';
import { Card } from './model-parts.tsx';

/*
 * 下载来源（架构设计 §6.3「来源」、§12.9；设计稿 download-sources.jsx）：两种来源（模型仓库 / 工具与运行库）各存几个、各选一个在用。
 * - `SourcePicker`：一种来源的选择器，写在用的那个。下载确认框的每一组、本地模型页底部「下载与存储」用它。
 * - `SourceKindList`：设置 › 通用 › 下载来源与离线 里的一种来源：单选列表、镜像的编辑与删除、添加镜像。
 * 浏览器里只读：Web 白名单不含 `settings.set`，也不能下载本地模型；画出来（置灰）是为了看得见存着的来源。
 * 设计稿在设了环境变量时把选择锁住；Runtime 不告诉界面环境变量设没设，这里只在说明里提一句。
 */

/** 一种来源此刻的状态与改它的办法。 */
export function useDownloadSource(kind: SourceKind) {
  const web = useRuntime().host.platform === 'web';
  const ready = useSettingsReady();
  const save = useSaveSettings();
  const endpoint = useSetting(endpointKey(kind));
  const mirrors = useSetting(mirrorsKey(kind));
  const state = sourceState(kind, endpoint, mirrors);
  return { state, ready, web, off: web || !ready, save: (patch: SourcePatch, done?: string) => save(patch, done) };
}

const pickerItemHint = (s: DownloadSource) => (s.builtin ? s.hint : s.base);

/** 一种来源的选择器：选了就改在用的那个（以后的下载也用它）。 */
export function SourcePicker({ kind, label = M.pickerLabel(kindTitle(kind)), isDisabled }: { kind: SourceKind; label?: string; isDisabled?: boolean }) {
  const { state, ready, off, save } = useDownloadSource(kind);
  const [busy, setBusy] = useState(false);
  const choose = async (id: string) => {
    const next = state.list.find((s) => s.id === id);
    if (!next || next.id === state.active.id) return;
    setBusy(true);
    await save(choosePatch(kind, next), M.changed(kindTitle(kind), next.name));
    setBusy(false);
  };
  return (
    <Picker
      aria-label={label}
      size="S"
      align="end"
      menuWidth={300}
      selectedKey={ready ? state.active.id : null}
      isDisabled={off || busy || isDisabled}
      onSelectionChange={(key) => {
        if (key !== null) void choose(String(key));
      }}>
      {state.list.map((s) => (
        <PickerItem key={s.id} id={s.id} textValue={s.name}>
          <Text slot="label">{s.name}</Text>
          <Text slot="description">{pickerItemHint(s)}</Text>
        </PickerItem>
      ))}
    </Picker>
  );
}

const kindBlock = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  paddingY: 16,
  borderTopWidth: 0,
  borderXWidth: 0,
  borderBottomWidth: { default: 1, ':last-child': 0 },
  borderStyle: 'solid',
  borderColor: 'gray-100',
});
const kindName = style({ font: 'ui', fontWeight: 'medium', color: 'gray-900' });
const kindText = style({ margin: 0, font: 'ui-sm', color: 'gray-600', overflowWrap: 'anywhere' });
const notesLine = style({ margin: 0, font: 'ui-xs', color: 'gray-600', overflowWrap: 'anywhere' });
/** 浏览器里为什么不能改：比说明深一档，与通用页置灰行的原因一样。 */
const webLine = style({ margin: 0, font: 'ui-sm', color: 'gray-800', overflowWrap: 'anywhere' });
const list = style({ display: 'flex', flexDirection: 'column', gap: 4 });
const sourceRow = style({ display: 'flex', alignItems: 'center', gap: 8, minHeight: 32 });
const sourceRadio = style({ flexShrink: 0 });
const sourceMeta = style({ flexGrow: 1, minWidth: 0, font: 'ui-xs', color: 'gray-600', overflowWrap: 'anywhere', userSelect: 'text' });
const sourceActions = style({ display: 'flex', gap: 4, flexShrink: 0 });
const form = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: 12,
  borderRadius: 'lg',
  backgroundColor: 'layer-1',
});
const formFields = style({ display: 'flex', flexWrap: 'wrap', alignItems: 'start', gap: 8 });
const nameField = style({ width: 180 });
const baseField = style({ flexGrow: 1, minWidth: 220 });
const formActions = style({ display: 'flex', justifyContent: 'end', gap: 8 });

/** 添加 / 编辑镜像的小表单：名字可不填（显示主机名），基址按合同的规则校验，和已有的（含内置的）不能重复。 */
function MirrorForm({
  kind,
  state,
  editing,
  busy,
  onCancel,
  onSave,
}: {
  kind: SourceKind;
  state: SourceState;
  editing: DownloadSource | null;
  busy: boolean;
  onCancel: () => void;
  onSave: (draft: MirrorDraft) => void;
}) {
  const [name, setName] = useState(editing?.mirrorName ?? '');
  const [base, setBase] = useState(editing?.base ?? '');
  const draft = { name, base };
  const problem = mirrorProblem(state, draft, editing);
  // 还没填地址时不先报错；名字太长照报。
  const shown = base.trim() || name.trim() ? problem : null;
  const baseProblem = shown && base.trim() ? shown : null;
  return (
    <div className={form} role="group" aria-label={editing ? M.editAria(editing.name) : M.addMirror}>
      <div className={formFields}>
        <TextField aria-label={M.nameLabel} size="S" placeholder={M.nameLabel} value={name} onChange={setName} styles={nameField} />
        <TextField
          aria-label={M.baseLabel}
          size="S"
          placeholder={mirrorPlaceholder(kind)}
          value={base}
          onChange={setBase}
          isInvalid={baseProblem !== null}
          errorMessage={baseProblem ?? undefined}
          styles={baseField}
        />
      </div>
      <div className={formActions}>
        <Button variant="secondary" size="S" onPress={onCancel}>
          {M.cancel}
        </Button>
        <Button variant="accent" size="S" isPending={busy} isDisabled={problem !== null} onPress={() => onSave(draft)}>
          {editing ? M.save : M.addAndUse}
        </Button>
      </div>
    </div>
  );
}

type FormState = { mode: 'add' } | { mode: 'edit'; source: DownloadSource } | null;

/** 一种来源（设计稿 `SourceKind`）：标题与说明、单选列表（镜像带编辑 / 删除）、补充说明、添加镜像。 */
export function SourceKindList({ kind }: { kind: SourceKind }) {
  const { state, ready, web, off, save } = useDownloadSource(kind);
  const [formState, setForm] = useState<FormState>(null);
  const [removing, setRemoving] = useState<DownloadSource | null>(null);
  const [busy, setBusy] = useState(false);
  const title = kindTitle(kind);
  const run = async (patch: SourcePatch, done: string, after?: () => void) => {
    setBusy(true);
    const ok = await save(patch, done);
    setBusy(false);
    if (ok) after?.();
  };
  const pick = (id: string) => {
    const next = state.list.find((s) => s.id === id);
    if (next && next.id !== state.active.id) void run(choosePatch(kind, next), M.changed(title, next.name));
  };
  const add = (draft: MirrorDraft) => void run(addMirrorPatch(kind, state, draft), M.added(draftName(draft)), () => setForm(null));
  const update = (target: DownloadSource, draft: MirrorDraft) =>
    void run(updateMirrorPatch(kind, state, target, draft), M.updated(draftName(draft)), () => setForm(null));
  const remove = (target: DownloadSource) => {
    const { patch, fellBack } = removeMirrorPatch(kind, state, target);
    void run(patch, fellBack ? M.fellBack(target.name, fellBack) : M.removed(target.name), () => {
      if (formState?.mode === 'edit' && formState.source.id === target.id) setForm(null);
    });
  };
  const disabled = off || busy;
  return (
    <div className={kindBlock}>
      <div className={kindName}>{title}</div>
      <p className={kindText}>{kindDesc(kind)}</p>
      {web ? <p className={webLine}>{M.webNote}</p> : null}
      <RadioGroup
        aria-label={M.pickerLabel(title)}
        size="S"
        value={ready ? state.active.id : null}
        isDisabled={disabled}
        onChange={pick}>
        <div className={list}>
          {state.list.map((s) => (
            <div key={s.id} className={sourceRow}>
              <Radio value={s.id} styles={sourceRadio}>
                {s.name}
              </Radio>
              <span className={sourceMeta}>{s.builtin ? s.hint : s.base}</span>
              {!s.builtin ? (
                <span className={sourceActions}>
                  <ActionButton size="S" isQuiet aria-label={M.editAria(s.name)} isDisabled={disabled} onPress={() => setForm({ mode: 'edit', source: s })}>
                    <Edit />
                  </ActionButton>
                  <ActionButton size="S" isQuiet aria-label={M.removeAria(s.name)} isDisabled={disabled} onPress={() => setRemoving(s)}>
                    <Delete />
                  </ActionButton>
                </span>
              ) : null}
            </div>
          ))}
        </div>
      </RadioGroup>
      {ready ? <p className={notesLine}>{[sourceDesc(kind, state.active), ...sourceNotes(kind, state.active)].join(' ')}</p> : null}
      {formState ? (
        <MirrorForm
          key={formState.mode === 'edit' ? formState.source.id : 'add'}
          kind={kind}
          state={state}
          editing={formState.mode === 'edit' ? formState.source : null}
          busy={busy}
          onCancel={() => setForm(null)}
          onSave={(draft) => (formState.mode === 'edit' ? update(formState.source, draft) : add(draft))}
        />
      ) : (
        <div>
          <Button variant="secondary" size="S" isDisabled={disabled} onPress={() => setForm({ mode: 'add' })}>
            <Add />
            <Text>{M.addMirror}</Text>
          </Button>
        </div>
      )}
      <DialogContainer onDismiss={() => setRemoving(null)}>
        {removing ? (
          <AlertDialog
            variant="destructive"
            title={M.removeTitle(removing.name)}
            primaryActionLabel={M.removeMirror}
            cancelLabel={M.cancel}
            onPrimaryAction={() => remove(removing)}>
            {removing.id === state.active.id ? M.removeActiveBody(title, state.list[0]!.name) : M.removeBody}
          </AlertDialog>
        ) : null}
      </DialogContainer>
    </div>
  );
}

const pickerRow = style({ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 12, paddingY: 12 });
const pickerText = style({ flexGrow: 1, flexBasis: 0, minWidth: 200 });
const pickerName = style({ font: 'ui', fontWeight: 'medium', color: 'gray-900' });
const pickerDesc = style({ marginTop: 4, font: 'ui-sm', color: 'gray-600', overflowWrap: 'anywhere' });
const foldNote = style({ margin: 0, paddingBottom: 12, font: 'ui-xs', color: 'gray-600', overflowWrap: 'anywhere' });
const fold = style({ marginTop: 24 });
const foldSummary = style({ marginStart: 8, font: 'ui-sm', fontWeight: 'normal', color: 'gray-600' });

/** 本地模型页底部的「下载与存储」折叠区（设计稿 settings-local.jsx `SourceRows`）：标题旁写模型从哪里下载，展开是两种来源的选择器。 */
export function DownloadSourcesFold() {
  const models = useDownloadSource('models');
  const web = useRuntime().host.platform === 'web';
  const go = useShell((s) => s.go);
  const [open, setOpen] = useState(false);
  return (
    <Disclosure isQuiet size="S" styles={fold} isExpanded={open} onExpandedChange={setOpen}>
      <DisclosureTitle>
        {M.fold}
        {models.ready ? <span className={foldSummary}>{models.state.active.name}</span> : null}
      </DisclosureTitle>
      <DisclosurePanel>
        <Card label={M.label}>
          {SOURCE_KINDS.map((kind) => (
            <div key={kind} className={pickerRow}>
              <div className={pickerText}>
                <div className={pickerName}>{kindTitle(kind)}</div>
                <div className={pickerDesc}>{kindDesc(kind)}</div>
              </div>
              <SourcePicker kind={kind} />
            </div>
          ))}
          <p className={foldNote}>
            {web ? M.webNote : M.switchNote}{' '}
            {web ? null : <SectionLink onPress={() => go({ tab: 'settings', section: 'general' })}>{M.manage}</SectionLink>}
          </p>
        </Card>
      </DisclosurePanel>
    </Disclosure>
  );
}
