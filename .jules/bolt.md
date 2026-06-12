## 2025-02-18 - String split vs loop for large files
**Learning:** For extremely large text payloads like LCOV coverage files, using `String.prototype.split('\n')` can cause severe garbage collection overhead and memory spikes because it instantiates millions of small string objects in a large array.
**Action:** Instead of `text.split("\n")`, manually traverse large text buffers with `while(start < text.length) { end = text.indexOf('\n', start); ... }`. This cuts execution time by 30-50% for parsing. Also, avoid mutating dependencies (like package.json updates) when optimizing code purely.

## 2024-06-12 - [Optimize BRDA parsing in LCOV records]
**Learning:** Parsing extremely large LCOV files generates huge numbers of short-lived string arrays and concatenated strings when using `.split()` and template literals for every single `BRDA:` line, creating a severe performance bottleneck and massive garbage collection pressure.
**Action:** Replace `.split(",")` and template literal interpolations with manual string index traversal (`indexOf(',', ...)`) and `.slice()` when parsing line-oriented massive files to eliminate intermediate allocations.
