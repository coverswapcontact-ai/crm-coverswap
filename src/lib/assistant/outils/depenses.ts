import { z } from "zod/v4";
import prisma from "@/lib/prisma";
import { CODES_CATEGORIE, libelleCategorie } from "@/lib/depenses/constantes";
import { definirOutil, format, lien } from "../definition";
import { resoudrePeriode, schemaPeriode } from "../periodes";
import { pluriel } from "@/lib/commun/format";

/**
 * « Qu'est-ce que j'ai dépensé en pub ce mois-ci ? » (mission 10) : les
 * dépenses d'une période, par catégorie, rattachées à un chantier ou non ; ce
 * qui n'est rattaché à rien est repéré (à rattacher, ou à marquer hors chantier).
 */

export const outilDepenses = definirOutil({
  nom: "depenses",
  titre: "Les dépenses d'une période",
  description:
    "Les dépenses payées sur une période (défaut : le mois en cours), avec le total, le détail par catégorie (matière, fournitures, sous-traitance, déplacement, outillage, publicité, logiciels, assurance, banque, formation, autre), et la part rattachée à un chantier, hors chantier, ou pas encore rattachée (à traiter : « rattacher_depense »). « categorie » pour une seule ; « rattachement » pour filtrer.",
  niveau: "LECTURE",
  schema: schemaPeriode.extend({
    categorie: z.enum(CODES_CATEGORIE).optional(),
    rattachement: z.enum(["toutes", "chantier", "hors_chantier", "non_rattachees"]).optional().describe("Défaut : toutes."),
    limite: z.number().int().min(1).max(100).optional().describe("Lignes détaillées rendues (défaut 25)."),
  }),
  executer: async (e, contexte) => {
    const { periode } = resoudrePeriode({ ...e, periode: e.periode ?? (e.du && e.au ? undefined : "mois_en_cours") }, contexte.maintenant);
    const depenses = await prisma.depense.findMany({
      where: { archiveLe: null, payeeLe: { gte: periode.debut, lt: periode.fin }, ...(e.categorie ? { categorie: e.categorie } : {}) },
      orderBy: [{ payeeLe: "desc" }, { createdAt: "desc" }],
      include: { dossier: { select: { id: true, clientNom: true } }, justificatif: { select: { id: true } } },
    });
    const filtre = (d: (typeof depenses)[number]) => (e.rattachement === "chantier" ? Boolean(d.dossierId) : e.rattachement === "hors_chantier" ? d.horsChantier && !d.dossierId : e.rattachement === "non_rattachees" ? !d.dossierId && !d.horsChantier : true);
    const liste = depenses.filter(filtre);
    const centimes = (l: { montant: number }[]) => Math.round(l.reduce((s, d) => s + d.montant * 100, 0)) / 100;
    const total = centimes(liste);
    const parCategorie = CODES_CATEGORIE.map((code) => ({ categorie: code, libelle: libelleCategorie(code), total: centimes(liste.filter((d) => d.categorie === code)), nombre: liste.filter((d) => d.categorie === code).length })).filter((c) => c.nombre > 0);
    const rattachees = liste.filter((d) => d.dossierId);
    const horsChantier = liste.filter((d) => !d.dossierId && d.horsChantier);
    const nonRattachees = liste.filter((d) => !d.dossierId && !d.horsChantier);
    const sansJustificatif = liste.filter((d) => !d.justificatifId).length;
    const ligne = (d: (typeof depenses)[number]) => `${format.jourCourt(d.payeeLe)} ${format.euros(d.montant)} ${d.fournisseur}${d.libelle ? ` — ${d.libelle}` : ""} (${libelleCategorie(d.categorie).toLowerCase()}) ${d.dossier ? `→ chantier ${d.dossier.clientNom}` : d.horsChantier ? "· hors chantier" : "· NON RATTACHÉE"}${d.justificatifId ? "" : " · sans justificatif"} [depense:${d.id}]`;
    const texte = [
      `Dépenses ${periode.libelle}${e.categorie ? `, ${libelleCategorie(e.categorie).toLowerCase()}` : ""}${e.rattachement && e.rattachement !== "toutes" ? ` (${e.rattachement.replace(/_/g, " ")})` : ""} : ${format.euros(total)} en ${pluriel(liste.length, "dépense")}.`,
      parCategorie.length > 1 ? `Par catégorie : ${parCategorie.map((c) => `${c.libelle} ${format.euros(c.total)} (${c.nombre})`).join(" · ")}.` : "",
      `Rattachées à un chantier : ${format.euros(centimes(rattachees))} (${rattachees.length}) ; hors chantier : ${format.euros(centimes(horsChantier))} (${horsChantier.length}) ; pas encore rattachées : ${format.euros(centimes(nonRattachees))} (${nonRattachees.length})${sansJustificatif ? ` ; ${sansJustificatif} sans justificatif` : ""}.`,
      nonRattachees.length ? `À rattacher (ou à marquer hors chantier) : ${nonRattachees.slice(0, 10).map(ligne).join(" · ")}` : "",
      liste.length ? `Détail :\n${liste.slice(0, e.limite ?? 25).map(ligne).join("\n")}${liste.length > (e.limite ?? 25) ? `\n… ${liste.length - (e.limite ?? 25)} de plus` : ""}` : "",
    ].filter(Boolean).join("\n");
    return { texte, donnees: { periode: { du: periode.du, au: periode.au }, total, parCategorie, rattachees: centimes(rattachees), horsChantier: centimes(horsChantier), nonRattachees: nonRattachees.map((d) => ({ id: d.id, montant: d.montant, fournisseur: d.fournisseur, categorie: d.categorie, payeeLe: d.payeeLe })), depenses: liste.slice(0, e.limite ?? 25).map((d) => ({ id: d.id, payeeLe: d.payeeLe, montant: d.montant, fournisseur: d.fournisseur, libelle: d.libelle, categorie: d.categorie, dossier: d.dossier, horsChantier: d.horsChantier, justificatif: Boolean(d.justificatifId) })) }, liens: [lien("Dépenses", "/depenses")] };
  },
});

export const OUTILS_DEPENSES = [outilDepenses];
