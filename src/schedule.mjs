// src/schedule.mjs
// GitHub 예약 실행은 정각 부하로 수 시간씩 늦어지기도 해서(2026-09-01~10-08 실측 1.8~3.9시간, 08-24~26은 누락),
// 하루에 예약을 여러 번 걸어 두고 먼저 돈 실행만 메일을 보내게 한다.

// 이번 실행이 예약(cron)으로 시작됐는지
export function isScheduledRun(env = process.env) {
  return env.GITHUB_EVENT_NAME === "schedule";
}

// 오늘(KST) 브리핑을 이미 보냈는지: 발송에 성공하면 이력에 오늘 날짜가 기록된다
export function alreadySent(history, today) {
  return history.some((d) => d.date === today);
}

// 어느 예약에서 얼마나 늦게 시작했는지. SCHEDULE_CRON은 워크플로가 넘기는 github.event.schedule
// ("분 시 * * *", UTC). 예정 시각을 모르면 null.
export function scheduleDelay(cron, now = new Date()) {
  const m = String(cron || "").trim().match(/^(\d{1,2})\s+(\d{1,2})\s/);
  if (!m) return null;
  const planned = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), Number(m[2]), Number(m[1])));
  if (planned > now) planned.setUTCDate(planned.getUTCDate() - 1);
  const kst = (d) => d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Seoul" });
  const minutes = Math.round((now - planned) / 60000);
  return { planned, minutes, text: `예정 ${kst(planned)} KST → 시작 ${kst(now)} KST (지연 ${minutes}분)` };
}
