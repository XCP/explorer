/**
 * Explorer read API — serves the D1 Counterparty mirror as clean JSON for apps/web (and as a Counterparty-style
 * read mirror for any consumer). Composes the per-domain routers; the domains carry non-overlapping
 * path prefixes, so mount order is not significant. Balances already store raw + normalized, so no
 * divisibility joins are needed at read time.
 */
import { router } from "./respond";
import { stats } from "./stats";
import { assets } from "./assets";
import { addresses } from "./addresses";
import { chain } from "./chain";
import { emblem } from "./emblem";
import { firsts } from "./firsts";
import { vaults } from "./vaults";
import { exchanges } from "./exchanges";
import { trades } from "./trades";
import { mempool } from "./mempool";

export const read = router();
read.route("/", stats);
read.route("/", assets);
read.route("/", addresses);
read.route("/", chain);
read.route("/", emblem);
read.route("/", firsts);
read.route("/", vaults);
read.route("/", exchanges);
read.route("/", trades);
read.route("/", mempool);
