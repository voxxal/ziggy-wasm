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
      const l = ops[i.val++];
      const h = ops[i.val++];
      const translator = new Uint32Array([l, h]).buffer;

      return new BigInt64Array(translator, 0, 1)[0];
    }
    case Operation.float: {
      const l = ops[i.val++];
      const h = ops[i.val++];
      const translator = new Uint32Array([l, h]).buffer;

      return new Float64Array(translator, 0, 1)[0];
    }
    case Operation.bool: {
      return !!ops[i.val++];
    }

    case Operation.null: {
      return null;
    }
  }
};

export const parse = (source: string, options: ParseOptions = {}): any => {
  const sourcePtr = writeString(source);
  const opsSlicePtr = wasm.parse(sourcePtr, source.length);
  const opsSlice = readSlice(opsSlicePtr);
  const ops = new Uint32Array(wasm.memory.buffer, opsSlice.ptr, opsSlice.len);

  const result = constructFromOps(ops, { val: 0 }, options);

  wasm.parseFree();
  wasm.freeString(sourcePtr);
  return result;
};
