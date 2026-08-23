import { Readable } from "node:stream";
import { buffer } from "node:stream/consumers";

export function isNotFound(err: unknown): boolean {
  return err instanceof Error && (err.name === "NoSuchKey" || err.name === "NotFound");
}

export function isConditionalWriteConflict(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const status = (err as Error & { $metadata?: { httpStatusCode?: number } }).$metadata
    ?.httpStatusCode;
  return (
    err.name === "PreconditionFailed" ||
    err.name === "ConditionalRequestConflict" ||
    status === 409 ||
    status === 412
  );
}

export async function bodyToBuffer(body: unknown): Promise<Buffer> {
  if (body instanceof Readable) return buffer(body);
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (body instanceof Blob) return Buffer.from(await body.arrayBuffer());
  throw new Error("unexpected S3 response body type");
}
