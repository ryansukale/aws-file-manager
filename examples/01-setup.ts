/**
 * 01-setup.ts
 *
 * Instantiation patterns for AwsFileManager.
 *
 * Three approaches:
 *   A) Explicit credentials  — for local dev / environments without IAM
 *   B) Environment variables — SDK picks up AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY automatically
 *   C) IAM role              — recommended for production (EC2, ECS, Lambda)
 */

import { AwsFileManager } from "@allegria/aws-file-manager";

// ─── A) Explicit credentials ──────────────────────────────────────────────────
// Pass credentials directly. Useful during local development when you have a
// dedicated IAM user with limited S3 permissions.

const fileManagerExplicit = new AwsFileManager({
  region: "us-east-1",
  bucketName: "my-app-uploads",
  accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
});

// ─── B) Environment variable resolution ───────────────────────────────────────
// Omit credentials — the AWS SDK resolves them from:
//   AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY environment variables, or
//   ~/.aws/credentials file (local dev with aws-cli configured)

const fileManagerEnv = new AwsFileManager({
  region: "us-east-1",
  bucketName: "my-app-uploads",
});

// ─── C) IAM role (production recommended) ─────────────────────────────────────
// When running on EC2 / ECS / Lambda with an attached IAM role, omit all
// credentials. The SDK automatically uses the instance metadata service.
// No secrets in code or environment variables — the most secure option.

const fileManager = new AwsFileManager({
  region: process.env.AWS_REGION ?? "us-east-1",
  bucketName: process.env.S3_BUCKET_NAME!,
  // Optional: namespace all writes under a sub-folder
  basePath: "uploads",
  // Optional: default signed URL TTL (default: 3600 seconds)
  urlExpirationSeconds: 7200,
});

export { fileManager, fileManagerEnv, fileManagerExplicit };
