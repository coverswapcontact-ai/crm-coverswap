"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, BookOpen, Copy, Download, EyeOff, Info, Lock, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { appelApi, messageErreur } from "@/components/pilotage/client";
import { Bouton, Champ, EnTetePage, Pastille, TRANS, TitreSection } from "@/components/pilotage/ui";
import { formatDateCourte } from "@/lib/dossiers/dates";
import { formatMontant } from "@/lib/dossiers/montants";
import { dernierJourDuMois, libelleMois } from "@/lib/finances/periodes";
import type { Ecart, InstantaneResume } from "@/lib/synthese/instantanes";
import { GUIDE_LECTURE, libelleAuteur } from "@/lib/synthese/redaction";
import type { SyntheseLue } from "@/lib/synthese/requete";
import type { Alerte, Repartition } from "@/lib/synthese/types";
import { cn } from "@/lib/utils";

const CARTE = "rounded-[11px] border-[0.5px] border-[#2A2D34] bg-[#1C1F25]";
const pct = (valeur: number | null) => (valeur === null ? "—" : `${String(valeur).replace(".", ",")} %`);
const ecart = (valeur: number | null) => (valeur === null ? "—" : `${valeur > 0 ? "+" : valeur < 0 ? "−" : ""}${String(Math.abs(valeur)).replace(".", ",")} %`);

type Vue = SyntheseLue & { instantane?: { mois: string; figeLe: string; integre: boolean; ecarts: Ecart[] } };

function periodes(aujourdhui: string) {
  const annee = Number(aujourdhui.slice(0, 4));
  const mois = Number(aujourdhui.slice(5, 7));
  const precedent = mois === 1 ? { annee: annee - 1, mois: 12 } : { annee, mois: mois - 1 };
  const debutTrimestre = Math.floor((mois - 1) / 3) * 3 + 1;
  const deux = (nombre: number) => String(nombre).padStart(2, "0");
  return [
    { cle: "MOIS_PRECEDENT", libelle: `${libelleMois(precedent.mois)} ${precedent.annee}`, du: `${precedent.annee}-${deux(precedent.mois)}-01`, au: dernierJourDuMois(precedent.annee, precedent.mois) },
    { cle: "MOIS", libelle: "Ce mois-ci", du: `${annee}-${deux(mois)}-01`, au: aujourdhui },
    { cle: "TRIMESTRE", libelle: "Ce trimestre", du: `${annee}-${deux(debutTrimestre)}-01`, au: aujourdhui },
    { cle: "ANNEE", libelle: `Année ${annee}`, du: `${annee}-01-01`, au: aujourdhui },
  ];
}

function Chiffre({ libelle, valeur, detail }: { libelle: string; valeur: string; detail?: string }) {
  return (
    <div className={cn(CARTE, "p-3.5")}>
      <p className="text-[12px] text-[#9CA3AF]">{libelle}</p>
      <p className="mt-1 text-[19px] font-semibold text-[#F2F3F5] tabular-nums">{valeur}</p>
      {detail ? <p className="mt-0.5 text-[12px] text-[#6B7280]">{detail}</p> : null}
    </div>
  );
}

function Barres({ lignes, format = (valeur) => String(valeur) }: { lignes: Repartition[]; format?: (valeur: number) => string }) {
  if (lignes.length === 0) return <p className="text-[12.5px] text-[#6B7280]">Rien sur la période.</p>;
  const max = Math.max(...lignes.map((ligne) => Math.abs(ligne.valeur)), 1);
  return (
    <div className="space-y-2">
      {lignes.map((ligne) => (
        <div key={ligne.cle}>
          <div className="flex justify-between gap-3 text-[12.5px]">
            <span className="truncate text-[#D1D5DB]">{ligne.libelle}</span>
            <span className="shrink-0 text-[#9CA3AF] tabular-nums">{format(ligne.valeur)}</span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[#2A2D34]">
            <div className="h-full rounded-full bg-[#1D9E75]/70" style={{ width: `${(Math.abs(ligne.valeur) / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

const TONS_ALERTE: Record<Alerte["gravite"], string> = {
  URGENT: "border-[#EF4444]/40 bg-[#EF4444]/10 text-[#FCA5A5]",
  ATTENTION: "border-[#EF9F27]/40 bg-[#EF9F27]/10 text-[#F5B454]",
  INFO: "border-[#2A2D34] bg-[#1C1F25] text-[#9CA3AF]",
};

function Alertes({ alertes }: { alertes: Alerte[] }) {
  if (alertes.length === 0) return null;
  return (
    <ul className="mt-5 space-y-2">
      {alertes.map((alerte) => (
        <li key={alerte.code} className={cn("flex items-start gap-2.5 rounded-[9px] border-[0.5px] px-3.5 py-2.5 text-[13px]", TONS_ALERTE[alerte.gravite])}>
          {alerte.gravite === "INFO" ? <Info size={15} aria-hidden className="mt-0.5 shrink-0" /> : <TriangleAlert size={15} aria-hidden className="mt-0.5 shrink-0" />}
          <span className="min-w-0 flex-1">
            <span className="font-medium">{alerte.titre}</span>
            <span className="block text-[12.5px] opacity-90">{alerte.detail}</span>
          </span>
          {alerte.lien ? (
            <Link href={alerte.lien} className="shrink-0 text-[12px] underline-offset-2 hover:underline">
              Voir
            </Link>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export default function TableauSynthese({
  initiale,
  instantanes,
  aujourdhui,
}: {
  initiale: SyntheseLue;
  instantanes: InstantaneResume[];
  aujourdhui: string;
}) {
  const [vue, setVue] = useState<Vue>(initiale);
  const [anonyme, setAnonyme] = useState(false);
  const [onglet, setOnglet] = useState<"TABLEAU" | "TEXTE">("TABLEAU");
  const [du, setDu] = useState(initiale.synthese.periode.du);
  const [au, setAu] = useState(initiale.synthese.periode.au);
  const [chargement, setChargement] = useState(false);
  const { synthese, references, redaction, alertes, instantane } = vue;
  const { commercial: c, finances: f, clients: k, agent, qualite } = synthese;
  const nomClient = (id: string | null) => (id ? (references.clients[id] ?? "Client inconnu") : "Sans client");

  async function charger(debut: string, fin: string, pseudonymes: boolean) {
    setChargement(true);
    try {
      setVue(await appelApi<SyntheseLue>(`/api/synthese?du=${debut}&au=${fin}${pseudonymes ? "&anonyme=1" : ""}`));
      setDu(debut);
      setAu(fin);
    } catch (erreur) {
      toast.error("Synthèse indisponible", { description: messageErreur(erreur) });
    } finally {
      setChargement(false);
    }
  }

  async function ouvrirInstantane(mois: string, pseudonymes: boolean) {
    setChargement(true);
    try {
      const lu = await appelApi<{ synthese: SyntheseLue["synthese"]; references: SyntheseLue["references"]; redaction: string; figeLe: string; integre: boolean; ecarts: Ecart[] }>(
        `/api/synthese/instantanes/${mois}${pseudonymes ? "?anonyme=1" : ""}`
      );
      setVue({ synthese: lu.synthese, references: lu.references, redaction: lu.redaction, alertes: [], instantane: { mois, figeLe: lu.figeLe, integre: lu.integre, ecarts: lu.ecarts } });
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (erreur) {
      toast.error("Instantané indisponible", { description: messageErreur(erreur) });
    } finally {
      setChargement(false);
    }
  }

  function basculerAnonyme() {
    const suivant = !anonyme;
    setAnonyme(suivant);
    if (instantane) void ouvrirInstantane(instantane.mois, suivant);
    else void charger(du, au, suivant);
  }

  const lienExport = (format: "texte" | "json") => `/api/synthese/export?du=${du}&au=${au}&format=${format}${anonyme ? "&anonyme=1" : ""}`;

  return (
    <div className={cn("mx-auto w-full max-w-6xl px-5 py-6 md:px-8 md:py-8", chargement && "opacity-60")}>
      <EnTetePage
        titre="Synthèse"
        sousTitre={instantane ? `Instantané figé de ${synthese.periode.libelle}` : `Période ${synthese.periode.libelle}`}
        actions={
          <Bouton variante={anonyme ? "primaire" : "secondaire"} icone={<EyeOff size={14} aria-hidden />} onClick={basculerAnonyme} aria-pressed={anonyme}>
            {anonyme ? "Anonymisée" : "Anonymiser"}
          </Bouton>
        }
      />

      <div className="mt-5 flex flex-wrap items-end gap-2">
        {periodes(aujourdhui).map((periode) => (
          <button
            key={periode.cle}
            type="button"
            onClick={() => void charger(periode.du, periode.au, anonyme)}
            className={cn(
              "h-9 rounded-full border-[0.5px] px-3 text-[13px] first-letter:uppercase sm:h-8 sm:text-[12.5px]",
              !instantane && du === periode.du && au === periode.au ? "border-[#1D9E75]/60 bg-[#112B22] text-[#5DCAA5]" : "border-[#2A2D34] bg-[#16181D] text-[#D1D5DB] hover:border-[#3A3E47]",
              TRANS
            )}
          >
            {periode.libelle}
          </button>
        ))}
        <div className="flex items-end gap-2">
          <Champ libelle="Du" type="date" value={du} max={au} onChange={(evenement) => setDu(evenement.target.value)} classeConteneur="w-[150px]" />
          <Champ libelle="Au" type="date" value={au} min={du} max={aujourdhui} onChange={(evenement) => setAu(evenement.target.value)} classeConteneur="w-[150px]" />
          <Bouton variante="secondaire" onClick={() => void charger(du, au, anonyme)}>
            Afficher
          </Bouton>
        </div>
      </div>

      {instantane ? (
        <div className={cn(CARTE, "mt-5 flex flex-wrap items-start gap-3 p-3.5")}>
          <Lock size={16} aria-hidden className="mt-0.5 text-[#93C5FD]" />
          <div className="min-w-0 flex-1 text-[13px] text-[#D1D5DB]">
            <p>
              Figé le {formatDateCourte(instantane.figeLe)} : ces chiffres ne se recalculent pas.{" "}
              {instantane.integre ? null : <span className="text-[#F87171]">Empreinte non conforme : contenu altéré hors de l&apos;application.</span>}
            </p>
            {instantane.ecarts.length === 0 ? (
              <p className="mt-1 text-[12.5px] text-[#6B7280]">Aucun écart avec un recalcul d&apos;aujourd&apos;hui.</p>
            ) : (
              <ul className="mt-1.5 space-y-0.5 text-[12.5px] text-[#F5B454]">
                {instantane.ecarts.map((ecart) => (
                  <li key={ecart.indicateur}>
                    {ecart.indicateur} : figé {ecart.fige ?? "—"}, aujourd&apos;hui {ecart.recalcule ?? "—"} (saisie tardive ou correction)
                  </li>
                ))}
              </ul>
            )}
          </div>
          <Bouton taille="sm" variante="fantome" onClick={() => void charger(du, au, anonyme)}>
            Revenir à la période
          </Bouton>
        </div>
      ) : (
        <Alertes alertes={alertes} />
      )}

      <div className="mt-6 flex items-center gap-2 border-b-[0.5px] border-[#2A2D34]">
        {(["TABLEAU", "TEXTE"] as const).map((valeur) => (
          <button
            key={valeur}
            type="button"
            onClick={() => setOnglet(valeur)}
            className={cn("-mb-px border-b-2 px-3 py-2 text-[13px]", onglet === valeur ? "border-[#1D9E75] text-[#F2F3F5]" : "border-transparent text-[#9CA3AF] hover:text-[#F2F3F5]", TRANS)}
          >
            {valeur === "TABLEAU" ? "Tableau" : "Version rédigée"}
          </button>
        ))}
        {!instantane ? (
          <div className="ml-auto flex gap-1">
            <a href={lienExport("texte")} className={cn("flex items-center gap-1 rounded-[8px] px-2 py-1.5 text-[12px] text-[#9CA3AF] hover:bg-[#22262D] hover:text-[#F2F3F5]", TRANS)}>
              <Download size={13} aria-hidden /> Texte
            </a>
            <a href={lienExport("json")} className={cn("flex items-center gap-1 rounded-[8px] px-2 py-1.5 text-[12px] text-[#9CA3AF] hover:bg-[#22262D] hover:text-[#F2F3F5]", TRANS)}>
              <Download size={13} aria-hidden /> Données
            </a>
          </div>
        ) : null}
      </div>

      {onglet === "TEXTE" ? (
        <div className={cn(CARTE, "mt-4 p-4")}>
          <div className="mb-2 flex justify-end">
            <Bouton
              taille="sm"
              variante="fantome"
              icone={<Copy size={13} aria-hidden />}
              onClick={() =>
                void navigator.clipboard.writeText(redaction).then(
                  () => toast.success("Synthèse copiée"),
                  () => toast.error("Copie impossible")
                )
              }
            >
              Copier
            </Bouton>
          </div>
          <pre className="text-[13px] leading-relaxed whitespace-pre-wrap text-[#D1D5DB]">{redaction}</pre>
        </div>
      ) : (
        <>
          <section className="mt-6">
            <TitreSection>Commercial</TitreSection>
            <div className="grid grid-cols-2 gap-2.5 md:grid-cols-5">
              <Chiffre libelle="Dossiers ouverts" valeur={String(c.cohorte.ouverts)} />
              <Chiffre libelle="Ont reçu un devis" valeur={String(c.cohorte.devisEnvoyes)} />
              <Chiffre libelle="Signés" valeur={String(c.cohorte.signes)} detail={`Taux de signature ${pct(c.cohorte.tauxSignatureDevis)}`} />
              <Chiffre libelle="Perdus" valeur={String(c.cohorte.perdus)} />
              <Chiffre libelle="En cours" valeur={String(c.cohorte.enCours)} />
            </div>
            <div className="mt-2.5 grid gap-2.5 md:grid-cols-3">
              <div className={cn(CARTE, "p-4 text-[13px]")}>
                <p className="mb-2 text-[12px] text-[#9CA3AF]">Activité de la période</p>
                <dl className="space-y-1.5">
                  {[
                    ["Devis émis", `${c.activite.devisEmis} · ${formatMontant(c.activite.montantDevis)}`],
                    ["Signatures", `${c.activite.signatures} · ${formatMontant(c.activite.montantSigne)}`],
                    ["Factures émises", `${c.activite.facturesEmises} · ${formatMontant(c.activite.montantFacture)}`],
                    ["Avoirs", `${c.activite.avoirs} · ${formatMontant(c.activite.montantAvoirs)}`],
                    ["Pertes", String(c.activite.pertes)],
                    ["Écart premier devis → signé", ecart(c.ecartPrixMoyenPct)],
                  ].map(([libelle, valeur]) => (
                    <div key={libelle} className="flex justify-between gap-3">
                      <dt className="text-[#9CA3AF]">{libelle}</dt>
                      <dd className="text-[#F2F3F5] tabular-nums">{valeur}</dd>
                    </div>
                  ))}
                </dl>
              </div>
              <div className={cn(CARTE, "p-4 text-[13px]")}>
                <p className="mb-2 text-[12px] text-[#9CA3AF]">Délais médians</p>
                <dl className="space-y-1.5">
                  {c.delais.map((delai) => (
                    <div key={delai.cle} className="flex justify-between gap-3">
                      <dt className="text-[#9CA3AF]">{delai.libelle}</dt>
                      <dd className="text-[#F2F3F5] tabular-nums">
                        {delai.medianeJours === null ? "—" : `${String(delai.medianeJours).replace(".", ",")} j`} <span className="text-[#6B7280]">({delai.nombre})</span>
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
              <div className={cn(CARTE, "p-4")}>
                <p className="mb-2 text-[12px] text-[#9CA3AF]">Pertes par motif</p>
                <Barres lignes={c.pertes.parMotif} />
                {c.pertes.concurrents.length ? (
                  <ul className="mt-3 space-y-1 text-[12.5px] text-[#9CA3AF]">
                    {c.pertes.concurrents.map((concurrent) => (
                      <li key={concurrent.nom}>
                        {concurrent.nom} · {concurrent.nombre}
                        {concurrent.ecartMoyenPct !== null ? ` · prix ${ecart(concurrent.ecartMoyenPct)}` : ""}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </div>
          </section>

          <section className="mt-8">
            <TitreSection>Finances</TitreSection>
            {f.encaisse === null ? (
              <p className={cn(CARTE, "flex items-center gap-2 p-3.5 text-[13px] text-[#F5B454]")}>
                <AlertTriangle size={15} aria-hidden /> Encaissements non calculés : règle de date des chèques à renseigner (écran Finances).
              </p>
            ) : null}
            <div className="grid grid-cols-2 gap-2.5 md:grid-cols-5">
              <Chiffre libelle="Encaissé" valeur={f.encaisse === null ? "—" : formatMontant(f.encaisse)} />
              <Chiffre libelle="Dépenses" valeur={formatMontant(f.depenses)} />
              <Chiffre libelle="Marge brute" valeur={f.margeBrute === null ? "—" : formatMontant(f.margeBrute)} />
              <Chiffre libelle="Panier moyen signé" valeur={f.panierMoyenSigne === null ? "—" : formatMontant(f.panierMoyenSigne)} />
              <Chiffre libelle="Reste à encaisser" valeur={formatMontant(f.encours.total)} detail={`dont ${formatMontant(f.encours.plus30Jours)} à plus de 30 j`} />
            </div>
            <div className="mt-2.5 grid gap-2.5 md:grid-cols-3">
              <div className={cn(CARTE, "p-4")}>
                <p className="mb-2 text-[12px] text-[#9CA3AF]">Encaissé par origine des clients</p>
                <Barres lignes={f.parFamilleSource} format={formatMontant} />
              </div>
              <div className={cn(CARTE, "p-4")}>
                <p className="mb-2 text-[12px] text-[#9CA3AF]">Par type de client</p>
                <Barres lignes={f.parCategorieClient} format={formatMontant} />
                <p className="mt-4 mb-2 text-[12px] text-[#9CA3AF]">Par département</p>
                <Barres lignes={f.parDepartement} format={formatMontant} />
              </div>
              <div className={cn(CARTE, "p-4")}>
                <p className="mb-2 text-[12px] text-[#9CA3AF]">Dépenses par catégorie</p>
                <Barres lignes={f.depensesParCategorie} format={formatMontant} />
              </div>
            </div>
            {f.margesDossiers.length ? (
              <div className={cn(CARTE, "mt-2.5 overflow-x-auto")}>
                <table className="w-full min-w-[520px] text-[12.5px]">
                  <thead>
                    <tr className="text-left text-[#9CA3AF]">
                      <th className="px-4 py-2 font-medium">Dossier facturé dans la période</th>
                      <th className="px-3 py-2 text-right font-medium">Facturé</th>
                      <th className="px-3 py-2 text-right font-medium">Dépenses</th>
                      <th className="px-4 py-2 text-right font-medium">Marge</th>
                    </tr>
                  </thead>
                  <tbody>
                    {f.margesDossiers.map((marge) => (
                      <tr key={marge.dossierId} className="border-t-[0.5px] border-[#2A2D34] text-[#D1D5DB]">
                        <td className="px-4 py-2">{references.dossiers[marge.dossierId] ?? nomClient(marge.clientId)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatMontant(marge.facture)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatMontant(marge.depenses)}</td>
                        <td className={cn("px-4 py-2 text-right tabular-nums", marge.marge < 0 ? "text-[#F87171]" : "text-[#5DCAA5]")}>
                          {formatMontant(marge.marge)} · {pct(marge.margePct)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </section>

          <section className="mt-8">
            <TitreSection>Clients</TitreSection>
            <div className="grid gap-2.5 md:grid-cols-3">
              <div className={cn(CARTE, "p-4")}>
                <p className="mb-2 text-[12px] text-[#9CA3AF]">{k.nouveaux} nouveaux clients, par origine</p>
                <Barres lignes={k.parFamilleSource} />
                {k.campagnes.length ? (
                  <>
                    <p className="mt-4 mb-2 text-[12px] text-[#9CA3AF]">Campagnes</p>
                    <Barres lignes={k.campagnes} />
                  </>
                ) : null}
              </div>
              <div className={cn(CARTE, "p-4 text-[13px]")}>
                <p className="mb-2 text-[12px] text-[#9CA3AF]">Relations contre publicité payante</p>
                <dl className="space-y-1.5">
                  <div className="flex justify-between gap-3">
                    <dt className="text-[#9CA3AF]">Nouveaux clients</dt>
                    <dd className="text-[#F2F3F5] tabular-nums">
                      {k.relationnelContrePayant.nouveauxRelationnel} / {k.relationnelContrePayant.nouveauxPayant}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-[#9CA3AF]">Encaissé</dt>
                    <dd className="text-[#F2F3F5] tabular-nums">
                      {k.relationnelContrePayant.caRelationnel === null ? "—" : formatMontant(k.relationnelContrePayant.caRelationnel)} /{" "}
                      {k.relationnelContrePayant.caPayant === null ? "—" : formatMontant(k.relationnelContrePayant.caPayant)}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-[#9CA3AF]">Recommandations</dt>
                    <dd className="text-[#F2F3F5] tabular-nums">{k.recommandations}</dd>
                  </div>
                </dl>
                {k.recommandeurs.length ? (
                  <p className="mt-2 text-[12.5px] text-[#9CA3AF]">
                    Par : {k.recommandeurs.map((ligne) => `${nomClient(ligne.clientId)} (${ligne.nombre})`).join(", ")}
                  </p>
                ) : null}
              </div>
              <div className={cn(CARTE, "p-4 text-[13px]")}>
                <p className="mb-2 text-[12px] text-[#9CA3AF]">Fidélité</p>
                <p className="text-[#D1D5DB]">
                  {k.recurrents.clients} client{k.recurrents.clients > 1 ? "s" : ""} revenu{k.recurrents.clients > 1 ? "s" : ""} parmi ceux qui ont payé
                  {k.recurrents.partCa !== null ? ` · ${pct(k.recurrents.partCa)} de l'encaissé` : ""}
                </p>
                <p className="mt-3 text-[#D1D5DB]">{k.inactifs.nombre} ancien{k.inactifs.nombre > 1 ? "s" : ""} client{k.inactifs.nombre > 1 ? "s" : ""} sans nouvelle depuis plus d&apos;un an</p>
                {k.inactifs.clientIds.length ? <p className="mt-1 text-[12.5px] text-[#6B7280]">{k.inactifs.clientIds.map(nomClient).join(", ")}</p> : null}
              </div>
            </div>
          </section>

          <section className="mt-8">
            <TitreSection>Agent et propositions</TitreSection>
            {agent.parAuteur.length === 0 ? (
              <p className="text-[13px] text-[#6B7280]">Aucune proposition dans la période.</p>
            ) : (
              <div className={cn(CARTE, "overflow-x-auto")}>
                <table className="w-full min-w-[640px] text-[12.5px]">
                  <thead>
                    <tr className="text-left text-[#9CA3AF]">
                      {["Auteur", "Proposées", "Validées", "Corrigées", "Rejetées", "Expirées", "En attente", "Acceptation", "Décision (médiane)"].map((titre) => (
                        <th key={titre} className="px-3 py-2 font-medium first:px-4">
                          {titre}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {agent.parAuteur.map((ligne) => (
                      <tr key={ligne.auteur} className="border-t-[0.5px] border-[#2A2D34] text-[#D1D5DB] tabular-nums">
                        <td className="px-4 py-2">{libelleAuteur(ligne.auteur)}</td>
                        <td className="px-3 py-2">{ligne.proposees}</td>
                        <td className="px-3 py-2">{ligne.validees}</td>
                        <td className="px-3 py-2">{ligne.modifiees}</td>
                        <td className="px-3 py-2">{ligne.rejetees}</td>
                        <td className="px-3 py-2">{ligne.expirees}</td>
                        <td className="px-3 py-2">{ligne.enAttente}</td>
                        <td className="px-3 py-2">{pct(ligne.tauxAcceptation)}</td>
                        <td className="px-3 py-2">{ligne.delaiDecisionMedianHeures === null ? "—" : `${String(ligne.delaiDecisionMedianHeures).replace(".", ",")} h`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {agent.motifsRejet.length ? (
              <p className="mt-2 text-[12.5px] text-[#9CA3AF]">Motifs de rejet : {agent.motifsRejet.map((motif) => `${motif.libelle} (${motif.valeur})`).join(", ")}</p>
            ) : null}
          </section>

          <section className="mt-8">
            <TitreSection>Qualité des données</TitreSection>
            {qualite.length === 0 ? (
              <p className="text-[13px] text-[#6B7280]">Rien à signaler.</p>
            ) : (
              <ul className={cn(CARTE, "divide-y-[0.5px] divide-[#2A2D34]")}>
                {qualite.map((point) => (
                  <li key={point.cle} className="flex justify-between gap-3 px-4 py-2 text-[13px]">
                    <span className="text-[#D1D5DB]">{point.libelle}</span>
                    <Pastille ton="ambre">{point.valeur}</Pastille>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      <details className={cn(CARTE, "mt-8 p-4")}>
        <summary className="flex cursor-pointer items-center gap-2 text-[13px] text-[#D1D5DB]">
          <BookOpen size={15} aria-hidden /> Guide de lecture
        </summary>
        <dl className="mt-3 space-y-3">
          {GUIDE_LECTURE.map((entree) => (
            <div key={entree.titre}>
              <dt className="text-[13px] font-medium text-[#F2F3F5]">{entree.titre}</dt>
              <dd className="mt-0.5 text-[12.5px] text-[#9CA3AF]">{entree.texte}</dd>
            </div>
          ))}
        </dl>
      </details>

      <section className="mt-8">
        <TitreSection>Mois figés</TitreSection>
        {instantanes.length === 0 ? (
          <p className="text-[13px] text-[#6B7280]">Aucun mois figé pour l&apos;instant : chaque mois écoulé l&apos;est automatiquement.</p>
        ) : (
          <ul className={cn(CARTE, "divide-y-[0.5px] divide-[#2A2D34]")}>
            {instantanes.map((ligne) => {
              const [annee, numero] = ligne.mois.split("-").map(Number);
              return (
                <li key={ligne.mois} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-[13px]">
                  <span className="min-w-[120px] font-medium text-[#F2F3F5] first-letter:uppercase">
                    {libelleMois(numero)} {annee}
                  </span>
                  <span className="text-[#9CA3AF]">encaissé {ligne.encaisse === null ? "—" : formatMontant(ligne.encaisse)}</span>
                  <span className="text-[#9CA3AF]">
                    {ligne.dossiersOuverts} dossiers · {ligne.signatures} signatures
                  </span>
                  <span className="text-[12px] text-[#6B7280]">figé le {formatDateCourte(ligne.figeLe)}</span>
                  <Bouton taille="sm" variante="fantome" className="ml-auto" onClick={() => void ouvrirInstantane(ligne.mois, anonyme)}>
                    Voir
                  </Bouton>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
