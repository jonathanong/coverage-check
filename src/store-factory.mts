import { FileSystemSuiteStore } from "./suite-store.mts";
import { S3SuiteStore } from "./s3-suite-store.mts";
import type { SuiteStore } from "./suite-store.mts";

/** Parse "bucket/prefix" or "bucket" into S3SuiteStore constructor args. */
export function parseS3Spec(spec: string): { bucket: string; prefix?: string } {
  const slash = spec.indexOf("/");
  const bucket = slash === -1 ? spec : spec.slice(0, slash);
  if (!bucket) throw new Error(`invalid S3 spec ${JSON.stringify(spec)}: bucket must not be empty`);
  if (slash === -1) return { bucket };
  const prefix = spec.slice(slash + 1).replace(/^\/+|\/+$/g, "");
  return prefix ? { bucket, prefix } : { bucket };
}

/** Build a SuiteStore from CLI flag values. Returns null if neither is set. */
export function makeStore(opts: { fs?: string | null; s3?: string | null }): SuiteStore | null {
  if (opts.s3) {
    const { bucket, prefix } = parseS3Spec(opts.s3);
    return new S3SuiteStore({ bucket, prefix });
  }
  if (opts.fs) return new FileSystemSuiteStore(opts.fs);
  return null;
}
