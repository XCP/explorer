const fs=require("fs");
const E=fs.readFileSync("EXPR.txt","utf8").trim();
const n=22849, off=p=>Math.floor(p*n);
fs.writeFileSync("q_stats.sql",`WITH r AS (SELECT (${E}) raw FROM asset_signals WHERE trades>0 OR dispenses>0) SELECT COUNT(*) n, ROUND(MIN(raw),3) minv, ROUND(MAX(raw),3) maxv, ROUND(AVG(raw),3) mean, (SELECT ROUND(raw,3) FROM r ORDER BY raw LIMIT 1 OFFSET ${off(0.50)}) p50, (SELECT ROUND(raw,3) FROM r ORDER BY raw LIMIT 1 OFFSET ${off(0.90)}) p90, (SELECT ROUND(raw,3) FROM r ORDER BY raw LIMIT 1 OFFSET ${off(0.99)}) p99, (SELECT ROUND(raw,3) FROM r ORDER BY raw LIMIT 1 OFFSET ${off(0.999)}) p999 FROM r;`);
const LIST="'SATOSHICARD','FDCARD','RAREPEPE','DARKPILLPEPE','NINJASUIT','WINKELPEPE','PEPEMILLION','TECHNOPEPE','DEXTERPEPE','GRIMPEPE','OXBT','PEPEONMUSK','TREEOFPEPE','TESTNETPEPE','RGBPEPE','PEPEREPUBLIC','CULTOFPEPE'";
fs.writeFileSync("q_spot.sql",`SELECT asset, ROUND((${E}),2) raw, low_quality lq, holders h, trades t, distinct_traders dt, distinct_dispense_buyers buy, ROUND(max_realized_usd,0) usd FROM asset_signals WHERE asset IN (${LIST}) ORDER BY raw DESC;`);
fs.writeFileSync("q_top.sql",`SELECT asset, ROUND((${E}),2) raw, low_quality lq, holders h, trades t, distinct_traders dt, distinct_dispense_buyers buy, ROUND(max_realized_usd,0) usd FROM asset_signals WHERE trades>0 OR dispenses>0 ORDER BY (${E}) DESC LIMIT 30;`);
console.log("ok");
