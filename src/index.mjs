// src/index.mjs
// 메인 엔트리: 뉴스 수집 → 이메일 HTML 생성 → 발송

import { fetchNews } from "./fetch-news.mjs";
import { buildEmailHTML, buildEmailText, buildSubject } from "./email-template.mjs";
import { sendEmail } from "./send-email.mjs";
import { randomUUID } from "node:crypto";

const TO_EMAIL = process.env.TO_EMAIL || "pavy2004@gmail.com";
// Resend는 도메인 인증 전까지 onboarding@resend.dev 발신만 허용
const FROM_EMAIL = process.env.FROM_EMAIL || "Morning Tech Briefing <onboarding@resend.dev>";

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
  console.log(`수신자: ${TO_EMAIL}`);
  console.log(`시각(KST): ${new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}`);
  console.log("");

  // 1. 뉴스 수집 (fetchNews 내부에 자체 재시도+폴백이 있어 추가 래핑 불필요)
  console.log("📡 뉴스 수집 중...");
  const news = await fetchNews();
  console.log(`✓ ${news.items.length}개 뉴스 수집 완료`);
  news.items.forEach((it, i) => {
    console.log(`  ${String(i + 1).padStart(2, "0")}. [${it.category}] ${it.headline}`);
  });
  console.log("");

  // 2. 이메일 구성
  const html = buildEmailHTML(news);
  const text = buildEmailText(news);
  const subject = buildSubject(news);
  console.log(`📧 제목: ${subject}`);

  // 3. 발송 (자체 재시도가 없으므로 일시 실패 대비 withRetry로 감쌈)
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
}

main().catch((e) => {
  console.error("");
  console.error("❌ 실패:", e.message);
  process.exit(1);
});
