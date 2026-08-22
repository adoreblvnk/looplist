export class ImageValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageValidationError";
  }
}

export class BlobServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlobServiceError";
  }
}
