import { chromium } from "file:///C:/Users/laptop/Documents/GitHub/xcpchain.com/node_modules/playwright-core/index.mjs";
const EXE = "C:/Users/laptop/AppData/Local/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe";
const b = await chromium.launch({ executablePath: EXE });
const p = await b.newPage({ viewport: { width: 1440, height: 1150 } });
await p.goto("http://localhost:3000/leaderboards", { waitUntil: "networkidle", timeout: 30000 }).catch(()=>{});
await p.waitForTimeout(5000);
await p.screenshot({ path: ".shots/leaderboards.png" });
console.log("shot ->", await p.title());
await b.close();
