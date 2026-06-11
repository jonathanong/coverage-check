import { S3Client } from "@aws-sdk/client-s3";
import { NodeHttpHandler } from "@smithy/node-http-handler";

export type ClientLike = { send(cmd: object): Promise<unknown> };

export type S3OperationDetails = {
  rawBytes?: number;
  storedBytes?: number;
};

export function createS3Client(region?: string): ClientLike {
  return new S3Client({
    maxAttempts: readPositiveIntEnv("COVERAGE_CHECK_S3_MAX_ATTEMPTS", 2),
    region,
    requestHandler: new NodeHttpHandler({
      connectionTimeout: readPositiveIntEnv("COVERAGE_CHECK_S3_CONNECTION_TIMEOUT_MS", 5000),
      requestTimeout: readPositiveIntEnv("COVERAGE_CHECK_S3_REQUEST_TIMEOUT_MS", 30000),
    }),
  });
}

export async function sendS3(
  client: ClientLike,
  bucket: string,
  operation: string,
  key: string,
  command: object,
  details: S3OperationDetails = {},
): Promise<unknown> {
  const start = performance.now();
  try {
    const result = await client.send(command);
    logS3(bucket, operation, key, "ok", performance.now() - start, details);
    return result;
  } catch (err) {
    logS3(bucket, operation, key, "failed", performance.now() - start, {
      ...details,
      error: formatError(err),
    });
    throw err;
  }
}

function logS3(
  bucket: string,
  operation: string,
  key: string,
  status: "ok" | "failed",
  elapsedMs: number,
  details: S3OperationDetails & { error?: string },
): void {
  const parts = [
    "coverage-check s3",
    `operation=${JSON.stringify(operation)}`,
    `status=${status}`,
    `bucket=${JSON.stringify(bucket)}`,
    `key=${JSON.stringify(key)}`,
    `elapsed_ms=${Math.round(elapsedMs)}`,
  ];
  if (details.rawBytes !== undefined) parts.push(`raw_bytes=${details.rawBytes}`);
  if (details.storedBytes !== undefined) parts.push(`stored_bytes=${details.storedBytes}`);
  if (details.error !== undefined) parts.push(`error=${JSON.stringify(details.error)}`);
  process.stderr.write(`${parts.join(" ")}\n`);
}

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    process.stderr.write(
      `coverage-check s3 invalid ${name}=${JSON.stringify(raw)}; using ${fallback}\n`,
    );
    return fallback;
  }
  return value;
}

function formatError(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}
