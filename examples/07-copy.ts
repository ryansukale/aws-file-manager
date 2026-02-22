/**
 * 07-copy.ts
 *
 * Copying an S3 object within the same bucket.
 *
 * Key points:
 *   - `copy()` is a server-side operation — no bytes move through your server.
 *   - Use it when duplicating entities that own files (e.g. cloning a template).
 *   - Pass `metadata` to override the copied object's metadata; omit it to
 *     inherit the source object's metadata (MetadataDirective=COPY).
 */

import { AwsFileManager } from "@allegria/aws-file-manager";
import { randomUUID } from "crypto";

const fileManager = new AwsFileManager({
  region: process.env.AWS_REGION ?? "us-east-1",
  bucketName: process.env.S3_BUCKET_NAME!,
  basePath: "uploads",
});

// ─── Clone a template document ───────────────────────────────────────────────
async function cloneDocument(
  sourceKey: string,
  targetOwnerId: string,
): Promise<string> {
  const ext = sourceKey.substring(sourceKey.lastIndexOf("."));
  const destKey = `uploads/${targetOwnerId}/${randomUUID()}${ext}`;

  await fileManager.copy(sourceKey, destKey);

  console.log(`Copied ${sourceKey} → ${destKey}`);
  return destKey;
}

// ─── Reorganise a key (rename/move) ──────────────────────────────────────────
// S3 has no rename — copy to the new key, then delete the old one.
async function moveObject(
  sourceKey: string,
  destKey: string,
): Promise<void> {
  await fileManager.copy(sourceKey, destKey);
  await fileManager.delete(sourceKey);
  console.log(`Moved ${sourceKey} → ${destKey}`);
}

export { cloneDocument, moveObject };
