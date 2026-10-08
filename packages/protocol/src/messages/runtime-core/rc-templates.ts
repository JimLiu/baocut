import { defineCatalog } from '../../message-ref.ts';
import { zhHans } from './rc-templates.zh-Hans.ts';
import { zhHant } from './rc-templates.zh-Hant.ts';
import { ja } from './rc-templates.ja.ts';
import { ko } from './rc-templates.ko.ts';
import { es } from './rc-templates.es.ts';
import { fr } from './rc-templates.fr.ts';
import { de } from './rc-templates.de.ts';
import { nl } from './rc-templates.nl.ts';
import { ptBR } from './rc-templates.pt-BR.ts';
import { it } from './rc-templates.it.ts';
import { ru } from './rc-templates.ru.ts';
import { pl } from './rc-templates.pl.ts';
import { tr } from './rc-templates.tr.ts';
import { vi } from './rc-templates.vi.ts';

/** 模板（templates/）的错误。英文是键与类型的来源，译文在 `rc-templates.<语言>.ts`。 */
const en = {
  builtinConflict: (p: { id: string }) =>
    `A built-in template with the id "${p.id}" already exists, so this copy wasn't loaded. Change the id (folder name) and add it again`,
  templateNotFound: (p: { id: string }) => `Template not found: ${p.id}`,
  fileNotRegistered: (p: { id: string; file: string }) => `Template "${p.id}" doesn't list this file: ${p.file}`,
  dirIsSymlink: "The template folder is a symbolic link and isn't followed. Add the template folder itself",
  duplicateId: (p: { id: string }) => `More than one template in the same directory has the id "${p.id}"; none of them were loaded`,
  templateInvalid: "The template isn't valid and wasn't loaded",
  unsupportedSchema: "This version doesn't recognize the manifest schema, so the template wasn't loaded",
  missingFile: (p: { file: string }) => `${p.file} is missing`,
  fileOverBytes: (p: { file: string; limit: number }) => `${p.file} is larger than ${p.limit} bytes`,
  fileOverBytesActual: (p: { file: string; limit: number; size: number }) => `${p.file} is larger than ${p.limit} bytes (${p.size})`,
  fileNotUtf8: (p: { file: string }) => `${p.file} isn't valid UTF-8`,
  fileNotJson: (p: { file: string }) => `${p.file} isn't valid JSON`,
  fileEmpty: (p: { file: string }) => `${p.file} is empty`,
  registeredFileMissing: (p: { file: string }) => `A listed file doesn't exist: ${p.file}`,
  pathOutsideTemplate: (p: { file: string }) => `Path goes outside the template folder: ${p.file}`,
  unregisteredFile: (p: { file: string }) => `The folder has a file that isn't listed: ${p.file}`,
  tooManyEntries: (p: { limit: number }) => `The folder has more than ${p.limit} entries`,
  noSymlinks: (p: { path: string }) => `Symbolic links aren't allowed: ${p.path}`,
  notRegularFile: (p: { path: string }) => `Not a regular file: ${p.path}`,
  cannotReadDir: (p: { code: string }) => `Can't read the template folder (${p.code})`,
  notScene: (p: { title: string }) =>
    `"${p.title}" is a showcase example: put its prompt in the message box and send it, without attaching a template`,
  assetNotRegistered: (p: { id: string; asset: string }) => `Template "${p.id}" doesn't list this asset: ${p.asset}`,
  translationForBaseLanguage: (p: { file: string; language: string }) => `${p.file} is in the template's own language (${p.language}); template.json and prompt.md already cover it`,
};

export type RcTemplatesMessages = typeof en;

export const RcTemplates = defineCatalog('rcTemplates', en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
