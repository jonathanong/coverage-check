## 2026-06-09 - [Prevent argument injection in child_process.spawn]
**Vulnerability:** Command argument injection could occur if the `baseRef` or `headRef` passed to `git merge-base` or `git diff` via `spawn` started with a hyphen.
**Learning:** Even when avoiding shell execution with `spawn` and passing arguments as an array, passing an untrusted argument starting with a hyphen (e.g. `--output`) to a child process like `git` or `gh` can be interpreted as a command-line flag rather than a positional argument, leading to argument/command injection vulnerabilities.
**Prevention:** Validate that any arguments corresponding to variable input (such as Git references) do not start with a hyphen (`-`) before passing them to the child process.

## 2026-06-09 - [Prevent argument injection via repository flag]
**Vulnerability:** Command argument injection could occur if the repository name (passed via `--repo` or `GITHUB_REPOSITORY`) started with a hyphen. This value is used to construct paths for `gh` commands (e.g. `repos/-foo/bar/issues/...`). When `gh` is invoked, it may interpret the repository prefix as a command-line flag rather than part of the path.
**Learning:** Even if an input is interpolated into the middle of a string that is passed as a positional argument to a child process, if the child process tool parses options at any position (like `gh` often does), a leading hyphen in the interpolated portion can still trigger option parsing and lead to injection.
**Prevention:** Strictly validate that strings representing repository names conform to the `owner/repo` format and ensure neither the owner nor the repo component begins with a hyphen before using them to construct API paths or passing them to child processes.
