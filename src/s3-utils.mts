import { Readable } from "node:stream";
import { buffer } from "node:stream/consumers";

export function isNotFound(err: unknown): boolean {
  return err instanceof Error && (err.name === "NoSuchKey" || err.name === "NotFound");
}

export async function bodyToBuffer(body: unknown): Promise<Buffer> {
  if (body instanceof Readable) return buffer(body);
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (body instanceof Blob) return Buffer.from(await body.arrayBuffer());
  throw new Error("unexpected S3 response body type");
}
