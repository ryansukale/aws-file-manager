# AWS File Manager

A TypeScript library for managing files in AWS S3. Handles uploads, signed URL generation, downloads, deletes, copies, and bucket listing — with full TypeScript types and a clean API designed for server-side Node.js applications.

## Installation

```bash
npm install @allegria/aws-file-manager
```

## Why this library

- **No ACL footgun.** ACL headers are omitted by default, which is correct for all buckets created after April 2023 (BucketOwnerEnforced). Passing an ACL to such a bucket throws a hard AWS error.
- **UUID filenames.** `generateUniqueFileName: true` replaces the original filename with a UUID while preserving the extension. Timestamps collide under concurrent uploads; UUIDs don't.
- **Keys and signed URLs are separate.** `upload()` returns only the S3 key (persist this to your database). `getSignedUrl()` is a separate call you make at request time — signed URLs expire and must never be stored.

## Quick start

```ts
import { AwsFileManager, fromMulterFile } from "@allegria/aws-file-manager";

const fileManager = new AwsFileManager({
  region: "us-east-1",
  bucketName: "my-app-uploads",
  basePath: "uploads",          // optional: namespaces all keys under this prefix
});

// In an Express/multer route:
const fileInput = fromMulterFile(req.file);

const result = await fileManager.upload(fileInput, {
  folder: "avatars",
  generateUniqueFileName: true,
});

// Persist result.key to your database — not the URL
// await db.files.create({ s3Key: result.key });

// Generate a signed URL on demand (e.g. when serving the file to a client)
const url = await fileManager.getSignedUrl(result.key, {
  disposition: "inline",
});
```

## Core concepts

### FileInput and adapters

`upload()` takes a `FileInput` — a normalised object with `buffer`, `originalName`, `mimeType`, and `size`. Use the provided adapters to construct one:

```ts
// Express + multer (server-side)
import { fromMulterFile } from "@allegria/aws-file-manager";
const fileInput = fromMulterFile(req.file);

// Next.js App Router / Web API File (browser or edge)
import { fromWebFile } from "@allegria/aws-file-manager";
const fileInput = await fromWebFile(formData.get("file") as File);

// Or build it directly
const fileInput: FileInput = {
  buffer: myBuffer,
  originalName: "photo.jpg",
  mimeType: "image/jpeg",
  size: myBuffer.length,
};
```

### Keys vs signed URLs

| What | Where to store | Lifetime |
|---|---|---|
| S3 key (`result.key`) | Your database | Permanent |
| Signed URL | Never store | Minutes to hours |

The S3 key is the stable identifier for a file. Generate a signed URL at request time when you need to give a client access to a private file.

### basePath namespacing

Set `basePath` in the constructor to prefix every key with a sub-folder:

```ts
const fm = new AwsFileManager({ ..., basePath: "uploads" });
// upload to folder 'avatars' → key: 'uploads/avatars/<filename>'
```

## API reference

### Constructor

```ts
new AwsFileManager(config: AwsFileManagerConfig)
```

See [Configuration reference](#configuration-reference) below.

### Methods

| Method | Signature | Returns | Notes |
|---|---|---|---|
| `upload` | `(file: FileInput, options?: UploadOptions)` | `Promise<UploadResult>` | Stores the file; returns key + metadata |
| `getSignedUrl` | `(key: string, options?: SignedUrlOptions)` | `Promise<string>` | Short-lived presigned URL for private objects |
| `download` | `(key: string, mode?: 'buffer' \| 'stream')` | `Promise<DownloadResult \| null>` | Returns `null` when key not found |
| `delete` | `(key: string)` | `Promise<void>` | Idempotent — missing key does not throw |
| `deleteMany` | `(keys: string[])` | `Promise<void>` | Chunks at 1 000 keys per S3 request |
| `copy` | `(sourceKey, destKey, options?)` | `Promise<void>` | Server-side copy within the bucket |
| `list` | `(options?: ListOptions)` | `Promise<ListResult>` | Paginated via `continuationToken` |
| `exists` | `(key: string)` | `Promise<boolean>` | Lightweight key existence check |
| `getS3Client` | `()` | `S3Client` | Access the underlying client for advanced use |

### Adapter functions

| Function | Signature | Notes |
|---|---|---|
| `fromMulterFile` | `(multerFile) => FileInput` | Sync — for Express + multer |
| `fromWebFile` | `(webFile: File) => Promise<FileInput>` | Async — for Web API File / Next.js App Router |

## Examples

The `examples/` directory contains runnable TypeScript snippets for every method:

| File | Description |
|---|---|
| [01-setup.ts](examples/01-setup.ts) | Instantiation: explicit credentials, env vars, IAM role |
| [02-upload-multer.ts](examples/02-upload-multer.ts) | Upload from Express + multer |
| [03-upload-web.ts](examples/03-upload-web.ts) | Upload from Next.js App Router (Web API File) |
| [04-signed-urls.ts](examples/04-signed-urls.ts) | Inline, attachment, and custom-TTL signed URLs |
| [05-download.ts](examples/05-download.ts) | Download as Buffer or stream; pipe to HTTP response |
| [06-delete.ts](examples/06-delete.ts) | Delete single file or all variants at once |
| [07-copy.ts](examples/07-copy.ts) | Copy / move objects (server-side, no re-upload) |
| [08-list-paginated.ts](examples/08-list-paginated.ts) | Paginated listing for reconciliation jobs |
| [09-exists.ts](examples/09-exists.ts) | Key existence check for integrity validation |

## Configuration reference

```ts
interface AwsFileManagerConfig {
  region: string;                // AWS region, e.g. 'us-east-1'
  bucketName: string;            // S3 bucket name
  accessKeyId?: string;          // Omit to use environment/IAM resolution
  secretAccessKey?: string;      // Omit to use environment/IAM resolution
  basePath?: string;             // Prefix for all keys, e.g. 'uploads'
  urlExpirationSeconds?: number; // Signed URL TTL (default: 3600)
  storageClass?: StorageClass;   // Default storage class (default: INTELLIGENT_TIERING)
}
```

**Credential resolution order** (when `accessKeyId`/`secretAccessKey` are omitted):

1. `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` environment variables
2. `~/.aws/credentials` file
3. EC2/ECS/Lambda instance metadata (IAM role) — recommended for production

## Notes

**ACL behaviour.** No ACL is sent with `PutObjectCommand`. This is correct for all S3 buckets created after April 2023, which use `BucketOwnerEnforced` by default. If your bucket predates that change and requires legacy ACLs, call `getS3Client()` and issue the command directly.

**Storage class.** The default storage class is `INTELLIGENT_TIERING`, which automatically moves objects between access tiers based on usage patterns. Override per-upload via `UploadOptions.storageClass`, or change the instance default via `AwsFileManagerConfig.storageClass`.

**`deleteMany` chunking.** The S3 batch delete API accepts at most 1 000 keys per request. `deleteMany` splits larger arrays into 1 000-key chunks and sends them in parallel automatically.

## Development

```bash
pnpm test          # run tests once
pnpm test:watch    # run tests in watch mode
pnpm build         # compile TypeScript
```

## License

MIT
