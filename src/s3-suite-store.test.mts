import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand } from "@aws-sdk/client-s3";
import { S3SuiteStore } from "./s3-suite-store.mts";

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

    expect(client.send).toHaveBeenCalledTimes(2);
    const cmds = client.send.mock.calls.map((c) => c[0]);
    expect(cmds.every((c) => c instanceof PutObjectCommand)).toBe(true);

    const keys = cmds.map((c) => (c as PutObjectCommand).input.Key);
    expect(keys).toContain(`${PREFIX}/backend/sha/abc123/lcov.info`);
    expect(keys).toContain(`${PREFIX}/backend/branch/main/latest.json`);
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
      .map((c) => c[0] as PutObjectCommand)
      .find((c) => c.input.Key?.endsWith("latest.json"))!;
    const pointer = JSON.parse((pointerCmd.input.Body as Buffer).toString("utf8"));
    expect(pointer.timestamp).toBe(ts);
  });

  it("generates a timestamp when none is provided", async () => {
    const client = makeClient(async () => ({}));
    const store = new S3SuiteStore({ bucket: BUCKET, prefix: PREFIX, client });
    await store.put("backend", Buffer.from(LCOV), { sha: "abc", branch: "main" });

    const pointerCmd = client.send.mock.calls
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

    const keys = client.send.mock.calls.map((c) => (c[0] as PutObjectCommand).input.Key);
    expect(keys).toContain("backend/sha/abc/lcov.info");
    expect(keys).toContain("backend/branch/main/latest.json");
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
    it(`get() rejects branch=${JSON.stringify(val)}`, async () => {
      await expect(store.get("backend", { branch: val })).rejects.toThrow("invalid branch");
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
    it(`put() rejects branch=${JSON.stringify(val)}`, async () => {
      await expect(
        store.put("backend", Buffer.from(""), { sha: "abc", branch: val }),
      ).rejects.toThrow("invalid branch");
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
