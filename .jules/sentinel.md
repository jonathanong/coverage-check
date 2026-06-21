## 2026-06-09 - [Prevent argument injection in child_process.spawn]
**Vulnerability:** Command argument injection could occur if the `baseRef` or `headRef` passed to `git merge-base` or `git diff` via `spawn` started with a hyphen.
**Learning:** Even when avoiding shell execution with `spawn` and passing arguments as an array, passing an untrusted argument starting with a hyphen (e.g. `--output`) to a child process like `git` or `gh` can be interpreted as a command-line flag rather than a positional argument, leading to argument/command injection vulnerabilities.
**Prevention:** Validate that any arguments corresponding to variable input (such as Git references) do not start with a hyphen (`-`) before passing them to the child process.

## 2024-05-24 - Validate repository format to prevent SSRF and argument injection
**Vulnerability:** User-provided repository identifiers (`owner/repo`) lacked format validation before being interpolated into GitHub API endpoint URLs used via `gh api`.
**Learning:** This missing validation allowed for potential SSRF/path traversal vulnerabilities, as a malicious repo argument could contain payloads like `../../` that escape the intended URL path structure.
**Prevention:** Always strictly validate the format of user-controlled identifiers, especially when used to construct API URLs or passed to child processes. Use regular expressions (like `/^[A-Za-z0-9_.][A-Za-z0-9_.-]*\/[A-Za-z0-9_.][A-Za-z0-9_.-]*$/`) to ensure inputs match the expected structure before they are processed further.
