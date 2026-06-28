/**
 * Explorer read API — serves the D1 Counterparty mirror as clean JSON for apps/web (and as a CP-style
 * read mirror for any consumer). Composes the per-domain routers; the domains carry non-overlapping
 * path prefixes, so mount order is not significant. Balances already store raw + normalized, so no
 * divisibility joins are needed at read time.
 */
import { router } from "./shared";
import { stats } from "./stats";
import { assets } from "./assets";
import { addresses } from "./addresses";
import { chain } from "./chain";
import { emblem } from "./emblem";
import { firsts } from "./firsts";

export const read = router();
read.route("/", stats);
read.route("/", assets);
read.route("/", addresses);
read.route("/", chain);
read.route("/", emblem);
read.route("/", firsts);
