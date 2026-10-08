import type { ChatMessages } from './chat-copy.ts';

export const fr: ChatMessages = {

  help: `Utilisation :
  baocut chat <message> [options]  Envoyer un message et afficher la réponse
    --project <dir>                Discuter dans ce dossier de projet (identifié par .bcut/project.json,
                                   créé dans le dossier si absent)
    --conversation <id>            Continuer une session existante
    --template <id>                Joindre un modèle de scène (de baocut templates) : le Runtime ajoute le guide
                                   de briefing et le contenu du modèle au message ; les exemples ne peuvent pas être joints ;
                                   envoyez leur prompt (baocut templates show <id>) comme message
    --skill <id>                   Choisir un Skill (de baocut skills, même désactivé) :
                                   le Runtime ajoute le contenu de son SKILL.md au message
    --mode <ask|auto-accept-edits|auto|full-access|plan>
                                   Changer le mode d’accès de cette session (pour les actions suivantes) ; sinon le mode
                                   reste inchangé, ou agent.defaultAccessMode est utilisé (auto par défaut) si jamais changé
    --yes                          Approuver automatiquement les demandes (cette session uniquement)`,
  missingMessage: "Texte du message manquant",
  templateIsExample: (title: string, id: string) =>
    `« ${title} » est un exemple et ne peut pas être joint : récupérez son prompt avec baocut templates show ${id} et envoyez-le comme message`,
  sessionCreated: (id: string, cwd: string) => `Session ${id}  dossier de travail ${cwd}`,
  disconnected: (reason: string) => `Connexion au Runtime perdue : ${reason}`,
  sessionDeleted: "La session a été supprimée",
  stopping: "Arrêt…",
  chatTemplate: (id: string) => `Modèle : ${id}`,
  chatSkill: (id: string) => `Skill : ${id}`,
  chatMode: (mode: string) => `Mode d’accès : ${mode}`,

  taskEnded: (status: string, error: string | null) => `Tâche : ${status}${error ? ` — ${error}` : ""}`,
  taskStatus: { completed: "Terminé", stopped: "Arrêté", failed: "Échec" } as Readonly<Record<string, string>>,
  taskFailed: "Échec de la tâche",
  toolCallFinished: (title: string, status: string, exitCode: number | null) =>
    `▸ ${title} — ${status}${exitCode !== null ? ` (code de sortie ${exitCode})` : ""}`,
  approvalNeeded: (what: string) => `Approbation requise — ${what}`,
  approvalReason: (isTool: boolean, reason: string) => `${isTool ? "Contenu" : "Motif"} : ${reason}`,
  approvalMode: (mode: string) => `Mode actuel : ${mode}`,
  autoApproved: "Approuvé automatiquement (--yes)",
  declinedNotTty: "Hors d’un terminal : refusé (ajoutez --yes pour approuver automatiquement)",
  approvalQuestion: "Approuver ? [y]oui / [s]session / [N]non ",
};
