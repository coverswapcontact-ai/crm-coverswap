import type { Metadata } from "next";
import { santeMeta } from "@/lib/meta/sante";
import EcranPublicite from "./_components/EcranPublicite";

export const metadata: Metadata = {
  title: "Publicité — CoverSwap",
  description: "Leads Meta Ads reçus en direct : réception, notification, conversions renvoyées.",
};

export const dynamic = "force-dynamic";

export default async function PublicitePage() {
  return <EcranPublicite initiale={await santeMeta()} />;
}
