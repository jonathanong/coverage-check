## 2025-02-28 - Command Injection Risk in GitHub CLI integration
**Vulnerability:** Command injection risk where user-provided repository names were not explicitly validated before being interpolated into arguments for `gh` child process executions.
**Learning:** Even when variables are interpolated into larger strings (like `repos/${repo}/issues/...`), explicit input validation against hyphens is required as defense-in-depth to satisfy strict codebase security patterns.
**Prevention:** Always validate CLI inputs passed down to command runners (like `spawn`) to ensure they do not start with a hyphen (`-`).

## 2025-02-28 - Path Traversal vs Base64 Encoding
**Vulnerability:** Missing explicit validation for path traversal sequences (`..`, `\`) on branch names.
**Learning:** While `base64url` encoding intrinsically neutralizes path traversal characters, explicit validation prior to encoding provides defense-in-depth and rejects malformed inputs early.
**Prevention:** Add explicit pattern checks for invalid characters on user-provided storage keys (like branch names) before they are encoded or used in file paths.
