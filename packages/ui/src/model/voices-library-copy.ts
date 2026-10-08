import { defineMessages } from '@baocut/protocol';
import { zhHans } from './voices-library-copy.zh-Hans.ts';
import { zhHant } from './voices-library-copy.zh-Hant.ts';
import { ja } from './voices-library-copy.ja.ts';
import { ko } from './voices-library-copy.ko.ts';
import { es } from './voices-library-copy.es.ts';
import { fr } from './voices-library-copy.fr.ts';
import { de } from './voices-library-copy.de.ts';
import { nl } from './voices-library-copy.nl.ts';
import { ptBR } from './voices-library-copy.pt-BR.ts';
import { it } from './voices-library-copy.it.ts';
import { ru } from './voices-library-copy.ru.ts';
import { pl } from './voices-library-copy.pl.ts';
import { tr } from './voices-library-copy.tr.ts';
import { vi } from './voices-library-copy.vi.ts';

/** 我的声音（模型 › 语音合成）的文案（译文在 `voices-library-copy.<语言>.ts`）。「编辑」「云端模型」引用别处的按钮与页面名。 */
const en = {
  /** 勾上「本人声明」时写进 `consent.statement` 的话，也是勾选框上的字。 */
  consentStatement: 'This is my own voice, or I have the speaker’s permission',
  uploading: (label: string) => `Uploading to ${label}…`,
  noConsent: 'Not marked as your own voice or used with permission, so it won’t be uploaded to a third party. Check the statement in “Edit” first.',
  cannotClone: (label: string) => `This Runtime can’t clone on ${label}`,
  providerOff: (label: string, detail: string | null) =>
    `${label} can’t be used right now${detail ? ` (${detail})` : ''}: enable it and set the key in “Cloud models” first`,
  consentUnstated: 'Consent not stated',
  cloned: (label: string) => `Cloned on ${label}`,
  cloneStale: (label: string) => `${label} clone out of date`,
  languageUnknown: 'Language not specified',
  recorded: 'Recorded in the app',
  imported: 'Imported from a file',
  edited: (ago: string) => `Edited ${ago}`,
  nameRequired: 'Give the voice a name',
  nameTooLong: (max: number) => `Names can be up to ${max} characters`,
  transcriptTooLong: (max: number) => `Transcripts can be up to ${max} characters`,
  dontKnow: 'Not sure',
  deleteClones: (labels: readonly string[]) => `Its clones on ${labels.join(', ')} are deleted first; if that fails, the voice is kept.`,
  deleteBody: (clones: string) => `Videos that use it fall back to the default voice the next time they generate; voice-overs already generated are unaffected. ${clones}`.trim(),
  uploadNotice: (name: string, size: string | null, label: string) =>
    `The reference recording of “${name}”${size ? ` (${size})` : ''} will be uploaded to ${label} to create a clone. After that, using this voice on ${label} uses their voice ID directly; deleting the voice deletes this clone first.`,
  /** Runtime 的原因后面接一句补救（原因句末的标点先去掉）。 */
  withRemedy: (message: string, remedy: string) => `${message.replace(/[。.]$/, '')}. ${remedy}`,
  remedyConsent: 'Voices without a consent statement aren’t uploaded to third parties: check the statement in “Edit” first.',
  remedyConfigure: 'Enable this provider and set its key in “Cloud models”.',
  remedyConflict: 'This voice was just changed elsewhere. The latest version is shown below; take a look before saving.',
  remedyGrant: 'Sending the reference recording to a provider needs an outbound grant: issue one in Settings, then try again.',
};
export type VoicesLibraryMessages = typeof en;
export const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
