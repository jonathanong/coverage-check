## 2025-02-18 - String split vs loop for large files
**Learning:** For extremely large text payloads like LCOV coverage files, using `String.prototype.split('\n')` can cause severe garbage collection overhead and memory spikes because it instantiates millions of small string objects in a large array.
**Action:** Instead of `text.split("\n")`, manually traverse large text buffers with `while(start < text.length) { end = text.indexOf('\n', start); ... }`. This cuts execution time by 30-50% for parsing. Also, avoid mutating dependencies (like package.json updates) when optimizing code purely.
## 2025-02-18 - String split vs loop for large files
**Learning:** For extremely large text payloads like LCOV coverage files, using `String.prototype.split(',')` for high-frequency operations can cause severe garbage collection overhead and memory spikes because it instantiates millions of small string objects in a large array.
**Action:** Instead of `line.split(",")`, manually traverse text buffers with `indexOf(",")`. This cuts execution time and avoids intermediate array allocations for parsing operations.
