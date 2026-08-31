import sharp from "sharp";

export const THUMBNAIL_MAX_EDGE = 512;
export const THUMBNAIL_WEBP_QUALITY = 82;
export const THUMBNAIL_MAX_BYTES = 1024 * 1024;

export async function createHistoryThumbnail(input: Uint8Array): Promise<Uint8Array> {
  const output = await sharp(input, { failOn: "error" })
    .rotate()
    .resize({
      width: THUMBNAIL_MAX_EDGE,
      height: THUMBNAIL_MAX_EDGE,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: THUMBNAIL_WEBP_QUALITY })
    .toBuffer();
  if (output.byteLength > THUMBNAIL_MAX_BYTES) throw new Error("THUMBNAIL_TOO_LARGE");
  return new Uint8Array(output);
}
