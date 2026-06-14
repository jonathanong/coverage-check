## 2025-02-18 - String split vs loop for large files
**Learning:** For extremely large text payloads like LCOV coverage files, using `String.prototype.split('\n')` can cause severe garbage collection overhead and memory spikes because it instantiates millions of small string objects in a large array.
**Action:** Instead of `text.split("\n")`, manually traverse large text buffers with `while(start < text.length) { end = text.indexOf('\n', start); ... }`. This cuts execution time by 30-50% for parsing. Also, avoid mutating dependencies (like package.json updates) when optimizing code purely.
## 2024-06-14 - Manual String Parsing for High-Volume LCOV Records
**Learning:** Using `.split(",")` in a hot path like LCOV record parsing (where `BRDA:` branch records occur frequently) creates unnecessary array allocations per line. This leads to increased memory usage and frequent garbage collection pauses on large coverage files.
**Action:** Prefer manual `indexOf` and slicing to extract fields directly without intermediate arrays when parsing large text files line-by-line.
