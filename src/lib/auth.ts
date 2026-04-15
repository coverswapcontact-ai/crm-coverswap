import { type NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "CoverSwap",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Mot de passe", type: "password" },
      },
      async authorize(credentials) {
        // MVP: single admin user
        if (
          credentials?.email === "coverswap.contact@gmail.com" &&
          credentials?.password === (process.env.ADMIN_PASSWORD || "coverswap2026")
        ) {
          return { id: "1", name: "Lucas Villemin", email: "coverswap.contact@gmail.com" };
        }
        return null;
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
