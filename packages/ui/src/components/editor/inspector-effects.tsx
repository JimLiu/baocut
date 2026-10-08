import type { ReactNode } from 'react';
import type { Fx } from '@baocut/protocol';
import { ActionButton } from '@react-spectrum/s2';
import {
  COLOR_FIELDS,
  FX_LIMITS,
  effectColor,
  effectKindsFor,
  effectNumber,
  effectOn,
  hasKnownEffects,
  resetEffects,
  setEffectsOperation,
  toggleEffect,
  unknownKinds,
  withEffect,
  type EffectItem,
  type EffectKind,
} from '../../model/effects-panel.ts';
import { ColorField, Note, PRow, Sec, SecHead, SwitchCard, ValueRow } from './inspector-controls.tsx';
import type { ItemPageProps } from './inspector-sections.tsx';
import { INSPECTOR_COPY as IC } from './inspector-copy.ts';

function effectTitle(kind: EffectKind): string {
  const titles: Record<EffectKind, string> = {
    'color-adjust': IC.colorAdjust,
    'gaussian-blur': IC.blur,
    'drop-shadow': IC.dropShadow,
    stroke: IC.stroke,
  };
  return titles[kind];
}

/**
 * 效果（视频格式规范 §3.8 的 `fx`）：每张卡管 `fx` 里的几项，拖动只叠给预览，松手整份提交一次（`setEffects`）。
 * 长度是 540 短边下的像素。页上没有控件的字段原样留着，页上写明。
 */
export function EffectsSection({ item, sequence, edit, canChange }: ItemPageProps<EffectItem>) {
  const effects = item.fx;
  const kinds = effectKindsFor(item);
  const live = (next: Fx) => edit.live({ fx: Object.keys(next).length ? next : null });
  const commit = (next: Fx) => edit.commit([setEffectsOperation(sequence.id, item.id, next)]);
  // 开关与重置：先叠给预览（开关立刻翻过去），再提交。
  const apply = (next: Fx) => {
    live(next);
    commit(next);
  };
  const params = (kind: EffectKind, change: Record<string, unknown>) => withEffect(effects, kind, change);
  const row = (kind: EffectKind, key: string, scale = 1) => ({
    value: Math.round(effectNumber(effects, kind, key) * scale * 100) / 100,
    isDisabled: !canChange,
    onLive: (v: number) => live(params(kind, { [key]: v / scale })),
    onCommit: (v: number) => commit(params(kind, { [key]: v / scale })),
  });
  const color = (kind: 'drop-shadow' | 'stroke', label: string, fallback: string) => (
    <PRow label={IC.color}>
      <ColorField
        label={label}
        value={effectColor(effects, kind)}
        fallback={fallback}
        allowAlpha={false}
        isDisabled={!canChange}
        onLive={(hex) => live(params(kind, { color: hex }))}
        onCommit={(hex) => commit(params(kind, { color: hex }))}
      />
    </PRow>
  );
  const card = (kind: EffectKind, children: ReactNode) =>
    kinds.includes(kind) ? (
      <SwitchCard
        key={kind}
        title={effectTitle(kind)}
        isOn={effectOn(effects, kind)}
        isDisabled={!canChange}
        onToggle={(on) => apply(toggleEffect(effects, kind, on))}>
        {children}
      </SwitchCard>
    ) : null;
  const unknown = unknownKinds(effects);
  return (
    <>
      <SecHead
        action={
          hasKnownEffects(effects) ? (
            <ActionButton isQuiet size="S" isDisabled={!canChange} onPress={() => apply(resetEffects(effects))}>
              {IC.resetAll}
            </ActionButton>
          ) : null
        }>
        {IC.effects}
      </SecHead>
      <Sec>
        {card(
          'color-adjust',
          COLOR_FIELDS.map((field) => (
            <ValueRow key={field.key} label={field.label} min={field.min} max={field.max} unit={field.unit} {...row('color-adjust', field.key, field.scale)} />
          )),
        )}
        {card(
          'gaussian-blur',
          <ValueRow label={IC.radius} min={0} max={50} hardMax={FX_LIMITS.blur} step={0.5} digits={1} unit="px" {...row('gaussian-blur', 'radius')} />,
        )}
        {card(
          'drop-shadow',
          <>
            <ValueRow label={IC.offsetX} min={-200} max={200} unit="px" {...row('drop-shadow', 'offsetX')} />
            <ValueRow label={IC.offsetY} min={-200} max={200} unit="px" {...row('drop-shadow', 'offsetY')} />
            <ValueRow label={IC.blur} min={0} max={50} hardMax={FX_LIMITS.shadowBlur} step={0.5} digits={1} unit="px" {...row('drop-shadow', 'blur')} />
            {color('drop-shadow', IC.dropShadowColor, '#000000')}
            <ValueRow label={IC.opacity} min={0} max={FX_LIMITS.shadowOpacity * 100} unit="%" {...row('drop-shadow', 'opacity', 100)} />
          </>,
        )}
        {card(
          'stroke',
          <>
            <ValueRow label={IC.widthLabel} min={1} max={30} hardMax={FX_LIMITS.strokeWidth} step={0.5} digits={1} unit="px" {...row('stroke', 'width')} />
            {color('stroke', IC.strokeColor, '#FFFFFF')}
          </>,
        )}
        {kinds.includes('drop-shadow') ? (
          <Note>{IC.effectsNote}</Note>
        ) : null}
        {unknown.length ? (
          <Note>{IC.unknownEffects(unknown)}</Note>
        ) : null}
      </Sec>
    </>
  );
}
