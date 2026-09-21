"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BookText, ChevronRight, Coins, Search, Sparkles, WandSparkles, X } from "lucide-react";
import { toast } from "sonner";
import { appelApi, envoyerJson, messageErreur } from "@/components/pilotage/client";
import { Bouton, CLASSE_SAISIE, EnTetePage, Pastille, TRANS } from "@/components/pilotage/ui";
import { LIBELLES_STYLE, TYPES_SURFACE, ZONES, typeSurface, type IdZone, type StyleClient } from "@/lib/simulateur/types-surface";
import { cn } from "@/lib/utils";
import { ResultatChatGPT, SuiviApi, type Preparation } from "./ResultatPreparation";
import { SelecteurTeinte, type ReferenceCatalogue } from "./SelecteurTeinte";

/**
 * Le simulateur du CRM. Étapes communes : le client (ou le dossier d'où l'on
 * vient), la photo avant parmi celles qu'il a déposées, le type de surface,
 * une teinte par zone (ses goûts d'abord). Puis deux portes :
 *  - « Générer via l'API » : le moteur du site, coût annoncé avant ;
 *  - « Préparer pour ChatGPT » : prompt, planche des teintes, photo — gratuit,
 *    avec l'abonnement ChatGPT.
 */

type DossierTrouve = { id: string; clientNom: string; ville: string; etape: string; photos: number; espace: boolean };
type Contexte = {
  dossier: { id: string; clientNom: string; ville: string; telephone: string; etape: string; typeProjet: string };
  photos: { id: string; url: string }[];
  projet: { zones: string[]; styles: StyleClient[]; propositions: boolean; resume: string } | null;
  typeSuggere: string;
  refsSite: string[];
  preparations: Preparation[];
};
type Consommation = {
  mois: { total: number; site: number; crm: number; generations: number; echecs: number };
  solde: { releve: number; releveLe: string; consommeDepuis: number; estime: number; simulationsRestantes: number } | null;
  reelOpenAI: { mois: number } | null;
  creditEpuise: { le: string } | null;
  coutParEchantillons: number[];
  cle: boolean;
};

const dollars = (n: number) => `${n.toFixed(2).replace(".", ",")} $`;

export default function EcranSimulateur({ dossierInitial }: { dossierInitial: string | null }) {
  const [dossierId, setDossierId] = useState<string | null>(dossierInitial);
  const [contexte, setContexte] = useState<Contexte | null>(null);
  const [photoId, setPhotoId] = useState<string | null>(null);
  const [type, setType] = useState<string>("cuisine");
  const [teintes, setTeintes] = useState<Partial<Record<IdZone, ReferenceCatalogue>>>({});
  const [zoneOuverte, setZoneOuverte] = useState<IdZone | null>(null);
  const [catalogue, setCatalogue] = useState<ReferenceCatalogue[] | null>(null);
  const [preparation, setPreparation] = useState<Preparation | null>(null);
  const [occupe, setOccupe] = useState<"CHATGPT" | "API" | null>(null);
  const [consommation, setConsommation] = useState<Consommation | null>(null);

  const chargerConsommation = useCallback(() => {
    void appelApi<Consommation>("/api/simulateur/consommation").then(setConsommation).catch(() => undefined);
  }, []);

  useEffect(() => {
    const premier = window.setTimeout(chargerConsommation, 0);
    return () => window.clearTimeout(premier);
  }, [chargerConsommation]);

  // Le dossier choisi : photos, goûts du client, type probable.
  useEffect(() => {
    if (!dossierId) return;
    let actif = true;
    appelApi<Contexte>(`/api/simulateur/dossiers/${dossierId}`)
      .then((c) => {
        if (!actif) return;
        setContexte(c);
        setPhotoId(c.photos[0]?.id ?? null);
        setType(c.typeSuggere);
        setTeintes({});
        setPreparation(null);
        const url = new URL(window.location.href);
        url.searchParams.set("dossier", c.dossier.id);
        window.history.replaceState(null, "", url);
      })
      .catch((erreur) => {
        toast.error(messageErreur(erreur));
        setDossierId(null);
      });
    return () => {
      actif = false;
    };
  }, [dossierId]);

  const styles = useMemo(() => (contexte?.projet?.styles ?? []).filter((s): s is StyleClient => s in LIBELLES_STYLE), [contexte]);

  // Le catalogue est chargé au premier choix de teinte, avec les goûts du client.
  useEffect(() => {
    if (!zoneOuverte || catalogue) return;
    appelApi<{ references: ReferenceCatalogue[] }>(`/api/simulateur/catalogue${styles.length ? `?styles=${styles.join(",")}` : ""}`)
      .then(({ references }) => setCatalogue(references))
      .catch((erreur) => {
        toast.error(messageErreur(erreur));
        setZoneOuverte(null);
      });
  }, [zoneOuverte, catalogue, styles]);

  const typeChoisi = typeSurface(type)!;
  const zonesChoisies = typeChoisi.zones.filter((z) => teintes[z]);
  const echantillons = new Set(zonesChoisies.map((z) => teintes[z]!.ref)).size;
  const cout = consommation?.coutParEchantillons[Math.max(0, echantillons - 1)] ?? null;
  const pret = Boolean(dossierId && photoId && zonesChoisies.length > 0);

  async function preparer(mode: "CHATGPT" | "API") {
    if (!dossierId || !photoId) return;
    setOccupe(mode);
    try {
      const { preparation: p } = await envoyerJson<{ preparation: Preparation }>("/api/simulateur/preparations", "POST", {
        dossierId,
        photoId,
        typeSurface: type,
        mode,
        zones: zonesChoisies.map((z) => ({ zone: z, ref: teintes[z]!.ref })),
      });
      setPreparation(p);
      window.setTimeout(() => document.getElementById("resultat")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    } catch (erreur) {
      toast.error(messageErreur(erreur));
    } finally {
      setOccupe(null);
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 md:px-8 md:py-8">
      <EnTetePage
        titre="Simulateur"
        sousTitre="Une photo du client, une teinte par zone : par l'API, ou préparé pour ChatGPT."
        actions={
          <Link href="/simulateur/prompts" className={cn("inline-flex h-10 items-center gap-1.5 rounded-[8px] border-[0.5px] border-[#2A2D34] bg-[#1C1F25] px-3 text-[13px] font-medium text-[#F2F3F5] hover:border-[#3A3E47] sm:h-8", TRANS)}>
            <BookText size={14} aria-hidden /> Prompts
          </Link>
        }
      />

      <CompteurCredit consommation={consommation} />

      <div className="mt-6 space-y-6">
        {/* 1. Le client */}
        <Etape numero={1} titre="Le client">
          {contexte && dossierId ? (
            <div className="rounded-[12px] border-[0.5px] border-[#2A2D34] bg-[#1C1F25] p-3">
              <div className="flex items-baseline justify-between gap-3">
                <p className="truncate text-[14px] font-medium text-[#F2F3F5]">
                  {contexte.dossier.clientNom}
                  <span className="font-normal text-[#9CA3AF]">
                    {" "}
                    · {contexte.dossier.ville || "ville inconnue"} · {contexte.photos.length} photo{contexte.photos.length > 1 ? "s" : ""}
                  </span>
                </p>
              </div>
              {contexte.projet?.resume ? <p className="mt-1 line-clamp-2 text-[12px] leading-snug text-[#9CA3AF]">Son projet : {contexte.projet.resume}</p> : null}
              <div className="mt-2 flex gap-1.5">
                <Link href={`/dossiers?dossier=${contexte.dossier.id}`} className="inline-flex h-8 items-center rounded-[8px] px-2 text-[12px] text-[#5DCAA5] hover:underline">
                  Dossier
                </Link>
                <Bouton taille="sm" variante="fantome" onClick={() => { setDossierId(null); setContexte(null); }}>
                  Changer
                </Bouton>
              </div>
            </div>
          ) : (
            <RechercheDossier onChoisir={(id) => setDossierId(id)} />
          )}
        </Etape>

        {contexte ? (
          <>
            {/* 2. La photo avant */}
            <Etape numero={2} titre="La photo avant">
              {contexte.photos.length === 0 ? (
                <p className="rounded-[12px] border-[0.5px] border-dashed border-[#2A2D34] p-4 text-[13px] text-[#9CA3AF]">Aucune photo du client dans ce dossier. Envoyez-lui le lien de son espace pour qu&apos;il en dépose, ou ajoutez-en depuis le dossier.</p>
              ) : (
                <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {contexte.photos.map((p) => (
                    <li key={p.id}>
                      <button type="button" onClick={() => setPhotoId(p.id)} aria-pressed={photoId === p.id} className={cn("relative block aspect-[4/3] w-full overflow-hidden rounded-[10px] border-2", photoId === p.id ? "border-[#5DCAA5]" : "border-transparent")}>
                        {/* eslint-disable-next-line @next/next/no-img-element -- photo privée servie derrière la session */}
                        <img src={p.url} alt="" className="h-full w-full object-cover" loading="lazy" />
                        {photoId === p.id ? <span className="absolute top-1.5 right-1.5 rounded-full bg-[#1D9E75] px-1.5 text-[11px] font-semibold text-[#0B1612]">Avant</span> : null}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Etape>

            {/* 3. Le type de surface */}
            <Etape numero={3} titre="Le type de surface">
              <div className="flex flex-wrap gap-1.5">
                {TYPES_SURFACE.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    aria-pressed={type === t.id}
                    onClick={() => {
                      setType(t.id);
                      setPreparation(null);
                    }}
                    className={cn("min-h-9 rounded-full border-[0.5px] px-3 text-[13px] sm:min-h-8", type === t.id ? "border-[#1D9E75]/60 bg-[#112B22] text-[#5DCAA5]" : "border-[#2A2D34] bg-[#16181D] text-[#D1D5DB] hover:border-[#3A3E47]", TRANS)}
                  >
                    {t.libelle}
                    {contexte.typeSuggere === t.id ? <span className="ml-1 text-[11px] opacity-70">· suggéré</span> : null}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-[12px] text-[#8B919C]">{typeChoisi.aide}</p>
            </Etape>

            {/* 4. Les teintes, zone par zone */}
            <Etape numero={4} titre="Les teintes, zone par zone">
              {styles.length > 0 || contexte.projet?.propositions ? (
                <p className="mb-2 text-[12.5px] text-[#9CA3AF]">
                  Ses goûts : <span className="text-[#D1D5DB]">{[...styles.map((s) => LIBELLES_STYLE[s]), contexte.projet?.propositions ? "veut des propositions" : null].filter(Boolean).join(", ")}</span> — proposés en premier.
                </p>
              ) : null}
              <ul className="space-y-2">
                {typeChoisi.zones.map((zone) => {
                  const teinte = teintes[zone];
                  const demandee = !contexte.projet || contexte.projet.zones.length === 0 || contexte.projet.zones.includes(zone);
                  return (
                    <li key={zone} className="flex items-center gap-3 rounded-[12px] border-[0.5px] border-[#2A2D34] bg-[#1C1F25] p-2.5">
                      {teinte ? (
                        // eslint-disable-next-line @next/next/no-img-element -- échantillon servi par le CRM
                        <img src={teinte.image} alt="" className="h-12 w-12 shrink-0 rounded-[8px] object-cover" />
                      ) : (
                        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[8px] border-[0.5px] border-dashed border-[#3A3E47] text-[11px] text-[#6B7280]">—</span>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-[13.5px] font-medium text-[#F2F3F5]">
                          {ZONES[zone].libelle}
                          {!demandee ? <span className="ml-1.5 text-[11px] font-normal text-[#8B919C]">(pas demandé par le client)</span> : null}
                        </p>
                        <p className="truncate text-[12px] text-[#9CA3AF]">{teinte ? `${teinte.ref} · ${teinte.nom} · ${teinte.resume}` : "Inchangé"}</p>
                      </div>
                      {teinte ? (
                        <button type="button" aria-label={`Retirer la teinte de ${ZONES[zone].libelle}`} onClick={() => setTeintes((t) => ({ ...t, [zone]: undefined }))} className="flex h-9 w-9 items-center justify-center rounded-full text-[#9CA3AF] hover:bg-[#22262D]">
                          <X size={15} aria-hidden />
                        </button>
                      ) : null}
                      <Bouton taille="sm" onClick={() => setZoneOuverte(zone)}>
                        {teinte ? "Changer" : "Choisir"}
                      </Bouton>
                    </li>
                  );
                })}
              </ul>
            </Etape>

            {/* Les deux portes */}
            <div className="grid gap-2 sm:grid-cols-2">
              <Bouton variante="primaire" className="h-12 text-[14.5px] sm:h-10 sm:text-[13.5px]" icone={<Sparkles size={15} aria-hidden />} disabled={!pret} chargement={occupe === "CHATGPT"} onClick={() => void preparer("CHATGPT")}>
                Préparer pour ChatGPT
              </Bouton>
              <Bouton className="h-12 text-[14.5px] sm:h-10 sm:text-[13.5px]" icone={<WandSparkles size={15} aria-hidden />} disabled={!pret || consommation?.cle === false} chargement={occupe === "API"} onClick={() => void preparer("API")}>
                Générer via l&apos;API{cout !== null && pret ? ` · ≈ ${dollars(cout)}` : ""}
              </Bouton>
            </div>
            {!pret ? <p className="text-[12.5px] text-[#8B919C]">Choisissez une photo et au moins une teinte.</p> : null}
            {consommation?.cle === false ? <p className="text-[12.5px] text-[#F5B454]">Mode API indisponible : la clé OpenAI n&apos;est pas posée sur ce serveur.</p> : null}

            {preparation ? (
              <section id="resultat" className="scroll-mt-20">
                {preparation.mode === "CHATGPT" ? (
                  <ResultatChatGPT preparation={preparation} onDepose={chargerConsommation} />
                ) : (
                  <SuiviApi
                    preparation={preparation}
                    onFini={(p) => {
                      setPreparation(p);
                      chargerConsommation();
                    }}
                  />
                )}
              </section>
            ) : null}
          </>
        ) : null}
      </div>

      {zoneOuverte && catalogue ? (
        <SelecteurTeinte
          references={catalogue}
          zone={ZONES[zoneOuverte].libelle}
          styles={styles}
          refsSite={contexte?.refsSite ?? []}
          onFermer={() => setZoneOuverte(null)}
          onChoisir={(r) => {
            setTeintes((t) => ({ ...t, [zoneOuverte]: r }));
            setPreparation(null);
            setZoneOuverte(null);
          }}
        />
      ) : null}
    </div>
  );
}

function Etape({ numero, titre, children }: { numero: number; titre: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 flex items-center gap-2 text-[12px] font-medium tracking-wide text-[#9CA3AF] uppercase">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#22262D] text-[11px] text-[#D1D5DB]">{numero}</span>
        {titre}
      </h2>
      {children}
    </section>
  );
}

function RechercheDossier({ onChoisir }: { onChoisir: (id: string) => void }) {
  const [q, setQ] = useState("");
  const [dossiers, setDossiers] = useState<DossierTrouve[] | null>(null);
  useEffect(() => {
    const minuterie = window.setTimeout(() => {
      appelApi<{ dossiers: DossierTrouve[] }>(`/api/simulateur/dossiers?q=${encodeURIComponent(q)}`)
        .then(({ dossiers: d }) => setDossiers(d))
        .catch(() => setDossiers([]));
    }, q ? 250 : 0);
    return () => window.clearTimeout(minuterie);
  }, [q]);
  return (
    <div>
      <div className="relative">
        <Search size={15} className="absolute top-1/2 left-3 -translate-y-1/2 text-[#6B7280]" aria-hidden />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nom, ville ou téléphone du client" className={cn(CLASSE_SAISIE, "h-11 pl-9 sm:h-9")} aria-label="Rechercher un dossier" />
      </div>
      <ul className="mt-2 divide-y-[0.5px] divide-[#2A2D34] overflow-hidden rounded-[12px] border-[0.5px] border-[#2A2D34] bg-[#1C1F25]">
        {(dossiers ?? []).map((d) => (
          <li key={d.id}>
            <button type="button" onClick={() => onChoisir(d.id)} className="flex min-h-12 w-full items-center gap-3 px-3 py-2 text-left hover:bg-[#22262D]">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] text-[#F2F3F5]">{d.clientNom}</span>
                <span className="block text-[12px] text-[#8B919C]">
                  {d.ville || "—"} · {d.photos} photo{d.photos > 1 ? "s" : ""}
                  {d.espace ? " · espace ouvert" : ""}
                </span>
              </span>
              <ChevronRight size={15} className="text-[#6B7280]" aria-hidden />
            </button>
          </li>
        ))}
        {dossiers && dossiers.length === 0 ? <li className="px-3 py-4 text-[13px] text-[#9CA3AF]">Aucun dossier trouvé.</li> : null}
        {dossiers === null ? <li className="px-3 py-4 text-[13px] text-[#6B7280]">Chargement…</li> : null}
      </ul>
    </div>
  );
}

/** Le compteur de crédit, toujours visible : ce qui a été dépensé ce mois, ce qu'il reste (estimé). */
function CompteurCredit({ consommation }: { consommation: Consommation | null }) {
  if (!consommation) return null;
  const { mois, solde, creditEpuise, reelOpenAI } = consommation;
  const bas = solde && solde.estime < 2;
  return (
    <div className={cn("mt-4 space-y-1 rounded-[12px] border-[0.5px] px-3.5 py-2.5 text-[12.5px] leading-relaxed", creditEpuise || bas ? "border-[#EF4444]/40 bg-[#EF4444]/[0.07]" : "border-[#2A2D34] bg-[#1C1F25]")}>
      <p className="text-[#D1D5DB]">
        <Coins size={14} className="mr-1.5 inline -translate-y-px text-[#9CA3AF]" aria-hidden />
        Crédit OpenAI ce mois : <strong className="font-medium text-[#F2F3F5] tabular-nums">{dollars(mois.total)}</strong>{" "}
        <span className="text-[#8B919C]">
          ({mois.generations} image{mois.generations > 1 ? "s" : ""} · site {dollars(mois.site)} · CRM {dollars(mois.crm)})
        </span>
      </p>
      {reelOpenAI ? <p className="text-[#8B919C]">Facturé par OpenAI ce mois : {dollars(reelOpenAI.mois)}</p> : null}
      {creditEpuise ? (
        <p>
          <Pastille ton="rouge">Crédit épuisé (constaté le {new Date(creditEpuise.le).toLocaleDateString("fr-FR")})</Pastille>
        </p>
      ) : solde ? (
        <p className={bas ? "text-[#F87171]" : "text-[#D1D5DB]"}>
          Solde estimé : <strong className="font-medium tabular-nums">{dollars(solde.estime)}</strong> <span className="text-[#8B919C]">(≈ {solde.simulationsRestantes} simulations)</span>
        </p>
      ) : (
        <p>
          <Link href="/parametres" className="text-[#F5B454] hover:underline">
            Solde inconnu : notez votre solde OpenAI dans Paramètres
          </Link>
        </p>
      )}
    </div>
  );
}
