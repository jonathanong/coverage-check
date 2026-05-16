import { buffer } from "node:stream/consumers";
import { Readable } from "node:stream";
import {
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { assertSafePathComponent } from "./suite-store.mts";
import type { SuiteMeta, SuiteStore } from "./suite-store.mts";

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
    this.prefix = prefix ? prefix.replace(/\/$/, "") : "";
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
      assertSafePathComponent(branch, "branch");
      try {
        const resp = (await this.client.send(
          new GetObjectCommand({
            Bucket: this.bucket,
            Key: this.key(suite, "branch", branch, "latest.json"),
          }),
        )) as { Body: unknown };
        const body = await bodyToBuffer(resp.Body);
        const parsed = (JSON.parse(body.toString("utf8")) as { sha: string }).sha;
        assertSafePathComponent(parsed, "sha");
        sha = parsed;
      } catch (err) {
        if (isNotFound(err)) return null;
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

  async put(
    suite: string,
    lcov: Buffer,
    meta: SuiteMeta & { sha: string; branch: string },
  ): Promise<void> {
    assertSafePathComponent(suite, "suite");
    assertSafePathComponent(meta.sha, "sha");
    assertSafePathComponent(meta.branch, "branch");
    const ts = meta.timestamp ?? new Date().toISOString();
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.key(suite, "sha", meta.sha, "lcov.info"),
        Body: lcov,
        ContentType: "text/plain",
      }),
    );
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.key(suite, "branch", meta.branch, "latest.json"),
        Body: Buffer.from(JSON.stringify({ sha: meta.sha, timestamp: ts }), "utf8"),
        ContentType: "application/json",
      }),
    );
  }
}

function isNotFound(err: unknown): boolean {
  return err instanceof Error && (err.name === "NoSuchKey" || err.name === "NotFound");
}

async function bodyToBuffer(body: unknown): Promise<Buffer> {
  if (body instanceof Readable) return buffer(body);
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (body instanceof Blob) return Buffer.from(await body.arrayBuffer());
  throw new Error("unexpected S3 response body type");
}
