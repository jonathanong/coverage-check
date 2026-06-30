import { GetObjectCommand } from "@aws-sdk/client-s3";
import { encodeBranchName, isNewerTimestamp } from "./suite-store.mts";
import { bodyToBuffer, isNotFound } from "./s3-utils.mts";

export type StoredPointer = {
  sha: string;
  timestamp?: string;
  payloadKey?: string;
  encoding?: "gzip";
  rawBytes?: number;
  storedBytes?: number;
};

type ReadContext = {
  bucket: string;
  key(...parts: string[]): string;
  sendS3(operation: string, key: string, command: object): Promise<unknown>;
};

export async function getLegacy(ctx: ReadContext, suite: string): Promise<Buffer | null> {
  const key = ctx.key(suite, "lcov.info");
  try {
    const resp = (await ctx.sendS3(
      "get legacy coverage payload",
      key,
      new GetObjectCommand({
        Bucket: ctx.bucket,
        Key: key,
      }),
    )) as { Body: unknown };
    return bodyToBuffer(resp.Body);
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

export async function shouldWritePointer(
  ctx: ReadContext,
  suite: string,
  encodedBranch: string,
  incomingTimestamp: string,
): Promise<boolean> {
  const key = ctx.key(suite, "branch", encodedBranch, "latest.json");
  try {
    const resp = (await ctx.sendS3(
      "get branch pointer for compare",
      key,
      new GetObjectCommand({
        Bucket: ctx.bucket,
        Key: key,
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

export async function readPointer(
  ctx: ReadContext,
  suite: string,
  branch: string,
): Promise<StoredPointer> {
  const keys = [
    ctx.key(suite, "branch", encodeBranchName(branch), "latest.json"),
    ctx.key(suite, "branch", branch, "latest.json"),
  ];
  let lastNotFound: unknown;
  for (const key of keys) {
    try {
      const resp = (await ctx.sendS3(
        "get branch pointer",
        key,
        new GetObjectCommand({ Bucket: ctx.bucket, Key: key }),
      )) as { Body: unknown };
      const body = await bodyToBuffer(resp.Body);
      return JSON.parse(body.toString("utf8")) as StoredPointer;
    } catch (err) {
      if (!isNotFound(err)) throw err;
      lastNotFound = err;
    }
  }
  throw lastNotFound;
}
