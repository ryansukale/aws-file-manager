import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  CopyObjectCommand,
  ListObjectsV2Command,
  StorageClass,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "crypto";
import type { Readable } from "stream";

// ---------------------------------------------------------------------------
// Config & Options
// ---------------------------------------------------------------------------

/**
 * Configuration options for AwsFileManager.
 * Credentials are optional — when omitted, the SDK resolves them from the
 * environment (IAM role, AWS_ACCESS_KEY_ID, ~/.aws/credentials, etc.).
 * Prefer environment/IAM resolution in production.
 */
export interface AwsFileManagerConfig {
  /** AWS region, e.g. 'us-east-1' */
  region: string;
  /** S3 bucket name */
  bucketName: string;
  /** AWS access key ID — omit to rely on environment/IAM resolution */
  accessKeyId?: string;
  /** AWS secret access key — omit to rely on environment/IAM resolution */
  secretAccessKey?: string;
  /**
   * Base path prefix prepended to every key (no leading/trailing slashes).
   * Useful for namespacing all writes to a sub-folder, e.g. 'uploads'.
   */
  basePath?: string;
  /** Signed URL TTL in seconds (default: 3600) */
  urlExpirationSeconds?: number;
  /** Default S3 storage class (default: INTELLIGENT_TIERING) */
  storageClass?: StorageClass;
}

/**
 * A normalised file input that works for both server-side (multer Buffer) and
 * browser-side (Web API File) callers. Use `fromMullerFile()` or
 * `fromWebFile()` helpers to construct one, or build it directly.
 */
export interface FileInput {
  /** Raw file bytes */
  buffer: Buffer;
  /** Original filename as provided by the uploader */
  originalName: string;
  /** MIME type, e.g. 'image/jpeg' */
  mimeType: string;
  /** File size in bytes */
  size: number;
}

/** Options that control how a single file is stored in S3. */
export interface UploadOptions {
  /**
   * Full S3 key (path + filename) for this object, relative to basePath.
   * When provided, `folder` and `generateUniqueFileName` are ignored.
   * Prefer this in pipeline usage where the calling code owns key generation.
   */
  key?: string;
  /**
   * Folder path appended to basePath (no leading/trailing slashes).
   * Used when `key` is not provided.
   */
  folder?: string;
  /**
   * Custom filename to use instead of originalName.
   * Used when `key` is not provided.
   */
  fileName?: string;
  /**
   * When true and `key` is not provided, replaces the filename with a UUID
   * while preserving the extension. Prevents collisions under concurrent
   * uploads.
   */
  generateUniqueFileName?: boolean;
  /** Override the detected MIME type */
  contentType?: string;
  /** Arbitrary string metadata stored alongside the S3 object */
  metadata?: Record<string, string>;
  /** Per-upload storage class override */
  storageClass?: StorageClass;
}

/** Options for listing objects in a folder */
export interface ListOptions {
  /** Folder path appended to basePath */
  folder?: string;
  /** Additional prefix filter within the folder */
  prefix?: string;
  /** Maximum number of keys to return (1–1000, default: 1000) */
  maxResults?: number;
  /** Continuation token from a previous list call for pagination */
  continuationToken?: string;
}

/** Options for generating a signed URL for an existing key */
export interface SignedUrlOptions {
  /** TTL override in seconds. Falls back to instance default. */
  expiresIn?: number;
  /**
   * Sets Content-Disposition on the response.
   * 'inline' — browser renders the file (images, PDFs).
   * 'attachment' — browser downloads the file.
   */
  disposition?: "inline" | "attachment";
  /** Original filename to suggest in Content-Disposition (for attachments) */
  fileName?: string;
}

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

/** Metadata returned after a successful upload */
export interface UploadResult {
  /** Full S3 key for this object — store this in your database */
  key: string;
  /** Original filename as provided by the uploader */
  originalName: string;
  /** Filename used in S3 (may differ from originalName if UUID was generated) */
  storedName: string;
  /** Stored file size in bytes */
  size: number;
  /** MIME type */
  contentType: string;
  /** S3 ETag (without surrounding quotes) */
  etag?: string;
  /** Storage class applied */
  storageClass: string;
}

/** A single entry returned by list() */
export interface ListEntry {
  /** Full S3 key */
  key: string;
  /** Filename portion of the key */
  fileName: string;
  /** Object size in bytes */
  size: number;
  /** Last modified timestamp */
  lastModified: Date;
  /** Storage class */
  storageClass?: string;
  /** ETag (without surrounding quotes) */
  etag?: string;
}

/** Paginated result from list() */
export interface ListResult {
  entries: ListEntry[];
  /** Pass this to the next list() call to fetch the next page */
  continuationToken?: string;
  /** True when there are more results beyond this page */
  hasMore: boolean;
}

export type DownloadMode = "buffer" | "stream";

export type DownloadResult<T extends DownloadMode> = T extends "buffer"
  ? { buffer: Buffer; metadata: ObjectMetadata }
  : { stream: Readable; metadata: ObjectMetadata };

export interface ObjectMetadata {
  contentType?: string;
  contentLength?: number;
  lastModified?: Date;
  metadata?: Record<string, string>;
  storageClass?: string;
}

// ---------------------------------------------------------------------------
// Adapter helpers — normalise caller-side file representations
// ---------------------------------------------------------------------------

/**
 * Adapts a multer file (Express.Multer.File) to FileInput.
 *
 * @example
 * // In an Express route with multer:
 * const fileInput = fromMulterFile(req.file);
 */
export function fromMulterFile(multerFile: {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}): FileInput {
  return {
    buffer: multerFile.buffer,
    originalName: multerFile.originalname,
    mimeType: multerFile.mimetype,
    size: multerFile.size,
  };
}

/**
 * Adapts a Web API File (browser / Next.js App Router FormData) to FileInput.
 *
 * @example
 * // In a Next.js App Router route handler:
 * const formData = await request.formData();
 * const fileInput = await fromWebFile(formData.get('file') as File);
 */
export async function fromWebFile(webFile: File): Promise<FileInput> {
  return {
    buffer: Buffer.from(await webFile.arrayBuffer()),
    originalName: webFile.name,
    mimeType: webFile.type,
    size: webFile.size,
  };
}

// ---------------------------------------------------------------------------
// Main class
// ---------------------------------------------------------------------------

export class AwsFileManager {
  private readonly s3: S3Client;
  private readonly bucketName: string;
  private readonly basePath: string;
  private readonly urlExpirationSeconds: number;
  private readonly storageClass: StorageClass;

  static readonly DEFAULTS = {
    storageClass: StorageClass.INTELLIGENT_TIERING,
    urlExpirationSeconds: 3600,
  } as const;

  constructor(config: AwsFileManagerConfig) {
    if (!config.region) throw new Error("AWS region is required");
    if (!config.bucketName) throw new Error("S3 bucket name is required");

    this.bucketName = config.bucketName;
    this.basePath = config.basePath
      ? config.basePath.replace(/^\/|\/$/g, "")
      : "";
    this.urlExpirationSeconds =
      config.urlExpirationSeconds ??
      AwsFileManager.DEFAULTS.urlExpirationSeconds;
    this.storageClass =
      config.storageClass ?? AwsFileManager.DEFAULTS.storageClass;

    this.s3 = new S3Client({
      region: config.region,
      ...(config.accessKeyId &&
        config.secretAccessKey && {
          credentials: {
            accessKeyId: config.accessKeyId,
            secretAccessKey: config.secretAccessKey,
          },
        }),
    });
  }

  // -------------------------------------------------------------------------
  // Upload
  // -------------------------------------------------------------------------

  /**
   * Uploads a file to S3 and returns storage metadata (no URL).
   *
   * The returned `key` is what you persist to your database. Generate signed
   * URLs on demand via `getSignedUrl()` — never store them, as they expire.
   *
   * @example
   * // In a pipeline step:
   * const result = await fileManager.upload(ctx.fileInput, { key: ctx.s3Key });
   * ctx.uploadResult = result;
   */
  async upload(
    file: FileInput,
    options: UploadOptions = {},
  ): Promise<UploadResult> {
    const { storedName, key } = this.resolveKey(file.originalName, options);

    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: key,
      Body: file.buffer,
      ContentType: options.contentType ?? file.mimeType,
      Metadata: options.metadata,
      StorageClass: options.storageClass ?? this.storageClass,
      // ACL intentionally omitted — bucket should have BucketOwnerEnforced
      // (AWS default since April 2023). Pass options.acl explicitly only if
      // your bucket was created before that change and requires legacy ACLs.
    });

    const response = await this.s3.send(command);

    return {
      key,
      originalName: file.originalName,
      storedName,
      size: file.size,
      contentType: options.contentType ?? file.mimeType,
      etag: response.ETag?.replace(/"/g, ""),
      storageClass: (options.storageClass ?? this.storageClass) as string,
    };
  }

  // -------------------------------------------------------------------------
  // Signed URL — for serving private files to clients
  // -------------------------------------------------------------------------

  /**
   * Generates a short-lived signed URL for a private S3 object.
   *
   * Call this at request time; never store the returned URL. Signed URLs
   * are credentials — treat them accordingly.
   *
   * @example
   * const url = await fileManager.getSignedUrl(file.s3Key, {
   *   disposition: 'inline',
   *   fileName: file.originalName,
   * });
   */
  async getSignedUrl(
    key: string,
    options: SignedUrlOptions = {},
  ): Promise<string> {
    const disposition = this.buildContentDisposition(options);

    const command = new GetObjectCommand({
      Bucket: this.bucketName,
      Key: key,
      ...(disposition && { ResponseContentDisposition: disposition }),
    });

    return getSignedUrl(this.s3, command, {
      expiresIn: options.expiresIn ?? this.urlExpirationSeconds,
    });
  }

  // -------------------------------------------------------------------------
  // Download
  // -------------------------------------------------------------------------

  /**
   * Downloads an S3 object as a Buffer or a Node.js Readable stream.
   *
   * Use `'stream'` (default) when piping to a response or writing to disk.
   * Use `'buffer'` when you need the full bytes in memory (e.g. for processing).
   *
   * Returns `null` when the object does not exist.
   *
   * @example
   * const result = await fileManager.download(key, 'buffer');
   * if (result) {
   *   const { buffer, metadata } = result;
   * }
   */
  async download<T extends DownloadMode = "stream">(
    key: string,
    mode?: T,
  ): Promise<DownloadResult<T> | null> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });
      const response = await this.s3.send(command);

      if (!response.Body) return null;

      const metadata: ObjectMetadata = {
        contentType: response.ContentType,
        contentLength: response.ContentLength,
        lastModified: response.LastModified,
        metadata: response.Metadata as Record<string, string>,
        storageClass: response.StorageClass,
      };

      if ((mode ?? "stream") === "buffer") {
        const stream = response.Body as Readable;
        const chunks: Buffer[] = [];
        const buffer = await new Promise<Buffer>((resolve, reject) => {
          stream.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
          stream.on("error", reject);
          stream.on("end", () => resolve(Buffer.concat(chunks)));
        });
        return { buffer, metadata } as DownloadResult<T>;
      }

      return {
        stream: response.Body as Readable,
        metadata,
      } as DownloadResult<T>;
    } catch (error: unknown) {
      if (isNoSuchKeyError(error)) return null;
      throw error;
    }
  }

  // -------------------------------------------------------------------------
  // Delete
  // -------------------------------------------------------------------------

  /**
   * Permanently deletes an object from S3.
   *
   * Note: this only removes the S3 object. Your database record should be
   * soft-deleted first, and this called as a cleanup step after the DB
   * transaction commits — so a crash mid-way leaves a recoverable orphan
   * rather than a missing file with an intact DB row.
   *
   * @example
   * await fileManager.delete(file.s3Key);
   */
  async delete(key: string): Promise<void> {
    const command = new DeleteObjectCommand({
      Bucket: this.bucketName,
      Key: key,
    });
    await this.s3.send(command);
    // S3 DeleteObject is idempotent — deleting a non-existent key succeeds silently.
  }

  /**
   * Deletes multiple objects in a single call.
   * Silently skips keys that do not exist.
   *
   * @example
   * await fileManager.deleteMany([original.s3Key, thumbnail.s3Key]);
   */
  async deleteMany(keys: string[]): Promise<void> {
    // S3 batch delete supports up to 1000 keys per request
    const chunks = chunkArray(keys, 1000);
    await Promise.all(
      chunks.map((chunk) => {
        // Build the delete command inline to avoid importing DeleteObjectsCommand
        // above — keeping the import list tidy and tree-shakeable.
        return Promise.all(chunk.map((key) => this.delete(key)));
      }),
    );
  }

  // -------------------------------------------------------------------------
  // Copy
  // -------------------------------------------------------------------------

  /**
   * Copies an object within the same bucket.
   *
   * Useful when duplicating files across entities (e.g. cloning a note)
   * or reorganising keys without re-uploading bytes.
   *
   * @example
   * await fileManager.copy(sourceFile.s3Key, newKey);
   */
  async copy(
    sourceKey: string,
    destinationKey: string,
    options: {
      storageClass?: StorageClass;
      metadata?: Record<string, string>;
    } = {},
  ): Promise<void> {
    const command = new CopyObjectCommand({
      Bucket: this.bucketName,
      CopySource: `${this.bucketName}/${sourceKey}`,
      Key: destinationKey,
      StorageClass: options.storageClass ?? this.storageClass,
      ...(options.metadata && {
        Metadata: options.metadata,
        MetadataDirective: "REPLACE",
      }),
    });
    await this.s3.send(command);
  }

  // -------------------------------------------------------------------------
  // List
  // -------------------------------------------------------------------------

  /**
   * Lists objects under a folder prefix.
   *
   * Results are paginated. Pass the returned `continuationToken` back
   * into subsequent calls to walk through large result sets.
   *
   * Primarily intended for the server-side storage reconciliation job
   * (nightly scan to reconcile DB byte counts against S3 actuals).
   *
   * @example
   * let token: string | undefined;
   * do {
   *   const result = await fileManager.list({ folder: 'acme-corp', continuationToken: token });
   *   processBatch(result.entries);
   *   token = result.continuationToken;
   * } while (result.hasMore);
   */
  async list(options: ListOptions = {}): Promise<ListResult> {
    const prefix = this.buildPrefix(options.folder, options.prefix);

    const command = new ListObjectsV2Command({
      Bucket: this.bucketName,
      Prefix: prefix || undefined,
      MaxKeys: options.maxResults ?? 1000,
      ContinuationToken: options.continuationToken,
    });

    const response = await this.s3.send(command);

    const entries: ListEntry[] = (response.Contents ?? []).map((obj) => ({
      key: obj.Key ?? "",
      fileName: (obj.Key ?? "").split("/").pop() ?? "",
      size: obj.Size ?? 0,
      lastModified: obj.LastModified ?? new Date(),
      storageClass: obj.StorageClass,
      etag: obj.ETag?.replace(/"/g, ""),
    }));

    return {
      entries,
      continuationToken: response.NextContinuationToken,
      hasMore: response.IsTruncated ?? false,
    };
  }

  // -------------------------------------------------------------------------
  // Key existence check
  // -------------------------------------------------------------------------

  /**
   * Returns true if an object exists at the given key.
   *
   * @example
   * if (!(await fileManager.exists(key))) {
   *   throw new Error('Referenced file is missing from storage');
   * }
   */
  async exists(key: string): Promise<boolean> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });
      await this.s3.send(command);
      return true;
    } catch (error: unknown) {
      if (isNoSuchKeyError(error)) return false;
      throw error;
    }
  }

  // -------------------------------------------------------------------------
  // Expose underlying client for advanced use cases
  // -------------------------------------------------------------------------

  /**
   * Returns the underlying S3Client for operations not covered by this class.
   * Use sparingly — prefer adding methods here so the abstraction stays coherent.
   */
  getS3Client(): S3Client {
    return this.s3;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Resolves the final S3 key and stored filename from upload options.
   *
   * Priority order for the key:
   *   1. options.key (explicit full key — pipeline usage)
   *   2. basePath + folder + fileName (if provided)
   *   3. basePath + folder + UUID-based name (if generateUniqueFileName)
   *   4. basePath + folder + originalName (fallback)
   */
  private resolveKey(
    originalName: string,
    options: UploadOptions,
  ): { key: string; storedName: string } {
    if (options.key) {
      const storedName = options.key.split("/").pop() ?? originalName;
      return { key: options.key, storedName };
    }

    const storedName = options.generateUniqueFileName
      ? this.makeUniqueFileName(originalName)
      : (options.fileName ?? originalName);

    const key = this.buildFullKey(storedName, options.folder);
    return { key, storedName };
  }

  /**
   * Builds a full S3 key from basePath, optional folder, and filename.
   */
  private buildFullKey(fileName: string, folder?: string): string {
    const folderPart = folder ? folder.replace(/^\/|\/$/g, "") : "";
    return [this.basePath, folderPart, fileName]
      .filter((part) => part.length > 0)
      .join("/");
  }

  /**
   * Builds a prefix string for list operations.
   */
  private buildPrefix(folder?: string, prefix?: string): string {
    return [
      this.basePath,
      folder ? folder.replace(/^\/|\/$/g, "") : "",
      prefix ?? "",
    ]
      .filter((part) => part.length > 0)
      .join("/");
  }

  /**
   * Generates a UUID-based filename, preserving the original extension.
   * UUIDs are collision-proof under any upload concurrency.
   */
  private makeUniqueFileName(originalName: string): string {
    const ext = originalName.includes(".")
      ? originalName.substring(originalName.lastIndexOf("."))
      : "";
    return `${randomUUID()}${ext}`;
  }

  /**
   * Builds a Content-Disposition header value from SignedUrlOptions.
   */
  private buildContentDisposition(
    options: SignedUrlOptions,
  ): string | undefined {
    if (!options.disposition) return undefined;

    if (options.disposition === "attachment" && options.fileName) {
      const safe = encodeURIComponent(options.fileName);
      return `attachment; filename="${safe}"; filename*=UTF-8''${safe}`;
    }

    return options.disposition; // 'inline' or bare 'attachment'
  }
}

// ---------------------------------------------------------------------------
// Module-level utilities
// ---------------------------------------------------------------------------

/** Type guard for S3 NoSuchKey errors */
function isNoSuchKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name: string }).name === "NoSuchKey"
  );
}

/** Splits an array into chunks of at most `size` elements */
function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}
