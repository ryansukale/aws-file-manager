# AWS File Manager

A comprehensive TypeScript library for managing files in AWS S3, with Express integration.

## Features

- Upload single or multiple files to S3
- Delete files individually or in batch
- Find and list files with pagination
- Generate signed URLs for private files
- Download files
- Express middleware for easy integration
- Fully typed with TypeScript

## Installation

```bash
npm install aws-file-manager
```

// Download multiple files
const result = await fileManager.downloadAll(['path/to/file1.jpg', 'path/to/file2.jpg']);

// Handle multiple file downloads (as ZIP)
app.post('/download-multiple', middleware.handleDownloadAll());

