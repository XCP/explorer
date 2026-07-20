/** Rate-limited, cached census of the public Rare Pepe Chat HTML archive. */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const base = "https://j-dog.net/archive/RarePepeChat/";
const cache = join(process.cwd(), "..", "..", "outputs", "rarepepe-chat-cache");
mkdirSync(cache, { recursive: true });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const decode = (s) =>
  s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&#39;", "'")
    .replaceAll("&quot;", '"')
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replace(/\s+/g, " ")
    .trim();
async function page(name) {
  const path = join(cache, name);
  if (existsSync(path)) return readFileSync(path, "utf8");
  const response = await fetch(base + name, { headers: { "user-agent": "xcp-explorer historical research" } });
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
  const html = await response.text();
  writeFileSync(path, html);
  await sleep(500);
  return html;
}

const seed = await page("2016-09.html");
const months = [...new Set([...seed.matchAll(/href="(20\d\d-\d\d\.html)"/g)].map((m) => m[1]))].sort();
const close =
  /\b(?:sold\s+to|sold\s+for|winning\s+bid|highest\s+bid|winner\s+(?:is|was)|auction\s+(?:ended|closed))\b/i;
const auction = /\b(?:auction|bid(?:ding)?|going once|going twice)\b/i;
const results = [];
for (const month of months) {
  const html = await page(month),
    messages = [];
  for (const match of html.matchAll(
    /<li class="message type-message"[\s\S]*?<a class="id" href="#(\d+)">[\s\S]*?<span class="date">([^<]+)<\/span>[\s\S]*?<div class="text">([\s\S]*?)<\/div>/g,
  ))
    messages.push({ id: Number(match[1]), date: decode(match[2]), text: decode(match[3]) });
  const closes = messages.filter((m) => close.test(m.text));
  const mentions = messages.filter((m) => auction.test(m.text));
  if (closes.length || mentions.length)
    results.push({
      month,
      messages: messages.length,
      auction_mentions: mentions.length,
      close_mentions: closes.length,
      samples: closes.slice(0, 8),
    });
}
console.log(JSON.stringify({ months: months.length, active_months: results.length, results }, null, 2));
