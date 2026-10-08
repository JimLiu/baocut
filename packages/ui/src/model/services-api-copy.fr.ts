import { pluralForm } from '@baocut/protocol';
import type { ServicesApiMessages } from './services-api-copy.ts';

export const fr: ServicesApiMessages = {
  capabilities: {
    transcribe: "Transcrire",
    synthesizeSpeech: "Synthétiser la voix",
    generateImage: "Générer des images",
    generateText: "Générer du texte",
  },
  endpoints: {
    models: "Lister les modèles",
    model: "Obtenir un modèle",
    info: "Informations et version de l’interface",
    transcriptions: "Transcrire l’audio",
    speech: "Synthétiser la voix",
    images: "Générer des images",
    chat: "Générer du texte (chat)",
  },
  routing: {
    online: { label: "Services en ligne", desc: "Transférer aux services cloud connectés (coût possible ; données envoyées)" },
    nodes: { label: "nœuds du réseau local", desc: "Transférer aux autres ordinateurs jumelés" },
    agent: { label: "Agents", desc: "Transférer aux Runtimes d’Agents connectés localement (comme Codex)" },
  },
  modelsAvailable: (n: number) => `${n} ${pluralForm('fr', n, { one: "modèle", other: "modèles" })} disponibles`,
  notRouted: "Modèles disponibles, mais routage de catégorie désactivé ; réponse 503",
  noModels: "Aucun modèle disponible ; réponse 503",
  defaultModel: "Modèle par défaut",
  target: (provider: string, model: string) => `${provider} · ${model}`,
  aliasProviderMissing: "Fournisseur introuvable ; réponse 404",
  aliasNotRouted: "Routage de catégorie désactivé ; réponse 404",
  aliasProviderUnavailable: "Fournisseur actuellement indisponible",
  aliasModelUnavailable: "Modèle actuellement indisponible",
  targetNotRouted: "Routage désactivé",
  targetUnavailable: "Actuellement indisponible",
  aliasNameEmpty: "Saisissez un nom, comme whisper-1",
  aliasNameSlash: "Aucun « / » dans le nom : <provider>/<model> est canonique, sans conflit d’alias",
  aliasNameChars: "Lettres, chiffres et . _ : - seulement, début par lettre ou chiffre",
  aliasNameTaken: (name: string) => `« ${name} » existe déjà ; supprimez d’abord la ligne pour changer la cible`,
};
