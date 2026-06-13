## 2025-02-18 - String split vs loop for large files
**Learning:** For extremely large text payloads like LCOV coverage files, using `String.prototype.split('\n')` can cause severe garbage collection overhead and memory spikes because it instantiates millions of small string objects in a large array.
**Action:** Instead of `text.split("\n")`, manually traverse large text buffers with `while(start < text.length) { end = text.indexOf('\n', start); ... }`. This cuts execution time by 30-50% for parsing. Also, avoid mutating dependencies (like package.json updates) when optimizing code purely.
## 2025-02-26 - [LCOV Parsing Array Allocations]
**Learning:** `BRDA:` (branch record) lines in massive LCOV files represent a hot path where `.split(",")` and template literal string interpolation cause significant memory allocation overhead and GC pressure.
**Action:** Always prefer manual string traversal via `indexOf` and `.slice` over `.split()` in large line-by-line parsing operations (especially for LCOV or similar formats) to avoid creating temporary array structures and intermediate strings.
