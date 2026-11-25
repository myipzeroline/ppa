import { bangkokToday } from "@/lib/court-availability";
import { awardRecentGroupCoins } from "@/lib/group-awards";
import { pushLineMessage, pushText } from "@/lib/notify";
import { runJob } from "@/lib/scheduled-jobs";

// Group Coins are decided once a day is over (POST /api/cron/run). Where no cron job is set up, opening
// the group ranking settles the last three finished days instead, at most once a minute per server.
let lastSweep = 0;

export async function runGroupAwardSweep() {
  if (Date.now() - lastSweep < 60_000) return;
  lastSweep = Date.now();
  try {
    const notices = await runJob((conn) => awardRecentGroupCoins(conn, bangkokToday()));
    for (const notice of notices) void pushLineMessage(notice.userId, pushText(notice.title, notice.body));
  } catch (error) {
    console.error("Group award sweep failed", error);
  }
}
