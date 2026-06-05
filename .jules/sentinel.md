## 2025-02-23 - Argument Injection in Child Process Commands
**Vulnerability:** Arguments like `--base`, `--head`, and `--repo` were passed directly to `child_process.spawn()` git and gh commands without validation. If they start with a hyphen (`-`), they can be interpreted as flags.
**Learning:** Always validate CLI arguments that are passed to underlying child processes to prevent argument injection. Ensure they do not start with a hyphen if they are expected to be positional or specific parameter values.
**Prevention:** Added explicit checks in the CLI argument parser `src/commands/check-args.mts` to throw an error if values for `--base`, `--head`, or `--repo` start with a hyphen.
