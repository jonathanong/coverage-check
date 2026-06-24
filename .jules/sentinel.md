## 2026-06-09 - [Prevent argument injection in child_process.spawn]
**Vulnerability:** Command argument injection could occur if the `baseRef` or `headRef` passed to `git merge-base` or `git diff` via `spawn` started with a hyphen.
**Learning:** Even when avoiding shell execution with `spawn` and passing arguments as an array, passing an untrusted argument starting with a hyphen (e.g. `--output`) to a child process like `git` or `gh` can be interpreted as a command-line flag rather than a positional argument, leading to argument/command injection vulnerabilities.
**Prevention:** Validate that any arguments corresponding to variable input (such as Git references) do not start with a hyphen (`-`) before passing them to the child process.

## 2024-06-24 - [Prevent SSRF and argument injection in gh api]
**Vulnerability:** Argument injection and potentially SSRF could occur if the `repo` parameter passed to `gh api repos/${repo}/issues/${pr}/comments` via `spawn` started with a hyphen or contained malformed path structures.
**Learning:** Even when avoiding shell execution with `spawn` and passing arguments as an array, passing an untrusted argument starting with a hyphen to a child process like `gh` can lead to command-line flag interpretation. Additionally, without validating the repository format (`owner/repo`), malicious inputs could alter the GitHub API request path, leading to SSRF or manipulating unintended resources.
**Prevention:** Validate that any arguments corresponding to a GitHub repository name conform strictly to the `owner/repo` pattern using a regular expression (e.g., `/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/`) and ensure they do not start with a hyphen before interpolation into API paths or passing to child processes.
