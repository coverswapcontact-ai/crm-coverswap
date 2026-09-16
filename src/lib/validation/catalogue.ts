import {
  propositionChangementEtape,
  propositionNoteDossier,
  propositionProchaineAction,
} from "@/lib/dossiers/propositions";
import { propositionFusionClients } from "@/lib/clients/fusion";
import { propositionEnvoiMail } from "@/lib/mail/propositions";
import {
  propositionArchiverMessage,
  propositionClasserMessage,
  propositionNouvelleDemande,
  propositionRattacherMessage,
} from "@/lib/messages/propositions";
import { propositionAnonymisationClient } from "@/lib/rgpd/propositions";
import type { DefinitionProposition } from "./definitions";

/**
 * Tous les types de propositions, déclarés explicitement : ce fichier est la
 * liste de tout ce qu'un agent ou le système peut proposer. Les fichiers de
 * définitions n'importent jamais le service de validation (pas de cycle).
 */
const CATALOGUE: readonly DefinitionProposition<never>[] = [
  propositionNoteDossier,
  propositionProchaineAction,
  propositionChangementEtape,
  propositionFusionClients,
  propositionEnvoiMail,
  propositionRattacherMessage,
  propositionNouvelleDemande,
  propositionArchiverMessage,
  propositionClasserMessage,
  propositionAnonymisationClient,
] as unknown as DefinitionProposition<never>[];

// Types ajoutés à l'exécution (tests).
const CLE = "__coverswapTypesPropositionSupplementaires";
const globalSupplementaires = globalThis as unknown as Record<string, Map<string, DefinitionProposition<never>> | undefined>;
const supplementaires = (globalSupplementaires[CLE] ??= new Map());

export function enregistrerTypeProposition<C extends Record<string, unknown>>(definition: DefinitionProposition<C>): void {
  supplementaires.set(definition.type, definition as unknown as DefinitionProposition<never>);
}

export function definitionDe(type: string): DefinitionProposition<Record<string, unknown>> | undefined {
  const trouvee = CATALOGUE.find((definition) => definition.type === type) ?? supplementaires.get(type);
  return trouvee as unknown as DefinitionProposition<Record<string, unknown>> | undefined;
}

export function typesDePropositions(): { type: string; libelle: string }[] {
  return [...CATALOGUE, ...supplementaires.values()].map((definition) => ({
    type: definition.type,
    libelle: definition.libelle,
  }));
}
