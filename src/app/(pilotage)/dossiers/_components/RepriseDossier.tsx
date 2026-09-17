"use client";

import { useEffect, useId, useState } from "react";
import { FilePlus2, History, Plus, Receipt, Search, Wallet, X } from "lucide-react";
import { toast } from "sonner";
import { CaseACocher, Pastille, Puces } from "@/components/pilotage/ui";
import type { ClientResume, EntrepriseAnnuaire } from "@/lib/clients/types";
import { ETAPES_ACTIVES, LIBELLES_ETAPE, LIBELLES_SOURCE, LIBELLES_STATUT_DOCUMENT, SOURCES_DOSSIER, type EtapeActive, type SourceDossier } from "@/lib/dossiers/constants";
import { formatDateCourte, jourParis } from "@/lib/dossiers/dates";
import { formatMontant, formatQuantite, lireNombre } from "@/lib/dossiers/montants";
import { numerosProposables } from "@/lib/dossiers/numeros-libres";
import type { NumeroLibre } from "@/lib/dossiers/registre";
import { LIBELLES_MOYEN, MOYENS_PAIEMENT, type MoyenPaiement } from "@/lib/encaissements/constantes";
import { cn } from "@/lib/utils";
import { appelApi, envoyerJson, messageErreur } from "./client";
import { PARTICULIER, TypeClientDossier, erreurTypeClient, estEntreprise, sourceSelonSousTraitance, typeClientPourEnvoi, typeSelonSource, type TypeClientSaisi } from "./TypeClientDossier";
import { Bouton, Champ, CLASSE_SAISIE, ListeDeroulante, Modale, TitreSection, TRANS } from "./ui";

type Jalon = "DEVIS_ENVOYE" | "SIGNE" | "CHANTIER" | "FACTURE";
const JALONS: { etape: Jalon; libelle: string }[] = [
  { etape: "DEVIS_ENVOYE", libelle: "Devis envoyé le" },
  { etape: "SIGNE", libelle: "Signé le" },
  { etape: "CHANTIER", libelle: "Chantier commencé le" },
  { etape: "FACTURE", libelle: "Facturé le" },
];
const rang = (etape: EtapeActive) => ETAPES_ACTIVES.indexOf(etape);

type LigneDocument = { cle: string; type: "DEVIS" | "FACTURE"; numero: string; dateEmission: string; montant: string; statut: string; pdf: File | null; inscrire: boolean };
type LignePaiement = { cle: string; montant: string; recuLe: string; moyen: MoyenPaiement | ""; reference: string };

const cleUnique = () => crypto.randomUUID();

/** Date la plus ancienne ou la plus récente d'une liste de jours AAAA-MM-JJ. */
const extreme = (jours: string[], sens: "min" | "max") => {
  const valides = jours.filter(Boolean).sort();
  return (sens === "min" ? valides[0] : valides.at(-1)) ?? "";
};

/**
 * Reprise d'un dossier commencé avant le CRM, en un écran : client, étape
 * actuelle, dates clés, documents déjà émis, paiements déjà reçus. Une date
 * laissée vide se déduit des documents et paiements quand c'est possible ;
 * sinon elle reste « inconnue », signalée sur le dossier.
 */
export function RepriseDossier({
  ouverte,
  onglets,
  onFermer,
  onCree,
}: {
  ouverte: boolean;
  onglets: React.ReactNode;
  onFermer: () => void;
  onCree: (id: string) => void;
}) {
  const idListe = useId();
  const aujourdhui = jourParis(new Date());
  const [client, setClient] = useState<{ id: string; nom: string } | null>(null);
  const [recherche, setRecherche] = useState("");
  const [clients, setClients] = useState<ClientResume[] | null>(null);
  const [champs, setChamps] = useState({ clientNom: "", clientTelephone: "", clientEmail: "", clientAdresse: "", clientCp: "", clientVille: "", objet: "", montantEstime: "" });
  const [typeClient, setTypeClient] = useState<TypeClientSaisi>(PARTICULIER);
  const [source, setSource] = useState<SourceDossier | "">("");
  const [etape, setEtape] = useState<EtapeActive>("DEVIS_ENVOYE");
  const [ouvertLe, setOuvertLe] = useState("");
  const [jalons, setJalons] = useState<Partial<Record<Jalon, string>>>({});
  const [etapeDepuisLe, setEtapeDepuisLe] = useState("");
  const [dateChantier, setDateChantier] = useState("");
  const [documents, setDocuments] = useState<LigneDocument[]>([]);
  const [paiements, setPaiements] = useState<LignePaiement[]>([]);
  const [libres, setLibres] = useState<NumeroLibre[] | null>(null);
  const [envoi, setEnvoi] = useState<string | null>(null);

  useEffect(() => {
    if (!ouverte) return;
    let actif = true;
    appelApi<{ libres: NumeroLibre[] }>("/api/numeros?libres=1")
      .then((reponse) => actif && setLibres(reponse.libres))
      .catch(() => actif && setLibres([]));
    return () => {
      actif = false;
    };
  }, [ouverte]);

  useEffect(() => {
    if (recherche.trim().length < 2) return;
    let actif = true;
    const minuterie = window.setTimeout(() => {
      appelApi<{ clients: ClientResume[] }>(`/api/clients?recherche=${encodeURIComponent(recherche.trim())}&limite=8`)
        .then((reponse) => actif && setClients(reponse.clients))
        .catch(() => actif && setClients([]));
    }, 250);
    return () => {
      actif = false;
      window.clearTimeout(minuterie);
    };
  }, [recherche]);

  const changer = (cle: keyof typeof champs) => (evenement: { target: { value: string } }) => setChamps((actuels) => ({ ...actuels, [cle]: evenement.target.value }));

  function choisirClient(fiche: ClientResume) {
    setClient({ id: fiche.id, nom: fiche.nom });
    setChamps((actuels) => ({
      ...actuels,
      clientNom: actuels.clientNom || fiche.nom,
      clientTelephone: actuels.clientTelephone || fiche.telephone || "",
      clientEmail: actuels.clientEmail || fiche.email || "",
      clientVille: actuels.clientVille || fiche.ville || "",
    }));
    setRecherche("");
    setClients(null);
  }

  // Entreprise trouvée dans l'annuaire : raison sociale, et adresse si rien n'est encore saisi.
  function remplirDepuisAnnuaire(entreprise: EntrepriseAnnuaire) {
    setChamps((actuels) => {
      const adresseVide = !actuels.clientAdresse.trim() && !actuels.clientCp.trim() && !actuels.clientVille.trim();
      return {
        ...actuels,
        clientNom: entreprise.raisonSociale ?? actuels.clientNom,
        ...(adresseVide ? { clientAdresse: entreprise.adresse ?? "", clientCp: entreprise.codePostal ?? "", clientVille: entreprise.ville ?? "" } : {}),
      };
    });
  }

  function ajouterDocument(type: "DEVIS" | "FACTURE") {
    const statut = type === "DEVIS" ? (rang(etape) >= rang("SIGNE") && !documents.some((ligne) => ligne.type === "DEVIS" && ligne.statut === "ACCEPTE") ? "ACCEPTE" : "ENVOYE") : "GENERE";
    setDocuments((actuels) => [...actuels, { cle: cleUnique(), type, numero: "", dateEmission: "", montant: "", statut, pdf: null, inscrire: false }]);
  }
  const changerDocument = (cle: string, modification: Partial<LigneDocument>) =>
    setDocuments((actuels) => actuels.map((ligne) => (ligne.cle === cle ? { ...ligne, ...modification } : ligne)));
  const changerPaiement = (cle: string, modification: Partial<LignePaiement>) =>
    setPaiements((actuels) => actuels.map((ligne) => (ligne.cle === cle ? { ...ligne, ...modification } : ligne)));

  function choisirNumero(ligne: LigneDocument, numero: string) {
    const libre = libres?.find((candidat) => candidat.numero.toLowerCase() === numero.trim().toLowerCase());
    changerDocument(ligne.cle, {
      numero,
      ...(libre?.emisLe && !ligne.dateEmission ? { dateEmission: jourParis(libre.emisLe) } : {}),
      ...(libre?.montant && !ligne.montant.trim() ? { montant: formatQuantite(libre.montant) } : {}),
    });
  }

  // Dates déduites de ce qui est saisi, quand le champ est vide.
  const joursDevis = documents.filter((ligne) => ligne.type === "DEVIS").map((ligne) => ligne.dateEmission);
  const joursFactures = documents.filter((ligne) => ligne.type === "FACTURE").map((ligne) => ligne.dateEmission);
  const joursPaiements = paiements.map((ligne) => ligne.recuLe);
  const deduites: Partial<Record<Jalon | "OUVERTURE" | "ACTUELLE", { jour: string; source: string }>> = {};
  const deduire = (cle: Jalon | "OUVERTURE" | "ACTUELLE", jour: string, source: string) => {
    if (jour && jour <= aujourdhui) deduites[cle] = { jour, source };
  };
  deduire("DEVIS_ENVOYE", extreme(joursDevis, "min"), "premier devis");
  deduire("CHANTIER", dateChantier, "date du chantier");
  deduire("FACTURE", extreme(joursFactures, "min"), "première facture");
  const valeurJalon = (jalon: Jalon) => jalons[jalon] || deduites[jalon]?.jour || "";
  if (etape === "ENCAISSE") deduire("ACTUELLE", extreme(joursPaiements, "max"), "dernier paiement");
  else if ((JALONS as { etape: string }[]).some((jalon) => jalon.etape === etape)) {
    const deduite = deduites[etape as Jalon];
    if (deduite) deduites.ACTUELLE = deduite;
  }
  const connues = [...JALONS.filter((jalon) => rang(jalon.etape) < rang(etape)).map((jalon) => valeurJalon(jalon.etape)), etapeDepuisLe || deduites.ACTUELLE?.jour || "", ...joursDevis, ...joursFactures, ...joursPaiements];
  deduire("OUVERTURE", extreme(connues, "min"), "date la plus ancienne saisie");

  const documentsLus = documents.map((ligne) => {
    const montant = ligne.montant.trim() ? lireNombre(ligne.montant) : null;
    const connu = libres?.some((libre) => libre.numero.toLowerCase() === ligne.numero.trim().toLowerCase()) ?? true;
    const erreur = !ligne.numero.trim()
      ? "Numéro manquant."
      : !ligne.dateEmission || ligne.dateEmission > aujourdhui
        ? "Date d'émission manquante ou à venir."
        : montant === null || montant <= 0
          ? "Montant manquant."
          : null;
    return { ligne, montant, connu, erreur };
  });
  const paiementsLus = paiements.map((ligne) => {
    const montant = ligne.montant.trim() ? lireNombre(ligne.montant) : null;
    const erreur = montant === null || montant <= 0 ? "Montant manquant." : !ligne.recuLe || ligne.recuLe > aujourdhui ? "Date manquante ou à venir." : null;
    return { ligne, montant, erreur };
  });
  const siretFaux = client ? null : erreurTypeClient(typeClient);
  const complet = champs.clientNom.trim() && !siretFaux && documentsLus.every((lu) => !lu.erreur) && paiementsLus.every((lu) => !lu.erreur);

  async function reprendre() {
    if (!complet) return;
    try {
      setEnvoi("Reprise du dossier…");
      const montantEstime = champs.montantEstime.trim() ? lireNombre(champs.montantEstime) : null;
      const jalonsEnvoyes = Object.fromEntries(
        JALONS.filter((jalon) => rang(jalon.etape) < rang(etape) && valeurJalon(jalon.etape)).map((jalon) => [jalon.etape, valeurJalon(jalon.etape)])
      );
      const resultat = await envoyerJson<{ id: string; documents: { index: number; documentId: string }[]; avertissements: string[] }>("/api/dossiers/reprise", "POST", {
        dossier: {
          clientNom: champs.clientNom,
          clientTelephone: champs.clientTelephone,
          clientEmail: champs.clientEmail || null,
          clientAdresse: champs.clientAdresse,
          clientCp: champs.clientCp,
          clientVille: champs.clientVille,
          objet: champs.objet,
          source: source || null,
          montantEstime: montantEstime !== null && montantEstime >= 0 ? montantEstime : null,
          clientId: client?.id ?? null,
          ...(client ? {} : typeClientPourEnvoi(typeClient)),
        },
        etape,
        dates: {
          ...(ouvertLe || deduites.OUVERTURE ? { ouvertLe: ouvertLe || deduites.OUVERTURE!.jour } : {}),
          jalons: jalonsEnvoyes,
          ...(etape !== "QUALIFICATION" && (etapeDepuisLe || deduites.ACTUELLE) ? { etapeDepuisLe: etapeDepuisLe || deduites.ACTUELLE!.jour } : {}),
          ...(dateChantier && rang(etape) >= rang("PLANIFIE") ? { dateChantier } : {}),
        },
        documents: documentsLus.map(({ ligne, montant }) => ({
          type: ligne.type,
          numero: ligne.numero.trim(),
          dateEmission: ligne.dateEmission,
          montant,
          ...(ligne.type === "DEVIS" ? { statut: ligne.statut } : {}),
          inscrireAuRegistre: ligne.inscrire,
        })),
        paiements: paiementsLus.map(({ ligne, montant }) => ({ montant, recuLe: ligne.recuLe, moyen: ligne.moyen || null, reference: ligne.reference.trim() || null })),
      });

      let pdfManquants = 0;
      const avecPdf = resultat.documents.filter(({ index }) => documents[index]?.pdf);
      for (const [rangPdf, { index, documentId }] of avecPdf.entries()) {
        setEnvoi(`Envoi du PDF ${rangPdf + 1} sur ${avecPdf.length}…`);
        const formulaire = new FormData();
        formulaire.set("pdf", documents[index].pdf!);
        try {
          await appelApi(`/api/dossiers/${resultat.id}/documents/${documentId}/pdf`, { method: "POST", body: formulaire });
        } catch {
          pdfManquants++;
        }
      }
      toast.success("Dossier repris", {
        description: [...resultat.avertissements, ...(pdfManquants ? [`${pdfManquants} PDF non envoyé${pdfManquants > 1 ? "s" : ""} : importe-les depuis le dossier.`] : [])].join(" ") || undefined,
      });
      onCree(resultat.id);
    } catch (probleme) {
      toast.error("Reprise impossible", { description: messageErreur(probleme) });
    } finally {
      setEnvoi(null);
    }
  }

  const aideDate = (cle: Jalon | "OUVERTURE" | "ACTUELLE", valeur: string) =>
    valeur ? undefined : deduites[cle] ? `Déduite : ${formatDateCourte(`${deduites[cle]!.jour}T12:00:00Z`)} (${deduites[cle]!.source})` : "Vide : date inconnue, signalée sur le dossier.";

  return (
    <Modale
      ouverte={ouverte}
      onFermer={() => (envoi ? undefined : onFermer())}
      largeur="lg"
      titre="Reprendre un dossier en cours"
      description="Un chantier commencé avant le CRM, en un écran : ce que tu sais aujourd'hui. Le reste sera signalé, à compléter plus tard."
      pied={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Bouton variante="fantome" onClick={onFermer} disabled={envoi !== null}>
            Annuler
          </Bouton>
          <Bouton variante="primaire" icone={<History size={14} aria-hidden />} disabled={!complet} chargement={envoi !== null} onClick={() => void reprendre()}>
            {envoi ?? "Reprendre le dossier"}
          </Bouton>
        </div>
      }
    >
      {onglets}
      <div className="space-y-7">
        <section>
          <TitreSection>Client</TitreSection>
          {client ? (
            <div className="mb-3 flex items-center justify-between gap-3 rounded-[9px] border-[0.5px] border-[#1D9E75]/30 bg-[#112B22]/60 px-3 py-2">
              <p className="min-w-0 truncate text-[13px] text-[#D1FAE5]">
                Fiche client : <span className="font-medium">{client.nom}</span>
              </p>
              <Bouton variante="fantome" taille="sm" onClick={() => setClient(null)}>
                Détacher
              </Bouton>
            </div>
          ) : (
            <label className="relative mb-3 block">
              <span className="sr-only">Rattacher à une fiche client existante</span>
              <Search size={14} aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[#6B7280]" />
              <input
                type="search"
                value={recherche}
                onChange={(evenement) => {
                  setRecherche(evenement.target.value);
                  if (evenement.target.value.trim().length < 2) setClients(null);
                }}
                placeholder="Client déjà connu ? Nom, téléphone, e-mail…"
                className={cn(CLASSE_SAISIE, "h-10 pl-8 sm:h-9")}
              />
              {clients && recherche.trim().length >= 2 ? (
                <ul className="mt-2 overflow-hidden rounded-[9px] border-[0.5px] border-[#2A2D34]">
                  {clients.length === 0 ? <li className="px-3 py-2 text-[12.5px] text-[#9CA3AF]">Aucune fiche : une fiche sera créée depuis le nom.</li> : null}
                  {clients.map((fiche) => (
                    <li key={fiche.id} className="border-t-[0.5px] border-[#2A2D34] first:border-t-0">
                      <button type="button" onClick={() => choisirClient(fiche)} className={cn("flex w-full flex-col px-3 py-2 text-left hover:bg-[#22262D]", TRANS)}>
                        <span className="text-[13px] font-medium text-[#F2F3F5]">{fiche.nom}</span>
                        <span className="text-[12px] text-[#6B7280]">{[fiche.ville, fiche.telephone ?? fiche.email].filter(Boolean).join(" · ")}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </label>
          )}
          {client ? null : (
            <div className="mb-3">
              <TypeClientDossier
                valeur={typeClient}
                onChange={setTypeClient}
                onEntreprise={remplirDepuisAnnuaire}
                onSousTraitance={(coche) => setSource((actuelle) => sourceSelonSousTraitance(actuelle, coche) as SourceDossier | "")}
                champNom={<Champ libelle={estEntreprise(typeClient) ? "Raison sociale" : "Nom du client"} obligatoire value={champs.clientNom} onChange={changer("clientNom")} />}
              />
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {client ? <Champ libelle="Nom du client" obligatoire value={champs.clientNom} onChange={changer("clientNom")} classeConteneur="sm:col-span-2 lg:col-span-1" /> : null}
            <Champ libelle="Téléphone" type="tel" inputMode="tel" value={champs.clientTelephone} onChange={changer("clientTelephone")} />
            <Champ libelle="E-mail" type="email" inputMode="email" value={champs.clientEmail} onChange={changer("clientEmail")} />
            <Champ libelle="Adresse du chantier" value={champs.clientAdresse} onChange={changer("clientAdresse")} classeConteneur="sm:col-span-2 lg:col-span-1" />
            <Champ libelle="Code postal" inputMode="numeric" maxLength={10} value={champs.clientCp} onChange={changer("clientCp")} />
            <Champ libelle="Ville" value={champs.clientVille} onChange={changer("clientVille")} />
          </div>
        </section>

        <section>
          <TitreSection>Chantier</TitreSection>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Champ libelle="Objet du chantier" placeholder="Ex. Façades de cuisine" value={champs.objet} onChange={changer("objet")} classeConteneur="sm:col-span-2 lg:col-span-1" />
            <ListeDeroulante
              libelle="Source"
              options={[{ valeur: "", libelle: "Non renseignée" }, ...SOURCES_DOSSIER.filter((valeur) => valeur !== "INCONNUE").map((valeur) => ({ valeur, libelle: LIBELLES_SOURCE[valeur] }))]}
              value={source}
              onChange={(evenement) => {
                const suivante = evenement.target.value as SourceDossier | "";
                setSource(suivante);
                if (!client) setTypeClient((actuel) => typeSelonSource(actuel, suivante));
              }}
            />
            <Champ libelle="Montant estimé (€)" inputMode="decimal" value={champs.montantEstime} onChange={changer("montantEstime")} />
          </div>
        </section>

        <section>
          <TitreSection>Où en est-il</TitreSection>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <ListeDeroulante
              libelle="Étape actuelle"
              options={ETAPES_ACTIVES.map((valeur) => ({ valeur, libelle: LIBELLES_ETAPE[valeur] }))}
              value={etape}
              onChange={(evenement) => setEtape(evenement.target.value as EtapeActive)}
            />
            <Champ libelle="Ouvert le" type="date" max={aujourdhui} value={ouvertLe} onChange={(evenement) => setOuvertLe(evenement.target.value)} aide={aideDate("OUVERTURE", ouvertLe)} />
            {JALONS.filter((jalon) => rang(jalon.etape) < rang(etape)).map((jalon) => (
              <Champ
                key={jalon.etape}
                libelle={jalon.libelle}
                type="date"
                max={aujourdhui}
                value={jalons[jalon.etape] ?? ""}
                onChange={(evenement) => setJalons((actuels) => ({ ...actuels, [jalon.etape]: evenement.target.value }))}
                aide={jalons[jalon.etape] ? undefined : deduites[jalon.etape] ? `Déduite : ${formatDateCourte(`${deduites[jalon.etape]!.jour}T12:00:00Z`)} (${deduites[jalon.etape]!.source})` : "Vide : pas de passage daté."}
              />
            ))}
            {etape !== "QUALIFICATION" ? (
              <Champ
                libelle={`En « ${LIBELLES_ETAPE[etape]} » depuis le`}
                type="date"
                max={aujourdhui}
                value={etapeDepuisLe}
                onChange={(evenement) => setEtapeDepuisLe(evenement.target.value)}
                aide={aideDate("ACTUELLE", etapeDepuisLe)}
              />
            ) : null}
            {rang(etape) >= rang("PLANIFIE") ? (
              <Champ libelle="Date du chantier" type="date" value={dateChantier} onChange={(evenement) => setDateChantier(evenement.target.value)} aide="Prévue ou passée." />
            ) : null}
          </div>
        </section>

        <section>
          <TitreSection
            action={
              <span className="flex gap-1">
                <Bouton taille="sm" variante="fantome" icone={<FilePlus2 size={13} aria-hidden />} onClick={() => ajouterDocument("DEVIS")}>
                  Devis
                </Bouton>
                <Bouton taille="sm" variante="fantome" icone={<Receipt size={13} aria-hidden />} onClick={() => ajouterDocument("FACTURE")}>
                  Facture
                </Bouton>
              </span>
            }
          >
            Documents déjà émis
          </TitreSection>
          {documents.length === 0 ? (
            <p className="text-[12.5px] text-[#6B7280]">Les devis et factures faits à la main, avec leur numéro du registre : rien ne sera généré.</p>
          ) : (
            <ul className="space-y-2">
              <datalist id={`${idListe}-devis`}>
                {numerosProposables(libres ?? [], "DEVIS").map((libre) => (
                  <option key={libre.id} value={libre.numero}>{[libre.destinataire, libre.montant ? formatMontant(libre.montant) : null].filter(Boolean).join(" · ")}</option>
                ))}
              </datalist>
              <datalist id={`${idListe}-factures`}>
                {numerosProposables(libres ?? [], "FACTURE").map((libre) => (
                  <option key={libre.id} value={libre.numero}>{[libre.destinataire, libre.montant ? formatMontant(libre.montant) : null].filter(Boolean).join(" · ")}</option>
                ))}
              </datalist>
              {documentsLus.map(({ ligne, connu }) => (
                <li key={ligne.cle} className="rounded-[10px] border-[0.5px] border-[#2A2D34] bg-[#1C1F25] p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <Pastille ton={ligne.type === "DEVIS" ? "neutre" : "bleu"}>{ligne.type === "DEVIS" ? "Devis" : "Facture"}</Pastille>
                    <Bouton variante="fantome" taille="icone" className="h-8 w-8 sm:h-7 sm:w-7" aria-label="Retirer ce document" onClick={() => setDocuments((actuels) => actuels.filter((autre) => autre.cle !== ligne.cle))}>
                      <X size={13} aria-hidden />
                    </Bouton>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Champ libelle="Numéro" obligatoire list={`${idListe}-${ligne.type === "DEVIS" ? "devis" : "factures"}`} autoComplete="off" placeholder={ligne.type === "DEVIS" ? "2026-012" : "F2026-004"} value={ligne.numero} onChange={(evenement) => choisirNumero(ligne, evenement.target.value)} />
                    <Champ libelle="Émis le" obligatoire type="date" max={aujourdhui} value={ligne.dateEmission} onChange={(evenement) => changerDocument(ligne.cle, { dateEmission: evenement.target.value })} />
                    <Champ libelle="Montant (€)" obligatoire inputMode="decimal" value={ligne.montant} onChange={(evenement) => changerDocument(ligne.cle, { montant: evenement.target.value })} />
                  </div>
                  {ligne.type === "DEVIS" ? (
                    <div className="mt-2">
                      <Puces
                        libelle="Où en est ce devis"
                        options={(["ENVOYE", "ACCEPTE", "REFUSE"] as const).map((valeur) => ({ valeur, libelle: LIBELLES_STATUT_DOCUMENT[valeur] }))}
                        valeur={ligne.statut as "ENVOYE" | "ACCEPTE" | "REFUSE"}
                        onChange={(statut) => changerDocument(ligne.cle, { statut })}
                      />
                    </div>
                  ) : null}
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
                    <label className="text-[12px] text-[#9CA3AF]">
                      <span className="mr-2">PDF</span>
                      <input
                        type="file"
                        accept="application/pdf,.pdf"
                        onChange={(evenement) => changerDocument(ligne.cle, { pdf: evenement.target.files?.[0] ?? null })}
                        className="text-[12px] text-[#9CA3AF] file:mr-2 file:h-8 file:rounded-[8px] file:border-[0.5px] file:border-[#2A2D34] file:bg-[#16181D] file:px-2.5 file:text-[12px] file:text-[#F2F3F5]"
                      />
                    </label>
                    {ligne.numero.trim() && libres && !connu ? (
                      <CaseACocher
                        libelle="Absent du registre : l'y inscrire (émis hors du CRM)"
                        checked={ligne.inscrire}
                        onChange={(inscrire) => changerDocument(ligne.cle, { inscrire })}
                      />
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <TitreSection
            action={
              <Bouton
                taille="sm"
                variante="fantome"
                icone={<Plus size={13} aria-hidden />}
                onClick={() => setPaiements((actuels) => [...actuels, { cle: cleUnique(), montant: "", recuLe: "", moyen: "", reference: "" }])}
              >
                Paiement
              </Bouton>
            }
          >
            Paiements déjà reçus
          </TitreSection>
          {paiements.length === 0 ? (
            <p className="text-[12.5px] text-[#6B7280]">Acomptes et soldes reçus, à leur vraie date, même avant l&apos;ouverture : ils s&apos;imputent sur les factures et devis ci-dessus.</p>
          ) : (
            <ul className="space-y-2">
              {paiements.map((ligne) => (
                <li key={ligne.cle} className="grid items-end gap-3 rounded-[10px] border-[0.5px] border-[#2A2D34] bg-[#1C1F25] p-3 sm:grid-cols-[1fr_1fr_1fr_1fr_auto]">
                  <Champ libelle="Montant (€)" obligatoire inputMode="decimal" value={ligne.montant} onChange={(evenement) => changerPaiement(ligne.cle, { montant: evenement.target.value })} />
                  <Champ libelle="Reçu le" obligatoire type="date" max={aujourdhui} value={ligne.recuLe} onChange={(evenement) => changerPaiement(ligne.cle, { recuLe: evenement.target.value })} />
                  <ListeDeroulante
                    libelle="Moyen"
                    options={[{ valeur: "", libelle: "Non renseigné" }, ...MOYENS_PAIEMENT.map((valeur) => ({ valeur, libelle: LIBELLES_MOYEN[valeur] }))]}
                    value={ligne.moyen}
                    onChange={(evenement) => changerPaiement(ligne.cle, { moyen: evenement.target.value as MoyenPaiement | "" })}
                  />
                  <Champ libelle="Référence" value={ligne.reference} maxLength={120} onChange={(evenement) => changerPaiement(ligne.cle, { reference: evenement.target.value })} />
                  <Bouton variante="fantome" taille="icone" aria-label="Retirer ce paiement" onClick={() => setPaiements((actuels) => actuels.filter((autre) => autre.cle !== ligne.cle))}>
                    <X size={13} aria-hidden />
                  </Bouton>
                </li>
              ))}
            </ul>
          )}
          {paiements.length > 0 ? (
            <p className="mt-2 flex items-center gap-1.5 text-[12px] text-[#6B7280]">
              <Wallet size={12} aria-hidden />
              {formatMontant(paiementsLus.reduce((somme, lu) => somme + (lu.montant ?? 0), 0))} reçus au total
            </p>
          ) : null}
        </section>
      </div>
    </Modale>
  );
}
