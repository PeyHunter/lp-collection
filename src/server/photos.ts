import { randomBytes } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const maxPhotoBytes = 10 * 1024 * 1024;
const maxEdge = 8192;

export type PhotoSize = { width: number; height: number };

const startOfFrame = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
const standalone = (marker: number) => marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7);

export function readJpegSize(bytes: Uint8Array): PhotoSize | "not-jpeg" | "unreadable" {
  if (bytes.length < 3 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return "not-jpeg";
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let size: PhotoSize | undefined;
  let offset = 2;
  while (offset + 1 < bytes.length) {
    if (bytes[offset] !== 0xff) return "unreadable";
    while (bytes[offset] === 0xff && offset + 1 < bytes.length) offset++;
    const marker = bytes[offset++]!;
    if (standalone(marker)) continue;
    if (marker === 0xd9 || offset + 2 > bytes.length) return "unreadable";
    const length = view.getUint16(offset);
    if (length < 2 || offset + length > bytes.length) return "unreadable";
    if (startOfFrame.has(marker)) {
      if (length < 7) return "unreadable";
      size = { height: view.getUint16(offset + 3), width: view.getUint16(offset + 5) };
    }
    if (marker === 0xda) {
      const ended = bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9;
      if (!size || !ended) return "unreadable";
      const fits = [size.width, size.height].every((edge) => edge > 0 && edge <= maxEdge);
      return fits ? size : "unreadable";
    }
    offset += length;
  }
  return "unreadable";
}

export type PhotoStore = ReturnType<typeof createPhotoStore>;

export function createPhotoStore(directory: string) {
  const path = (fileKey: string) => join(directory, `${fileKey}.jpg`);
  return {
    async write(bytes: Uint8Array) {
      const fileKey = randomBytes(16).toString("hex");
      const partial = join(directory, `.${fileKey}.partial`);
      await writeFile(partial, bytes, { flag: "wx" });
      await rename(partial, path(fileKey));
      return fileKey;
    },
    read: (fileKey: string) => readFile(path(fileKey)),
    async remove(fileKeys: string[]) {
      for (const fileKey of fileKeys) {
        await rm(path(fileKey), { force: true }).catch((error: Error) => console.error(`Photo file ${fileKey} could not be deleted: ${error.message}`));
      }
    },
  };
}
