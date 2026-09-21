import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT_DIR = path.resolve(__dirname, "..");
const DIST_DIR = path.join(ROOT_DIR, "dist");

console.log("");
console.log("========================================");
console.log(" AK UI CLEAN");
console.log("========================================");
console.log("");

if (!fs.existsSync(DIST_DIR)) {
  console.log("Nothing to clean.");
  console.log("");
  process.exit(0);
}

fs.rmSync(DIST_DIR, {
  recursive: true,
  force: true,
});

console.log("✓ dist/ cleaned");
console.log("");