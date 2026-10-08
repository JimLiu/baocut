import type { ChatMessages } from './chat-copy.ts';
export const nl: ChatMessages = {
 help: `Gebruik:
  baocut chat <message> [options]  Een bericht sturen en het antwoord afdrukken
    --project <dir>                Chatten in deze projectmap (het project wordt herkend aan
                                   .bcut/project.json in de map, aangemaakt als dit ontbreekt)
    --conversation <id>            Een bestaande sessie voortzetten
    --template <id>                Een scènesjabloon bijvoegen (een scène uit baocut templates): de Runtime voegt de
                                   briefinggids en sjabloontekst aan het bericht toe; voorbeelden kunnen niet worden bijgevoegd;
                                   stuur in plaats daarvan de prompt van een voorbeeld (baocut templates show <id>) als bericht
    --skill <id>                   Een Skill kiezen (uit baocut skills, ook een uitgeschakelde):
                                   de Runtime voegt de tekst van SKILL.md aan het bericht toe
    --mode <ask|auto-accept-edits|auto|full-access|plan>
                                   De toegangsmodus van deze sessie wijzigen (latere acties volgen deze); zonder deze optie blijft de modus
                                   staan, of geldt agent.defaultAccessMode (standaard auto) als de modus nooit is gewijzigd
    --yes                          Goedkeuringsverzoeken automatisch goedkeuren (alleen deze sessie)`,
 missingMessage: 'Berichttekst ontbreekt', templateIsExample: (title, id) => `‘${title}’ is een voorbeeld en kan niet worden bijgevoegd: haal de prompt op met baocut templates show ${id} en stuur deze als bericht`, sessionCreated: (id, cwd) => `Sessie ${id}  werkmap ${cwd}`, disconnected: (reason) => `De verbinding met de Runtime is verbroken: ${reason}`, sessionDeleted: 'De sessie is verwijderd', stopping: 'Bezig met stoppen…', chatTemplate: (id) => `Sjabloon: ${id}`, chatSkill: (id) => `Skill: ${id}`, chatMode: (mode) => `Toegangsmodus: ${mode}`, taskEnded: (status, error) => `Taak: ${status}${error ? ` — ${error}` : ''}`, taskStatus: { completed: 'Klaar', stopped: 'Gestopt', failed: 'Mislukt' }, taskFailed: 'Taak mislukt', toolCallFinished: (title, status, exitCode) => `▸ ${title} — ${status}${exitCode !== null ? ` (afsluitcode ${exitCode})` : ''}`, approvalNeeded: (what) => `Goedkeuring nodig — ${what}`, approvalReason: (isTool, reason) => `${isTool ? 'Inhoud' : 'Reden'}: ${reason}`, approvalMode: (mode) => `Huidige modus: ${mode}`, autoApproved: 'Automatisch goedgekeurd (--yes)', declinedNotTty: 'Niet uitgevoerd in een terminal: geweigerd (voeg --yes toe voor automatische goedkeuring)', approvalQuestion: 'Goedkeuren? [y] ja / [s] sessie / [N] nee ',
};
