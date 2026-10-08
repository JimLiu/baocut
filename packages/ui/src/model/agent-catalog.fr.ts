import type { AcpCatalogEntry } from './acp-catalog.ts';
import type { AgentCatalogMessages } from './agent-catalog.ts';

export const fr: AgentCatalogMessages = {
  idEmpty: "Saisissez un identifiant, ex. my-agent",
  idPattern: "Identifiant : commence par une minuscule, seulement minuscules, chiffres et tirets",
  idTooLong: "Identifiant de 63 caractères maximum",
  idBuiltin: (id: string, who: string | null) => `« ${id} » est l’identifiant d’un Agent BaoCut intégré${who ? ` (${who})` : ""}. Choisissez un autre identifiant`,
  idTaken: (id: string, who: string | null) => `Un Agent${who ? ` (${who})` : ""} utilise déjà « ${id} ». Choisissez un autre identifiant`,
  nameEmpty: "Saisissez un nom pour la liste",
  nameTooLong: (max: number) => `Nom de longueur maximale ${max} caractères`,
  commandEmpty: "Saisissez la commande de démarrage, ex. my-agent --acp",
  commandShell: "Une seule commande, lancée directement sans shell ; pipes, redirections et && non disponibles",
  tooManyArgs: (max: number) => `Trop d’arguments : au plus ${max}`,
  envLine: (line: number) => `La ligne ${line} doit être KEY=VALUE, KEY commençant par lettre ou underscore`,
};
