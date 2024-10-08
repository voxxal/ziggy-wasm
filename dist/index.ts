import { readFile } from "fs/promises";

interface ParseOptions {
  literals?: { [k: string]: (v: string) => any };
}

type Ptr = number;

interface WasmExports {
  memory: WebAssembly.Memory;

  allocString: (len: number) => Ptr;
  freeString: (ptr: Ptr) => void;

  parse: (sourcePtr: Ptr, len: number) => Ptr;
  parseFree: () => void;
}

const source = await readFile("dist/ziggy.wasm");
let mem: any;
const module = await WebAssembly.instantiate(source, {
  dbg: {
    print: console.log,
    printMem: (ptr, len, text) =>
      console.log(
        ptr,
        len,
        text
          ? new TextDecoder().decode(new Uint8Array(mem, ptr, len))
          : new Uint8Array(mem, ptr, len)
      ),
  },
});

const wasm = module.instance.exports as unknown as WasmExports;
mem = wasm.memory;

const writeString = (str: string) => {
  const strPtr = wasm.allocString(str.length + 1);
  const strMem = new Uint8Array(wasm.memory.buffer, strPtr, str.length + 1);
  new TextEncoder().encodeInto(str + "\0", strMem);
  return strPtr;
};

// To be kept in sync with zig
enum Operation {
  map, // one op (length)
  array, // one op (length)
  tag, // two ops (name, bytes)
  bytes, // one op (address)
  integer, // two ops (lb, hb)
  float, // two ops (lb, hb)
  bool, // one op (bool)
  null,
}

interface Slice {
  ptr: Ptr;
  len: number;
}

const readSlice = (slicePtr: Ptr): Slice => {
  const [ptr, len] = new Uint32Array(wasm.memory.buffer, slicePtr, 2);

  return { ptr, len };
};

const sliceToString = (slice: Slice): string =>
  new TextDecoder().decode(
    new Uint8Array(wasm.memory.buffer, slice.ptr, slice.len)
  );

const constructFromOps = (
  ops: Uint32Array,
  i: { val: number },
  options: ParseOptions
): any => {
  console.log(i);
  switch (ops[i.val++]) {
    case Operation.map: {
      const map = {};
      const len = ops[i.val++];

      for (let field = 0; field < len; field++) {
        const fieldName = sliceToString(readSlice(ops[i.val++]));
        const val = constructFromOps(ops, i, options);
        map[fieldName] = val;
      }

      return map;
    }

    case Operation.array: {
      const arr: any[] = [];
      const len = ops[i.val++];

      for (let field = 0; field < len; field++) {
        const val = constructFromOps(ops, i, options);
        arr.push(val);
      }

      return arr;
    }

    case Operation.tag: {
      const name = sliceToString(readSlice(ops[i.val++]));
      const bytes = constructFromOps(ops, i, options);
      if (options?.literals?.[name]) {
        return options.literals[name](bytes);
      }

      return bytes;
    }
    case Operation.bytes: {
      const bytes = sliceToString(readSlice(ops[i.val++]));
      return bytes;
    }
    case Operation.integer: {
      // TODO doesn't handle negative numbers properly (also not perfect)
      const l = ops[i.val++];
      const h = ops[i.val++];
      let res = BigInt(0);
      res += BigInt(h);
      res *= 0xffffffffn;
      res += BigInt(l);
      return res;
    }

    case Operation.bool: {
      return !!ops[i.val++];
    }

    case Operation.null: {
      return null;
    }
  }
};

export const parse = (source: string, options: ParseOptions = {}) => {
  if (wasm) {
    const sourcePtr = writeString(source);
    const opsSlicePtr = wasm.parse(sourcePtr, source.length);
    const opsSlice = readSlice(opsSlicePtr);
    const ops = new Uint32Array(wasm.memory.buffer, opsSlice.ptr, opsSlice.len);
    console.log(ops);

    wasm.parseFree();
    wasm.freeString(sourcePtr);
    return constructFromOps(ops, { val: 0 }, options);
  } else {
    throw new Error("should be unreachable");
  }
};

console.log(
  parse(
    `

.id = @uuid("f998b1ac-2872-4daf-9009-9f20f94e7752"),
.time = 1710085168,
.payload = Command {
  .do = @action("clear_chat"),
  .sender = "kristoff-it",
  .roles = ["admin", "mod"],
  .extra = {
    "agent": "Mozilla/5.0",
    "os": "Linux/x64", 
  },
}

`,
    { literals: { uuid: (bytes) => bytes.split("-") } }
  )
);
