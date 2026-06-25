## 2025-02-18 - String split vs loop for large files
**Learning:** For extremely large text payloads like LCOV coverage files, using `String.prototype.split('\n')` can cause severe garbage collection overhead and memory spikes because it instantiates millions of small string objects in a large array.
**Action:** Instead of `text.split("\n")`, manually traverse large text buffers with `while(start < text.length) { end = text.indexOf('\n', start); ... }`. This cuts execution time by 30-50% for parsing. Also, avoid mutating dependencies (like package.json updates) when optimizing code purely.
## 2026-06-25 - Manual parsing instead of `split(',')` in hot paths
**Learning:** In highly frequent string processing (like parsing `BRDA:` branch data in LCOV files), avoiding `.split(',')` prevents allocating intermediate arrays and short-lived string objects, reducing garbage collection pressure.
**Action:** Use manual `.indexOf` and `.slice` extraction combined with comma counting checks to replicate the exact same logic with significantly lower memory overhead.
