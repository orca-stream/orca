/** Side of the square avatar uploaded to the server: sharp on a TV, small enough to send quickly. */
export const AVATAR_SIZE = 512;

/** The centered square of a picture, the part an avatar shows. */
export function squareCrop(width: number, height: number) {
  const size = Math.min(width, height);
  return { x: (width - size) / 2, y: (height - size) / 2, size };
}

/**
 * Any picture (a library icon, a photo from the device) cropped to a centered square and shrunk to
 * at most {@link AVATAR_SIZE}, so a 12 MP photo uploads as ~50 KB. Rasterized too: the server stores
 * bitmaps, not SVG.
 */
export async function pictureToAvatar(url: string): Promise<Blob> {
  const image = new Image();
  image.src = url;
  await image.decode();

  // SVGs without width/height report 0×0; they're drawn whole.
  const width = image.naturalWidth || AVATAR_SIZE;
  const height = image.naturalHeight || AVATAR_SIZE;
  const { x, y, size } = squareCrop(width, height);
  // Shrunk, never enlarged: upscaling adds bytes, not detail.
  const side = Math.min(size, AVATAR_SIZE);

  const canvas = document.createElement("canvas");
  canvas.width = side;
  canvas.height = side;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D isn't available");
  context.drawImage(image, x, y, size, size, 0, 0, side, side);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Couldn't encode the avatar"))),
      "image/jpeg",
      0.9,
    );
  });
}

/** A photo picked on the device, made into an avatar. */
export async function photoToAvatar(photo: Blob): Promise<Blob> {
  const url = URL.createObjectURL(photo);
  try {
    return await pictureToAvatar(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}
