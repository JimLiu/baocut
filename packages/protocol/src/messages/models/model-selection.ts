import { defineCatalog } from '../../message-ref.ts';
import { zhHans } from './model-selection.zh-Hans.ts';
import { zhHant } from './model-selection.zh-Hant.ts';
import { ja } from './model-selection.ja.ts';
import { ko } from './model-selection.ko.ts';
import { es } from './model-selection.es.ts';
import { fr } from './model-selection.fr.ts';
import { de } from './model-selection.de.ts';
import { nl } from './model-selection.nl.ts';
import { ptBR } from './model-selection.pt-BR.ts';
import { it } from './model-selection.it.ts';
import { ru } from './model-selection.ru.ts';
import { pl } from './model-selection.pl.ts';
import { tr } from './model-selection.tr.ts';
import { vi } from './model-selection.vi.ts';

/** `packages/models/src/model-selection.ts` 给人看的文字：能力名，与选不出 Provider / 模型时的原因和补救提示。 */
const en = {
  capTranscribe: 'Transcription',
  capSynthesizeSpeech: 'Speech synthesis',
  capGenerateImage: 'Image generation',
  capGenerateText: 'Text generation',
  capSeparateAudio: 'Voice separation',
  noSuchProvider: (p: { provider: string }) => `No such provider: ${p.provider}`,
  noProviderForModel: (p: { model: string }) => `No provider offers this model: ${p.model}`,
  ambiguousModel: (p: { model: string }) => `Several providers have model ${p.model}; also specify provider`,
  languageUnsupported: (p: { modelId: string; language: string }) => `Model ${p.modelId} does not support language ${p.language}`,
  providerNoModel: (p: { provider: string; modelId: string }) => `${p.provider} has no such model: ${p.modelId}`,
  defaultModelGone: (p: { modelId: string; provider: string }) => `The default model ${p.modelId} is no longer among the models of ${p.provider}`,
  missingCredential: (p: { name: string }) => `${p.name} has no API key yet. Enter the key in Settings.`,
  localNotInstalled: (p: { model: string }) => `The local model bundle ${p.model} is not installed. Install it, or use another service.`,
  nodeNotPaired: (p: { name: string }) => `Node ${p.name} is not paired. Pair it again, or use another service.`,
  nodeNotConnected: (p: { name: string }) => `Can't connect to node ${p.name}. Make sure it is on and on the same network, and pair it again if needed.`,
  localDisabled: (p: { model: string }) => `The local model bundle ${p.model} was disabled after repeated errors. Re-enable it in Settings.`,
  providerDisabled: (p: { name: string }) => `${p.name} is disabled. Re-enable it in Settings.`,
  providerNotConfigured: (p: { name: string }) => `${p.name} is not set up yet. Enable it in Settings and enter the key.`,
  agentNotInstalled: (p: { name: string }) => `${p.name} is not installed`,
  agentNotInstalledWith: (p: { name: string; detail: string }) => `${p.name} is not installed: ${p.detail}`,
  agentSignedOut: (p: { name: string }) => `${p.name} is not signed in`,
  agentSignedOutWith: (p: { name: string; detail: string }) => `${p.name} is not signed in: ${p.detail}`,
  agentOutdated: (p: { name: string }) => `The version of ${p.name} is too old`,
  agentOutdatedWith: (p: { name: string; detail: string }) => `The version of ${p.name} is too old: ${p.detail}`,
  agentUnavailable: (p: { name: string }) => `${p.name} can't be used right now`,
  agentUnavailableWith: (p: { name: string; detail: string }) => `${p.name} can't be used right now: ${p.detail}`,
  agentNotEnabled: (p: { name: string }) => `${p.name} is not enabled yet. Enabling it agrees to send prompts (and reference images) to its account, using the user's own subscription quota.`,
  defaultNodeUnpaired: (p: { node: string; capability: string }) => `The default node ${p.node} is no longer paired. Pair it again, or change the default for ${p.capability}.`,
  defaultProviderRemoved: (p: { provider: string; capability: string }) => `The default ${p.provider} was removed. Set it up again, or change the default for ${p.capability}.`,
  setUsableAsDefault: (p: { provider: string; capability: string }) => `${p.provider} is available. Just set it as the default for ${p.capability}.`,
  noModelInstallSeparator: (p: { capability: string }) => `No model is available for ${p.capability} yet. Install the local separation model bundle.`,
  noModelInstallLocal: (p: { capability: string }) => `No model is available for ${p.capability} yet. Install a local model bundle, or set up an online service and make it the default.`,
  noModelConfigure: (p: { capability: string }) => `No model is available for ${p.capability} yet. Set up a service in Settings and make it the default.`,
  cannotUseFor: (p: { provider: string; capability: string }) => `${p.provider} can't be used for ${p.capability}. Switch to another service or model, or change the default.`,
};

export type ModelsModelSelectionMessages = typeof en;

export const ModelsModelSelection = defineCatalog('modelsModelSelection', en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
