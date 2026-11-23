import { defineCatalog } from '../../message-ref.ts';
import { zhHans } from './rc-artifacts.zh-Hans.ts';
import { zhHant } from './rc-artifacts.zh-Hant.ts';
import { ja } from './rc-artifacts.ja.ts';
import { ko } from './rc-artifacts.ko.ts';
import { es } from './rc-artifacts.es.ts';
import { fr } from './rc-artifacts.fr.ts';
import { de } from './rc-artifacts.de.ts';
import { nl } from './rc-artifacts.nl.ts';
import { ptBR } from './rc-artifacts.pt-BR.ts';
import { it } from './rc-artifacts.it.ts';
import { ru } from './rc-artifacts.ru.ts';
import { pl } from './rc-artifacts.pl.ts';
import { tr } from './rc-artifacts.tr.ts';
import { vi } from './rc-artifacts.vi.ts';

/**
 * Open Artifact 作品（docs/design/artifacts）里 Runtime 写给人看的文字：daemon 连不上、作品或视图不在了，`/artifacts` skill 的界面名称。
 * 智能体看的工具说明来自 Open Artifact 本身（英文）。
 */
const en = {
  unavailable: "Artifacts aren't available: Open Artifact could not start.",
  unavailableBecause: (p: { reason: string }) => `Artifacts aren't available: ${p.reason}`,
  notFound: "This artifact was not found. It may have been deleted.",
  viewGone: "This artifact view has closed. Open the artifact again.",
  confirmAction: (p: { tool: string; action: string }) => `Run “${p.action}” on an artifact (${p.tool})`,
  skillName: "Artifacts",
  skillSummary: "Make slides, docs, designs, sheets and more as live pages with Open Artifact",
};

export type RcArtifactsMessages = typeof en;

const locales = { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi };

export const RcArtifacts = defineCatalog('rcArtifacts', en, locales);

/** 每种出货语言的整份文字：`/artifacts` skill 的界面名称与介绍要一次写出全部语言（`SKILL_META_FILE`）。 */
export const RC_ARTIFACTS_BY_LOCALE = { en, ...locales } as const;
