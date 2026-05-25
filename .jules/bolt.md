## 2024-10-24 - String Splitting in V8
**Learning:** `text.split("\n")` on large text files (like unified git diffs) creates massive arrays of intermediate strings that cause significant memory spikes and garbage collection overhead.
**Action:** Use manual index-based string traversal with `text.indexOf("\n", start)` to process large files line-by-line without allocating massive arrays.
