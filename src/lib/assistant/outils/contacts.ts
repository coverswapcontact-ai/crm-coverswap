import { creerContactAssistant, schemaCreationContact } from "@/lib/prospects/creation-assistant";
import { definirOutil, lien } from "../definition";

/**
 * « creer_contact » (mission 11) : un lead ou un client de zéro, depuis un
 * appel ou un salon. Le rapprochement anti-doublon passe avant l'écriture :
 * une fiche qui a le même numéro, la même adresse e-mail, ou le même nom dans
 * la même ville arrête la création — l'outil rend la fiche existante et ce
 * qu'il faut faire à la place. Réversible : « supprimer » (corbeille).
 */

export const outilCreerContact = definirOutil({
  nom: "creer_contact",
  titre: "Créer un contact (lead ou client) de zéro",
  description:
    "Crée un contact dicté par Lucas (appel, salon, bouche-à-oreille) : nom, téléphone, e-mail, ville, source, projet ; il rejoint la fiche client qui a ces coordonnées ou en crée une, et entre dans la file des leads. AVANT d'écrire, l'outil cherche un doublon (même numéro, même e-mail, même nom dans la même ville) : s'il en trouve, rien n'est créé et la fiche existante est rendue — utilise-la (« lire_fiche », « ajouter_note », « ouvrir_dossier »), ou relance avec forcer: true si Lucas confirme que c'est bien une autre personne. ouvrir_dossier: true ouvre aussi le dossier du projet.",
  niveau: "REVERSIBLE",
  schema: schemaCreationContact,
  executer: async (e) => {
    const r = await creerContactAssistant(e);
    if (!r.cree) {
      const lignes = r.doublons.map((d) => `- ${d.type === "CLIENT" ? "Client" : "Lead"} ${d.nom}${d.ville ? ` (${d.ville})` : ""} : ${d.motif} [${d.type.toLowerCase()}:${d.id}]`);
      return {
        texte: `Rien n'a été créé : ${r.doublons.length > 1 ? "des fiches existent déjà" : "une fiche existe déjà"} pour ce contact.\n${lignes.join("\n")}\nÀ faire : lire la fiche existante (« lire_fiche »), y noter l'appel (« ajouter_note ») ou ouvrir son dossier (« ouvrir_dossier »). Si Lucas confirme que c'est une autre personne, relance « creer_contact » avec forcer: true.`,
        donnees: { cree: false, doublons: r.doublons },
        liens: r.doublons.map((d) => lien(d.type === "CLIENT" ? `Client ${d.nom}` : `Lead ${d.nom}`, d.type === "CLIENT" ? `/clients?client=${d.id}` : `/leads?lead=${d.id}`)),
      };
    }
    const c = r.cree;
    return {
      texte: `Contact créé : ${c.nom || "sans nom"}${e.ville ? ` (${e.ville})` : ""}, source ${e.source ?? "AUTRE"}, projet ${e.type_projet ?? "CUISINE"}${c.dossierId ? ", dossier ouvert" : ""}. Il est dans la file des leads à appeler.${r.doublons.length ? ` Créé malgré ${r.doublons.length} doublon(s) probable(s), sur ta demande.` : ""}`,
      donnees: { cree: true, leadId: c.leadId, clientId: c.clientId, dossierId: c.dossierId, doublonsIgnores: r.doublons },
      liens: [lien("Fiche du lead", `/leads?lead=${c.leadId}`), ...(c.dossierId ? [lien("Dossier", `/dossiers?dossier=${c.dossierId}`)] : [])],
    };
  },
});

export const OUTILS_CONTACTS = [outilCreerContact];
