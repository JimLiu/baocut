import type { RuntimeStorageGrantsMessages } from './runtime-storage-grants.ts';

export const nl: RuntimeStorageGrantsMessages = {
  localNeedsNoGrant: "Lokale berekening vereist geen toestemming",
  dataKindRequired: "Geef minstens één gegevenstype op",
  budgetCapRequired: "Toestemming met een uitgavenlimiet vereist budgetCap",
  unknownCostNoCap: "Toestemming met onbekende kosten mag geen uitgavenlimiet hebben. Gebruik estimate-cap om een limiet in te stellen",
  expiryPassed: "De vervaltijd is al verstreken",
  grantNotFound: "Deze toestemming bestaat niet",
  grantRevoked: "De toestemming is ingetrokken en kan niet worden gewijzigd. Geef nieuwe toestemming",
  cannotRemoveCap: "Toestemming met een uitgavenlimiet mag de limiet niet verwijderen. Trek die in en geef nieuwe toestemming met onbekende kosten",
  unknownCostCannotCap: "Toestemming met onbekende kosten mag geen uitgavenlimiet instellen. Trek die in en geef nieuwe estimate-cap-toestemming",
  cannotChangeCurrency: "De valuta kan niet worden gewijzigd",
  expiryPassedRevoke: "De vervaltijd is al verstreken. Trek die in om nu te stoppen",
  revokeNote:
    "Na intrekken worden geen nieuwe aanroepen uitgevoerd en worden aanroepen in de wachtrij bij het starten geweigerd. Gegevens die al naar de aanbieder zijn verzonden en kosten die al zijn gemaakt kunnen lokaal niet ongedaan worden gemaakt; lopende aanroepen worden gewoon voltooid en tellen mee voor het gebruik.",
  taskCallLimit: "De aanroeplimiet van het taakbudget moet een positief geheel getal zijn",
  providerGrantPurpose: (p: { label: string }) => `Standaard gegeven bij het inschakelen van ${p.label}`,
  invalidCurrency: (p: { currency: string }) => `De valuta moet bestaan uit drie hoofdletters (ISO 4217): ${p.currency}`,
};
