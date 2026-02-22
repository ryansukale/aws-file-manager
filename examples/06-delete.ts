/**
 * 06-delete.ts
 *
 * Deleting one or many S3 objects.
 *
 * Key points:
 *   - `delete()` is idempotent — calling it on a missing key does not throw.
 *   - Always soft-delete your DB record first, then call `delete()` as cleanup.
 *     A crash between the two steps leaves a recoverable S3 orphan rather than
 *     a missing file with an intact DB row.
 *   - `deleteMany()` is for removing a file and all its variants in one call.
 *     It chunks automatically at 1 000 keys to respect the S3 limit.
 */

import { AwsFileManager } from "@allegria/aws-file-manager";

const fileManager = new AwsFileManager({
  region: process.env.AWS_REGION ?? "us-east-1",
  bucketName: process.env.S3_BUCKET_NAME!,
});

// ─── Delete a single file ─────────────────────────────────────────────────────
async function deleteFile(s3Key: string): Promise<void> {
  // 1. Soft-delete the DB record first
  // await db.files.update({ id: fileId, deletedAt: new Date() });

  // 2. Remove the S3 object as a cleanup step
  await fileManager.delete(s3Key);
  console.log(`Deleted: ${s3Key}`);
}

// ─── Delete a file and all its variants ──────────────────────────────────────
// After uploading, your pipeline may generate additional variants (thumbnails,
// compressed copies). Store all their keys and delete them together.
async function deleteWithVariants(
  originalKey: string,
  thumbnailKey: string,
  compressedKey: string,
): Promise<void> {
  await fileManager.deleteMany([originalKey, thumbnailKey, compressedKey]);
  console.log("Deleted original + all variants");
}

// ─── Batch delete from a reconciliation job ───────────────────────────────────
// If you have a list of orphaned keys (e.g. found by `list()` but absent from
// your DB), delete them all at once. `deleteMany` handles chunking internally.
async function deleteOrphans(orphanKeys: string[]): Promise<void> {
  if (orphanKeys.length === 0) return;
  await fileManager.deleteMany(orphanKeys);
  console.log(`Deleted ${orphanKeys.length} orphaned objects`);
}

export { deleteFile, deleteWithVariants, deleteOrphans };
