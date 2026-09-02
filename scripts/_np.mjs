import { chromium } from "playwright-core";
const OUT = "/private/tmp/claude-501/-Users-woojinkim-------/3dc4c6b2-2582-4b3b-b3c5-a68ef491ba46/scratchpad";
const b = await chromium.connectOverCDP("http://127.0.0.1:9222");
const page = await (b.contexts()[0]).newPage();
await page.setViewportSize({ width: 1500, height: 1000 });
await page.goto("https://blog.naver.com/PostWriteForm.naver?blogId=bulgom212", { waitUntil: "domcontentloaded", timeout: 40000 });
await page.waitForTimeout(8000);
// 상단 '발행' 버튼 = 설정 패널을 여는 버튼. 패널 안의 최종 '발행'은 절대 누르지 않는다.
const btn = page.locator("button.publish_btn__m9KHH, .header button:has-text('발행')").first();
await btn.click({ timeout: 8000 });
await page.waitForTimeout(3000);
const t = await page.evaluate(() => {
  const p = document.querySelector(".layer_publish, [class*='publish_layer'], [class*='option_layer']") || document.body;
  return p.innerText.replace(/\n{2,}/g, "\n").trim();
});
console.log("===== 발행 설정 패널 =====");
console.log(t.slice(0, 1400));
await page.screenshot({ path: OUT + "/w2.png" });
await page.close();
process.exit(0);
