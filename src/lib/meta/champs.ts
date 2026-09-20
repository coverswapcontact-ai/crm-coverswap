import { normaliserEmail, normaliserTelephone } from "@/lib/clients/normalisation";
import { TYPES_PROJET, type TypeProjet } from "@/lib/prospects/constantes";

/**
 * Traduction d'un formulaire Meta Lead Ads en champs du CRM.
 *
 * Meta rend les réponses en `field_data` : [{ name, values }]. Les questions
 * standard ont des noms connus (full_name, phone_number, email, city,
 * post_code…), les questions personnalisées portent le libellé écrit par
 * l'annonceur, souvent en français, parfois avec la question entière.
 *
 * Règle : ce qu'on sait reconnaître va dans un champ propre, TOUT le reste est
 * conservé mot pour mot (question + réponse) et rien n'est jeté.
 *
 * Fonctions pures, testées.
 */
export type ChampMeta = { name: string; values?: (string | null)[] };

export type ReponseFormulaire = {
  /** Libellé lisible de la question, tel qu'il s'affiche dans la fiche. */
  question: string;
  reponse: string;
  /** Nom du champ chez Meta, gardé pour retrouver l'origine d'une réponse. */
  cle: string;
};

export type LeadMetaNormalise = {
  prenom: string;
  nom: string;
  telephone: string;
  email: string | null;
  ville: string | null;
  codePostal: string | null;
  typeProjet: TypeProjet;
  /** Toutes les réponses, questions personnalisées comprises, dans l'ordre du formulaire. */
  reponses: ReponseFormulaire[];
  /** Les réponses qui ne sont pas déjà dans un champ propre, prêtes à lire dans la fiche. */
  reponsesLibres: ReponseFormulaire[];
};

type Nature = "prenom" | "nom" | "nomComplet" | "telephone" | "email" | "ville" | "codePostal" | "projet";

const CLES_STANDARD: Record<string, Nature | undefined> = {
  first_name: "prenom",
  last_name: "nom",
  full_name: "nomComplet",
  phone_number: "telephone",
  email: "email",
  city: "ville",
  post_code: "codePostal",
  zip_code: "codePostal",
  street_address: "ville",
};

/** Libellé lisible d'une question : « quelle_piece_souhaitez_vous_renover? » → « Quelle pièce souhaitez-vous rénover ? ». */
export function libelleQuestion(nom: string): string {
  const texte = nom.replace(/_/g, " ").replace(/\s+/g, " ").trim();
  if (!texte) return nom;
  const avecEspaceAvantPonctuation = texte.replace(/\s*([?!:;])\s*$/, " $1");
  return avecEspaceAvantPonctuation.charAt(0).toUpperCase() + avecEspaceAvantPonctuation.slice(1);
}

function sansAccent(texte: string): string {
  return texte
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/** Nature du champ quand la question est personnalisée (écrite en français par l'annonceur). */
function reconnaitre(nom: string): Nature | null {
  const cle = sansAccent(nom);
  if (/code\s*postal|\bcp\b|zip|postcode/.test(cle)) return "codePostal";
  if (/ville|commune|city|ou_habitez|ou etes|secteur|localite/.test(cle)) return "ville";
  if (/tele|phone|portable|mobile|numero/.test(cle)) return "telephone";
  if (/mail|courriel/.test(cle)) return "email";
  if (/projet|piece|type de|que souhaitez|renover|chantier/.test(cle)) return "projet";
  return null;
}

/** Type de projet déduit de la réponse (« Cuisine », « salle de bains », « mon local »…). */
export function typeProjetDepuisTexte(texte: string | null | undefined): TypeProjet | null {
  const t = sansAccent(texte ?? "");
  if (!t.trim()) return null;
  if (/cuisine/.test(t)) return "CUISINE";
  if (/salle de bain|sdb|douche|salle d eau/.test(t)) return "SDB";
  if (/meuble|dressing|placard|commode|buffet|tv/.test(t)) return "MEUBLES";
  if (/local|bureau|commerce|magasin|boutique|restaurant|hotel|professionnel|entreprise|comptoir|bar/.test(t)) return "PRO";
  return null;
}

/** Sépare un nom complet : premier mot au prénom, le reste au nom. */
export function separerNomComplet(complet: string): { prenom: string; nom: string } {
  const parties = complet.trim().split(/\s+/).filter(Boolean);
  if (parties.length === 0) return { prenom: "", nom: "" };
  if (parties.length === 1) return { prenom: parties[0], nom: parties[0] };
  return { prenom: parties[0], nom: parties.slice(1).join(" ") };
}

const CODE_POSTAL = /\b\d{5}\b/;

export function normaliserLeadMeta(champs: ChampMeta[]): LeadMetaNormalise {
  const reponses: ReponseFormulaire[] = [];
  const reconnues = new Set<string>();
  let prenom = "";
  let nom = "";
  let nomComplet = "";
  let telephone = "";
  let email: string | null = null;
  let ville: string | null = null;
  let codePostal: string | null = null;
  let projetTexte: string | null = null;

  for (const champ of champs ?? []) {
    const valeur = (champ?.values ?? []).filter((v): v is string => typeof v === "string" && v.trim() !== "").join(", ").trim();
    const cleBrute = String(champ?.name ?? "").trim();
    if (!cleBrute) continue;
    if (valeur) reponses.push({ question: libelleQuestion(cleBrute), reponse: valeur, cle: cleBrute });
    if (!valeur) continue;

    const standard = CLES_STANDARD[cleBrute.toLowerCase()];
    const nature = standard ?? reconnaitre(cleBrute);
    switch (nature) {
      case "prenom":
        prenom = valeur;
        reconnues.add(cleBrute);
        break;
      case "nom":
        nom = valeur;
        reconnues.add(cleBrute);
        break;
      case "nomComplet":
        nomComplet = valeur;
        reconnues.add(cleBrute);
        break;
      case "telephone":
        if (!telephone) telephone = valeur;
        reconnues.add(cleBrute);
        break;
      case "email":
        if (!email) email = normaliserEmail(valeur) ?? valeur;
        reconnues.add(cleBrute);
        break;
      case "ville": {
        // Champ libre côté Meta : « Ablis », « 78660 », « 78660 Ablis », une adresse entière.
        // On en sort le code postal, et ce qui reste est la ville — rien si c'était le seul code postal.
        if (!codePostal) codePostal = CODE_POSTAL.exec(valeur)?.[0] ?? null;
        const reste = valeur
          .replace(CODE_POSTAL, " ")
          .replace(/\s{2,}/g, " ")
          .replace(/^[\s,;-]+|[\s,;-]+$/g, "");
        if (!ville) ville = reste || null;
        reconnues.add(cleBrute);
        break;
      }
      case "codePostal":
        if (!codePostal) codePostal = CODE_POSTAL.exec(valeur)?.[0] ?? valeur.trim();
        reconnues.add(cleBrute);
        break;
      case "projet":
        if (!projetTexte) projetTexte = valeur;
        // La question du projet reste lisible dans la fiche : elle porte souvent plus que le type.
        break;
      default:
        break;
    }
  }

  if (!prenom && !nom && nomComplet) ({ prenom, nom } = separerNomComplet(nomComplet));
  else if (nomComplet && (!prenom || !nom)) {
    const separe = separerNomComplet(nomComplet);
    prenom = prenom || separe.prenom;
    nom = nom || separe.nom;
  }
  if (prenom && !nom) nom = prenom;
  if (!prenom && nom) prenom = nom;

  const typeProjet = typeProjetDepuisTexte(projetTexte) ?? typeProjetDepuisTexte(reponses.map((r) => `${r.question} ${r.reponse}`).join(" ")) ?? "CUISINE";

  return {
    prenom: prenom || "Inconnu",
    nom: nom || "Inconnu",
    telephone: normaliserTelephone(telephone) ?? telephone.trim(),
    email,
    ville: ville?.trim() || null,
    codePostal: codePostal?.trim() || null,
    typeProjet: TYPES_PROJET.includes(typeProjet) ? typeProjet : "CUISINE",
    reponses,
    reponsesLibres: reponses.filter((r) => !reconnues.has(r.cle)),
  };
}

/** Les réponses telles qu'elles s'affichent dans la fiche du contact. */
export function texteDesReponses(reponses: ReponseFormulaire[]): string {
  return reponses.map((r) => `${r.question} : ${r.reponse}`).join("\n");
}
