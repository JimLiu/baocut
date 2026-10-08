import { defineCatalog } from '../../message-ref.ts';
import { zhHans } from './model-services.zh-Hans.ts';
import { zhHant } from './model-services.zh-Hant.ts';
import { ja } from './model-services.ja.ts';
import { ko } from './model-services.ko.ts';
import { es } from './model-services.es.ts';
import { fr } from './model-services.fr.ts';
import { de } from './model-services.de.ts';
import { nl } from './model-services.nl.ts';
import { ptBR } from './model-services.pt-BR.ts';
import { it } from './model-services.it.ts';
import { ru } from './model-services.ru.ts';
import { pl } from './model-services.pl.ts';
import { tr } from './model-services.tr.ts';
import { vi } from './model-services.vi.ts';

/** `packages/models/src/model-services.ts` 给人看的文字：服务与模型命令被拒绝的原因。 */
const en = {
  noSuchProvider: (p: { provider: string }) => `No such provider: ${p.provider}`,
  noConfigureNeeded: 'This computer and nodes need no setup; only online providers have a switch and a key',
  cannotRemove: 'Only online service providers can be removed; this computer, nodes, and agent providers cannot',
  noAccounts: 'Only online service providers have accounts; this computer, nodes, and agent providers do not',
  noCapabilityParameters: (p: { capability: string }) => `${p.capability} has no capability parameters`,
  noRefresh: 'Only online providers have a model list that can be refreshed',
  clearWithModel: "Don't give a model when clearing the default",
  capabilityNotOffered: (p: { provider: string; capability: string }) => `${p.provider} does not offer this capability: ${p.capability}`,
  noSelectableModel: (p: { provider: string }) => `${p.provider} has no model to choose; specify modelId`,
  providerNoModel: (p: { provider: string; model: string }) => `${p.provider} has no such model: ${p.model}`,
  providerNodeConflict: 'provider and node point to different providers',
  modelBundleMismatch: "model and bundleId don't match",
  cannotTranscribe: (p: { provider: string }) => `${p.provider} can't transcribe. Switch to another service.`,
  cannotUseCapability: (p: { provider: string }) => `${p.provider} can't be used for this capability. Switch to another service.`,
  cannotGenerateText: (p: { provider: string }) => `${p.provider} can't be used for text generation. Switch to another service.`,
};

export type ModelsModelServicesMessages = typeof en;

export const ModelsModelServices = defineCatalog('modelsModelServices', en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
