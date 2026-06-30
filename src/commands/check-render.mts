export function checkHelp(): string {
  return `coverage-check check

Usage:
  coverage-check check [options]
  coverage-check [options]

Options:
  --rules <path>                 Path to YAML rules file (default: .coverage-rules.yml)
  --artifacts <dir>              Directory to scan for lcov.info files (default: ./coverage-artifacts)
  --base <ref>                   Base git ref for git diff (default: origin/main)
  --head <ref>                   Head git ref for git diff (default: HEAD)
  --store-fs <path>              Path to a filesystem suite store directory
  --store <path>                 Alias for --store-fs
  --store-s3 <bucket[/prefix]>   S3 suite store
  --branch <name>                Branch pointer to follow when reading from the store (default: main)
  --suite <name>                 Name of the current suite
  --strip-prefix <prefix>        Extra path prefix to strip from LCOV SF: lines (repeatable)
  --pr <number>                  Pull request number for sticky comment
  --repo <owner/repo>            Repository for sticky comment (default: $GITHUB_REPOSITORY)
  --json <path|->                Write JSON result to a path, or JSON-only stdout with -
  --annotate-source              Print trimmed source text for each uncovered line
  --advisory                     Exit 0 even on coverage shortfall
  --drop-only-changed-areas      Restrict no_coverage_drop to changed rule areas
  --require-artifact <relpath>   Fail if this path is absent under --artifacts (repeatable)
  -h, --help                     Show this help`;
}
