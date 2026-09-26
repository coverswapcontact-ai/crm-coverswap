"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight, Mail, RotateCcw, Save, Undo2, WandSparkles } from "lucide-react";
import { toast } from "sonner";
import { appelApi, envoyerJson, messageErreur } from "@/components/pilotage/client";
import { Bouton, Champ, CLASSE_SAISIE, Pastille, TitreSection, TRANS, ZoneTexte } from "@/components/pilotage/ui";
import type { ReglagesMailVue } from "@/lib/mail/reglages-vue";
import type { PropositionVue } from "@/lib/validation/types";
import type { GuideStyle } from "@/lib/mail/redaction";
import { cn } from "@/lib/utils";

/**
 * Paramètres → Mail (mission 7) : le guide de style que suit « Rédiger avec
 * l'IA », les quatre mails automatiques de l'espace client, et vos décisions
 * sur les expéditeurs (« ne plus me montrer », « remonté ») — chacune se
 * retire ici. Les interrupteurs (rédaction IA, rangement dans Gmail, adresse
 * des séquences) sont dans la liste des paramètres, plus haut.
 */

const CARTE = "rounded-[11px] border-[0.5px] border-[#2A2D34] bg-[#1C1F25]";

type Reglages = ReglagesMailVue;
type Modele = Reglages["modeles"][number];
type Regle = Reglages["regles"][number];

const ACTIONS_REGLE: Record<string, { libelle: string; ton: "neutre" | "vert" | "bleu" }> = {
  RANGER: { libelle: "Toujours rangé", ton: "neutre" },
  NE_JAMAIS_RANGER: { libelle: "Jamais rangé", ton: "vert" },
  ADMINISTRATIF: { libelle: "Administratif", ton: "bleu" },
};

const SOURCES_GUIDE: Record<GuideStyle["source"], string> = { DEFAUT: "Guide par défaut", MAILS: "Tiré de vos mails envoyés", LUCAS: "Écrit par vous" };

export default function ReglagesMail({ initial }: { initial: Reglages }) {
  // Mission 13 (lot 3) : les réglages arrivent du serveur avec la page.
  const [reglages, setReglages] = useState<Reglages>(initial);

  return (
    <section className="mt-10" id="mail">
      <TitreSection
        action={
          <Link href="/mail/sequences" className={cn("inline-flex h-11 sm:h-8 items-center gap-1 text-[12.5px] text-[#5DCAA5] hover:underline", TRANS)}>
            Séquences <ArrowRight size={13} aria-hidden />
          </Link>
        }
      >
        Mail
      </TitreSection>
      <div className="space-y-3">
        <CarteGuide guide={reglages.guide} onMaj={setReglages} />
        <p className="pt-3 text-[12.5px] leading-relaxed text-[#9CA3AF]">
          Mails automatiques de l&apos;espace client : ils partent seuls, une fois par événement, si l&apos;adresse du client est connue. Une phrase, un bouton vers son espace. Variables : <code className="text-[#D1D5DB]">{"{prenom}"}</code>,{" "}
          <code className="text-[#D1D5DB]">{"{montant}"}</code> (paiement).
        </p>
        {reglages.modeles.map((modele) => (
          <CarteModele key={modele.evenement} modele={modele} onMaj={setReglages} />
        ))}
        <CarteRegles regles={reglages.regles} proposees={reglages.proposees ?? []} onMaj={setReglages} />
      </div>
    </section>
  );
}

function CarteGuide({ guide, onMaj }: { guide: GuideStyle; onMaj: (r: Reglages) => void }) {
  const [texte, setTexte] = useState(guide.texte);
  const [occupe, setOccupe] = useState<"enregistrer" | "tirer" | null>(null);
  const modifie = texte.trim() !== guide.texte.trim();

  async function enregistrer() {
    setOccupe("enregistrer");
    try {
      const r = await envoyerJson<Reglages>("/api/mail/reglages", "PATCH", { guide: texte.trim() });
      onMaj(r);
      setTexte(r.guide.texte);
      toast.success("Guide de style enregistré : les prochains brouillons le suivent");
    } catch (erreur) {
      toast.error("Non enregistré", { description: messageErreur(erreur) });
    } finally {
      setOccupe(null);
    }
  }

  async function tirer() {
    setOccupe("tirer");
    try {
      const { guide: nouveau } = await envoyerJson<{ guide: GuideStyle }>("/api/mail/reglages/guide", "POST");
      setTexte(nouveau.texte);
      onMaj(await appelApi<Reglages>("/api/mail/reglages"));
      toast.success(`Guide tiré de ${nouveau.analyse?.mails ?? "vos"} mails envoyés`);
    } catch (erreur) {
      toast.error("Guide non tiré", { description: messageErreur(erreur) });
    } finally {
      setOccupe(null);
    }
  }

  return (
    <div className={cn(CARTE, "p-4")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-[14px] font-medium text-[#F2F3F5]">
          <WandSparkles size={15} aria-hidden /> Guide de style des brouillons
        </p>
        <Pastille ton={guide.source === "DEFAUT" ? "neutre" : "vert"}>{SOURCES_GUIDE[guide.source]}</Pastille>
      </div>
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-[#9CA3AF]">
        « Rédiger avec l&apos;IA » écrit comme ceci. Tirez-le de vos mails envoyés (un appel à l&apos;IA, environ 0,03 €, anonymisé), puis corrigez-le à la main si besoin.
        {guide.analyse ? ` Dernière analyse : ${guide.analyse.mails} mails${guide.analyse.longueurMoyenne ? `, ${guide.analyse.longueurMoyenne} mots en moyenne` : ""}.` : ""}
      </p>
      <textarea
        value={texte}
        onChange={(e) => setTexte(e.target.value)}
        rows={9}
        maxLength={4000}
        aria-label="Guide de style des brouillons"
        className={cn(CLASSE_SAISIE, "mt-3 min-h-[180px] resize-y py-2 leading-relaxed")}
      />
      <div className="mt-2 flex flex-wrap justify-end gap-2">
        <Bouton taille="sm" variante="fantome" icone={<Mail size={12} aria-hidden />} chargement={occupe === "tirer"} disabled={occupe === "enregistrer"} onClick={() => void tirer()}>
          Tirer de mes mails envoyés
        </Bouton>
        {modifie ? (
          <Bouton taille="sm" variante="fantome" icone={<RotateCcw size={12} aria-hidden />} onClick={() => setTexte(guide.texte)}>
            Annuler
          </Bouton>
        ) : null}
        <Bouton taille="sm" variante="primaire" icone={<Save size={12} aria-hidden />} disabled={!modifie || texte.trim().length < 20} chargement={occupe === "enregistrer"} onClick={() => void enregistrer()}>
          Enregistrer
        </Bouton>
      </div>
    </div>
  );
}

function CarteModele({ modele, onMaj }: { modele: Modele; onMaj: (r: Reglages) => void }) {
  const [objet, setObjet] = useState(modele.objet);
  const [phrase, setPhrase] = useState(modele.phrase);
  const [bouton, setBouton] = useState(modele.bouton);
  const [occupe, setOccupe] = useState<"textes" | "actif" | null>(null);
  const modifie = objet.trim() !== modele.objet || phrase.trim() !== modele.phrase || bouton.trim() !== modele.bouton;

  async function enregistrer(actif: boolean, quoi: "textes" | "actif") {
    setOccupe(quoi);
    try {
      const donnees = quoi === "actif" ? { objet: modele.objet, phrase: modele.phrase, bouton: modele.bouton } : { objet: objet.trim(), phrase: phrase.trim(), bouton: bouton.trim() };
      onMaj(await envoyerJson<Reglages>("/api/mail/reglages", "PATCH", { modele: { evenement: modele.evenement, ...donnees, actif } }));
      toast.success(quoi === "textes" ? "Mail enregistré" : actif ? "Mail automatique réactivé" : "Mail automatique coupé : il ne part plus");
    } catch (erreur) {
      toast.error("Non enregistré", { description: messageErreur(erreur) });
    } finally {
      setOccupe(null);
    }
  }

  return (
    <div className={cn(CARTE, "p-4", !modele.actif && "opacity-75")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-[13.5px] font-medium text-[#F2F3F5]">
          {modele.libelle}
          {modele.actif ? <Pastille ton="vert">Part tout seul</Pastille> : <Pastille ton="ambre">Coupé</Pastille>}
        </p>
        <Bouton taille="sm" variante="fantome" chargement={occupe === "actif"} onClick={() => void enregistrer(!modele.actif, "actif")}>
          {modele.actif ? "Couper" : "Réactiver"}
        </Bouton>
      </div>
      <div className="mt-3 space-y-2.5">
        <Champ libelle="Objet" value={objet} maxLength={150} onChange={(e) => setObjet(e.target.value)} />
        <ZoneTexte libelle="La phrase" rows={3} value={phrase} maxLength={600} onChange={(e) => setPhrase(e.target.value)} aide="« Bonjour {prénom}, » et la signature s'ajoutent d'eux-mêmes." />
        <Champ libelle="Le bouton" value={bouton} maxLength={40} onChange={(e) => setBouton(e.target.value)} />
      </div>
      {modifie ? (
        <div className="mt-2 flex flex-wrap justify-end gap-2">
          <Bouton
            taille="sm"
            variante="fantome"
            icone={<RotateCcw size={12} aria-hidden />}
            onClick={() => {
              setObjet(modele.objet);
              setPhrase(modele.phrase);
              setBouton(modele.bouton);
            }}
          >
            Annuler
          </Bouton>
          <Bouton taille="sm" variante="primaire" icone={<Save size={12} aria-hidden />} disabled={objet.trim().length < 3 || phrase.trim().length < 10 || bouton.trim().length < 2} chargement={occupe === "textes"} onClick={() => void enregistrer(modele.actif, "textes")}>
            Enregistrer
          </Bouton>
        </div>
      ) : null}
    </div>
  );
}

function CarteRegles({ regles, proposees, onMaj }: { regles: Regle[]; proposees: PropositionVue[]; onMaj: (r: Reglages) => void }) {
  const [occupe, setOccupe] = useState<string | null>(null);
  const [tout, setTout] = useState(false);
  const [cible, setCible] = useState("");
  const [action, setAction] = useState<"RANGER" | "NE_JAMAIS_RANGER" | "ADMINISTRATIF">("RANGER");
  const visibles = tout ? regles : regles.slice(0, 8);

  async function decider(p: PropositionVue, decision: "valider" | "ignorer") {
    setOccupe(p.id);
    try {
      await envoyerJson(`/api/mail/propositions/${p.id}`, "POST", decision === "valider" ? { action: "valider" } : { action: "ignorer", motif: "PAS_DE_REGLE" });
      onMaj(await appelApi<Reglages>("/api/mail/reglages"));
      toast.success(decision === "valider" ? "Règle posée" : "Proposition écartée");
    } catch (erreur) {
      toast.error("Non appliqué", { description: messageErreur(erreur) });
    } finally {
      setOccupe(null);
    }
  }

  async function ajouter() {
    setOccupe("ajouter");
    try {
      onMaj(await envoyerJson<Reglages>("/api/mail/reglages", "PATCH", { regle: { cible: cible.trim(), action } }));
      setCible("");
      toast.success("Règle posée");
    } catch (erreur) {
      toast.error("Règle non posée", { description: messageErreur(erreur) });
    } finally {
      setOccupe(null);
    }
  }

  async function retirer(regle: Regle) {
    setOccupe(regle.id);
    try {
      onMaj(await envoyerJson<Reglages>("/api/mail/reglages", "PATCH", { archiverRegle: regle.id }));
      toast.success(`Décision retirée : ${regle.cible} repasse par le tri`);
    } catch (erreur) {
      toast.error("Non retirée", { description: messageErreur(erreur) });
    } finally {
      setOccupe(null);
    }
  }

  return (
    <div className={cn(CARTE, "mt-3 p-4")}>
      <p className="text-[14px] font-medium text-[#F2F3F5]">Vos décisions sur les expéditeurs</p>
      <p className="mt-1 text-[12.5px] leading-relaxed text-[#9CA3AF]">« Ne plus me montrer cet expéditeur » le range pour toujours ; un mail remonté à la main ne sera plus jamais rangé. Retirer une décision rend l&apos;expéditeur au tri ordinaire. Trois gestes identiques sur une même adresse : le CRM propose la règle ci-dessous, il ne la pose jamais seul.</p>
      {proposees.length ? (
        <ul className="mt-3 space-y-2">
          {proposees.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-[9px] border-[0.5px] border-[#F472B6]/35 bg-[#F472B6]/[0.06] px-3 py-2">
              <span className="min-w-0">
                <span className="block text-[13px] text-[#F2F3F5]">{p.titre}</span>
                {p.resume ? <span className="block text-[11.5px] text-[#8B919C]">{p.resume}</span> : null}
              </span>
              <span className="flex gap-1">
                <Bouton taille="sm" variante="primaire" chargement={occupe === p.id} onClick={() => void decider(p, "valider")}>
                  Valider
                </Bouton>
                <Bouton taille="sm" variante="fantome" disabled={occupe === p.id} onClick={() => void decider(p, "ignorer")}>
                  Ignorer
                </Bouton>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input value={cible} onChange={(e) => setCible(e.target.value)} placeholder="adresse@exemple.fr ou @exemple.fr" className={cn(CLASSE_SAISIE, "min-w-[200px] flex-1")} aria-label="Adresse ou domaine" />
        <select value={action} onChange={(e) => setAction(e.target.value as typeof action)} className={cn(CLASSE_SAISIE, "w-auto")} aria-label="Décision">
          <option value="RANGER">Toujours ranger</option>
          <option value="ADMINISTRATIF">Toujours en administratif</option>
          <option value="NE_JAMAIS_RANGER">Ne jamais ranger</option>
        </select>
        <Bouton taille="sm" variante="secondaire" chargement={occupe === "ajouter"} disabled={!cible.includes("@")} onClick={() => void ajouter()}>
          Ajouter la règle
        </Bouton>
      </div>
      {regles.length === 0 ? (
        <p className="mt-3 text-[12.5px] text-[#6B7280]">Aucune décision pour l&apos;instant.</p>
      ) : (
        <ul className="mt-3 divide-y-[0.5px] divide-[#2A2D34]">
          {visibles.map((regle) => {
            const action = ACTIONS_REGLE[regle.action] ?? { libelle: regle.action, ton: "neutre" as const };
            return (
              <li key={regle.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="min-w-0">
                  <span className="block truncate text-[13px] text-[#E5E7EB]">{regle.cible}</span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11.5px] text-[#8B919C]">
                    <Pastille ton={action.ton}>{action.libelle}</Pastille>
                    {new Date(regle.createdAt).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" })}
                  </span>
                </span>
                <Bouton taille="sm" variante="fantome" icone={<Undo2 size={12} aria-hidden />} chargement={occupe === regle.id} onClick={() => void retirer(regle)}>
                  Retirer
                </Bouton>
              </li>
            );
          })}
        </ul>
      )}
      {regles.length > 8 ? (
        <button type="button" onClick={() => setTout((v) => !v)} className="mt-2 text-[12.5px] text-[#5DCAA5] hover:underline">
          {tout ? "Replier" : `Voir les ${regles.length}`}
        </button>
      ) : null}
    </div>
  );
}
