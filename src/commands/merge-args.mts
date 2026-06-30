import { parseArgs } from "../parse-args.mts";

export type MergeArgs = {
  artifacts: string;
  output: string;
  stripPrefixes: string[];
  requireArtifacts: string[];
};

export function parseMergeArgs(argv: string[]): MergeArgs {
  const parsed = parseArgs<{
    artifacts: string;
    output?: string;
    "strip-prefix": string[];
    "require-artifact": string[];
  }>(argv, {
    artifacts: { type: "string", default: "./coverage-artifacts" },
    output: { type: "string" },
    "strip-prefix": { type: "string", multiple: true, default: [] },
    "require-artifact": { type: "string", multiple: true, default: [] },
  });

  if (!parsed.output) throw new Error("--output is required");
  return {
    artifacts: parsed.artifacts,
    output: parsed.output,
    stripPrefixes: parsed["strip-prefix"],
    requireArtifacts: parsed["require-artifact"],
  };
}
