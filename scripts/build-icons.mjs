import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";

import {
  SVGIcons2SVGFontStream,
} from "svgicons2svgfont";

import svg2ttf from "svg2ttf";
import ttf2woff2 from "ttf2woff2";

// ============================================================
// PATHS
// ============================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT_DIR = path.resolve(__dirname, "..");

const SVG_DIR = path.join(ROOT_DIR, "src", "icons", "svg");
const ICON_DIR = path.join(ROOT_DIR, "src", "icons");
const LOCK_FILE = path.join(ICON_DIR, "icons.lock.json");

const OUTPUT_DIR = path.join(ROOT_DIR, "dist", "icons");

const WOFF2_FILE = path.join(
  OUTPUT_DIR,
  "ak-icons.woff2",
);

const CSS_FILE = path.join(
  OUTPUT_DIR,
  "ak-icons.css",
);

const MANIFEST_FILE = path.join(
  OUTPUT_DIR,
  "manifest.json",
);

// ============================================================
// CONFIG
// ============================================================

const CONFIG = {
  fontName: "AK Icons",
  fontFamily: "ak-icons",

  cssPrefix: "ak-icon",

  version: "0.1.0",
  fontVersion: "0.1",

  fontHeight: 1000,

  unicodeStart: 0xe000,
  unicodeEnd: 0xf8ff,

  fontWeight: "normal",
  fontStyle: "normal",
  fontDisplay: "block",
};

// ============================================================
// LOG
// ============================================================

function log(message = "") {
  console.log(message);
}

function logHeader(title) {
  log("");
  log("========================================");
  log(` ${title}`);
  log("========================================");
  log("");
}

// ============================================================
// FILE HELPERS
// ============================================================

function ensureDir(dir) {
  fs.mkdirSync(dir, {
    recursive: true,
  });
}

function readJson(file) {
  return JSON.parse(
    fs.readFileSync(file, "utf8"),
  );
}

function writeJson(file, data) {
  fs.writeFileSync(
    file,
    JSON.stringify(data, null, 2) + "\n",
    "utf8",
  );
}

// ============================================================
// STRING HELPERS
// ============================================================

function toKebabCase(value) {
  return value
    .replace(/\.svg$/i, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function normalizeUnicode(value) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value
    .trim()
    .toUpperCase()
    .replace(/^U\+/, "");

  if (!/^[0-9A-F]{4,6}$/.test(normalized)) {
    return null;
  }

  return normalized;
}

function unicodeToChar(codePoint) {
  return String.fromCodePoint(
    parseInt(codePoint, 16),
  );
}

function unicodeToCss(codePoint) {
  return `\\${codePoint.toLowerCase()}`;
}

// ============================================================
// ICON NAME
// ============================================================

function buildIconName(relativePath) {
  const normalizedPath = relativePath
    .replace(/\\/g, "/");

  const parts = normalizedPath.split("/");

  if (parts.length < 2) {
    throw new Error(
      `Icon must be inside a namespace folder: ${relativePath}`,
    );
  }

  const fileName = parts.pop();

  const namespace = toKebabCase(parts[0]);

  const rest = [
    ...parts.slice(1),
    toKebabCase(fileName),
  ]
    .filter(Boolean)
    .join("-");

  if (!namespace) {
    throw new Error(
      `Invalid namespace: ${parts[0]}`,
    );
  }

  if (!rest) {
    throw new Error(
      `Invalid icon name: ${relativePath}`,
    );
  }

  const name = `${namespace}-${rest}`;

  if (!/^[a-z0-9-]+$/.test(name)) {
    throw new Error(
      `Invalid icon name "${name}". Only a-z, 0-9 and - are allowed.`,
    );
  }

  return {
    name,
    group: namespace,
  };
}

// ============================================================
// SVG DISCOVERY
// ============================================================

function collectSvgFiles(dir, baseDir = dir) {
  const result = [];

  if (!fs.existsSync(dir)) {
    return result;
  }

  const entries = fs.readdirSync(dir, {
    withFileTypes: true,
  });

  for (const entry of entries) {
    const fullPath = path.join(
      dir,
      entry.name,
    );

    if (entry.isDirectory()) {
      result.push(
        ...collectSvgFiles(fullPath, baseDir),
      );

      continue;
    }

    if (
      entry.isFile() &&
      entry.name.toLowerCase().endsWith(".svg")
    ) {
      result.push({
        filePath: fullPath,
        relativePath: path
          .relative(baseDir, fullPath)
          .replace(/\\/g, "/"),
      });
    }
  }

  return result.sort((a, b) =>
    a.relativePath.localeCompare(
      b.relativePath,
    ),
  );
}

// ============================================================
// SVG VALIDATION
// ============================================================

function validateSvg(content, filePath) {
  if (!/<svg[\s>]/i.test(content)) {
    throw new Error(
      `SVG root not found: ${filePath}`,
    );
  }

  if (!/\bviewBox\s*=/i.test(content)) {
    throw new Error(
      `SVG viewBox is required: ${filePath}`,
    );
  }

  const hasDrawableElement =
    /<(path|rect|circle|ellipse|polygon|polyline|line|g)\b/i.test(
      content,
    );

  if (!hasDrawableElement) {
    throw new Error(
      `No drawable SVG element found: ${filePath}`,
    );
  }
}

// ============================================================
// SVG NORMALIZATION
// ============================================================

function normalizeSvg(content) {
  return content
    .replace(/<\?xml[\s\S]*?\?>/gi, "")
    .replace(/<!DOCTYPE[\s\S]*?>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .trim();
}

// ============================================================
// LOCK FILE
// ============================================================

function createEmptyLock() {
  return {
    version: 1,
    fontFamily: CONFIG.fontFamily,
    icons: {},
  };
}

function loadLock() {
  if (!fs.existsSync(LOCK_FILE)) {
    return createEmptyLock();
  }

  const lock = readJson(LOCK_FILE);

  if (
    !lock ||
    typeof lock !== "object" ||
    !lock.icons ||
    typeof lock.icons !== "object"
  ) {
    throw new Error(
      `Invalid lock file: ${LOCK_FILE}`,
    );
  }

  return lock;
}

function validateLock(lock) {
  const used = new Map();

  for (const [name, data] of Object.entries(
    lock.icons,
  )) {
    if (!data || typeof data !== "object") {
      throw new Error(
        `Invalid lock entry: ${name}`,
      );
    }

    const codePoint = normalizeUnicode(
      data.codePoint,
    );

    if (!codePoint) {
      throw new Error(
        `Invalid codePoint for ${name}: ${data.codePoint}`,
      );
    }

    const number = parseInt(
      codePoint,
      16,
    );

    if (
      number < CONFIG.unicodeStart ||
      number > CONFIG.unicodeEnd
    ) {
      throw new Error(
        `Code point out of range for ${name}: ${codePoint}`,
      );
    }

    if (used.has(codePoint)) {
      throw new Error(
        `Duplicate code point ${codePoint}: ${used.get(codePoint)} and ${name}`,
      );
    }

    used.set(codePoint, name);
  }
}

// ============================================================
// CODE POINT ALLOCATION
// ============================================================

function allocateCodePoints(lock, iconNames) {
  const used = new Set();

  for (const data of Object.values(lock.icons)) {
    used.add(
      normalizeUnicode(data.codePoint),
    );
  }

  let nextCodePoint =
    CONFIG.unicodeStart;

  for (const name of iconNames) {
    if (lock.icons[name]) {
      continue;
    }

    while (
      used.has(
        nextCodePoint
          .toString(16)
          .toUpperCase(),
      )
    ) {
      nextCodePoint++;
    }

    if (
      nextCodePoint >
      CONFIG.unicodeEnd
    ) {
      throw new Error(
        "Unicode Private Use Area is exhausted.",
      );
    }

    const codePoint =
      nextCodePoint
        .toString(16)
        .toUpperCase();

    lock.icons[name] = {
      group: name.split("-")[0],
      codePoint,
    };

    used.add(codePoint);

    nextCodePoint++;
  }

  return lock;
}

// ============================================================
// BUILD ICON METADATA
// ============================================================

function buildIcons(svgFiles, lock) {
  return svgFiles.map((item) => {
    const icon = buildIconName(
      item.relativePath,
    );

    const lockEntry =
      lock.icons[icon.name];

    if (!lockEntry) {
      throw new Error(
        `Missing lock entry for ${icon.name}`,
      );
    }

    return {
      ...icon,

      filePath: item.filePath,

      relativePath: item.relativePath,

      codePoint: normalizeUnicode(
        lockEntry.codePoint,
      ),

      unicode: unicodeToChar(
        lockEntry.codePoint,
      ),

      className:
        `${CONFIG.cssPrefix}-${icon.name}`,
    };
  });
}

// ============================================================
// BUILD SVG FONT
// ============================================================

async function buildSvgFont(icons) {
  return new Promise(
    (resolve, reject) => {
      const fontStream =
        new SVGIcons2SVGFontStream({
          fontName: CONFIG.fontName,

          normalize: true,

          fontHeight:
            CONFIG.fontHeight,

          descent: 0,
        });

      const chunks = [];

      fontStream.on(
        "data",
        (chunk) => {
          chunks.push(
            Buffer.from(chunk),
          );
        },
      );

      fontStream.on(
        "error",
        reject,
      );

      fontStream.on(
        "end",
        () => {
          resolve(
            Buffer.concat(chunks).toString(
              "utf8",
            ),
          );
        },
      );

      for (const icon of icons) {
        let svg = fs.readFileSync(
          icon.filePath,
          "utf8",
        );

        validateSvg(
          svg,
          icon.filePath,
        );

        svg = normalizeSvg(svg);

        const glyph = Readable.from([
          Buffer.from(svg, "utf8"),
        ]);

        glyph.metadata = {
          name: icon.name,

          unicode: [
            icon.unicode,
          ],

          renamed: false,

          codePoints: [
            parseInt(
              icon.codePoint,
              16,
            ),
          ],
        };

        fontStream.write(glyph);
      }

      fontStream.end();
    },
  );
}

// ============================================================
// BUILD CSS
// ============================================================

function buildCss(icons) {
  const lines = [];

  lines.push(
    "/* ==================================================",
  );

  lines.push(
    "   AK UI - AK Icons",
  );

  lines.push(
    `   Version: ${CONFIG.version}`,
  );

  lines.push(
    "   ================================================== */",
  );

  lines.push("");

  lines.push("@font-face {");

  lines.push(
    `  font-family: "${CONFIG.fontFamily}";`,
  );

  lines.push(
    `  src: url("./ak-icons.woff2") format("woff2");`,
  );

  lines.push(
    `  font-weight: ${CONFIG.fontWeight};`,
  );

  lines.push(
    `  font-style: ${CONFIG.fontStyle};`,
  );

  lines.push(
    `  font-display: ${CONFIG.fontDisplay};`,
  );

  lines.push("}");

  lines.push("");

  lines.push(
    `.${CONFIG.cssPrefix} {`,
  );

  lines.push(
    `  font-family: "${CONFIG.fontFamily}" !important;`,
  );

  lines.push(
    "  font-style: normal;",
  );

  lines.push(
    "  font-weight: normal;",
  );

  lines.push(
    "  font-variant: normal;",
  );

  lines.push(
    "  text-transform: none;",
  );

  lines.push(
    "  line-height: 1;",
  );

  lines.push(
    "  display: inline-block;",
  );

  lines.push(
    "  speak: never;",
  );

  lines.push(
    "-webkit-font-smoothing: antialiased;",
  );

  lines.push(
    "-moz-osx-font-smoothing: grayscale;",
  );

  lines.push("}");

  lines.push("");

  for (const icon of icons) {
    lines.push(
      `.${icon.className}::before {`,
    );

    lines.push(
      `  content: "${unicodeToCss(icon.codePoint)}";`,
    );

    lines.push("}");

    lines.push("");
  }

  return lines.join("\n");
}

// ============================================================
// BUILD MANIFEST
// ============================================================

function buildManifest(icons) {
  const groups = {};

  for (const icon of icons) {
    if (!groups[icon.group]) {
      groups[icon.group] = [];
    }

    groups[icon.group].push(
      icon.name,
    );
  }

  return {
    name: CONFIG.fontName,

    family: CONFIG.fontFamily,

    version: CONFIG.version,

    format: "woff2",

    count: icons.length,

    groups,

    icons: icons.map((icon) => ({
      name: icon.name,

      group: icon.group,

      className: icon.className,

      unicode: icon.codePoint,

      file: icon.relativePath,
    })),
  };
}

// ============================================================
// MAIN BUILD
// ============================================================

async function main() {
  logHeader("AK UI ICON BUILD");

  log(`Root:     ${ROOT_DIR}`);
  log(`SVG:      ${SVG_DIR}`);
  log(`Lock:     ${LOCK_FILE}`);
  log(`Output:   ${OUTPUT_DIR}`);
  log("");

  // ----------------------------------------------------------
  // Check source directory
  // ----------------------------------------------------------

  if (!fs.existsSync(SVG_DIR)) {
    throw new Error(
      `SVG directory does not exist: ${SVG_DIR}`,
    );
  }

  // ----------------------------------------------------------
  // Discover SVG files
  // ----------------------------------------------------------

  const svgFiles =
    collectSvgFiles(SVG_DIR);

  if (svgFiles.length === 0) {
    throw new Error(
      `No SVG icons found in ${SVG_DIR}`,
    );
  }

  log(
    `Found ${svgFiles.length} SVG icon(s).`,
  );

  // ----------------------------------------------------------
  // Build names
  // ----------------------------------------------------------

  const iconDefinitions =
    svgFiles.map((item) => ({
      ...item,

      ...buildIconName(
        item.relativePath,
      ),
    }));

  // ----------------------------------------------------------
  // Detect duplicate names
  // ----------------------------------------------------------

  const nameMap = new Map();

  for (const icon of iconDefinitions) {
    if (nameMap.has(icon.name)) {
      throw new Error(
        `Duplicate icon name "${icon.name}":\n` +
        `  ${nameMap.get(icon.name)}\n` +
        `  ${icon.relativePath}`,
      );
    }

    nameMap.set(
      icon.name,
      icon.relativePath,
    );
  }

  // ----------------------------------------------------------
  // Lock
  // ----------------------------------------------------------

  const lock = loadLock();

  validateLock(lock);

  allocateCodePoints(
    lock,
    iconDefinitions
      .map((icon) => icon.name)
      .sort(),
  );

  validateLock(lock);

  // ----------------------------------------------------------
  // Save lock
  // ----------------------------------------------------------

  ensureDir(ICON_DIR);

  writeJson(
    LOCK_FILE,
    lock,
  );

  log(
    `✓ Lock file: ${path.relative(
      ROOT_DIR,
      LOCK_FILE,
    )}`,
  );

  // ----------------------------------------------------------
  // Build icon metadata
  // ----------------------------------------------------------

  const icons =
    buildIcons(
      svgFiles,
      lock,
    );

  // ----------------------------------------------------------
  // Validate all SVG
  // ----------------------------------------------------------

  for (const icon of icons) {
    const svg =
      fs.readFileSync(
        icon.filePath,
        "utf8",
      );

    validateSvg(
      svg,
      icon.filePath,
    );
  }

  log(
    `✓ Validated ${icons.length} SVG icon(s).`,
  );

  // ----------------------------------------------------------
  // Build SVG font
  // ----------------------------------------------------------

  log("Building SVG font...");

  const svgFont =
    await buildSvgFont(
      icons,
    );

  log("✓ SVG font generated.");

  // ----------------------------------------------------------
  // SVG Font → TTF
  // ----------------------------------------------------------

  log("Converting SVG font → TTF...");

  const ttfResult =
    svg2ttf(svgFont, {
      version: CONFIG.fontVersion,
    });

  if (
    !ttfResult ||
    !ttfResult.buffer
  ) {
    throw new Error(
      "svg2ttf did not return a valid TTF buffer.",
    );
  }

  const ttfBuffer =
    Buffer.from(ttfResult.buffer);

  log(
    `✓ TTF generated: ${ttfBuffer.length} bytes`,
  );

  // ----------------------------------------------------------
  // TTF → WOFF2
  // ----------------------------------------------------------

  log("Converting TTF → WOFF2...");

  const woff2Buffer =
    ttf2woff2(ttfBuffer);

  if (!Buffer.isBuffer(woff2Buffer)) {
    throw new Error(
      "ttf2woff2 did not return a Buffer.",
    );
  }

  // ----------------------------------------------------------
  // Output directory
  // ----------------------------------------------------------

  ensureDir(OUTPUT_DIR);

  // ----------------------------------------------------------
  // Write WOFF2
  // ----------------------------------------------------------

  fs.writeFileSync(
    WOFF2_FILE,
    woff2Buffer,
  );

  // ----------------------------------------------------------
  // Write CSS
  // ----------------------------------------------------------

  const css =
    buildCss(icons);

  fs.writeFileSync(
    CSS_FILE,
    css,
    "utf8",
  );

  // ----------------------------------------------------------
  // Write manifest
  // ----------------------------------------------------------

  const manifest =
    buildManifest(
      icons,
    );

  writeJson(
    MANIFEST_FILE,
    manifest,
  );

  // ----------------------------------------------------------
  // Summary
  // ----------------------------------------------------------

  log("");
  log("========================================");
  log(" BUILD SUCCESS");
  log("========================================");
  log("");

  log(
    `Icons:    ${icons.length}`,
  );

  log(
    `WOFF2:    ${path.relative(
      ROOT_DIR,
      WOFF2_FILE,
    )}`,
  );

  log(
    `CSS:      ${path.relative(
      ROOT_DIR,
      CSS_FILE,
    )}`,
  );

  log(
    `Manifest: ${path.relative(
      ROOT_DIR,
      MANIFEST_FILE,
    )}`,
  );

  log(
    `Lock:     ${path.relative(
      ROOT_DIR,
      LOCK_FILE,
    )}`,
  );

  log("");
}

// ============================================================
// ERROR HANDLING
// ============================================================

main().catch((error) => {
  console.error("");
  console.error("========================================");
  console.error(" BUILD FAILED");
  console.error("========================================");
  console.error("");
  console.error(
    error?.stack || error,
  );
  console.error("");

  process.exit(1);
});