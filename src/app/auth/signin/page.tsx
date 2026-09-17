"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { LogIn } from "lucide-react";
import { Bouton, Champ } from "@/components/pilotage/ui";
import { destinationApresConnexion } from "@/lib/acces/destination";

export default function SignInPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });

    if (result?.error) {
      setError("E-mail ou mot de passe incorrect.");
      setLoading(false);
    } else {
      // Retour à la page demandée avant la connexion (lien partagé, rappel Google…).
      const destination = destinationApresConnexion(window.location.search, window.location.origin);
      if (destination.startsWith("/api/")) window.location.assign(destination);
      else router.push(destination);
    }
  }

  return (
    <div className="flex min-h-screen w-full flex-1 items-center justify-center bg-[#16181D] p-4 text-[#F2F3F5] antialiased">
      <div className="w-full max-w-[380px] rounded-[14px] border-[0.5px] border-[#2A2D34] bg-[#1C1F25] p-6 sm:p-7">
        <p className="flex items-baseline gap-2 text-[17px] font-semibold tracking-tight">
          CoverSwap
          <span className="text-[13px] font-normal text-[#6B7280]">pilotage</span>
        </p>
        <p className="mt-1 text-[13px] text-[#9CA3AF]">Prospects, dossiers, finances : connecte-toi pour continuer.</p>
        <form onSubmit={handleSubmit} className="mt-6 space-y-3.5">
          <Champ
            libelle="E-mail"
            type="email"
            inputMode="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <Champ
            libelle="Mot de passe"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          {error ? (
            <p role="alert" className="text-[13px] text-[#F87171]">
              {error}
            </p>
          ) : null}
          <Bouton type="submit" variante="primaire" chargement={loading} icone={<LogIn size={15} aria-hidden />} className="h-10 w-full">
            Se connecter
          </Bouton>
        </form>
      </div>
    </div>
  );
}
