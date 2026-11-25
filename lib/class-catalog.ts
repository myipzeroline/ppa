import { query } from "@/lib/db";
import { sharedCache } from "@/lib/shared-cache";

export type ProgramRow = { id: number; slug: string; title: string; subtitle: string | null; body: string | null; icon: string; price: number; metadata: string | null; sortOrder: number };

// The class catalog is the same for every member: read once a minute per server (back-office saves
// clear it at once, see clearSharedCache).
export function classCatalog() {
  return sharedCache("catalog:class-programs", 60_000, () => query<ProgramRow>(
    "SELECT id, slug, title, subtitle, body, icon, price, CAST(metadata AS CHAR) metadata, sort_order sortOrder FROM app_content_items WHERE content_type = 'class_program' AND active = TRUE ORDER BY sort_order, id LIMIT 200",
  ));
}
