import { convertNativeV8ToLcov, type NativeV8ToLcovOptions } from "../native-v8-to-lcov.mts";

export function parseNativeV8ToLcovArgs(argv: string[]): NativeV8ToLcovOptions {
  const args: NativeV8ToLcovOptions = {
    v8Dir: "",
    sourceRoot: "",
    include: [],
    exclude: [],
    output: "",
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`${flag} requires a value`);
    i++;
    switch (flag) {
      case "--v8-dir":
        args.v8Dir = value;
        break;
      case "--source-root":
        args.sourceRoot = value;
        break;
      case "--include":
        args.include.push(value);
        break;
      case "--exclude":
        args.exclude!.push(value);
        break;
      case "--output":
        args.output = value;
        break;
      default:
        throw new Error(`unknown flag: ${flag}`);
    }
  }
  if (!args.v8Dir || !args.sourceRoot || !args.output || args.include.length === 0) {
    throw new Error("--v8-dir, --source-root, --include, and --output are required");
  }
  return args;
}

export async function main(argv: string[]): Promise<number> {
  try {
    const result = await convertNativeV8ToLcov(parseNativeV8ToLcovArgs(argv));
    process.stdout.write(`coverage-check native-v8-to-lcov: ${result.files} source file(s)\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`coverage-check native-v8-to-lcov: ${String(error)}\n`);
    return 2;
  }
}
