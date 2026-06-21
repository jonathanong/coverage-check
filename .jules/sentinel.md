## 2024-05-24 - Validate repository format to prevent SSRF and argument injection
**Vulnerability:** User-provided repository identifiers (`owner/repo`) lacked format validation before being interpolated into GitHub API endpoint URLs used via `gh api`.
**Learning:** This missing validation allowed for potential SSRF/path traversal vulnerabilities, as a malicious repo argument could contain payloads like `../../` that escape the intended URL path structure.
**Prevention:** Always strictly validate the format of user-controlled identifiers, especially when used to construct API URLs or passed to child processes. Use regular expressions (like `/^[A-Za-z0-9_.][A-Za-z0-9_.-]*\/[A-Za-z0-9_.][A-Za-z0-9_.-]*$/`) to ensure inputs match the expected structure before they are processed further.
