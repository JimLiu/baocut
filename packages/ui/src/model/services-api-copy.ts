import { defineMessages } from '@baocut/protocol';
import { zhHans } from './services-api-copy.zh-Hans.ts';
import { zhHant } from './services-api-copy.zh-Hant.ts';
import { ja } from './services-api-copy.ja.ts';
import { ko } from './services-api-copy.ko.ts';
import { es } from './services-api-copy.es.ts';
import { fr } from './services-api-copy.fr.ts';
import { de } from './services-api-copy.de.ts';
import { nl } from './services-api-copy.nl.ts';
import { ptBR } from './services-api-copy.pt-BR.ts';
import { it } from './services-api-copy.it.ts';
import { ru } from './services-api-copy.ru.ts';
import { pl } from './services-api-copy.pl.ts';
import { tr } from './services-api-copy.tr.ts';
import { vi } from './services-api-copy.vi.ts';

/** 模型接口服务页的文案：能力名、端点、路由开关、能力与别名的说明、别名校验（译文在 `services-api-copy.<语言>.ts`）。 */
const en = {
  capabilities: {
    transcribe: 'Transcribe',
    synthesizeSpeech: 'Synthesize speech',
    generateImage: 'Generate images',
    generateText: 'Generate text',
  },
  endpoints: {
    models: 'List models',
    model: 'Get a model',
    info: 'Service info and interface version',
    transcriptions: 'Transcribe audio',
    speech: 'Synthesize speech',
    images: 'Generate images',
    chat: 'Generate text (chat)',
  },
  routing: {
    online: { label: 'Online services', desc: 'Forward requests to connected cloud services (may cost money; data leaves this computer)' },
    nodes: { label: 'LAN nodes', desc: 'Forward requests to other paired computers' },
    agent: { label: 'Agents', desc: 'Forward requests to agent runtimes signed in on this computer (such as Codex)' },
  },
  modelsAvailable: (n: number) => `${n} ${n === 1 ? 'model' : 'models'} available`,
  notRouted: 'Models are available, but routing is off for their category; requests get 503 for now',
  noModels: 'No models available yet; requests get 503 for now',
  defaultModel: 'Default model',
  target: (provider: string, model: string) => `${provider} · ${model}`,
  aliasProviderMissing: 'Can’t find this provider; requests get 404',
  aliasNotRouted: 'Routing is off for this category; requests get 404',
  aliasProviderUnavailable: 'This provider isn’t available right now',
  aliasModelUnavailable: 'This model isn’t available right now',
  targetNotRouted: 'Routing off',
  targetUnavailable: 'Not available right now',
  aliasNameEmpty: 'Enter a name, such as whisper-1',
  aliasNameSlash: 'Names can’t contain “/”: <provider>/<model> is the canonical form, and aliases can’t collide with it',
  aliasNameChars: 'Use only letters, digits, and . _ : -, starting with a letter or digit',
  aliasNameTaken: (name: string) => `“${name}” already exists; to change its target, delete that row first`,
};

export type ServicesApiMessages = typeof en;
export const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
