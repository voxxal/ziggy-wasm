# ziggy-wasm

[Ziggy](https://ziggy-lang.io) support for JavaScript.

## Installation

```
npm install ziggy-wasm
```

## Example Usage

```js
import { parse } from "ziggy-json";

parse(`{ .name = "Ziggy", .date = @date("2024-12-09") }`, {
  literals: { date: Date.prototype.constructor },
});
```
