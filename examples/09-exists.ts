/**
 * 09-exists.ts
 *
 * Checking whether an S3 object exists at a given key.
 *
 * Key points:
 *   - `exists()` returns `false` for missing keys; it does not throw.
 *   - Useful as a lightweight data integrity check before an operation.
 *   - Not a replacement for proper error handling — network errors still throw.
 */

import { AwsFileManager } from "@allegria/aws-file-manager";

const fileManager = new AwsFileManager({
  region: process.env.AWS_REGION ?? "us-east-1",
  bucketName: process.env.S3_BUCKET_NAME!,
});

// ─── Guard before serving a file ─────────────────────────────────────────────
async function assertFileExists(s3Key: string): Promise<void> {
  const found = await fileManager.exists(s3Key);
  if (!found) {
    throw new Error(`Storage integrity error: file missing at key "${s3Key}"`);
  }
}

// ─── Skip re-uploading if the file is already there ──────────────────────────
async function uploadIfAbsent(
  s3Key: string,
  uploadFn: () => Promise<void>,
): Promise<void> {
  if (await fileManager.exists(s3Key)) {
    console.log(`Skipping upload — key already exists: ${s3Key}`);
    return;
  }
  await uploadFn();
}

export { assertFileExists, uploadIfAbsent };
