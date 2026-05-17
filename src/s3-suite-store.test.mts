import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand } from "@aws-sdk/client-s3";
import { S3SuiteStore } from "./s3-suite-store.mts";
import { encodeBranchName } from "./suite-store.mts";

function makeClient(sendImpl: (cmd: unknown) => Promise<unknown>) {
  return { send: vi.fn(sendImpl) };
}

const BUCKET = "test-bucket";
const PREFIX = "coverage";
const LCOV = "SF:backend/foo.mts\nDA:1,1\nend_of_record\n";
const POINTER = JSON.stringify({ sha: "abc123", timestamp: "2026-01-01T00:00:00.000Z" });

function notFound() {
  const err = new Error("NoSuchKey");
  err.name = "NoSuchKey";
  return Promise.reject(err);
}

describe("S3SuiteStore — list()", () => {
  it("returns suite names from CommonPrefixes", async () => {
    const client = makeClient(async () => ({
      CommonPrefixes: [{ Prefix: `${PREFIX}/backend/` }, { Prefix: `${PREFIX}/frontend/` }],
    }));
    const store = new S3SuiteStore({ bucket: BUCKET, prefix: PREFIX, client });
    expect(await store.list()).toEqual(["backend", "frontend"]);
    expect(client.send).toHaveBeenCalledOnce();
    const cmd = client.send.mock.calls[0][0];
    expect(cmd).toBeInstanceOf(ListObjectsV2Command);
  });

  it("returns empty array when CommonPrefixes is absent", async () => {
    const client = makeClient(async () => ({}));
    const store = new S3SuiteStore({ bucket: BUCKET, prefix: PREFIX, client });
    expect(await store.list()).toEqual([]);
  });

  it("works without a prefix", async () => {
    const client = makeClient(async () => ({
      CommonPrefixes: [{ Prefix: "backend/" }],
    }));
    const store = new S3SuiteStore({ bucket: BUCKET, client });
    expect(await store.list()).toEqual(["backend"]);
  });

  it("filters out empty-string entries", async () => {
    const client = makeClient(async () => ({
      CommonPrefixes: [{ Prefix: undefined }, { Prefix: `${PREFIX}/web/` }],
    }));
    const store = new S3SuiteStore({ bucket: BUCKET, prefix: PREFIX, client });
    expect(await store.list()).toEqual(["web"]);
  });

  it("paginates through all results when IsTruncated is true", async () => {
    let callCount = 0;
    const client = makeClient(async () => {
      callCount++;
      if (callCount === 1) {
        return {
          CommonPrefixes: [{ Prefix: `${PREFIX}/suite-a/` }],
          IsTruncated: true,
          NextContinuationToken: "token-xyz",
        };
      }
      return { CommonPrefixes: [{ Prefix: `${PREFIX}/suite-b/` }], IsTruncated: false };
    });
    const store = new S3SuiteStore({ bucket: BUCKET, prefix: PREFIX, client });
    expect(await store.list()).toEqual(["suite-a", "suite-b"]);
    expect(client.send).toHaveBeenCalledTimes(2);
    const secondCmd = client.send.mock.calls[1][0] as ListObjectsV2Command;
    expect(secondCmd.input.ContinuationToken).toBe("token-xyz");
  });
});

describe("S3SuiteStore — get()", () => {
  it("follows branch pointer to fetch lcov (Uint8Array body)", async () => {
    let callCount = 0;
    const client = makeClient(async (cmd) => {
      callCount++;
      if (cmd instanceof GetObjectCommand) {
        if (callCount === 1) return { Body: Buffer.from(POINTER) };
        return { Body: Buffer.from(LCOV) };
      }
      return {};
    });
    const store = new S3SuiteStore({ bucket: BUCKET, prefix: PREFIX, client });
    const result = await store.get("backend", { branch: "main" });
    expect(result!.toString()).toBe(LCOV);
    expect(client.send).toHaveBeenCalledTimes(2);
  });

  it("falls back to legacy lcov.info when no branch pointer exists", async () => {
    let callCount = 0;
    const client = makeClient(async (cmd) => {
      callCount++;
      if (cmd instanceof GetObjectCommand && callCount < 3) return notFound();
      return { Body: Buffer.from(LCOV) };
    });
    const store = new S3SuiteStore({ bucket: BUCKET, prefix: PREFIX, client });
    expect((await store.get("backend"))!.toString()).toBe(LCOV);
    const keys = client.send.mock.calls.map((c) => (c[0] as GetObjectCommand).input.Key);
    expect(keys).toEqual([
      `${PREFIX}/backend/branch/${encodeBranchName("main")}/latest.json`,
      `${PREFIX}/backend/branch/main/latest.json`,
      `${PREFIX}/backend/lcov.info`,
    ]);
  });

  it("falls back to the previous unencoded branch pointer key", async () => {
    let callCount = 0;
    const client = makeClient(async (cmd) => {
      callCount++;
      if (cmd instanceof GetObjectCommand) {
        const key = cmd.input.Key;
        if (key === `${PREFIX}/backend/branch/${encodeBranchName("main")}/latest.json`) {
          return notFound();
        }
        if (key === `${PREFIX}/backend/branch/main/latest.json`) {
          return { Body: Buffer.from(POINTER) };
        }
        return { Body: Buffer.from(LCOV) };
      }
      return {};
    });
    const store = new S3SuiteStore({ bucket: BUCKET, prefix: PREFIX, client });
    expect((await store.get("backend", { branch: "main" }))!.toString()).toBe(LCOV);
    expect(callCount).toBe(3);
  });

  it("rethrows unexpected errors from the legacy fallback fetch", async () => {
    let callCount = 0;
    const client = makeClient(async () => {
      callCount++;
      if (callCount < 3) return notFound();
      throw new Error("legacy read failed");
    });
    const store = new S3SuiteStore({ bucket: BUCKET, prefix: PREFIX, client });
    await expect(store.get("backend")).rejects.toThrow("legacy read failed");
  });

  it("defaults to main branch when no opts provided", async () => {
    let callCount = 0;
    const client = makeClient(async (cmd) => {
      callCount++;
      if (cmd instanceof GetObjectCommand) {
        if (callCount === 1) return { Body: Buffer.from(POINTER) };
        return { Body: Buffer.from(LCOV) };
      }
      return {};
    });
    const store = new S3SuiteStore({ bucket: BUCKET, prefix: PREFIX, client });
    const result = await store.get("backend");
    expect(result).not.toBeNull();
  });

  it("fetches by explicit sha without reading the pointer", async () => {
    const client = makeClient(async (cmd) => {
      if (cmd instanceof GetObjectCommand) return { Body: Buffer.from(LCOV) };
      return {};
    });
    const store = new S3SuiteStore({ bucket: BUCKET, prefix: PREFIX, client });
    const result = await store.get("backend", { sha: "abc123" });
    expect(result!.toString()).toBe(LCOV);
    expect(client.send).toHaveBeenCalledOnce();
  });

  it("returns null when branch pointer is not found", async () => {
    const client = makeClient(async (cmd) => {
      if (cmd instanceof GetObjectCommand) return notFound();
      return {};
    });
    const store = new S3SuiteStore({ bucket: BUCKET, prefix: PREFIX, client });
    expect(await store.get("backend", { branch: "main" })).toBeNull();
  });

  it("returns null when lcov object is not found", async () => {
    let callCount = 0;
    const client = makeClient(async (cmd) => {
      callCount++;
      if (cmd instanceof GetObjectCommand) {
        if (callCount === 1) return { Body: Buffer.from(POINTER) };
        const err = new Error("NotFound");
        err.name = "NotFound";
        return Promise.reject(err);
      }
      return {};
    });
    const store = new S3SuiteStore({ bucket: BUCKET, prefix: PREFIX, client });
    expect(await store.get("backend", { branch: "main" })).toBeNull();
  });

  it("rethrows unexpected errors from pointer fetch", async () => {
    const client = makeClient(async () => Promise.reject(new Error("network error")));
    const store = new S3SuiteStore({ bucket: BUCKET, client });
    await expect(store.get("backend")).rejects.toThrow("network error");
  });

  it("rethrows unexpected errors from lcov fetch", async () => {
    let callCount = 0;
    const client = makeClient(async (cmd) => {
      callCount++;
      if (cmd instanceof GetObjectCommand) {
        if (callCount === 1) return { Body: Buffer.from(POINTER) };
        return Promise.reject(new Error("read error"));
      }
      return {};
    });
    const store = new S3SuiteStore({ bucket: BUCKET, client });
    await expect(store.get("backend")).rejects.toThrow("read error");
  });

  it("handles a Readable body", async () => {
    let callCount = 0;
    const client = makeClient(async (cmd) => {
      callCount++;
      if (cmd instanceof GetObjectCommand) {
        if (callCount === 1) return { Body: Buffer.from(POINTER) };
        return { Body: Readable.from([Buffer.from(LCOV)]) };
      }
      return {};
    });
    const store = new S3SuiteStore({ bucket: BUCKET, prefix: PREFIX, client });
    const result = await store.get("backend");
    expect(result!.toString()).toBe(LCOV);
  });

  it("handles a Blob body", async () => {
    let callCount = 0;
    const client = makeClient(async (cmd) => {
      callCount++;
      if (cmd instanceof GetObjectCommand) {
        if (callCount === 1) return { Body: Buffer.from(POINTER) };
        return { Body: new Blob([LCOV]) };
      }
      return {};
    });
    const store = new S3SuiteStore({ bucket: BUCKET, prefix: PREFIX, client });
    const result = await store.get("backend");
    expect(result!.toString()).toBe(LCOV);
  });

  it("throws for an unexpected body type", async () => {
    let callCount = 0;
    const client = makeClient(async (cmd) => {
      callCount++;
      if (cmd instanceof GetObjectCommand) {
        if (callCount === 1) return { Body: Buffer.from(POINTER) };
        return { Body: 12345 }; // not Readable, Uint8Array, or Blob
      }
      return {};
    });
    const store = new S3SuiteStore({ bucket: BUCKET, prefix: PREFIX, client });
    await expect(store.get("backend")).rejects.toThrow("unexpected S3 response body type");
  });
});

describe("S3SuiteStore — put()", () => {
  it("sends two PutObjectCommands: lcov payload and branch pointer", async () => {
    const client = makeClient(async () => ({}));
    const store = new S3SuiteStore({ bucket: BUCKET, prefix: PREFIX, client });
    await store.put("backend", Buffer.from(LCOV), { sha: "abc123", branch: "main" });

    expect(client.send).toHaveBeenCalledTimes(3);
    const cmds = client.send.mock.calls.map((c) => c[0]);
    expect(cmds.filter((c) => c instanceof PutObjectCommand)).toHaveLength(2);

    const keys = cmds.filter((c) => c instanceof PutObjectCommand).map((c) => c.input.Key);
    expect(keys).toContain(`${PREFIX}/backend/sha/abc123/lcov.info`);
    expect(keys).toContain(`${PREFIX}/backend/branch/${encodeBranchName("main")}/latest.json`);
  });

  it("uses provided timestamp in pointer", async () => {
    const client = makeClient(async () => ({}));
    const store = new S3SuiteStore({ bucket: BUCKET, prefix: PREFIX, client });
    const ts = "2026-05-01T00:00:00.000Z";
    await store.put("backend", Buffer.from(LCOV), {
      sha: "abc",
      branch: "main",
      timestamp: ts,
    });

    const pointerCmd = client.send.mock.calls
      .filter((c) => c[0] instanceof PutObjectCommand)
      .map((c) => c[0] as PutObjectCommand)
      .find((c) => c.input.Key?.endsWith("latest.json"))!;
    const pointer = JSON.parse((pointerCmd.input.Body as Buffer).toString("utf8"));
    expect(pointer.timestamp).toBe(ts);
  });

  it("rejects invalid incoming timestamps", async () => {
    const client = makeClient(async () => ({}));
    const store = new S3SuiteStore({ bucket: BUCKET, prefix: PREFIX, client });
    await expect(
      store.put("backend", Buffer.from(LCOV), {
        sha: "abc",
        branch: "main",
        timestamp: "not-a-date",
      }),
    ).rejects.toThrow("invalid timestamp");
  });

  it("generates a timestamp when none is provided", async () => {
    const client = makeClient(async () => ({}));
    const store = new S3SuiteStore({ bucket: BUCKET, prefix: PREFIX, client });
    await store.put("backend", Buffer.from(LCOV), { sha: "abc", branch: "main" });

    const pointerCmd = client.send.mock.calls
      .filter((c) => c[0] instanceof PutObjectCommand)
      .map((c) => c[0] as PutObjectCommand)
      .find((c) => (c as PutObjectCommand).input.Key?.endsWith("latest.json"))!;
    const pointer = JSON.parse((pointerCmd.input.Body as Buffer).toString("utf8"));
    expect(typeof pointer.timestamp).toBe("string");
    expect(pointer.timestamp.length).toBeGreaterThan(0);
  });

  it("works without a prefix", async () => {
    const client = makeClient(async () => ({}));
    const store = new S3SuiteStore({ bucket: BUCKET, client });
    await store.put("backend", Buffer.from(LCOV), { sha: "abc", branch: "main" });

    const keys = client.send.mock.calls
      .filter((c) => c[0] instanceof PutObjectCommand)
      .map((c) => (c[0] as PutObjectCommand).input.Key);
    expect(keys).toContain("backend/sha/abc/lcov.info");
    expect(keys).toContain(`backend/branch/${encodeBranchName("main")}/latest.json`);
  });

  it("accepts branch names with slashes by encoding the path component", async () => {
    const client = makeClient(async () => ({}));
    const store = new S3SuiteStore({ bucket: BUCKET, prefix: PREFIX, client });
    await store.put("backend", Buffer.from(LCOV), { sha: "abc", branch: "feature/foo" });

    const keys = client.send.mock.calls
      .filter((c) => c[0] instanceof PutObjectCommand)
      .map((c) => (c[0] as PutObjectCommand).input.Key);
    expect(keys).toContain(
      `${PREFIX}/backend/branch/${encodeBranchName("feature/foo")}/latest.json`,
    );
  });

  it("does not regress a branch pointer to an older timestamp", async () => {
    const current = JSON.stringify({ sha: "new", timestamp: "2026-01-02T00:00:00.000Z" });
    const client = makeClient(async (cmd) => {
      if (cmd instanceof GetObjectCommand) return { Body: Buffer.from(current) };
      return {};
    });
    const store = new S3SuiteStore({ bucket: BUCKET, prefix: PREFIX, client });
    await store.put("backend", Buffer.from(LCOV), {
      sha: "old",
      branch: "main",
      timestamp: "2026-01-01T00:00:00.000Z",
    });

    const putKeys = client.send.mock.calls
      .filter((c) => c[0] instanceof PutObjectCommand)
      .map((c) => (c[0] as PutObjectCommand).input.Key);
    expect(putKeys).toEqual([`${PREFIX}/backend/sha/old/lcov.info`]);
  });

  it("writes a branch pointer when no current pointer exists", async () => {
    const client = makeClient(async (cmd) => {
      if (cmd instanceof GetObjectCommand) return notFound();
      return {};
    });
    const store = new S3SuiteStore({ bucket: BUCKET, prefix: PREFIX, client });
    await store.put("backend", Buffer.from(LCOV), { sha: "abc", branch: "main" });

    const putKeys = client.send.mock.calls
      .filter((c) => c[0] instanceof PutObjectCommand)
      .map((c) => (c[0] as PutObjectCommand).input.Key);
    expect(putKeys).toEqual([
      `${PREFIX}/backend/sha/abc/lcov.info`,
      `${PREFIX}/backend/branch/${encodeBranchName("main")}/latest.json`,
    ]);
  });

  it("rethrows unexpected errors from pointer comparison", async () => {
    let callCount = 0;
    const client = makeClient(async () => {
      callCount++;
      if (callCount === 1) return {};
      throw new Error("pointer read failed");
    });
    const store = new S3SuiteStore({ bucket: BUCKET, prefix: PREFIX, client });
    await expect(
      store.put("backend", Buffer.from(LCOV), { sha: "abc", branch: "main" }),
    ).rejects.toThrow("pointer read failed");
  });

  it("writes the legacy layout when metadata is omitted", async () => {
    const client = makeClient(async () => ({}));
    const store = new S3SuiteStore({ bucket: BUCKET, prefix: PREFIX, client });
    await store.put("backend", Buffer.from(LCOV));

    const put = client.send.mock.calls[0][0] as PutObjectCommand;
    expect(put.input.Key).toBe(`${PREFIX}/backend/lcov.info`);
  });

  it("rejects partial pointer metadata", async () => {
    const client = makeClient(async () => ({}));
    const store = new S3SuiteStore({ bucket: BUCKET, prefix: PREFIX, client });
    await expect(store.put("backend", Buffer.from(LCOV), { sha: "abc" } as never)).rejects.toThrow(
      "invalid branch",
    );
    await expect(
      store.put("backend", Buffer.from(LCOV), { branch: "main" } as never),
    ).rejects.toThrow("invalid sha");
  });
});

describe("S3SuiteStore — path traversal protection", () => {
  const store = new S3SuiteStore({
    bucket: BUCKET,
    prefix: PREFIX,
    client: makeClient(async () => ({})),
  });
  const invalid = ["", ".", "..", "a/b", "a\\b"];
  for (const val of invalid) {
    it(`get() rejects suite=${JSON.stringify(val)}`, async () => {
      await expect(store.get(val)).rejects.toThrow("invalid suite");
    });
    it(`get() rejects sha=${JSON.stringify(val)}`, async () => {
      await expect(store.get("backend", { sha: val })).rejects.toThrow("invalid sha");
    });
    it(`put() rejects suite=${JSON.stringify(val)}`, async () => {
      await expect(store.put(val, Buffer.from(""), { sha: "abc", branch: "main" })).rejects.toThrow(
        "invalid suite",
      );
    });
    it(`put() rejects sha=${JSON.stringify(val)}`, async () => {
      await expect(
        store.put("backend", Buffer.from(""), { sha: val, branch: "main" }),
      ).rejects.toThrow("invalid sha");
    });
  }
});

describe("S3SuiteStore — constructor prefix normalization", () => {
  it("strips all trailing slashes from prefix", async () => {
    const client = makeClient(async () => ({ CommonPrefixes: [] }));
    const store = new S3SuiteStore({ bucket: BUCKET, prefix: "coverage///", client });
    expect(await store.list()).toEqual([]);
    const cmd = client.send.mock.calls[0][0] as InstanceType<typeof ListObjectsV2Command>;
    expect(cmd.input.Prefix).toBe("coverage/");
  });
});
