## 2026-06-09 - [Prevent argument injection in child_process.spawn]
**Vulnerability:** Command argument injection could occur if the `baseRef` or `headRef` passed to `git merge-base` or `git diff` via `spawn` started with a hyphen.
**Learning:** Even when avoiding shell execution with `spawn` and passing arguments as an array, passing an untrusted argument starting with a hyphen (e.g. `--output`) to a child process like `git` or `gh` can be interpreted as a command-line flag rather than a positional argument, leading to argument/command injection vulnerabilities.
**Prevention:** Validate that any arguments corresponding to variable input (such as Git references) do not start with a hyphen (`-`) before passing them to the child process.
## 2026-06-10 - [Prevent argument injection in child_process.spawn for gh CLI]
**Vulnerability:** Command argument injection could occur if the `repo` string passed to `gh api` via `spawn` started with a hyphen.
**Learning:** Even when avoiding shell execution with `spawn` and passing arguments as an array, passing an untrusted argument starting with a hyphen (e.g. `--repo "-X DELETE"`) to a child process like `gh` can be interpreted as a command-line flag rather than part of the URL path, leading to argument/command injection vulnerabilities.
**Prevention:** Validate that any arguments corresponding to variable input (such as repository names) do not start with a hyphen (`-`) before passing them to the child process.
