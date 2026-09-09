import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkHelp } from "./check-render.mts";

describe("checkHelp", () => {
  it("documents every flag parseCheckArgs recognizes", () => {
    const argsSource = readFileSync(
      fileURLToPath(new URL("./check-args.mts", import.meta.url)),
      "utf8",
    );
    const parsedFlags = [...argsSource.matchAll(/case "(--[a-z-]+)":/g)].map((m) => m[1]!);
    expect(parsedFlags.length).toBeGreaterThan(10);

    const help = checkHelp();
    for (const flag of parsedFlags) {
      expect(help, `checkHelp() is missing ${flag}`).toContain(`${flag} `);
    }
  });

  it("documents -h/--help and the WORKTREE head sentinel", () => {
    const help = checkHelp();
    expect(help).toContain("-h, --help");
    expect(help).toContain("WORKTREE");
  });
});
