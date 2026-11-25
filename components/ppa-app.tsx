"use client";
import Image from "next/image";
import { Bell, House, Dumbbell, QrCode, CalendarDays, UserRound, ChevronLeft, ChevronRight, Pause, Play, Wallet } from "lucide-react";
import { safeImageSource } from "@/lib/media";
import { bangkokToday, type AvailabilityStatus } from "@/lib/court-availability";
import { AdminDialog } from "@/components/admin-dialog";
import { clearMemberCache, readMemberCache, writeMemberCache } from "@/lib/member-cache";
import { upcomingBooking, bookingStatusLabel } from "@/lib/booking-presentation";
import { t, localeTag, localizedContent, courtName } from "@/lib/i18n";
import { LanguageSwitcher, MemberLocaleSync, useMemberLocale } from "@/components/language-switcher";
import { Empty, LoadingNote, money, SectionTitle, Spinner, Top } from "@/components/member-ui";
import { ConfirmDialog, type ConfirmRequest } from "@/components/member-confirm";
import { CouponCards, CouponUsageInfo, PackagePlansScreen, type PlanTab, type RenewTab } from "@/components/member-packages";
import { MyCouponList } from "@/components/member-coupons";
import { FindYourGameRow, FindYourGameScreen, GroupCreateScreen, GroupDetailScreen, GroupRankingScreen, claimLabel, type CoinClaim, type NewGroup } from "@/components/member-groups";
import { QrPass, ScanHub, type AccessQr, type ScanTab } from "@/components/member-scan";
import { GUIDE_VERSION, guideSteps, isBackSwipe, MemberGuide } from "@/components/member-guide";
import { sportsByUse, type LiveFeed, type LiveGame } from "@/lib/find-your-game";
import { GymnosHub, type GymnosTarget } from "@/components/gymnos-hub";
import { WalletPanel } from "@/components/member-wallet";
import { SportScreen, type CourtBookingRequest } from "@/components/member-sport";
import type { RankFocus, RankJoin } from "@/components/member-rank";
import { BigScreenBanner, BigScreenScreen } from "@/components/member-bigscreen";
import { ClassServiceScreen, type ClassReserve, type ClassService, type ClassView } from "@/components/member-classes";
import { nextDateOn, TimetableScreen, type TimetablePick } from "@/components/member-timetable";
import { MemberVerifyScreen, PromotionScreen } from "@/components/member-promotion";
import { trainersFor, type ClassProgram } from "@/lib/class-programs";
import { discounted } from "@/lib/promotions";
import { MemberStatusScreen, TransactionHistoryScreen } from "@/components/member-status";
import { dateLabel } from "@/components/member-schedule";
import type { ScreenProgram } from "@/lib/screen-programs";
import { PromptPayScreen } from "@/components/member-promptpay";
import { RewardsScreen } from "@/components/member-rewards";
import { VisitsScreen } from "@/components/member-visits";
import { PrivacyPolicyDialog } from "@/components/member-consent";
import { needsConsent, privacyPolicy, supportContact, telHref } from "@/lib/site-settings";
import { keepRequestForRetry } from "@/lib/payment-presentation";
import { parseMeta, wallClockTime } from "@/lib/package-presentation";
import { richMenuScreens as deepLinkScreens, screenFromSearch } from "@/lib/rich-menu";
import type { Booking, Bootstrap, ContentItem, Coupon, Group, Screen, Sport, Trainer, TrainerPackage, TrainerScheduleDay } from "@/components/member-types";

import liff from "@line/liff";
import { useEffect, useEffectEvent, useRef, useState, type ComponentProps } from "react";

type Slot = {
  courtId: number;
  courtName: string;
  time: string;
  available: boolean;
  rate: number;
  capacity: number;
  status: AvailabilityStatus;
};

type PendingItem = { title: string; amount: number; back: Screen; save?: "coupon" | "topup" | "class" | "membership" | "pause" | "renewal"; couponId?: number; contentId?: number; trainerId?: number; trainerPackage?: string; itemType?: string; membershipId?: number; pauseStart?: string; pauseDays?: number; userCouponId?: number };
type CheckoutTarget = { booking: Booking | null; item: PendingItem | null };

type TabIcon = "home" | "trainer" | "scan" | "history" | "profile";

const tabs: [Screen, TabIcon, string][] = [
  ["home", "home", "หน้าหลัก"],
  ["trainer", "trainer", "เทรนเนอร์"],
  ["scan", "scan", "สแกน"],
  ["mybooking", "history", "ประวัติ"],
  ["profile", "profile", "โปรไฟล์"],
];

const richMenuScreens: readonly Screen[] = deepLinkScreens;
const managedPrototypeScreens: Screen[] = [
  "orprofile", "kuanprofile", "groupchat", "kuanvote", "kuanresult", "kuanredeem", "playerprofile", "coinshop", "kuanroster", "kuanpairs",
  "svcdetail", "pilprivate", "pilgroup", "promo", "tennis", "basketball", "volleyball", "classhub", "bookings", "editprofile", "payscan", "pool", "classes",
  "walletpay", "linkwallet", "linkbank", "visits", "personal", "notisettings", "qr", "scanqr",
];

function initialScreenFromUrl(): Screen {
  if (typeof window === "undefined") return "home";
  return (screenFromSearch(window.location.search, richMenuScreens) as Screen | null) || "home";
}


const serviceShortcuts: { icon: string; title: string; text: string; screen: Screen }[] = [
  { icon: "🏋️", title: "Gymnos Hub", text: "Fitness · Swim · HYROX · Pilates · Airfit · Promotion", screen: "gymnos" },
  { icon: "🏊", title: "Swim Pack", text: "สระและแพ็กเกจ", screen: "swim" },
  { icon: "🤸", title: "Pilates", text: "Private / Group", screen: "pilates" },
  { icon: "🎁", title: "Promotion", text: "ดีลสมาชิก", screen: "promotion" },
  { icon: "📺", title: "Big Screen Live", text: "ตารางถ่ายทอดสดจอยักษ์", screen: "livetv" },
  { icon: "🎫", title: "Coupon", text: "ซื้อและใช้คูปอง", screen: "coupon" },
  { icon: "🏆", title: "Reward", text: "Coins / Points", screen: "reward" },
  { icon: "👥", title: "Find Your Game", text: "ก๊วนและ Open Run", screen: "groups" },
];

const gymnosChildren: Screen[] = ["swim", "hyrox", "pilates", "airfit", "svcclass", "promotion"];
const timeChoices = ["08:00", "09:30", "11:00", "12:30", "14:00", "15:30", "17:00", "18:30", "20:00"];

const statIcons: Record<string, string> = {
  Bookings: "📋",
  Coupons: "🎫",
  Groups: "👥",
  Unread: "🔔",
};

const entitlementLabels: Record<string, string> = { time_pass: "บัตรผ่าน Time", class: "คลาส", trainer: "เทรนเนอร์", reward: "รางวัล", coupon: "คูปอง", membership: "แพ็กเกจ", group_coin: "Coin ก๊วน" };

function entitlementLabel(type: string) {
  return entitlementLabels[type] || "สิทธิ์";
}

function newRequestId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}

function today() {
  return bangkokToday();
}

// The item on the QR payment: the booking with its day ("🔥 Hyrox Simulation · 08:00–10:30 · 16/11").
function payItemName(booking: Booking) {
  // Dates arrive as ISO instants or Bangkok wall-clock text; the day shown is the Bangkok day.
  const time = wallClockTime(booking.startsAt || booking.starts_at || "");
  if (!Number.isFinite(time)) return booking.title;
  const date = new Date(time + 7 * 3_600_000).toISOString().slice(0, 10);
  return `${booking.title} · ${date.slice(8, 10)}/${date.slice(5, 7)}`.slice(0, 180);
}

function bookingNo(booking: Booking | null) {
  return booking?.booking_no || booking?.bookingNo || "";
}

function memberInitial(name: string | undefined) {
  const trimmed = (name || "PPA").trim();
  return trimmed.slice(0, 1).toUpperCase();
}

async function api<T>(url: string, init?: RequestInit) {
  const res = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers || {}) },
    cache: "no-store",
    signal: init?.signal || AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const error = new Error(body?.message || "เกิดข้อผิดพลาด");
    Object.assign(error, { status: res.status, code: typeof body?.code === "string" ? body.code : undefined });
    throw error;
  }
  return (await res.json()) as T;
}

export function PpaApp() {
  useMemberLocale();
  return <><MemberLocaleSync /><MemberApp /></>;
}

function MemberApp() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);
  const [screen, setScreen] = useState<Screen>(initialScreenFromUrl);
  const [lineReady, setLineReady] = useState(false);
  const [lineBlocked, setLineBlocked] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [data, setData] = useState<Bootstrap | null>(null);
  // Last data of this LINE account, shown at once on reopen while fresh data loads (lib/member-cache).
  const memberKey = useRef("");
  const savedShown = useRef(false);
  const [fromCache, setFromCache] = useState(false);
  // Important actions ask first (components/member-confirm.tsx).
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null);
  const [couponStore, setCouponStore] = useState<Coupon[]>([]);
  const [selectedSport, setSelectedSport] = useState<Sport | null>(null);
  const [date] = useState(today());
  const [, setSlots] = useState<Slot[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  const [selectedTime, setSelectedTime] = useState("18:00");
  const [availabilityRevision, setAvailabilityRevision] = useState(0);
  const [slotsResult, setSlotsResult] = useState<{ key: string; error?: string } | null>(null);
  const availabilityKey = `${selectedSport?.slug}:${date}:${availabilityRevision}`;
  const slotsLoading = slotsResult?.key !== availabilityKey;
  const [players, setPlayers] = useState(2);
  const [pendingBooking, setPendingBooking] = useState<Booking | null>(null);
  const [cancelTarget, setCancelTarget] = useState<Booking | null>(null);
  const [pendingItem, setPendingItem] = useState<PendingItem | null>(null);
  const [planTab, setPlanTab] = useState<PlanTab>("monthly");
  const [plansReturn, setPlansReturn] = useState<Screen>("home");
  const [renewFocus, setRenewFocus] = useState<{ sub: RenewTab; couponId?: number } | undefined>(undefined);
  const [couponTab, setCouponTab] = useState<"mine" | "buy" | null>(null);
  const [hubReturn, setHubReturn] = useState<Screen>("home");
  const [promptPayNo, setPromptPayNo] = useState("");
  // One id per checkout: a retried or double-tapped payment replays instead of charging twice.
  const [checkoutId, setCheckoutId] = useState("");
  const [accessQr, setAccessQr] = useState<AccessQr>({ purpose: "member" });
  // สแกน: the Member / Coupon tab, and where "QR สแกนเข้า" goes back to.
  const [scanTab, setScanTab] = useState<ScanTab | null>(null);
  const [qrBack, setQrBack] = useState<Screen>("scan");
  // Find Your Game: Buffet Rank / Open Run sessions of every sport (GET /api/rank/live).
  const [liveFeed, setLiveFeed] = useState<LiveFeed | null>(null);
  // The sport page opens on a tab ("rank" from Find Your Game, "groups" from a group page) and time.
  const [sportTab, setSportTab] = useState<string | undefined>(undefined);
  const [rankFocus, setRankFocus] = useState<RankFocus | undefined>(undefined);
  // Group pages: the sport of the create / ranking page, the open group and where it goes back to.
  const [groupSport, setGroupSport] = useState<Sport | null>(null);
  const [groupId, setGroupId] = useState<number | null>(null);
  const [groupBack, setGroupBack] = useState<Screen>("courts");
  const [groupRevision, setGroupRevision] = useState(0);
  const [fitnessTab, setFitnessTab] = useState<PlanTab>("package");
  const guideOpened = useRef(false);
  const [toast, setToast] = useState("");
  const [busy, setBusy] = useState(false);
  const [lastPaymentStatus, setLastPaymentStatus] = useState<"paid" | "created">("paid");
  const [selectedTrainer, setSelectedTrainer] = useState<Trainer | null>(null);
  const [trainerDetail, setTrainerDetail] = useState(false);
  const [myTrainerSlug, setMyTrainerSlug] = useState("");
  const [trainerContactOpen, setTrainerContactOpen] = useState(false);
  const [trainerPlanIndex, setTrainerPlanIndex] = useState<number | null>(null);
  const [trainerDayIndex, setTrainerDayIndex] = useState(0);
  const [tutorial, setTutorial] = useState(0);
  const [policyOpen, setPolicyOpen] = useState(false);
  const rewardAttempt = useRef<{ contentId: number; requestId: string } | null>(null);
  const [bookingTab, setBookingTab] = useState<"up" | "his">("up");
  // Big Screen Live program guide (today and tomorrow), read with the member data.
  const [screenPrograms, setScreenPrograms] = useState<ScreenProgram[]>([]);
  // Where the payment screen goes back to for a booking made on a sport or class page.
  const [bookingBack, setBookingBack] = useState<Screen | null>(null);
  // Bumped after a class booking so the class page reloads its places.
  const [classRevision, setClassRevision] = useState(0);
  // What the member chose on each class page (tab, day, instructor, room), kept across the trainer page.
  const [classViews, setClassViews] = useState<Record<string, ClassView>>({});
  // A private class waiting for its instructor: the trainer page picks for it, then goes back.
  const [trainerPick, setTrainerPick] = useState<{ service: ClassService; program: ClassProgram } | null>(null);
  // Swim page tab (แก้ 7), and the Member package waiting for the member number and OTP (แก้ 12).
  const [swimTab, setSwimTab] = useState<PlanTab>("package");
  const [memberBuy, setMemberBuy] = useState<ContentItem | null>(null);

  const requireLine = process.env.NEXT_PUBLIC_REQUIRE_LINE === "true" || process.env.NODE_ENV === "production";
  // Startup steps that use the latest state without restarting the effects below.
  const onSignedIn = useEffectEvent((member: string) => showSaved(member));
  const onLineReady = useEffectEvent(() => Promise.all([refresh(), loadCoupons(), loadScreenPrograms(), loadLive()]));

  useEffect(() => {
    async function bootLine() {
      if (!process.env.NEXT_PUBLIC_LINE_LIFF_ID) {
        if (requireLine) setLineBlocked(true);
        else onSignedIn("local");
        setLineReady(true);
        return;
      }
      await liff.init({ liffId: process.env.NEXT_PUBLIC_LINE_LIFF_ID });
      if (!liff.isInClient()) {
        setLineBlocked(true);
        return;
      }
      if (!liff.isLoggedIn()) {
        liff.login();
        return;
      }
      // liff.init() may rewrite the URL from liff.state; open the rich-menu screen it carries.
      const deepLink = screenFromSearch(window.location.search, richMenuScreens) as Screen | null;
      if (deepLink) setScreen(deepLink);
      onSignedIn(liff.getDecodedIDToken()?.sub || "");
      const idToken = liff.getIDToken();
      if (idToken) await api("/api/auth/line", { method: "POST", body: JSON.stringify({ idToken }) });
      setLineReady(true);
    }
    bootLine().catch(() => { setLineBlocked(requireLine); setLineReady(true); });
  }, [requireLine]);

  useEffect(() => {
    if (!lineReady) return;
    onLineReady().catch((error) => {
      if ((error as Error & { status?: number }).status === 401 && requireLine) {
        clearMemberCache();
        setLineBlocked(true);
        return;
      }
      notice(savedShown.current ? "ยังอัปเดตข้อมูลไม่ได้ กำลังแสดงข้อมูลล่าสุดที่บันทึกไว้" : (error as Error).message);
      savedShown.current = false;
      setFromCache(false);
      setLoadError(true);
    });
  }, [lineReady, requireLine]);

  // Keep Find Your Game places live while they are on screen (Buffet Rank / Open Run of every sport).
  const hasData = Boolean(data);
  useEffect(() => {
    if (!hasData || !["home", "groups"].includes(screen)) return;
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      void loadLive();
      if (screen === "groups") api<{ groups: Group[] }>("/api/groups").then((res) => setData((current) => (current ? { ...current, groups: res.groups } : current))).catch(() => {});
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [hasData, screen]);

  // The guide opens by itself once per version, on the home screen of a fresh (not saved) load, after
  // the privacy policy has been answered (users.guide_version, components/member-guide.tsx).
  useEffect(() => {
    if (!data || fromCache || guideOpened.current || screen !== "home" || tutorial > 0) return;
    if (data.guideVersion === GUIDE_VERSION || needsConsent(privacyPolicy((data.contentItems || []).map(localizedContent)), data.consent)) return;
    guideOpened.current = true;
    const timer = window.setTimeout(() => setTutorial(1), 600);
    return () => window.clearTimeout(timer);
  }, [data, fromCache, screen, tutorial]);

  // Swipe left (straight or slanted) goes back one screen, as the guide teaches: the page's own back
  // button when it has one, else home. Not on carousels and other side-scrolling rows, not in forms and
  // not while a dialog or the guide is open.
  const swipeBack = useEffectEvent(() => {
    // Never while a payment or booking is being sent (its screen has no way back then).
    if (busy || screen === "home" || document.querySelector("dialog[open], .tut-overlay")) return;
    const back = document.querySelector<HTMLButtonElement>(".phone > .content .top .back-btn");
    if (back) back.click();
    else go("home");
  });
  useEffect(() => {
    if (!hasData) return;
    const content = document.querySelector<HTMLElement>(".phone > .content");
    if (!content) return;
    let start: { x: number; y: number; at: number } | null = null;
    const sideways = (node: Element | null) => {
      for (let element = node; element && element !== content; element = element.parentElement) {
        if (element.matches("input, textarea, select, [contenteditable='true'], .ad-carousel, .no-swipe-back")) return true;
        const style = window.getComputedStyle(element);
        if (/(auto|scroll)/.test(style.overflowX) && element.scrollWidth > element.clientWidth + 2) return true;
      }
      return false;
    };
    const onStart = (event: TouchEvent) => {
      const touch = event.touches[0];
      start = event.touches.length === 1 && touch && !sideways(event.target as Element) ? { x: touch.clientX, y: touch.clientY, at: Date.now() } : null;
    };
    const onEnd = (event: TouchEvent) => {
      const touch = event.changedTouches[0];
      if (start && touch && isBackSwipe(touch.clientX - start.x, touch.clientY - start.y, Date.now() - start.at)) swipeBack();
      start = null;
    };
    content.addEventListener("touchstart", onStart, { passive: true });
    content.addEventListener("touchend", onEnd, { passive: true });
    return () => {
      content.removeEventListener("touchstart", onStart);
      content.removeEventListener("touchend", onEnd);
    };
  }, [hasData]);

  // The big screen guide changes during the day: refresh it every minute on the home and guide screens.
  useEffect(() => {
    if (!hasData || !["home", "livetv"].includes(screen)) return;
    const timer = window.setInterval(() => { if (!document.hidden) void loadScreenPrograms(); }, 60_000);
    return () => window.clearInterval(timer);
  }, [hasData, screen]);

  const appContent = (data?.contentItems || []).map(localizedContent);
  const contact = supportContact(appContent);
  const policy = privacyPolicy(appContent);
  const consentDue = Boolean(data) && !["splash", "login"].includes(screen) && needsConsent(policy, data?.consent);
  const managedSlides = contentByType(appContent, "home_slide");


  useEffect(() => {
    if (!selectedSport?.requiresBooking || !["datetime", "summary"].includes(screen)) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ sport: selectedSport.slug, date });
    const refreshSlots = () => api<{ slots: Slot[] }>(`/api/courts/availability?${params.toString()}`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) })
      .then((res) => {
        if (controller.signal.aborted) return;
        setSlots(res.slots);
        setSlotsResult({ key: availabilityKey });
        setSelectedSlot((current) => current ? res.slots.find((slot) => slot.courtId === current.courtId && slot.time === current.time && slot.available) || null : null);
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setSlots([]);
        setSelectedSlot(null);
        setSlotsResult({ key: availabilityKey, error: error.message });
      });
    void refreshSlots();
    const timer = window.setInterval(() => { if (!document.hidden) void refreshSlots(); }, 30000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [selectedSport, date, availabilityKey, screen]);


  const unreadCount = data?.notifications.filter((item) => item.status === "unread").length ?? 0;

  function notice(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2800);
  }

  function go(next: Screen, fromOpenPlans = false) {
    const returningFromFlow = ["payment", "success", "paypromptpay", "plans"].includes(screen);
    // Service screens opened from the GYMNOS hub return there; from elsewhere they return home.
    if (gymnosChildren.includes(next) && next !== screen && !returningFromFlow) setHubReturn(screen === "gymnos" ? "gymnos" : "home");
    // Plans opened from a banner/slide/managed content start fresh and return to where they were opened.
    if (next === "plans" && !fromOpenPlans && !returningFromFlow) {
      setPlanTab("monthly");
      setRenewFocus(undefined);
      setPlansReturn(screen);
    }
    if (next === "payment" && screen !== "payment") setCheckoutId(newRequestId());
    if ((next === "notifications" || next === "noti") && data?.notifications.some((item) => item.status === "unread")) {
      // Opening the list marks everything read; the bell count updates immediately.
      void api("/api/notifications/read", { method: "POST" }).then(() => setData((current) => (current ? { ...current, notifications: current.notifications.map((item) => ({ ...item, status: "read" })) } : current))).catch(() => {});
    }
    setScreen(next);
    document.querySelector(".phone > .content")?.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }

  async function refresh() {
    const loaded = await api<Partial<Bootstrap> & Pick<Bootstrap, "user" | "wallet">>("/api/bootstrap");
    // Lists added after the first release default to empty so an older API response still renders.
    const next: Bootstrap = {
      sports: [], bookings: [], coupons: [], expiredCoupons: [], trainers: [], groups: [], notifications: [], contentItems: [], memberships: [], membershipPauses: [], entitlements: [], pendingPayments: [], walletLedger: [], visits: [],
      ...loaded,
    };
    applyData(next);
    savedShown.current = false;
    setFromCache(false);
    writeMemberCache(memberKey.current, next);
  }

  function applyData(next: Bootstrap) {
    setData(next);
    setSelectedTrainer((current) => current || next.trainers[0] || null);
    setSelectedSport((current) => current || next.sports.find((s) => s.requiresBooking) || next.sports[0] || null);
  }

  // Same LINE account as the saved data: show it now; refresh() replaces it in a moment.
  function showSaved(member: string) {
    memberKey.current = member;
    const saved = readMemberCache<Bootstrap>(member);
    if (!saved?.user || !saved.wallet) return;
    applyData(saved);
    savedShown.current = true;
    setFromCache(true);
  }

  async function loadCoupons() {
    const res = await api<{ coupons: Coupon[] }>("/api/coupons");
    setCouponStore(res.coupons);
  }

  async function loadLive() {
    try {
      setLiveFeed(await api<LiveFeed>("/api/rank/live"));
    } catch {
      // Optional: Find Your Game says nothing is open and links to the full list.
      setLiveFeed((current) => current || { games: [], sports: [] });
    }
  }

  async function loadScreenPrograms() {
    try {
      const res = await api<{ programs: ScreenProgram[] }>("/api/screen-programs");
      setScreenPrograms(res.programs);
    } catch {
      // The guide is optional: the banner says there is nothing scheduled.
    }
  }

  // Pilates and Airfit are class pages (coupons and a weekly schedule), not courts.
  function pickSport(sport: Sport, tab?: string, focus?: RankFocus) {
    if (sport.slug === "pilates" || sport.slug === "airfit") {
      go(sport.slug);
      return;
    }
    setSelectedSport(sport);
    setSelectedSlot(null);
    setSportTab(tab);
    setRankFocus(focus);
    go(sport.requiresBooking ? "courts" : "summary");
  }

  // Find Your Game: the sport's Buffet Rank / Open Run tab on the room, day and time of the card.
  function openGame(game: LiveGame) {
    const sport = data?.sports.find((item) => item.slug === game.sportSlug);
    if (!sport) return;
    pickSport(sport, "rank", { roomId: game.roomId, date: game.date, startsAt: game.startsAt });
  }

  function sportBySlug(slug: string | undefined) {
    return data?.sports.find((item) => item.slug === slug) || null;
  }

  // Group pages open from the sport's ก๊วน tab (or Find Your Game) and go back there.
  function openGroupCreate(sport: Sport) {
    setGroupSport(sport);
    go("groupcreate");
  }

  function openGroupRanking(sport: Sport) {
    setGroupSport(sport);
    go("groupranking");
  }

  function openGroup(id: number) {
    setGroupBack(screen === "groupdetail" ? groupBack : screen);
    setGroupId(id);
    go("groupdetail");
  }

  function backToSportGroups(slug?: string) {
    const sport = sportBySlug(slug) || groupSport || selectedSport;
    if (!sport) { go("home"); return; }
    setSelectedSport(sport);
    setSportTab("groups");
    setRankFocus(undefined);
    go("courts");
  }

  // QR สแกนเข้า of one right, then back to where it was opened.
  function openAccess(access: AccessQr, back: Screen = screen) {
    setPendingBooking(null);
    setAccessQr(access);
    setQrBack(back === "scanqr" ? qrBack : back);
    go("scanqr");
  }

  function openGuide() {
    if (screen !== "home") go("home");
    window.setTimeout(() => setTutorial(1), screen === "home" ? 0 : 250);
  }

  // Finished or skipped: the guide no longer opens by itself for this version, on any phone.
  function closeGuide() {
    setTutorial(0);
    notice("🎉 พร้อมใช้งานแล้ว — ขอให้สนุกกับ PPA!");
    if (data?.guideVersion === GUIDE_VERSION) return;
    setData((current) => (current ? { ...current, guideVersion: GUIDE_VERSION } : current));
    void api("/api/guide", { method: "POST", body: JSON.stringify({ version: GUIDE_VERSION }) }).catch(() => {});
  }

  // Sport page: the member chose a court (or "any court") and a time on the hourly grid.
  async function bookCourt(request: CourtBookingRequest) {
    if (busy || !selectedSport) return;
    setBusy(true);
    let booked: Booking | null = null;
    try {
      const res = await api<{ booking: Booking }>("/api/bookings", {
        method: "POST",
        body: JSON.stringify({ sportSlug: selectedSport.slug, courtId: request.courtId, zone: request.zone, courtKind: request.courtKind, date: request.date, time: request.time, durationHours: request.durationHours, players: 1, title: request.label }),
      });
      setBookingBack("courts");
      booked = res.booking;
    } catch (error) {
      if ((error as Error & { status?: number }).status === 409) setAvailabilityRevision((value) => value + 1);
      notice((error as Error).message);
    } finally {
      setBusy(false);
    }
    // Opened after the booking call has finished, so the payment keeps its own busy state.
    if (booked) startCheckout({ booking: booked });
  }

  async function joinRankNow(join: RankJoin) {
    if (busy) return;
    setBusy(true);
    let booked: Booking | null = null;
    try {
      const res = await api<{ booking: Booking; existing: boolean }>("/api/rank/join", { method: "POST", body: JSON.stringify({ roomId: join.room.id, startsAt: join.slot.startsAt }) });
      setAvailabilityRevision((value) => value + 1);
      if (["paid", "checked_in"].includes(res.booking.status)) {
        notice("เข้าร่วมรอบนี้แล้ว");
        await refresh().catch(() => {});
        return;
      }
      setBookingBack("courts");
      booked = res.booking;
    } catch (error) {
      if ((error as Error & { status?: number }).status === 409) setAvailabilityRevision((value) => value + 1);
      notice((error as Error).message);
    } finally {
      setBusy(false);
    }
    // Opened after the booking call has finished, so the payment keeps its own busy state.
    if (booked) startCheckout({ booking: booked });
  }

  // Buffet Rank / Open Run: the place, the price and the refund rule before the place is held.
  function askJoinRank(join: RankJoin) {
    if (busy) return;
    if (join.slot.mine) {
      void joinRankNow(join);
      return;
    }
    const kind = join.room.kind === "open_run" ? "Open Run" : "Buffet Rank";
    setConfirmRequest({
      title: t("เข้าร่วม {{value0}}?", { value0: kind }),
      details: [
        [t("ห้อง"), `${join.room.icon} ${t(join.room.title)}`],
        [t("วันที่"), `${dateLabel(join.slot.date)} · ${join.slot.from}–${join.slot.to}`],
        [t("ยอดชำระ"), `${money(join.room.price)} ฿`],
        [t("ที่เหลือ"), `${join.slot.left} / ${join.room.capacity}`],
      ],
      note: t("ระบบกันที่ให้ 15 นาทีระหว่างชำระเงิน · ถ้าผู้เล่นไม่ครบ {{value0}} คน ระบบยกเลิกรอบและคืนเงินเข้าเครดิตในแอปอัตโนมัติ", { value0: join.room.minPlayers }),
      confirmLabel: t("เข้าร่วมและชำระเงิน"),
      cancelLabel: t("ยกเลิก"),
      onConfirm: () => void joinRankNow(join),
    });
  }

  async function reserveClassNow(input: ClassReserve, back: Screen) {
    if (busy) return;
    setBusy(true);
    let booked: Booking | null = null;
    try {
      const res = await api<{ booking: Booking; paid: boolean; coupon?: { name: string; remaining: number }; included?: string }>("/api/classes/reserve", { method: "POST", body: JSON.stringify({ programId: input.program.id, date: input.date, time: input.time, useCoupon: input.useCoupon, ...(input.trainerId ? { trainerId: input.trainerId } : {}), ...(input.resource ? { resource: input.resource } : {}) }) });
      setClassRevision((value) => value + 1);
      if (res.paid) {
        notice(res.coupon ? t("จองคลาสแล้ว · ใช้คูปอง 1 ครั้ง เหลือ {{value0}} ครั้ง", { value0: res.coupon.remaining }) : t("จองคลาสแล้ว · บันทึกลงการจองของฉัน"));
        await refresh().catch(() => {});
        return;
      }
      setBookingBack(back);
      booked = res.booking;
    } catch (error) {
      notice((error as Error).message);
      setClassRevision((value) => value + 1);
    } finally {
      setBusy(false);
    }
    // Opened after the booking call has finished, so the payment keeps its own busy state.
    if (booked) startCheckout({ booking: booked });
  }

  // Class time: what is booked and how it is paid (free, one coupon use, a Simulation credit or money).
  // The order of each page holds: buy the coupon first, choose the instructor, then the time.
  function askReserveClass(input: ClassReserve) {
    if (busy) return;
    const { program } = input;
    if (program.kind === "free" && !input.activeMember) {
      notice("เฉพาะสมาชิกที่มีสถานะ (Active Member) เท่านั้นจึงจะจองได้");
      return;
    }
    if (program.kind === "coupon" && !input.covered && input.couponLeft <= 0) {
      notice("ต้องซื้อคูปองก่อน แล้วจึงเลือกเวลา");
      return;
    }
    if (program.trainerLink && !input.trainerId) {
      notice("เลือกผู้สอนก่อนจองเวลา");
      openTrainerPicker(classScreenOf(program), program);
      return;
    }
    const back = screen;
    const free = program.kind === "free" || Boolean(input.covered);
    const payWith = program.kind === "free" ? t("ฟรี (สมาชิก Active Member)") : input.covered ? t("แพ็กเกจ {{value0}}", { value0: t(input.covered) }) : input.useCoupon ? t("ใช้คูปอง 1 ครั้ง (เหลือ {{value0}} ครั้งหลังจอง)", { value0: Math.max(0, input.couponLeft - 1) }) : `${money(program.price)} ฿`;
    setConfirmRequest({
      title: program.kind === "series" ? t("เริ่มโปรแกรม {{value0}}?", { value0: t(program.title) }) : t("จอง {{value0}}?", { value0: t(program.title) }),
      details: [
        [t("วันที่"), `${dateLabel(input.date)} · ${input.time}–${input.endTime}`],
        ...(input.trainerName || input.instructor ? [[t("ผู้สอน"), input.trainerName || input.instructor || ""] as [string, string]] : []),
        ...(input.resource ? [[t(program.resourceLabel || "เลือกห้องหรือเครื่อง").replace(/^เลือก/, ""), t(input.resource)] as [string, string]] : []),
        [t("ชำระด้วย"), payWith],
      ],
      note: free ? t("ยกเลิกได้ก่อนเวลาเรียนอย่างน้อย 30 นาที") : input.useCoupon ? t("ยกเลิกได้ก่อนเวลาเรียนอย่างน้อย 30 นาที คูปองจะคืนให้อัตโนมัติ") : t("ระบบกันที่ให้ 15 นาทีระหว่างชำระเงิน"),
      confirmLabel: free || input.useCoupon ? t("ยืนยันการจอง") : t("จองและชำระเงิน"),
      cancelLabel: t("ยกเลิก"),
      onConfirm: () => void reserveClassNow(input, back),
    });
  }

  function classScreenOf(program: Pick<ClassProgram, "service">): ClassService {
    return program.service === "hyrox" || program.service === "airfit" || program.service === "pilates" ? program.service : "service";
  }

  function classView(service: ClassService) {
    return classViews[service] || {};
  }

  function setClassView(service: ClassService, view: ClassView) {
    setClassViews((current) => ({ ...current, [service]: view }));
  }

  // "เลือกผู้สอน — ไปหน้าเทรนเนอร์": the trainer page lists who teaches the class; a tap picks and returns.
  function openTrainerPicker(service: ClassService, program: ClassProgram) {
    setTrainerPick({ service, program });
    setTrainerDetail(false);
    go("trainer");
  }

  function pickTrainer(trainer: Trainer) {
    if (!trainerPick) return;
    const { service, program } = trainerPick;
    const view = classView(service);
    setClassView(service, { ...view, trainers: { ...view.trainers, [program.slug]: trainer.id } });
    setTrainerPick(null);
    notice(t("เลือก {{value0}} เป็นผู้สอนแล้ว · เลือกวันและเวลาได้เลย", { value0: trainer.name }));
    go(service === "service" ? "svcclass" : service);
  }

  // ตารางคลาส: a class time opens its booking page on the next such day.
  function openFromTimetable(pick: TimetablePick) {
    const service: ClassService = pick.row.service === "hyrox" || pick.row.service === "airfit" || pick.row.service === "pilates" ? pick.row.service : "service";
    const nowWall = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(11, 16);
    const date = nextDateOn(pick.day, bangkokToday(), nowWall, pick.time);
    const view = classView(service);
    const tab = service === "hyrox" || service === "airfit" ? "class" : service === "pilates" ? "group" : view.tab;
    setClassView(service, { ...view, date, tab, chosen: service === "pilates" ? true : view.chosen, program: service === "service" ? pick.row.slug : view.program });
    go(service === "service" ? "svcclass" : service);
  }

  async function createBooking() {
    if (busy) return;
    if (!selectedSport) return;
    if (selectedSport.requiresBooking && (!selectedSlot || slotsLoading)) {
      notice("กรุณาเลือกสนามและเวลา");
      return;
    }
    setBusy(true);
    let booked: Booking | null = null;
    try {
      const res = await api<{ booking: Booking }>("/api/bookings", {
        method: "POST",
        body: JSON.stringify({
          sportSlug: selectedSport.slug,
          courtId: selectedSlot?.courtId ?? null,
          date,
          time: selectedSlot?.time || selectedTime,
          players,
          title: `${selectedSport.icon} ${selectedSport.name}${selectedSlot ? ` · ${selectedSlot.courtName}` : ""}`,
        }),
      });
      booked = res.booking;
    } catch (error) {
      if ((error as Error & { status?: number }).status === 409) {
        setSelectedSlot(null);
        setAvailabilityRevision((value) => value + 1);
        go("courts");
      }
      notice((error as Error).message);
    } finally {
      setBusy(false);
    }
    // Opened after the booking call has finished, so the payment keeps its own busy state.
    if (booked) startCheckout({ booking: booked });
  }

  async function pay(method: "wallet" | "promptpay", target: CheckoutTarget = { booking: pendingBooking, item: pendingItem }, requestId = checkoutId) {
    const { booking: pendingBooking, item: pendingItem } = target;
    if (!pendingBooking && !pendingItem) return;
    setBusy(true);
    try {
      let nextPaymentStatus: "paid" | "created" = method === "wallet" ? "paid" : "created";
      let createdPaymentNo = "";
      if (pendingBooking) {
        const payment = await api<{ status?: string; paymentNo?: string }>("/api/payments", {
          method: "POST",
          body: JSON.stringify({
            bookingNo: bookingNo(pendingBooking),
            method,
            requestId,
            itemName: payItemName(pendingBooking),
          }),
        });
        nextPaymentStatus = payment.status === "created" ? "created" : "paid";
        createdPaymentNo = payment.paymentNo || "";
      } else if (pendingItem?.save === "coupon" && pendingItem.couponId) {
        const couponPayment = await api<{ status?: string; paymentNo?: string }>("/api/coupons/buy", {
          method: "POST",
          body: JSON.stringify({ couponId: pendingItem.couponId, method, requestId }),
        });
        nextPaymentStatus = couponPayment.status === "created" ? "created" : "paid";
        createdPaymentNo = couponPayment.paymentNo || "";
      } else if (pendingItem?.save === "pause" && pendingItem.membershipId && pendingItem.pauseStart && pendingItem.pauseDays) {
        const pause = await api<{ status?: string; paymentNo?: string }>("/api/memberships/pause", {
          method: "POST",
          body: JSON.stringify({ membershipId: pendingItem.membershipId, startDate: pendingItem.pauseStart, days: pendingItem.pauseDays, method, requestId }),
        });
        nextPaymentStatus = pause.status === "created" ? "created" : "paid";
        createdPaymentNo = pause.paymentNo || "";
      } else if (pendingItem?.save === "renewal" && pendingItem.userCouponId) {
        const renewal = await api<{ status?: string; paymentNo?: string }>("/api/coupons/renew", { method: "POST", body: JSON.stringify({ userCouponId: pendingItem.userCouponId, method, requestId }) });
        nextPaymentStatus = renewal.status === "created" ? "created" : "paid";
        createdPaymentNo = renewal.paymentNo || "";
      } else if (pendingItem?.save === "topup") {
        const topupPayment = await api<{ status?: string; paymentNo?: string }>("/api/wallet/topup", { method: "POST", body: JSON.stringify({ amount: pendingItem.amount, requestId }) });
        nextPaymentStatus = topupPayment.status === "created" ? "created" : "paid";
        createdPaymentNo = topupPayment.paymentNo || "";
      } else if (pendingItem) {
        const payment = await api<{ status?: string; paymentNo?: string }>("/api/payments", {
          method: "POST",
          body: JSON.stringify({ contentId: pendingItem.contentId, trainerId: pendingItem.trainerId, trainerPackage: pendingItem.trainerPackage, method, requestId }),
        });
        nextPaymentStatus = payment.status === "created" ? "created" : "paid";
        createdPaymentNo = payment.paymentNo || "";
      }
      await refresh();
      if (pendingItem?.save === "coupon") await loadCoupons();
      setLastPaymentStatus(nextPaymentStatus);
      if (nextPaymentStatus === "created" && createdPaymentNo) {
        // PromptPay: the QR page ("สแกนชำระเงิน") with the exact amount says what to do next.
        setPromptPayNo(createdPaymentNo);
        go("paypromptpay");
        return;
      }
      if (nextPaymentStatus === "created") notice("สร้างรายการชำระเงินแล้ว กรุณารอการยืนยันจากระบบ");
      go("success");
      if (nextPaymentStatus === "paid") notice("ชำระเงินสำเร็จ");
    } catch (error) {
      notice((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function redeemReward(reward: ContentItem) {
    if (busy) return;
    setBusy(true);
    // A retry of the same reward after an unknown outcome reuses the request id, so it cannot redeem twice.
    const requestId = rewardAttempt.current?.contentId === reward.id ? rewardAttempt.current.requestId : newRequestId();
    rewardAttempt.current = { contentId: reward.id, requestId };
    try {
      const result = await api<{ entitlementId: number; title: string }>("/api/rewards/redeem", { method: "POST", body: JSON.stringify({ contentId: reward.id, requestId }) });
      rewardAttempt.current = null;
      // Redeemed: open its QR even if reloading the member data fails now (an error here would
      // hide the QR and invite a second redemption with a new request id).
      await refresh().catch(() => {});
      notice("แลกรางวัลสำเร็จ");
      openAccess({ purpose: "entitlement", entitlementId: result.entitlementId, title: result.title, detail: t("ยื่น QR นี้ให้เจ้าหน้าที่ที่เคาน์เตอร์เพื่อรับรางวัล") }, "reward");
    } catch (error) {
      if (!keepRequestForRetry(error)) rewardAttempt.current = null;
      notice((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // แก้ 6: tapping a price opens the QR payment ("สแกนชำระเงิน") at once. The method screen comes first
  // only when the app credit covers the amount (credit pays instantly) or PromptPay is not set up.
  function startCheckout(next: { booking?: Booking | null; item?: PendingItem | null }) {
    if (busy) return;
    const target: CheckoutTarget = { booking: next.booking ?? null, item: next.item ?? null };
    setPendingBooking(target.booking);
    setPendingItem(target.item);
    const amount = Number(target.booking?.amount ?? target.item?.amount ?? 0);
    const creditCovers = target.item?.save !== "topup" && amount > 0 && Number(data?.wallet.balance ?? 0) >= amount;
    if (creditCovers || data?.promptPayEnabled === false) {
      go("payment");
      return;
    }
    const requestId = newRequestId();
    setCheckoutId(requestId);
    void pay("promptpay", target, requestId);
  }

  // The weekly discount the member claimed (Promotion), as checkout charges it.
  function priceAfterDeal(price: number, scope: string | null) {
    const deal = data?.weeklyDiscount;
    return deal && scope && deal.scope.includes(scope) ? discounted(price, deal.percent) : price;
  }

  // Payment: item, amount and method before money moves (wallet) or a PromptPay request is made.
  function askPay(method: "wallet" | "promptpay") {
    if (busy || (!pendingBooking && !pendingItem)) return;
    const title = t(pendingBooking?.title || pendingItem?.title || "-");
    const amount = Number(pendingBooking?.amount ?? pendingItem?.amount ?? 0);
    const wallet = Number(data?.wallet.balance ?? 0);
    setConfirmRequest({
      title: t("ยืนยันการชำระเงิน"),
      details: [
        [t("รายการชำระ"), title],
        [t("ยอดชำระ"), `${money(amount)} ฿`],
        [t("วิธีชำระ"), method === "wallet" ? t("เครดิตในแอป") : t("พร้อมเพย์")],
        ...(method === "wallet" ? [[t("คงเหลือหลังชำระ"), `${money(wallet - amount)} ฿`] as [string, string]] : []),
      ],
      note: method === "wallet" ? t("ระบบจะหักเครดิตทันทีเมื่อกดยืนยัน") : t("ระบบจะแสดง QR พร้อมเพย์ยอด {{value0}} ฿ ให้สแกนโอน แล้วแนบสลิป", { value0: money(amount) }),
      confirmLabel: method === "wallet" ? t("ยืนยันชำระ {{value0}} ฿", { value0: money(amount) }) : t("สร้าง QR ชำระเงิน"),
      cancelLabel: t("ยกเลิก"),
      onConfirm: () => void pay(method),
    });
  }

  function askRedeem(reward: ContentItem, cost: number) {
    if (busy) return;
    setConfirmRequest({
      title: t("แลกรางวัลนี้?"),
      message: t("ใช้ {{value0}} Coin แลก {{value1}}?", { value0: cost, value1: t(reward.title) }),
      note: t("แลกแล้วจะได้ QR สำหรับรับรางวัลที่เคาน์เตอร์ ใช้ได้ 30 วัน"),
      confirmLabel: t("แลกรางวัล"),
      cancelLabel: t("ยกเลิก"),
      onConfirm: () => void redeemReward(reward),
    });
  }

  function askCancelPending(paymentNo: string) {
    if (busy) return;
    const pending = data?.pendingPayments.find((item) => item.paymentNo === paymentNo);
    setConfirmRequest({
      title: t("ยกเลิกรายการรอชำระนี้?"),
      details: pending ? [[t("รายการชำระ"), t(pending.itemName || paymentNo)], [t("ยอดชำระ"), `${money(pending.amount)} ฿`]] : undefined,
      note: t("ถ้าโอนเงินไปแล้ว อย่ายกเลิก ให้แนบสลิปหรือติดต่อเจ้าหน้าที่"),
      confirmLabel: t("ยกเลิกรายการ"),
      cancelLabel: t("เก็บไว้"),
      danger: true,
      onConfirm: () => void cancelPending(paymentNo),
    });
  }

  async function cancelPending(paymentNo: string) {
    if (busy) return;
    setBusy(true);
    try {
      await api("/api/payments/cancel", { method: "POST", body: JSON.stringify({ paymentNo }) });
      await refresh();
      notice("ยกเลิกรายการแล้ว");
    } catch (error) {
      notice((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function topup(amount: number) {
    if (amount < 50 || amount > 50000) return;
    startCheckout({ item: { title: "เติมเงิน PPA Wallet", amount, back: "wallet", save: "topup" } });
  }

  // price: what a class page shows after the weekly deal; Fitness/Swim coupon tabs work it out here.
  function buyCoupon(coupon: Coupon, back: Screen = "coupon", price?: number) {
    const meta = parseMeta(coupon.metadata);
    const scope = meta.tab === "coupon" ? (typeof meta.page === "string" && meta.page ? meta.page : "fitness") : null;
    startCheckout({ item: { title: coupon.name, amount: price ?? priceAfterDeal(Number(coupon.price || 0), scope), back, save: "coupon", couponId: coupon.id } });
  }

  function openPlans(tab: PlanTab = "monthly", from: Screen = screen) {
    if (tab !== "renew") setRenewFocus(undefined);
    setPlanTab(tab);
    setPlansReturn(from === "plans" || from === "payment" || from === "success" ? "home" : from);
    go("plans", true);
  }

  function openFromGymnos(target: GymnosTarget) {
    if (target === "fitness") {
      openPlans("monthly", "gymnos");
      return;
    }
    if (target === "swim") setSwimTab("package");
    go(target);
  }

  // Member packages (Promotion › Member): bought after the member number and OTP of the last 30 minutes.
  function buyMemberPackage(item: ContentItem, verified: boolean) {
    if (!verified) {
      setMemberBuy(item);
      go("memverify");
      return;
    }
    selectPackage(item, "promotion");
  }

  function openRenewCoupon(coupon: Coupon, from: Screen = screen) {
    setRenewFocus({ sub: "coupon", couponId: coupon.id });
    openPlans("renew", from);
  }

  function openCouponQr(coupon: Coupon) {
    openAccess({ purpose: "coupon", couponId: coupon.id, title: coupon.name, detail: t("เหลือ {{value0}} ใบ · หมดอายุ {{value1}}", { value0: coupon.remainingUses ?? 0, value1: new Date(wallClockTime(coupon.expiresAt)).toLocaleDateString(localeTag(), { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Bangkok" }) }) });
  }

  function openBookingQr(booking: Booking) {
    const no = bookingNo(booking);
    if (!no) return;
    openAccess({ purpose: "booking", bookingNo: no, title: booking.title, detail: t("เลขที่การจอง {{value0}}", { value0: no }) });
  }

  // Group Coins (lib/group-awards.ts): a one-use right whose QR staff scan; the Coins reach the wallet then.
  function openCoinClaim(claim: CoinClaim) {
    openAccess({ purpose: "entitlement", entitlementId: claim.entitlementId, title: t("🎁 รับ {{value0}} Coin · ก๊วน {{value1}}", { value0: claim.coins, value1: claim.groupName }), detail: `${claimLabel(claim)} · ${t("ยื่น QR นี้ให้เจ้าหน้าที่หน้าคลับเพื่อรับ Coin")}` });
  }

  // Monthly / Time packages: the server resolves price and grant terms from the catalog id.
  function selectPackage(item: ContentItem, back: Screen = screen === "swim" ? "swim" : "plans") {
    const membership = item.contentType === "membership_plan";
    const meta = parseMeta(item.metadata);
    const scope = meta.memberOnly === true ? null : typeof meta.page === "string" && meta.page ? meta.page : "fitness";
    startCheckout({ item: { contentId: item.id, title: item.title, amount: priceAfterDeal(Number(item.price), scope), back, save: membership ? "membership" : "class", itemType: membership ? "membership" : item.contentType } });
  }

  function requestPause(input: { membershipId: number; startDate: string; days: number; option: ContentItem }) {
    startCheckout({ item: { title: t("{{value0}} {{value1}} วัน", { value0: t(input.option.title), value1: input.days }), amount: Number(input.option.price), back: screen === "swim" ? "swim" : "plans", save: "pause", membershipId: input.membershipId, pauseStart: input.startDate, pauseDays: input.days } });
  }

  function renewCoupon(input: { userCouponId: number; option: ContentItem; title: string }) {
    // Same amount the server charges: price per month × renewal months (app/api/coupons/renew).
    const months = Number(parseMeta(input.option.metadata).months) || 1;
    startCheckout({ item: { title: `${t(input.option.title)} · ${t(input.title)}`, amount: Number(input.option.price) * months, back: screen === "swim" ? "swim" : "plans", save: "renewal", userCouponId: input.userCouponId } });
  }

  async function refreshGroups() {
    const res = await api<{ groups: Group[] }>("/api/groups");
    setData((current) => (current ? { ...current, groups: res.groups } : current));
  }

  async function groupAction(request: () => Promise<unknown>, success: string) {
    if (busy) return false;
    setBusy(true);
    try {
      await request();
      await refreshGroups();
      setGroupRevision((value) => value + 1);
      notice(success);
      return true;
    } catch (error) {
      notice((error as Error).message);
      if ((error as Error & { status?: number }).status === 409) await refreshGroups().catch(() => {});
      return false;
    } finally {
      setBusy(false);
    }
  }

  // สร้างกลุ่มก๊วน: the group first, then its photo (shrunk on the phone); a photo that fails to upload
  // leaves the group made, and the owner can add the photo on the group page.
  async function createGroup(input: NewGroup) {
    if (busy) return false;
    setBusy(true);
    try {
      const created = await api<{ groupId: number; added: number }>("/api/groups", {
        method: "POST",
        body: JSON.stringify({ sportSlug: input.sportSlug, name: input.name.slice(0, 160), levelName: input.levelName, description: input.description, memberCodes: input.memberCodes }),
      });
      let photoFailed = false;
      if (input.photo) {
        try {
          const form = new FormData();
          form.set("groupId", String(created.groupId));
          form.set("file", new File([input.photo], "group.jpg", { type: input.photo.type || "image/jpeg" }));
          const response = await fetch("/api/groups/photo", { method: "POST", body: form, cache: "no-store", signal: AbortSignal.timeout(30_000) });
          photoFailed = !response.ok;
        } catch {
          photoFailed = true;
        }
      }
      await refreshGroups().catch(() => {});
      notice(photoFailed ? "สร้างก๊วนแล้ว แต่ยังอัปโหลดรูปไม่สำเร็จ ใส่รูปได้ที่หน้าก๊วน" : "สร้างก๊วนสำเร็จ");
      setGroupBack("courts");
      setGroupId(created.groupId);
      setGroupRevision((value) => value + 1);
      go("groupdetail");
      return true;
    } catch (error) {
      notice((error as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  const joinGroup = (group: Group) => groupAction(() => api("/api/groups/join", { method: "POST", body: JSON.stringify({ groupId: group.id }) }), "เข้าร่วมก๊วนแล้ว");
  function askLeaveGroup(group: Group) {
    setConfirmRequest({ title: t("ออกจากก๊วนนี้?"), message: t(group.name), confirmLabel: t("ออกจากก๊วน"), cancelLabel: t("ยกเลิก"), danger: true, onConfirm: () => void leaveGroup(group) });
  }

  function askCloseGroup(group: Group) {
    setConfirmRequest({ title: t("ปิดก๊วนนี้?"), message: t(group.name), note: t("สมาชิกในก๊วนจะเข้าร่วมไม่ได้อีก"), confirmLabel: t("ปิดก๊วน"), cancelLabel: t("ยกเลิก"), danger: true, onConfirm: () => void closeGroup(group) });
  }

  const leaveGroup = (group: Group) => groupAction(() => api("/api/groups/join", { method: "DELETE", body: JSON.stringify({ groupId: group.id }) }), "ออกจากก๊วนแล้ว");
  const closeGroup = async (group: Group) => {
    // A closed group has no page any more: go back to the sport's groups.
    if (await groupAction(() => api(`/api/groups?id=${group.id}`, { method: "DELETE" }), "ปิดก๊วนแล้ว") && screen === "groupdetail") backToSportGroups(group.sportSlug);
  };

  async function cancelBooking(booking: Booking) {
    const no = bookingNo(booking);
    if (!no || busy) return;
    setBusy(true);
    try {
      await api("/api/bookings", { method: "DELETE", body: JSON.stringify({ bookingNo: no, reason: "member cancelled from app" }) });
      await refresh();
      setCancelTarget(null);
      notice("ยกเลิกรายการจองแล้ว");
    } catch (error) {
      notice((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function askLogout() {
    if (busy) return;
    setConfirmRequest({ title: t("ออกจากระบบ?"), message: t("เปิดแอปจากแชต LINE ของ PPA Power Play เพื่อเข้าสู่ระบบอีกครั้ง"), confirmLabel: t("ออกจากระบบ"), cancelLabel: t("ยกเลิก"), danger: true, onConfirm: () => void logout() });
  }

  async function logout() {
    if (busy) return;
    setBusy(true);
    try {
      await api("/api/auth/line", { method: "DELETE" });
      clearMemberCache();
      memberKey.current = "";
      savedShown.current = false;
      setFromCache(false);
      setLineBlocked(true);
      setData(null);
      setPendingBooking(null);
      setCancelTarget(null);
      setSelectedSlot(null);
      setSlots([]);
    } catch (error) {
      notice((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function openSupport(kind: "tel" | "mail" | "line") {
    if (kind === "tel") {
      window.location.href = telHref(contact.phone);
      notice(t("📞 กำลังโทร {{value0}}", { value0: contact.phone }));
      return;
    }
    if (kind === "mail") {
      window.location.href = `mailto:${contact.email}?subject=PPA%20Support`;
      notice(t("✉️ เปิดอีเมลถึง {{value0}}", { value0: contact.email }));
      return;
    }
    window.location.href = contact.lineUrl;
    notice(t("💬 เปิด LINE {{value0}}", { value0: contact.line }));
  }

  async function acceptPolicy() {
    if (!policy || busy) return;
    setBusy(true);
    try {
      const consent = await api<{ acceptedAt: string; version: string }>("/api/consent", { method: "POST", body: JSON.stringify({ version: policy.version }) });
      setData((current) => (current ? { ...current, consent } : current));
      notice("ขอบคุณที่ยอมรับนโยบายความเป็นส่วนตัว");
    } catch (error) {
      notice((error as Error).message);
      // The policy may have been updated while it was open: reload to show the current version.
      await refresh().catch(() => {});
    } finally {
      setBusy(false);
    }
  }

  if (lineBlocked) {
    return <LineGate blocked liffId={process.env.NEXT_PUBLIC_LINE_LIFF_ID || ""} />;
  }

  if (!data) {
    if (!loadError) return <MemberLoading />;
    return (
      <main className="phone-wrap">
        <LineGate embedded error onRetry={() => { setLoadError(false); refresh().catch(() => setLoadError(true)); }} />
      </main>
    );
  }

  const isUpcoming = (booking: Booking) => upcomingBooking(booking, now);
  const upcomingBookings = data.bookings.filter(isUpcoming).sort((a, b) => new Date(a.startsAt || a.starts_at || "").getTime() - new Date(b.startsAt || b.starts_at || "").getTime());
  const historyBookings = data.bookings.filter((booking) => !isUpcoming(booking)).sort((a, b) => new Date(b.startsAt || b.starts_at || "").getTime() - new Date(a.startsAt || a.starts_at || "").getTime());
  const myTrainer = data.trainers.find((trainer) => trainer.slug === myTrainerSlug);
  const activeMembership = data.memberships.find((membership) => membership.status === "active" && new Date(membership.startsAt).getTime() <= now && new Date(membership.endsAt).getTime() > now) || null;
  // Active Member (แก้ 11): a package or time pass in force. The server checks the class time itself.
  const activeMember = Boolean(activeMembership) || data.entitlements.some((right) => right.entitlementType === "time_pass" && right.status === "active" && (!right.endsAt || wallClockTime(right.endsAt) > now));
  const membershipExpiry = activeMembership ? new Date(activeMembership.endsAt).toLocaleDateString(localeTag(), { day: "numeric", month: "short", year: "numeric" }) : "ยังไม่มีแพ็กเกจ";
  const activeCouponTab = couponTab ?? (data.coupons.length || data.expiredCoupons.length ? "mine" : "buy");
  const otherCoupons = couponStore.filter((coupon) => parseMeta(coupon.metadata).tab !== "coupon");
  const selectedTrainerSchedule = selectedTrainer ? trainerSchedule(selectedTrainer) : [];
  // Quick Booking: the sports this member books most often first (as the guide says).
  const quickSports = sportsByUse(data.sports.filter((sport) => sport.requiresBooking), data.bookings);
  const guide = guideSteps((liveFeed?.sports || []).map((sport) => t(sport.name)));
  // สแกน opens on เมมเบอร์ when the member has a package or pass in force, else on คูปอง when they have one.
  const hasMemberRight = Boolean(activeMembership) || data.entitlements.some((right) => right.entitlementType === "time_pass");
  const activeScanTab: ScanTab = scanTab ?? (!hasMemberRight && data.coupons.length ? "coupon" : "member");
  const activeTrainerDay = selectedTrainerSchedule[Math.min(trainerDayIndex, Math.max(selectedTrainerSchedule.length - 1, 0))];

  return (
    <main className="phone-wrap">
      <section className="phone">
        {fromCache ? <div className="member-updating"><p className="member-updating-pill" role="status"><Spinner />{t("กำลังอัปเดตข้อมูล")}</p></div> : null}
        <div className="statusbar">
          <span>PPA</span>
          <LanguageSwitcher />
          <button className="status-member-chip" onClick={() => go("profile")}>
            <span>{memberInitial(data.user.displayName)}</span>
            <b>{data.user.displayName || t("PPA Member")}</b>
            <i />
          </button>
        </div>
        <div className="content">
          {screen === "splash" && (
            <div className="page centered splash">
              <div className="brand">PPA<span>.</span></div>
              <p>Power Play Asia Sport Complex</p>
              <button className="primary" onClick={() => go("home")}>{t("🚀 เลื่อนเพื่อเริ่มต้น")}</button>
            </div>
          )}

          {screen === "login" && (
            <div className="page centered">
              <div className="brand">PPA<span>.</span></div>
              <p>{t("เข้าสู่ระบบสมาชิกเพื่อจองและใช้งาน QR เข้าใช้บริการ")}</p>
              <button className="primary" onClick={() => go("home")}>{t("💬 Continue with LINE")}</button>
              <button className="ghost" onClick={() => go("home")}>{t("👤 ใช้งานแบบสมาชิกเดโม")}</button>
            </div>
          )}

          {screen === "home" && (
            <div className="page home-page">
              <header className="greet">
                <div className="greet-copy"><div className="g1">{t("สวัสดี")}</div><div className="g2">{data.user.displayName || t("PPA Member")}</div><h1 className="home-brand">PPA Sport Complex</h1></div>
                <button className="home-bubble reward" onClick={() => go("reward")}><span aria-hidden="true">🪙</span><small>{t("แลกรางวัล")}</small></button>
                <button className="home-bubble level" onClick={() => go("mystatus")}><span aria-hidden="true">{data.user.avatar || "💪"}</span><small>{t("ระดับ")}</small></button>
              </header>

              <button className="member-card premium-card" onClick={() => go("membership")}>
                <div><span className="m1">{activeMembership ? t("Premium Member") : t("สมาชิก PPA")}</span><small className="m2">{activeMembership ? t("ใช้ได้ถึง {{value0}}", { value0: membershipExpiry }) : t("เลือกแพ็กเกจเพื่อเปิดสิทธิ์สมาชิก")}</small></div>
                <span className="mini-qr" aria-hidden="true"><QrCode size={40} /></span>
              </button>

              <HomeCarousel items={managedSlides} onOpen={go} />

              <BigScreenBanner programs={screenPrograms} now={now} onOpen={() => go("livetv")} />

              <FindYourGameRow feed={liveFeed} onOpen={openGame} onAll={() => go("groups")} />

              <div className="sec-head"><strong>{t("Quick Booking")}</strong></div>
              <div className="quick-booking-row">
                {quickSports.map((sport) => <button key={sport.slug} onClick={() => pickSport(sport)}><span aria-hidden="true">{sport.icon}</span><small>{t(sport.name)}</small></button>)}
              </div>
              {!data.sports.length && <Empty text={t("ยังไม่มีบริการเปิดให้จอง")} />}

              <div className="sec-head"><strong>{t("กีฬา & บริการ")}</strong></div>
              <button className="gymnos-banner" onClick={() => go("gymnos")}><div><strong>GYMNOS</strong><small>{t("Fitness · Swim · HYROX · Pilates · Airfit · Promotion")}</small></div><span aria-hidden="true">›</span></button>
              <div className="svc-grid">
                {data.sports.slice(0, 8).map((sport) => <button key={sport.slug} onClick={() => pickSport(sport)}><span aria-hidden="true">{sport.icon}</span><div><strong>{t(sport.name)}</strong><small>{t(sport.description)}</small></div></button>)}
              </div>

              <div className="sec-head"><strong>{t("Statistics")}</strong></div>
              <div className="stat-row">
                <div><strong>{upcomingBookings.length}</strong><small>{t("Bookings")}</small></div>
                <div><strong>{data.groups.filter((group) => Number(group.joined) || Number(group.isOwner)).length}</strong><small>{t("Groups")}</small></div>
                <div><strong>{data.coupons.length}</strong><small>{t("Coupons")}</small></div>
              </div>

              <div className="sec-head"><strong>{t("การจองครั้งถัดไป")}</strong><button className="home-text-action" onClick={() => go("mybooking")}>{t("ดูทั้งหมด")}</button></div>
              {upcomingBookings[0] ? <BookingRow now={now} booking={upcomingBookings[0]} onClick={() => openBookingQr(upcomingBookings[0])} /> : <Empty text={t("ยังไม่มีนัดหมายที่กำลังจะมาถึง")} />}
              <div className="sec-head"><strong>{t("บริการเพิ่มเติม")}</strong><button className="club-icon-button" title={t("การแจ้งเตือน")} aria-label={t("การแจ้งเตือน {{value0}} รายการใหม่", { value0: unreadCount })} onClick={() => go("notifications")}><Bell size={20} aria-hidden="true" /></button></div>
              <div className="svc-grid">{serviceShortcuts.map((item) => <button key={item.screen} onClick={() => go(item.screen)}><span aria-hidden="true">{item.icon}</span><div><strong>{t(item.title)}</strong><small>{t(item.text)}</small></div></button>)}</div>
            </div>
          )}

          {screen === "sports" && (
            <div className="page">
              <Top title={t("เลือกกีฬา")} onBack={() => go("home")} />
              <div className="prototype-list">
                {data.sports.map((sport) => (
                  <SportRow
                    key={sport.slug}
                    icon={sport.icon}
                    title={t(sport.name)}
                    text={`${t(sport.description)}${sport.requiresBooking ? t(" · เริ่ม {{value0}} ฿/ชม.", { value0: money(sport.baseRate) }) : t(" · ใช้ได้ทันที")}`}
                    onClick={() => pickSport(sport)}
                  />
                ))}
              </div>
              <SectionTitle title={t("คลาสและบริการเสริม")} />
              <div className="prototype-list">
                {serviceShortcuts.slice(0, 6).map((item) => (
                  <SportRow key={item.title} icon={item.icon} title={t(item.title)} text={t(item.text)} onClick={() => go(item.screen)} />
                ))}
              </div>
            </div>
          )}

          {screen === "courts" && selectedSport && (
            <SportScreen
              key={selectedSport.slug}
              sport={selectedSport}
              sports={data.sports}
              groups={data.groups}
              now={now}
              busy={busy}
              revision={availabilityRevision}
              onBack={() => go("home")}
              onBook={(request) => void bookCourt(request)}
              onJoinRank={askJoinRank}
              onOpenLevel={() => go("mystatus")}
              onCreateGroup={() => openGroupCreate(selectedSport)}
              onGroupRanking={() => openGroupRanking(selectedSport)}
              onOpenGroup={(group) => { setGroupSport(selectedSport); openGroup(group.id); }}
              onRefreshGroups={() => void refreshGroups().catch(() => {})}
              initialTab={sportTab}
              rankFocus={rankFocus}
              onTabChange={(tab) => { setSportTab(tab); if (tab !== "rank") setRankFocus(undefined); }}
            />
          )}

          {screen === "datetime" && (
            <div className="page">
              <Top title={t("วันที่และเวลา")} onBack={() => go("courts")} />
              <Summary sport={selectedSport} slot={selectedSlot} players={players} date={date} />
              <button className="ghost" onClick={() => go("courts")}>{t("เปลี่ยนวัน สนาม หรือเวลา")}</button>
              <label className="field">{t("จำนวนผู้เล่น")}<input type="number" min={1} max={selectedSlot?.capacity || 20} value={players} onChange={(event) => setPlayers(Math.min(selectedSlot?.capacity || 20, Math.max(1, Number(event.target.value))))} /></label>
              {!selectedSport?.requiresBooking && <><SectionTitle title={t("เวลายอดนิยม")} /><div className="chip-grid">
                {timeChoices.map((time) => (
                  <button className={(selectedSlot?.time || selectedTime) === time ? "on" : ""} key={time} onClick={() => setSelectedTime(time)}>{time}</button>
                ))}
              </div></>}
              <button className="primary" disabled={Boolean(selectedSport?.requiresBooking) && (!selectedSlot || slotsLoading)} onClick={() => go("summary")}>{t("🧾 ไปหน้าสรุป")}</button>
            </div>
          )}

          {screen === "summary" && (
            <div className="page with-sticky-bar">
              <Top title={t("สรุปรายการ")} onBack={() => selectedSport?.requiresBooking ? go("courts") : go("sports")} />
              <Summary sport={selectedSport} slot={selectedSlot} players={players} date={date} />
              <div className="secure-note">
                <strong>{t("ตรวจสอบก่อนชำระเงิน")}</strong>
                <small>{t("ระบบจะกันสนามหลังสร้าง booking และ QR จะใช้งานได้เมื่อชำระเงินสำเร็จเท่านั้น")}</small>
              </div>
              <div className="sticky-summary summary-actions">
                <div className="summary-total"><span>{t("ยอดชำระ")}</span><b>{money(selectedSlot?.rate ?? selectedSport?.baseRate ?? 0)} ฿</b></div>
                <button className="primary" disabled={busy || (Boolean(selectedSport?.requiresBooking) && (!selectedSlot || slotsLoading))} onClick={createBooking}>{busy ? <><Spinner />{t("กำลังดำเนินการ…")}</> : t("ยืนยันและชำระเงิน")}</button>
              </div>
            </div>
          )}

          {screen === "payment" && (
            <PaymentScreen
              busy={busy}
              booking={pendingBooking}
              item={pendingItem}
              wallet={data.wallet.balance}
              onBack={() => go(pendingItem?.back || bookingBack || "summary")}
              onPay={askPay}
            />
          )}

          {screen === "paypromptpay" && promptPayNo && <PromptPayScreen key={promptPayNo} paymentNo={promptPayNo} onBack={() => go(pendingItem?.back || (pendingBooking ? bookingBack : null) || "wallet")} onDone={() => { void refresh().catch(() => {}); go("wallet"); }} />}

          {screen === "success" && (
            <div className="page centered">
              <div className="check">{lastPaymentStatus === "paid" ? "✓" : "!"}</div>
              <h2>{lastPaymentStatus === "paid" ? t("สำเร็จแล้ว") : t("รอการยืนยัน")}</h2>
              <p>{lastPaymentStatus === "paid" ? t("รายการถูกบันทึกแล้ว คุณสามารถดูประวัติหรือเปิด QR สำหรับเข้าใช้บริการได้ทันที") : t("ระบบบันทึกรายการแล้ว แต่ยังไม่เปิดสิทธิ์จนกว่าการชำระเงินจะถูกยืนยัน")}</p>
              <button className="primary" onClick={() => go("mybooking")}>{t("📋 ดูรายการของฉัน")}</button>
              {lastPaymentStatus === "paid" && <button className="ghost" onClick={() => go("scan")}>{t("▣ เปิด QR เข้าใช้บริการ")}</button>}
            </div>
          )}

          {screen === "scan" && (
            <ScanHub
              data={data}
              now={now}
              tab={activeScanTab}
              onTab={setScanTab}
              onOpen={(access) => openAccess(access, "scan")}
              onBuyPackage={() => openPlans("monthly", "scan")}
              onBuyCoupon={() => openPlans("coupon", "scan")}
              onVisits={() => go("checkin")}
            />
          )}

          {(screen === "scanqr" || screen === "qr") && <QrPass key={JSON.stringify(accessQr)} access={accessQr} memberCode={data.user.memberCode} onBack={() => go(qrBack)} onBuy={() => openPlans(accessQr.purpose === "coupon" ? "coupon" : "monthly", "scan")} onVisits={() => go("checkin")} />}

          {screen === "checkin" && (
            <VisitsScreen visits={data.visits} onBack={() => go("membership")} onShowQr={() => { setScanTab("member"); go("scan"); }} />
          )}

          {screen === "mybooking" && (
            <div className="page mybooking-page">
              <Top title={t("การจองของฉัน")} />
              <div className="seg booking-seg">
                <button className={bookingTab === "up" ? "on" : ""} onClick={() => setBookingTab("up")}>{t("Upcoming")}</button>
                <button className={bookingTab === "his" ? "on" : ""} onClick={() => setBookingTab("his")}>{t("History")}</button>
              </div>
              <div className="booking-list">
                {(bookingTab === "up" ? upcomingBookings : historyBookings).map((booking, index) => (
                  <BookingRow now={now} key={`${bookingNo(booking)}-${index}`} booking={booking} onCancel={() => setCancelTarget(booking)} onClick={() => openBookingQr(booking)} />
                ))}
                {!(bookingTab === "up" ? upcomingBookings : historyBookings).length && <div className="club-empty"><strong>{bookingTab === "up" ? t("ยังไม่มีรายการจองที่กำลังจะมาถึง") : t("ยังไม่มีประวัติการจอง")}</strong><button onClick={() => go("sports")}>{t("จองสนาม")}</button></div>}
              </div>
            </div>
          )}

          {screen === "gymnos" && <GymnosHub onBack={() => go("home")} onOpen={openFromGymnos} />}

          {screen === "fitness" && (
            <PackagePlansScreen
              tab={fitnessTab}
              page="fitness"
              onTab={setFitnessTab}
              contentItems={appContent}
              couponStore={couponStore}
              data={data}
              now={now}
              busy={busy}
              discount={data.weeklyDiscount}
              onBack={() => go(hubReturn)}
              onSelectContent={(item) => selectPackage(item, "fitness")}
              onBuyCoupon={(coupon) => buyCoupon(coupon, "fitness")}
              onRequestPause={requestPause}
              onRenewCoupon={renewCoupon}
            />
          )}
          {screen === "swim" && (
            <PackagePlansScreen
              tab={swimTab}
              page="swim"
              onTab={setSwimTab}
              contentItems={appContent}
              couponStore={couponStore}
              data={data}
              now={now}
              busy={busy}
              discount={data.weeklyDiscount}
              onBack={() => go(hubReturn)}
              onSelectContent={(item) => selectPackage(item, "swim")}
              onBuyCoupon={(coupon) => buyCoupon(coupon, "swim")}
              onRequestPause={requestPause}
              onRenewCoupon={renewCoupon}
            />
          )}
          {(screen === "hyrox" || screen === "pilates" || screen === "airfit" || screen === "svcclass") && (() => {
            const service: ClassService = screen === "svcclass" ? "service" : screen;
            return (
              <ClassServiceScreen
                key={screen}
                service={service}
                title={screen === "hyrox" ? "HYROX" : screen === "pilates" ? "Pilates" : screen === "airfit" ? "Airfit" : "Service Class"}
                icon={screen === "hyrox" ? "🔥" : screen === "pilates" ? "🤸" : screen === "airfit" ? "🪂" : "🧘"}
                coupons={data.coupons}
                couponStore={couponStore}
                trainers={data.trainers}
                memberships={data.memberships}
                activeMember={activeMember}
                discount={data.weeklyDiscount}
                now={now}
                busy={busy}
                revision={classRevision}
                view={classView(service)}
                onView={(view) => setClassView(service, view)}
                onBack={() => go(hubReturn)}
                onBuyCoupon={(coupon, price) => buyCoupon(coupon, screen, price)}
                onReserve={askReserveClass}
                onPickTrainer={(program) => openTrainerPicker(service, program)}
                onOpenTimetable={() => go("classschedule")}
                onOpenPlans={() => openPlans("monthly", screen)}
              />
            );
          })()}

          {screen === "promotion" && (
            <PromotionScreen
              items={appContent}
              onBack={() => go(hubReturn)}
              onClaimed={() => { void refresh().catch(() => {}); void loadCoupons().catch(() => {}); }}
              onOpen={(target) => {
                if (target === "trainer") { setTrainerPick(null); setTrainerDetail(false); go("trainer"); return; }
                if (target === "plans") { openPlans("package", "promotion"); return; }
                go(target as Screen);
              }}
              onBuyMember={buyMemberPackage}
              notice={notice}
            />
          )}
          {screen === "memverify" && <MemberVerifyScreen item={memberBuy} onBack={() => go("promotion")} onVerified={(item) => { setMemberBuy(null); selectPackage(item, "promotion"); }} />}

          {screen === "livetv" && <BigScreenScreen programs={screenPrograms} now={now} onBack={() => go("home")} />}

          {screen === "wallet" && (
            <div className="page">
              <Top title={t("กระเป๋าเงิน")} onBack={() => go("profile")} />
              <BigBalance label={t("ยอดเงินคงเหลือ")} value={`${money(data.wallet.balance)}`} unit="฿" />
              <button type="button" className="renew-link" onClick={() => go("buyhistory")}><span aria-hidden="true">🧾</span><b>{t("ประวัติธุรกรรมทั้งหมด")}</b><i aria-hidden="true">›</i></button>
              <WalletPanel coinBalance={data.wallet.coinBalance} pointBalance={data.wallet.pointBalance} ledger={data.walletLedger} pending={data.pendingPayments} promptPayEnabled={data.promptPayEnabled ?? true} busy={busy} onTopup={topup} onPayPending={(paymentNo) => { setPromptPayNo(paymentNo); go("paypromptpay"); }} onCancelPending={askCancelPending} />
            </div>
          )}

          {screen === "coupon" && (
            <div className="page">
              <Top title={t("คูปอง")} onBack={() => go("home")} />
              <div className="plan-tabs" role="tablist" aria-label={t("คูปอง")}>
                <button type="button" role="tab" aria-selected={activeCouponTab === "mine"} className={activeCouponTab === "mine" ? "on" : ""} onClick={() => setCouponTab("mine")}>{t("คูปองของฉัน")}</button>
                <button type="button" role="tab" aria-selected={activeCouponTab === "buy"} className={activeCouponTab === "buy" ? "on" : ""} onClick={() => setCouponTab("buy")}>{t("ซื้อคูปอง")}</button>
              </div>
              {activeCouponTab === "mine" ? (
                <MyCouponList coupons={data.coupons} expiredCoupons={data.expiredCoupons} now={now} onOpenQr={openCouponQr} onRenew={(coupon) => openRenewCoupon(coupon)} onBuy={() => setCouponTab("buy")} />
              ) : (
                <>
                  <h2 className="plans-subtitle">{t("คูปอง (Fitness)")}</h2>
                  <div className="share-note">{t("🤝 คูปอง 1 ใบ สามารถแชร์ให้เพื่อนได้ 1 คน")}</div>
                  <CouponCards coupons={couponStore} discount={data.weeklyDiscount?.scope.includes("fitness") ? data.weeklyDiscount : null} onBuy={(coupon) => buyCoupon(coupon, "coupon")} />
                  <CouponUsageInfo coupons={couponStore} renewalPrice={Number(appContent.find((item) => item.contentType === "renewal_option" && parseMeta(item.metadata).kind === "coupon_renewal")?.price) || undefined} />
                  {otherCoupons.length ? (
                    <>
                      <SectionTitle title={t("คูปองอื่น ๆ")} />
                      <div className="coupon-list">
                        {otherCoupons.map((coupon) => <CouponRow key={coupon.id} coupon={coupon} onClick={() => buyCoupon(coupon, "coupon")} />)}
                      </div>
                    </>
                  ) : null}
                </>
              )}
            </div>
          )}

          {screen === "mycoupons" && (
            <div className="page mycoupons-page">
              <Top title={t("คูปองของฉัน")} icon="🎟️" onBack={() => go("membership")} />
              <MyCouponList coupons={data.coupons} expiredCoupons={data.expiredCoupons} now={now} onOpenQr={openCouponQr} onRenew={(coupon) => openRenewCoupon(coupon, "mycoupons")} onBuy={() => openPlans("coupon", "mycoupons")} />
            </div>
          )}

          {screen === "reward" && (
            <RewardsScreen
              coinBalance={data.wallet.coinBalance}
              rewards={contentByType(appContent, "reward")}
              myRewards={data.entitlements.filter((item) => item.entitlementType === "reward")}
              busy={busy}
              onBack={() => go("home")}
              onRedeem={askRedeem}
              onOpenQr={(right) => openAccess({ purpose: "entitlement", entitlementId: right.id, title: right.title, detail: t("ยื่น QR นี้ให้เจ้าหน้าที่ที่เคาน์เตอร์เพื่อรับรางวัล") })}
            />
          )}

          {screen === "membership" && (
            <div className="page">
              <Top title={t("สมาชิกของฉัน")} onBack={() => go("home")} />
              <button className="member-card premium-card" onClick={() => (activeMembership ? openAccess({ purpose: "member", membershipId: Number(activeMembership.id), title: activeMembership.planName, detail: t("ใช้ได้ถึง {{value0}}", { value0: membershipExpiry }) }) : go("scan"))}>
                <div>
                  <span>{t(activeMembership?.planName) || t("PPA MEMBER")}</span>
                  <strong>{data.user.memberCode}</strong>
                  <small>{data.user.displayName || t("PPA Member")} · {activeMembership ? t("Active ถึง {{value0}}", { value0: membershipExpiry }) : t("ยังไม่มีแพ็กเกจ active")}</small>
                </div>
                <span className="member-qr-link"><QrCode size={28} aria-hidden="true" /><small>{t("เปิด QR")}</small></span>
              </button>
              <div className="prototype-list">
                <MenuItem icon="📦" title={t("แพ็กเกจของฉัน")} onClick={() => openPlans("monthly", "membership")} />
                <MenuItem icon="🧾" title={t("ประวัติการซื้อ")} onClick={() => go("buyhistory")} />
                <MenuItem icon="🚪" title={t("การเข้าใช้บริการ")} onClick={() => go("checkin")} />
                <MenuItem icon="🎟️" title={t("คูปองของฉัน")} onClick={() => go("mycoupons")} />
                <MenuItem icon="⭐" title={t("คะแนนสะสม")} onClick={() => go("reward")} />
              </div>
              <SectionTitle title={t("สิทธิ์ที่ใช้งานได้")} />
              <div className="prototype-list">
                {data.entitlements.length ? data.entitlements.slice(0, 6).map((item) => (
                  <MenuItem
                    key={item.id}
                    icon="🎫"
                    title={t(item.title)}
                    meta={t("{{value0}}{{value1}}{{value2}} · เปิด QR", { value0: t(entitlementLabel(item.entitlementType)), value1: item.remainingUses ? t(" · เหลือ {{value0}}", { value0: item.remainingUses }) : "", value2: item.endsAt ? t(" · ถึง {{value0}}", { value0: new Date(item.endsAt).toLocaleDateString(localeTag()) }) : "" })}
                    onClick={() => openAccess({ purpose: "entitlement", entitlementId: item.id, title: item.title })}
                  />
                )) : <Empty text={t("ยังไม่มีสิทธิ์แพ็กเกจ")} />}
              </div>
            </div>
          )}

          {screen === "plans" && (
            <PackagePlansScreen
              variant="choose"
              tab={planTab}
              discount={data.weeklyDiscount}
              onTab={setPlanTab}
              contentItems={appContent}
              couponStore={couponStore}
              data={data}
              now={now}
              busy={busy}
              onBack={() => go(plansReturn)}
              onSelectContent={selectPackage}
              onBuyCoupon={(coupon) => buyCoupon(coupon, "plans")}
              onRequestPause={requestPause}
              onRenewCoupon={renewCoupon}
              renewFocus={renewFocus}
            />
          )}

          {screen === "trainer" && (
            <div className="page trainer-page">
              {trainerPick ? (
                <>
                  <Top title={t("เลือกผู้สอน")} icon="🧑‍🏫" onBack={() => { const back = trainerPick.service === "service" ? "svcclass" : trainerPick.service; setTrainerPick(null); go(back); }} />
                  <div className="trainer-pick-note">{t("เลือกผู้สอนสำหรับ {{value0}}", { value0: t(trainerPick.program.title) })}<small>{t("แตะชื่อผู้สอน แล้วระบบจะพากลับไปเลือกวันและเวลา")}</small></div>
                  <div className="prototype-list">
                    {trainersFor(trainerPick.program, data.trainers).map((trainer) => (
                      <button className={classView(trainerPick.service).trainers?.[trainerPick.program.slug] === trainer.id ? "trainer-list-card on" : "trainer-list-card"} key={trainer.slug} onClick={() => pickTrainer(trainer)}>
                        <TrainerAvatar trainer={trainer} />
                        <span><b>{trainer.name} ({trainer.nickname})</b><small>{t(trainer.role)} · {t("ประสบการณ์ {{value0}}", { value0: t(trainer.experience) })}</small></span>
                      </button>
                    ))}
                  </div>
                  {!data.trainers.length ? <Empty text={t("ยังไม่มีผู้สอนในระบบ")} /> : null}
                </>
              ) : !trainerDetail ? (
                <>
                  <Top title={t("เทรนเนอร์")} icon="🧑‍🏫" />
                  <div className="reward-label">{t("เทรนเนอร์ประจำของฉัน")}</div>
                  {myTrainer ? (
                    <button className="my-trainer-card" onClick={() => { setSelectedTrainer(myTrainer); setTrainerDetail(true); }}>
                      <TrainerAvatar trainer={myTrainer} className="my-trainer-ava" />
                      <span className="my-trainer-info"><b>{myTrainer.name}</b><small>{t(myTrainer.role)} · {myTrainer.nickname}</small></span>
                      <em>{t("ประจำ")}</em>
                      <i onClick={(event) => { event.stopPropagation(); setMyTrainerSlug(""); notice("ยกเลิกเทรนเนอร์ประจำแล้ว"); }}>×</i>
                    </button>
                  ) : (
                    <div className="trainer-empty">
                      <div>🧑‍🏫</div>
                      <b>{t("ยังไม่มีเทรนเนอร์ประจำ")}</b>
                      <small>{t("เลือกเทรนเนอร์ที่ต้องการจากรายชื่อด้านล่าง")}</small>
                    </div>
                  )}
                  <div className="sec-head"><strong>{t("เลือกเทรนเนอร์")}</strong></div>
                  <div className="prototype-list">
                    {data.trainers.map((trainer) => (
                      <button
                        className="trainer-list-card"
                        key={trainer.slug}
                        onClick={() => { setSelectedTrainer(trainer); setTrainerDetail(true); setTrainerContactOpen(false); setTrainerPlanIndex(null); setTrainerDayIndex(0); }}
                      >
                        <TrainerAvatar trainer={trainer} />
                        <span><b>{trainer.name} ({trainer.nickname})</b><small>{t(trainer.role)} · {trainerSpecialties(trainer).slice(0, 2).join(" · ") || t("ประสบการณ์ {{value0}}", { value0: t(trainer.experience) })} {t("· เริ่มต้น")} {money(trainer.startPrice)} ฿</small></span>
                      </button>
                    ))}
                  </div>
                </>
              ) : selectedTrainer && (
                <>
                  <Top title={t("โปรไฟล์เทรนเนอร์")} onBack={() => setTrainerDetail(false)} />
                  <div className="trainer-hero">
                    <TrainerAvatar trainer={selectedTrainer} className="trainer-ava" />
                    <div>
                      <b>{selectedTrainer.name}</b>
                      <div>{t("ชื่อเล่น:")} {selectedTrainer.nickname} · {t(selectedTrainer.role)}</div>
                    </div>
                  </div>
                  <div className="trainer-stats">
                    <div><b>{t(selectedTrainer.experience)}</b><small>{t("ประสบการณ์")}</small></div>
                    <div><b>{selectedTrainer.zodiac || "-"}</b><small>{t("ราศี · เกิด")} {selectedTrainer.birthYear || "-"}</small></div>
                    <div><b>{selectedTrainer.bloodType || "-"}</b><small>{t("กรุ๊ปเลือด")}</small></div>
                  </div>
                  {t(selectedTrainer.bio) ? <p className="trainer-bio">{t(selectedTrainer.bio)}</p> : null}
                  {trainerSpecialties(selectedTrainer).length ? (
                    <div className="trainer-specialties">
                      {trainerSpecialties(selectedTrainer).map((item) => <span key={item}>{item}</span>)}
                    </div>
                  ) : null}
                  <div className="cert-card">
                    <div className="reward-label">{t("สถาบันที่มีเกียรติบัตร")}</div>
                    <ul>
                      {trainerCerts(selectedTrainer).map((cert) => <li key={cert}>{cert}</li>)}
                    </ul>
                  </div>
                  <button
                    className={myTrainerSlug === selectedTrainer.slug ? "ghost trainer-set danger" : "ghost trainer-set"}
                    onClick={() => {
                      const isMine = myTrainerSlug === selectedTrainer.slug;
                      setMyTrainerSlug(isMine ? "" : selectedTrainer.slug);
                      notice(t(isMine ? "ยกเลิก {{value0}} จากเทรนเนอร์ประจำแล้ว" : "ตั้ง {{value0}} เป็นเทรนเนอร์ประจำแล้ว", { value0: selectedTrainer.name }));
                    }}
                  >
                    {myTrainerSlug === selectedTrainer.slug ? t("✕ ยกเลิกเทรนเนอร์ประจำ") : t("ตั้งเป็นเทรนเนอร์ประจำ")}
                  </button>
                  <button className="primary green" onClick={() => setTrainerContactOpen((open) => !open)}>{t("📞 ติดต่อแอดมิน")}</button>
                  {trainerContactOpen && (
                    <div className="trainer-contact-card">
                      <span>{t("เบอร์ติดต่อแอดมิน PPA Power Play")}</span>
                      <b>{selectedTrainer.contactPhone || "02-123-4567"}</b>
                      <p>{selectedTrainer.socialLine ? `LINE: ${selectedTrainer.socialLine} · ` : ""}{t("แจ้งชื่อเทรนเนอร์ที่สนใจกับแอดมิน เพื่อสอบถามแพ็กเกจและนัดเวลาเทรน")}</p>
                    </div>
                  )}
                  <div className="sec-head"><strong>{t("แพ็กเกจเทรนส่วนตัว")}</strong></div>
                  <div className="fit-list">
                    {trainerPlans(selectedTrainer).map((plan, index) => (
                      <button
                        className={trainerPlanIndex === index ? "fit-item-ui sel-pkg" : "fit-item-ui"}
                        key={plan.title}
                        onClick={() => { setTrainerPlanIndex(index); notice(t("เลือกแพ็กเกจ {{value0}} แล้ว - เลือกเวลาที่ว่างด้านล่าง", { value0: t(plan.title) })); }}
                      >
                        <div><b>{t(plan.title)}</b><small>{t(plan.text)}</small></div>
                        <strong>{money(plan.price)} ฿</strong>
                      </button>
                    ))}
                  </div>
                  <div className="sec-head"><strong>{t("ตารางว่าง")}</strong></div>
                  {!selectedTrainerSchedule.length && <Empty text={t("เทรนเนอร์ยังไม่ได้ประกาศตารางว่าง")} />}
                  <div className="trainer-day-strip">
                    {selectedTrainerSchedule.map((item, index) => (
                      <button className={trainerDayIndex === index ? "on" : ""} key={item.day} onClick={() => setTrainerDayIndex(index)}>
                        <small>{t(item.day)}</small><b>{item.date || "-"}</b>
                      </button>
                    ))}
                  </div>
                  <div className="trainer-slot-grid">
                    {(activeTrainerDay?.slots || []).map((slot) => {
                      const full = slot.status !== "available";
                      return (
                        <button
                          className={full ? "full" : ""}
                          disabled={full}
                          key={`${activeTrainerDay?.day}-${slot.time}`}
                          onClick={() => {
                            if (trainerPlanIndex === null) {
                              notice("กรุณาเลือกแพ็กเกจก่อน");
                              return;
                            }
                            const plan = trainerPlans(selectedTrainer)[trainerPlanIndex];
                            startCheckout({ item: { trainerId: selectedTrainer.id, trainerPackage: plan.title, title: `PT ${selectedTrainer.name} · ${activeTrainerDay?.day || ""} ${slot.time} · ${plan.title}`, amount: plan.price, back: "trainer", save: "class", itemType: "trainer" } });
                          }}
                        >
                          {slot.time}<small>{full ? t("ไม่ว่าง") : t("ว่าง")}</small>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          )}

          {screen === "groups" && (
            <FindYourGameScreen
              feed={liveFeed}
              groups={data.groups}
              sports={data.sports}
              onBack={() => go("home")}
              onOpenGame={openGame}
              onOpenGroup={(group) => { setGroupSport(sportBySlug(group.sportSlug)); openGroup(group.id); }}
              onOpenSportGroups={(sport) => pickSport(sport, "groups")}
            />
          )}

          {screen === "groupcreate" && groupSport && (
            <GroupCreateScreen
              sport={groupSport}
              me={{ displayName: data.user.displayName, memberCode: data.user.memberCode, level: data.user.avatarTier }}
              busy={busy}
              onBack={() => backToSportGroups(groupSport.slug)}
              onCreate={createGroup}
            />
          )}

          {screen === "groupranking" && groupSport && (
            <GroupRankingScreen sport={groupSport} onBack={() => backToSportGroups(groupSport.slug)} onClaim={openCoinClaim} onOpenGroup={openGroup} />
          )}

          {screen === "groupdetail" && groupId && (
            <GroupDetailScreen
              key={groupId}
              groupId={groupId}
              revision={groupRevision}
              busy={busy}
              onBack={() => (groupBack === "courts" ? backToSportGroups(groupSport?.slug) : go(groupBack))}
              onJoin={(group) => void joinGroup(group)}
              onLeave={askLeaveGroup}
              onClose={askCloseGroup}
              onBook={(slug) => { const sport = sportBySlug(slug); if (sport) pickSport(sport); }}
              notice={notice}
            />
          )}

          {screen === "mystatus" && (
            <MemberStatusScreen
              tier={data.memberTier}
              ratings={data.skillRatings || []}
              tiers={data.skillTiers || []}
              coinBalance={data.wallet.coinBalance}
              pointBalance={data.wallet.pointBalance}
              onBack={() => go("profile")}
              onRewards={() => go("reward")}
              onHistory={() => go("buyhistory")}
              onBuffetRank={() => { const badminton = data.sports.find((sport) => sport.slug === "badminton"); if (badminton) pickSport(badminton); }}
            />
          )}

          {screen === "buyhistory" && <TransactionHistoryScreen onBack={() => go("wallet")} />}

          {screen === "notifications" && (
            <div className="page">
              <Top title={t("การแจ้งเตือน")} onBack={() => go("home")} />
              <div className="noti-list">
                {data.notifications.length ? data.notifications.map((item) => (
                  <NotiRow key={item.id} icon={item.status === "unread" ? "🔔" : "✓"} title={t(item.title)} body={item.body} unread={item.status === "unread"} />
                )) : <Empty text={t("ยังไม่มีแจ้งเตือน")} />}
              </div>
            </div>
          )}

          {screen === "noti" && (
            <div className="page">
              <Top title={t("การแจ้งเตือน")} onBack={() => go("home")} />
              <div className="noti-list">
                {data.notifications.length ? data.notifications.map((item) => (
                  <NotiRow key={item.id} icon={item.status === "unread" ? "🔔" : "✓"} title={t(item.title)} body={item.body} unread={item.status === "unread"} />
                )) : <Empty text={t("ยังไม่มีแจ้งเตือน")} />}
              </div>
            </div>
          )}

          {managedPrototypeScreens.includes(screen) && !["classhub", "classschedule", "qr", "scanqr"].includes(screen) && (
            <ManagedFeatureScreen
              items={contentForScreen(appContent, screen)}
              onBack={() => go("home")}
              onBuy={(item) => {
                if (item.price > 0) {
                  startCheckout({ item: { contentId: item.id, title: item.title, amount: Number(item.price), back: screen, save: "class", itemType: String(contentMeta(item).itemType || item.contentType || "class") } });
                  return;
                }
                if (item.targetScreen) go(item.targetScreen as Screen);
              }}
              screen={screen}
            />
          )}

          {screen === "classhub" && (
            <ManagedFeatureScreen
              items={contentByType(appContent, "service_package")}
              onBack={() => go("home")}
              onBuy={(item) => startCheckout({ item: { contentId: item.id, title: item.title, amount: Number(item.price), back: "classhub", save: "class", itemType: String(contentMeta(item).itemType || item.contentType || "class") } })}
              screen="classhub"
            />
          )}

          {screen === "classschedule" && <TimetableScreen onBack={() => go("svcclass")} onOpen={openFromTimetable} />}

          {screen === "profile" && (
            <div className="page">
              <Top title={t("โปรไฟล์")} />
              <div className="profile-head">
                <div className="avatar profile-avatar" aria-hidden="true">{data.user.avatar || memberInitial(data.user.displayName)}</div>
                <h2 className="profile-name">{data.user.displayName}</h2>
                <small>{t(activeMembership?.planName) || t("สมาชิก PPA")}</small>
                <em>{t("MEMBER ID ·")} {data.user.memberCode}</em>
              </div>
              <div className="prototype-list">
                <MenuItem icon="👛" title={t("กระเป๋าเงิน & การชำระเงิน")} onClick={() => go("wallet")} />
                <MenuItem icon="💎" title={t("ระดับสมาชิก & ฝีมือ")} meta={data.memberTier ? t(data.memberTier.name) : undefined} onClick={() => go("mystatus")} />
                <MenuItem icon="🧾" title={t("ประวัติธุรกรรม")} onClick={() => go("buyhistory")} />
                <MenuItem icon="🎖️" title={t("สมาชิกและแพ็กเกจ")} onClick={() => go("membership")} />
                <MenuItem icon="🪙" title={t("แลกรางวัล")} meta={t("{{value0}} Coin", { value0: money(data.wallet.coinBalance) })} onClick={() => go("reward")} />
                <MenuItem icon="📅" title={t("การจองของฉัน")} onClick={() => go("mybooking")} />
                <MenuItem icon="🎓" title={t("คู่มือการใช้งาน")} meta={t("10 ขั้น · Buffet Rank · ก๊วน · Coin")} onClick={openGuide} />
                <MenuItem icon="🔔" title={t("การแจ้งเตือน")} onClick={() => go("notifications")} />
                <MenuItem icon="❓" title={t("ช่วยเหลือ & ติดต่อเรา")} onClick={() => go("help")} />
                <MenuItem icon="🚪" title={t("ออกจากระบบ")} onClick={askLogout} />
              </div>
            </div>
          )}

          {screen === "help" && (
            <div className="page help-page">
              <Top title={t("ช่วยเหลือ & ติดต่อเรา")} icon="❓" onBack={() => go("profile")} />
              <div className="prototype-list">
                <MenuItem icon="📞" title={t("โทรหาเรา")} meta={`${contact.phone} · ${contact.hours}`} onClick={() => openSupport("tel")} />
                <MenuItem icon="✉️" title={t("อีเมล")} meta={contact.email} onClick={() => openSupport("mail")} />
                <MenuItem icon="🎓" title={t("คู่มือการใช้งาน")} meta={t("จอง · ก๊วน · เหรียญ")} onClick={openGuide} />
                <MenuItem icon="💬" title={t("LINE Official")} meta={contact.line} onClick={() => openSupport("line")} />
                {policy ? <MenuItem icon="🔒" title={t("นโยบายความเป็นส่วนตัว")} meta={data.consent?.version === policy.version ? t("ยอมรับแล้ว · ฉบับ {{value0}}", { value0: policy.version }) : t("ฉบับ {{value0}}", { value0: policy.version })} onClick={() => setPolicyOpen(true)} /> : null}
              </div>
              <div className="help-info">
                <b>PPA Power Play Sport Club</b>
                <small>{t("เวลาทำการ {{value0}}", { value0: contact.hours })}</small>
              </div>
              <div className="help-faq">
                <div className="reward-label">{t("คำถามที่พบบ่อย")}</div>
                <details>
                  <summary>{t("QR เข้าใช้บริการหมดอายุทำอย่างไร?")}</summary>
                  <p>{t("เปิดหน้า Scan ใหม่ ระบบจะสร้าง QR อายุ 20 วินาทีเพื่อป้องกันการแชร์ต่อ")}</p>
                </details>
                <details>
                  <summary>{t("จองแล้วต้องชำระภายในกี่นาที?")}</summary>
                  <p>{t("ระบบกันสนามไว้ 15 นาที หากไม่ชำระเงิน รายการจะหมดอายุอัตโนมัติ")}</p>
                </details>
                <details>
                  <summary>{t("ต้องการเปลี่ยนรอบหรือยกเลิกติดต่อที่ไหน?")}</summary>
                  <p>{t("ติดต่อ LINE Official หรือโทรหาแอดมิน พร้อมแจ้งเลข booking ในหน้าประวัติ")}</p>
                </details>
              </div>
            </div>
          )}

          {screen === "admin" && (
            <div className="page">
              <Top title={t("Admin")} onBack={() => go("profile")} />
              <div className="admin-grid">
                <Stat label={t("Bookings")} value={data.bookings.length} />
                <Stat label={t("Coupons")} value={data.coupons.length} />
                <Stat label={t("Groups")} value={data.groups.length} />
                <Stat label={t("Unread")} value={unreadCount} />
              </div>
              <div className="secure-note"><strong>{t("Read-only operation panel")}</strong><small>{t("หน้านี้แสดงภาพรวมใน client เท่านั้น งานจัดการจริงควรทำผ่าน backend role-based access control")}</small></div>
              <button className="primary" disabled={busy} onClick={() => refresh().then(() => notice("อัปเดตข้อมูลแล้ว"))}>{t("↻ Refresh data")}</button>
            </div>
          )}
        </div>
        <nav className="tabbar" id="tabbar" aria-label={t("เมนูหลัก")}>
          {tabs.map(([id, icon, label]) => (
            <button className={(screen === "scanqr" ? "scan" : screen) === id ? "on" : ""} aria-current={(screen === "scanqr" ? "scan" : screen) === id ? "page" : undefined} key={id} onClick={() => { if (id === "trainer") { setTrainerDetail(false); setTrainerPick(null); } if (id === "scan") setScanTab(null); go(id); }}>
              <TabBarIcon name={icon} />
              <span>{t(label)}</span>
            </button>
          ))}
        </nav>
        {confirmRequest && <ConfirmDialog request={confirmRequest} onClose={() => setConfirmRequest(null)} />}
        {cancelTarget && <AdminDialog onClose={() => { if (!busy) setCancelTarget(null); }}><section className="member-confirm"><h2>{t("ยกเลิกการจองนี้?")}</h2><p>{t(cancelTarget.title)}</p><small>{t("รายการที่ชำระแล้ว กรุณาติดต่อเจ้าหน้าที่เพื่อตรวจสอบเงื่อนไขการคืนเงิน")}</small><div><button className="ghost" disabled={busy} onClick={() => setCancelTarget(null)}>{t("เก็บการจองไว้")}</button><button className="danger-action" disabled={busy} onClick={() => cancelBooking(cancelTarget)}>{busy ? t("กำลังยกเลิก…") : t("ยืนยันยกเลิก")}</button></div></section></AdminDialog>}
        {tutorial > 0 && (
          <MemberGuide
            steps={guide}
            step={tutorial}
            onNext={() => (tutorial >= guide.length ? closeGuide() : setTutorial(tutorial + 1))}
            onSkip={closeGuide}
            onSwiped={() => { notice("👏 เก่งมาก! ปัดซ้ายเป็นแล้ว"); setTutorial(Math.min(guide.length, tutorial + 1)); }}
          />
        )}
        {policy && (consentDue || policyOpen) ? <PrivacyPolicyDialog policy={policy} contact={contact} busy={busy} onAccept={consentDue ? acceptPolicy : undefined} onClose={consentDue ? undefined : () => setPolicyOpen(false)} /> : null}
        {t(toast) && <div className="toast" role="status" aria-live="polite">{t(toast)}</div>}
      </section>
    </main>
  );
}

// Opened outside LINE, or the first load failed: one calm page with the one action that helps.
function LineGate({ blocked = false, embedded = false, liffId = "", error = false, onRetry }: { blocked?: boolean; embedded?: boolean; liffId?: string; error?: boolean; onRetry?: () => void }) {
  const openUrl = liffId ? `https://liff.line.me/${liffId}` : "";
  return (
    <main className={embedded ? "phone line-gate embedded" : "line-gate"}>
      <div className="gate-language"><LanguageSwitcher /></div>
      <section className="member-gate">
        <div className="member-gate-logo">PPA<span>.</span></div>
        <h1>{error ? t("โหลดข้อมูลไม่สำเร็จ") : t("เปิดผ่าน LINE เพื่อเข้าสู่ระบบสมาชิก")}</h1>
        <p>{error ? t("ตรวจสอบการเชื่อมต่ออินเทอร์เน็ต แล้วลองอีกครั้ง") : t("แอปสมาชิกเปิดจากแชต LINE ของ PPA Power Play เพื่อยืนยันตัวตนและแสดงข้อมูลของคุณ")}</p>
        {error ? <button type="button" className="primary" onClick={onRetry}>{t("ลองอีกครั้ง")}</button> : null}
        {blocked && openUrl ? <a className="primary" href={openUrl}>{t("เปิดใน LINE")}</a> : null}
        {blocked ? <small>{t("ถ้าเปิดจากเมนูในแชตแล้วยังเห็นหน้านี้ ให้ปิดหน้านี้แล้วเปิดจากแชต PPA Power Play อีกครั้ง")}</small> : null}
      </section>
    </main>
  );
}

// First open, while LINE signs the member in and their data loads: the app frame (status bar and
// tab bar) with blocks shaped like the home screen. The status is announced once, nothing spins.
function MemberLoading() {
  return (
    <main className="phone-wrap">
      <section className="phone member-loading" aria-busy="true">
        <div className="statusbar">
          <span>PPA</span>
          <LanguageSwitcher />
          <i className="sk sk-chip" aria-hidden="true" />
        </div>
        <div className="member-loading-body" aria-hidden="true">
          <i className="sk sk-line" />
          <i className="sk sk-line title" />
          <i className="sk sk-card member" />
          <i className="sk sk-card slide" />
          <div className="sk-row"><i className="sk sk-tile" /><i className="sk sk-tile" /><i className="sk sk-tile" /></div>
          <i className="sk sk-line" />
          <div className="sk-row"><i className="sk sk-card game" /><i className="sk sk-card game" /><i className="sk sk-card game" /></div>
        </div>
        <LoadingNote className="member-loading-status" text={t("กำลังโหลดข้อมูลสมาชิก")} />
        <nav className="tabbar member-loading-tabs" aria-hidden="true">
          {tabs.map(([id, icon, label]) => <span className={id === "home" ? "on" : ""} key={id}><TabBarIcon name={icon} /><span>{t(label)}</span></span>)}
        </nav>
      </section>
    </main>
  );
}

function TabBarIcon({ name }: { name: TabIcon }) {
  const Icon = { home: House, trainer: Dumbbell, scan: QrCode, history: CalendarDays, profile: UserRound }[name];
  return <Icon size={24} strokeWidth={1.8} aria-hidden="true" />;
}

function SportRow({ icon, title, text, onClick }: { icon: string; title: string; text?: string; onClick?: () => void }) {
  return (
    <button className="sport-row-ui" onClick={onClick}>
      <span className="si">{icon}</span>
      <div>
        <b>{t(title)}</b>
        {t(text) && <small>{t(text)}</small>}
      </div>
      <span className="chev">›</span>
    </button>
  );
}

function MenuItem({ icon, title, meta, onClick }: { icon: string; title: string; meta?: string; onClick?: () => void }) {
  return (
    <button className="menu-item-ui" onClick={onClick}>
      <span className="mi">{icon}</span>
      <span className="menu-title">{t(title)}</span>
      {t(meta) && <small>{t(meta)}</small>}
      <span className="chev">›</span>
    </button>
  );
}

function BigBalance({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="big-balance-ui">
      <small>{t(label)}</small>
      <b>{value} <em>{t(unit)}</em></b>
    </div>
  );
}

function CouponRow({ coupon, onClick }: { coupon: Coupon; onClick?: () => void }) {
  const qty = coupon.totalUses || coupon.remainingUses || 1;
  return (
    <button className="coupon-row-ui" onClick={onClick}>
      <span className="cn">{qty}<small>{t("ใบ")}</small></span>
      <span className="ci">
        <b>{t(coupon.name)}</b>
        <small>{money(coupon.price)} {t("฿ · ใช้ได้")} {coupon.validityDays || 30} {t("วัน")}</small>
      </span>
      <span className="add">+</span>
    </button>
  );
}

function BookingRow({ booking, onCancel, onClick, now }: { booking: Booking; onCancel?: () => void; onClick?: () => void; now: number }) {
  const start = booking.startsAt || booking.starts_at || "";
  const validStart = Number.isFinite(new Date(start).getTime());
  const day = validStart ? new Date(start).toLocaleDateString("en-GB", { day: "2-digit", timeZone: "Asia/Bangkok" }) : "--";
  const month = validStart ? new Date(start).toLocaleDateString(localeTag(), { month: "short", timeZone: "Asia/Bangkok" }) : "PPA";
  const time = validStart ? new Date(start).toLocaleTimeString(localeTag(), { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" }) : "";
  const done = ["done", "completed", "used", "checked_in", "cancelled", "expired"].includes(booking.status);
  const canCancel = ["hold", "pending_payment", "paid"].includes(booking.status) && new Date(start).getTime() >= now + 30 * 60000 && Boolean(onCancel);
  return (
    <article className="booking-row-ui">
      <button className="booking-open" onClick={onClick} aria-label={t("ดูการจอง {{value0}}", { value0: t(booking.title) })}>
      <span className="date"><b>{day}</b><small>{month}</small></span>
      <span className="inf"><b>{t(booking.title)}</b><small>{time ? `${time} · ` : ""}{money(booking.amount)} ฿</small></span>
      <span className={done ? "tag gray" : "tag"}>{t(bookingStatusLabel(booking.status))}</span>
      </button>
      {canCancel && <button className="booking-cancel" onClick={onCancel}>{t("ยกเลิก")}</button>}
    </article>
  );
}


function NotiRow({ icon, title, body, unread }: { icon: string; title: string; body: string; unread?: boolean }) {
  return (
    <div className={unread ? "noti-row unread" : "noti-row"}>
      <span className="ni">{icon}</span>
      <div>
        <b>{t(title)}</b>
        <p>{body}</p>
        <small>{unread ? t("ใหม่") : t("อ่านแล้ว")}</small>
      </div>
    </div>
  );
}

function contentByType(items: ContentItem[], contentType: string) {
  return items.filter((item) => item.contentType === contentType).sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));
}

function contentForScreen(items: ContentItem[], screen: Screen) {
  const direct = items.filter((item) => item.targetScreen === screen || item.slug === screen);
  if (direct.length) return direct;
  return contentByType(items, "feature_screen").filter((item) => {
    const screens = contentMeta(item).screens;
    return Array.isArray(screens) && screens.map(String).includes(screen);
  });
}


function contentMeta(item: ContentItem): Record<string, unknown> {
  if (!item.metadata) return {};
  if (typeof item.metadata !== "string") return item.metadata;
  try {
    const parsed = JSON.parse(item.metadata) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function prototypeScreenLabel(screen: Screen) {
  const labels: Partial<Record<Screen, string>> = {
    orprofile: "Open Run Profile",
    kuanprofile: "Buffet Rank Profile",
    groupcreate: "สร้างก๊วน",
    groupdetail: "รายละเอียดก๊วน",
    groupchat: "Group Chat",
    groupranking: "Ranking",
    kuanvote: "Vote",
    kuanresult: "Result",
    kuanredeem: "Redeem Reward",
    playerprofile: "Player Profile",
    coinshop: "Coin Shop",
    kuanroster: "Roster",
    kuanpairs: "Pairs",
    svcclass: "Service Class",
    svcdetail: "Service Detail",
    pilprivate: "Pilates Private",
    pilgroup: "Pilates Group",
    promo: "Promotion Detail",
    memverify: "Member Verify",
    classhub: "Class Hub",
    classschedule: "Class Schedule",
    bookings: "Bookings",
    editprofile: "Edit Profile",
    payscan: "Payment Scan",
    pool: "Pool",
    classes: "Classes",
    walletpay: "Wallet Pay",
    linkwallet: "Link Wallet",
    linkbank: "Link Bank",
    buyhistory: "Buy History",
    visits: "Visits",
    mycoupons: "My Coupons",
    personal: "Personal Info",
    mystatus: "My Status",
    notisettings: "Notification Settings",
    tennis: "Tennis",
    basketball: "Basketball",
    volleyball: "Volleyball",
  };
  return labels[screen] || screen;
}

function trainerCerts(trainer: Trainer) {
  if (Array.isArray(trainer.certifications)) return trainer.certifications;
  if (trainer.certifications) {
    try {
      const parsed = JSON.parse(trainer.certifications) as unknown;
      if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
    } catch {
      return trainer.certifications.split(",").map((item) => item.trim()).filter(Boolean);
    }
  }
  return [
    "NASM - Certified Personal Trainer",
    "Functional Training Institute",
    "PPA Sport Complex Coach Program",
  ];
}

function trainerSpecialties(trainer: Trainer) {
  if (Array.isArray(trainer.specialties)) return trainer.specialties.map(String).filter(Boolean);
  if (typeof trainer.specialties === "string") {
    try {
      const parsed = JSON.parse(trainer.specialties) as unknown;
      if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
    } catch {
      return trainer.specialties.split(",").map((item) => item.trim()).filter(Boolean);
    }
  }
  return [];
}

function trainerPlans(trainer: Trainer) {
  const configured = parseJsonArray<TrainerPackage>(trainer.packages).filter((plan) => plan.title && plan.text && Number(plan.price) >= 0);
  if (configured.length) return configured.map((plan) => ({ ...plan, price: Number(plan.price) }));
  const base = Number(trainer.startPrice || 1200);
  return [
    { title: "รายวัน", text: "1 ครั้ง · 1 ชม.", price: base },
    { title: "รายสัปดาห์", text: "5 ครั้ง/สัปดาห์", price: Math.round(base * 4.5) },
    { title: "รายเดือน", text: "20 ครั้ง/เดือน", price: Math.round(base * 16.7) },
    { title: "ราย 6 เดือน", text: "120 ครั้ง", price: Math.round(base * 92) },
    { title: "ราย 1 ปี", text: "240 ครั้ง", price: Math.round(base * 168) },
  ];
}

function trainerSchedule(trainer: Trainer): TrainerScheduleDay[] {
  const configured = parseJsonArray<TrainerScheduleDay>(trainer.weeklySchedule)
    .map((day) => ({ ...day, slots: Array.isArray(day.slots) ? day.slots.filter((slot) => /^\d{2}:\d{2}$/.test(slot.time)) : [] }))
    .filter((day) => day.day && day.slots.length);
  return configured;
}

function parseJsonArray<T>(value: T[] | string | null | undefined): T[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch {
    return [];
  }
}

function Summary({ sport, slot, players, date }: { sport: Sport | null; slot: Slot | null; players: number; date?: string }) {
  const rate = slot?.rate ?? sport?.baseRate ?? 0;
  return (
    <div className="summary">
      {date && <div><span>{t("วันที่")}</span><strong>{new Date(`${date}T00:00:00+07:00`).toLocaleDateString(localeTag(), { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Bangkok" })}</strong></div>}
      <div><span>{t("🏷️ บริการ")}</span><strong>{sport ? `${sport.icon} ${t(sport.name)}` : "-"}</strong></div>
      <div><span>{t("🏟️ สนาม/เวลา")}</span><strong>{slot ? `${courtName(slot.courtName)} · ${slot.time}` : t("ใช้ QR เข้าได้ทันที")}</strong></div>
      <div><span>{t("👥 ผู้เล่น")}</span><strong>{players} {t("คน")}</strong></div>
      <div><span>{t("💳 ยอดรวม")}</span><strong>{money(rate)} ฿</strong></div>
    </div>
  );
}

function PaymentScreen({
  busy,
  booking,
  item,
  wallet,
  onBack,
  onPay,
}: {
  busy: boolean;
  booking: Booking | null;
  item: { title: string; amount: number; save?: string } | null;
  wallet: number;
  onBack: () => void;
  onPay: (method: "wallet" | "promptpay") => void;
}) {
  const title = booking?.title || item?.title || "-";
  const amount = Number(booking?.amount ?? item?.amount ?? 0);
  const walletAllowed = item?.save !== "topup";
  const walletEnough = wallet >= amount;
  // The method that can pay now is the highlighted one: credit when it covers the amount.
  const recommended = walletAllowed && walletEnough ? "wallet" : "promptpay";
  return (
    <div className="page pay-page">
      <Top title={t("ชำระเงิน")} onBack={busy ? undefined : onBack} />
      <section className="pay-summary">
        <span>{t("รายการชำระ")}</span>
        <strong>{t(title)}</strong>
        {booking ? <small>{t("เลขที่การจอง {{value0}}", { value0: bookingNo(booking) })}</small> : null}
        <div className="pay-total"><span>{t("ยอดชำระ")}</span><b>{money(amount)} ฿</b></div>
      </section>
      <h3 className="pay-heading">{t("เลือกวิธีชำระเงิน")}</h3>
      {walletAllowed ? (
        <button type="button" className={recommended === "wallet" ? "pay-option recommended" : "pay-option"} disabled={busy || !walletEnough} onClick={() => onPay("wallet")}>
          <span className="pay-option-icon"><Wallet aria-hidden="true" /></span>
          <span className="pay-option-text"><b>{t("จ่ายด้วยเครดิตในแอป")}</b><small>{walletEnough ? t("คงเหลือ {{value0}} ฿", { value0: money(wallet) }) : t("เครดิตไม่พอ คงเหลือ {{value0}} ฿", { value0: money(wallet) })}</small></span>
          <ChevronRight className="pay-option-go" aria-hidden="true" />
        </button>
      ) : null}
      <button type="button" className={recommended === "promptpay" ? "pay-option recommended" : "pay-option"} disabled={busy} onClick={() => onPay("promptpay")}>
        <span className="pay-option-icon"><QrCode aria-hidden="true" /></span>
        <span className="pay-option-text"><b>{t("โอนผ่านพร้อมเพย์")}</b><small>{t("สแกน QR แล้วแนบสลิป เจ้าหน้าที่ยืนยันให้")}</small></span>
        <ChevronRight className="pay-option-go" aria-hidden="true" />
      </button>
      {busy ? <LoadingNote text={t("กำลังดำเนินการ…")} /> : <p className="pay-hint">{t("กดเลือกวิธีชำระ ระบบจะให้ตรวจสอบยอดอีกครั้งก่อนยืนยัน")}</p>}
    </div>
  );
}

function ManagedFeatureScreen({ items, onBack, onBuy, screen }: { items: ContentItem[]; onBack: () => void; onBuy: (item: ContentItem) => void; screen: Screen }) {
  const title = prototypeScreenLabel(screen);
  return (
    <div className="page">
      <Top title={t(title)} onBack={onBack} />
      <div className="list">
        {items.length ? items.map((item) => (
          <button key={item.id} onClick={() => onBuy(item)}>
            {item.icon} {t(item.title)}
            <small>{t(item.subtitle) || t(item.body) || item.slug}{item.price > 0 ? t(" · {{value0}} ฿", { value0: money(item.price) }) : ""}</small>
          </button>
        )) : <Empty text={t("ยังไม่มีข้อมูลในขณะนี้")} />}
      </div>
    </div>
  );
}

const defaultHomeSlides: ContentItem[] = [
  { id: -1, contentType: "home_slide", slug: "hyrox", icon: "🏆", title: "HYROX", subtitle: "คลาสและบริการเสริม", targetScreen: "hyrox", price: 0, metadata: { tag: "PPA", tone: "event" } },
  { id: -2, contentType: "home_slide", slug: "promotion", icon: "🎁", title: "Promotion", subtitle: "ดีลสมาชิก", targetScreen: "promotion", price: 0, metadata: { tag: "PPA", tone: "shop" } },
  { id: -3, contentType: "home_slide", slug: "coupon", icon: "🎫", title: "Coupon", subtitle: "ซื้อและใช้คูปอง", targetScreen: "coupon", price: 0, metadata: { tag: "PPA", tone: "food" } },
  { id: -4, contentType: "home_slide", slug: "airfit", icon: "🪂", title: "Airfit", subtitle: "คลาสและบริการเสริม", targetScreen: "airfit", price: 0, metadata: { tag: "PPA", tone: "airfit" } },
];

function HomeCarousel({ items, onOpen }: { items: ContentItem[]; onOpen: (screen: Screen) => void }) {
  const slides = items.length ? items : defaultHomeSlides;
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [interacting, setInteracting] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(true);
  const touchStart = useRef<number | null>(null);
  const suppressClickUntil = useRef(0);
  const active = index % slides.length;
  const move = (delta: number) => setIndex((value) => (value + delta + slides.length) % slides.length);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (paused || interacting || reducedMotion || slides.length < 2) return;
    const timer = window.setInterval(() => {
      if (!document.hidden) setIndex((value) => (value + 1) % slides.length);
    }, 4200);
    return () => window.clearInterval(timer);
  }, [paused, interacting, reducedMotion, slides.length]);
  return (
    <section className="ad-carousel home-carousel" aria-label={t("ข่าวสารและกิจกรรม")}
      onMouseEnter={() => setInteracting(true)} onMouseLeave={() => setInteracting(false)}
      onFocusCapture={() => setInteracting(true)} onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setInteracting(false); }}
      onKeyDown={(event) => { if (event.key === "ArrowRight" || event.key === "ArrowLeft") { event.preventDefault(); move(event.key === "ArrowRight" ? 1 : -1); } }}
      onTouchStart={(event) => { touchStart.current = event.touches[0].clientX; suppressClickUntil.current = 0; }}
      onTouchEnd={(event) => { const delta = event.changedTouches[0].clientX - (touchStart.current ?? event.changedTouches[0].clientX); if (Math.abs(delta) > 45) { move(delta < 0 ? 1 : -1); suppressClickUntil.current = Date.now() + 400; } touchStart.current = null; }}
      onClickCapture={(event) => { if (Date.now() < suppressClickUntil.current) { event.preventDefault(); event.stopPropagation(); } suppressClickUntil.current = 0; }}>
      <div className="ad-track" style={{ transform: `translateX(-${active * 100}%)` }}>
        {slides.map((slide, slideIndex) => {
          const meta = contentMeta(slide);
          const tone = ["event", "shop", "food", "airfit"].includes(String(meta.tone)) ? String(meta.tone) : "event";
          const src = safeImageSource(slide.imageUrl);
          const target = slide.targetScreen as Screen;
          const validTarget = [...richMenuScreens, ...managedPrototypeScreens, ...serviceShortcuts.map((item) => item.screen), "hyrox", "airfit", "fitness", "plans"].includes(target);
          return <button className={`ad-slide ${tone}`} key={slide.id} aria-hidden={slideIndex !== active} tabIndex={slideIndex === active ? 0 : -1} onClick={() => onOpen(validTarget ? target : "promotion")}>
            {src && <UploadImage className="home-slide-image" src={src} alt="" width={640} height={360} sizes="(max-width: 520px) 100vw, 520px" referrerPolicy="no-referrer" />}
            <span className="ad-tag">{typeof meta.tag === "string" ? t(meta.tag) : "PPA"}</span>
            <strong>{slide.icon} {t(slide.title)}</strong><small>{t(slide.subtitle) || t(slide.body)}</small>
          </button>;
        })}
      </div>
      {slides.length > 1 && <div className="home-slide-controls">
        <button title={t("สไลด์ก่อนหน้า")} aria-label={t("สไลด์ก่อนหน้า")} onClick={() => move(-1)}><ChevronLeft size={16} /></button>
        <div className="ad-dots">{slides.map((slide, slideIndex) => <button key={slide.id} aria-label={t("ดูสไลด์ {{number}}", { number: slideIndex + 1 })} aria-current={active === slideIndex ? "true" : undefined} className={active === slideIndex ? "on" : ""} onClick={() => setIndex(slideIndex)} />)}</div>
        <button title={t("สไลด์ถัดไป")} aria-label={t("สไลด์ถัดไป")} onClick={() => move(1)}><ChevronRight size={16} /></button>
        {!reducedMotion && <button title={t(paused ? "เล่นสไลด์" : "หยุดสไลด์")} aria-label={t(paused ? "เล่นสไลด์" : "หยุดสไลด์")} onClick={() => setPaused((value) => !value)}>{paused ? <Play size={14} /> : <Pause size={14} />}</button>}
      </div>}
    </section>
  );
}

// Uploaded photos (/uploads/...) go through the image optimizer: a small WebP sized for the screen
// instead of the original file (up to 3 MB). Other images, or an optimizer failure, show the original.
function UploadImage({ alt, src, ...props }: ComponentProps<typeof Image> & { src: string }) {
  const [failed, setFailed] = useState(false);
  return <Image {...props} alt={alt} src={src} unoptimized={!src.startsWith("/uploads/") || failed} onError={() => setFailed(true)} />;
}

function TrainerAvatar({ className = "", trainer }: { className?: string; trainer: Trainer }) {
  const src = safeImageSource(trainer.imageUrl);
  if (src) return <UploadImage width={160} height={160} alt={trainer.name} className={`trainer-photo ${className}`} src={src} referrerPolicy="no-referrer" />;
  return <span className={`trainer-photo fallback ${className}`}>{trainer.avatar}</span>;
}

function Stat({ label, value }: { label: string; value: number }) {
  return <div className="stat"><span>{statIcons[label] || "•"} {t(label)}</span><strong>{value}</strong></div>;
}
