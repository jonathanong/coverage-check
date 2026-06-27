## 2026-06-09 - [Prevent argument injection in child_process.spawn]
**Vulnerability:** Command argument injection could occur if the `baseRef` or `headRef` passed to `git merge-base` or `git diff` via `spawn` started with a hyphen.
**Learning:** Even when avoiding shell execution with `spawn` and passing arguments as an array, passing an untrusted argument starting with a hyphen (e.g. `--output`) to a child process like `git` or `gh` can be interpreted as a command-line flag rather than a positional argument, leading to argument/command injection vulnerabilities.
**Prevention:** Validate that any arguments corresponding to variable input (such as Git references) do not start with a hyphen (`-`) before passing them to the child process.
## 2026-06-09 - [Prevent argument injection in child_process.spawn]
**Vulnerability:** Command argument injection could occur if the `args.repo` input passed to `gh api repos/${repo}/...` via `spawn` started with a hyphen or was an invalid GitHub repository format.
**Learning:** Even when using array arguments in `spawn`, inputs that begin with hyphens can be interpreted as flags by the underlying executable (like `gh`). Additionally, validating inputs representing structured data (like `owner/repo`) protects against multiple classes of vulnerability including SSRF and injection.
**Prevention:** Strictly validate `args.repo` using a regex `^[A-Za-z0-9_.][A-Za-z0-9_.-]*/[A-Za-z0-9_.][A-Za-z0-9_.-]*$` before allowing the command execution to proceed.
