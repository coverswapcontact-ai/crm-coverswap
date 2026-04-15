"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2 } from "lucide-react";

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
      setError("Email ou mot de passe incorrect");
      setLoading(false);
    } else {
      router.push("/dashboard");
    }
  }

  return (
    <div className="min-h-screen bg-[#1a1a1a] flex items-center justify-center p-4">
      <Card className="w-full max-w-md bg-[#262626] border-white/10">
        <CardHeader className="text-center">
          <div className="mx-auto w-12 h-12 bg-red-600 rounded-xl flex items-center justify-center font-bold text-white text-xl mb-4">
            CS
          </div>
          <CardTitle className="text-white text-2xl">CoverSwap CRM</CardTitle>
          <p className="text-gray-400 text-sm mt-2">Connectez-vous pour accéder au CRM</p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label className="text-gray-400">Email</Label>
              <Input
                type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder="coverswap.contact@gmail.com"
                className="bg-[#1a1a1a] border-white/10 text-white" required
              />
            </div>
            <div>
              <Label className="text-gray-400">Mot de passe</Label>
              <Input
                type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                className="bg-[#1a1a1a] border-white/10 text-white" required
              />
            </div>
            {error && <p className="text-red-400 text-sm">{error}</p>}
            <Button type="submit" disabled={loading} className="w-full bg-red-600 hover:bg-red-700 text-white">
              {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Se connecter
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
