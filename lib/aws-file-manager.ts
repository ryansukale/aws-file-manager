import {
  type ObjectCannedACL,
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  StorageClass,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Readable } from "stream";

/**
 * Configuration options for the AWS File Manager
 */
export interface AwsFileManagerConfig {
  /** AWS region */
  region: string;
  /** S3 bucket name */
  bucketName: string;
  /** AWS access key ID (optional if using environment variables) */
  accessKeyId?: string;
  /** AWS secret access key (optional if using environment variables) */
  secretAccessKey?: string;
  /** Default S3 ACL ('private', 'public-read', etc.) (default: 'private') */
  acl?: string;
  /** Base folder path in the bucket (default: '') */
  basePath?: string;
  /** URL expiration time in seconds for signed URLs (default: 3600) */
  urlExpirationSeconds?: number;
  /** Default storage class for uploaded files (default: 'STANDARD') */
  storageClass?: StorageClass;
}

/**
 * Options for uploading a file to S3
 */
export interface UploadOptions {
  /** Folder path in the bucket (appended to basePath) */
  folder?: string;
  /** Override the file's content type */
  contentType?: string;
  /** Override the default ACL */
  acl?: string;
  /** Custom file name */
  fileName?: string;
  generateFileName?: boolean; // (original name with timestamp)
  /** Additional metadata for the file */
  metadata?: Record<string, string>;
  /** S3 storage class for the file */
  storageClass?: StorageClass;
}

/**
 * Options for finding files in S3
 */
export interface FindOptions {
  /** Folder path to search in (appended to basePath) */
  folder?: string;
  /** Maximum number of results to return */
  maxResults?: number;
  /** Continuation token for pagination */
  continuationToken?: string;
  /** Filter by file prefix */
  prefix?: string;
  /** Generate signed URLs for the files */
  generateUrls?: boolean;
}

/**
 * Result of a successful S3 upload
 */
export interface FileResult {
  /** The S3 object key */
  key: string;
  /** The URL of the file (signed or public depending on ACL) */
  url: string;
  /** The file name */
  fileName: string;
  /** The original file name (for uploads) */
  originalName?: string;
  /** The file size in bytes */
  size?: number;
  /** The file's MIME type */
  contentType?: string;
  /** The ETag from S3 */
  etag?: string;
  /** Last modified date */
  lastModified?: Date;
  /** Additional metadata */
  metadata?: Record<string, string>;
  /** Storage class of the file */
  storageClass?: string;
}

/**
 * Result of a find operation
 */
export interface FindResult {
  /** List of files found */
  files: FileResult[];
  /** Continuation token for pagination */
  continuationToken?: string;
  /** Whether there are more results */
  hasMore: boolean;
}

export type DownloadMode = "buffer" | "stream";
export type DownloadResult<T extends DownloadMode> = T extends "buffer"
  ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { buffer: Buffer; metadata: Record<string, any> }
  : // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { stream: Readable; metadata: Record<string, any> };

/**
 * AWS File Manager class for handling S3 file operations
 */
export default class AwsFileManager {
  private s3Client: S3Client;
  private bucketName: string;
  private acl: string;
  private basePath: string;
  private urlExpirationSeconds: number;
  private storageClass: StorageClass;

  static DEFAULTS = {
    // Default storage class for all AwsFileManager instances
    storageClass: StorageClass.INTELLIGENT_TIERING,
    // 1 hour
    urlExpirationSeconds: 3600,
  };

  /**
   * Creates a new AWS File Manager instance
   * @param config - Configuration options
   */
  constructor(config: AwsFileManagerConfig) {
    // Validate required config
    if (!config.region) throw new Error("AWS region is required");
    if (!config.bucketName) throw new Error("S3 bucket name is required");

    // Set defaults
    this.acl = config.acl || "private";
    this.basePath = config.basePath
      ? config.basePath.replace(/^\/|\/$/g, "")
      : "";
    this.bucketName = config.bucketName;
    this.urlExpirationSeconds =
      config.urlExpirationSeconds ||
      AwsFileManager.DEFAULTS.urlExpirationSeconds;
    this.storageClass =
      config.storageClass || AwsFileManager.DEFAULTS.storageClass;

    // Create S3 client with provided credentials or from environment variables
    const s3ClientOptions: {
      region: string;
      credentials?: { accessKeyId: string; secretAccessKey: string };
    } = {
      region: config.region,
    };

    // Add credentials if provided
    if (config.accessKeyId && config.secretAccessKey) {
      s3ClientOptions.credentials = {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      };
    }

    this.s3Client = new S3Client(s3ClientOptions);
  }

  /**
   * Generates a full S3 key including the base path and folder
   * @param fileName - The file name
   * @param folder - Optional folder path
   * @returns Full S3 key
   */
  private getFullKey(fileName: string, folder?: string): string {
    const folderPath = folder ? folder.replace(/^\/|\/$/g, "") : "";

    const parts = [this.basePath, folderPath, fileName].filter(
      (part) => part.length > 0
    );

    return parts.join("/");
  }

  /**
   * Generates a file name for S3
   * @param originalName - The original file name
   * @param customName - Optional custom file name
   * @returns Generated file name
   */
  private generateFileName(originalName: string): string {
    const timestamp = Date.now();
    const extension = originalName.includes(".")
      ? originalName.substring(originalName.lastIndexOf("."))
      : "";

    const baseName = originalName.includes(".")
      ? originalName.substring(0, originalName.lastIndexOf("."))
      : originalName;

    return `${baseName}-${timestamp}${extension}`;
  }

  /**
   * Uploads a single file to S3
   * @param file - The file to upload (Buffer or Multer file)
   * @param options - Upload options
   * @returns Upload result
   */
  async upload(file: File, options: UploadOptions = {}): Promise<FileResult> {
    if (!file) {
      throw new Error("Invalid file object");
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    if (!buffer) {
      throw new Error("Invalid file object");
    }

    const fileName = options.generateFileName
      ? this.generateFileName(file.name)
      : options.fileName || file.name;
    const key = this.getFullKey(fileName, options.folder);

    const uploadParams = {
      Bucket: this.bucketName,
      Key: key,
      Body: buffer,
      ContentType: options.contentType || file.type,
      ACL: (options.acl as ObjectCannedACL) || (this.acl as ObjectCannedACL),
      Metadata: options.metadata,
      StorageClass: options.storageClass || this.storageClass,
    };

    const command = new PutObjectCommand(uploadParams);
    const result = await this.s3Client.send(command);

    // Generate the URL for the uploaded file
    let url: string;

    if (uploadParams.ACL === "public-read") {
      // Public URL
      url = `https://${this.bucketName}.s3.amazonaws.com/${key}`;
    } else {
      // Signed URL
      const getCommand = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });
      url = await getSignedUrl(this.s3Client, getCommand, {
        expiresIn: this.urlExpirationSeconds,
      });
    }

    return {
      key,
      url,
      fileName,
      originalName: file.name,
      size: file.size,
      contentType: file.type,
      etag: result.ETag?.replace(/"/g, ""), // Remove quotes from ETag
      storageClass: uploadParams.StorageClass,
    };
  }

  /**
   * Downloads a file from S3
   * @param key - The S3 object key
   * @returns File buffer and metadata or null if not found
   */
  async download<T extends DownloadMode = "stream">(
    key: string,
    mode?: T
  ): Promise<
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    | { buffer: Buffer; metadata: Record<string, any> }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    | { stream: Readable; metadata: Record<string, any> }
    | null
  > {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });

      const result = await this.s3Client.send(command);
      if (!result.Body) return null;

      const metadata = {
        contentType: result.ContentType,
        contentLength: result.ContentLength,
        lastModified: result.LastModified,
        metadata: result.Metadata,
        storageClass: result.StorageClass,
      };

      const effectiveMode = mode ?? "stream";

      if (effectiveMode === "buffer") {
        const stream = result.Body as Readable;
        const chunks: Buffer[] = [];
        const buffer = await new Promise<Buffer>((resolve, reject) => {
          stream.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
          stream.on("error", reject);
          stream.on("end", () => resolve(Buffer.concat(chunks)));
        });
        return { buffer, metadata } as unknown as DownloadResult<T>;
      }
      return {
        stream: result.Body as Readable,
        metadata,
      } as unknown as DownloadResult<T>;
    } catch (error) {
      console.error("Error downloading file:", error);
      return null;
    }
  }

  /**
   * Gets the S3 client instance
   * @returns S3 client
   */
  getS3Client(): S3Client {
    return this.s3Client;
  }
}
