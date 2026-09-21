import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();

let prisma: typeof import("@/lib/prisma").default;
let envoi: typeof import("./envoi");
let reception: typeof import("./reception");
let conversations: typeof import("./conversations");
let accuse: typeof import("./accuse");
let taches: typeof import("./taches");
let modeles: typeof import("./modeles");
let simulateur: typeof import("./fournisseurs/simulateur");
let texte: typeof import("./texte");

function reglerEnvironnement(): void {
  // Aucun canal d'alerte réel pendant les essais ; le fournisseur est le simulateur.
  for (const cle of ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "NTFY_TOPIC", "RESEND_API_KEY", "BREVO_API_KEY", "OVH_APPLICATION_KEY"]) delete process.env[cle];
  process.env.SMS_FOURNISSEUR = "simulateur";
}

before(async () => {
  prisma = (await import("@/lib/prisma")).default;
  reglerEnvironnement(); // Prisma recharge .env à l'import : on règle après.
  envoi = await import("./envoi");
  reception = await import("./reception");
  conversations = await import("./conversations");
  accuse = await import("./accuse");
  taches = await import("./taches");
  modeles = await import("./modeles");
  simulateur = await import("./fournisseurs/simulateur");
  texte = await import("./texte");
  await modeles.poserModelesParDefaut();
});
after(async () => {
  await prisma.$disconnect();
});

/** Exécute la tâche d'envoi comme le ferait l'exécuteur. */
const partir = (smsId: string, tentative = 1) => envoi.executerEnvoiSms(smsId, tentative);

describe("texte d'un SMS", () => {
  test("160 caractères GSM-7 par SMS, 70 dès qu'un caractère en sort", () => {
    assert.deepEqual(texte.mesurerSms("a".repeat(160)).segments, 1);
    assert.deepEqual(texte.mesurerSms("a".repeat(161)).segments, 2);
    const avecCirconflexe = texte.mesurerSms("Votre simulation est prête");
    assert.deepEqual([avecCirconflexe.gsm, avecCirconflexe.horsGsm], [false, ["ê"]]);
    assert.equal(texte.mesurerSms(`${"a".repeat(70)}ê`).segments, 2);
    assert.equal(texte.simplifierPourGsm("Votre simulation est prête — « ça » vous plaît ? 😀"), 'Votre simulation est prete - "ca" vous plait ? ');
  });

  test("les messages types par défaut tiennent dans l'alphabet GSM-7, l'accusé en deux SMS au plus", () => {
    for (const modele of modeles.MODELES_PAR_DEFAUT) {
      const mesure = texte.mesurerSms(modele.texte.replace(/\{\w+\}/g, ""));
      assert.deepEqual(mesure.horsGsm, [], `${modele.code} contient des caractères hors GSM-7`);
    }
    const accuseRempli = texte.remplirModele(modeles.MODELES_PAR_DEFAUT[0].texte, { prenom: "Marie-Christine" });
    assert.ok(texte.mesurerSms(accuseRempli).segments <= 2, "l'accusé doit rester court");
    assert.match(accuseRempli, /STOP/);
  });

  test("STOP : le mot en tête d'un message court, pas au milieu d'une phrase", () => {
    for (const oui of ["STOP", "stop", "Stop svp", "STOP SMS", " Stop. ", "Arrêt", "désabonner"]) assert.equal(texte.estDemandeArret(oui), true, oui);
    for (const non of ["On stoppe les travaux cette semaine", "Non stop", "Je ne veux pas arrêter", "Ok pour mardi", ""]) assert.equal(texte.estDemandeArret(non), false, non);
  });

  test("une variable vide ne laisse ni trou ni virgule orpheline", () => {
    assert.equal(texte.remplirModele("Bonjour {prenom}, Lucas de CoverSwap.", { prenom: "" }), "Bonjour, Lucas de CoverSwap.");
    assert.equal(texte.remplirModele("Votre espace : {lien} A bientôt", { lien: "https://coverswap.fr/e/x" }), "Votre espace : https://coverswap.fr/e/x A bientôt");
  });
});

describe("envoi", () => {
  test("le premier SMS porte la mention STOP, part par la file, et s'écrit dans l'histoire du contact", async () => {
    simulateur.viderSimulateur();
    const lead = await prisma.lead.create({ data: { prenom: "Camille", nom: "Martin", telephone: "06 12 34 56 78", ville: "Lattes", source: "META_ADS" } });
    const sms = await envoi.envoyerSms({ numero: "0612345678", rattachement: { leadId: lead.id }, texte: "Bonjour Camille, Lucas de CoverSwap." });
    assert.equal(sms.statut, "A_ENVOYER");
    assert.match(sms.texte, /STOP pour ne plus recevoir nos SMS\.$/);
    assert.ok(await prisma.tache.findUnique({ where: { cle: `sms-envoi:${sms.id}:0` } }), "la tâche d'envoi doit exister");

    assert.deepEqual(await partir(sms.id), { statut: "ENVOYE", fournisseur: "simulateur" });
    assert.equal(simulateur.envoisSimules().length, 1);
    assert.equal(simulateur.envoisSimules()[0].numero, "+33612345678");
    // Rejouer la tâche ne renvoie rien.
    await partir(sms.id);
    assert.equal(simulateur.envoisSimules().length, 1);

    const conversation = await prisma.conversationSms.findUnique({ where: { numero: "+33612345678" } });
    assert.deepEqual([conversation?.leadId, conversation?.nomAffiche, conversation?.dernierSens], [lead.id, "Camille Martin", "SORTANT"]);
    // Pas de dossier : l'échange est noté sur le contact, qui passe « contacté ».
    const echange = await prisma.interaction.findFirst({ where: { leadId: lead.id, type: "SMS" } });
    assert.match(echange?.contenu ?? "", /^SMS envoyé : Bonjour Camille/);
    assert.equal((await prisma.lead.findUnique({ where: { id: lead.id } }))?.statut, "CONTACTE");

    // Le deuxième message ne répète pas la mention.
    const second = await envoi.envoyerSms({ conversationId: conversation!.id, texte: "Je vous rappelle à 14h." });
    assert.equal(second.texte, "Je vous rappelle à 14h.");
  });

  test("la même clé d'envoi ne produit qu'un SMS (double-tap, file hors ligne rejouée)", async () => {
    const [a, b] = await Promise.all([
      envoi.envoyerSms({ numero: "0611111111", texte: "Une seule fois", cleEnvoi: "ecran-abc" }),
      envoi.envoyerSms({ numero: "0611111111", texte: "Une seule fois", cleEnvoi: "ecran-abc" }),
    ]);
    assert.equal(a.id, b.id);
    assert.equal(await prisma.sms.count({ where: { cleEnvoi: "ecran-abc" } }), 1);
  });

  test("un fixe, un message vide ou trop long sont refusés avec une phrase claire", async () => {
    await assert.rejects(envoi.envoyerSms({ numero: "0467000000", texte: "Bonjour" }), /fixe/);
    await assert.rejects(envoi.envoyerSms({ numero: "0612345678", texte: "   " }), /vide/);
    await assert.rejects(envoi.envoyerSms({ numero: "0612345678", texte: "a".repeat(1000) }), /trop long/);
    await assert.rejects(envoi.envoyerSms({ numero: "12", texte: "Bonjour" }), /illisible/);
  });

  test("réseau coupé pendant l'envoi : le message reste en attente, puis passe en échec, et se réessaie", async () => {
    simulateur.simulerPanne("fetch failed (réseau coupé)");
    const sms = await envoi.envoyerSms({ numero: "0622222222", texte: "Pendant la coupure" });
    await assert.rejects(partir(sms.id, 1), /réseau coupé/);
    assert.equal((await prisma.sms.findUnique({ where: { id: sms.id } }))?.statut, "A_ENVOYER", "tant qu'il reste des essais, le message attend");
    await assert.rejects(partir(sms.id, envoi.TENTATIVES_ENVOI), /réseau coupé/);
    const echec = await prisma.sms.findUnique({ where: { id: sms.id } });
    assert.equal(echec?.statut, "ECHEC");
    assert.match(echec?.erreur ?? "", /après 6 essais/);

    simulateur.simulerPanne(null);
    const relance = await envoi.reessayerSms(sms.id);
    assert.equal(relance.statut, "A_ENVOYER");
    await partir(sms.id);
    assert.equal((await prisma.sms.findUnique({ where: { id: sms.id } }))?.statut, "ENVOYE");
  });
});

describe("réception", () => {
  test("la réponse d'un client rejoint sa conversation ; relevée deux fois, elle n'existe qu'une fois", async () => {
    const entrant = { identifiant: "ovh-1001", numero: "0033612345678", texte: "Oui, avec plaisir !", recuLe: new Date() };
    const premier = await reception.enregistrerSmsEntrant(entrant, "ovh");
    const second = await reception.enregistrerSmsEntrant(entrant, "ovh");
    assert.deepEqual([premier?.nouveau, second?.nouveau], [true, false]);
    assert.equal(premier?.smsId, second?.smsId);
    const conversation = await prisma.conversationSms.findUnique({ where: { numero: "+33612345678" } });
    assert.deepEqual([conversation?.nonLus, conversation?.dernierSens, conversation?.dernierExtrait], [1, "ENTRANT", "Oui, avec plaisir !"]);

    await conversations.marquerConversationLue(conversation!.id);
    assert.equal((await prisma.conversationSms.findUnique({ where: { id: conversation!.id } }))?.nonLus, 0);
  });

  test("deux réponses simultanées du même client : une conversation, deux messages", async () => {
    const maintenant = new Date();
    await Promise.all([
      reception.enregistrerSmsEntrant({ identifiant: "ovh-2001", numero: "+33633333333", texte: "Premier", recuLe: maintenant }, "ovh"),
      reception.enregistrerSmsEntrant({ identifiant: "ovh-2002", numero: "+33633333333", texte: "Second", recuLe: maintenant }, "ovh"),
    ]);
    const conversation = await prisma.conversationSms.findUnique({ where: { numero: "+33633333333" }, include: { messages: true } });
    assert.equal(conversation?.messages.length, 2);
    assert.equal(conversation?.nonLus, 2);
  });

  test("numéro inconnu : conversation orpheline, dans la file « à rattacher », jamais perdue", async () => {
    await reception.enregistrerSmsEntrant({ identifiant: "ovh-3001", numero: "+33644444444", texte: "Bonjour, vous faites les cuisines ?", recuLe: new Date() }, "ovh");
    const liste = await conversations.listerConversations({ filtre: "A_RATTACHER" });
    const orpheline = liste.conversations.find((c) => c.numero === "+33644444444");
    assert.ok(orpheline?.aRattacher);
    assert.ok(liste.compteurs.aRattacher >= 1);

    const lead = await prisma.lead.create({ data: { prenom: "Nadia", nom: "Roux", telephone: "+33644444444", ville: "Sète", source: "AUTRE" } });
    const rattachee = await conversations.rattacherConversation(orpheline!.id, { leadId: lead.id });
    assert.deepEqual([rattachee.leadId, rattachee.nomAffiche], [lead.id, "Nadia Roux"]);
  });

  test("STOP : le numéro est bloqué, ce qui attendait est annulé, et c'est enregistré", async () => {
    const conversation = await conversations.conversationDuNumero("0655555555");
    const enAttente = await envoi.envoyerSms({ conversationId: conversation.id, texte: "Relance en file" });
    const resultat = await reception.enregistrerSmsEntrant({ identifiant: "ovh-4001", numero: "+33655555555", texte: "STOP", recuLe: new Date() }, "ovh");
    assert.equal(resultat?.stop, true);

    const apres = await prisma.conversationSms.findUnique({ where: { id: conversation.id } });
    assert.ok(apres?.stopLe);
    assert.equal(apres?.stopTexte, "STOP");
    assert.equal((await prisma.sms.findUnique({ where: { id: enAttente.id } }))?.statut, "ECHEC");
    await assert.rejects(envoi.envoyerSms({ conversationId: conversation.id, texte: "Encore un" }), /STOP/);
    // Même une tâche déjà en file ne part pas.
    await prisma.sms.update({ where: { id: enAttente.id }, data: { statut: "A_ENVOYER" } });
    await assert.rejects(partir(enAttente.id), /STOP/);
  });

  test("la relève du fournisseur ramène les réponses, et la remise des envois est suivie", async () => {
    simulateur.viderSimulateur();
    const sms = await envoi.envoyerSms({ numero: "0666666666", texte: "Avez-vous pu prendre les photos ?" });
    await partir(sms.id);
    simulateur.simulerReponse("+33666666666", "Je vous les envoie ce soir");
    assert.deepEqual(await taches.releverSmsEntrants(), { releves: 1, nouveaux: 1 });
    assert.deepEqual(await taches.releverSmsEntrants(), { releves: 1, nouveaux: 0 }, "relevé une seconde fois, rien de nouveau");
    assert.deepEqual(await taches.suivreRemises().then((r) => r.changes >= 1), true);
    assert.equal((await prisma.sms.findUnique({ where: { id: sms.id } }))?.statut, "DELIVRE");
  });
});

describe("fil d'une conversation", () => {
  test("SMS et appels dans le même ordre chronologique", async () => {
    const lead = await prisma.lead.create({ data: { prenom: "Hugo", nom: "Blanc", telephone: "+33677777777", ville: "Mauguio", source: "META_ADS" } });
    const premier = await envoi.envoyerSms({ numero: "+33677777777", rattachement: { leadId: lead.id }, texte: "Bonjour Hugo" });
    await prisma.interaction.create({ data: { leadId: lead.id, type: "APPEL", contenu: "Intéressé, cuisine en L, envoie les photos ce soir" } });
    await reception.enregistrerSmsEntrant({ identifiant: "ovh-5001", numero: "+33677777777", texte: "Voilà les photos", recuLe: new Date(Date.now() + 1000) }, "ovh");
    const fil = await conversations.filDeLaConversation(premier.conversationId);
    assert.deepEqual(
      fil.elements.map((e) => e.genre),
      ["SMS", "APPEL", "SMS"]
    );
    assert.equal(fil.conversation.attente, "MOI", "le dernier mot est au client : à moi de répondre");
  });
});

describe("accusé de réception automatique", () => {
  test("part une fois, pour un mobile français, avec le prénom — jamais deux fois", async () => {
    const lead = await prisma.lead.create({ data: { prenom: "Élise", nom: "Garcia", telephone: "+33688888888", ville: "Pérols", source: "META_ADS" } });
    const mardi10h = new Date("2026-09-22T08:00:00Z"); // 10 h à Paris
    const premier = await accuse.envoyerAccuseDeReception(lead.id, mardi10h);
    assert.deepEqual([premier.envoye, premier.raison], [true, "ACCUSE_RECEPTION"]);
    const sms = await prisma.sms.findUnique({ where: { id: premier.smsId! } });
    assert.match(sms?.texte ?? "", /^Bonjour Élise, Lucas de CoverSwap\. Merci pour votre demande, je vous appelle dans les prochaines minutes\./);
    assert.deepEqual([sms?.origine, sms?.modele], ["ACCUSE_AUTO", "ACCUSE_RECEPTION"]);

    const second = await accuse.envoyerAccuseDeReception(lead.id, mardi10h);
    assert.equal(second.envoye, false);
    // L'accusé ne vaut pas prise de contact : le contact reste « à traiter ».
    await partir(sms!.id);
    assert.equal((await prisma.lead.findUnique({ where: { id: lead.id } }))?.statut, "NOUVEAU");
  });

  test("le soir et le dimanche, la variante « demain matin » ; un fixe ou un numéro factice, rien", async () => {
    assert.equal(accuse.estHeureOuvree(new Date("2026-09-22T08:00:00Z")), true);
    assert.equal(accuse.estHeureOuvree(new Date("2026-09-22T21:00:00Z")), false, "23 h à Paris");
    assert.equal(accuse.estHeureOuvree(new Date("2026-09-20T10:00:00Z")), false, "dimanche");

    const soir = await prisma.lead.create({ data: { prenom: "Paul", nom: "Morel", telephone: "+33699999990", ville: "Sète", source: "META_ADS" } });
    const resultat = await accuse.envoyerAccuseDeReception(soir.id, new Date("2026-09-22T21:00:00Z"));
    assert.equal(resultat.raison, "ACCUSE_RECEPTION_HORS_HORAIRES");
    assert.match((await prisma.sms.findUnique({ where: { id: resultat.smsId! } }))?.texte ?? "", /dès demain matin/);

    const fixe = await prisma.lead.create({ data: { prenom: "Fixe", nom: "Test", telephone: "0467000000", ville: "Montpellier", source: "META_ADS" } });
    assert.equal((await accuse.envoyerAccuseDeReception(fixe.id)).envoye, false);
    const factice = await prisma.lead.create({ data: { prenom: "Test", nom: "Meta", telephone: "<test lead: dummy data for phone_number>", ville: "Paris", source: "META_ADS" } });
    assert.equal((await accuse.envoyerAccuseDeReception(factice.id)).envoye, false, "lead sans téléphone valide");
  });

  test("accusé coupé dans Paramètres : rien ne part", async () => {
    const modele = await modeles.lireModele("ACCUSE_RECEPTION");
    await modeles.modifierModele(modele!.id, { actif: false });
    const lead = await prisma.lead.create({ data: { prenom: "Inès", nom: "Petit", telephone: "+33612121212", ville: "Lattes", source: "META_ADS" } });
    assert.deepEqual(await accuse.envoyerAccuseDeReception(lead.id), { envoye: false, raison: "accusé de réception désactivé" });
    await modeles.modifierModele(modele!.id, { actif: true });
  });
});
