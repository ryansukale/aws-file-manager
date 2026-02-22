/**
 * 02-upload-multer.ts
 *
 * Uploading files from an Express route that uses multer for multipart parsing.
 *
 * Key points:
 *   - Use `fromMulterFile()` to normalise multer's file shape into FileInput.
 *   - `upload()` returns an UploadResult with the S3 key — persist this key
 *     to your database, NOT a signed URL (URLs expire).
 *   - Generate a signed URL on demand at request time via `getSignedUrl()`.
 */

import express from "express";
import multer from "multer";
import {
  AwsFileManager,
  fromMulterFile,
} from "@allegria/aws-file-manager";

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

const fileManager = new AwsFileManager({
  region: process.env.AWS_REGION ?? "us-east-1",
  bucketName: process.env.S3_BUCKET_NAME!,
  basePath: "uploads",
});

// POST /upload — accepts a single file field named 'file'
app.post("/upload", upload.single("file"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file provided" });
  }

  // Normalise multer's file into a FileInput
  const fileInput = fromMulterFile(req.file);

  // Upload to S3 with a UUID-based filename to prevent collisions
  const result = await fileManager.upload(fileInput, {
    folder: "avatars",
    generateUniqueFileName: true,
    metadata: {
      uploadedBy: req.body.userId ?? "anonymous",
    },
  });

  // Persist result.key to your database — never store the signed URL
  // await db.files.create({ s3Key: result.key, ... });

  // Return a short-lived signed URL for the client to use immediately
  const url = await fileManager.getSignedUrl(result.key, {
    disposition: "inline",
  });

  return res.json({
    key: result.key,
    url,
    size: result.size,
    contentType: result.contentType,
  });
});

// POST /upload-many — accepts up to 5 files in a 'files' field
app.post("/upload-many", upload.array("files", 5), async (req, res) => {
  const files = req.files as Express.Multer.File[];
  if (!files?.length) {
    return res.status(400).json({ error: "No files provided" });
  }

  const results = await Promise.all(
    files.map((file) =>
      fileManager.upload(fromMulterFile(file), {
        folder: "documents",
        generateUniqueFileName: true,
      }),
    ),
  );

  return res.json(results.map((r) => ({ key: r.key, size: r.size })));
});

export { app };
