## 2025-02-18 - String split vs loop for large files
**Learning:** For extremely large text payloads like LCOV coverage files, using `String.prototype.split('\n')` can cause severe garbage collection overhead and memory spikes because it instantiates millions of small string objects in a large array.
**Action:** Instead of `text.split("\n")`, manually traverse large text buffers with `while(start < text.length) { end = text.indexOf('\n', start); ... }`. This cuts execution time by 30-50% for parsing. Also, avoid mutating dependencies (like package.json updates) when optimizing code purely.

## 2026-06-23 - String split vs indexOf/slice for BRDA lines
**Learning:** Similar to avoiding `split('\n')` for lines, using `split(',')` on thousands of comma-separated records (like LCOV BRDA lines) causes unnecessary intermediate array allocations, triggering GC pauses.
**Action:** Use manual `indexOf(',')` and `slice()` to extract specific fields out of comma-separated lines. This significantly reduces memory overhead when applied to high-frequency strings during parsing.
