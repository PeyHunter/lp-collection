const longEdge = 2048;
const quality = 0.85;

export async function shrinkToJpegWithoutLocation(file: Blob): Promise<Blob> {
  const decoded = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, longEdge / Math.max(decoded.width, decoded.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(decoded.width * scale);
  canvas.height = Math.round(decoded.height * scale);
  const context = canvas.getContext("2d")!;
  context.imageSmoothingQuality = "high";
  context.drawImage(decoded, 0, 0, canvas.width, canvas.height);
  decoded.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("The photo couldn't be turned into a JPEG."))), "image/jpeg", quality),
  );
}
