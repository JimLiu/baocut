import { useMemo, useState, type Key } from 'react';
import type { ModelApiAlias, ModelApiRouting, OnlineCapability } from '@baocut/protocol';
import { ActionButton, AlertDialog, Button, DialogTrigger, Picker, PickerItem, Text, TextField, ToastQueue } from '@react-spectrum/s2';
import Add from '@react-spectrum/s2/icons/Add';
import Delete from '@react-spectrum/s2/icons/Delete';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { aliasNameError, aliasTargets, aliasView, API_CAPABILITIES, CAPABILITY_LABEL } from '../../model/services-api.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useModels } from '../../state/models-store.ts';
import { detail, detailXs, panel } from './service-card.tsx';
import { SectionHead } from './service-parts.tsx';
import { COMMON_COPY, MODEL_API_COPY } from './services-copy.ts';
import { toastFailure } from './use-service-actions.ts';

/*
 * 模型接口 › 别名（原型 designs/baocut/app/page-services-api-map.jsx `ApiModelMap`；架构设计 §4.8）。
 * Runtime 的别名是「一个名字 → 一种能力下的一个 Provider 与模型（或它的默认模型）」，原型是「一个名字 → 几只模型，每一类取第一只
 * 已下载的」。所以这里一行一个目标，没有目标 chip 的排序与多选；改目标就删掉再加。下面一行写这个名字此刻能不能用、为什么。
 * 「恢复预置」换回 Runtime 的预置（whisper-1 → 本机默认的转录模型）。
 */

/** Runtime 的预置别名（runtime-core DEFAULT_MODEL_API_ALIASES）。 */
const PRESET: ModelApiAlias = { alias: 'whisper-1', capability: 'transcribe', providerId: 'local', modelId: null };

const row = style({
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  paddingY: 8,
  borderTopWidth: 0,
  borderXWidth: 0,
  borderBottomWidth: 1,
  borderStyle: 'solid',
  borderColor: 'gray-100',
});
const nameCell = style({ flexShrink: 0, width: 160, font: 'code-sm', color: 'gray-900', overflowWrap: 'anywhere' });
const toCell = style({ display: 'flex', flexDirection: 'column', gap: 2, flexGrow: 1, minWidth: 0 });
const toLine = style({ font: 'ui-sm', color: 'gray-800', overflowWrap: 'anywhere' });
const why = style({ font: 'ui-xs', color: { default: 'gray-600', isBad: 'negative' } });
const add = style({ display: 'flex', alignItems: 'end', flexWrap: 'wrap', gap: 8, marginTop: 12 });
const nameField = style({ width: 160 });
const capField = style({ width: 120 });
const targetField = style({ flexGrow: 1, minWidth: 200 });
const foot = style({ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 });

export function ModelApiAliases({ aliases, routing, disabled }: { aliases: readonly ModelApiAlias[]; routing: ModelApiRouting; disabled: boolean }) {
  const runtime = useRuntime();
  const view = useModels((s) => s.capabilities);
  const remove = (alias: string) =>
    runtime
      .removeModelApiAlias(alias)
      .then(() => ToastQueue.neutral(MODEL_API_COPY.aliasRemoved(alias), { timeout: 3000 }))
      .catch(toastFailure);
  const reset = async () => {
    try {
      for (const a of aliases) if (a.alias !== PRESET.alias) await runtime.removeModelApiAlias(a.alias);
      await runtime.setModelApiAlias({ alias: PRESET.alias, capability: PRESET.capability, providerId: PRESET.providerId });
      ToastQueue.positive(MODEL_API_COPY.resetDone, { timeout: 3000 });
    } catch (error) {
      toastFailure(error);
    }
  };
  return (
    <>
      <SectionHead title={MODEL_API_COPY.aliasesTitle} />
      <section className={panel}>
        <p className={detail}>{MODEL_API_COPY.aliasesLede}</p>
        {aliases.length ? (
          aliases.map((a) => {
            const v = aliasView(a, view, routing);
            return (
              <div key={a.alias} className={row}>
                <code className={nameCell}>{a.alias}</code>
                <span className={toCell}>
                  <span className={toLine}>
                    {v.capability} → {v.target}
                  </span>
                  {v.why ? <span className={why({ isBad: true })}>{v.why}</span> : null}
                </span>
                <ActionButton isQuiet size="S" isDisabled={disabled} aria-label={MODEL_API_COPY.aliasRemove(a.alias)} onPress={() => void remove(a.alias)}>
                  <Delete />
                </ActionButton>
              </div>
            );
          })
        ) : (
          <p className={detailXs}>{MODEL_API_COPY.aliasesEmpty}</p>
        )}
        <AddAlias aliases={aliases} routing={routing} disabled={disabled} />
        <div className={foot}>
          <DialogTrigger>
            <Button variant="secondary" fillStyle="outline" size="S" isDisabled={disabled}>
              {MODEL_API_COPY.resetAliases}
            </Button>
            <AlertDialog
              variant="confirmation"
              title={MODEL_API_COPY.resetTitle}
              primaryActionLabel={MODEL_API_COPY.resetAliases}
              cancelLabel={COMMON_COPY.cancel}
              onPrimaryAction={() => void reset()}>
              {MODEL_API_COPY.resetBody}
            </AlertDialog>
          </DialogTrigger>
        </div>
      </section>
    </>
  );
}

function AddAlias({ aliases, routing, disabled }: { aliases: readonly ModelApiAlias[]; routing: ModelApiRouting; disabled: boolean }) {
  const runtime = useRuntime();
  const view = useModels((s) => s.capabilities);
  const [name, setName] = useState('');
  const [capability, setCapability] = useState<OnlineCapability>('transcribe');
  const [target, setTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);
  const options = useMemo(() => (view ? aliasTargets(view, capability, routing) : []), [view, capability, routing]);
  const chosen = options.find((o) => o.key === target) ?? null;
  const error = aliasNameError(name, aliases);
  const submit = () => {
    setTouched(true);
    if (error || !chosen || busy) return;
    setBusy(true);
    runtime
      .setModelApiAlias(
        chosen.modelId === null
          ? { alias: name.trim(), capability, providerId: chosen.providerId }
          : { alias: name.trim(), capability, providerId: chosen.providerId, modelId: chosen.modelId },
      )
      .then(() => {
        ToastQueue.positive(MODEL_API_COPY.aliasAdded(name.trim()), { timeout: 3000 });
        setName('');
        setTarget(null);
        setTouched(false);
      })
      .catch(toastFailure)
      .finally(() => setBusy(false));
  };
  return (
    <div className={add}>
      <TextField
        label={MODEL_API_COPY.aliasName}
        size="S"
        styles={nameField}
        placeholder="whisper-1"
        value={name}
        isDisabled={disabled}
        isInvalid={touched && !!error && name !== ''}
        errorMessage={error ?? undefined}
        onChange={setName}
      />
      <Picker
        label={MODEL_API_COPY.aliasCapability}
        size="S"
        styles={capField}
        isDisabled={disabled}
        selectedKey={capability}
        onSelectionChange={(key: Key | null) => {
          if (key === null) return;
          setCapability(key as OnlineCapability);
          setTarget(null);
        }}>
        {API_CAPABILITIES.map((c) => (
          <PickerItem key={c} id={c} textValue={CAPABILITY_LABEL[c]}>
            {CAPABILITY_LABEL[c]}
          </PickerItem>
        ))}
      </Picker>
      <Picker
        label={MODEL_API_COPY.aliasTarget}
        size="S"
        styles={targetField}
        isDisabled={disabled || !options.length}
        placeholder={options.length ? undefined : view ? MODEL_API_COPY.aliasNoTarget : MODEL_API_COPY.modelsLoading}
        selectedKey={target}
        onSelectionChange={(key: Key | null) => setTarget(key === null ? null : String(key))}>
        {options.map((o) => (
          <PickerItem key={o.key} id={o.key} textValue={o.label}>
            <Text slot="label">{o.label}</Text>
            {o.note ? <Text slot="description">{o.note}</Text> : null}
          </PickerItem>
        ))}
      </Picker>
      <Button variant="secondary" size="S" isDisabled={disabled || !name.trim() || !chosen} isPending={busy} onPress={submit}>
        <Add />
        <Text>{MODEL_API_COPY.aliasAdd}</Text>
      </Button>
    </div>
  );
}
