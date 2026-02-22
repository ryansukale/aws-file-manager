/**
 * 05-download.ts
 *
 * Downloading S3 objects as a Buffer or a Node.js Readable stream.
 *
 * Key points:
 *   - `download()` returns `null` when the object does not exist (no throw).
 *   - Use `'stream'` (default) when piping to an HTTP response or writing to disk.
 *   - Use `'buffer'` when you need the full bytes in memory (e.g. image processing).
 */

import { createWriteStream } from "fs";
import { pipeline } from "stream/promises";
import express from "express";
import { AwsFileManager } from "@lib/aws-file-manager";

const fileManager = new AwsFileManager({
  region: process.env.AWS_REGION ?? "us-east-1",
  bucketName: process.env.S3_BUCKET_NAME!,
});

const app = express();

// ─── Stream directly to HTTP response ────────────────────────────────────────
app.get("/files/:key(*)", async (req, res) => {
  const result = await fileManager.download(req.params.key, "stream");

  if (!result) {
    return res.status(404).json({ error: "File not found" });
  }

  const { stream, metadata } = result;

  if (metadata.contentType) res.setHeader("Content-Type", metadata.contentType);
  if (metadata.contentLength) res.setHeader("Content-Length", metadata.contentLength);

  stream.pipe(res);
});

// ─── Download to a Buffer (for in-memory processing) ─────────────────────────
async function processImage(s3Key: string): Promise<void> {
  const result = await fileManager.download(s3Key, "buffer");

  if (!result) {
    throw new Error(`File not found: ${s3Key}`);
  }

  const { buffer, metadata } = result;
  console.log(`Downloaded ${buffer.length} bytes, type: ${metadata.contentType}`);

  // Pass the buffer to an image processing library, compression pipeline, etc.
  // const compressed = await sharp(buffer).jpeg({ quality: 80 }).toBuffer();
}

// ─── Stream to disk ───────────────────────────────────────────────────────────
async function saveToDisk(s3Key: string, outputPath: string): Promise<void> {
  const result = await fileManager.download(s3Key, "stream");
  if (!result) throw new Error(`File not found: ${s3Key}`);

  await pipeline(result.stream, createWriteStream(outputPath));
  console.log(`Saved to ${outputPath}`);
}

export { app, processImage, saveToDisk };
