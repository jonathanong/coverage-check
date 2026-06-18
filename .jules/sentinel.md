## 2026-06-09 - [Prevent argument injection in child_process.spawn]
**Vulnerability:** Command argument injection could occur if the `baseRef` or `headRef` passed to `git merge-base` or `git diff` via `spawn` started with a hyphen.
**Learning:** Even when avoiding shell execution with `spawn` and passing arguments as an array, passing an untrusted argument starting with a hyphen (e.g. `--output`) to a child process like `git` or `gh` can be interpreted as a command-line flag rather than a positional argument, leading to argument/command injection vulnerabilities.
**Prevention:** Validate that any arguments corresponding to variable input (such as Git references) do not start with a hyphen (`-`) before passing them to the child process.
## 2026-06-09 - [Prevent injection/SSRF via unsanitized GitHub repository input]
**Vulnerability:** Untrusted user input (`--repo` flag or `GITHUB_REPOSITORY` env var) could be directly interpolated into GitHub API calls via `gh` or other sub-processes without strict format validation, leading to path traversal or SSRF-like behavior in API calls.
**Learning:** Always validate high-level API identifiers against an expected format. For GitHub repositories, this means ensuring they adhere to the `owner/repo` string structure using a regex (`^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$`).
**Prevention:** Strictly validate `args.repo` at parsing time before using it to construct `repos/...` paths for API clients or child process arguments.
