import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config/env.js';
import { badRequest } from '../utils/errors.js';

// Only images, verified by magic bytes, not by the client-supplied MIME type or extension.
const SIGNATURES = [
  { mime: 'image/jpeg', ext: '.jpg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/png', ext: '.png', test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/webp', ext: '.webp', test: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
];

export const singleImage = (field) => (req, res, next) => {
  multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxUploadBytes, files: 1, fields: 10 } })
    .single(field)(req, res, (err) => {
      if (!err) return next();
      if (err.code === 'LIMIT_FILE_SIZE') return next(badRequest(`Image must be ${Math.round(config.maxUploadBytes / 1048576)} MB or smaller`, [{ field }]));
      return next(badRequest('Invalid upload', [{ field, message: err.code || err.message }]));
    });
};

/** Validates and stores the uploaded file; returns attachment metadata or null. */
export async function storeImage(file) {
  if (!file) return null;
  const sig = SIGNATURES.find((s) => s.test(file.buffer));
  if (!sig) throw badRequest('Only JPEG, PNG or WebP images are allowed', [{ field: 'attachment' }]);
  const storedName = `${crypto.randomBytes(16).toString('hex')}${sig.ext}`;
  await fs.mkdir(config.uploadDir, { recursive: true });
  await fs.writeFile(path.join(config.uploadDir, storedName), file.buffer, { flag: 'wx' });
  const originalName = path.basename(file.originalname || 'image').replace(/[^\w.\- ]+/g, '_').slice(0, 120);
  return { storedName, originalName, mimeType: sig.mime, size: file.size };
}

/** Resolve a stored file path safely (stored names are generated, but guard anyway). */
export function storedPath(storedName) {
  if (!/^[a-f0-9]{32}\.(jpg|png|webp)$/.test(storedName)) throw badRequest('Invalid file reference');
  return path.resolve(config.uploadDir, storedName);
}
