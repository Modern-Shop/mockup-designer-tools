import { EditorError, MAX_FILE_BYTES, MAX_IMAGE_PIXELS, newId } from './core.js';
import type { ImageAsset } from './types.js';

/** Original uploads are normalized to a durable PNG data URL in the local adapter. */
export async function ingestImage(file: File, options: { signal?: AbortSignal } = {}): Promise<ImageAsset> {
  options.signal?.throwIfAborted();
  if (file.size > MAX_FILE_BYTES) throw new EditorError('file-too-large', 'Choose an image smaller than 12 MB.');
  const header = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const png = header[0] === 137 && header[1] === 80 && header[2] === 78 && header[3] === 71 && header[4] === 13 && header[5] === 10 && header[6] === 26 && header[7] === 10;
  const jpeg = header[0] === 255 && header[1] === 216 && header[2] === 255;
  if (!png && !jpeg) throw new EditorError('unsupported-file', 'Choose a valid PNG or JPEG image.');
  // Read PNG dimensions before decoding to reject common decompression bombs early.
  if (png) {
    const bytes = new DataView(await file.slice(0, 24).arrayBuffer());
    if (bytes.byteLength < 24 || bytes.getUint32(16) * bytes.getUint32(20) > MAX_IMAGE_PIXELS) throw new EditorError('image-too-large', 'Image is too large. Use at most 32 megapixels.');
  }
  if (jpeg) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let offset = 2, found = false;
    while (offset + 3 < bytes.length) {
      if (bytes[offset++] !== 0xff) continue;
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) break;
      const length = bytes[offset] * 256 + bytes[offset + 1];
      if (length < 2 || offset + length > bytes.length) break;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker) && length >= 8) {
        const height = bytes[offset + 3] * 256 + bytes[offset + 4], width = bytes[offset + 5] * 256 + bytes[offset + 6];
        if (!width || !height || width > 16384 || height > 16384 || width * height > MAX_IMAGE_PIXELS) throw new EditorError('image-too-large', 'Image is too large. Use at most 32 megapixels.');
        found = true; break;
      }
      offset += length;
    }
    if (!found) throw new EditorError('jpeg-dimensions', 'This JPEG has no supported image dimensions.');
  }
  const url = URL.createObjectURL(file);
  const image = new Image();
  const cancel = () => { image.src = ''; };
  options.signal?.addEventListener('abort', cancel, { once: true });
  try {
    image.src = url;
    await image.decode();
    options.signal?.throwIfAborted();
    if (!image.naturalWidth || image.naturalWidth > 16384 || image.naturalHeight > 16384 || image.naturalWidth * image.naturalHeight > MAX_IMAGE_PIXELS) throw new EditorError('image-too-large', 'Image is too large. Use at most 32 megapixels.');
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new EditorError('canvas-unavailable', 'Canvas 2D is unavailable.');
    ctx.drawImage(image, 0, 0);
    const src = canvas.toDataURL('image/png');
    canvas.width = canvas.height = 0;
    return { id: newId('asset'), name: file.name.slice(0, 400) || 'Artwork', src, width: image.naturalWidth, height: image.naturalHeight, mimeType: 'image/png' };
  } catch (error) {
    options.signal?.throwIfAborted();
    if (error instanceof EditorError) throw error;
    throw new EditorError('image-decode', 'This image could not be decoded. Choose another PNG or JPEG.');
  } finally {
    URL.revokeObjectURL(url);
    options.signal?.removeEventListener('abort', cancel);
  }
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename.replace(/[^a-zA-Z0-9._-]/g, '-'); a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
