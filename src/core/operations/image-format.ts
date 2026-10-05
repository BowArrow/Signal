/** Read dimensions before native decoding to bound decompression memory. */
export function imageDimensions(bytes: Buffer) {
  let width = 0; let height = 0;
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && bytes.subarray(12, 16).toString('ascii') === 'IHDR') {
    width = bytes.readUInt32BE(16); height = bytes.readUInt32BE(20);
  } else if (bytes[0] === 255 && bytes[1] === 216) {
    let offset = 2;
    while (offset + 4 < bytes.length) {
      if (bytes[offset] !== 255) break;
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++]; if (marker === 0xda || marker === 0xd9) break;
      if (offset + 2 > bytes.length) break;
      const length = bytes.readUInt16BE(offset); if (length < 2 || offset + length > bytes.length) break;
      if ([0xc0, 0xc1, 0xc2].includes(marker!)) { if (length < 8) break; height = bytes.readUInt16BE(offset + 3); width = bytes.readUInt16BE(offset + 5); break; }
      offset += length;
    }
  }
  if (width < 256 || height < 256 || width > 4096 || height > 4096) throw new Error('Expected a PNG or JPEG image with dimensions from 256 to 4096 pixels.');
  return { width, height };
}
