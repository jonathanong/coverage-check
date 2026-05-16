import { describe, expect, it } from "vitest";
import { parseS3Spec, makeStore } from "./store-factory.mts";
import { FileSystemSuiteStore } from "./suite-store.mts";
import { S3SuiteStore } from "./s3-suite-store.mts";

describe("parseS3Spec", () => {
  it("returns bucket-only when no slash present", () => {
    expect(parseS3Spec("my-bucket")).toEqual({ bucket: "my-bucket" });
  });

  it("splits on first slash into bucket and prefix", () => {
    expect(parseS3Spec("my-bucket/my/deep/prefix")).toEqual({
      bucket: "my-bucket",
      prefix: "my/deep/prefix",
    });
  });

  it("handles a single-segment prefix", () => {
    expect(parseS3Spec("bucket/prefix")).toEqual({ bucket: "bucket", prefix: "prefix" });
  });
});

describe("makeStore", () => {
  it("returns null when neither fs nor s3 is provided", () => {
    expect(makeStore({ fs: null, s3: null })).toBeNull();
  });

  it("returns null when both are undefined", () => {
    expect(makeStore({})).toBeNull();
  });

  it("returns a FileSystemSuiteStore for an fs path", () => {
    expect(makeStore({ fs: "/tmp/store" })).toBeInstanceOf(FileSystemSuiteStore);
  });

  it("returns an S3SuiteStore for an s3 spec", () => {
    expect(makeStore({ s3: "my-bucket" })).toBeInstanceOf(S3SuiteStore);
  });

  it("returns an S3SuiteStore for an s3 spec with prefix", () => {
    expect(makeStore({ s3: "my-bucket/prefix" })).toBeInstanceOf(S3SuiteStore);
  });

  it("prefers s3 over fs when both are provided", () => {
    expect(makeStore({ fs: "/tmp/store", s3: "my-bucket" })).toBeInstanceOf(S3SuiteStore);
  });
});
