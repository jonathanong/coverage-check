import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand } from "@aws-sdk/client-s3";
import { gunzipSync, gzipSync } from "node:zlib";
import { assertSafePathComponent, assertValidTimestamp, encodeBranchName } from "./suite-store.mts";
import { createS3Client, sendS3 } from "./s3-diagnostics.mts";
import { getLegacy, readPointer, shouldWritePointer } from "./s3-suite-store-reads.mts";
import { bodyToBuffer, isNotFound } from "./s3-utils.mts";
import type { ClientLike, S3OperationDetails } from "./s3-diagnostics.mts";
import type { StoredPointer } from "./s3-suite-store-reads.mts";
import type { SuitePutMeta, SuiteStore } from "./suite-store.mts";

export type S3SuiteStoreOptions = {
  bucket: string;
  prefix?: string;
  region?: string;
  /** Inject a custom S3 client (e.g. for testing). */
  client?: ClientLike;
};

export class S3SuiteStore implements SuiteStore {
  readonly bucket: string;
  private readonly prefix: string;
  private readonly client: ClientLike;

  constructor({ bucket, prefix, region, client }: S3SuiteStoreOptions) {
    this.bucket = bucket;
    this.prefix = prefix ? prefix.replace(/\/+$/, "") : "";
    this.client = client ?? createS3Client(region);
  }

  key(...parts: string[]): string {
    return this.prefix ? [this.prefix, ...parts].join("/") : parts.join("/");
  }

  async list(): Promise<string[]> {
    const pfx = this.prefix ? `${this.prefix}/` : "";
    const suites: string[] = [];
    let continuationToken: string | undefined;
    do {
      const resp = (await this.sendS3(
        "list suites",
        this.key(),
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: pfx,
          Delimiter: "/",
          ...(continuationToken ? { ContinuationToken: continuationToken } : {}),
        }),
      )) as {
        CommonPrefixes?: { Prefix?: string }[];
        IsTruncated?: boolean;
        NextContinuationToken?: string;
      };
      suites.push(
        ...(resp.CommonPrefixes ?? [])
          .map((cp) => cp.Prefix?.replace(pfx, "").replace(/\/$/, "") ?? "")
          .filter(Boolean),
      );
      continuationToken = resp.IsTruncated ? resp.NextContinuationToken : undefined;
    } while (continuationToken);
    return suites;
  }

  async get(suite: string, opts?: { sha?: string; branch?: string }): Promise<Buffer | null> {
    assertSafePathComponent(suite, "suite");
    if (opts?.sha !== undefined) assertSafePathComponent(opts.sha, "sha");
    let sha = opts?.sha;
    let pointer: StoredPointer | null = null;
    if (!sha) {
      const branch = opts?.branch ?? "main";
      try {
        pointer = await readPointer(this, suite, branch);
        assertSafePathComponent(pointer.sha, "sha");
        sha = pointer.sha;
      } catch (err) {
        if (isNotFound(err)) return getLegacy(this, suite);
        throw err;
      }
    }
    return this.getVersionedPayload(suite, sha, pointer, opts?.sha !== undefined);
  }

  async put(suite: string, lcov: Buffer, meta?: SuitePutMeta): Promise<void> {
    assertSafePathComponent(suite, "suite");
    if (meta === undefined) {
      await this.putLegacyPayload(suite, lcov);
      return;
    }
    const { sha, branch } = meta;
    assertSafePathComponent(sha, "sha");
    const ts = meta.timestamp ?? new Date().toISOString();
    assertValidTimestamp(ts);
    const payload = gzipSync(lcov);
    const payloadKey = this.key(suite, "sha", sha, "lcov.info.gz");
    await this.sendS3(
      "put coverage payload",
      payloadKey,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: payloadKey,
        Body: payload,
        ContentEncoding: "gzip",
        ContentType: "text/plain",
      }),
      { rawBytes: lcov.byteLength, storedBytes: payload.byteLength },
    );
    if (!(await shouldWritePointer(this, suite, branch, ts))) return;
    await this.putPointer(suite, branch, sha, ts, payloadKey, lcov.byteLength, payload.byteLength);
  }

  sendS3(
    operation: string,
    key: string,
    command: object,
    details: S3OperationDetails = {},
  ): Promise<unknown> {
    return sendS3(this.client, this.bucket, operation, key, command, details);
  }

  private async getVersionedPayload(
    suite: string,
    sha: string,
    pointer: StoredPointer | null,
    explicitSha: boolean,
  ): Promise<Buffer | null> {
    const candidates =
      pointer?.payloadKey !== undefined
        ? [{ key: pointer.payloadKey, encoding: pointer.encoding }]
        : explicitSha
          ? [
              { key: this.key(suite, "sha", sha, "lcov.info.gz"), encoding: "gzip" as const },
              { key: this.key(suite, "sha", sha, "lcov.info"), encoding: undefined },
            ]
          : [{ key: this.key(suite, "sha", sha, "lcov.info"), encoding: undefined }];
    for (const candidate of candidates) {
      try {
        const resp = (await this.sendS3(
          "get coverage payload",
          candidate.key,
          new GetObjectCommand({
            Bucket: this.bucket,
            Key: candidate.key,
          }),
        )) as { Body: unknown };
        const body = await bodyToBuffer(resp.Body);
        return candidate.encoding === "gzip" ? gunzipSync(body) : body;
      } catch (err) {
        if (!isNotFound(err)) throw err;
      }
    }
    return null;
  }

  private async putLegacyPayload(suite: string, lcov: Buffer): Promise<void> {
    const key = this.key(suite, "lcov.info");
    await this.sendS3(
      "put legacy coverage payload",
      key,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: lcov,
        ContentType: "text/plain",
      }),
    );
  }

  private async putPointer(
    suite: string,
    branch: string,
    sha: string,
    timestamp: string,
    payloadKey: string,
    rawBytes: number,
    storedBytes: number,
  ): Promise<void> {
    const pointerKey = this.key(suite, "branch", encodeBranchName(branch), "latest.json");
    await this.sendS3(
      "put branch pointer",
      pointerKey,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: pointerKey,
        Body: Buffer.from(
          JSON.stringify({
            sha,
            timestamp,
            payloadKey,
            encoding: "gzip",
            rawBytes,
            storedBytes,
          }),
          "utf8",
        ),
        ContentType: "application/json",
      }),
    );
  }
}
