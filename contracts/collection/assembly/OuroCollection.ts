// SPDX-License-Identifier: MIT
// A collection anyone can launch from OURO.
//
// This is Julian Gonzalez's audited Nft contract from @koinosbox/contracts
// — the same KCS-2 implementation behind Aurvania's relics — with one
// change: the collection's IDENTITY moves from compile time into state.
//
// The base contract declares name, symbol and uri as class fields, so a
// collection called anything else is a different binary. A launchpad
// cannot compile a contract per creator, so instead `initialize` writes
// those values once, and name()/symbol()/uri()/get_info() read them back.
// One reviewed binary then serves every collection ever launched, and
// buyers can check that every OURO collection runs identical code.
//
// Setup is authorized by the collection's OWN account, which only exists
// during deployment, and is closed permanently by the `initialized` flag
// the first time it succeeds. A second call cannot rename a collection
// people already hold tokens from.

import { System, Storage, Protobuf } from "@koinos/sdk-as";
import { Nft, common, nft } from "@koinosbox/contracts";
import { collection } from "./proto/collection";

// The marketplace pays collection royalties up to 10%; promising more here
// would only mint a number that never gets honored.
const MAX_ROYALTY: u64 = 1000;
const CONFIG_SPACE_ID = 100; // clear of the base contract's spaces (0-8)

export class OuroCollection extends Nft {
  // Fallbacks only: a deployed-but-not-yet-initialized contract still
  // answers the KCS-2 reads rather than trapping.
  _name: string = "Uninitialized collection";
  _symbol: string = "NONE";
  _uri: string = "";

  config: Storage.Obj<collection.config> = new Storage.Obj(
    this.contractId,
    CONFIG_SPACE_ID,
    collection.config.decode,
    collection.config.encode,
    () => new collection.config("", "", "", "", false)
  );

  /**
   * Get the name of the collection
   * @external
   * @readonly
   */
  name(): common.str {
    const c = this.config.get()!;
    return new common.str(c.initialized ? c.name! : this._name);
  }

  /**
   * Get the symbol of the collection
   * @external
   * @readonly
   */
  symbol(): common.str {
    const c = this.config.get()!;
    return new common.str(c.initialized ? c.symbol! : this._symbol);
  }

  /**
   * Get the base URI of the collection
   * @external
   * @readonly
   */
  uri(): common.str {
    const c = this.config.get()!;
    return new common.str(c.initialized ? c.uri! : this._uri);
  }

  /**
   * Get name, symbol, uri and description
   * @external
   * @readonly
   */
  get_info(): nft.info {
    const c = this.config.get()!;
    if (!c.initialized) return new nft.info(this._name, this._symbol, this._uri, "");
    return new nft.info(c.name!, c.symbol!, c.uri!, c.description!);
  }

  /**
   * Name the collection, set its royalty and hand it to its creator.
   * Callable exactly once, by the collection account itself.
   * @external
   * @event collection.initialized collection.initialized_event
   */
  initialize(args: collection.initialize_args): void {
    const c = this.config.get()!;
    System.require(!c.initialized, "this collection has already been set up");

    // Only the contract account can perform setup, and that key exists
    // solely for deployment.
    System.require(
      System.checkAccountAuthority(this.contractId),
      "the collection account must authorize its own setup"
    );

    System.require(args.name!.length > 0 && args.name!.length <= 64, "name must be 1-64 characters");
    System.require(args.symbol!.length > 0 && args.symbol!.length <= 16, "symbol must be 1-16 characters");
    System.require(args.description!.length <= 1000, "description must be 1000 characters or fewer");
    System.require(args.uri!.length <= 300, "uri must be 300 characters or fewer");
    System.require(args.royalty_bps <= MAX_ROYALTY, "royalty cannot exceed 10%");
    System.require(args.owner!.length > 0, "an owner is required");

    c.name = args.name;
    c.symbol = args.symbol;
    c.uri = args.uri;
    c.description = args.description;
    c.initialized = true;
    this.config.put(c);

    if (args.royalty_bps > 0) {
      const to = args.royalty_address!.length > 0 ? args.royalty_address! : args.owner!;
      const r = new nft.royalties();
      r.value.push(new nft.royalty(args.royalty_bps, to));
      this._royalties.put(r);
    }

    // The creator owns it from here: mint, metadata, royalties, and any
    // later transfer of ownership are all theirs.
    this.collectionOwner.put(new common.address(args.owner!));

    System.event(
      "collection.initialized",
      Protobuf.encode<collection.initialized_event>(
        new collection.initialized_event(args.name!, args.symbol!, args.owner!, args.royalty_bps),
        collection.initialized_event.encode
      ),
      [args.owner!]
    );
  }
}
