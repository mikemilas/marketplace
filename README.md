# OURO — the Koinos NFT marketplace

Buy and sell NFTs from **every KCS-2 collection on Koinos**, in **KOIN**, with
**zero mana fees** — the platform's dev wallet pays them for every user. A
successor to [Kollection](https://github.com/kollection-nft/marketplace),
whose open-source contract this design is ported from.

Lives at **[ouro.lifestyle](https://ouro.lifestyle)**. The mark is an
ouroboros — the ring that feeds itself, which is also how the market works:
everything a player earns can be sold, and everything sold stays in play.

## What it is

| | |
|---|---|
| **Fee** | 2.5% of every sale, to the treasury (config-capped at 10%, on chain) |
| **Currency** | KOIN only, to start |
| **Royalties** | whatever the collection declares (KCS-2 `royalties()`), capped at 10% — same cap Kollection used |
| **Custody** | none: listings are approval-based, the NFT **stays in the seller's wallet** until the moment it sells |
| **Mana** | sponsored: users sign as *payee*, the server co-signs as *payer* with the dev wallet |
| **Wallets** | Kondor, or Google / email sign-in that opens the **same wallet as Aurvania** |
| **Order book** | on chain — `get_orders` is a paginated contract read, no indexer to trust |

## The contract (`contracts/market/`)

A port of Kollection's marketplace onto the modern koinosbox toolchain,
keeping its mechanics (approval-based orders, atomic settle, royalties)
and fixing what needed fixing:

* the **buyer is explicit and signs a `max_price`** — the original paid
  whatever the order said at execution, allowing repricing under a pending buy;
* the **seller is authorized by signature** (`checkAccountAuthority`), not by
  trusting payer/payee headers;
* **orders are readable on chain, paginated per collection** — Kollection
  rebuilt its order book from events in a backend;
* orders whose seller no longer owns the token can be **cleaned up by anyone**
  (they were unexecutable anyway);
* the order is **removed before any transfer** — re-entrancy through a hostile
  token contract finds nothing to spend twice.

```sh
cd contracts
npm install          # koinosbox toolchain (AssemblyScript 0.27)
node build.js market # -> market/build/release/contract.wasm + ABI
node deploy.js keygen --keys keys.env
node deploy.js deploy --keys keys.env --network harbinger   # test first
node deploy.js deploy --keys keys.env --network mainnet \
     --treasury <your-treasury-address> --fee-bps 250
```

`keys.env` is gitignored and holds `KOINOS_DEV_WIF` (pays all mana) and
`KOINOS_MARKET_WIF` (the account the contract lives on — on Koinos, a
contract IS an account). Verified prebuilt artifacts ship in
`contracts/prebuilt/`.

## The server (`server.js`)

Keeps **no user state**. Serves the site, curates the collection registry,
caches chain reads, bridges sign-in to the Aurvania game server, and runs the
mana sponsor. Run it:

```sh
npm install
MARKET_ADDR=<deployed address> KOINOS_DEV_WIF=<dev wif> node server.js
```

| env | meaning |
|---|---|
| `PORT` | default 3100 |
| `KOINOS_NETWORK` | `mainnet` (default) or `harbinger` |
| `MARKET_ADDR` | the deployed marketplace contract |
| `KOINOS_DEV_WIF` | the mana payer — sponsorship is off without it |
| `SPONSOR_RC_PER_OP` | mana ceiling **per operation** in satoshis (default 3 KOIN) |
| `SPONSOR_RC_MAX` | absolute per-transaction mana ceiling (default 15 KOIN) |
| `INDEX_MAX_TOKENS` | how deep a collection is indexed for filters (default 1500) |
| `AURVANIA_API` | sign-in bridge target (default `https://aurvania.quest`) |
| `GOOGLE_CLIENT_ID` | the game's Google OAuth client id — set it so sign-in does not depend on the bridge being reachable |
| `ADMIN_KEY` | enables `POST /api/collections` to register collections |
| `DATA_DIR` | runtime state (registry), default `./data-live` |

### One login, one wallet, two sites

`POST /api/account` forwards `register` / `login` / `google` to the Aurvania
server, which answers with the **same WIF/address** the same identity gets in
the game. Proven end-to-end in the test suite: register through the
marketplace, log in at aurvania.quest, same address. For Google sign-in the
marketplace's domain must be added to the OAuth client's **authorized
JavaScript origins** in the Google console.

`GET /api/diag` answers, without a key, whether this server can actually
reach the game — the question worth asking first when sign-in misbehaves.
Set `GOOGLE_CLIENT_ID` here too: the client id never changes, and inheriting
it over the network means one unreachable host turns into "Google sign-in is
not configured" on a perfectly good OAuth setup.

### The mana sponsor

Users never need KOIN mana. The client builds every transaction with
`payer = dev wallet, payee = user`, the user signs, and `POST /api/sponsor`
co-signs and broadcasts. What keeps the dev wallet safe:

1. payer must be the dev address;
2. payee must be set, must not be dev, and **must have signed** (the chain
   also enforces this — the payee's nonce is consumed);
3. every operation must target the marketplace contract, or be an
   `approve`/`set_approval_for_all` on a **registered** collection;
4. rc is capped **per operation** with an absolute ceiling, and each payee
   and IP is rate-limited.

A note on that ceiling, because it bit us: a real Koinos contract call burns
roughly 0.4–1.3 KOIN of mana, so a two-operation listing (`approve` +
`create_order`) needs well over 2 KOIN. An earlier flat 2 KOIN budget was
under what the transaction actually cost, and the chain rejected listings
with `insufficient rc` — which reads like the dev wallet is broke when it is
not. `rc_limit` is a ceiling, not a charge: only `rc_used` ever leaves the
payer, so budgeting generously is free.

Kondor users additionally fall back to a self-paid transaction if the
sponsor is ever down.

### Filters, and why they are server-side

A sidebar built from the tokens currently on screen would show wrong counts
and hide matches further down the collection. So the server walks a
collection once — ids from `get_tokens`, traits from each token's metadata —
and holds the index for ten minutes:

* `GET /api/collections/:addr/facets` — every trait with real counts.
* `GET /api/collections/:addr/tokens?t=Rarity:rare&t=Kind:pet&status=listed&sort=price_asc&q=blade&owner=1…`
  — repeated `t=Trait:Value`; several values of the **same** trait are an OR,
  different traits are an AND. Paging is `offset`/`limit`.

Collections larger than `INDEX_MAX_TOKENS` are indexed to that depth and the
response says `partial: true` rather than pretending to be complete.

### Trade history

Every listing, cancellation and sale is already on chain: the contract emits
`market.create_order` / `execute_order` / `cancel_order`, and Koinos indexes a
contract's own events under its address. `GET /api/history?collection=&token_id=`
serves them, so a trade made straight against the contract — bypassing this
site — still shows up. The walk is incremental (records carry a sequence
number) and is written to `DATA_DIR/history.json` so a restart does not
re-read the chain.

### Adding collections

```sh
curl -X POST https://<site>/api/collections \
  -H 'Content-Type: application/json' \
  -d '{"key":"<ADMIN_KEY>","address":"1...","description":"...","image":"https://..."}'
```

The address is validated against the chain before it is accepted (it must
answer as a KCS-2 collection). Aurvania Relics ships in the seed registry;
any collection is also reachable unregistered at `#/c/<address>` — the
registry only decides the home page, and which approvals the sponsor pays for.

## Tests (`tests/`)

* `market-check.js` — API surface, registry rules, and one crafted
  transaction per sponsor gate (the happy path is proven with a zero-mana
  payer, so nothing can land on chain: "passed validation, died at the
  mempool" is the success signal).
* `market-ui.js` — Playwright: home → collection → token → connect modal,
  against live mainnet reads. Needs `PLAYWRIGHT_DIR` and `CHROMIUM`.

## Launch checklist

1. `contracts`: keygen → deploy to **harbinger** → exercise list/buy/cancel →
   deploy to **mainnet** with `--treasury` set → fund the dev wallet with KOIN
   (mana regenerates; it is spent, not burned… but held as the ceiling).
2. Server env: `MARKET_ADDR`, `KOINOS_DEV_WIF`, `ADMIN_KEY`.
3. Google console: add the marketplace origin to the OAuth client.
4. Register collections through the admin endpoint.
