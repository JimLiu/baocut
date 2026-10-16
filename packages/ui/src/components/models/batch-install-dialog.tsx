import { useEffect, useState } from 'react';
import { newId, type ModelBundleStatus, type ModelCapability, type ModelInstallBatchPlan } from '@baocut/protocol';
import { Button, ButtonGroup, Content, Dialog, DialogContainer, Heading, ProgressCircle } from '@react-spectrum/s2';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { DOWNLOAD_SOURCE_COPY as SRC, envName, kindOfComponent } from '../../model/download-source.ts';
import { installFolderView, installPlanView, problemText, rpcProblem } from '../../model/models-install.ts';
import { bundleName, isBundleInstalled, partLabel } from '../../model/models-local.ts';
import { licenseBrief, nonCommercial } from '../../model/models-tts-local.ts';
import { M as SEM } from '../../model/semantic-copy.ts';
import { TEXT_BUNDLE } from '../../model/semantic-package.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useShell } from '../../state/shell-store.ts';
import { SectionLink } from '../tools/tool-parts.tsx';
import { DownloadFolder } from './download-folder.tsx';
import { SourcePicker } from './download-sources.tsx';
import { LOCAL_INSTALL_COPY as COPY } from './local-models-copy.ts';
import { IMAGE_LOCAL_COPY } from './models-copy.ts';
import { MUSIC_LOCAL_COPY } from './music-local-copy.ts';
import { TTS_LOCAL_COPY as TTS } from './tts-local-copy.ts';

const stack = style({ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 });
const lead = style({ margin: 0, font: 'body', fontWeight: 'bold', color: 'gray-900' });
const fine = style({ margin: 0, font: 'ui-xs', color: 'gray-600', overflowWrap: 'anywhere' });
const problem = style({ margin: 0, font: 'ui-sm', color: 'negative-900', overflowWrap: 'anywhere' });
const list = style({ margin: 0, padding: 0, listStyleType: 'none', borderWidth: 1, borderStyle: 'solid', borderColor: 'gray-200', borderRadius: 'lg' });
const row = style({ display: 'flex', flexDirection: 'column', gap: 8, padding: 12,
  borderXWidth: 0, borderBottomWidth: 0, borderTopWidth: { default: 1, ':first-child': 0 }, borderStyle: 'solid', borderColor: 'gray-100' });
const rowHead = style({ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, alignItems: 'center' });
const labelStyle = style({ font: 'ui-sm', fontWeight: 'bold', color: 'gray-900' });
const sourceStyle = style({ font: 'code-xs', color: 'gray-600', overflowWrap: 'anywhere', userSelect: 'text' });
const text = style({ margin: 0, font: 'ui-sm', color: 'gray-800', overflowWrap: 'anywhere' });
const licenseBox = style({ display: 'flex', flexDirection: 'column', gap: 4, padding: 12, borderRadius: 'lg', backgroundColor: 'notice-subtle', color: 'gray-900' });
const licenseHead = style({ margin: 0, font: 'ui-sm', fontWeight: 'bold' });

/** 不许商用的模型生成的东西也只能用在非商业内容里：按它生成什么写那一句（同单只下载时各工具传给 InstallDialog 的）。 */
function licenseUse(capability: ModelCapability): string {
  return capability === 'image' ? IMAGE_LOCAL_COPY.licenseUse : capability === 'music' ? MUSIC_LOCAL_COPY.licenseUse : TTS.licenseUse;
}

/**
 * Semantic search installs both models through one confirmation; first-launch onboarding confirms every model it downloads
 * here too. Sizes and shared components come from Runtime.
 * The storage folder (`dir`, null for the models folder) applies to this download only, like the single-model dialog.
 * Non-commercial models get the same license note and “I understand” confirm label as the single-model dialog.
 */
export function BatchInstallDialog({ bundles, name, onStarted, onClose }: {
  bundles: readonly ModelBundleStatus[]; name: string; onStarted: () => void; onClose: () => void;
}) {
  const runtime = useRuntime();
  const go = useShell((s) => s.go);
  const [sources, setSources] = useState<Record<string, string | null>>({});
  const [dir, setDir] = useState<string | null>(null);
  const [planned, setPlanned] = useState<{ plan: ModelInstallBatchPlan; sources: typeof sources; dir: string | null } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [replanned, setReplanned] = useState(false);
  const [busy, setBusy] = useState(false);
  const [commandId] = useState(() => newId('cmd'));
  useEffect(() => {
    let live = true;
    setFailure(null);
    runtime.client.request('models.installBatch', { bundleIds: bundles.map((b) => b.bundleId), sources, ...(dir ? { dir } : {}) }).then(
      ({ plan }) => { if (live) setPlanned({ plan, sources, dir }); },
      (error: unknown) => { if (live) setFailure(problemText(rpcProblem(error))); },
    );
    return () => { live = false; };
  }, [runtime, bundles, sources, dir]);
  const plan = planned?.plan;
  const view = plan ? installPlanView(plan) : null;
  const folder = plan ? installFolderView(plan) : null;
  const refreshing = planned?.sources !== sources || planned?.dir !== dir;
  const canConfirm = !!plan && !!view && !view.upToDate && !view.noSpace && !folder?.problem && !refreshing && !busy;
  const submit = async (close: () => void) => {
    if (!plan || !canConfirm) return;
    setBusy(true);
    setFailure(null);
    try {
      // Freeze every effective choice, including defaults, so a settings change cannot redirect queued downloads.
      const selected = Object.fromEntries(plan.components.map((c) => [`${c.repo}@${c.revision}`, c.endpoint]));
      const result = await runtime.client.request('models.installBatch', {
        bundleIds: bundles.map((b) => b.bundleId), sources: selected, ...(dir ? { dir } : {}), confirmBytes: plan.confirmBytes, commandId,
      });
      if (result.jobs.length) { onStarted(); close(); }
      else setPlanned({ plan: result.plan, sources, dir });
    } catch (error) {
      const detail = (error as { details?: { code?: string; plan?: ModelInstallBatchPlan } })?.details;
      if (detail?.code === 'MODEL_INSTALL_SIZE_CHANGED' && detail.plan) {
        setPlanned({ plan: detail.plan, sources, dir });
        setReplanned(true);
      } else setFailure(problemText(rpcProblem(error)));
    } finally { setBusy(false); }
  };
  const completing = plan?.components.some((c) => c.action === 'keep');
  // Completing an installed bundle does not ask about its license again (same as the single-model dialog's `complete`).
  const restricted = bundles.flatMap((b) => {
    const license = isBundleInstalled(b) ? null : nonCommercial(b.license);
    return license ? [{ bundle: b, license }] : [];
  });
  return (
    <DialogContainer onDismiss={() => { if (!busy) onClose(); }}>
      <Dialog size="M" isKeyboardDismissDisabled={busy}>
        {({ close }) => <>
          <Heading slot="title">{completing ? COPY.completeTitle(name) : COPY.installTitle(name)}</Heading>
          <Content>
            <div className={stack}>
              {refreshing && !failure ? <div className={rowHead}><ProgressCircle size="S" isIndeterminate aria-label={COPY.planning} /><span className={fine}>{COPY.planning}</span></div> : null}
              {replanned ? <p className={problem}>{COPY.replanned}</p> : null}
              {view?.upToDate ? <p className={fine}>{COPY.upToDate}</p> : view && plan ? <>
                <p className={lead}>{view.size}</p>
                {view.space ? <p className={fine}>{view.space}</p> : null}
                {view.resumed ? <p className={fine}>{view.resumed}</p> : null}
                {completing ? <p className={fine}>{COPY.completeNote}</p> : null}
                {view.noSpace ? <p className={problem}>{view.noSpace}</p> : null}
                {folder ? <DownloadFolder view={folder} isDisabled={busy || refreshing} onPick={setDir} /> : null}
                <ul className={list} aria-label={COPY.details}>
                  {plan.components.map((c, i) => {
                    const key = `${c.repo}@${c.revision}`;
                    const kind = kindOfComponent(c);
                    const label = c.component === 'embedding'
                      ? c.bundleIds.includes(TEXT_BUNDLE) ? SEM.settings.partText : SEM.settings.partMultimodal
                      : partLabel(c.component);
                    return <li key={key} className={row}>
                      <div className={rowHead}><span className={labelStyle}>{label}</span><span className={fine}>{view.lines[i]!.value}</span></div>
                      {c.action === 'keep' ? null : <>
                        <div className={rowHead}>
                          <span className={fine}>{SRC.label}</span>
                          <SourcePicker kind={kind} label={SRC.pickerLabel(label)} isDisabled={busy || c.sourceLocked}
                            selection={Object.hasOwn(sources, key) ? sources[key]! : c.endpoint}
                            onSelect={(endpoint) => setSources((prev) => ({ ...prev, [key]: endpoint }))} />
                        </div>
                        {c.source ? <span className={sourceStyle}>{SRC.partFrom(c.source)}</span> : null}
                        {c.sourceLocked ? <p className={fine}>{SRC.envNote(envName(kind))}</p> : null}
                      </>}
                    </li>;
                  })}
                </ul>
                {restricted.map(({ bundle, license }) => (
                  <div key={bundle.bundleId} className={licenseBox} role="note" aria-label={TTS.licenseTitle}>
                    <p className={licenseHead}>{TTS.licenseTitle} · {bundleName(bundle)}</p>
                    <p className={text}>{licenseBrief(license)}</p>
                    <p className={fine}>{license.url}</p>
                    <p className={text}>{licenseUse(bundle.capability)}</p>
                  </div>
                ))}
                <p className={fine}>{SRC.perDownloadNote}{' '}
                  <SectionLink onPress={() => { if (!busy) { close(); go({ tab: 'settings', section: 'general' }); } }}>{SRC.manage}</SectionLink>
                </p>
              </> : null}
              {failure ? <p className={problem}>{failure}</p> : null}
            </div>
          </Content>
          <ButtonGroup>
            <Button variant="secondary" isDisabled={busy} onPress={close}>{view?.upToDate ? COPY.close : COPY.cancel}</Button>
            {view && !view.upToDate ? <Button variant="accent" isDisabled={!canConfirm} isPending={busy} onPress={() => void submit(close)}>{restricted.length ? TTS.licenseConfirm(view.amount) : COPY.confirmInstall(view.amount)}</Button> : null}
          </ButtonGroup>
        </>}
      </Dialog>
    </DialogContainer>
  );
}
