## 2026-06-06 - [Argument Injection in CLI tools]
**Vulnerability:** Argument injection risk in `runGitDiff` and `github-comment` via user-controlled branch/PR arguments passed directly to child processes.
**Learning:** CLI arguments passed directly to underlying child process commands (e.g., git, gh) must be validated to ensure they do not start with a hyphen ('-').
**Prevention:** Always validate user-controlled strings passed as positional arguments to child processes to ensure they don't begin with hyphens.
