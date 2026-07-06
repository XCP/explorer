const { rawSqlExpr, ASSET_FACTORS } = require("./.test-dist/src/reputation/score.js");
const { ASSET_PENALTY } = require("./.test-dist/src/reputation/config.js");
const fs=require("fs");
const base = rawSqlExpr(ASSET_FACTORS,0);
const E = `(${base}) - (CASE WHEN low_quality=1 THEN ${-ASSET_PENALTY.lowQuality} ELSE 0 END)`;
fs.writeFileSync("EXPR.txt", E);
console.log("penalty:", ASSET_PENALTY.lowQuality);
console.log("value_usd term present:", /distinct_dispense_buyers,0\)\+3/.test(E) || E.includes("distinct_dispense_buyers,0)+3.0"));
