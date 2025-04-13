# AWS File Manager

A TypeScript library for managing files in AWS S3.

## Features

- Upload and download files from S3
- Fully typed with TypeScript

## Installation

```bash
npm install @allegria/aws-file-manager
```

## Examples

#### Basic usage

```js
const fileManager = new AwsFileManager({
  region: AWS_REGION,
  bucketName: AWS_BUCKET_NAME,
  accessKeyId: AWS_ACCESS_KEY,
  secretAccessKey: AWS_SECRET_ACCESS_KEY,
});

// To upload
const uploadResult = await fileManager.upload('my-photo.jpg');

// To download
const downloadResult = await fileManager.download('my-photo.jpg', 'buffer');
```