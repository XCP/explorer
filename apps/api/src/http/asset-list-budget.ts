import { DurableObject } from "cloudflare:workers";

/** One global object per workload. Fixed UTC minutes survive eviction and deployment. */
export class AssetListBudget extends DurableObject {
  take(pool: "browse" | "bulk"): number {
    const maximum = pool === "browse" ? 240 : 30;
    const now = Date.now();
    const minute = Math.floor(now / 60_000);
    const storage = this.ctx.storage.kv;
    const previous = storage.get<{ minute: number; count: number }>("window");
    const count = previous?.minute === minute ? previous.count : 0;
    if (count >= maximum) return Math.ceil(((minute + 1) * 60_000 - now) / 1000);
    storage.put("window", { minute, count: count + 1 });
    return 0;
  }
}
