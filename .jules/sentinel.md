## 2026-06-09 - [Prevent argument injection in child_process.spawn]
**Vulnerability:** Command argument injection could occur if the `baseRef` or `headRef` passed to `git merge-base` or `git diff` via `spawn` started with a hyphen.
**Learning:** Even when avoiding shell execution with `spawn` and passing arguments as an array, passing an untrusted argument starting with a hyphen (e.g. `--output`) to a child process like `git` or `gh` can be interpreted as a command-line flag rather than a positional argument, leading to argument/command injection vulnerabilities.
**Prevention:** Validate that any arguments corresponding to variable input (such as Git references) do not start with a hyphen (`-`) before passing them to the child process.

## 2024-06-19 - [Prevent argument injection in child_process.spawn for gh CLI]
**Vulnerability:** Argument injection and SSRF could occur if the `args.repo` input passed to `gh` via `spawn` started with a hyphen, or contained traversal characters or invalid patterns.
**Learning:** Even when avoiding shell execution with `spawn` and passing arguments as an array, passing an untrusted argument starting with a hyphen (e.g. `--output`) to a child process like `gh` can be interpreted as a command-line flag rather than a positional argument, leading to argument/command injection vulnerabilities. Additionally, an unvalidated `--repo` value could lead to an SSRF or an invalid request pattern if used in API paths.
**Prevention:** Validate that the `--repo` argument strictly conforms to the `owner/repo` pattern where neither the owner nor the repo start with a hyphen, using a strict regular expression like `^[A-Za-z0-9_.][A-Za-z0-9_.-]*/[A-Za-z0-9_.][A-Za-z0-9_.-]*$`.
