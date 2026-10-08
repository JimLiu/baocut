import { defineCatalog } from '../../message-ref.ts';
import { zhHans } from './providers-config.zh-Hans.ts';
import { zhHant } from './providers-config.zh-Hant.ts';
import { ja } from './providers-config.ja.ts';
import { ko } from './providers-config.ko.ts';
import { es } from './providers-config.es.ts';
import { fr } from './providers-config.fr.ts';
import { de } from './providers-config.de.ts';
import { nl } from './providers-config.nl.ts';
import { ptBR } from './providers-config.pt-BR.ts';
import { it } from './providers-config.it.ts';
import { ru } from './providers-config.ru.ts';
import { pl } from './providers-config.pl.ts';
import { tr } from './providers-config.tr.ts';
import { vi } from './providers-config.vi.ts';

/** 在线服务与智能体 Provider 的配置、可用性与名字（`packages/providers`）。`label` / `name` 是服务的名字。 */
const en = {
  listSeparator: ', ',
  vendorKimi: 'Kimi (Moonshot)',
  vendorQwen: 'Alibaba Cloud Model Studio (Qwen)',
  vendorZhipu: 'Zhipu GLM (Z.ai)',
  vendorVolcengine: 'Volcengine (Doubao)',
  vendorXai: 'xAI (Grok)',
  vendorSiliconflow: 'SiliconFlow',
  notEnabledOrNoKey: (p: { label: string }) => `${p.label} isn't turned on or has no key`,
  noTextModel: (p: { label: string; model: string }) => `${p.label} has no text model: ${p.model}`,
  noSpeechModel: (p: { label: string; model: string }) => `${p.label} has no speech model: ${p.model}`,
  noImageModel: (p: { label: string; model: string }) => `${p.label} has no image model: ${p.model}`,
  noModel: (p: { label: string; model: string }) => `${p.label} has no model: ${p.model}`,
  modelUnspecified: '(not specified)',
  textFailed: (p: { label: string; message: string }) => `${p.label} text generation failed: ${p.message}`,
  transcribeFailed: (p: { label: string; message: string }) => `${p.label} transcription failed: ${p.message}`,
  generateFailed: (p: { label: string; message: string }) => `${p.label} generation failed: ${p.message}`,
  noTextGeneration: (p: { label: string }) => `${p.label}'s media generation runner doesn't generate text`,
  unavailableNow: (p: { label: string; detail: string }) => `${p.label} isn't available right now: ${p.detail}`,
  notEnabled: 'Not turned on',
  customIdFormat: 'A custom endpoint ID must be custom:<slug>, where slug uses lowercase letters, digits, and hyphens',
  providerNotFound: (p: { id: string }) => `No such provider: ${p.id}`,
  onlyCustomDeclares: 'Only custom endpoints can declare models and names',
  customNeedsEndpoint: 'Provide endpoint when adding a custom endpoint',
  customEndpointRequired: 'A custom endpoint must have an endpoint',
  duplicateModelIds: 'The declared models have a duplicate modelId',
  noKeyToVerify: 'There is no key to verify. Provide one with credential',
  accountNotFound: (p: { provider: string; account: string }) => `${p.provider} has no such account: ${p.account}`,
  accountNoKeyToVerify: 'This account has no key to verify. Provide one with credential',
  customNoEndpoint: "The custom endpoint doesn't have an endpoint yet",
  noKeySet: (p: { label: string }) => `${p.label} has no key set. Set one with models.configure first`,
  credentialUnavailable: (p: { problem: string }) => `Credential unavailable: ${p.problem}`,
  labelCredentialUnavailable: (p: { label: string; problem: string }) => `${p.label}'s credential is unavailable: ${p.problem}`,
  noEndpointSet: 'No endpoint set',
  noModelsDeclared: 'No models declared',
  noKey: 'No key set',
  keyUnreadable: "Can't read the key",
  verifyFailed: (p: { message: string }) => `Verification failed: ${p.message}`,
  noAccounts: (p: { id: string }) => `${p.id} has no accounts`,
  noRegion: (p: { label: string; region: string }) => `${p.label} has no such region: ${p.region}`,
  notInVendorList: (p: { at: string }) => `Not in the provider's model list (fetched ${p.at})`,
  toggleOnly: (p: { label: string; fields: string }) =>
    `${p.label} only has a switch (enabled): it uses its own sign-in and has no ${p.fields}`,
  giveEnabled: (p: { label: string }) => `${p.label} only has a switch: provide enabled`,
  driverNotRegistered: "This Driver isn't registered",
  noStatus: (p: { name: string }) => `Couldn't get ${p.name}'s status`,
  agentUnavailable: (p: { name: string }) => `${p.name} isn't available`,
  versionTooOld: (p: { name: string; version: string; min: string; hint: string }) =>
    `${p.name} is version ${p.version}; at least ${p.min} is needed: ${p.hint}`,
  unknownVersion: 'unknown',
};

export type ProvidersConfigMessages = typeof en;

export const ProvidersConfig = defineCatalog('providersConfig', en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
