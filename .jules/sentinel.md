## 2026-06-09 - [Prevent argument injection in child_process.spawn]
**Vulnerability:** Command argument injection could occur if the `baseRef` or `headRef` passed to `git merge-base` or `git diff` via `spawn` started with a hyphen.
**Learning:** Even when avoiding shell execution with `spawn` and passing arguments as an array, passing an untrusted argument starting with a hyphen (e.g. `--output`) to a child process like `git` or `gh` can be interpreted as a command-line flag rather than a positional argument, leading to argument/command injection vulnerabilities.
**Prevention:** Validate that any arguments corresponding to variable input (such as Git references) do not start with a hyphen (`-`) before passing them to the child process.
## 2026-06-17 - [Strictly validate repo argument to prevent injection]
**Vulnerability:** The `--repo` argument and `GITHUB_REPOSITORY` environment variable were not validated, which could lead to path traversal or injection vulnerabilities in downstream GitHub API calls since it was used in URLs like `repos/${repo}/issues/${pr}/comments`.
**Learning:** Checking for an empty string is not sufficient validation. Also using `trim()` on an empty string to check for an empty string evaluates `true` to whitespace-only strings like `"   "` bypassing the empty string check.
**Prevention:** Always use regex to strictly validate the structure of the input format for expected strings like the GitHub `owner/repo` pattern `^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$`.
