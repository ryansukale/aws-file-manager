/**
 * 08-list-paginated.ts
 *
 * Listing objects under a prefix, with pagination.
 *
 * Key points:
 *   - Each call returns up to 1 000 entries (S3 maximum per request).
 *   - `hasMore` and `continuationToken` drive the pagination loop.
 *   - Primarily used for nightly storage reconciliation jobs that walk the
 *     bucket and verify byte counts against the database.
 */

import { AwsFileManager, ListEntry } from "@lib/aws-file-manager";

const fileManager = new AwsFileManager({
  region: process.env.AWS_REGION ?? "us-east-1",
  bucketName: process.env.S3_BUCKET_NAME!,
  basePath: "uploads",
});

// ─── Collect all entries under a folder ──────────────────────────────────────
async function listAll(folder: string): Promise<ListEntry[]> {
  const allEntries: ListEntry[] = [];
  let token: string | undefined;

  do {
    const result = await fileManager.list({
      folder,
      continuationToken: token,
    });
    allEntries.push(...result.entries);
    token = result.continuationToken;
  } while (token);

  console.log(`Found ${allEntries.length} objects in '${folder}'`);
  return allEntries;
}

// ─── Process large result sets in pages ──────────────────────────────────────
// Avoid accumulating everything in memory when the bucket is very large.
async function reconcileStorage(folder: string): Promise<void> {
  let token: string | undefined;
  let totalBytes = 0;
  let pageCount = 0;

  do {
    const result = await fileManager.list({
      folder,
      maxResults: 500, // smaller pages for memory-constrained jobs
      continuationToken: token,
    });

    pageCount++;
    for (const entry of result.entries) {
      totalBytes += entry.size;
      // Compare entry.key / entry.size against your database here
    }

    token = result.continuationToken;
  } while (token);

  console.log(`Reconciled ${pageCount} page(s), total: ${totalBytes} bytes`);
}

// ─── Filter by prefix within a folder ────────────────────────────────────────
async function listByPrefix(folder: string, prefix: string): Promise<ListEntry[]> {
  const result = await fileManager.list({ folder, prefix });
  return result.entries;
}

export { listAll, reconcileStorage, listByPrefix };
