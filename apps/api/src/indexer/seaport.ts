/**
 * Minimal Seaport `OrderFulfilled` log decoder — hand-rolled ABI decoding (the project avoids viem/ethers).
 * Alchemy's getNFTSales stopped indexing Emblem sales after ~April 2024, but getAssetTransfers still sees the
 * transfers; the SALE PRICE lives in the Seaport OrderFulfilled event of the transfer's transaction. This
 * decodes that event to recover price/currency/buyer/seller for a given (contract, tokenId).
 *
 * Event: OrderFulfilled(bytes32 orderHash, address indexed offerer, address indexed zone, address recipient,
 *   SpentItem[] offer, ReceivedItem[] consideration)
 *   SpentItem    = (uint8 itemType, address token, uint256 identifier, uint256 amount)          [4 words]
 *   ReceivedItem = (uint8 itemType, address token, uint256 identifier, uint256 amount, address) [5 words]
 * itemType: 0=NATIVE(ETH) 1=ERC20 2=ERC721 3=ERC1155 4=ERC721_CRITERIA 5=ERC1155_CRITERIA.
 *
 * Two shapes: a LISTING fill has the NFT in `offer` (offerer=seller, recipient=buyer, price=Σconsideration);
 * a BID fill has the NFT in `consideration` (offerer=buyer, recipient=seller, price=Σoffer). Payment items are
 * itemType 0/1; their summed amount (incl. marketplace/royalty fees) is the total price — matching the old
 * getNFTSales convention (seller+protocol+royalty fees). Bundles over-count per-NFT but are rare.
 */
export const ORDER_FULFILLED_TOPIC = "0x9d9af8e38d66c62e2c12f0225249fd9d721c54b83f48d9352c97c6cacdcb6f31";
const ZERO = "0x0000000000000000000000000000000000000000";

interface Item { itemType: number; token: string; identifier: bigint; amount: bigint }
export interface SeaportSale { seller: string; buyer: string; priceRaw: string; token: string }

const word = (d: string, i: number) => d.slice(i * 64, i * 64 + 64);
const addrOf = (w: string) => "0x" + w.slice(24).toLowerCase();
const uintOf = (w: string) => (w ? BigInt("0x" + w) : 0n);

// Read a dynamic array of items starting at `startWord` (its length word); `stride` = words per item.
function readItems(d: string, startWord: number, stride: number): Item[] {
  const len = Number(uintOf(word(d, startWord)));
  const out: Item[] = [];
  for (let k = 0; k < len && k < 64; k++) {
    const b = startWord + 1 + k * stride;
    out.push({ itemType: Number(uintOf(word(d, b))), token: addrOf(word(d, b + 1)), identifier: uintOf(word(d, b + 2)), amount: uintOf(word(d, b + 3)) });
  }
  return out;
}

/** Decode one OrderFulfilled log for a sale of (contract, tokenId). Returns null if this log's offer AND
 *  consideration don't contain that NFT (i.e. a different item in a multi-fulfillment tx). */
export function decodeOrderFulfilled(topics: string[], dataHex: string, contract: string, tokenId: string): SeaportSale | null {
  try {
    const d = (dataHex || "").replace(/^0x/, "");
    if (!topics?.[1] || d.length < 256) return null;
    const offerer = "0x" + topics[1].slice(26).toLowerCase();
    const recipient = addrOf(word(d, 1));
    const offer = readItems(d, Number(uintOf(word(d, 2))) / 32, 4);
    const consid = readItems(d, Number(uintOf(word(d, 3))) / 32, 5);
    const c = contract.toLowerCase();
    const isNft = (it: Item) => (it.itemType === 2 || it.itemType === 3) && it.token === c && it.identifier.toString() === tokenId;
    const pay = (arr: Item[]) => arr.filter((it) => it.itemType === 0 || it.itemType === 1);
    const sum = (arr: Item[]) => arr.reduce((a, it) => a + it.amount, 0n);
    const tokenOf = (p: Item[]) => (p[0]?.itemType === 0 ? ZERO : p[0]?.token ?? ZERO);
    if (offer.some(isNft)) { const p = pay(consid); return { seller: offerer, buyer: recipient, priceRaw: sum(p).toString(), token: tokenOf(p) }; }
    if (consid.some(isNft)) { const p = pay(offer); return { buyer: offerer, seller: recipient, priceRaw: sum(p).toString(), token: tokenOf(p) }; }
    return null;
  } catch { return null; }
}
