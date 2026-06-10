export type MergeArgs = {
  artifacts: string;
  output: string;
  stripPrefixes: string[];
  requireArtifacts: string[];
};

export function parseMergeArgs(argv: string[]): MergeArgs {
  const args: MergeArgs = {
    artifacts: "./coverage-artifacts",
    output: "",
    stripPrefixes: [],
    requireArtifacts: [],
  };

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]!;
    const next = argv[i + 1];
    const val = (): string => {
      if (next === undefined || next.startsWith("--")) {
        throw new Error(`${flag} requires a value`);
      }
      i++;
      return next;
    };
    switch (flag) {
      case "--artifacts":
        args.artifacts = val();
        break;
      case "--output":
        args.output = val();
        break;
      case "--strip-prefix":
        args.stripPrefixes.push(val());
        break;
      case "--require-artifact":
        args.requireArtifacts.push(val());
        break;
      default:
        throw new Error(`unknown flag: ${flag}`);
    }
  }

  if (!args.output) throw new Error("--output is required");
  return args;
}
