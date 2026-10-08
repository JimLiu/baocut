import type { HarnessAgentsMessages } from './harness-agents.ts';

export const nl: HarnessAgentsMessages = {
  listSeparator: ", ",
  noDriver: (p: { id: string }) => `Geen agent geregistreerd met ID ${p.id}`,
  probeFailed: (p: { error: string }) => `Detectie mislukt: ${p.error}`,
  cannotChangeAgent: "Deze sessie is al gestart, dus de agent kan niet worden gewijzigd. Start een nieuwe sessie om een andere te kiezen.",
  noBudgetLedger: "Deze Runtime heeft geen taakbudgetregister, dus budgetten kunnen niet worden ingesteld",
  driverGone: (p: { id: string }) =>
    `Agent ${p.id} is verwijderd of niet geregistreerd, dus deze sessie kan niet meer verzenden. Start een nieuwe sessie met een andere agent.`,
  driverUnverified: (p: { agent: string }) =>
    `${p.agent} heeft de integratietests van BaoCut nog niet doorstaan. Alleen de detectieresultaten worden getoond en sessies kunnen niet worden gestart.`,
  fullAccessOnly: (p: { agent: string; fullAccess: string; current: string }) =>
    `${p.agent} kan niet stapsgewijs om goedkeuring vragen en werkt daarom alleen in de modus ‘${p.fullAccess}’ (momenteel ‘${p.current}’). Kies ‘${p.fullAccess}’ en verzend opnieuw, of gebruik een andere agent.`,
  runtimeStopping: "De Runtime wordt gestopt",
  sessionBusy: "Er loopt nog een taak in deze sessie. Stop die of wacht tot die klaar is.",
  sessionBusyOther: "Deze sessie voert een andere taak uit. Stop die of wacht tot die klaar is.",
  oldTaskNotStopped: "De oude taak is nog niet gestopt. Probeer het later opnieuw",
  attachmentsUnsupported: "Deze versie kan nog geen afbeeldingsbijlagen verzenden",
  attachmentDuplicate: "Elke bijlage kan maar één keer per bericht worden toegevoegd",
  tooManyImages: (p: { max: number }) => `Een bericht mag maximaal bevatten: ${p.max} afbeeldingen`,
  imagesUnsupported: "Deze agent ondersteunt geen afbeeldingen",
  contractRevisionMissing: (p: { revision: number; latest: number }) =>
    `Het taakcontract heeft geen revisie ${p.revision} (nieuwste is ${p.latest})`,
  taskEnded: "De taak is beëindigd (of wordt gestopt), dus het contract kan niet worden gewijzigd. Gebruik tasks.changeGoal om het doel te wijzigen",
  contractRevisionStale: (p: { latest: number; expected: number }) =>
    `Het contract heeft al revisie ${p.latest}, niet ${p.expected}. Lees het opnieuw voordat je het wijzigt`,
  checkMissing: (p: { id: string }) => `Het taakcontract heeft deze controle niet: ${p.id}`,
  taskNotFound: (p: { id: string }) => `Taak niet gevonden: ${p.id}`,
  approvalNotFound: (p: { id: string }) => `Goedkeuring niet gevonden: ${p.id}`,
  builtinId: (p: { id: string }) => `${p.id} is een ingebouwde agent-ID. Kies een andere`,
  agentExists: (p: { id: string }) => `Er bestaat al een agent met ID ${p.id}`,
  builtinNotRemovable: (p: { agent: string }) => `${p.agent} is ingebouwd en kan niet worden verwijderd. Je kunt die uitschakelen bij Instellingen`,
  agentMissing: (p: { id: string }) => `Geen agent heeft ID ${p.id}`,
  providersUnsupported: "Deze Runtime kan geen agents toevoegen of verwijderen",
  modelMissing: (p: { agent: string; model: string; choices: string }) => `${p.agent} heeft geen model ‘${p.model}’. Kies uit ${p.choices}`,
  effortMissing: (p: { model: string; effort: string; choices: string }) =>
    `Model ‘${p.model}’ heeft geen denkintensiteit ‘${p.effort}’. Kies uit ${p.choices}`,
  effortUnsupported: (p: { model: string }) => `Model ‘${p.model}’ heeft geen denkintensiteitsniveaus`,
  approvalNoGrant: "Deze goedkeuring verzendt geen gegevens naar buiten en kan dus geen toestemmingskeuze bevatten",
  contractFieldsReadonly: (p: { fields: string }) =>
    `De agent kan deze velden van het taakcontract niet wijzigen: ${p.fields}. Alleen de gebruiker bepaalt de toegangsmodus, toestemmingsbereik, budget en beschermde bereiken`,
};
