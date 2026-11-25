// Member levels (Visit, Gold, Platinum, Wisdom) from money spent in the last 12 months. The thresholds
// and benefits come from site setting "member-tiers". Pure: used by bootstrap and the member app.

export type MemberTierDef = { name: string; min: number; benefits: string[] };
export type MemberTier = { name: string; min: number; benefits: string[]; spend: number; next: { name: string; min: number; remaining: number } | null; progress: number; tiers: MemberTierDef[] };

export const defaultMemberTiers: MemberTierDef[] = [
  { name: "Visit", min: 0, benefits: [] },
  { name: "Gold", min: 20000, benefits: [] },
  { name: "Platinum", min: 60000, benefits: [] },
  { name: "Wisdom", min: 150000, benefits: [] },
];

function record(value: unknown): Record<string, unknown> {
  let parsed = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return {};
    }
  }
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
}

export function memberTierSettings(metadata: unknown): MemberTierDef[] {
  const source = record(metadata);
  const tiers = Array.isArray(source.tiers)
    ? source.tiers.map(record)
      .filter((tier) => typeof tier.name === "string" && tier.name.trim() && typeof tier.min === "number" && Number.isFinite(tier.min) && tier.min >= 0)
      .map((tier) => ({
        name: String(tier.name).trim().slice(0, 40),
        min: Math.round(Number(tier.min)),
        benefits: Array.isArray(tier.benefits) ? tier.benefits.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim().slice(0, 120)).slice(0, 8) : [],
      }))
      .sort((a, b) => a.min - b.min)
    : [];
  return tiers.length ? tiers : defaultMemberTiers;
}

export function memberTiersProblem(metadata: Record<string, unknown>) {
  if (!Array.isArray(metadata.tiers) || !metadata.tiers.length) return "member-tiers: ต้องมี tiers อย่างน้อย 1 ระดับ เช่น [{\"name\":\"Visit\",\"min\":0,\"benefits\":[]}]";
  const parsed = memberTierSettings(metadata);
  if (parsed.length !== metadata.tiers.length) return "member-tiers: ทุกระดับต้องมี name และ min เป็นตัวเลขไม่ติดลบ";
  if (new Set(parsed.map((tier) => tier.min)).size !== parsed.length) return "member-tiers: min ของแต่ละระดับต้องไม่ซ้ำกัน";
  return null;
}

export function memberTierFor(spend: number, tiers: MemberTierDef[] = defaultMemberTiers): MemberTier {
  const sorted = [...tiers].sort((a, b) => a.min - b.min);
  const amount = Math.max(0, Number(spend) || 0);
  let index = 0;
  sorted.forEach((tier, position) => { if (amount >= tier.min) index = position; });
  const tier = sorted[index] || defaultMemberTiers[0];
  const following = sorted[index + 1];
  const span = following ? following.min - tier.min : 0;
  const progress = following ? Math.min(100, Math.max(0, Math.round(((amount - tier.min) / Math.max(1, span)) * 100))) : 100;
  return {
    name: tier.name,
    min: tier.min,
    benefits: tier.benefits,
    spend: Math.round(amount),
    next: following ? { name: following.name, min: following.min, remaining: Math.max(0, Math.round(following.min - amount)) } : null,
    progress,
    tiers: sorted,
  };
}
