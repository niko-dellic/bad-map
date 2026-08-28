import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const galleryDirectory = join(root, "docs", "media", "gallery");
const filenames = [
  "theme-dark-greyscale.png",
  "theme-dark-color.png",
  "theme-light-greyscale.png",
  "theme-light-color.png",
  "regional-political.png",
  "coastal-semantic-packs.png",
  "urban-transit.png",
  "buildings-3d.png",
  "data-heatmap.png",
  "data-trips.png",
  "data-highways.png",
  "data-geometry-waypoints.png",
];

const readPngDimensions = (buffer) => {
  const signature = "89504e470d0a1a0a";
  if (buffer.subarray(0, 8).toString("hex") !== signature)
    throw new Error("not a PNG file");
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
};

const readme = await readFile(join(root, "README.md"), "utf8");
const errors = [];

for (const filename of filenames) {
  const path = join(galleryDirectory, filename);
  try {
    const file = await readFile(path);
    const dimensions = readPngDimensions(file);
    if (dimensions.width !== 1200 || dimensions.height !== 750)
      errors.push(
        `${filename} is ${dimensions.width}×${dimensions.height}; expected 1200×750`,
      );
    if (
      (readme.match(new RegExp(filename.replaceAll(".", "\\."), "g")) ?? [])
        .length !== 1
    )
      errors.push(`${filename} must appear exactly once in README.md`);
    const metadata = await stat(path);
    if (metadata.size > 1_500_000)
      errors.push(`${filename} exceeds the 1.5 MB image budget`);
  } catch (error) {
    errors.push(
      `${filename}: ${error instanceof Error ? error.message : error}`,
    );
  }
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`README gallery: ${filenames.length} images verified`);
}
