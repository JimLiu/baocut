import { useState } from 'react';
import type { ModelInfoBase, OnlineCapability } from '@baocut/protocol';
import { Button, Header, Heading, Picker, PickerItem, PickerSection, Text, ToastQueue } from '@react-spectrum/s2';
import AddIcon from '@react-spectrum/s2/icons/Add';
import { capabilityCategory, categoryCapability, cloudDefaultPicker, cloudProviders, refreshAfterKey, type DefaultOption } from '../../model/models-cloud.ts';
import { probeFromJob, type ProbeState } from '../../model/models-probe.ts';
import type { ModelCategory } from '../../model/settings-nav.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useConnection } from '../../state/connection-store.ts';
import { useJobs } from '../../state/jobs-store.ts';
import { useModels } from '../../state/models-store.ts';
import { useShell } from '../../state/shell-store.ts';
import { CODEX_IMAGE_PROVIDER } from '../settings/codex-image.ts';
import { CodexImageCard, codexDefaultState, useCodexImage } from './codex-image-card.tsx';
import { chooseCloudDefault, refreshProvider, startProbe } from './model-actions.ts';
import { Card, Lede, PageStatus, SettingRow } from './model-parts.tsx';
import { CLOUD_COPY, MODELS_PAGE_COPY } from './models-copy.ts';
import { ProbeDialog } from './probe-dialog.tsx';
import { ProviderCard } from './provider-card.tsx';
import { AddModelDialog, CustomProviderDialog, KeyDialog } from './provider-dialogs.tsx';
import { TextParamRows } from './text-params.tsx';

/**
 * 模型 › 云端模型（设计稿 settings-cloud.jsx:220-342）：标题与说明、默认模型（文本生成多两行：推理强度、并发请求数）、
 * 服务商列表（图像档第一张是 Codex CLI），以及密钥、自建服务商、添加模型、测试四个对话框。用途档由左栏的能力分类决定；
 * 音源分离、画面理解只有本地页，深链到云端页时如实说没有。
 */
export function CloudModels({ category }: { category: ModelCategory }) {
  const capability = categoryCapability(category);
  if (!capability) return <PageStatus>{CLOUD_COPY.noCloud}</PageStatus>;
  return <CloudCapability key={capability} capability={capability} />;
}

type DialogState =
  | { kind: 'key'; providerId: string }
  | { kind: 'custom' }
  | { kind: 'model'; providerId: string; label: string; modelId?: string; capability: OnlineCapability }
  | { kind: 'probe'; providerId: string; modelId: string }
  | null;

const EMPTY_KEY = 'empty';
/** 分组的 id 与选项的 id 在同一个集合里，必须错开（分组 `none` 撞上「用本地模型」那一项的 `none` 会让整页崩掉）。 */
const sectionId = (key: string) => `section:${key}`;

/** 菜单的一项。直接返回 PickerItem（包一层组件的话 S2 的集合认不出它）。 */
function pickerOption(item: DefaultOption) {
  return (
    <PickerItem key={item.key} id={item.key} textValue={item.label}>
      <Text slot="label">{item.label}</Text>
      {item.description ? <Text slot="description">{item.description}</Text> : null}
    </PickerItem>
  );
}

function CloudCapability({ capability }: { capability: OnlineCapability }) {
  const runtime = useRuntime();
  const view = useModels((s) => s.capabilities);
  const connected = useConnection((s) => s.state.status === 'connected');
  const jobs = useJobs((s) => s.jobs);
  const replace = useShell((s) => s.replace);
  const codex = useCodexImage(capability === 'generateImage');
  const [dialog, setDialog] = useState<DialogState>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  // 这次打开页面以来的测试：模型 → 状态；在跑的从 `jobs` 主题读。
  const [runs, setRuns] = useState<Record<string, ProbeState>>({});
  const [busy, setBusy] = useState(false);
  // 正在刷新的那一家（设计稿一次只刷一家：刷新中各家的刷新与密钥按钮都等着）。
  const [refreshing, setRefreshing] = useState<string | null>(null);

  if (!view) return <PageStatus>{connected ? MODELS_PAGE_COPY.loading : MODELS_PAGE_COPY.offline}</PageStatus>;

  const cards = cloudProviders(view, capability);
  const codexState = capability === 'generateImage' ? codexDefaultState(codex) : null;
  const picker = cloudDefaultPicker(view, capability, codexState, {
    none: CLOUD_COPY.none[capability],
    noneDesc: CLOUD_COPY.noneDesc[capability],
    codex: CLOUD_COPY.codexItem,
    codexDesc: CLOUD_COPY.codexItemDesc,
    unavailable: CLOUD_COPY.unavailable,
    localDesc: CLOUD_COPY.localDefaultDesc,
  });
  const defaultRef = view[capability].default;

  const runKey = (providerId: string, modelId: string) => `${providerId}/${modelId}`;
  const liveState = (key: string): ProbeState | undefined => {
    const run = runs[key];
    return run?.status === 'running' ? probeFromJob(run.jobId, jobs.find((j) => j.jobId === run.jobId)) : run;
  };

  /** 换了用途的东西加好后跳到那一类的云端页（设计稿 `setKind`）。 */
  const showCapability = (next: OnlineCapability) => {
    if (next !== capability) replace({ tab: 'models', category: capabilityCategory(next), page: 'cloud' });
  };

  const choose = async (key: string) => {
    setBusy(true);
    try {
      await chooseCloudDefault(runtime, capability, key);
      ToastQueue.neutral(CLOUD_COPY.defaultSet, { timeout: 3000 });
    } catch (err) {
      ToastQueue.negative(CLOUD_COPY.defaultFailed((err as Error).message), { timeout: 5000 });
    } finally {
      setBusy(false);
    }
  };

  /** 卡头的「刷新」（设计稿 settings-cloud.jsx `refresh` / `refreshVoices`）：展开这家，结果经 `models` 主题回到说明行与模型行。 */
  const refresh = async (providerId: string) => {
    if (refreshing) return;
    setRefreshing(providerId);
    expand(providerId);
    try {
      await refreshProvider(runtime, providerId);
    } catch (err) {
      ToastQueue.negative(CLOUD_COPY.refreshFailed((err as Error).message), { timeout: 5000 });
    } finally {
      setRefreshing(null);
    }
  };

  const runProbe = async (providerId: string, model: ModelInfoBase, voice: string) => {
    const key = runKey(providerId, model.modelId);
    setRuns((old) => ({ ...old, [key]: { status: 'submitting' } }));
    try {
      const jobId = await startProbe(runtime, capability, providerId, model, voice);
      setRuns((old) => ({ ...old, [key]: { status: 'running', jobId } }));
    } catch (err) {
      setRuns((old) => ({ ...old, [key]: { status: 'failed', message: (err as Error).message } }));
    }
  };

  const toggle = (providerId: string) =>
    setExpanded((old) => {
      const next = new Set(old);
      if (!next.delete(providerId)) next.add(providerId);
      return next;
    });
  const expand = (providerId: string) => setExpanded((old) => new Set(old).add(providerId));

  const keyCard = dialog?.kind === 'key' ? cards.find((c) => c.providerId === dialog.providerId) : undefined;
  const probeCard = dialog?.kind === 'probe' ? cards.find((c) => c.providerId === dialog.providerId) : undefined;
  const probeModel = dialog?.kind === 'probe' ? probeCard?.models.find((m) => m.modelId === dialog.modelId) : undefined;

  return (
    <>
      <Lede first title={CLOUD_COPY.heading[capability]} desc={CLOUD_COPY.lede[capability]} />
      <Card label={CLOUD_COPY.defaultLabel[capability]}>
        <SettingRow label={CLOUD_COPY.defaultLabel[capability]} desc={CLOUD_COPY.defaultDesc[capability]}>
          <Picker
            aria-label={CLOUD_COPY.defaultLabel[capability]}
            size="S"
            align="end"
            menuWidth={300}
            selectedKey={picker.selectedKey}
            disabledKeys={[EMPTY_KEY]}
            isDisabled={busy || !connected}
            onSelectionChange={(key) => {
              if (key !== null && key !== picker.selectedKey && key !== EMPTY_KEY) void choose(String(key));
            }}>
            {picker.sections.map((section) =>
              section.title ? (
                <PickerSection key={section.key} id={sectionId(section.key)}>
                  <Header>
                    <Heading>{section.title}</Heading>
                  </Header>
                  {section.items.map(pickerOption)}
                </PickerSection>
              ) : (
                <PickerSection key={section.key} id={sectionId(section.key)} aria-label={section.items[0]?.label}>
                  {section.items.map(pickerOption)}
                </PickerSection>
              ),
            )}
            {picker.empty ? (
              <PickerSection id={sectionId('empty')} aria-label={CLOUD_COPY.pickerEmpty.other}>
                {pickerOption({ key: EMPTY_KEY, label: capability === 'generateImage' ? CLOUD_COPY.pickerEmpty.image : CLOUD_COPY.pickerEmpty.other })}
              </PickerSection>
            ) : null}
          </Picker>
        </SettingRow>
        {capability === 'generateText' ? <TextParamRows view={view} connected={connected} /> : null}
      </Card>

      <Lede
        title={CLOUD_COPY.providers}
        desc={CLOUD_COPY.providersDesc + CLOUD_COPY.providersExtra[capability]}
        action={
          <Button variant="secondary" size="S" isDisabled={!connected} onPress={() => setDialog({ kind: 'custom' })}>
            <AddIcon />
            <Text>{CLOUD_COPY.addCustom}</Text>
          </Button>
        }
      />
      {capability === 'generateImage' ? <CodexImageCard codex={codex} isDefault={defaultRef?.providerId === CODEX_IMAGE_PROVIDER} /> : null}
      {cards.length ? (
        cards.map((card) => (
          <ProviderCard
            key={card.providerId}
            card={card}
            capability={capability}
            defaultRef={defaultRef}
            expanded={expanded.has(card.providerId)}
            probes={Object.fromEntries(
              card.models.flatMap((m) => {
                const state = liveState(runKey(card.providerId, m.modelId));
                return state ? [[m.modelId, state] as const] : [];
              }),
            )}
            onToggle={() => toggle(card.providerId)}
            onKey={() => setDialog({ kind: 'key', providerId: card.providerId })}
            onAddModel={() => setDialog({ kind: 'model', providerId: card.providerId, label: card.label, capability })}
            onProbe={(model) => setDialog({ kind: 'probe', providerId: card.providerId, modelId: model.modelId })}
            refreshing={refreshing === card.providerId}
            refreshBusy={refreshing !== null}
            onRefresh={() => void refresh(card.providerId)}
          />
        ))
      ) : (
        <PageStatus>{CLOUD_COPY.emptyProviders}</PageStatus>
      )}

      {keyCard ? (
        <KeyDialog
          key={keyCard.providerId}
          card={keyCard}
          onClose={() => setDialog(null)}
          onSaved={() => {
            if (refreshAfterKey(keyCard)) void refresh(keyCard.providerId);
          }}
        />
      ) : null}
      {dialog?.kind === 'custom' ? (
        <CustomProviderDialog
          view={view}
          initialCapability={capability}
          onClose={() => setDialog(null)}
          onAdded={(providerId, next) => {
            setDialog(null);
            expand(providerId);
            showCapability(next);
          }}
          onUseExisting={(providerId, modelId, next) => {
            const label = cards.find((c) => c.providerId === providerId)?.label ?? providerId;
            setDialog({ kind: 'model', providerId, label, modelId, capability: next });
          }}
        />
      ) : null}
      {dialog?.kind === 'model' ? (
        <AddModelDialog
          view={view}
          providerId={dialog.providerId}
          label={dialog.label}
          initialModelId={dialog.modelId}
          initialCapability={dialog.capability}
          onClose={() => setDialog(null)}
          onAdded={(next) => {
            expand(dialog.providerId);
            setDialog(null);
            showCapability(next);
          }}
        />
      ) : null}
      {probeCard && probeModel ? (
        <ProbeDialog
          capability={capability}
          providerLabel={probeCard.label}
          model={probeModel}
          state={liveState(runKey(probeCard.providerId, probeModel.modelId)) ?? { status: 'ready' }}
          onStart={(voice) => void runProbe(probeCard.providerId, probeModel, voice)}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </>
  );
}
