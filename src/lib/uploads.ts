import path from "path";

/**
 * Résout le répertoire d'upload de façon robuste.
 * Priorité : UPLOADS_DIR env > /data/uploads (volume Railway en prod)
 *           > ./.uploads (dev local).
 */
export function resolveUploadsDir(): string {
  if (process.env.UPLOADS_DIR) return process.env.UPLOADS_DIR;
  if (process.env.NODE_ENV === "production") return "/data/uploads";
  return path.join(process.cwd(), ".uploads");
}
