import type { UploadSignature } from '@gatherly/types';
import { v2 as cloudinary } from 'cloudinary';
import { env } from '../config/env.js';
import { ERROR_CODES } from '@gatherly/types';
import { AppError } from '../lib/errors.js';

export const BANNER_FOLDER = 'gatherly/banners';
export const BANNER_FORMATS = 'jpg,jpeg,png,webp';

/**
 * Signs a direct browser-to-Cloudinary upload.
 *
 * The file never passes through our server — that would cost Render
 * bandwidth and memory for no benefit. Instead the server signs the exact
 * upload parameters with the API secret, which never leaves the server.
 * Cloudinary rejects the upload if the browser alters any signed value
 * (folder, allowed formats), and a signature is only honoured for one hour,
 * so a leaked one cannot be reused indefinitely.
 */
export function signBannerUpload(): UploadSignature {
  const {
    CLOUDINARY_CLOUD_NAME: cloudName,
    CLOUDINARY_API_KEY: apiKey,
    CLOUDINARY_API_SECRET: apiSecret,
  } = env;
  if (!cloudName || !apiKey || !apiSecret) {
    throw new AppError(
      503,
      ERROR_CODES.INTERNAL,
      'Image uploads are not configured on this server',
    );
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const paramsToSign = { timestamp, folder: BANNER_FOLDER, allowed_formats: BANNER_FORMATS };

  return {
    cloudName,
    apiKey,
    timestamp,
    folder: BANNER_FOLDER,
    allowedFormats: BANNER_FORMATS,
    signature: cloudinary.utils.api_sign_request(paramsToSign, apiSecret),
    uploadUrl: `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
  };
}
