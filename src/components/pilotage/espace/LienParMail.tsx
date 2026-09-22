"use client";

import { useEffect, useState } from "react";
import { Send } from "lucide-react";
import { toast } from "sonner";
import { envoyerJson, messageErreur } from "@/components/pilotage/client";
import { Bouton, Champ, Modale, ZoneTexte } from "@/components/pilotage/ui";
import type { CodeLienMail, PropositionLienMail } from "@/lib/mail/lien-espace";

/**
 * « Le lien de son espace, par mail » (mission 7 : le mail prend le relais du
 * SMS). À l'ouverture, l'espace est ouvert s'il ne l'était pas et le mail est
 * proposé : l'adresse, l'objet, la phrase — « Bonjour {prénom}, » et le bouton
 * vers son espace s'ajoutent d'eux-mêmes. Rien ne part sans « Envoyer ».
 */

export type CibleLienMail = { leadId?: string | null; dossierId?: string | null; code: CodeLienMail };

const TITRES: Record<CodeLienMail, string> = {
  LIEN_ESPACE: "Le lien de son espace, par mail",
  INJOIGNABLE_LIEN: "« J'ai essayé de vous joindre », par mail",
  LIEN_ESPACE_RAPPEL: "Renvoyer le lien de son espace",
};

const jetonNeuf = () => Math.random().toString(36).slice(2, 12).padEnd(10, "0");

export function LienParMail({ cible, onFermer, onEnvoye }: { cible: CibleLienMail | null; onFermer: () => void; onEnvoye?: () => void }) {
  return cible ? <Fenetre key={`${cible.code}:${cible.dossierId ?? ""}:${cible.leadId ?? ""}`} cible={cible} onFermer={onFermer} onEnvoye={onEnvoye} /> : null;
}

function Fenetre({ cible, onFermer, onEnvoye }: { cible: CibleLienMail; onFermer: () => void; onEnvoye?: () => void }) {
  const [proposition, setProposition] = useState<PropositionLienMail | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [a, setA] = useState("");
  const [objet, setObjet] = useState("");
  const [phrase, setPhrase] = useState("");
  const [envoi, setEnvoi] = useState(false);
  const [jeton] = useState(jetonNeuf);

  useEffect(() => {
    let actif = true;
    envoyerJson<PropositionLienMail>("/api/mail/lien-espace", "POST", { action: "proposer", code: cible.code, leadId: cible.leadId ?? null, dossierId: cible.dossierId ?? null })
      .then((p) => {
        if (!actif) return;
        setProposition(p);
        setA(p.a ?? "");
        setObjet(p.objet);
        setPhrase(p.phrase);
      })
      .catch((e) => actif && setErreur(messageErreur(e)));
    return () => {
      actif = false;
    };
  }, [cible.code, cible.dossierId, cible.leadId]);

  async function envoyer() {
    if (!proposition) return;
    setEnvoi(true);
    try {
      await envoyerJson("/api/mail/lien-espace", "POST", { action: "envoyer", code: cible.code, dossierId: proposition.dossierId, a: a.trim(), objet: objet.trim(), phrase: phrase.trim(), jeton });
      toast.success("Le mail part", { description: "De votre boîte Gmail ; il apparaîtra dans le dossier et dans l'onglet Mail." });
      onEnvoye?.();
      onFermer();
    } catch (e) {
      toast.error("Mail non envoyé", { description: messageErreur(e) });
    } finally {
      setEnvoi(false);
    }
  }

  const pret = Boolean(proposition) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a.trim()) && objet.trim().length >= 2 && phrase.trim().length >= 10;
  return (
    <Modale
      ouverte
      onFermer={onFermer}
      titre={TITRES[cible.code]}
      description="Relisez : il part de votre boîte Gmail, avec le bouton vers son espace."
      largeur="sm"
      pied={
        <div className="flex flex-wrap justify-end gap-2">
          <Bouton variante="fantome" onClick={onFermer}>
            Plus tard
          </Bouton>
          <Bouton variante="primaire" icone={<Send size={14} aria-hidden />} disabled={!pret} chargement={envoi} onClick={() => void envoyer()}>
            Envoyer le mail
          </Bouton>
        </div>
      }
    >
      {erreur ? <p className="text-[13px] text-[#F87171]">{erreur}</p> : null}
      {!proposition && !erreur ? <p className="text-[13px] text-[#9CA3AF]">Ouverture de son espace…</p> : null}
      {proposition ? (
        <div className="space-y-3">
          <Champ libelle="À" type="email" inputMode="email" autoCapitalize="none" value={a} onChange={(e) => setA(e.target.value)} aide={proposition.a ? undefined : "Aucune adresse connue pour ce client : saisissez-la."} placeholder="adresse@exemple.fr" />
          <Champ libelle="Objet" value={objet} maxLength={150} onChange={(e) => setObjet(e.target.value)} />
          <ZoneTexte libelle="La phrase" rows={4} value={phrase} maxLength={600} onChange={(e) => setPhrase(e.target.value)} aide={`« Bonjour${proposition.prenom ? ` ${proposition.prenom}` : ""}, » avant, le bouton « ${proposition.bouton} » et votre signature après.`} />
        </div>
      ) : null}
    </Modale>
  );
}
