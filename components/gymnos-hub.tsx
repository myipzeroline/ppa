"use client";
import { Top } from "@/components/member-ui";
import { t } from "@/lib/i18n";

export type GymnosTarget = "fitness" | "swim" | "hyrox" | "pilates" | "airfit" | "svcclass" | "promotion";

const tiles: { target: GymnosTarget; title: string; sub: string; icon: string; tone: string }[] = [
  { target: "fitness", title: "FITNESS", sub: "แพ็กเกจ & คูปอง", icon: "🏋️", tone: "#3a2416" },
  { target: "swim", title: "SWIM", sub: "แพ็กเกจ & คูปอง", icon: "🏊", tone: "#0e3348" },
  { target: "hyrox", title: "HYROX", sub: "Simulation & Class", icon: "🔥", tone: "#42160f" },
  { target: "pilates", title: "PILATES", sub: "Private & Group", icon: "🤸", tone: "#33203f" },
  { target: "airfit", title: "AIRFIT", sub: "Private & Class", icon: "🪂", tone: "#123a3f" },
  { target: "svcclass", title: "SERVICE CLASS", sub: "ฟรี! เฉพาะสมาชิก", icon: "🧘", tone: "#1d3a28" },
];

// แก้ 5: GYMNOS opens 7 blocks — six services plus the largest Promotion (Hot Deals) block.
export function GymnosHub({ onBack, onOpen }: { onBack: () => void; onOpen: (target: GymnosTarget) => void }) {
  return (
    <div className="page gymnos-page">
      <Top title="GYMNOS" onBack={onBack} />
      <p className="gymnos-lead">{t("เลือกบริการที่ต้องการ")}</p>
      <div className="gx-grid">
        {tiles.map((tile) => (
          <button type="button" className="gx" key={tile.target} onClick={() => onOpen(tile.target)}>
            <span className="gi" style={{ background: tile.tone }} aria-hidden="true">{tile.icon}</span>
            <b>{tile.title}</b>
            <small>{t(tile.sub)}</small>
          </button>
        ))}
      </div>
      <button type="button" className="promo-hero" onClick={() => onOpen("promotion")}>
        <span className="promo-hero-glow" aria-hidden="true" />
        <span className="promo-hero-badge">🔥 HOT DEALS</span>
        <span className="promo-hero-ic" aria-hidden="true">🎁</span>
        <b>PROMOTION</b>
        <small>{t("ดีลประจำสัปดาห์ & Member ราคาพิเศษ")}</small>
        <span className="promo-hero-arrow" aria-hidden="true">›</span>
      </button>
    </div>
  );
}
