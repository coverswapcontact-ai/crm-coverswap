import { type NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";

/**
 * Liste des utilisateurs autorisés.
 * Les mots de passe sont lus depuis les env vars (fallback sur un default
 * que tu dois changer sur Railway via Variables). L'email sert d'identifiant.
 */
const USERS: { id: string; name: string; email: string; passwordEnv: string; fallback: string }[] = [
  {
    id: "1",
    name: "Lucas Villemin",
    email: "coverswap.contact@gmail.com",
    passwordEnv: "ADMIN_PASSWORD",
    fallback: "coverswap2026",
  },
  {
    id: "2",
    name: "Elisabeth Villemin",
    email: "elisabeth.villemin@yahoo.com",
    passwordEnv: "ELISABETH_PASSWORD",
    fallback: "elisabeth2026",
  },
];

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "CoverSwap",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Mot de passe", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const normalizedEmail = credentials.email.trim().toLowerCase();
        const user = USERS.find((u) => u.email.toLowerCase() === normalizedEmail);
        if (!user) return null;

        const expected = process.env[user.passwordEnv] || user.fallback;
        if (credentials.password !== expected) return null;

        return { id: user.id, name: user.name, email: user.email };
      },
    }),
  ],
  pages: {
    signIn: "/auth/signin",
  },
  session: {
    strategy: "jwt",
  },
  secret: process.env.NEXTAUTH_SECRET,
};
