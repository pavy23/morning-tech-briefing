// src/index.mjs
// 메인 엔트리: 뉴스 수집 → 이메일 HTML 생성 → 발송

import { fetchNews } from "./fetch-news.mjs";
import { buildEmailHTML, buildEmailText, buildSubject } from "./email-template.mjs";
import { sendEmail } from "./send-email.mjs";
import { isJudgeEnabled, runShadowJudgments, formatShadowReport } from "./judge.mjs";
import { selectItems, formatSelection } from "./select.mjs";
import { loadHistory, appendHistory, previousHeadlines, todayKst } from "./history.mjs";
import { config } from "./config.mjs";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";

// 수신 주소는 코드에 두지 않는다 (공개 저장소 대비). Secrets의 TO_EMAIL 필수.
const TO_EMAIL = process.env.TO_EMAIL;
// Resend는 도메인 인증 전까지 onboarding@resend.dev 발신만 허용
const FROM_EMAIL = process.env.FROM_EMAIL || "Morning Tech Briefing <onboarding@resend.dev>";
// 테스트용: "1"이면 수집·판정만 하고 메일은 보내지 않는다 (이력도 갱신하지 않음)
const SKIP_EMAIL = process.env.SKIP_EMAIL === "1" || process.env.SKIP_EMAIL === "true";
// 판정 리포트 저장 폴더 (Actions 아티팩트로 업로드)
const OUT_DIR = process.env.OUT_DIR || "out";
// Jev 선별 모드. 기본 켜짐: 재탕·같은 날 중복을 실제로 빼고 과수집한 후보로 채운다.
// "0" / "off" / "shadow" 로 두면 판정만 기록하고 메일은 Gemini 결과 그대로 보낸다.
const JEV_SELECT = !/^(0|false|off|shadow)$/i.test((process.env.JEV_SELECT || "1").trim());

// 일시 실패용 재시도 래퍼.
// 주의: fetchNews는 내부에 자체 재시도(백오프+모델 폴백)가 있으므로 여기서 감싸지 않는다
// (이중 재시도 → 호출 폭주 → 오히려 429 유발). 자체 재시도가 없는 발송 단계에만 사용.
async function withRetry(fn, label, maxAttempts = 3) {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      console.error(`[${label}] 시도 ${attempt}/${maxAttempts} 실패: ${e.message}`);
      if (attempt < maxAttempts) {
        const waitMs = attempt * 5000;
        console.log(`  ${waitMs / 1000}초 후 재시도...`);
        await new Promise((r) => setTimeout(r, waitMs));
      }
    }
  }
  throw lastErr;
}

async function main() {
  console.log("=== Morning Tech Briefing ===");
  console.log(`수신자: ${TO_EMAIL || "(미설정)"}`);
  console.log(`시각(KST): ${new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}`);
  console.log("");

  // 1. 뉴스 수집 (fetchNews 내부에 자체 재시도+폴백이 있어 추가 래핑 불필요)
  //    Jev 선별이 켜져 있으면 목표보다 많이(config.candidates) 받아 재탕·중복을 뺀 자리를 채운다.
  const active = isJudgeEnabled() && JEV_SELECT;
  const want = active ? config.candidates : config.total;
  console.log(`📡 뉴스 수집 중... (모드: ${active ? "Jev 선별" : isJudgeEnabled() ? "Jev 섀도" : "Gemini 단독"})`);
  const news = await fetchNews({ want });
  console.log(
    `✓ ${news.items.length}개 후보 수집 완료 (모델: ${news.model}, ` +
    `실제 기사 링크 ${news.stats.real}/${news.stats.total}, 검색 폴백 ${news.stats.fallback})`
  );
  // 후보 목록. 번호 형식을 발송 목록("01. [AI] …")과 다르게 두어 로그 파서가 헷갈리지 않게 한다.
  // 링크 상태를 함께 남겨 두면 "정상일 때 보통 몇 개가 살아남는지" 기준을 잡을 수 있다.
  const LINK_TAG = { grounded: "", direct: " (직접URL)", fallback: " ⚠️검색폴백" };
  news.items.forEach((it, i) => {
    console.log(`  (c${String(i + 1).padStart(2, "0")}) [${it.category}] ${it.headline}${LINK_TAG[it.linkStatus] ?? ""}`);
  });
  console.log("");

  // 2. TypeSafe(Jev) 판정 → 선별. 판정 실패 시 기존 방식(앞에서 total건)으로 폴백해 발송은 지킨다.
  const today = todayKst();
  const history = await loadHistory();
  let report = null;
  let selection = null;
  if (isJudgeEnabled()) {
    console.log(`🧪 TypeSafe 판정 중... (${active ? "재탕·중복 제거 적용" : "섀도: 기록만"})`);
    try {
      report = await runShadowJudgments(news.items, previousHeadlines(history, today));
      console.log(formatShadowReport(report));
    } catch (e) {
      console.error(`[judge] 판정 실패 (메일 발송에는 영향 없음): ${e.message}`);
    }
  } else {
    console.log("[judge] TYPESAFE_API_KEY 없음 → 판정 생략");
  }

  if (active && report) {
    selection = selectItems(news.items, report, { total: config.total });
    console.log(formatSelection(selection, news.items));
    news.items = selection.selected;
  } else if (news.items.length > config.total) {
    console.log(`[select] ${active ? "판정 실패 → 폴백:" : "선별 비활성:"} 앞에서 ${config.total}건 사용`);
    news.items = news.items.slice(0, config.total);
  }

  if (report) {
    try {
      await mkdir(OUT_DIR, { recursive: true });
      const file = `${OUT_DIR}/judge-${today}.json`;
      const body = {
        date: today,
        ...report,
        mode: active ? "active" : "shadow",
        selection: selection && {
          candidates: selection.candidates,
          removed: selection.removed,
          unused: selection.unused,
          counts: selection.counts,
          selected_candidate_indices: selection.selected.map((it) => it.candidateIndex),
        },
      };
      await writeFile(file, JSON.stringify(body, null, 2));
      console.log(`[judge] 리포트 저장: ${file}`);
    } catch (e) {
      console.error(`[judge] 리포트 저장 실패: ${e.message}`);
    }
  }
  console.log("");

  // 발송 목록 (이 형식 "NN. [카테고리] 헤드라인"을 백테스트 로그 파서가 읽는다)
  console.log(`📬 발송 목록 ${news.items.length}건`);
  news.items.forEach((it, i) => {
    console.log(`  ${String(i + 1).padStart(2, "0")}. [${it.category}] ${it.headline}${LINK_TAG[it.linkStatus] ?? ""}`);
  });
  console.log("");

  // 3. 이메일 구성
  const html = buildEmailHTML(news);
  const text = buildEmailText(news);
  const subject = buildSubject(news);
  console.log(`📧 제목: ${subject}`);

  if (SKIP_EMAIL) {
    console.log("SKIP_EMAIL 설정 → 발송과 이력 갱신을 생략합니다.");
    return;
  }

  // 4. 발송 (자체 재시도가 없으므로 일시 실패 대비 withRetry로 감쌈)
  if (!TO_EMAIL) throw new Error("TO_EMAIL 환경변수가 없습니다 (GitHub Secrets에 수신 주소를 등록하세요)");
  console.log("발송 중...");
  // 같은 실행에서 재시도할 때 동일한 키를 사용해 중복 발송을 막는다.
  const idempotencyKey = `morning-tech-briefing/${randomUUID()}`;
  const result = await withRetry(
    () => sendEmail({
      to: TO_EMAIL,
      from: FROM_EMAIL,
      subject,
      html,
      text,
      idempotencyKey,
    }),
    "send-email"
  );
  console.log(`✓ 발송 완료 (id: ${result.id})`);

  // 5. 발송한 헤드라인을 이력에 기록 (다음 날 재탕 판정의 근거)
  try {
    const days = await appendHistory(history, today, news.items);
    console.log(`[history] ${today} 기록 완료 (보관 ${days.length}일)`);
  } catch (e) {
    console.error(`[history] 기록 실패: ${e.message}`);
  }
}

main().catch((e) => {
  console.error("");
  console.error("❌ 실패:", e.message);
  process.exit(1);
});
