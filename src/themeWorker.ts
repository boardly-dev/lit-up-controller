import {
  QuantizerCelebi,
  Score,
  argbFromRgb,
  themeFromSourceColor,
} from "@material/material-color-utilities";

console.log("worked launched");

export async function sourceColorFromImage(imagePath: string) {
  const imageBitmap = await createImageBitmap(
    await fetch(imagePath).then((res) => res.blob()),
  );
  const canvas = new OffscreenCanvas(10, 10);
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Could not get canvas context");
  }
  canvas.width = imageBitmap.width;
  canvas.height = imageBitmap.height;

  context.drawImage(imageBitmap, 0, 0);

  const imageBytes = context.getImageData(
    0,
    0,
    imageBitmap.width,
    imageBitmap.height,
  ).data;

  return sourceColorFromImageBytes(imageBytes);
}

export function sourceColorFromImageBytes(imageBytes: Uint8ClampedArray) {
  // Convert Image data to Pixel Array
  const pixels: number[] = [];
  for (let i = 0; i < imageBytes.length; i += 4) {
    const r = imageBytes[i];
    const g = imageBytes[i + 1];
    const b = imageBytes[i + 2];
    const a = imageBytes[i + 3];
    if (a < 255) {
      continue;
    }
    const argb = argbFromRgb(r, g, b);
    pixels.push(argb);
  }

  // Convert Pixels to Material Colors
  const result = QuantizerCelebi.quantize(pixels, 128);
  const ranked = Score.score(result);
  const top = ranked[0];
  return top;
}

sourceColorFromImage("/image.jpg")
  .then((source) => themeFromSourceColor(source))
  .then((theme) => {
    postMessage(theme);
  });
