import { pushLineMessage, pushText } from "@/lib/notify";
import { runRankJobs } from "@/lib/rank-server";
import { runJob } from "@/lib/scheduled-jobs";

// Pairs and closes Buffet Rank sessions even where no cron job calls /api/cron/run: the member Buffet
// Rank tab and the back office run this after their response, at most once a minute per server.
let lastSweep = 0;
export async function runRankSweep() {
  if (Date.now() - lastSweep < 60_000) return;
  lastSweep = Date.now();
  try {
    const notices = await runJob((conn) => runRankJobs(conn));
    for (const notice of notices) void pushLineMessage(notice.userId, pushText(notice.title, notice.body));
  } catch (error) {
    console.error("Buffet Rank sweep failed", error);
  }
}
