import type { Metadata } from "next";
import Link from "next/link";

/**
 * TEMPORARY QA index — one deep link per transaction kind × status, for reviewing the v21
 * three-jobs tx pages (offer / receipt / declaration) against real transactions. Not linked from
 * any nav, noindexed; delete this route when the review round is done. Hashes harvested from prod
 * D1 2026-07-10 (each = the most recent example of its kind/status at harvest time).
 */
export const metadata: Metadata = { title: "TX lab — every kind × status", robots: { index: false, follow: false } };

type Row = [label: string, hash: string | null, expect: string];
type Group = { job: string; note: string; rows: Row[] };

const GROUPS: Group[] = [
  {
    job: "① Offers — the page IS the storefront",
    note: "live state, price-first, how-to-accept; dead offers collapse to an epitaph that routes demand onward",
    rows: [
      [
        "Dispenser · OPEN (the thesis)",
        "c84a73c8638df8795e184959419ba5cfc9adaec6194cc67dc3bcb189ecafd4b9",
        "storefront: art, price, stock bar, how-to-buy, sales table",
      ],
      [
        "Dispenser · CLOSED",
        "554b02890e85460b10ef207a8a61580324939091b3c5219328c6fe50a4c8de78",
        "epitaph + lifetime totals + sales table",
      ],
      ["Dispenser · SOLD OUT", null, "no on-chain example at harvest time (status 0, stock 0)"],
      ["Dispenser · CLOSING (status 11)", null, "no on-chain example at harvest time"],
      [
        "Dispenser refill",
        "7cc646cace1294031a8507d175ddb9ec908720fdd095705c8b2642447712b68e",
        "restock note + its dispenser's storefront/epitaph",
      ],
      [
        "Fairminter · OPEN",
        "f5f0bcb7c82defe54b0f98798b7c09c5d646ac86f07fbf8d0f832255d9ea3a0f",
        "mint campaign: terms, progress bar (when capped), how-to-mint",
      ],
      [
        "Fairminter · CLOSED",
        "dee5acb8d9a859c731ea32a1b5defbc744450effd7fd53bd12791f21dc4b149f",
        "epitaph: minted total + asset link",
      ],
      [
        "Order · OPEN",
        "45e2b6b240fd6e60c58161ba13ab470e3c38d362e933439da78cc57d6e405df1",
        "standing offer: taker-framed, fill bar, expiry ETA, how-to-take",
      ],
      [
        "Order · FILLED",
        "860f3cacaa90f1ea421cf0728f6f90e35a641f1951d42fe8beef3ebb13f86960",
        "epitaph: what traded + order-book link",
      ],
      [
        "Order · EXPIRED",
        "33181eec7b3f917e935ac3316193c641a5ca61d8e902fa7d3c4a6ea486b6cb45",
        "epitaph: wanted X for Y, % filled before end",
      ],
      [
        "Order · CANCELLED",
        "0ad903b86600adc85ce0aa5800fc902aabda210572ee13ae865817aea52053c9",
        "epitaph (the cancel TX itself is a separate receipt)",
      ],
      [
        "Order · INVALID",
        "9d12ff43539edab69082cba9630b0238d8477b7e2c781d918ab681e300faafea",
        "epitaph with the node's invalid: reason",
      ],
    ],
  },
  {
    job: "② Receipts — settled proof",
    note: "past-tense headline, SETTLED stamp, line items, parties; cross-links back to living storefronts",
    rows: [
      [
        "Send · classic",
        "c423bc80ed23309eca09f7d4c62216e24dcf06c45053ceef1734e17e4b0be9fe",
        "simple receipt: qty, asset, from → to",
      ],
      [
        "Send · enhanced",
        "987c7af021fd4915e1769fa93bf39f647e7dbc77f01201915b0d81ed25387a81",
        "same receipt (enhanced encodes destination in data)",
      ],
      [
        "Send · MPMA (multi-recipient)",
        "0f833f79c57a423e6009827116664b29fb48cf82a5b2e727a23475512616db37",
        "recipients table (same columns as /sends)",
      ],
      [
        "UTXO attach",
        "ebcdc82bf4ad08944666a1b2dc0ea4cdfe5b510faa809908aef9ec387de8c17a",
        "receipt with 'attached to a UTXO' verb",
      ],
      [
        "UTXO detach",
        "483a16f54b8f478162b3965e8dbbb049081866b34aaf28de9848b23079ec1efe",
        "receipt with 'detached' verb",
      ],
      [
        "UTXO move",
        "0315c8ea2b9925569ec1872b16f56f1f52978cb818492631891550e65a21b3a5",
        "receipt with 'moved between UTXOs' verb",
      ],
      [
        "Dispense (BTC purchase)",
        "7d833fe32f7bd66ddd8117e7b344286097dccf4df3894beb6460c96d733838ee",
        "line-item receipt + 'visit dispenser' when still open",
      ],
      [
        "Fairmint · paid",
        "8fd5be154810977fd440968b2dfa0a97771d422210eccfc353fc96fd3541d0d9",
        "mint slip with XCP paid",
      ],
      [
        "Fairmint · free",
        "c0300949920fdbf3d24052cf7dc09065f1ace29ce3c95a399a3e00a87926981d",
        "mint slip, 'free' + 'mint yours' when minter still open",
      ],
      [
        "BTCPay (order settlement)",
        "e44359af051a888399d6036373d3b30ef30b1b32aa89bfb57baed06ed40d3372",
        "payment receipt with match id",
      ],
      [
        "Order cancel",
        "e0ab65d7a58a4e35c32ef9f25a2795e404bc24cbb6695be0ee160fccc0eebaa6",
        "annulment receipt linking the dead order",
      ],
      ["Dividend", "076e92525e82d559dcd403dcbbc925057bab2586380af14bb23c13e63c802246", "per-unit payout receipt"],
      [
        "Sweep · full",
        "525c710e8ffdd4ca82c49af475d9844bdc1bf18a12b42dffe7c64cbfe6665332",
        "everything swept (no scope chip — full is the norm)",
      ],
      [
        "Sweep · partial",
        "3a0b5e2839e3485d8d46d794949b55d5f65c6ecdb3f800ff0cde3dd65705f158",
        "partial sweep earns the scope chip",
      ],
      [
        "Burn (proof-of-burn, 2014)",
        "4560d0e3d04927108b615ab106040489aca9c4aceedcf69d2b71f63b3139c7ae",
        "BTC burned → XCP earned",
      ],
      ["Destruction", "1c90259e7424b95a177ffc8de6c31f3912965d0fd957520c1284b840408f3490", "provably destroyed receipt"],
      ["Pool deposit", "248723e723af1dc84de631568628e50ad958c7eef81ed81620811d88a5742745", "legs + LP minted"],
      ["Pool withdrawal", null, "none has ever happened on-chain"],
      ["Pool swap", "41cac1cb92fc494aa801cbce4b7ce0937528d007101c9e2579186d847d50349c", "gave → got via pool"],
    ],
  },
  {
    job: "③ Declarations — the page displays what was published/created",
    note: "broadcast = the words; issuance = birth certificate handing off to the asset page",
    rows: [
      [
        "Broadcast · text",
        "a64889461e334f97c42a7e5058184712b20ebeadd8ce8b476b620045cff936f1",
        "the message as a blockquote",
      ],
      [
        "Broadcast · oracle value",
        "75ec15741681f3206358723e9f870e2679f752ae17e8951ad06708423db14ede",
        "the value as the big figure",
      ],
      [
        "Issuance · creation",
        "70683b36183fb1e7da67e162d5afa36cdcacfd261f9add4997ae1967f7363fc1",
        "birth certificate: art + 'was born' + chips",
      ],
      [
        "Issuance · reissue (supply grew)",
        "81afcfb5e03511958dc47edb7c4687783debe1c0a5de1ba04b6a200b30087b03",
        "'grew' sentence",
      ],
      [
        "Issuance · LOCK",
        "74ff4c6b31c051b0cee31e08c06c716fc91037607571ea440a3f2bc207296fa1",
        "'locked forever' sentence + green padlock",
      ],
      [
        "Issuance · ownership transfer",
        "95265c1f83f3371789d44710e3266f3c50c87f03fc6cd53391b171810493bbcd",
        "'transferred to' sentence",
      ],
      [
        "Issuance · description change",
        "c409bb117c269088a096bdcf24b290a172a38593fbb1a9b47190c6dac31865cc",
        "'updated' sentence with the new description",
      ],
      [
        "Issuance · subasset creation",
        "e2476285a9191e62b3d540207f35ec4e44754fcb7ebc286e6f4b278518f231bc",
        "longname birth (PARENT.CHILD)",
      ],
      ["Issuance · reset", "6b99f781f4037b1f6b3baa541a502c4d6b86cd14d697644e300cb6a1f81975ea", "reset event chips"],
      ["Bet", "6f2deeab17f2559edcdd952e8d942ac7adf2679df382bfdbf2a554beb32729cf", "declared position vs a feed"],
      [
        "RPS (rock-paper-scissors)",
        "c62fc5001169c3b286984fabae0601961c16b7c9fa4cd071f396c9fa6ff75409",
        "declared game + wager",
      ],
    ],
  },
  {
    job: "Live states & fallbacks",
    note: "the states that depend on what's happening right now",
    rows: [
      [
        "Mempool (unconfirmed) — grab any pending hash",
        null,
        "amber pulsing hero, 0/6 ticks, pending-actions table, live polling → flips to confirmed in place",
      ],
      ["Unclassifiable (OPEN_POOL / dispenser-close)", null, "header-only fallback — known capture gap, documented"],
    ],
  },
];

export default function TxLabPage() {
  return (
    <div className="space-y-8">
      <div className="pagehead">
        <h1>TX lab — every kind × status</h1>
        <p>
          <b>Temporary QA index</b> for the v21 three-jobs transaction pages. One deep link per kind and status, each
          the most recent real example at harvest time (2026-07-10). Not in nav, noindexed — delete{" "}
          <span className="mono">/tx-lab</span> when the review is done. For a live mempool tx, take any hash from{" "}
          <Link href="/mempool" className="!text-(--color-accent)">
            the mempool feed
          </Link>
          .
        </p>
      </div>
      {GROUPS.map((g) => (
        <section key={g.job} className="rts">
          <div className="strip-title">{g.job}</div>
          <p className="mb-2 text-xs text-zinc-500">{g.note}</p>
          <div className="rt">
            <div className="tr th" style={{ gridTemplateColumns: "minmax(180px,1fr) minmax(120px,2fr) 60px" }}>
              <span>Case</span>
              <span>Expect</span>
              <span className="r">Link</span>
            </div>
            {g.rows.map(([label, hash, expect]) => (
              <div
                key={label}
                className="tr"
                style={{ gridTemplateColumns: "minmax(180px,1fr) minmax(120px,2fr) 60px" }}
              >
                <span className={hash ? "text-zinc-100" : "text-zinc-500"}>{label}</span>
                <span className="desc" title={expect}>
                  {expect}
                </span>
                <span className="r">
                  {hash ? (
                    <Link className="view" href={`/tx/${hash}`}>
                      View
                    </Link>
                  ) : (
                    <span className="view text-zinc-600">—</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
