/** RFC 9728, variante par chemin : l'application Claude sonde d'abord /.well-known/oauth-protected-resource/api/mcp. */
export { GET, OPTIONS } from "@/app/api/oauth/ressource/route";
export const dynamic = "force-dynamic";
