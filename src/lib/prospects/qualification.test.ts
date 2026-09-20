import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();

let prisma: typeof import("@/lib/prisma").default;
let qualification: typeof import("./qualification");
let migration: typeof import("@/lib/base/migrations/priorite-leads");
let entrants: typeof import("./entrants");

before(async () => {
  prisma = (await import("@/lib/prisma")).default;
  qualification = await import("./qualification");
  migration = await import("@/lib/base/migrations/priorite-leads");
  entrants = await import("./entrants");
});
after(async () => {
  await prisma.$disconnect();
});

const REPONSES = (occupation: string, delai: string) =>
  JSON.stringify([
    { question: "Êtes-vous propriétaire ou locataire ?", reponse: occupation, cle: "proprietaire" },
    { question: "Quel est le délai de votre projet ?", reponse: delai, cle: "delai" },
    { question: "Quelle est la taille de votre cuisine ?", reponse: "5 à 10 façades", cle: "taille" },
  ]);

async function leadMeta(prenom: string, codePostal: string | null, reponses: string | null, notes: string | null = null) {
  const lead = await prisma.lead.create({ data: { prenom, nom: "Essai", telephone: `+336000${Math.floor(Math.random() * 90000 + 10000)}`, ville: "Ville", codePostal, source: "META_ADS", notes } });
  if (reponses) await prisma.metaLead.create({ data: { leadgenId: `q-${lead.id}`, leadId: lead.id, soumisLe: new Date(), statut: "TRAITE", reponses } });
  return lead.id;
}

describe("classement des contacts entrants", () => {
  test("sans zone saisie, personne n'est écarté", async () => {
    const id = await leadMeta("SansZone", "78660", REPONSES("Propriétaire", "Dès que possible"));
    const q = await qualification.classerLead(id);
    assert.equal(q?.priorite, "PRIORITAIRE", "propriétaire pressé, zone inconnue : on appelle");
  });

  test("la migration pose la zone une seule fois et classe les contacts actifs", async () => {
    const prioritaire = await leadMeta("Prioritaire", "34470", REPONSES("Propriétaire", "Dès que possible"));
    const horsZone = await leadMeta("HorsZone", "78660", REPONSES("Propriétaire", "Dès que possible"));
    const parNotes = await leadMeta("ParNotes", "34000", null, "Êtes-vous propriétaire ? : Non\nQuand ? : Plus de 6 mois");

    const premier = await migration.migrationPrioriteLeads.executer(prisma);
    assert.equal(premier.parametresPoses, 2);
    assert.ok(premier.contactsClasses >= 3);
    const second = await migration.migrationPrioriteLeads.executer(prisma);
    assert.equal(second.parametresPoses, 0, "la zone déjà saisie n'est pas réécrite");

    const lu = async (id: string) => prisma.lead.findUnique({ where: { id }, select: { priorite: true, prioriteMotif: true, occupation: true, delaiProjet: true, tailleCuisine: true } });
    assert.deepEqual(await lu(prioritaire), {
      priorite: "PRIORITAIRE",
      prioriteMotif: "propriétaire · délai court (« Dès que possible ») · dans la zone (34)",
      occupation: "PROPRIETAIRE",
      delaiProjet: "COURT",
      tailleCuisine: "5 à 10 façades",
    });
    assert.equal((await lu(horsZone))?.priorite, "A_ECARTER");
    assert.equal((await lu(parNotes))?.priorite, "SECONDAIRE", "les réponses gardées dans les notes sont lues aussi");
  });

  test("« je le traite quand même » : la classe posée à la main n'est plus recalculée", async () => {
    const id = await leadMeta("Decide", "78660", REPONSES("Propriétaire", "Dès que possible"));
    await qualification.classerLead(id);
    await entrants.modifierEntrant(id, { priorite: "PRIORITAIRE" });
    await qualification.reclasserLesContactsActifs();
    const lead = await prisma.lead.findUnique({ where: { id } });
    assert.deepEqual([lead?.priorite, lead?.prioriteManuelle], ["PRIORITAIRE", true]);

    await entrants.modifierEntrant(id, { priorite: "AUTO" });
    assert.equal((await prisma.lead.findUnique({ where: { id } }))?.priorite, "A_ECARTER", "« Recalculer » rend la main au calcul");
  });

  test("la liste « à traiter » sort dans l'ordre de valeur", async () => {
    const liste = await entrants.listerEntrants({ groupe: "A_TRAITER" });
    const rangs = liste.lignes.map((l) => ["PRIORITAIRE", "STANDARD", null, "SECONDAIRE", "A_ECARTER"].indexOf(l.priorite as string | null as never));
    assert.deepEqual(rangs, [...rangs].sort((a, b) => a - b));
    assert.equal(liste.lignes[0].priorite, "PRIORITAIRE");
  });

  test("un contact saisi à la main est classé aussitôt", async () => {
    const { id } = await entrants.creerEntrant({ prenom: "Manuel", nomFamille: "", telephone: "0611223344", email: null, ville: "Lattes", codePostal: "34970", source: "AUTRE", typeProjet: "CUISINE", notes: null });
    assert.equal((await prisma.lead.findUnique({ where: { id } }))?.priorite, "STANDARD");
  });
});
