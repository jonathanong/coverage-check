## 2026-06-09 - [Prevent argument injection in child_process.spawn]
**Vulnerability:** Command argument injection could occur if the `baseRef` or `headRef` passed to `git merge-base` or `git diff` via `spawn` started with a hyphen.
**Learning:** Even when avoiding shell execution with `spawn` and passing arguments as an array, passing an untrusted argument starting with a hyphen (e.g. `--output`) to a child process like `git` or `gh` can be interpreted as a command-line flag rather than a positional argument, leading to argument/command injection vulnerabilities.
**Prevention:** Validate that any arguments corresponding to variable input (such as Git references) do not start with a hyphen (`-`) before passing them to the child process.
## 2026-06-09 - [Strict Validation of GitHub Repository Identifiers]
**Vulnerability:** Unvalidated `--repo` arguments could be used to construct malformed API paths in the `gh` CLI or introduce path traversal/injection vulnerabilities.
**Learning:** Even when not explicitly passed as a leading hyphen argument, repository identifiers should be strictly validated against the expected `owner/repo` format before being used in path construction.
**Prevention:** Apply a regex validation (`^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$`) to the repository input string as early as possible during argument parsing.
