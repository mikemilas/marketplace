import { Writer, Reader } from "as-proto";

export namespace collection {
  export class config {
    static encode(message: config, writer: Writer): void {
      const unique_name_name = message.name;
      if (unique_name_name !== null) {
        writer.uint32(10);
        writer.string(unique_name_name);
      }

      const unique_name_symbol = message.symbol;
      if (unique_name_symbol !== null) {
        writer.uint32(18);
        writer.string(unique_name_symbol);
      }

      const unique_name_uri = message.uri;
      if (unique_name_uri !== null) {
        writer.uint32(26);
        writer.string(unique_name_uri);
      }

      const unique_name_description = message.description;
      if (unique_name_description !== null) {
        writer.uint32(34);
        writer.string(unique_name_description);
      }

      if (message.initialized != false) {
        writer.uint32(40);
        writer.bool(message.initialized);
      }
    }

    static decode(reader: Reader, length: i32): config {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new config();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.name = reader.string();
            break;

          case 2:
            message.symbol = reader.string();
            break;

          case 3:
            message.uri = reader.string();
            break;

          case 4:
            message.description = reader.string();
            break;

          case 5:
            message.initialized = reader.bool();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    name: string | null;
    symbol: string | null;
    uri: string | null;
    description: string | null;
    initialized: bool;

    constructor(
      name: string | null = null,
      symbol: string | null = null,
      uri: string | null = null,
      description: string | null = null,
      initialized: bool = false
    ) {
      this.name = name;
      this.symbol = symbol;
      this.uri = uri;
      this.description = description;
      this.initialized = initialized;
    }
  }

  export class initialize_args {
    static encode(message: initialize_args, writer: Writer): void {
      const unique_name_name = message.name;
      if (unique_name_name !== null) {
        writer.uint32(10);
        writer.string(unique_name_name);
      }

      const unique_name_symbol = message.symbol;
      if (unique_name_symbol !== null) {
        writer.uint32(18);
        writer.string(unique_name_symbol);
      }

      const unique_name_uri = message.uri;
      if (unique_name_uri !== null) {
        writer.uint32(26);
        writer.string(unique_name_uri);
      }

      const unique_name_description = message.description;
      if (unique_name_description !== null) {
        writer.uint32(34);
        writer.string(unique_name_description);
      }

      const unique_name_owner = message.owner;
      if (unique_name_owner !== null) {
        writer.uint32(42);
        writer.bytes(unique_name_owner);
      }

      if (message.royalty_bps != 0) {
        writer.uint32(48);
        writer.uint64(message.royalty_bps);
      }

      const unique_name_royalty_address = message.royalty_address;
      if (unique_name_royalty_address !== null) {
        writer.uint32(58);
        writer.bytes(unique_name_royalty_address);
      }
    }

    static decode(reader: Reader, length: i32): initialize_args {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new initialize_args();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.name = reader.string();
            break;

          case 2:
            message.symbol = reader.string();
            break;

          case 3:
            message.uri = reader.string();
            break;

          case 4:
            message.description = reader.string();
            break;

          case 5:
            message.owner = reader.bytes();
            break;

          case 6:
            message.royalty_bps = reader.uint64();
            break;

          case 7:
            message.royalty_address = reader.bytes();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    name: string | null;
    symbol: string | null;
    uri: string | null;
    description: string | null;
    owner: Uint8Array | null;
    royalty_bps: u64;
    royalty_address: Uint8Array | null;

    constructor(
      name: string | null = null,
      symbol: string | null = null,
      uri: string | null = null,
      description: string | null = null,
      owner: Uint8Array | null = null,
      royalty_bps: u64 = 0,
      royalty_address: Uint8Array | null = null
    ) {
      this.name = name;
      this.symbol = symbol;
      this.uri = uri;
      this.description = description;
      this.owner = owner;
      this.royalty_bps = royalty_bps;
      this.royalty_address = royalty_address;
    }
  }

  export class initialized_event {
    static encode(message: initialized_event, writer: Writer): void {
      const unique_name_name = message.name;
      if (unique_name_name !== null) {
        writer.uint32(10);
        writer.string(unique_name_name);
      }

      const unique_name_symbol = message.symbol;
      if (unique_name_symbol !== null) {
        writer.uint32(18);
        writer.string(unique_name_symbol);
      }

      const unique_name_owner = message.owner;
      if (unique_name_owner !== null) {
        writer.uint32(26);
        writer.bytes(unique_name_owner);
      }

      if (message.royalty_bps != 0) {
        writer.uint32(32);
        writer.uint64(message.royalty_bps);
      }
    }

    static decode(reader: Reader, length: i32): initialized_event {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new initialized_event();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.name = reader.string();
            break;

          case 2:
            message.symbol = reader.string();
            break;

          case 3:
            message.owner = reader.bytes();
            break;

          case 4:
            message.royalty_bps = reader.uint64();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    name: string | null;
    symbol: string | null;
    owner: Uint8Array | null;
    royalty_bps: u64;

    constructor(
      name: string | null = null,
      symbol: string | null = null,
      owner: Uint8Array | null = null,
      royalty_bps: u64 = 0
    ) {
      this.name = name;
      this.symbol = symbol;
      this.owner = owner;
      this.royalty_bps = royalty_bps;
    }
  }
}
