import type { EspaceClient } from "@prisma/client";
import { z } from "zod/v4";
import prisma from "@/lib/prisma";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { avecActeur } from "@/lib/journal/contexte";
import { completerCoordonnees } from "@/lib/clients/identification";
import { formaterTelephone, nomAffichage, normaliserEmail, normaliserTelephone } from "@/lib/clients/normalisation";
import { ACTEUR, prevenir } from "./alertes";

/**
 * Mission 6 (22/09/2026) — « Vérifiez vos coordonnées », dans l'espace.
 *
 * Prénom, nom, e-mail et téléphone appartiennent au CLIENT (sa fiche, et une
 * copie sur chacun de ses dossiers en cours) ; l'adresse appartient au PROJET
 * (le dossier : un client peut avoir plusieurs biens). Tout est prérempli avec
 * ce que l'on sait, rien n'est exigé pour continuer ; une modification met à
 * jour la fiche et les dossiers (donc le devis et la facture), et l'historique
 * garde l'ancienne et la nouvelle valeur. Un téléphone changé prévient Lucas :
 * c'est la clé qui reconnaît le client et sécurise son espace.
 */

export type CoordonneesEspace = {
  prenom: string;
  nomFamille: string;
  /** « Prénom Nom » (ancien champ, lu par les écrans du 21/09). */
  nom: string;
  email: string | null;
  /** Lisible : 06 12 34 56 78. */
  telephone: string;
  adresse: string;
  codePostal: string;
  ville: string;
  /** Tout est rempli et valide : pastille verte. */
  completes: boolean;
  /** Ce qui manque, en mots (« votre prénom », « l'adresse du chantier »). */
  manque: string[];
};

const INCONNU = /^(inconnu|inconnue|client|non renseign[ée]|-)$/i;
const utile = (valeur: string | null | undefined) => {
  const v = (valeur ?? "").trim().replace(/\s+/g, " ");
  return v && !INCONNU.test(v) ? v : "";
};

type Sources = {
  dossier: { clientNom: string; clientEmail: string | null; clientTelephone: string; clientAdresse: string; clientCp: string; clientVille: string };
  client: { prenom: string | null; nomFamille: string | null; categorie: string } | null;
  lead: { prenom: string; nom: string } | null;
};

/** Ce que l'on sait déjà, dans l'ordre de confiance : la fiche client, le lead d'origine, le nom du dossier. Pure. */
export function lireCoordonnees({ dossier, client, lead }: Sources): CoordonneesEspace {
  let prenom = utile(client?.prenom);
  let nomFamille = utile(client?.nomFamille);
  if (!prenom && !nomFamille && lead) [prenom, nomFamille] = [utile(lead.prenom), utile(lead.nom)];
  if (!prenom && !nomFamille) {
    const mots = utile(dossier.clientNom).split(" ").filter(Boolean);
    [prenom, nomFamille] = mots.length > 1 ? [mots[0], mots.slice(1).join(" ")] : ["", mots[0] ?? ""];
  }
  const email = normaliserEmail(dossier.clientEmail);
  const numero = normaliserTelephone(dossier.clientTelephone);
  const adresse = dossier.clientAdresse.trim();
  const codePostal = dossier.clientCp.trim();
  const ville = dossier.clientVille.trim();
  const manque = [
    ...(prenom ? [] : ["votre prénom"]),
    ...(nomFamille ? [] : ["votre nom"]),
    ...(email ? [] : ["votre e-mail"]),
    ...(numero ? [] : ["votre téléphone"]),
    ...(adresse.length >= 3 && /^\d{5}$/.test(codePostal) && ville ? [] : ["l'adresse du chantier"]),
  ];
  return {
    prenom,
    nomFamille,
    nom: nomAffichage({ prenom, nomFamille }) ?? utile(dossier.clientNom),
    email,
    telephone: numero ? formaterTelephone(numero) : utile(dossier.clientTelephone),
    adresse,
    codePostal,
    ville,
    completes: manque.length === 0,
    manque,
  };
}

const texte = (max: number) => z.string().trim().max(max).optional();

/**
 * Tout est facultatif : le client corrige un seul champ s'il veut. Ce qui est
 * envoyé est vérifié (e-mail, téléphone, code postal). L'ancien format
 * (`nom` + adresse + e-mail, écran du devis du 21/09) reste accepté.
 */
export const schemaCoordonnees = z
  .object({
    prenom: texte(80),
    nomFamille: texte(80),
    nom: texte(120),
    email: z.string().trim().max(160).refine((v) => v === "" || normaliserEmail(v) !== null, "Cette adresse e-mail ne semble pas valide (exemple : prenom.nom@gmail.com).").optional(),
    telephone: z.string().trim().max(40).refine((v) => v === "" || normaliserTelephone(v) !== null, "Ce numéro ne semble pas valide (exemple : 06 12 34 56 78).").optional(),
    adresse: texte(200),
    codePostal: z.string().trim().refine((v) => v === "" || /^\d{5}$/.test(v), "Code postal : cinq chiffres.").optional(),
    ville: texte(80),
  })
  .refine((e) => !e.adresse || e.adresse.length >= 3, { message: "Indiquez le numéro et la rue.", path: ["adresse"] });
export type EntreeCoordonnees = z.output<typeof schemaCoordonnees>;

type Changement = { champ: string; libelle: string; avant: string; apres: string };
/** Pour l'historique : « adresse du chantier ajoutée », « prénom ajouté ». */
const FEMININS = new Set(["adresse", "ville"]);

/** Le client enregistre ses coordonnées depuis son espace. Rend ce qui a changé. */
export async function enregistrerCoordonnees(espace: Pick<EspaceClient, "dossierId">, entree: EntreeCoordonnees): Promise<{ changements: Changement[] }> {
  const dossier = await prisma.dossier.findUnique({
    where: { id: espace.dossierId },
    select: {
      id: true, clientId: true, clientNom: true, clientEmail: true, clientTelephone: true, clientAdresse: true, clientCp: true, clientVille: true,
      client: { select: { id: true, prenom: true, nomFamille: true, categorie: true, adresse: true, codePostal: true, ville: true } },
      lead: { select: { prenom: true, nom: true } },
    },
  });
  if (!dossier) throw new ErreurMetier("Projet introuvable.", 404);
  const avant = lireCoordonnees({ dossier, client: dossier.client, lead: dossier.lead });

  // Ancien format : un seul champ « nom » (« Prénom Nom »).
  let prenom = entree.prenom;
  let nomFamille = entree.nomFamille;
  if (prenom === undefined && nomFamille === undefined && entree.nom) {
    const mots = entree.nom.trim().split(/\s+/);
    [prenom, nomFamille] = mots.length > 1 ? [mots[0], mots.slice(1).join(" ")] : [avant.prenom, mots[0]];
  }
  const apres = {
    prenom: prenom !== undefined ? prenom.trim() : avant.prenom,
    nomFamille: nomFamille !== undefined ? nomFamille.trim() : avant.nomFamille,
    email: entree.email !== undefined ? (entree.email ? normaliserEmail(entree.email) : null) : avant.email,
    numero: entree.telephone !== undefined ? (entree.telephone ? normaliserTelephone(entree.telephone) : null) : normaliserTelephone(dossier.clientTelephone),
    adresse: entree.adresse !== undefined ? entree.adresse : dossier.clientAdresse,
    codePostal: entree.codePostal !== undefined ? entree.codePostal : dossier.clientCp,
    ville: entree.ville !== undefined ? entree.ville : dossier.clientVille,
  };
  // Ce qui est connu ne s'efface pas depuis l'espace : un champ vidé garde l'ancienne valeur.
  if (!apres.prenom) apres.prenom = avant.prenom;
  if (!apres.nomFamille) apres.nomFamille = avant.nomFamille;
  if (!apres.email) apres.email = avant.email;
  const numeroAvant = normaliserTelephone(dossier.clientTelephone);
  if (!apres.numero) apres.numero = numeroAvant;
  if (!apres.adresse.trim()) apres.adresse = dossier.clientAdresse;
  if (!apres.codePostal.trim()) apres.codePostal = dossier.clientCp;
  if (!apres.ville.trim()) apres.ville = dossier.clientVille;

  const changements: Changement[] = [];
  const noter = (champ: string, libelle: string, a: string | null | undefined, b: string | null | undefined) => {
    if ((a ?? "").trim() !== (b ?? "").trim()) changements.push({ champ, libelle, avant: (a ?? "").trim(), apres: (b ?? "").trim() });
  };
  noter("prenom", "prénom", avant.prenom, apres.prenom);
  noter("nomFamille", "nom", avant.nomFamille, apres.nomFamille);
  noter("email", "e-mail", avant.email, apres.email);
  noter("telephone", "téléphone", numeroAvant ? formaterTelephone(numeroAvant) : dossier.clientTelephone, apres.numero ? formaterTelephone(apres.numero) : "");
  noter("adresse", "adresse du chantier", dossier.clientAdresse, apres.adresse);
  noter("codePostal", "code postal", dossier.clientCp, apres.codePostal);
  noter("ville", "ville", dossier.clientVille, apres.ville);
  // Mission 13 (B2) : la fiche du client reçoit l'e-mail et le téléphone du dossier, même quand le client ne change rien
  // (le cas vécu : coordonnées connues du dossier, fiche « sans e-mail, sans téléphone »). Rien n'est retiré.
  const completerFiche = async () => {
    if (dossier.client) await avecActeur(ACTEUR, () => completerCoordonnees(prisma, dossier.client!.id, { emails: [apres.email], telephones: [apres.numero] }));
  };
  if (changements.length === 0) {
    await completerFiche();
    return { changements };
  }

  const nomComplet = nomAffichage({ prenom: apres.prenom, nomFamille: apres.nomFamille }) ?? dossier.clientNom;
  const telephoneChange = changements.some((c) => c.champ === "telephone");
  await avecActeur(ACTEUR, () =>
    prisma.$transaction(async (tx) => {
      // Le numéro n'est réécrit que s'il a changé : celui du dossier garde sinon sa forme saisie.
      const identite = { clientNom: nomComplet, clientEmail: apres.email, ...(apres.numero && telephoneChange ? { clientTelephone: apres.numero } : {}) };
      // Le projet : son adresse, et l'identité du client.
      await tx.dossier.update({
        where: { id: dossier.id },
        data: { ...identite, clientAdresse: apres.adresse.trim(), clientCp: apres.codePostal.trim(), clientVille: apres.ville.trim() },
      });
      if (dossier.client) {
        const clientId = dossier.client.id;
        // Ses autres projets en cours reçoivent la même identité (l'adresse reste celle de chaque bien).
        await tx.dossier.updateMany({ where: { clientId, id: { not: dossier.id }, archiveLe: null, etape: { notIn: ["ENCAISSE", "PERDU"] } }, data: identite });
        await tx.client.update({
          where: { id: clientId },
          data: {
            prenom: apres.prenom || null,
            nomFamille: apres.nomFamille || null,
            ...(dossier.client.categorie === "PARTICULIER" ? { nom: nomComplet } : {}),
            // L'adresse de la fiche est celle de son premier bien : remplie si elle manquait, jamais écrasée.
            ...(!dossier.client.adresse && apres.adresse.trim() ? { adresse: apres.adresse.trim(), codePostal: apres.codePostal.trim() || null, ville: apres.ville.trim() || null } : {}),
          },
        });
        // E-mail et téléphone : le nouveau devient principal ; l'ancien reste sur la fiche (rien ne s'efface).
        if (apres.email && changements.some((c) => c.champ === "email")) {
          const existant = await tx.clientEmail.findFirst({ where: { clientId, adresse: apres.email } });
          await tx.clientEmail.updateMany({ where: { clientId, principale: true }, data: { principale: false } });
          if (existant) await tx.clientEmail.update({ where: { id: existant.id }, data: { principale: true, archiveLe: null, archiveMotif: null } });
          else await tx.clientEmail.create({ data: { clientId, adresse: apres.email, principale: true, libelle: "donné dans son espace" } });
        }
        if (apres.numero && telephoneChange) {
          const existant = await tx.clientTelephone.findFirst({ where: { clientId, numero: apres.numero } });
          await tx.clientTelephone.updateMany({ where: { clientId, principal: true }, data: { principal: false } });
          if (existant) await tx.clientTelephone.update({ where: { id: existant.id }, data: { principal: true, archiveLe: null, archiveMotif: null } });
          else await tx.clientTelephone.create({ data: { clientId, numero: apres.numero, saisi: (entree.telephone ?? apres.numero).slice(0, 40), principal: true, libelle: "donné dans son espace" } });
        }
      }
      await tx.dossierEvenement.create({
        data: {
          dossierId: dossier.id,
          type: "ESPACE_COORDONNEES",
          direction: "ENTRANT",
          contenu: `Le client a mis à jour ses coordonnées : ${changements.map((c) => (c.avant ? `${c.libelle} « ${c.avant} » → « ${c.apres} »` : `${c.libelle} ${FEMININS.has(c.champ) ? "ajoutée" : "ajouté"} : « ${c.apres} »`)).join(" ; ")}`.slice(0, 1500),
          metadata: JSON.stringify({ changements }),
        },
      });
    })
  );

  await completerFiche();

  if (telephoneChange) {
    const c = changements.find((x) => x.champ === "telephone")!;
    await prevenir(dossier.id, {
      titre: `Téléphone changé par le client — ${nomComplet}`,
      texte: `${c.avant || "(aucun)"} → ${c.apres}\nC'est ce numéro qui reconnaît le client et qui sécurise son espace (confirmation des 4 derniers chiffres). Si ce changement vous surprend, appelez l'ancien numéro.`,
      urgence: 4,
      telephone: c.avant ? normaliserTelephone(c.avant) : null,
      etiquette: `telephone-${dossier.id}`,
    });
  }
  return { changements };
}
