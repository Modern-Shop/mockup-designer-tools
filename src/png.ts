/** Set PNG physical resolution; Canvas.toBlob otherwise records 96 DPI in browsers. */
export async function withPngDpi(blob: Blob, dpi: number): Promise<Blob> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const chunk = new Uint8Array(21);
  const data = new DataView(chunk.buffer);
  data.setUint32(0, 9);
  chunk.set([112, 72, 89, 115], 4); // pHYs
  data.setUint32(8, Math.round(dpi / .0254)); data.setUint32(12, Math.round(dpi / .0254)); chunk[16] = 1;
  let crc = 0xffffffff;
  for (const byte of chunk.slice(4, 17)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  data.setUint32(17, (crc ^ 0xffffffff) >>> 0);
  const parts: BlobPart[] = [bytes.slice(0, 8)];
  const view = new DataView(bytes.buffer);
  let added = false;
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.slice(offset + 4, offset + 8));
    if (type !== 'pHYs') parts.push(bytes.slice(offset, offset + length + 12));
    if (!added && type === 'IHDR') { parts.push(chunk); added = true; }
    offset += length + 12;
  }
  return new Blob(parts, { type: 'image/png' });
}
