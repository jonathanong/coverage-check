## 2026-06-09 - [Prevent argument injection in child_process.spawn]
**Vulnerability:** Command argument injection could occur if the `baseRef` or `headRef` passed to `git merge-base` or `git diff` via `spawn` started with a hyphen.
**Learning:** Even when avoiding shell execution with `spawn` and passing arguments as an array, passing an untrusted argument starting with a hyphen (e.g. `--output`) to a child process like `git` or `gh` can be interpreted as a command-line flag rather than a positional argument, leading to argument/command injection vulnerabilities.
**Prevention:** Validate that any arguments corresponding to variable input (such as Git references) do not start with a hyphen (`-`) before passing them to the child process.
## 2024-06-11 - Path Traversal Vulnerability
**Vulnerability:** Path traversal vulnerability due to unvalidated branch names being used in fallback file system paths.
**Learning:** Even if primary storage paths encode branch names (e.g., base64url), fallback mechanisms (like reading unencoded branch paths) can bypass primary protections and permit path traversal (e.g., reading `../../etc/latest.json`).
**Prevention:** Implement validation on the raw input string (e.g., `encodeBranchName`) to reject strings containing `..` or `\\` before any encoding or fallback path construction occurs.
