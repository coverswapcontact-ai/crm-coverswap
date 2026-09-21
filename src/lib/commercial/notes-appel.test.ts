import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();
process.env.UPLOADS_DIR = mkdtempSync(path.join(tmpdir(), "coverswap-notes-appel-"));

let prisma: typeof import("@/lib/prisma").default;
let notes: typeof import("./notes-appel");
let appels: typeof import("./appels");
let depuisLead: typeof import("@/lib/dossiers/depuis-lead");

let compteur = 10;
async function contact(prenom: string) {
  return prisma.lead.create({ data: { prenom, nom: "Essai", telephone: `+336450000${compteur++}`, ville: "Lattes", codePostal: "34970", source: "META_ADS" } });
}

before(async () => {
  for (const cle of ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "NTFY_TOPIC", "RESEND_API_KEY"]) delete process.env[cle];
  prisma = (await import("@/lib/prisma")).default;
  notes = await import("./notes-appel");
  appels = await import("./appels");
  depuisLead = await import("@/lib/dossiers/depuis-lead");
});
after(async () => {
  await prisma.$disconnect();
});

describe("notes d'appel", () => {
  test("deux appels s'empilent, datés ; le texte et les étiquettes s'enregistrent au fil de la frappe", async () => {
    const lead = await contact("Albert");
    const premier = await notes.creerNoteAppel(lead.id, { appelLe: new Date(Date.now() - 2 * 86_400_000).toISOString(), texte: "Cuisine de 2010" });
    await notes.modifierNoteAppel(lead.id, premier.id, { texte: "Cuisine de 2010, trouve ça cher", etiquettes: ["TROP_CHER", "TROP_CHER", "COMPARE_DEVIS"] });
    const second = await notes.creerNoteAppel(lead.id, { texte: "Rappelé : veut d'abord un rendu" });
    const liste = await notes.notesDuLead(lead.id);
    assert.deepEqual(liste.map((n) => n.id), [second.id, premier.id], "la plus récente en haut");
    assert.equal(liste[1].texte, "Cuisine de 2010, trouve ça cher");
    assert.deepEqual(liste[1].etiquettes, ["TROP_CHER", "COMPARE_DEVIS"], "une étiquette ne compte qu'une fois");
    assert.equal(liste[1].dansDossier, false, "sans dossier, la note reste sur la fiche du contact");
  });

  test("une étiquette inconnue est refusée ; une date d'appel dans le futur est ramenée à maintenant", async () => {
    assert.equal(notes.schemaNoteAppel.safeParse({ etiquettes: ["INVENTEE"] }).success, false);
    const lead = await contact("Berthe");
    const note = await notes.creerNoteAppel(lead.id, { appelLe: new Date(Date.now() + 3_600_000).toISOString() });
    assert.ok(new Date(note.appelLe).getTime() <= Date.now());
  });

  test("à l'ouverture du dossier, les notes rejoignent son historique à la date de l'appel ; une note vide n'y va pas", async () => {
    const lead = await contact("Claude");
    const ancienne = new Date(Date.now() - 3 * 86_400_000);
    const pleine = await notes.creerNoteAppel(lead.id, { appelLe: ancienne.toISOString(), texte: "Locataire, doit demander au propriétaire", etiquettes: ["LOCATAIRE"] });
    await notes.creerNoteAppel(lead.id, {});
    const { dossierId } = await depuisLead.ouvrirDossierDuLead(lead.id);
    const evenements = await prisma.dossierEvenement.findMany({ where: { dossierId, type: "NOTE_APPEL" } });
    assert.equal(evenements.length, 1, "seule la note écrite est reprise");
    assert.equal(evenements[0].survenuLe?.getTime(), ancienne.getTime(), "datée du jour de l'appel");
    assert.match(evenements[0].contenu, /Locataire — .*\n?|Locataire/);
    assert.match(evenements[0].contenu, /doit demander au propriétaire/);
    assert.equal((await notes.notesDuLead(lead.id)).find((n) => n.id === pleine.id)?.dansDossier, true);

    // Une nouvelle note, le dossier ouvert : reprise tout de suite, puis tenue à jour.
    const apres = await notes.creerNoteAppel(lead.id, { texte: "Rappel" });
    await notes.modifierNoteAppel(lead.id, apres.id, { texte: "Rappel : accord pour la visite", etiquettes: ["VEUT_UN_RENDU"] });
    const suivi = await prisma.dossierEvenement.findMany({ where: { dossierId, type: "NOTE_APPEL" }, orderBy: { createdAt: "asc" } });
    assert.equal(suivi.length, 2);
    assert.match(suivi[1].contenu, /Veut voir un rendu\nRappel : accord pour la visite/);
  });

  test("l'issue de fin d'appel s'inscrit sur la note de l'appel en cours", async () => {
    const lead = await contact("Denise");
    const note = await notes.creerNoteAppel(lead.id, { texte: "Hésite entre deux teintes" });
    await appels.noterAppel({ leadId: lead.id, issue: "A_RAPPELER", note: "" });
    const [relue] = await notes.notesDuLead(lead.id);
    assert.equal(relue.id, note.id);
    assert.equal(relue.issue, "A_RAPPELER");
  });
});
