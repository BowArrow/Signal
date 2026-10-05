import { nativeImage } from 'electron';
import { imageDimensions } from '../../src/core/operations/image-format.js';
/** Decode pixels, remove source metadata, retain aspect ratio, and bound upload size. */
export function normalizeCampaignImage(bytes: Buffer) {
  imageDimensions(bytes);
  const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (!png && !jpeg) throw new Error('The output is not a PNG or JPEG image.');
  let image = nativeImage.createFromBuffer(bytes); if (image.isEmpty()) throw new Error('The rendered image could not be decoded.');
  const original = image.getSize();
  if (original.width < 256 || original.height < 256 || original.width > 4096 || original.height > 4096) throw new Error('Use image dimensions from 256 to 4096 pixels.');
  if (Math.max(original.width, original.height) > 1536) image = image.resize({ ...(original.width >= original.height ? { width: 1536 } : { height: 1536 }), quality: 'best' });
  for (const quality of [90, 80, 70]) { const output = image.toJPEG(quality); if (output.length <= 1000000) return { bytes: output, ...image.getSize() }; }
  throw new Error('The image is too large for publishing. Use a simpler composition.');
}
