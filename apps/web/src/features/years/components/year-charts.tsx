/**
 * The yearbook's server-rendered chart primitives: horizontal magnitude rows (venues,
 * leaderboards, settlement currencies), monthly column strips, and the year-nav sparkline.
 * One visual language across every /year page: green = on-chain units, amber = USD.
 */
import Link from "next/link";
import type { Route } from "next";
import type { YearSummary } from "@xcp/shared/years";

const MONTH_INITIALS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];

export const usdShort = (n: number) =>
  n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}k` : `$${Math.round(n)}`;

export function YearRows({
  rows,
  chain = false,
}: {
  rows: { name: string; sub?: string; href?: string; value: number; label: string }[];
  chain?: boolean;
}) {
  const max = Math.max(...rows.map((row) => row.value), 1);
  return (
    <div className="yr-rows">
      {rows.map((row) => (
        <div key={row.name} className={`yr-row${chain ? " chain" : ""}`}>
          <span className="nm">
            {row.href ? <Link href={row.href as Route}>{row.name}</Link> : row.name}
            {row.sub && <small>{row.sub}</small>}
          </span>
          <span className="trk">
            <span className="fill" style={{ width: `${((row.value / max) * 100).toFixed(1)}%` }} />
          </span>
          <span className="val">{row.label}</span>
        </div>
      ))}
    </div>
  );
}

export function YearMonthColumns({
  values,
  usd = false,
  labelMax,
}: {
  values: number[];
  usd?: boolean;
  labelMax?: (v: number) => string;
}) {
  const max = Math.max(...values, 1);
  return (
    <>
      <div className={`yr-cols${usd ? " usd" : ""}`}>
        {values.map((v, month) => (
          <div
            key={month}
            className="yr-col"
            title={`${MONTH_INITIALS[month]}: ${usd ? usdShort(v) : v.toLocaleString("en-US")}`}
          >
            {labelMax && v === max && <div className="blabel">{labelMax(v)}</div>}
            <div className="bar" style={{ height: `${Math.max(2, (v / max) * 100)}%` }} />
          </div>
        ))}
      </div>
      <div className="yr-baseline" />
      <div className="yr-mlabels">
        {MONTH_INITIALS.map((initial, month) => (
          <span key={month}>{initial}</span>
        ))}
      </div>
    </>
  );
}

/** The year navigation IS a chart: one column per year sized by transactions — the chain's heartbeat. */
export function YearSparkNav({ years, active }: { years: YearSummary[]; active: number }) {
  const max = Math.max(...years.map((year) => year.transactions), 1);
  return (
    <>
      <nav className="yr-spark" aria-label="Years, sized by Counterparty transactions">
        {years.map((year) => {
          const height = Math.max(2, Math.round((year.transactions / max) * 56));
          const inner = (
            <>
              <span className="b" style={{ "--h": `${height}px` } as React.CSSProperties} />
              <span className="y">{String(year.year).slice(2)}</span>
            </>
          );
          return year.year === active ? (
            <span
              key={year.year}
              className="ys on"
              aria-current="page"
              title={`${year.year} · ${year.transactions.toLocaleString("en-US")} transactions`}
            >
              {inner}
            </span>
          ) : (
            <Link
              key={year.year}
              href={`/year/${year.year}` as Route}
              title={`${year.year} · ${year.transactions.toLocaleString("en-US")} transactions`}
            >
              {inner}
            </Link>
          );
        })}
      </nav>
      <div className="yr-spark-cap">Counterparty transactions per year, 2014 – {years[years.length - 1]?.year}</div>
    </>
  );
}
