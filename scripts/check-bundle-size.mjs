import { statSync } from "node:fs";

const [file, maximumBytesText] = process.argv.slice(2);
const maximumBytes = Number(maximumBytesText);

if (!file || !Number.isSafeInteger(maximumBytes) || maximumBytes <= 0) {
  console.error("usage: node scripts/check-bundle-size.mjs <file> <maximum-bytes>");
  process.exit(2);
}

const bytes = statSync(file).size;
const kibibytes = (bytes / 1024).toFixed(1);
const maximumKibibytes = (maximumBytes / 1024).toFixed(1);

if (bytes > maximumBytes) {
  console.error(`bundle size ${kibibytes} KiB exceeds the ${maximumKibibytes} KiB budget: ${file}`);
  process.exit(1);
}

console.log(`bundle size ${kibibytes} KiB is within the ${maximumKibibytes} KiB budget: ${file}`);
