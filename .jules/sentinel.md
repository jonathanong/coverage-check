## 2026-06-09 - [Prevent argument injection in child_process.spawn]
**Vulnerability:** Command argument injection could occur if the `baseRef` or `headRef` passed to `git merge-base` or `git diff` via `spawn` started with a hyphen.
**Learning:** Even when avoiding shell execution with `spawn` and passing arguments as an array, passing an untrusted argument starting with a hyphen (e.g. `--output`) to a child process like `git` or `gh` can be interpreted as a command-line flag rather than a positional argument, leading to argument/command injection vulnerabilities.
**Prevention:** Validate that any arguments corresponding to variable input (such as Git references) do not start with a hyphen (`-`) before passing them to the child process.

## 2024-06-22 - Path Traversal / Injection via Invalid Repository Name
**Vulnerability:** The `--repo` command-line argument (often sourced from `GITHUB_REPOSITORY` environment variable) was not validated before being used to construct paths and execute Git/GH API commands. An attacker who could control this value could potentially inject paths like `../../` or command flags like `-foo`.
**Learning:** Even though the default value `GITHUB_REPOSITORY` is typically safe (format `owner/repo`), manual overrides via `--repo` can introduce malicious values. Trust no external inputs implicitly.
**Prevention:** Always validate all user-provided inputs to CLI arguments using strict allowlists or regular expressions (e.g., `/^[A-Za-z0-9_.][A-Za-z0-9_.-]*\/[A-Za-z0-9_.][A-Za-z0-9_.-]*$/`) before passing them to child processes or using them to construct sensitive data like API URLs or paths.
