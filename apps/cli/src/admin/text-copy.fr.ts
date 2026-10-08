import { TEXT_EFFORTS } from '@baocut/protocol';
import type { TextMessages } from './text-copy.ts';

export const fr: TextMessages = {

  help: `Utilisation :
  baocut text <prompt> [options]   Appeler un modèle de texte une fois ; prompt - lu depuis stdin. Texte complet envoyé
                                   sur stdout (avec --out, écrit dans le fichier, tâche et résultat JSON sur stdout) ;
                                   progression, avertissements et version du modèle sur stderr
    --system <text>                Message système
    --json-schema <file>           Sortie structurée : renvoyée et validée selon ce schéma JSON (objet à sa racine) ;
                                   en cas de non-conformité, échec de tâche avec MODEL_OUTPUT_INVALID
    --provider <id>                Fournisseur du catalogue comme openai, google ou anthropic, ou custom:<name> ;
                                   valeur par défaut si absent (aucun défaut intégré pour cette capacité)
    --model <id>                   Modèle ; celui du fournisseur par défaut si absent
    --max-output-tokens <n>        Limite de sortie ; celle du modèle si absente. Texte simple tronqué
                                   toujours affiché, avec avertissement output-truncated
    --effort <${TEXT_EFFORTS.join("|")}>
                                   Effort de raisonnement ; niveau le plus proche si le modèle ne dispose pas de celui-ci,
                                   ignoré si le modèle ne peut pas l’ajuster (explication sur stderr)
    --temperature <0–2>            Uniquement pour les modèles qui l’acceptent
    --seed <n>                     Uniquement pour les modèles qui l’acceptent
    --out <file>                   Écrire le texte complet dans ce fichier`,
  stdinPromptHint: "Saisissez le prompt, puis appuyez sur Ctrl-D pour terminer :",
  missingPrompt: "Prompt manquant",
  jsonSchemaUnreadable: (file: string, reason: string) => `Impossible de lire le schéma JSON ${file} : ${reason}`,
  jsonSchemaNotObject: "Le fichier --json-schema doit contenir un objet JSON",
  singleModel: "text accepte un seul --model",
  maxOutputTokensInvalid: "--max-output-tokens doit être un entier positif",
  effortChoices: (efforts: readonly string[]) => `--effort doit être une valeur parmi ${efforts.join(", ")}`,
  temperatureRange: "--temperature doit être entre 0 et 2",
  seedInvalid: "--seed doit être un entier",
  noTextResult: "La tâche est terminée mais n’a renvoyé aucun texte",
  fetchOutputFailed: (artifactId: string, status: number) => `Impossible de récupérer le résultat ${artifactId} : HTTP ${status}`,
  written: (file: string) => `Écrit : ${file}`,

  modelLine: (provider: string, model: string, usage: { input: number | string; output: number | string } | null) =>
    `${provider} / ${model}${usage ? `, entrée ${usage.input} / sortie ${usage.output} tokens` : ""}`,
};
