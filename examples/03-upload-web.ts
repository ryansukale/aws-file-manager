/**
 * 03-upload-web.ts
 *
 * Uploading files from a Next.js App Router route handler (or any environment
 * where you receive a Web API `File` object from FormData).
 *
 * Key points:
 *   - `fromWebFile()` is async because it calls `file.arrayBuffer()`.
 *   - Everything else is the same as the multer path.
 */

import { NextRequest, NextResponse } from "next/server";
import { AwsFileManager, fromWebFile } from "@lib/aws-file-manager";

const fileManager = new AwsFileManager({
  region: process.env.AWS_REGION ?? "us-east-1",
  bucketName: process.env.S3_BUCKET_NAME!,
  basePath: "uploads",
});

// app/api/upload/route.ts
export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  // Normalise the Web API File into a FileInput
  const fileInput = await fromWebFile(file);

  const result = await fileManager.upload(fileInput, {
    folder: "profile-photos",
    generateUniqueFileName: true,
  });

  // Persist result.key to your database
  // await db.users.update({ id: userId, avatarKey: result.key });

  const url = await fileManager.getSignedUrl(result.key, {
    disposition: "inline",
  });

  return NextResponse.json({ key: result.key, url });
}
