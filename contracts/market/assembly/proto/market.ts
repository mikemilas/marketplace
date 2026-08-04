import { Writer, Reader } from "as-proto";

export namespace market {
  export class config {
    static encode(message: config, writer: Writer): void {
      const unique_name_treasury = message.treasury;
      if (unique_name_treasury !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_treasury);
      }

      const unique_name_koin = message.koin;
      if (unique_name_koin !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_koin);
      }

      if (message.fee_bps != 0) {
        writer.uint32(24);
        writer.uint32(message.fee_bps);
      }
    }

    static decode(reader: Reader, length: i32): config {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new config();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.treasury = reader.bytes();
            break;

          case 2:
            message.koin = reader.bytes();
            break;

          case 3:
            message.fee_bps = reader.uint32();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    treasury: Uint8Array | null;
    koin: Uint8Array | null;
    fee_bps: u32;

    constructor(
      treasury: Uint8Array | null = null,
      koin: Uint8Array | null = null,
      fee_bps: u32 = 0
    ) {
      this.treasury = treasury;
      this.koin = koin;
      this.fee_bps = fee_bps;
    }
  }

  export class order {
    static encode(message: order, writer: Writer): void {
      const unique_name_seller = message.seller;
      if (unique_name_seller !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_seller);
      }

      const unique_name_collection = message.collection;
      if (unique_name_collection !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_collection);
      }

      const unique_name_token_id = message.token_id;
      if (unique_name_token_id !== null) {
        writer.uint32(26);
        writer.bytes(unique_name_token_id);
      }

      if (message.price != 0) {
        writer.uint32(32);
        writer.uint64(message.price);
      }

      if (message.expires != 0) {
        writer.uint32(40);
        writer.uint64(message.expires);
      }

      if (message.created != 0) {
        writer.uint32(48);
        writer.uint64(message.created);
      }
    }

    static decode(reader: Reader, length: i32): order {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new order();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.seller = reader.bytes();
            break;

          case 2:
            message.collection = reader.bytes();
            break;

          case 3:
            message.token_id = reader.bytes();
            break;

          case 4:
            message.price = reader.uint64();
            break;

          case 5:
            message.expires = reader.uint64();
            break;

          case 6:
            message.created = reader.uint64();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    seller: Uint8Array | null;
    collection: Uint8Array | null;
    token_id: Uint8Array | null;
    price: u64;
    expires: u64;
    created: u64;

    constructor(
      seller: Uint8Array | null = null,
      collection: Uint8Array | null = null,
      token_id: Uint8Array | null = null,
      price: u64 = 0,
      expires: u64 = 0,
      created: u64 = 0
    ) {
      this.seller = seller;
      this.collection = collection;
      this.token_id = token_id;
      this.price = price;
      this.expires = expires;
      this.created = created;
    }
  }

  export class order_key {
    static encode(message: order_key, writer: Writer): void {
      const unique_name_collection = message.collection;
      if (unique_name_collection !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_collection);
      }

      const unique_name_token_id = message.token_id;
      if (unique_name_token_id !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_token_id);
      }
    }

    static decode(reader: Reader, length: i32): order_key {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new order_key();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.collection = reader.bytes();
            break;

          case 2:
            message.token_id = reader.bytes();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    collection: Uint8Array | null;
    token_id: Uint8Array | null;

    constructor(
      collection: Uint8Array | null = null,
      token_id: Uint8Array | null = null
    ) {
      this.collection = collection;
      this.token_id = token_id;
    }
  }

  export class create_order_args {
    static encode(message: create_order_args, writer: Writer): void {
      const unique_name_collection = message.collection;
      if (unique_name_collection !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_collection);
      }

      const unique_name_token_id = message.token_id;
      if (unique_name_token_id !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_token_id);
      }

      if (message.price != 0) {
        writer.uint32(24);
        writer.uint64(message.price);
      }

      if (message.expires != 0) {
        writer.uint32(32);
        writer.uint64(message.expires);
      }
    }

    static decode(reader: Reader, length: i32): create_order_args {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new create_order_args();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.collection = reader.bytes();
            break;

          case 2:
            message.token_id = reader.bytes();
            break;

          case 3:
            message.price = reader.uint64();
            break;

          case 4:
            message.expires = reader.uint64();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    collection: Uint8Array | null;
    token_id: Uint8Array | null;
    price: u64;
    expires: u64;

    constructor(
      collection: Uint8Array | null = null,
      token_id: Uint8Array | null = null,
      price: u64 = 0,
      expires: u64 = 0
    ) {
      this.collection = collection;
      this.token_id = token_id;
      this.price = price;
      this.expires = expires;
    }
  }

  export class execute_order_args {
    static encode(message: execute_order_args, writer: Writer): void {
      const unique_name_collection = message.collection;
      if (unique_name_collection !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_collection);
      }

      const unique_name_token_id = message.token_id;
      if (unique_name_token_id !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_token_id);
      }

      const unique_name_buyer = message.buyer;
      if (unique_name_buyer !== null) {
        writer.uint32(26);
        writer.bytes(unique_name_buyer);
      }

      if (message.max_price != 0) {
        writer.uint32(32);
        writer.uint64(message.max_price);
      }
    }

    static decode(reader: Reader, length: i32): execute_order_args {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new execute_order_args();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.collection = reader.bytes();
            break;

          case 2:
            message.token_id = reader.bytes();
            break;

          case 3:
            message.buyer = reader.bytes();
            break;

          case 4:
            message.max_price = reader.uint64();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    collection: Uint8Array | null;
    token_id: Uint8Array | null;
    buyer: Uint8Array | null;
    max_price: u64;

    constructor(
      collection: Uint8Array | null = null,
      token_id: Uint8Array | null = null,
      buyer: Uint8Array | null = null,
      max_price: u64 = 0
    ) {
      this.collection = collection;
      this.token_id = token_id;
      this.buyer = buyer;
      this.max_price = max_price;
    }
  }

  export class get_orders_args {
    static encode(message: get_orders_args, writer: Writer): void {
      const unique_name_collection = message.collection;
      if (unique_name_collection !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_collection);
      }

      const unique_name_start_after = message.start_after;
      if (unique_name_start_after !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_start_after);
      }

      if (message.limit != 0) {
        writer.uint32(24);
        writer.uint32(message.limit);
      }
    }

    static decode(reader: Reader, length: i32): get_orders_args {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new get_orders_args();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.collection = reader.bytes();
            break;

          case 2:
            message.start_after = reader.bytes();
            break;

          case 3:
            message.limit = reader.uint32();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    collection: Uint8Array | null;
    start_after: Uint8Array | null;
    limit: u32;

    constructor(
      collection: Uint8Array | null = null,
      start_after: Uint8Array | null = null,
      limit: u32 = 0
    ) {
      this.collection = collection;
      this.start_after = start_after;
      this.limit = limit;
    }
  }

  export class order_list {
    static encode(message: order_list, writer: Writer): void {
      const unique_name_value = message.value;
      for (let i = 0; i < unique_name_value.length; ++i) {
        writer.uint32(10);
        writer.fork();
        order.encode(unique_name_value[i], writer);
        writer.ldelim();
      }
    }

    static decode(reader: Reader, length: i32): order_list {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new order_list();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.value.push(order.decode(reader, reader.uint32()));
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    value: Array<order>;

    constructor(value: Array<order> = []) {
      this.value = value;
    }
  }

  export class create_order_event {
    static encode(message: create_order_event, writer: Writer): void {
      const unique_name_seller = message.seller;
      if (unique_name_seller !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_seller);
      }

      const unique_name_collection = message.collection;
      if (unique_name_collection !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_collection);
      }

      const unique_name_token_id = message.token_id;
      if (unique_name_token_id !== null) {
        writer.uint32(26);
        writer.bytes(unique_name_token_id);
      }

      if (message.price != 0) {
        writer.uint32(32);
        writer.uint64(message.price);
      }

      if (message.expires != 0) {
        writer.uint32(40);
        writer.uint64(message.expires);
      }
    }

    static decode(reader: Reader, length: i32): create_order_event {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new create_order_event();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.seller = reader.bytes();
            break;

          case 2:
            message.collection = reader.bytes();
            break;

          case 3:
            message.token_id = reader.bytes();
            break;

          case 4:
            message.price = reader.uint64();
            break;

          case 5:
            message.expires = reader.uint64();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    seller: Uint8Array | null;
    collection: Uint8Array | null;
    token_id: Uint8Array | null;
    price: u64;
    expires: u64;

    constructor(
      seller: Uint8Array | null = null,
      collection: Uint8Array | null = null,
      token_id: Uint8Array | null = null,
      price: u64 = 0,
      expires: u64 = 0
    ) {
      this.seller = seller;
      this.collection = collection;
      this.token_id = token_id;
      this.price = price;
      this.expires = expires;
    }
  }

  export class execute_order_event {
    static encode(message: execute_order_event, writer: Writer): void {
      const unique_name_buyer = message.buyer;
      if (unique_name_buyer !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_buyer);
      }

      const unique_name_seller = message.seller;
      if (unique_name_seller !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_seller);
      }

      const unique_name_collection = message.collection;
      if (unique_name_collection !== null) {
        writer.uint32(26);
        writer.bytes(unique_name_collection);
      }

      const unique_name_token_id = message.token_id;
      if (unique_name_token_id !== null) {
        writer.uint32(34);
        writer.bytes(unique_name_token_id);
      }

      if (message.price != 0) {
        writer.uint32(40);
        writer.uint64(message.price);
      }

      if (message.protocol_fee != 0) {
        writer.uint32(48);
        writer.uint64(message.protocol_fee);
      }

      if (message.royalties_paid != 0) {
        writer.uint32(56);
        writer.uint64(message.royalties_paid);
      }
    }

    static decode(reader: Reader, length: i32): execute_order_event {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new execute_order_event();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.buyer = reader.bytes();
            break;

          case 2:
            message.seller = reader.bytes();
            break;

          case 3:
            message.collection = reader.bytes();
            break;

          case 4:
            message.token_id = reader.bytes();
            break;

          case 5:
            message.price = reader.uint64();
            break;

          case 6:
            message.protocol_fee = reader.uint64();
            break;

          case 7:
            message.royalties_paid = reader.uint64();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    buyer: Uint8Array | null;
    seller: Uint8Array | null;
    collection: Uint8Array | null;
    token_id: Uint8Array | null;
    price: u64;
    protocol_fee: u64;
    royalties_paid: u64;

    constructor(
      buyer: Uint8Array | null = null,
      seller: Uint8Array | null = null,
      collection: Uint8Array | null = null,
      token_id: Uint8Array | null = null,
      price: u64 = 0,
      protocol_fee: u64 = 0,
      royalties_paid: u64 = 0
    ) {
      this.buyer = buyer;
      this.seller = seller;
      this.collection = collection;
      this.token_id = token_id;
      this.price = price;
      this.protocol_fee = protocol_fee;
      this.royalties_paid = royalties_paid;
    }
  }

  export class cancel_order_event {
    static encode(message: cancel_order_event, writer: Writer): void {
      const unique_name_seller = message.seller;
      if (unique_name_seller !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_seller);
      }

      const unique_name_collection = message.collection;
      if (unique_name_collection !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_collection);
      }

      const unique_name_token_id = message.token_id;
      if (unique_name_token_id !== null) {
        writer.uint32(26);
        writer.bytes(unique_name_token_id);
      }
    }

    static decode(reader: Reader, length: i32): cancel_order_event {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new cancel_order_event();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.seller = reader.bytes();
            break;

          case 2:
            message.collection = reader.bytes();
            break;

          case 3:
            message.token_id = reader.bytes();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    seller: Uint8Array | null;
    collection: Uint8Array | null;
    token_id: Uint8Array | null;

    constructor(
      seller: Uint8Array | null = null,
      collection: Uint8Array | null = null,
      token_id: Uint8Array | null = null
    ) {
      this.seller = seller;
      this.collection = collection;
      this.token_id = token_id;
    }
  }
}
