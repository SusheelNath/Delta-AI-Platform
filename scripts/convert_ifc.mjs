/**
 * Delta Intelligence Platform — IFC to XKT Conversion
 *
 * Converts the CHIREC Delta Hospital IFC file to xeokit's XKT format
 * for fast browser-based 3D rendering.
 *
 * Usage:
 *   node scripts/convert_ifc.mjs              # Convert original IFC
 *   node scripts/convert_ifc.mjs --filtered   # Convert filtered IFC (after running filter_ifc.py)
 *
 * NOTE: The IFC file is 678MB. This conversion will:
 * - Take 10-30 minutes depending on hardware
 * - Require 4-8GB of RAM
 * - Produce an XKT file of ~50-150MB
 */

import { existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..");

const useFiltered = process.argv.includes("--filtered");

const IFC_ORIGINAL = join(
  "C:\\Users\\sushe\\Downloads",
  "A10004_Chirec_Light_IFC (1).ifc"
);
const IFC_FILTERED = join(__dirname, "hospital_filtered.ifc");

const IFC_PATH = useFiltered ? IFC_FILTERED : IFC_ORIGINAL;

const XKT_OUTPUT = join(
  PROJECT_ROOT,
  "frontend",
  "public",
  "models",
  "hospital.xkt"
);

console.log("=".repeat(60));
console.log("Delta Intelligence Platform — IFC to XKT Conversion");
console.log("=".repeat(60));
console.log(`Mode: ${useFiltered ? "FILTERED (baked exclusions)" : "ORIGINAL (full IFC)"}`);
console.log(`IFC Source: ${IFC_PATH}`);
console.log(`XKT Output: ${XKT_OUTPUT}`);
console.log();

if (!existsSync(IFC_PATH)) {
  if (useFiltered) {
    console.error(`ERROR: Filtered IFC not found at ${IFC_PATH}`);
    console.error("Run the filter script first: python scripts/filter_ifc.py");
  } else {
    console.error(`ERROR: IFC file not found at ${IFC_PATH}`);
  }
  process.exit(1);
}

if (existsSync(XKT_OUTPUT)) {
  console.log("XKT file already exists. Delete it first to reconvert.");
  console.log(`  del "${XKT_OUTPUT}"`);
  process.exit(0);
}

console.log("Starting conversion (this may take 10-30 minutes for a 678MB file)...");
console.log("Progress will be shown below.");
console.log();

const startTime = Date.now();

try {
  const cmd = `npx xeokit-convert -s "${IFC_PATH}" -o "${XKT_OUTPUT}"`;
  execSync(cmd, {
    cwd: PROJECT_ROOT,
    stdio: "inherit",
    maxBuffer: 1024 * 1024 * 100,
    timeout: 3600000, // 1 hour timeout
  });

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log();
  console.log("=".repeat(60));
  console.log(`Conversion complete in ${elapsed}s`);
  console.log(`XKT file: ${XKT_OUTPUT}`);
  if (useFiltered) {
    console.log("NOTE: This XKT was built from the filtered IFC (exclusions baked in).");
    console.log("Hidden objects from the browser tool are permanently removed.");
  }
  console.log("=".repeat(60));
} catch (err) {
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.error(`\nConversion failed after ${elapsed}s`);
  console.error(err.message);
  process.exit(1);
}
