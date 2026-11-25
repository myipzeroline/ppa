"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { AdminDialog } from "@/components/admin-dialog";
import { useAdminFeedback } from "@/components/admin-feedback";
import { AdminNotice } from "@/components/admin-notice";
import { safeImageSource } from "@/lib/media";

// Back office · Groups (ก๊วน): standing groups members create in the app (PPA app analysis V2, item 2),
// with a photo, a description and members added by member ID. Staff remove a photo or description that
// is not suitable, take a member out or close a group. The group Coins (busiest group of the day, three
// days in a row) are received at the counter: staff scan the member's claim QR in Scan QR.

type Lang = "th" | "en";
type Group = {
  id: number; name: string; levelName: string; description: string | null; photoUrl: string | null; status: "active" | "archived"; createdAt: string;
  sportSlug: string; sportName: string; sportIcon: string; ownerUserId: number; ownerName: string; ownerCode: string; members: number; awards: number; unclaimed: number;
};
type Member = { userId: number; displayName: string; memberCode: string; status: string; joinedAt: string };
type Award = { kind: string; awardDate: string; coinsOwner: number; coinsMember: number; members: number; createdAt: string };
type Claim = { id: number; displayName: string; memberCode: string; coins: number; kind: string | null; awardDate: string | null; status: string; expired: number; endsAt: string | null; updatedAt: string };
type Detail = { group: Group; members: Member[]; awards: Award[]; claims: Claim[] };
type Totals = { active: number; withPhoto: number; unclaimedCoins: number };
type Sport = { slug: string; name: string; icon?: string };

const copy = {
  th: {
    title: "ก๊วน (กลุ่มของสมาชิก)",
    intro: "ก๊วนที่สมาชิกสร้างในแอป พร้อมรูป คำอธิบาย และสมาชิกที่เพิ่มด้วย ID ตรวจรูปและข้อความที่ไม่เหมาะสม นำสมาชิกออก หรือปิดก๊วนได้ Coin ของก๊วน (มีสมาชิกมากสุดของวัน · เล่นต่อเนื่อง 3 วัน) สมาชิกรับที่เคาน์เตอร์ด้วย QR ในหน้า สแกน QR",
    active: "ก๊วนที่เปิดอยู่", withPhoto: "มีรูปก๊วน", unclaimed: "Coin รอรับที่เคาน์เตอร์",
    search: "ค้นหาชื่อก๊วน เจ้าของ หรือ ID สมาชิก", allSports: "ทุกกีฬา", status: { active: "เปิดอยู่", archived: "ปิดแล้ว", all: "ทั้งหมด" },
    owner: "ผู้จัดก๊วน", members: "สมาชิก", level: "ระดับ", created: "สร้างเมื่อ", noPhoto: "ไม่มีรูป", none: "ยังไม่มีก๊วน", open: "ดูรายละเอียด",
    close: "ปิด", archive: "ปิดก๊วน", restore: "เปิดก๊วนอีกครั้ง", removePhoto: "นำรูปออก", clearDescription: "ลบคำอธิบาย", removeMember: "นำออก",
    reason: "เหตุผล (สมาชิกจะเห็น)", description: "คำอธิบาย", noDescription: "ไม่มีคำอธิบาย", awards: "รางวัล Coin ของก๊วน", noAwards: "ยังไม่มีรางวัล",
    claims: "การรับ Coin ของสมาชิก", noClaims: "ยังไม่มีการรับ Coin", waiting: "รอรับ", received: "รับแล้ว", expired: "หมดอายุ",
    topOfDay: "มีสมาชิกมากสุดของวัน", streak: "เล่นต่อเนื่อง 3 วัน", coinsRule: "ผู้จัด {owner} · สมาชิก {member} Coin",
    archiveTitle: "ปิดก๊วนนี้?", archiveMessage: "ก๊วนจะหายจากแอป สมาชิกเข้าร่วมไม่ได้อีก (เปิดอีกครั้งได้)",
    photoTitle: "นำรูปก๊วนนี้ออก?", photoMessage: "รูปจะถูกลบ ผู้จัดก๊วนได้รับแจ้งและใส่รูปใหม่ได้",
    descriptionTitle: "ลบคำอธิบายก๊วนนี้?", descriptionMessage: "ข้อความจะถูกลบ ผู้จัดก๊วนได้รับแจ้ง",
    memberTitle: "นำสมาชิกออกจากก๊วน?", memberMessage: "สมาชิกได้รับแจ้งและขอเข้าร่วมใหม่ได้",
    done: "บันทึกแล้ว", failed: "บันทึกไม่สำเร็จ", loadFailed: "โหลดรายการก๊วนไม่สำเร็จ", retry: "ลองใหม่", loading: "กำลังโหลด…",
  },
  en: {
    title: "Groups (made by members)",
    intro: "Groups members create in the app, with a photo, a description and members added by member ID. Remove an unsuitable photo or text, take a member out or close a group. Group Coins (busiest group of the day · three days in a row) are received at the counter: scan the member's QR in Scan QR.",
    active: "Open groups", withPhoto: "With a photo", unclaimed: "Coins waiting at the counter",
    search: "Search group, owner or member ID", allSports: "All sports", status: { active: "Open", archived: "Closed", all: "All" },
    owner: "Owner", members: "Members", level: "Level", created: "Created", noPhoto: "No photo", none: "No groups yet", open: "Details",
    close: "Close", archive: "Close group", restore: "Reopen group", removePhoto: "Remove photo", clearDescription: "Remove description", removeMember: "Remove",
    reason: "Reason (the member sees it)", description: "Description", noDescription: "No description", awards: "Group Coin awards", noAwards: "No awards yet",
    claims: "Coins received by members", noClaims: "No Coins received yet", waiting: "Waiting", received: "Received", expired: "Expired",
    topOfDay: "Busiest group of the day", streak: "Three days in a row", coinsRule: "Owner {owner} · members {member} Coins",
    archiveTitle: "Close this group?", archiveMessage: "It disappears from the app and nobody can join (it can be reopened).",
    photoTitle: "Remove this group photo?", photoMessage: "The photo is deleted; the owner is told and can add a new one.",
    descriptionTitle: "Remove this group's description?", descriptionMessage: "The text is deleted; the owner is told.",
    memberTitle: "Take this member out of the group?", memberMessage: "The member is told and can join again.",
    done: "Saved", failed: "Could not save", loadFailed: "Could not load groups", retry: "Try again", loading: "Loading…",
  },
} as const;

async function send<T>(url: string, init: RequestInit): Promise<{ ok: true; data: T } | { ok: false; message: string }> {
  try {
    const response = await fetch(url, { ...init, headers: { "content-type": "application/json", ...(init.headers || {}) }, cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) return { ok: false, message: String(body.message || response.statusText) };
    return { ok: true, data: body as T };
  } catch {
    return { ok: false, message: "Network error" };
  }
}

function GroupPhoto({ group, size }: { group: Pick<Group, "photoUrl" | "sportIcon" | "name">; size: number }) {
  const src = safeImageSource(group.photoUrl);
  return src
    ? <Image className="admin-group-photo" src={src} alt={group.name} width={size} height={size} unoptimized={!src.startsWith("/uploads/")} />
    : <span className="admin-group-photo fallback" style={{ width: size, height: size }} aria-hidden="true">{group.sportIcon}</span>;
}

export function AdminGroups({ lang }: { lang: Lang }) {
  const t = copy[lang];
  const { notify, confirm } = useAdminFeedback();
  const [status, setStatus] = useState<"active" | "archived" | "all">("active");
  const [sport, setSport] = useState("");
  const [search, setSearch] = useState("");
  const [list, setList] = useState<{ groups: Group[]; sports: Sport[]; totals: Totals } | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [reason, setReason] = useState("");

  useEffect(() => {
    let alive = true;
    const params = new URLSearchParams({ status, ...(sport ? { sport } : {}), ...(search.trim() ? { q: search.trim() } : {}) });
    const timer = window.setTimeout(() => {
      void send<{ groups: Group[]; sports: Sport[]; totals: Totals }>(`/api/admin/groups?${params}`, { method: "GET" }).then((sent) => {
        if (!alive) return;
        if (sent.ok) { setList(sent.data); setError(""); } else setError(sent.message);
      });
    }, search ? 300 : 0);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [status, sport, search, revision]);

  useEffect(() => {
    if (!detailId) return;
    let alive = true;
    void send<Detail>(`/api/admin/groups?id=${detailId}`, { method: "GET" }).then((sent) => {
      if (!alive) return;
      if (sent.ok) setDetail(sent.data);
      else notify("error", sent.message || t.loadFailed);
    });
    return () => { alive = false; };
  }, [detailId, revision, notify, t.loadFailed]);

  const act = async (group: Group, action: "archive" | "restore" | "remove_photo" | "clear_description") => {
    const ask = action === "archive" ? [t.archiveTitle, t.archiveMessage, t.archive] : action === "remove_photo" ? [t.photoTitle, t.photoMessage, t.removePhoto] : action === "clear_description" ? [t.descriptionTitle, t.descriptionMessage, t.clearDescription] : null;
    if (ask && !(await confirm({ title: ask[0], message: ask[1], details: [[t.title, `${group.sportIcon} ${group.name}`], [t.owner, `${group.ownerName} · ${group.ownerCode}`], ...(reason.trim() ? [[t.reason, reason.trim()] as [string, string]] : [])], confirmLabel: ask[2], danger: action !== "restore" }))) return;
    const sent = await send("/api/admin/groups", { method: "PATCH", body: JSON.stringify({ id: group.id, action, reason: reason.trim() }) });
    if (!sent.ok) return notify("error", sent.message || t.failed);
    setReason("");
    setRevision((value) => value + 1);
    notify("success", t.done);
  };
  const removeMember = async (group: Group, member: Member) => {
    if (!(await confirm({ title: t.memberTitle, message: t.memberMessage, details: [[t.title, group.name], [t.members, `${member.displayName} · ${member.memberCode}`]], confirmLabel: t.removeMember, danger: true }))) return;
    const sent = await send("/api/admin/groups", { method: "DELETE", body: JSON.stringify({ id: group.id, userId: member.userId }) });
    if (!sent.ok) return notify("error", sent.message || t.failed);
    setRevision((value) => value + 1);
    notify("success", t.done);
  };

  const kindLabel = (kind: string | null) => (kind === "streak_3" ? t.streak : t.topOfDay);

  return (
    <div className="admin-trainer-layout">
      <section className="admin-panel">
        <h2>{t.title}</h2>
        <p>{t.intro}</p>
        {list ? (
          <div className="admin-group-totals">
            <div><small>{t.active}</small><b>{list.totals.active}</b></div>
            <div><small>{t.withPhoto}</small><b>{list.totals.withPhoto}</b></div>
            <div><small>{t.unclaimed}</small><b>{list.totals.unclaimedCoins}</b></div>
          </div>
        ) : null}
        <div className="admin-list-toolbar admin-group-filters">
          <input type="search" value={search} maxLength={80} placeholder={t.search} aria-label={t.search} onChange={(event) => setSearch(event.target.value)} />
          <select value={sport} aria-label={t.allSports} onChange={(event) => setSport(event.target.value)}>
            <option value="">{t.allSports}</option>
            {(list?.sports || []).map((item) => <option key={item.slug} value={item.slug}>{item.icon ? `${item.icon} ` : ""}{item.name}</option>)}
          </select>
          <select value={status} aria-label={t.status.all} onChange={(event) => setStatus(event.target.value as typeof status)}>
            {(["active", "archived", "all"] as const).map((value) => <option key={value} value={value}>{t.status[value]}</option>)}
          </select>
        </div>
        {error ? <AdminNotice tone="error" lang={lang}>{t.loadFailed} · {error} <button type="button" onClick={() => { setError(""); setRevision((value) => value + 1); }}>{t.retry}</button></AdminNotice> : null}
        {!list && !error ? <p>{t.loading}</p> : null}
        <div className="admin-booking-cards admin-group-cards">
          {list?.groups.map((group) => (
            <article key={group.id}>
              <GroupPhoto group={group} size={48} />
              <div>
                <b>{group.sportIcon} {group.name}</b>
                <span>{t.owner}: {group.ownerName} · {group.ownerCode}</span>
                <small>{t.level}: {group.levelName} · {t.members} {group.members} · {t.created} {group.createdAt}</small>
                {group.description ? <small className="admin-group-description">{group.description}</small> : null}
              </div>
              <span className={`admin-badge ${group.status === "active" ? "good" : "neutral"}`}>{t.status[group.status]}{group.unclaimed ? ` · 🎁 ${group.unclaimed}` : ""}</span>
              <div className="admin-row-actions"><button type="button" onClick={() => { setReason(""); setDetail(null); setDetailId(group.id); }}>{t.open}</button></div>
            </article>
          ))}
          {list && !list.groups.length ? <p>{t.none}</p> : null}
        </div>
      </section>
      {detailId ? (
        <AdminDialog onClose={() => { setDetailId(null); setDetail(null); }}>
          <section className="admin-modal admin-group-modal">
            <header><div><small>{t.title}</small><h2>{detail ? `${detail.group.sportIcon} ${detail.group.name}` : t.loading}</h2></div><button type="button" aria-label={t.close} onClick={() => { setDetailId(null); setDetail(null); }}>×</button></header>
            {detail ? (
              <div className="admin-form">
                <div className="wide admin-group-head">
                  <GroupPhoto group={detail.group} size={96} />
                  <div>
                    <p><b>{t.owner}:</b> {detail.group.ownerName} · {detail.group.ownerCode}</p>
                    <p><b>{t.level}:</b> {detail.group.levelName} · <b>{t.members}:</b> {detail.group.members}</p>
                    <p><b>{t.description}:</b> {detail.group.description || t.noDescription}</p>
                  </div>
                </div>
                <label className="wide">{t.reason}<input value={reason} maxLength={255} onChange={(event) => setReason(event.target.value)} /></label>
                <div className="admin-form-actions wide">
                  {detail.group.photoUrl ? <button type="button" className="ghost" onClick={() => void act(detail.group, "remove_photo")}>{t.removePhoto}</button> : null}
                  {detail.group.description ? <button type="button" className="ghost" onClick={() => void act(detail.group, "clear_description")}>{t.clearDescription}</button> : null}
                  {detail.group.status === "active"
                    ? <button type="button" className="admin-button danger" onClick={() => void act(detail.group, "archive")}>{t.archive}</button>
                    : <button type="button" onClick={() => void act(detail.group, "restore")}>{t.restore}</button>}
                </div>
                <h3 className="admin-subhead wide">{t.members}</h3>
                <div className="admin-booking-cards wide">
                  {detail.members.map((member) => (
                    <article key={member.userId}>
                      <div><b>{member.displayName}</b><span>{member.memberCode} · {member.joinedAt}</span></div>
                      {member.userId === detail.group.ownerUserId ? <span className="admin-badge neutral">{t.owner}</span> : <div className="admin-row-actions"><button type="button" className="danger" onClick={() => void removeMember(detail.group, member)}>{t.removeMember}</button></div>}
                    </article>
                  ))}
                </div>
                <h3 className="admin-subhead wide">{t.awards}</h3>
                <div className="admin-booking-cards wide">
                  {detail.awards.map((award) => (
                    <article key={`${award.kind}-${award.awardDate}`}>
                      <div><b>{kindLabel(award.kind)} · {award.awardDate}</b><span>{t.coinsRule.replace("{owner}", String(award.coinsOwner)).replace("{member}", String(award.coinsMember))} · {t.members} {award.members}</span></div>
                    </article>
                  ))}
                  {!detail.awards.length ? <p>{t.noAwards}</p> : null}
                </div>
                <h3 className="admin-subhead wide">{t.claims}</h3>
                <div className="admin-booking-cards wide">
                  {detail.claims.map((claim) => {
                    const state = claim.status === "used" ? t.received : Number(claim.expired) || claim.status !== "active" ? t.expired : t.waiting;
                    return (
                      <article key={claim.id}>
                        <div><b>{claim.displayName} · +{claim.coins} Coin</b><span>{claim.memberCode} · {kindLabel(claim.kind)} {claim.awardDate || ""}</span></div>
                        <span className={`admin-badge ${claim.status === "used" ? "good" : state === t.waiting ? "warn" : "neutral"}`}>{state}{claim.status === "used" ? ` · ${claim.updatedAt}` : ""}</span>
                      </article>
                    );
                  })}
                  {!detail.claims.length ? <p>{t.noClaims}</p> : null}
                </div>
              </div>
            ) : <p>{t.loading}</p>}
          </section>
        </AdminDialog>
      ) : null}
    </div>
  );
}
