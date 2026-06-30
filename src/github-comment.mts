import { COMMENT_MARKER } from "./report.mts";

export type GhRunner = (args: string[]) => Promise<string>;

/* c8 ignore start */
async function defaultGhRunner(args: string[]): Promise<string> {
  const { spawn } = await import("node:child_process");
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const proc = spawn("gh", args, { stdio: ["ignore", "pipe", "inherit"] });
    proc.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    proc.on("error", reject);
    proc.on("close", (code: number | null) =>
      code === 0
        ? resolve(Buffer.concat(chunks).toString("utf8"))
        : reject(new Error(`gh ${args[0]} exited with code ${code}`)),
    );
  });
}
/* c8 ignore stop */

/** Finds the ID of the existing coverage-check sticky comment, if any. */
async function findExistingComment(repo: string, pr: number, gh: GhRunner): Promise<number | null> {
  try {
    const raw = await gh([
      "api",
      `repos/${repo}/issues/${pr}/comments`,
      "--paginate",
      "-q",
      `first(.[] | select(.body | startswith("${COMMENT_MARKER}"))) | .id`,
    ]);
    // --paginate applies the jq filter per page; take the first valid ID across all lines
    const id = raw
      .split("\n")
      .map((line) => parseInt(line.trim(), 10))
      .find((n) => Number.isFinite(n) && n > 0);
    return id ?? null;
  } catch (err) {
    process.stderr.write(`coverage-check: warning: failed to look up existing comment: ${err}\n`);
    return null;
  }
}

/**
 * Posts or updates the sticky coverage-check comment on a pull request.
 *
 * - On failure: upserts the failure comment body (POST if absent, PATCH if exists).
 * - On pass with prior comment: deletes the prior comment.
 * - On pass with no prior comment: stays silent.
 */
export async function upsertComment(
  body: string,
  repo: string,
  pr: number,
  passed: boolean,
  gh: GhRunner = defaultGhRunner,
): Promise<void> {
  if (!/^[A-Za-z0-9_.][A-Za-z0-9_.-]*\/[A-Za-z0-9_.][A-Za-z0-9_.-]*$/.test(repo)) {
    throw new Error(`Invalid repository format: ${repo}. Expected owner/repo.`);
  }

  const existingId = await findExistingComment(repo, pr, gh);

  if (passed && existingId === null) return;

  if (passed && existingId !== null) {
    await gh(["api", `repos/${repo}/issues/comments/${existingId}`, "-X", "DELETE"]);
    return;
  }

  if (existingId !== null) {
    await gh([
      "api",
      `repos/${repo}/issues/comments/${existingId}`,
      "-X",
      "PATCH",
      "-f",
      `body=${body}`,
    ]);
  } else {
    await gh(["api", `repos/${repo}/issues/${pr}/comments`, "-f", `body=${body}`]);
  }
}
