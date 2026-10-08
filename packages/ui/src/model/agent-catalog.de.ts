import type { AgentCatalogMessages } from './agent-catalog.ts';

export const de: AgentCatalogMessages = {
  idEmpty: "ID eingeben, etwa my-agent",
  idPattern: "ID muss mit Kleinbuchstaben beginnen und nur Kleinbuchstaben, Ziffern und Bindestriche enthalten",
  idTooLong: "ID höchstens 63 Zeichen",
  idBuiltin: (id: string, who: string | null) => `„${id}“ ist die ID eines integrierten BaoCut-Agenten${who ? ` (${who})` : ""}. Andere ID wählen`,
  idTaken: (id: string, who: string | null) => `Ein Agent${who ? ` (${who})` : ""} verwendet bereits „${id}“. Andere ID wählen`,
  nameEmpty: "Anzeigenamen für die Liste eingeben",
  nameTooLong: (max: number) => `Name höchstens ${max} Zeichen`,
  commandEmpty: "Startbefehl eingeben, etwa my-agent --acp",
  commandShell: "Einzelnen Befehl eingeben: BaoCut startet direkt, ohne Shell. Pipes, Umleitungen und && funktionieren nicht",
  tooManyArgs: (max: number) => `Zu viele Argumente: höchstens ${max}`,
  envLine: (line: number) => `Zeile ${line} muss KEY=VALUE sein; KEY beginnt mit Buchstabe oder Unterstrich`,
};
