// src/index.mjs
// 메인 엔트리: 뉴스 수집 → 이메일 HTML 생성 → 발송

import { fetchNews } from "./fetch-news.mjs";
import { buildEmailHTML, buildEmailText, buildSubject } from "./email-template.mjs";
import { sendEmail } from "./send-email.mjs";

const TO_EMAIL = process.env.TO_EMAIL || "pavy2004@gmail.com";
// Resend는 도메인 인증 전까지 onboarding@resend.dev 발신만 허용
const FROM_EMAIL = process.env.FROM_EMAIL || "Morning Signal <onboarding@resend.dev>";

// 재시도 래퍼 (뉴스 수집이 일시적으로 실패할 수 있어 최대 2회 재시도)
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
  console.log("=== Morning Signal Mailer ===");
  console.log(`수신자: ${TO_EMAIL}`);
  console.log(`시각(KST): ${new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}`);
  console.log("");

  // 1. 뉴스 수집
  console.log("📡 뉴스 수집 중...");
  const news = await withRetry(fetchNews, "fetch-news");
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

  // 3. 발송
  console.log("발송 중...");
  const result = await sendEmail({
    to: TO_EMAIL,
    from: FROM_EMAIL,
    subject,
    html,
    text,
  });
  console.log(`✓ 발송 완료 (id: ${result.id})`);
}

main().catch((e) => {
  console.error("");
  console.error("❌ 실패:", e.message);
  process.exit(1);
});
