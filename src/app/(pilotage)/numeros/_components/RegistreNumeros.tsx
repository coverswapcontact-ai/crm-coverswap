"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, ChevronDown, ChevronRight, Hash, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { envoyerJson, messageErreur } from "@/components/pilotage/client";
import { Bouton, Champ, EnTetePage, ListeDeroulante, Modale, Pastille, TRANS, TitreSection, ZoneTexte } from "@/components/pilotage/ui";
import { formatDateCourte } from "@/lib/dossiers/dates";
import { formatMontant, lireNombre } from "@/lib/dossiers/montants";
import type { LigneRegistre, SerieRegistre } from "@/lib/dossiers/registre";
import { cn } from "@/lib/utils";

const LIBELLES_TYPE: Record<LigneRegistre["type"], string> = { DEVIS: "Devis", FACTURE: "Facture", AVOIR: "Avoir", INCONNU: "Nature inconnue" };
const LIBELLES_ORIGINE: Record<LigneRegistre["origine"], string> = { CRM: "CRM", ANCIEN_CRM: "Ancien écran", MANUEL: "Manuel" };
const TON_TYPE: Record<LigneRegistre["type"], "bleu" | "rouge" | "ambre" | "neutre"> = { DEVIS: "neutre", FACTURE: "bleu", AVOIR: "rouge", INCONNU: "ambre" };
const OPTIONS_TYPE = [
  { valeur: "DEVIS", libelle: "Devis" },
  { valeur: "FACTURE", libelle: "Facture" },
  { valeur: "AVOIR", libelle: "Avoir" },
  { valeur: "INCONNU", libelle: "Nature inconnue" },
];

type Saisie = { numero: string; type: string; emisLe: string; destinataire: string; montant: string; note: string };
const VIDE: Saisie = { numero: "", type: "FACTURE", emisLe: "", destinataire: "", montant: "", note: "" };

type Element = { plage: false; ligne: LigneRegistre } | { plage: true; cle: string; lignes: LigneRegistre[] };

/** Numéros manuels consécutifs, de même nature et sans complément : une seule ligne dépliable. */
function regrouper(lignes: LigneRegistre[]): Element[] {
  const nu = (ligne: LigneRegistre) =>
    ligne.origine === "MANUEL" && !ligne.emisLe && !ligne.destinataire && ligne.montant === null && !ligne.documentId;
  const elements: Element[] = [];
  let courant: LigneRegistre[] = [];
  const vider = () => {
    if (courant.length >= 3) elements.push({ plage: true, cle: courant[0].id, lignes: courant });
    else elements.push(...courant.map((ligne) => ({ plage: false as const, ligne })));
    courant = [];
  };
  for (const ligne of lignes) {
    const precedent = courant.at(-1);
    if (precedent && nu(ligne) && precedent.type === ligne.type && precedent.note === ligne.note && precedent.rang + 1 === ligne.rang) {
      courant.push(ligne);
      continue;
    }
    vider();
    if (nu(ligne)) courant.push(ligne);
    else elements.push({ plage: false, ligne });
  }
  vider();
  return elements;
}

function LigneNumero({ ligne, onCompleter }: { ligne: LigneRegistre; onCompleter: (ligne: LigneRegistre) => void }) {
  const details = [ligne.emisLe ? formatDateCourte(ligne.emisLe) : null, ligne.destinataire, ligne.montant !== null ? formatMontant(ligne.montant) : null].filter(Boolean);
  return (
    <li className="flex items-center gap-3 border-t-[0.5px] border-[#2A2D34] px-4 py-2.5 first:border-t-0">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <span className="flex items-center gap-1.5 text-[13px] font-medium text-[#F2F3F5] tabular-nums">
            <Hash size={12} aria-hidden className="text-[#6B7280]" />
            {ligne.numero}
          </span>
          <Pastille ton={TON_TYPE[ligne.type]}>{LIBELLES_TYPE[ligne.type]}</Pastille>
          <span className="text-[12px] text-[#6B7280]">{LIBELLES_ORIGINE[ligne.origine]}</span>
        </div>
        {details.length > 0 ? <p className="mt-0.5 text-[12.5px] text-[#9CA3AF]">{details.join(" · ")}</p> : null}
        {ligne.note ? <p className="mt-0.5 text-[11.5px] text-[#6B7280]">{ligne.note}</p> : null}
      </div>
      {ligne.dossierId ? (
        <Link href={`/dossiers?dossier=${ligne.dossierId}`} className={cn("shrink-0 text-[12px] text-[#9CA3AF] hover:text-[#F2F3F5]", TRANS)}>
          Dossier
        </Link>
      ) : null}
      {ligne.leadId ? (
        <Link href={`/prospects?lead=${ligne.leadId}`} className={cn("shrink-0 text-[12px] text-[#9CA3AF] hover:text-[#F2F3F5]", TRANS)}>
          Contact
        </Link>
      ) : null}
      {ligne.ancienPdf ? (
        <a href={ligne.ancienPdf} target="_blank" rel="noopener noreferrer" className={cn("shrink-0 text-[12px] text-[#5DCAA5] hover:underline", TRANS)}>
          {ligne.type === "FACTURE" ? "Voir" : "PDF"}
        </a>
      ) : null}
      {ligne.origine !== "CRM" ? (
        <Bouton taille="icone" variante="fantome" className="shrink-0" aria-label={`Compléter ${ligne.numero}`} onClick={() => onCompleter(ligne)}>
          <Pencil size={13} aria-hidden />
        </Bouton>
      ) : null}
    </li>
  );
}

export default function RegistreNumeros({ initiales }: { initiales: SerieRegistre[] }) {
  const [series, setSeries] = useState(initiales);
  const [declaration, setDeclaration] = useState(false);
  const [enComplement, setEnComplement] = useState<LigneRegistre | null>(null);
  const [plagesOuvertes, setPlagesOuvertes] = useState<ReadonlySet<string>>(new Set());
  const [saisie, setSaisie] = useState<Saisie>(VIDE);
  const [envoi, setEnvoi] = useState(false);

  const changer = (cle: keyof Saisie) => (evenement: { target: { value: string } }) =>
    setSaisie((actuelle) => ({ ...actuelle, [cle]: evenement.target.value }));

  function completer(ligne: LigneRegistre) {
    setSaisie({
      numero: ligne.numero,
      type: ligne.type,
      emisLe: "",
      destinataire: ligne.destinataire ?? "",
      montant: ligne.montant !== null ? String(ligne.montant) : "",
      note: ligne.note ?? "",
    });
    setEnComplement(ligne);
  }

  function fermer() {
    setDeclaration(false);
    setEnComplement(null);
  }

  function basculerPlage(cle: string) {
    setPlagesOuvertes((actuelles) => {
      const suivantes = new Set(actuelles);
      if (suivantes.has(cle)) suivantes.delete(cle);
      else suivantes.add(cle);
      return suivantes;
    });
  }

  async function enregistrer() {
    setEnvoi(true);
    try {
      const montant = saisie.montant.trim() ? lireNombre(saisie.montant) : null;
      const reponse = enComplement
        ? await envoyerJson<{ series: SerieRegistre[] }>(`/api/numeros/${enComplement.id}`, "PATCH", {
            type: saisie.type,
            ...(!enComplement.emisLe && saisie.emisLe ? { emisLe: saisie.emisLe } : {}),
            destinataire: saisie.destinataire || null,
            montant,
            note: saisie.note || null,
          })
        : await envoyerJson<{ series: SerieRegistre[] }>("/api/numeros", "POST", {
            numero: saisie.numero,
            type: saisie.type,
            emisLe: saisie.emisLe || null,
            destinataire: saisie.destinataire || null,
            montant,
            note: saisie.note || null,
          });
      setSeries(reponse.series);
      fermer();
      toast.success(enComplement ? "Numéro complété" : "Numéro inscrit au registre", {
        description: enComplement ? undefined : "Il ne sera jamais attribué par le CRM.",
      });
    } catch (erreur) {
      toast.error("Enregistrement impossible", { description: messageErreur(erreur) });
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-5 py-6 md:px-8 md:py-8">
      <EnTetePage
        titre="Registre des numéros"
        sousTitre="Tout numéro de devis, de facture ou d'avoir déjà émis. Un numéro inscrit n'est jamais réattribué."
        actions={
          <Bouton
            variante="primaire"
            icone={<Plus size={15} aria-hidden />}
            onClick={() => {
              setSaisie(VIDE);
              setDeclaration(true);
            }}
          >
            Déclarer un numéro émis hors CRM
          </Bouton>
        }
      />

      {series.length === 0 ? <p className="mt-6 text-[13px] text-[#9CA3AF]">Aucun numéro inscrit pour l&apos;instant.</p> : null}

      {series.map((serie) => (
        <section key={`${serie.famille}:${serie.annee}`} className="mt-6">
          <TitreSection>{serie.libelle}</TitreSection>
          {serie.trous.length > 0 ? (
            <p className="mb-2 flex items-start gap-2 rounded-[8px] bg-[#EF9F27]/10 px-3 py-2 text-[12.5px] text-[#F5B454]">
              <AlertTriangle size={14} aria-hidden className="mt-px shrink-0" />
              <span>
                {serie.trous.length} rang{serie.trous.length > 1 ? "s" : ""} sans inscription : {serie.trous.slice(0, 12).join(", ")}
                {serie.trous.length > 12 ? "…" : ""}
                {serie.famille === "F" ? " — une série de factures doit être continue : à déclarer ou à expliquer." : " — à déclarer si ces numéros ont été émis."}
              </span>
            </p>
          ) : null}
          <ul className="overflow-hidden rounded-[11px] border-[0.5px] border-[#2A2D34] bg-[#1C1F25]">
            {regrouper(serie.lignes).map((element) => {
              if (!element.plage) return <LigneNumero key={element.ligne.id} ligne={element.ligne} onCompleter={completer} />;
              const [premiere] = element.lignes;
              const derniere = element.lignes[element.lignes.length - 1];
              const ouverte = plagesOuvertes.has(element.cle);
              return (
                <li key={element.cle} className="border-t-[0.5px] border-[#2A2D34] first:border-t-0">
                  <button
                    type="button"
                    aria-expanded={ouverte}
                    aria-label={`${premiere.numero} à ${derniere.numero} : ${element.lignes.length} numéros, ${LIBELLES_TYPE[premiere.type].toLowerCase()}`}
                    onClick={() => basculerPlage(element.cle)}
                    className={cn("block w-full px-4 py-2.5 text-left hover:bg-[#23262D]", TRANS)}
                  >
                    <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                      <span className="flex items-center gap-1.5 text-[13px] font-medium text-[#F2F3F5] tabular-nums">
                        {ouverte ? <ChevronDown size={13} aria-hidden className="text-[#6B7280]" /> : <ChevronRight size={13} aria-hidden className="text-[#6B7280]" />}
                        {premiere.numero} → {derniere.numero}
                      </span>
                      <Pastille ton={TON_TYPE[premiere.type]}>{LIBELLES_TYPE[premiere.type]}</Pastille>
                      <span className="text-[12px] text-[#6B7280]">{LIBELLES_ORIGINE[premiere.origine]}</span>
                    </span>
                    <span className="mt-0.5 block text-[12.5px] text-[#9CA3AF]">{element.lignes.length} numéros, sans détail</span>
                    {premiere.note ? <span className="mt-0.5 block text-[11.5px] text-[#6B7280]">{premiere.note}</span> : null}
                  </button>
                  {ouverte ? (
                    <ul className="border-t-[0.5px] border-[#2A2D34] bg-[#191B20]">
                      {element.lignes.map((ligne) => (
                        <LigneNumero key={ligne.id} ligne={ligne} onCompleter={completer} />
                      ))}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      <Modale
        ouverte={declaration || enComplement !== null}
        onFermer={fermer}
        titre={enComplement ? `Compléter ${enComplement.numero}` : "Déclarer un numéro émis hors CRM"}
        description={enComplement ? "Le numéro ne change jamais ; seules ces informations se complètent." : "Numérotation manuelle, autre logiciel : le CRM ne l'attribuera jamais."}
        pied={
          <div className="flex justify-end gap-2">
            <Bouton variante="fantome" onClick={fermer}>
              Annuler
            </Bouton>
            <Bouton variante="primaire" chargement={envoi} disabled={!enComplement && !saisie.numero.trim()} onClick={() => void enregistrer()}>
              Enregistrer
            </Bouton>
          </div>
        }
      >
        <div className="flex flex-col gap-3">
          {enComplement ? null : <Champ libelle="Numéro tel qu'imprimé" obligatoire placeholder="ex. 2026-012 ou F2026-012" value={saisie.numero} onChange={changer("numero")} />}
          <ListeDeroulante libelle="Nature" value={saisie.type} onChange={changer("type")} options={OPTIONS_TYPE} />
          {enComplement?.emisLe ? null : (
            <Champ libelle="Date d'émission" aide={enComplement ? "Se renseigne une fois." : undefined} type="date" value={saisie.emisLe} onChange={changer("emisLe")} />
          )}
          <Champ libelle="Destinataire" maxLength={160} value={saisie.destinataire} onChange={changer("destinataire")} />
          <Champ libelle="Montant (€)" inputMode="decimal" value={saisie.montant} onChange={changer("montant")} />
          <ZoneTexte libelle="Note" rows={2} maxLength={500} value={saisie.note} onChange={changer("note")} />
        </div>
      </Modale>
    </div>
  );
}
