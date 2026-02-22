# Changelog

All notable changes to this project will be documented in this file.

## [1.0.0] — 2026-02-22

### Fixed

- **FileInput + adapter helpers** — The original upload() took a Web API File, which doesn't exist on the server. The new design decouples the input type entirely. fromMulterFile() and fromWebFile() are standalone adapter functions that normalise both caller shapes into a plain FileInput object. Your pipeline steps call the appropriate adapter before calling upload().
- **ACL removed from PutObjectCommand** — Passing any ACL header to a bucket with BucketOwnerEnforced throws a hard AWS error. ACL is now omitted entirely. The comment explains the one edge case (pre-April 2023 buckets) where you might need to re-add it.
- **UUID-based filenames** — generateFileName (timestamp-based) is replaced by makeUniqueFileName (UUID + extension). Timestamps collide under concurrent uploads; UUIDs don't.
- **No signed URL returned from upload()** — upload() now returns UploadResult with the key and metadata only. Signed URLs are generated on demand via the new standalone getSignedUrl() method, which is what you call in your retrieval route.

### Added

- **getSignedUrl(key, options)** — Standalone, with disposition: 'inline' | 'attachment' and fileName support for correct Content-Disposition headers. Inline for images/PDFs rendered in the browser, attachment for forced downloads.
- **delete(key)** — Needed for cleanup when discarding originals after compression, and for hard-deleting soft-deleted records. S3 delete is idempotent so it won't throw on missing keys.
- **deleteMany(keys[])** — For removing a file and all its variants (original + compressed + thumbnail) in one call. Chunks at 1000 to respect the S3 limit.
- **copy(sourceKey, destKey)** — For future use when cloning entities that own files (e.g. duplicating a note or template).
- **list(options)** — Paginated listing via ListObjectsV2. This is what your nightly storage reconciliation job will use to walk the bucket and verify byte counts against the database.
- **exists(key)** — Lightweight check useful for data integrity validation.

### Changed

- The upload() method now accepts options.key as a full explicit S3 key.
