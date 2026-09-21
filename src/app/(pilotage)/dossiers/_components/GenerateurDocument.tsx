"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Download,
  ExternalLink,
  Heading,
  Plus,
  Settings2,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import {
  ACOMPTE_PCT_DEFAUT,
  LIBELLES_ETAPE,
  LIBELLES_TYPE_DOCUMENT,
  LIBELLES_UNITE,
  UNITES,
  type LigneDocument,
  type TypeDocument,
  type Unite,
} from "@/lib/dossiers/constants";
import {
  calculerMontants,
  formatCentimes,
  formatMontant,
  formatQuantite,
  lireNombre,
  totalLigneCentimes,
} from "@/lib/dossiers/montants";
import type { DocumentVue, DossierDetail, PresetVue } from "@/lib/dossiers/types";
import { cn } from "@/lib/utils";
import { useParametresExiges } from "@/components/pilotage/SaisieParametres";
import { GestionTarifs } from "./GestionTarifs";
import { appelApi, envoyerJson, messageErreur } from "./client";
import { Bouton, CaseACocher, Champ, CLASSE_SAISIE, Modale, TRANS } from "./ui";

type LigneSaisie =
  | {
      cle: string;
      type: "PRESTATION";
      designation: string;
      sousDesignation: string;
      quantite: string;
      unite: Unite;
      prixUnitaire: string;
    }
  | { cle: string; type: "SECTION"; libelle: string };

type Erreurs = Record<string, string>;

const nouvelleCle = () => crypto.randomUUID();

const prestationVide = (): LigneSaisie => ({
  cle: nouvelleCle(),
  type: "PRESTATION",
  designation: "",
  sousDesignation: "",
  quantite: "1",
  unite: "ml",
  prixUnitaire: "",
});

function saisieDepuis(lignes: LigneDocument[]): LigneSaisie[] {
  return lignes.map((ligne) =>
    ligne.type === "SECTION"
      ? { cle: nouvelleCle(), type: "SECTION", libelle: ligne.libelle }
      : {
          cle: nouvelleCle(),
          type: "PRESTATION",
          designation: ligne.designation,
          sousDesignation: ligne.sousDesignation ?? "",
          quantite: formatQuantite(ligne.quantite),
          unite: ligne.unite,
          prixUnitaire: formatQuantite(ligne.prixUnitaire),
        }
  );
}

/** Document de départ : le devis signé (ou le dernier devis) pour une facture, le dernier devis pour un devis. */
function documentDeDepart(detail: DossierDetail, type: TypeDocument): DocumentVue | undefined {
  const devis = detail.documents.filter((document) => document.type === "DEVIS" && document.numero);
  return type === "FACTURE" ? (devis.find((document) => document.statut === "ACCEPTE") ?? devis[0]) : devis[0];
}

function lireAcompte(saisie: string): number | null {
  const valeur = lireNombre(saisie);
  return valeur !== null && Number.isInteger(valeur) && valeur >= 0 && valeur <= 100 ? valeur : null;
}

type Resultat = { type: TypeDocument; numero: string; pdfUrl: string; totalHtCentimes: number };

export function GenerateurDocument({
  detail,
  typeInitial,
  remplace = null,
  onFermer,
  onGenere,
}: {
  detail: DossierDetail;
  typeInitial: TypeDocument;
  /** Devis refait : ses lignes servent de départ, il sera marqué « Remplacé ». */
  remplace?: DocumentVue | null;
  onFermer: () => void;
  onGenere: (detail: DossierDetail) => void;
}) {
  const { executer: avecParametres, modale: modaleParametres } = useParametresExiges();
  const depart = remplace ?? documentDeDepart(detail, typeInitial);
  const [type, setType] = useState<TypeDocument>(typeInitial);
  const [objet, setObjet] = useState(depart?.objet ?? detail.objet);
  const [lignes, setLignes] = useState<LigneSaisie[]>(() => (depart ? saisieDepuis(depart.lignes) : [prestationVide()]));
  const [noteMl, setNoteMl] = useState(depart?.noteMl ?? true);
  const [acompte, setAcompte] = useState(String(depart?.acomptePct ?? ACOMPTE_PCT_DEFAUT));
  const [presets, setPresets] = useState<PresetVue[]>([]);
  const [gestionTarifs, setGestionTarifs] = useState(false);
  const [numero, setNumero] = useState<{ type: TypeDocument; valeur: string } | null>(null);
  const [erreurs, setErreurs] = useState<Erreurs>({});
  const [envoi, setEnvoi] = useState(false);
  const [resultat, setResultat] = useState<Resultat | null>(null);

  useEffect(() => {
    let actif = true;
    appelApi<{ presets: PresetVue[] }>("/api/dossiers/presets")
      .then((reponse) => {
        if (actif) setPresets(reponse.presets);
      })
      .catch((probleme: unknown) => toast.error("Tarifs indisponibles", { description: messageErreur(probleme) }));
    return () => {
      actif = false;
    };
  }, []);

  // Premier devis du dossier : on part de ce que le client a choisi dans son espace (teintes par
  // zone, mètres), posé sur les tarifs. Seulement si rien n'a encore été saisi.
  const [proposition, setProposition] = useState<string | null>(null);
  const lignesCourantes = useRef(lignes);
  useEffect(() => {
    lignesCourantes.current = lignes;
  }, [lignes]);
  useEffect(() => {
    if (typeInitial !== "DEVIS" || depart) return;
    let actif = true;
    appelApi<{ proposition: { resume: string; lignes: { designation: string; sousDesignation: string; quantite: number | null; unite: Unite; prixUnitaire: number | null }[] } | null }>(`/api/dossiers/${detail.id}/devis-propose`)
      .then(({ proposition: proposee }) => {
        if (!actif || !proposee || proposee.lignes.length === 0) return;
        const depuisEspace: LigneSaisie[] = proposee.lignes.map((ligne) => ({
          cle: nouvelleCle(),
          type: "PRESTATION",
          designation: ligne.designation,
          sousDesignation: ligne.sousDesignation,
          quantite: ligne.quantite === null ? "" : formatQuantite(ligne.quantite),
          unite: ligne.unite,
          prixUnitaire: ligne.prixUnitaire === null ? "" : formatQuantite(ligne.prixUnitaire),
        }));
        // Déjà une saisie en cours : on n'y touche pas.
        const actuelles = lignesCourantes.current;
        const vierge = actuelles.length === 1 && actuelles[0].type === "PRESTATION" && !actuelles[0].designation.trim() && !actuelles[0].prixUnitaire.trim();
        if (!vierge) return;
        setLignes(depuisEspace);
        setProposition(proposee.resume);
      })
      .catch(() => undefined);
    return () => {
      actif = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- une fois, à l'ouverture
  }, []);

  useEffect(() => {
    let actif = true;
    appelApi<{ numero: string }>(`/api/dossiers/numerotation?type=${type}`)
      .then((reponse) => {
        if (actif) setNumero({ type, valeur: reponse.numero });
      })
      .catch(() => undefined);
    return () => {
      actif = false;
    };
  }, [type]);

  const numeroAffiche = numero?.type === type ? numero.valeur : null;

  // Totaux en direct, sur les lignes lisibles.
  const lignesLisibles: LigneDocument[] = lignes.flatMap((ligne): LigneDocument[] => {
    if (ligne.type === "SECTION") return [];
    const quantite = lireNombre(ligne.quantite);
    const prixUnitaire = lireNombre(ligne.prixUnitaire);
    if (quantite === null || prixUnitaire === null) return [];
    return [{ type: "PRESTATION", designation: ligne.designation, quantite, unite: ligne.unite, prixUnitaire }];
  });
  const pourcentage = type === "DEVIS" ? lireAcompte(acompte) : null;
  const montants = calculerMontants(lignesLisibles, pourcentage);
  const presenceMl = lignes.some((ligne) => ligne.type === "PRESTATION" && ligne.unite === "ml");

  const modifier = (cle: string, champs: Partial<Record<string, string>>) =>
    setLignes((actuelles) =>
      actuelles.map((ligne) => (ligne.cle === cle ? ({ ...ligne, ...champs } as LigneSaisie) : ligne))
    );
  const supprimer = (cle: string) => setLignes((actuelles) => actuelles.filter((ligne) => ligne.cle !== cle));
  const deplacer = (cle: string, sens: -1 | 1) =>
    setLignes((actuelles) => {
      const index = actuelles.findIndex((ligne) => ligne.cle === cle);
      const cible = index + sens;
      if (index < 0 || cible < 0 || cible >= actuelles.length) return actuelles;
      const copie = [...actuelles];
      [copie[index], copie[cible]] = [copie[cible], copie[index]];
      return copie;
    });

  function ajouterPreset(preset: PresetVue) {
    const ligne: LigneSaisie = {
      cle: nouvelleCle(),
      type: "PRESTATION",
      designation: preset.designation,
      sousDesignation: "",
      quantite: "1",
      unite: preset.unite,
      prixUnitaire: preset.prixUnitaire === null ? "" : formatQuantite(preset.prixUnitaire),
    };
    // Une ligne vide de départ est remplacée plutôt que laissée en tête.
    setLignes((actuelles) =>
      actuelles.length === 1 &&
      actuelles[0].type === "PRESTATION" &&
      !actuelles[0].designation.trim() &&
      !actuelles[0].prixUnitaire.trim()
        ? [ligne]
        : [...actuelles, ligne]
    );
  }

  function valider(): LigneDocument[] | null {
    const trouvees: Erreurs = {};
    const valides: LigneDocument[] = [];
    if (!objet.trim()) trouvees.objet = "L'objet du document est obligatoire.";
    for (const ligne of lignes) {
      if (ligne.type === "SECTION") {
        if (ligne.libelle.trim()) valides.push({ type: "SECTION", libelle: ligne.libelle.trim() });
        else trouvees[`${ligne.cle}:libelle`] = "Libellé de section vide.";
        continue;
      }
      const quantite = lireNombre(ligne.quantite);
      const prixUnitaire = lireNombre(ligne.prixUnitaire);
      if (!ligne.designation.trim()) trouvees[`${ligne.cle}:designation`] = "Désignation obligatoire.";
      if (quantite === null || quantite <= 0) trouvees[`${ligne.cle}:quantite`] = "Quantité invalide.";
      if (prixUnitaire === null || prixUnitaire < 0) trouvees[`${ligne.cle}:prixUnitaire`] = "Prix à renseigner.";
      if (ligne.designation.trim() && quantite !== null && quantite > 0 && prixUnitaire !== null && prixUnitaire >= 0) {
        valides.push({
          type: "PRESTATION",
          designation: ligne.designation.trim(),
          ...(ligne.sousDesignation.trim() ? { sousDesignation: ligne.sousDesignation.trim() } : {}),
          quantite,
          unite: ligne.unite,
          prixUnitaire,
        });
      }
    }
    if (!lignes.some((ligne) => ligne.type === "PRESTATION")) trouvees.lignes = "Ajoute au moins une prestation.";
    if (type === "DEVIS" && lireAcompte(acompte) === null) trouvees.acompte = "Nombre entier entre 0 et 100.";
    if (Object.keys(trouvees).length === 0 && calculerMontants(valides, null).totalHtCentimes <= 0) {
      trouvees.lignes = "Le total du document est nul.";
    }
    setErreurs(trouvees);
    return Object.keys(trouvees).length === 0 ? valides : null;
  }

  async function generer() {
    const valides = valider();
    if (!valides) {
      toast.error("Document incomplet", { description: "Corrige les champs signalés en rouge." });
      return;
    }
    setEnvoi(true);
    try {
      // Facture à un professionnel : si un paramètre légal manque (échéance,
      // pénalités…), la fenêtre de saisie s'ouvre puis la génération reprend.
      await avecParametres(async () => {
        const reponse = await envoyerJson<{
          document: { numero: string; pdfUrl: string };
          dossier: DossierDetail;
        }>(`/api/dossiers/${detail.id}/documents`, "POST", {
          type,
          objet: objet.trim(),
          lignes: valides,
          noteMl,
          acomptePct: type === "DEVIS" ? lireAcompte(acompte) : null,
          remplaceDocumentId: type === "DEVIS" && remplace ? remplace.id : null,
        });
        onGenere(reponse.dossier);
        setResultat({
          type,
          numero: reponse.document.numero,
          pdfUrl: reponse.document.pdfUrl,
          totalHtCentimes: calculerMontants(valides, null).totalHtCentimes,
        });
      });
    } catch (probleme) {
      toast.error("Génération impossible", { description: messageErreur(probleme) });
    } finally {
      setEnvoi(false);
    }
  }

  const libelleType = type === "DEVIS" ? "le devis" : "la facture";
  const titre = resultat
    ? `${LIBELLES_TYPE_DOCUMENT[resultat.type]} ${resultat.numero}`
    : type === "DEVIS"
      ? remplace
        ? `Refaire le devis ${remplace.numero}`
        : "Nouveau devis"
      : "Nouvelle facture";

  return (
    <>
    <Modale
      ouverte
      onFermer={onFermer}
      largeur="lg"
      titre={titre}
      description={`${detail.clientNom} · ${detail.clientCp} ${detail.clientVille}`}
      pied={
        resultat ? (
          <div className="flex justify-end">
            <Bouton variante="secondaire" onClick={onFermer}>
              Fermer
            </Bouton>
          </div>
        ) : gestionTarifs ? null : (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[12px] text-[#6B7280]">
              Le numéro est attribué à la génération et ne sera jamais réutilisé.
            </p>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Bouton variante="fantome" onClick={onFermer}>
                Annuler
              </Bouton>
              <Bouton variante="primaire" chargement={envoi} onClick={() => void generer()}>
                {numeroAffiche ? `Générer ${libelleType} n° ${numeroAffiche}` : `Générer ${libelleType}`}
              </Bouton>
            </div>
          </div>
        )
      }
    >
      {resultat ? (
        <div className="flex flex-col items-center gap-2 py-10 text-center">
          <CheckCircle2 size={30} className="text-[#1D9E75]" aria-hidden />
          <p className="mt-1 text-[15px] font-medium text-[#F2F3F5]">
            {LIBELLES_TYPE_DOCUMENT[resultat.type]} {resultat.numero} {resultat.type === "DEVIS" ? "généré" : "générée"}
          </p>
          <p className="text-[13px] text-[#9CA3AF]">
            {formatCentimes(resultat.totalHtCentimes)} · PDF archivé dans le dossier · étape : {LIBELLES_ETAPE[detail.etape]}
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <a
              href={resultat.pdfUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                "inline-flex h-10 items-center gap-1.5 rounded-[8px] bg-[#1D9E75] px-4 text-[13px] font-medium text-[#0B1612] hover:bg-[#5DCAA5]",
                TRANS
              )}
            >
              <ExternalLink size={14} aria-hidden />
              Ouvrir le PDF
            </a>
            <a
              href={`${resultat.pdfUrl}?telecharger=1`}
              className={cn(
                "inline-flex h-10 items-center gap-1.5 rounded-[8px] border-[0.5px] border-[#2A2D34] bg-[#1C1F25] px-4 text-[13px] font-medium text-[#F2F3F5] hover:border-[#3A3E47] hover:bg-[#22262D]",
                TRANS
              )}
            >
              <Download size={14} aria-hidden />
              Télécharger
            </a>
          </div>
        </div>
      ) : gestionTarifs ? (
        <GestionTarifs presets={presets} setPresets={setPresets} onRetour={() => setGestionTarifs(false)} />
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-end gap-3">
            <div
              role="tablist"
              aria-label="Type de document"
              className="flex items-center rounded-[9px] border-[0.5px] border-[#2A2D34] bg-[#16181D] p-[3px]"
            >
              {/* Un devis refait reste un devis : une facture s'annule par un avoir. */}
              {(remplace ? (["DEVIS"] as const) : (["DEVIS", "FACTURE"] as const)).map((valeur) => (
                <button
                  key={valeur}
                  type="button"
                  role="tab"
                  aria-selected={type === valeur}
                  onClick={() => setType(valeur)}
                  className={cn(
                    "h-9 rounded-[7px] px-4 text-[13px] font-medium sm:h-7",
                    type === valeur ? "bg-[#272B33] text-[#F2F3F5]" : "text-[#9CA3AF] hover:text-[#F2F3F5]",
                    TRANS
                  )}
                >
                  {LIBELLES_TYPE_DOCUMENT[valeur]}
                </button>
              ))}
            </div>
            <p className="pb-1.5 text-[12px] text-[#9CA3AF]">
              Prochain numéro : <span className="font-medium text-[#F2F3F5] tabular-nums">{numeroAffiche ?? "…"}</span>
            </p>
          </div>

          <Champ
            libelle="Objet"
            obligatoire
            value={objet}
            maxLength={160}
            onChange={(evenement) => setObjet(evenement.target.value)}
            erreur={erreurs.objet}
          />

          {proposition ? (
            <p className="rounded-[9px] border-[0.5px] border-[#1D9E75]/40 bg-[#1D9E75]/[0.08] px-3 py-2.5 text-[12.5px] leading-relaxed text-[#C9EFE1]">
              <span className="font-medium text-[#5DCAA5]">Prérempli. </span>
              {proposition} Vérifie le métré, complète les prix laissés vides, ajoute tes lignes habituelles.
            </p>
          ) : null}

          <div>
            <div className="mb-2 hidden grid-cols-[minmax(0,1fr)_72px_92px_96px_96px_108px] gap-2 px-2.5 text-[11px] font-medium text-[#6B7280] uppercase sm:grid">
              <span>Désignation</span>
              <span>Qté</span>
              <span>Unité</span>
              <span className="text-right">PU HT (€)</span>
              <span className="text-right">Total HT</span>
              <span />
            </div>
            <ol className="space-y-2">
              {lignes.map((ligne, index) => (
                <li key={ligne.cle}>
                  {ligne.type === "SECTION" ? (
                    <div className="rounded-[9px] border-[0.5px] border-[#3A3E47] bg-[#2A2D34]/50 p-2">
                    <div className="flex items-center gap-2">
                      <Heading size={14} className="ml-1 shrink-0 text-[#9CA3AF]" aria-hidden />
                      <input
                        aria-label="Libellé de la section"
                        value={ligne.libelle}
                        maxLength={120}
                        onChange={(evenement) => modifier(ligne.cle, { libelle: evenement.target.value })}
                        placeholder="Section (ex. CUISINE, DRESSING N°1 — CHAMBRE)"
                        aria-invalid={erreurs[`${ligne.cle}:libelle`] ? true : undefined}
                        className={cn(CLASSE_SAISIE, "h-10 font-medium sm:h-8")}
                      />
                      <ActionsLigne
                        premiere={index === 0}
                        derniere={index === lignes.length - 1}
                        onMonter={() => deplacer(ligne.cle, -1)}
                        onDescendre={() => deplacer(ligne.cle, 1)}
                        onSupprimer={() => supprimer(ligne.cle)}
                      />
                    </div>
                    {erreurs[`${ligne.cle}:libelle`] ? (
                      <p className="mt-1.5 pl-7 text-[12px] text-[#F87171]">{erreurs[`${ligne.cle}:libelle`]}</p>
                    ) : null}
                    </div>
                  ) : (
                    <div className="rounded-[9px] border-[0.5px] border-[#2A2D34] bg-[#16181D] p-2.5">
                      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_72px_92px_96px_96px_108px] sm:items-start">
                        <div className="space-y-1.5">
                          <input
                            aria-label="Désignation"
                            value={ligne.designation}
                            maxLength={200}
                            onChange={(evenement) => modifier(ligne.cle, { designation: evenement.target.value })}
                            placeholder="Désignation"
                            aria-invalid={erreurs[`${ligne.cle}:designation`] ? true : undefined}
                            className={cn(CLASSE_SAISIE, "h-10 sm:h-8")}
                          />
                          <input
                            aria-label="Sous-désignation"
                            value={ligne.sousDesignation}
                            maxLength={200}
                            onChange={(evenement) => modifier(ligne.cle, { sousDesignation: evenement.target.value })}
                            placeholder="Sous-désignation (facultative)"
                            className={cn(CLASSE_SAISIE, "h-10 font-semibold italic sm:h-8")}
                          />
                        </div>
                        <div className="grid grid-cols-3 gap-2 sm:contents">
                          <input
                            aria-label="Quantité"
                            inputMode="decimal"
                            value={ligne.quantite}
                            onChange={(evenement) => modifier(ligne.cle, { quantite: evenement.target.value })}
                            aria-invalid={erreurs[`${ligne.cle}:quantite`] ? true : undefined}
                            className={cn(CLASSE_SAISIE, "h-10 text-center sm:h-8")}
                          />
                          <select
                            aria-label="Unité"
                            value={ligne.unite}
                            onChange={(evenement) => modifier(ligne.cle, { unite: evenement.target.value })}
                            className={cn(CLASSE_SAISIE, "h-10 px-2 sm:h-8")}
                          >
                            {UNITES.map((unite) => (
                              <option key={unite} value={unite}>
                                {LIBELLES_UNITE[unite]}
                              </option>
                            ))}
                          </select>
                          <input
                            aria-label="Prix unitaire HT"
                            inputMode="decimal"
                            value={ligne.prixUnitaire}
                            onChange={(evenement) => modifier(ligne.cle, { prixUnitaire: evenement.target.value })}
                            placeholder="PU HT"
                            aria-invalid={erreurs[`${ligne.cle}:prixUnitaire`] ? true : undefined}
                            className={cn(CLASSE_SAISIE, "h-10 text-right sm:h-8")}
                          />
                        </div>
                        <div className="flex items-center justify-between gap-2 sm:contents">
                          <span className="text-[13px] text-[#F2F3F5] tabular-nums sm:pt-1.5 sm:text-right">
                            {(() => {
                              const quantite = lireNombre(ligne.quantite);
                              const prixUnitaire = lireNombre(ligne.prixUnitaire);
                              return quantite !== null && prixUnitaire !== null
                                ? formatCentimes(totalLigneCentimes({ quantite, prixUnitaire }))
                                : "—";
                            })()}
                          </span>
                          <ActionsLigne
                            premiere={index === 0}
                            derniere={index === lignes.length - 1}
                            onMonter={() => deplacer(ligne.cle, -1)}
                            onDescendre={() => deplacer(ligne.cle, 1)}
                            onSupprimer={() => supprimer(ligne.cle)}
                          />
                        </div>
                      </div>
                      {[
                        erreurs[`${ligne.cle}:designation`],
                        erreurs[`${ligne.cle}:quantite`],
                        erreurs[`${ligne.cle}:prixUnitaire`],
                      ].filter(Boolean).length > 0 ? (
                        <p className="mt-1.5 text-[12px] text-[#F87171]">
                          {[
                            erreurs[`${ligne.cle}:designation`],
                            erreurs[`${ligne.cle}:quantite`],
                            erreurs[`${ligne.cle}:prixUnitaire`],
                          ]
                            .filter(Boolean)
                            .join(" ")}
                        </p>
                      ) : null}
                    </div>
                  )}
                </li>
              ))}
            </ol>
            {erreurs.lignes ? <p className="mt-2 text-[12px] text-[#F87171]">{erreurs.lignes}</p> : null}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Bouton
                variante="secondaire"
                taille="sm"
                icone={<Plus size={13} aria-hidden />}
                onClick={() => setLignes((actuelles) => [...actuelles, prestationVide()])}
              >
                Prestation
              </Bouton>
              <Bouton
                variante="secondaire"
                taille="sm"
                icone={<Heading size={13} aria-hidden />}
                onClick={() => setLignes((actuelles) => [...actuelles, { cle: nouvelleCle(), type: "SECTION", libelle: "" }])}
              >
                Section
              </Bouton>
              <select
                aria-label="Ajouter une ligne depuis un tarif"
                value=""
                onChange={(evenement) => {
                  const preset = presets.find((p) => p.id === evenement.target.value);
                  if (preset) ajouterPreset(preset);
                }}
                className={cn(CLASSE_SAISIE, "h-10 w-auto max-w-full min-w-0 flex-1 sm:h-7 sm:max-w-[280px] sm:text-[12px]")}
              >
                <option value="">Ajouter depuis un tarif…</option>
                {presets.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.designation} ·{" "}
                    {preset.prixUnitaire === null
                      ? "prix à saisir"
                      : `${formatMontant(preset.prixUnitaire)} / ${LIBELLES_UNITE[preset.unite]}`}
                  </option>
                ))}
              </select>
              <Bouton
                variante="fantome"
                taille="sm"
                icone={<Settings2 size={13} aria-hidden />}
                onClick={() => setGestionTarifs(true)}
              >
                Gérer les tarifs
              </Bouton>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_300px]">
            <div className="space-y-3">
              <CaseACocher
                libelle="Afficher la mention mètre linéaire"
                description={
                  noteMl && !presenceMl
                    ? "Aucune ligne en ml : décoche-la pour un document au forfait."
                    : "À décocher pour les prestations forfaitaires."
                }
                checked={noteMl}
                onChange={setNoteMl}
              />
              {type === "DEVIS" ? (
                <Champ
                  libelle="Acompte à la signature (%)"
                  inputMode="numeric"
                  value={acompte}
                  onChange={(evenement) => setAcompte(evenement.target.value)}
                  erreur={erreurs.acompte}
                  classeConteneur="max-w-[220px]"
                />
              ) : null}
            </div>

            <dl className="h-fit space-y-1.5 rounded-[11px] border-[0.5px] border-[#2A2D34] bg-[#16181D] p-3.5 text-[13px]">
              <div className="flex justify-between gap-3">
                <dt className="text-[#9CA3AF]">Total HT</dt>
                <dd className="text-[#F2F3F5] tabular-nums">{formatCentimes(montants.totalHtCentimes)}</dd>
              </div>
              <p className="text-[11px] text-[#6B7280] italic">TVA non applicable, article 293 B du CGI</p>
              <div className="flex justify-between gap-3 border-t-[0.5px] border-[#2A2D34] pt-2 font-medium">
                <dt className="text-[#F2F3F5]">Total TTC</dt>
                <dd className="text-[#F87171] tabular-nums">{formatCentimes(montants.totalTtcCentimes)}</dd>
              </div>
              {type === "DEVIS" && pourcentage !== null && pourcentage > 0 ? (
                <>
                  <div className="flex justify-between gap-3 text-[12px]">
                    <dt className="text-[#9CA3AF]">Acompte {pourcentage} %</dt>
                    <dd className="text-[#D1D5DB] tabular-nums">{formatCentimes(montants.acompteCentimes)}</dd>
                  </div>
                  <div className="flex justify-between gap-3 text-[12px]">
                    <dt className="text-[#9CA3AF]">Solde</dt>
                    <dd className="text-[#D1D5DB] tabular-nums">{formatCentimes(montants.soldeCentimes)}</dd>
                  </div>
                </>
              ) : null}
            </dl>
          </div>
        </div>
      )}
    </Modale>
    {modaleParametres}
    </>
  );
}

function ActionsLigne({
  premiere,
  derniere,
  onMonter,
  onDescendre,
  onSupprimer,
}: {
  premiere: boolean;
  derniere: boolean;
  onMonter: () => void;
  onDescendre: () => void;
  onSupprimer: () => void;
}) {
  return (
    <span className="flex shrink-0 justify-end gap-1">
      <Bouton variante="fantome" taille="icone" aria-label="Monter la ligne" disabled={premiere} onClick={onMonter}>
        <ArrowUp size={14} />
      </Bouton>
      <Bouton variante="fantome" taille="icone" aria-label="Descendre la ligne" disabled={derniere} onClick={onDescendre}>
        <ArrowDown size={14} />
      </Bouton>
      <Bouton variante="fantome" taille="icone" aria-label="Supprimer la ligne" onClick={onSupprimer}>
        <Trash2 size={14} />
      </Bouton>
    </span>
  );
}
