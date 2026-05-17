import {
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import {
  assertSafePathComponent,
  assertValidTimestamp,
  encodeBranchName,
  isNewerTimestamp,
} from "./suite-store.mts";
import { bodyToBuffer, isNotFound } from "./s3-utils.mts";
import type { SuitePutMeta, SuiteStore } from "./suite-store.mts";

type ClientLike = { send(cmd: object): Promise<unknown> };

export type S3SuiteStoreOptions = {
  bucket: string;
  prefix?: string;
  region?: string;
  /** Inject a custom S3 client (e.g. for testing). */
  client?: ClientLike;
};

export class S3SuiteStore implements SuiteStore {
  private readonly bucket: string;
  private readonly prefix: string;
  private readonly client: ClientLike;

  constructor({ bucket, prefix, region, client }: S3SuiteStoreOptions) {
    this.bucket = bucket;
    this.prefix = prefix ? prefix.replace(/\/+$/, "") : "";
    this.client = client ?? new S3Client({ region });
  }

  private key(...parts: string[]): string {
    return this.prefix ? [this.prefix, ...parts].join("/") : parts.join("/");
  }

  async list(): Promise<string[]> {
    const pfx = this.prefix ? `${this.prefix}/` : "";
    const suites: string[] = [];
    let continuationToken: string | undefined;
    do {
      const resp = (await this.client.send(
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
    if (!sha) {
      const branch = opts?.branch ?? "main";
      try {
        const pointer = await this.readPointer(suite, branch);
        assertSafePathComponent(pointer.sha, "sha");
        sha = pointer.sha;
      } catch (err) {
        if (isNotFound(err)) return this.getLegacy(suite);
        throw err;
      }
    }
    try {
      const resp = (await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: this.key(suite, "sha", sha, "lcov.info"),
        }),
      )) as { Body: unknown };
      return bodyToBuffer(resp.Body);
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async put(suite: string, lcov: Buffer, meta?: SuitePutMeta): Promise<void> {
    assertSafePathComponent(suite, "suite");
    if (meta === undefined) {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: this.key(suite, "lcov.info"),
          Body: lcov,
          ContentType: "text/plain",
        }),
      );
      return;
    }
    const { sha, branch } = meta;
    assertSafePathComponent(sha, "sha");
    const ts = meta.timestamp ?? new Date().toISOString();
    assertValidTimestamp(ts);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.key(suite, "sha", sha, "lcov.info"),
        Body: lcov,
        ContentType: "text/plain",
      }),
    );
    if (!(await this.shouldWritePointer(suite, branch, ts))) return;
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.key(suite, "branch", encodeBranchName(branch), "latest.json"),
        Body: Buffer.from(JSON.stringify({ sha, timestamp: ts }), "utf8"),
        ContentType: "application/json",
      }),
    );
  }

  private async getLegacy(suite: string): Promise<Buffer | null> {
    try {
      const resp = (await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: this.key(suite, "lcov.info"),
        }),
      )) as { Body: unknown };
      return bodyToBuffer(resp.Body);
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  private async shouldWritePointer(
    suite: string,
    branch: string,
    incomingTimestamp: string,
  ): Promise<boolean> {
    try {
      const resp = (await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: this.key(suite, "branch", encodeBranchName(branch), "latest.json"),
        }),
      )) as { Body: unknown };
      if (resp.Body === undefined) return true;
      const body = await bodyToBuffer(resp.Body);
      const current = JSON.parse(body.toString("utf8")) as { timestamp?: string };
      return !isNewerTimestamp(current.timestamp, incomingTimestamp);
    } catch (err) {
      if (isNotFound(err)) return true;
      throw err;
    }
  }

  private async readPointer(
    suite: string,
    branch: string,
  ): Promise<{ sha: string; timestamp?: string }> {
    const keys = [
      this.key(suite, "branch", encodeBranchName(branch), "latest.json"),
      this.key(suite, "branch", branch, "latest.json"),
    ];
    let lastNotFound: unknown;
    for (const key of keys) {
      try {
        const resp = (await this.client.send(
          new GetObjectCommand({ Bucket: this.bucket, Key: key }),
        )) as { Body: unknown };
        const body = await bodyToBuffer(resp.Body);
        return JSON.parse(body.toString("utf8")) as { sha: string; timestamp?: string };
      } catch (err) {
        if (!isNotFound(err)) throw err;
        lastNotFound = err;
      }
    }
    throw lastNotFound;
  }
}
