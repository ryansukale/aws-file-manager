import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  AwsFileManager,
  fromMulterFile,
  fromWebFile,
  type FileInput,
  type UploadResult,
} from "../lib/aws-file-manager.js";

// ---------------------------------------------------------------------------
// Mock AWS SDK modules
// ---------------------------------------------------------------------------

const mockSend = vi.fn();

// All SDK classes are used with `new`, so they must be regular functions.
function makeConstructor() {
  return vi.fn().mockImplementation(function (this: Record<string, unknown>, input: unknown) {
    this.input = input;
  });
}

vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: vi.fn().mockImplementation(function (this: { send: typeof mockSend }) {
    this.send = mockSend;
  }),
  PutObjectCommand: makeConstructor(),
  GetObjectCommand: makeConstructor(),
  DeleteObjectCommand: makeConstructor(),
  CopyObjectCommand: makeConstructor(),
  ListObjectsV2Command: makeConstructor(),
  StorageClass: {
    INTELLIGENT_TIERING: "INTELLIGENT_TIERING",
    STANDARD: "STANDARD",
  },
}));

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: vi.fn().mockResolvedValue("https://signed.example.com/file"),
}));

// ---------------------------------------------------------------------------
// Shared test fixtures
// ---------------------------------------------------------------------------

const BASE_CONFIG = {
  region: "us-east-1",
  bucketName: "test-bucket",
};

const SAMPLE_FILE: FileInput = {
  buffer: Buffer.from("hello world"),
  originalName: "photo.jpg",
  mimeType: "image/jpeg",
  size: 11,
};

// Clear mock call counts between every test so toHaveBeenCalledTimes is isolated
afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// fromMulterFile
// ---------------------------------------------------------------------------

describe("fromMulterFile", () => {
  it("maps multer fields to FileInput", () => {
    const multerFile = {
      buffer: Buffer.from("data"),
      originalname: "test.png",
      mimetype: "image/png",
      size: 4,
    };
    const result = fromMulterFile(multerFile);
    expect(result).toEqual<FileInput>({
      buffer: multerFile.buffer,
      originalName: "test.png",
      mimeType: "image/png",
      size: 4,
    });
  });
});

// ---------------------------------------------------------------------------
// fromWebFile
// ---------------------------------------------------------------------------

describe("fromWebFile", () => {
  it("converts a Web API File to FileInput", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const webFile = new File([bytes], "upload.pdf", { type: "application/pdf" });

    const result = await fromWebFile(webFile);

    expect(result.originalName).toBe("upload.pdf");
    expect(result.mimeType).toBe("application/pdf");
    expect(result.size).toBe(3);
    expect(Buffer.isBuffer(result.buffer)).toBe(true);
    expect(result.buffer).toEqual(Buffer.from(bytes));
  });
});

// ---------------------------------------------------------------------------
// AwsFileManager — constructor
// ---------------------------------------------------------------------------

describe("AwsFileManager constructor", () => {
  it("throws when region is missing", () => {
    expect(
      () => new AwsFileManager({ region: "", bucketName: "b" }),
    ).toThrow("AWS region is required");
  });

  it("throws when bucketName is missing", () => {
    expect(
      () => new AwsFileManager({ region: "us-east-1", bucketName: "" }),
    ).toThrow("S3 bucket name is required");
  });

  it("constructs successfully with minimal config", () => {
    expect(() => new AwsFileManager(BASE_CONFIG)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// upload()
// ---------------------------------------------------------------------------

describe("AwsFileManager.upload()", () => {
  let fm: AwsFileManager;

  beforeEach(() => {
    fm = new AwsFileManager(BASE_CONFIG);
    mockSend.mockResolvedValue({ ETag: '"abc123"' });
  });

  it("returns an UploadResult with the correct fields", async () => {
    const result = await fm.upload(SAMPLE_FILE);

    expect(result.originalName).toBe("photo.jpg");
    expect(result.size).toBe(11);
    expect(result.contentType).toBe("image/jpeg");
    expect(result.etag).toBe("abc123"); // quotes stripped
    expect(result.storageClass).toBe("INTELLIGENT_TIERING");
    expect(result.key).toBe("photo.jpg");
    expect(result.storedName).toBe("photo.jpg");
  });

  it("prepends basePath to the key", async () => {
    const fmWithBase = new AwsFileManager({ ...BASE_CONFIG, basePath: "uploads" });
    const result = await fmWithBase.upload(SAMPLE_FILE);
    expect(result.key).toBe("uploads/photo.jpg");
  });

  it("includes folder in the key", async () => {
    const result = await fm.upload(SAMPLE_FILE, { folder: "avatars" });
    expect(result.key).toBe("avatars/photo.jpg");
  });

  it("uses an explicit key when options.key is provided", async () => {
    const result = await fm.upload(SAMPLE_FILE, { key: "custom/path/file.jpg" });
    expect(result.key).toBe("custom/path/file.jpg");
    expect(result.storedName).toBe("file.jpg");
  });

  it("uses options.fileName over originalName", async () => {
    const result = await fm.upload(SAMPLE_FILE, { fileName: "renamed.jpg" });
    expect(result.storedName).toBe("renamed.jpg");
    expect(result.key).toBe("renamed.jpg");
  });

  it("generates a UUID filename when generateUniqueFileName is true", async () => {
    const result = await fm.upload(SAMPLE_FILE, { generateUniqueFileName: true });
    // UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx.jpg
    expect(result.storedName).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$/,
    );
  });

  it("preserves extension when generating UUID filename", async () => {
    const file: FileInput = { ...SAMPLE_FILE, originalName: "archive.tar.gz" };
    const result = await fm.upload(file, { generateUniqueFileName: true });
    expect(result.storedName).toMatch(/\.gz$/);
  });

  it("handles files with no extension when generating UUID filename", async () => {
    const file: FileInput = { ...SAMPLE_FILE, originalName: "Makefile" };
    const result = await fm.upload(file, { generateUniqueFileName: true });
    expect(result.storedName).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("strips quotes from ETag", async () => {
    mockSend.mockResolvedValue({ ETag: '"etag-value"' });
    const result = await fm.upload(SAMPLE_FILE);
    expect(result.etag).toBe("etag-value");
  });

  it("handles missing ETag in response", async () => {
    mockSend.mockResolvedValue({});
    const result = await fm.upload(SAMPLE_FILE);
    expect(result.etag).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// getSignedUrl()
// ---------------------------------------------------------------------------

describe("AwsFileManager.getSignedUrl()", () => {
  let fm: AwsFileManager;

  beforeEach(() => {
    fm = new AwsFileManager(BASE_CONFIG);
  });

  it("returns a signed URL string", async () => {
    const url = await fm.getSignedUrl("uploads/file.jpg");
    expect(url).toBe("https://signed.example.com/file");
  });

  it("accepts disposition and fileName options without throwing", async () => {
    await expect(
      fm.getSignedUrl("key.pdf", { disposition: "attachment", fileName: "report.pdf" }),
    ).resolves.toBe("https://signed.example.com/file");
  });

  it("accepts inline disposition without throwing", async () => {
    await expect(
      fm.getSignedUrl("key.jpg", { disposition: "inline" }),
    ).resolves.toBe("https://signed.example.com/file");
  });
});

// ---------------------------------------------------------------------------
// download()
// ---------------------------------------------------------------------------

describe("AwsFileManager.download()", () => {
  let fm: AwsFileManager;

  beforeEach(() => {
    fm = new AwsFileManager(BASE_CONFIG);
  });

  it("returns null when the key does not exist", async () => {
    const err = Object.assign(new Error("NoSuchKey"), { name: "NoSuchKey" });
    mockSend.mockRejectedValue(err);
    const result = await fm.download("missing.jpg", "buffer");
    expect(result).toBeNull();
  });

  it("re-throws non-NoSuchKey errors", async () => {
    const err = Object.assign(new Error("AccessDenied"), { name: "AccessDenied" });
    mockSend.mockRejectedValue(err);
    await expect(fm.download("key.jpg", "buffer")).rejects.toThrow("AccessDenied");
  });

  it("returns a stream result in stream mode", async () => {
    const { Readable } = await import("stream");
    const fakeStream = Readable.from(["data"]);
    mockSend.mockResolvedValue({
      Body: fakeStream,
      ContentType: "text/plain",
      ContentLength: 4,
    });
    const result = await fm.download("key.txt", "stream");
    expect(result).not.toBeNull();
    expect(result!.metadata.contentType).toBe("text/plain");
  });

  it("returns a buffer result in buffer mode", async () => {
    const { Readable } = await import("stream");
    const fakeStream = Readable.from([Buffer.from("hello")]);
    mockSend.mockResolvedValue({
      Body: fakeStream,
      ContentType: "text/plain",
    });
    const result = await fm.download("key.txt", "buffer");
    expect(result).not.toBeNull();
    expect(result!.buffer).toEqual(Buffer.from("hello"));
  });

  it("returns null when Body is missing", async () => {
    mockSend.mockResolvedValue({ Body: null });
    const result = await fm.download("key.txt", "buffer");
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// delete()
// ---------------------------------------------------------------------------

describe("AwsFileManager.delete()", () => {
  let fm: AwsFileManager;

  beforeEach(() => {
    fm = new AwsFileManager(BASE_CONFIG);
    mockSend.mockResolvedValue({});
  });

  it("resolves without throwing", async () => {
    await expect(fm.delete("uploads/file.jpg")).resolves.toBeUndefined();
  });

  it("calls send once", async () => {
    await fm.delete("key");
    expect(mockSend).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// deleteMany()
// ---------------------------------------------------------------------------

describe("AwsFileManager.deleteMany()", () => {
  let fm: AwsFileManager;

  beforeEach(() => {
    fm = new AwsFileManager(BASE_CONFIG);
    mockSend.mockResolvedValue({});
  });

  it("resolves without throwing for an empty array", async () => {
    await expect(fm.deleteMany([])).resolves.toBeUndefined();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("calls delete for each key", async () => {
    await fm.deleteMany(["a", "b", "c"]);
    expect(mockSend).toHaveBeenCalledTimes(3);
  });
});

// ---------------------------------------------------------------------------
// copy()
// ---------------------------------------------------------------------------

describe("AwsFileManager.copy()", () => {
  let fm: AwsFileManager;

  beforeEach(() => {
    fm = new AwsFileManager(BASE_CONFIG);
    mockSend.mockResolvedValue({});
  });

  it("resolves without throwing", async () => {
    await expect(fm.copy("source/key.jpg", "dest/key.jpg")).resolves.toBeUndefined();
  });

  it("calls send once", async () => {
    await fm.copy("src", "dst");
    expect(mockSend).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// list()
// ---------------------------------------------------------------------------

describe("AwsFileManager.list()", () => {
  let fm: AwsFileManager;

  beforeEach(() => {
    fm = new AwsFileManager(BASE_CONFIG);
  });

  it("returns entries and hasMore=false when result is not truncated", async () => {
    mockSend.mockResolvedValue({
      Contents: [
        {
          Key: "uploads/file.jpg",
          Size: 100,
          LastModified: new Date("2024-01-01"),
          StorageClass: "INTELLIGENT_TIERING",
          ETag: '"etag1"',
        },
      ],
      IsTruncated: false,
    });

    const result = await fm.list({ folder: "uploads" });

    expect(result.hasMore).toBe(false);
    expect(result.continuationToken).toBeUndefined();
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].key).toBe("uploads/file.jpg");
    expect(result.entries[0].fileName).toBe("file.jpg");
    expect(result.entries[0].size).toBe(100);
    expect(result.entries[0].etag).toBe("etag1"); // quotes stripped
  });

  it("returns continuationToken and hasMore=true when truncated", async () => {
    mockSend.mockResolvedValue({
      Contents: [],
      IsTruncated: true,
      NextContinuationToken: "token-abc",
    });

    const result = await fm.list();

    expect(result.hasMore).toBe(true);
    expect(result.continuationToken).toBe("token-abc");
  });

  it("returns empty entries when Contents is missing", async () => {
    mockSend.mockResolvedValue({ IsTruncated: false });
    const result = await fm.list();
    expect(result.entries).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// exists()
// ---------------------------------------------------------------------------

describe("AwsFileManager.exists()", () => {
  let fm: AwsFileManager;

  beforeEach(() => {
    fm = new AwsFileManager(BASE_CONFIG);
  });

  it("returns true when the object exists", async () => {
    mockSend.mockResolvedValue({});
    expect(await fm.exists("key.jpg")).toBe(true);
  });

  it("returns false when NoSuchKey is thrown", async () => {
    const err = Object.assign(new Error("NoSuchKey"), { name: "NoSuchKey" });
    mockSend.mockRejectedValue(err);
    expect(await fm.exists("missing.jpg")).toBe(false);
  });

  it("re-throws other errors", async () => {
    const err = Object.assign(new Error("Forbidden"), { name: "Forbidden" });
    mockSend.mockRejectedValue(err);
    await expect(fm.exists("key.jpg")).rejects.toThrow("Forbidden");
  });
});

// ---------------------------------------------------------------------------
// getS3Client()
// ---------------------------------------------------------------------------

describe("AwsFileManager.getS3Client()", () => {
  it("returns the underlying S3Client instance", () => {
    const fm = new AwsFileManager(BASE_CONFIG);
    const client = fm.getS3Client();
    expect(client).toBeDefined();
    expect(typeof client.send).toBe("function");
  });
});
