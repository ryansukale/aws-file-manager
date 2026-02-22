/**
 * 04-signed-urls.ts
 *
 * Generating signed URLs for private S3 objects.
 *
 * Key points:
 *   - Call `getSignedUrl()` at request time — never store the returned URL.
 *   - Use `disposition: 'inline'`  for images and PDFs rendered in the browser.
 *   - Use `disposition: 'attachment'` to force a file download with a filename.
 *   - Signed URLs are credentials — treat them accordingly (HTTPS only, short TTL).
 */

import { AwsFileManager } from "@allegria/aws-file-manager";

const fileManager = new AwsFileManager({
  region: process.env.AWS_REGION ?? "us-east-1",
  bucketName: process.env.S3_BUCKET_NAME!,
  urlExpirationSeconds: 3600, // 1 hour default
});

async function examples() {
  const s3Key = "uploads/avatars/f47ac10b-58cc-4372-a567-0e02b2c3d479.jpg";

  // ─── Inline (browser renders the file) ───────────────────────────────────
  const inlineUrl = await fileManager.getSignedUrl(s3Key, {
    disposition: "inline",
  });
  console.log("Inline URL:", inlineUrl);
  // → https://my-bucket.s3.amazonaws.com/uploads/avatars/...?X-Amz-Signature=...

  // ─── Attachment (forced download with a suggested filename) ───────────────
  const downloadUrl = await fileManager.getSignedUrl(s3Key, {
    disposition: "attachment",
    fileName: "my-photo.jpg", // Suggested filename in Content-Disposition
  });
  console.log("Download URL:", downloadUrl);

  // ─── Custom TTL ───────────────────────────────────────────────────────────
  // Override the instance default for a short-lived share link
  const shortLivedUrl = await fileManager.getSignedUrl(s3Key, {
    disposition: "inline",
    expiresIn: 300, // 5 minutes
  });
  console.log("Short-lived URL:", shortLivedUrl);

  // ─── Serve from an API route ──────────────────────────────────────────────
  // Typical pattern: look up the key from your DB, then redirect to the URL.
  //
  // GET /api/files/:id
  // const file = await db.files.findById(req.params.id);
  // const url = await fileManager.getSignedUrl(file.s3Key, { disposition: 'inline' });
  // return res.redirect(302, url);
}

examples().catch(console.error);
