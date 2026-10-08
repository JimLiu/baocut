const KINDS: Readonly<Record<string, string>> = { transcript: 'transcripten en vertalingen', frames: 'videoframes en miniaturen', audio: 'audio', video: 'de oorspronkelijke video', document: 'tekst en prompts', context: 'sessiecontext van de agent' };
function nlKinds(codes: string): string {
  const labels = codes.split(',').filter(Boolean).map((k) => KINDS[k] ?? k);
  return new Intl.ListFormat('nl', { style: 'long', type: 'conjunction' }).format(labels);
}
import { pluralForm } from '../../i18n.ts';
import type { RcGrantsMessages } from './rc-grants.ts';

export const nl: RcGrantsMessages = {
  dataKinds: (p: { kinds: string }) => nlKinds(p.kinds),

  grantLapsed: (p: { kinds: string; label: string; expired: boolean }) =>
    `De toestemming voor het verzenden van ${nlKinds(p.kinds)} aan ${p.label} is ${p.expired ? "verlopen" : "ingetrokken"}`,
  grantRequired: (p: { kinds: string; label: string }) => `Het verzenden van ${nlKinds(p.kinds)} aan ${p.label} vereist toestemming van de gebruiker`,
  grantCallsUsedUp: (p: { used: number; max: number | null }) =>
    `De aanroeplimiet van de toestemming (${p.used}/${p.max}) is verbruikt, dus deze aanroep zou het budget overschrijden`,
  grantAmountUsedUp: "De bedraglimiet van de toestemming is verbruikt, dus deze aanroep zou het budget overschrijden",
  budgetUnverifiable: (p: { label: string }) =>
    `De toestemming heeft een bedraglimiet, maar dit model van het type ${p.label} heeft geen betrouwbare prijs, dus binnen die limiet blijven kan niet worden gegarandeerd`,
  taskCallsUsedUp: (p: { used: number; max: number | null }) =>
    `Het aanroepbudget van deze taak (${p.used}/${p.max}) is verbruikt, dus deze aanroep zou het taakbudget overschrijden`,
  taskAmountUsedUp: (p: { amount: string; currency: string }) =>
    `Het bedragbudget van deze taak (${p.amount} ${p.currency}) is verbruikt, dus deze aanroep zou het taakbudget overschrijden`,
  taskBudgetUnverifiable: (p: { currency: string }) =>
    `Het taakbudget heeft een bedraglimiet, maar de kosten van deze aanroep kunnen niet worden geschat in ${p.currency}, dus binnen die limiet blijven kan niet worden gegarandeerd`,
  combined: (p: { message: string; others: number }) =>
    `${p.message} (${p.others} meer ${pluralForm('nl', p.others, { one: "overdracht vereist ook", other: "overdrachten vereisen ook" })} toestemming)`,

  hintRevoked:
    "Ingetrokken of verlopen toestemmingen worden niet automatisch hersteld. Vraag de gebruiker opnieuw toestemming te geven bij Instellingen van BaoCut of eenmalig goed te keuren in de sessie.",
  hintRequired:
    "Gegevens naar buiten sturen vereist toestemming van de gebruiker (per gegevenstype, ontvanger, bereik en doel). Vraag de gebruiker toestemming te geven bij Instellingen van BaoCut of eenmalig goed te keuren in de sessie.",
  hintExhausted:
    "Een verbruikt budget wordt niet automatisch verhoogd. Vraag de gebruiker de limiet van deze toestemming te verhogen of wacht tot lopende aanroepen klaar zijn (mislukte en geannuleerde aanroepen geven hun reserveringen vrij).",
  hintUnverifiable:
    "Als de kosten niet kunnen worden geschat, kan de gebruiker alleen elke aanroep goedkeuren (bedrag onbekend) of toestemming per aanroep geven met een onbekend bedrag.",
  hintTaskExhausted:
    "Een verbruikt taakbudget wordt niet automatisch verhoogd. Vraag de gebruiker het budget van deze taak in het taakcontract te verhogen of wacht tot lopende aanroepen klaar zijn (mislukte en geannuleerde aanroepen geven hun reserveringen vrij).",
  hintTaskUnverifiable:
    "Als een taakbudget een bedraglimiet heeft, worden alleen aanroepen geaccepteerd waarvan de kosten in dezelfde valuta kunnen worden geschat. Ook bij aanroepen met onbekende bedragen of andere valuta kan binnen de limiet blijven niet worden gegarandeerd. Vraag de gebruiker de bedraglimiet van het taakbudget te verwijderen (alleen de aanroeplimiet behouden) of kies een model met een prijs.",
  hintServiceAuto:
    "Het niveau auto van een externe dienst is geen toestemming om gegevens naar buiten te sturen. Vraag de gebruiker toestemming voor deze aanbieder te geven in BaoCut (gegevenstypen, bereik en budget) of wijzig het dienstniveau naar ask om elke aanroep goed te keuren.",

  placeholderPurpose: "<purpose>",
  placeholderMaxCalls: "<higher call count>",
  placeholderBudget: "<higher amount>",
  placeholderCalls: "<call count>",

  grantLapsedBeforeStart: (p: { state: string }) =>
    `De toestemming ${p.state === "expired" ? "is verlopen" : p.state === "revoked" ? "is ingetrokken" : "is beperkt"} voordat de taak begon, dus er zijn geen gegevens verzonden`,
  grantInvalidBeforeStart: "De toestemming is ongeldig geworden voordat de taak begon, dus er zijn geen gegevens verzonden",
  retrySkipped: (p: { reason: string }) => `De automatische nieuwe poging is niet uitgevoerd: ${p.reason}`,
  ledgerUnsaved: "Het toestemmingsregister kan niet naar schijf worden geschreven, dus er zijn geen gegevens verzonden",
  providerDisabledBeforeStart: "De aanbieder is uitgeschakeld voordat de taak begon, dus er zijn geen gegevens verzonden",

  noSuchGrant: "Deze toestemming bestaat niet",
  toolPurpose: (p: { tool: string }) => `Tool ‘${p.tool}’`,
  pipelinePurpose: (p: { label: string }) => `Pipeline ‘${p.label}’`,
};
