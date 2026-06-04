## 2025-06-04 - [Argument Injection]
**Vulnerability:** Argument injection via git commands
**Learning:** CLI arguments passed to `child_process.spawn` (e.g. git commands) can be interpreted as flags if they start with a hyphen (-), leading to command/argument injection.
**Prevention:** Validate user-supplied arguments (such as branch names or SHAs) to ensure they do not start with a hyphen before passing them to spawned processes.
