import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();
process.env.UPLOADS_DIR = mkdtempSync(path.join(tmpdir(), "coverswap-devis-multiples-"));

/**
 * Mission 11 (25/09/2026) : plusieurs devis par dossier. Le cas réel : un devis
 * « façades seules » et un devis « façades + plan de travail » ; le client n'en
 * valide qu'un, l'autre passe « non retenu » et reste en historique.
 */

let prisma: typeof import("@/lib/prisma").default;
let avecActeur: typeof import("@/lib/journal/contexte").avecActeur;
let liens: typeof import("@/lib/espace/liens");
let service: typeof import("@/lib/espace/service");
let validations: typeof import("@/lib/espace/validations");
let vueCrm: typeof import("@/lib/espace/vue-crm");
let suivi: typeof import("@/lib/espace/suivi");
let documents: typeof import("@/lib/dossiers/documents");
let existants: typeof import("@/lib/dossiers/documents-existants");
let main: typeof import("@/lib/dossiers/main");
let execution: typeof import("@/lib/assistant/execution");
let lecture: typeof import("@/lib/assistant/outils/lecture");
let pointDuJour: typeof import("@/lib/assistant/outils/point-du-jour");

const LUCAS = { acteur: "HUMAIN:lucas@coverswap.fr" };
const ORIGINE = { ip: null, navigateur: null };

const ligne = (designation: string, quantite: number, prixUnitaire: number, unite: "ml" | "jour" | "forfait" = "ml") => ({ type: "PRESTATION" as const, designation, sousDesignation: undefined, quantite, unite, prixUnitaire });
const generation = (objet: string, lignes: ReturnType<typeof ligne>[], extra: Partial<import("zod/v4").z.output<typeof documents.schemaGeneration>> = {}) =>
  documents.schemaGeneration.parse({ type: "DEVIS", objet, lignes, noteMl: true, acomptePct: 30, remplaceDocumentId: null, ...extra });

async function client(prenom: string, email: string | null = null) {
  const lead = await prisma.lead.create({ data: { prenom, nom: "Essai", telephone: `+3361${Math.floor(Math.random() * 9e7 + 1e7)}`, email, ville: "Lattes", codePostal: "34970", source: "META_ADS" } });
  const ouvert = await liens.ouvrirEspaceDuContact(lead.id);
  return { leadId: lead.id, dossierId: ouvert.dossierId, espaceId: ouvert.espace.id };
}
const espaceDe = (id: string) => prisma.espaceClient.findUniqueOrThrow({ where: { id } });
const statutDe = async (id: string) => (await prisma.document.findUniqueOrThrow({ where: { id } })).statut;
const dossierDe = (id: string) => prisma.dossier.findUniqueOrThrow({ where: { id } });

before(async () => {
  prisma = (await import("@/lib/prisma")).default;
  for (const cle of ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "NTFY_TOPIC", "RESEND_API_KEY"]) delete process.env[cle];
  process.env.NEXTAUTH_SECRET = "secret-de-session-pour-les-essais";
  process.env.SITE_URL = "https://coverswap.fr";
  avecActeur = (await import("@/lib/journal/contexte")).avecActeur;
  liens = await import("@/lib/espace/liens");
  service = await import("@/lib/espace/service");
  validations = await import("@/lib/espace/validations");
  vueCrm = await import("@/lib/espace/vue-crm");
  suivi = await import("@/lib/espace/suivi");
  documents = await import("@/lib/dossiers/documents");
  existants = await import("@/lib/dossiers/documents-existants");
  main = await import("@/lib/dossiers/main");
  execution = await import("@/lib/assistant/execution");
  lecture = await import("@/lib/assistant/outils/lecture");
  pointDuJour = await import("@/lib/assistant/outils/point-du-jour");
  await (await import("@/lib/base/preparation")).preparerBase();
});
after(async () => {
  await prisma.$disconnect();
});

describe("deux devis proposés, le client en choisit un", () => {
  test("A « façades seules » puis B « façades + plan de travail » : les deux sont proposés, aucun ne remplace l'autre, chacun avec son libellé", async () => {
    const c = await client("Fawzi");
    const { document: a } = await avecActeur(LUCAS, () => documents.genererDocument(c.dossierId, generation("Recouvrement cuisine", [ligne("Revêtement adhésif — façades", 11.5, 150)], { libelleVariante: "façades seules", notifier: false })));
    const { document: b } = await avecActeur(LUCAS, () => documents.genererDocument(c.dossierId, generation("Recouvrement cuisine", [ligne("Revêtement adhésif — façades", 11.5, 150), ligne("Plan de travail", 4.6, 150)], { libelleVariante: "façades + plan de travail", notifier: false })));
    assert.deepEqual([a.libelleVariante, b.libelleVariante, a.visibleEspace, b.visibleEspace], ["façades seules", "façades + plan de travail", true, true]);
    assert.equal(await statutDe(a.id), "GENERE", "sans « remplace », le premier devis reste en vigueur");
    const genere = await prisma.dossierEvenement.findFirst({ where: { dossierId: c.dossierId, type: "DEVIS_GENERE" }, orderBy: { createdAt: "desc" } });
    assert.match(genere?.contenu ?? "", /« façades \+ plan de travail »/, "l'événement porte le libellé");

    // Ce que voit le client : les deux, côte à côte, du plus ancien au plus récent.
    const etat = await service.etatEspace(await espaceDe(c.espaceId));
    assert.deepEqual(etat.devisProposes.map((d) => [d.numero, d.libelle]), [[a.numero, "façades seules"], [b.numero, "façades + plan de travail"]]);
    assert.equal(etat.devis?.id, b.id, "le « devis en vigueur » reste le plus récent (paiements, étape)");
    // Ce que voit Lucas.
    const vue = (await vueCrm.vueEspaceCrm(c.dossierId))!;
    assert.deepEqual(vue.devisProposes.map((d) => [d.numero, d.libelle, d.visibleEspace, d.statut]), [[a.numero, "façades seules", true, "GENERE"], [b.numero, "façades + plan de travail", true, "GENERE"]]);
    assert.equal((await suivi.listerEspaces()).find((l) => l.dossierId === c.dossierId)!.faits.devisProposes, 2);
  });

  test("interrupteur « visible dans l'espace » : masqué, le client ne le voit plus et ne peut pas l'accepter ; la présentation d'un devis émis se modifie, pas son contenu", async () => {
    const c = await client("Inès");
    const { document: a } = await avecActeur(LUCAS, () => documents.genererDocument(c.dossierId, generation("Cuisine", [ligne("Façades", 10, 150)], { libelleVariante: "façades seules", notifier: false })));
    const { document: b } = await avecActeur(LUCAS, () => documents.genererDocument(c.dossierId, generation("Cuisine", [ligne("Façades", 10, 150), ligne("Plan de travail", 4, 150)], { libelleVariante: "façades + plan", notifier: false })));

    await avecActeur(LUCAS, () => documents.modifierPresentationDevis(c.dossierId, a.id, { visibleEspace: false }));
    let etat = await service.etatEspace(await espaceDe(c.espaceId));
    assert.deepEqual(etat.devisProposes.map((d) => d.id), [b.id]);
    await assert.rejects(service.accepterDevis(await espaceDe(c.espaceId), { documentId: a.id, nom: "Inès Essai", accepte: true }, ORIGINE), /pas proposé/);
    assert.equal((await vueCrm.vueEspaceCrm(c.dossierId))!.devisProposes.find((d) => d.id === a.id)?.visibleEspace, false, "Lucas le voit toujours, marqué masqué");
    const note = await prisma.dossierEvenement.findFirst({ where: { dossierId: c.dossierId, type: "NOTE_AJOUTEE" }, orderBy: { createdAt: "desc" } });
    assert.match(note?.contenu ?? "", /masqué dans l'espace client/);

    await avecActeur(LUCAS, () => documents.modifierPresentationDevis(c.dossierId, a.id, { visibleEspace: true, libelleVariante: "façades seules (sans plan)" }));
    etat = await service.etatEspace(await espaceDe(c.espaceId));
    assert.deepEqual(etat.devisProposes.map((d) => d.libelle), ["façades seules (sans plan)", "façades + plan"]);
    assert.equal((await prisma.document.findUniqueOrThrow({ where: { id: a.id } })).totalHt, 1500, "le contenu n'a pas bougé");
  });

  test("validation de B : B signé, A « non retenu » (gardé), le dossier avance, l'événement et la main nomment le devis choisi ; l'accord retiré rend A au choix", async () => {
    const c = await client("Fawzi");
    const { document: a } = await avecActeur(LUCAS, () => documents.genererDocument(c.dossierId, generation("Cuisine", [ligne("Façades", 11.5, 150)], { libelleVariante: "façades seules", notifier: false })));
    const { document: b } = await avecActeur(LUCAS, () => documents.genererDocument(c.dossierId, generation("Cuisine", [ligne("Façades", 11.5, 150), ligne("Plan de travail", 4.6, 150)], { libelleVariante: "façades + plan de travail", notifier: false })));

    await service.accepterDevis(await espaceDe(c.espaceId), { documentId: b.id, nom: "Fawzi Essai", accepte: true }, ORIGINE);
    assert.deepEqual([await statutDe(a.id), await statutDe(b.id)], ["NON_RETENU", "ACCEPTE"]);
    assert.equal((await dossierDe(c.dossierId)).etape, "SIGNE");
    const accepte = await prisma.dossierEvenement.findFirstOrThrow({ where: { dossierId: c.dossierId, type: "ESPACE_DEVIS_ACCEPTE" } });
    assert.match(accepte.contenu, /devis .+ \(façades \+ plan de travail\)/);
    assert.match(accepte.contenu, new RegExp(`non retenu : ${a.numero} \\(façades seules\\)`));
    const meta = JSON.parse(accepte.metadata) as { numero: string; libelle: string; nonRetenus: { numero: string; libelle: string }[] };
    assert.deepEqual([meta.numero, meta.libelle, meta.nonRetenus.map((n) => n.libelle)], [b.numero, "façades + plan de travail", ["façades seules"]]);

    // Le client ne voit plus que le devis signé ; Lucas voit A non retenu ; la main dit lequel il a choisi.
    let etat = await service.etatEspace(await espaceDe(c.espaceId));
    assert.deepEqual([etat.devisProposes.map((d) => d.id), etat.devis?.libelle, etat.devis?.accepte?.source], [[b.id], "façades + plan de travail", "ESPACE"]);
    assert.deepEqual((await vueCrm.vueEspaceCrm(c.dossierId))!.devisProposes.map((d) => [d.id, d.statut]), [[a.id, "NON_RETENU"], [b.id, "ACCEPTE"]]);
    const laMain = await main.calculerMain(c.dossierId);
    assert.equal(laMain?.qui, "MOI");
    assert.match(laMain?.motif ?? "", new RegExp(`Il a choisi le devis ${b.numero} \\(façades \\+ plan de travail\\)`));

    // Les outils de l'assistant.
    const session = await execution.ouvrirSession({ jetonId: null, clientNom: "essai", utilisateur: "essai" });
    const lireFiche = lecture.OUTILS_LECTURE.find((o) => o.nom === "lire_fiche") as unknown as import("@/lib/assistant/definition").DefinitionOutil<Record<string, unknown>>;
    const fiche = await execution.executerOutil(lireFiche, { dossierId: c.dossierId }, session);
    assert.match(fiche.texte, /Devis \(2\)/);
    assert.match(fiche.texte, new RegExp(`${a.numero} « façades seules » .*\\(non retenu\\)`));
    assert.match(fiche.texte, new RegExp(`${b.numero} « façades \\+ plan de travail » .*\\(accepté\\)`));
    const point = await execution.executerOutil(pointDuJour.outilPointDuJour, { depuis_heures: 1 }, session);
    assert.match(point.texte, new RegExp(`Fawzi Essai a choisi le devis ${b.numero} \\(façades \\+ plan de travail\\)`));

    // Il revient sur son accord : A redevient au choix, B redevient un devis émis.
    await validations.retirerAccord(await espaceDe(c.espaceId), "CLIENT", "Je réfléchis encore");
    assert.deepEqual([await statutDe(a.id), await statutDe(b.id)], ["ENVOYE", "GENERE"]);
    etat = await service.etatEspace(await espaceDe(c.espaceId));
    assert.deepEqual(etat.devisProposes.map((d) => d.id), [a.id, b.id]);
    const retire = await prisma.dossierEvenement.findFirstOrThrow({ where: { dossierId: c.dossierId, type: "ESPACE_ACCORD_RETIRE" } });
    assert.match(retire.contenu, /L'autre devis proposé redevient au choix/);
  });

  test("« votre devis est disponible » se débraye : notifier: false ne programme rien, sinon un mail est programmé ; une remise est une ligne « Remise … » à prix négatif, un prix négatif ailleurs est refusé", async () => {
    const c = await client("Noé", "noe.essai@example.com");
    const { document: sans } = await avecActeur(LUCAS, () => documents.genererDocument(c.dossierId, generation("Cuisine", [ligne("Façades", 10, 150)], { libelleVariante: "sans mail", notifier: false })));
    assert.equal(await prisma.envoiMail.count({ where: { cle: `notif:DEVIS_DISPONIBLE:${sans.id}` } }), 0);
    const { document: avec } = await avecActeur(LUCAS, () => documents.genererDocument(c.dossierId, generation("Cuisine", [ligne("Façades", 10, 150), ligne("Remise commerciale", 1, -100, "forfait")], { libelleVariante: "avec mail" })));
    assert.equal(await prisma.envoiMail.count({ where: { cle: `notif:DEVIS_DISPONIBLE:${avec.id}` } }), 1);
    assert.equal(avec.totalHt, 1400, "la remise est une ligne comme une autre : le calcul ne change pas");
    assert.throws(() => generation("Cuisine", [ligne("Façades", 10, -150)]), /Remise/);
  });

  test("devis PDF déjà fait, déposé avec un libellé : proposé comme les autres ; annulé : gardé en historique, plus proposé ; un devis accepté ne s'annule pas", async () => {
    const c = await client("Léa");
    const { document: a } = await avecActeur(LUCAS, () => documents.genererDocument(c.dossierId, generation("Cuisine", [ligne("Façades", 10, 150)], { libelleVariante: "façades", notifier: false })));
    const depose = await avecActeur(LUCAS, () =>
      existants.enregistrerDocumentExistant(c.dossierId, existants.schemaDocumentExistant.parse({ type: "DEVIS", numero: `2026-9${Math.floor(Math.random() * 90 + 10)}`, dateEmission: "2026-09-20", montant: 2415, statut: "ENVOYE", acomptePct: 30, libelleVariante: "façades + plan (PDF)", inscrireAuRegistre: true }))
    );
    let etat = await service.etatEspace(await espaceDe(c.espaceId));
    assert.deepEqual(etat.devisProposes.map((d) => [d.libelle, d.repris ?? false]), [["façades", false], ["façades + plan (PDF)", true]]);

    await avecActeur(LUCAS, () => documents.annulerDevis(c.dossierId, depose.documentId, "le client a choisi la formule simple"));
    assert.equal(await statutDe(depose.documentId), "ANNULEE");
    etat = await service.etatEspace(await espaceDe(c.espaceId));
    assert.deepEqual(etat.devisProposes.map((d) => d.id), [a.id]);
    const annule = await prisma.dossierEvenement.findFirst({ where: { dossierId: c.dossierId, type: "NOTE_AJOUTEE" }, orderBy: { createdAt: "desc" } });
    assert.match(annule?.contenu ?? "", /annulé : le client a choisi la formule simple \(gardé en historique\)/);

    await service.accepterDevis(await espaceDe(c.espaceId), { documentId: a.id, nom: "Léa Essai", accepte: true }, ORIGINE);
    await assert.rejects(avecActeur(LUCAS, () => documents.annulerDevis(c.dossierId, a.id, "")), /accepté/);
  });
});
