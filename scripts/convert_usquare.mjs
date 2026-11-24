/**
 * USquare Campus — IFC to XKT Conversion
 *
 * Converts the 4 USquare IFC files to xeokit XKT format.
 * Each IFC becomes a separate XKT model that the viewer loads simultaneously.
 *
 * Usage:
 *   node scripts/convert_usquare.mjs              # Convert all files
 *   node scripts/convert_usquare.mjs --only=M     # Convert only Building M (quick test)
 *   node scripts/convert_usquare.mjs --only=ABC   # Convert only ABC architectural
 *   node scripts/convert_usquare.mjs --only=SITE  # Convert only site model
 *   node scripts/convert_usquare.mjs --only=MEP   # Convert only MEP/technical
 *
 * Models are output to frontend/public/models/usquare/
 * Estimated conversion times (depends on hardware):
 *   - Building M:    ~2-5 min   (36 MB IFC)
 *   - Site:          ~15-25 min (229 MB IFC)
 *   - ABC Arch:      ~20-35 min (288 MB IFC)
 *   - ABC MEP:       ~25-40 min (321 MB IFC)
 */

import { existsSync, mkdirSync, statSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..");

const IFC_DIR = "C:\\Users\\sushe\\Downloads\\USquare";

const OUTPUT_DIR = join(PROJECT_ROOT, "frontend", "public", "models", "usquare");

// Model definitions: id, source IFC filename, output XKT name, description
const MODELS = [
  {
    id: "M",
    ifc: "USQUARE-13895_BATIMENT_M_BIM_ASBUILT.ifc",
    xkt: "usquare_m.xkt",
    label: "Building M (Architecture)",
    layer: "architecture",
  },
  {
    id: "SITE",
    ifc: "SITE_USQUARE_BPC.ifc",
    xkt: "usquare_site.xkt",
    label: "Campus Site",
    layer: "site",
  },
  {
    id: "ABC",
    ifc: "USQUARE-13895_BATIMENT_ABC_BIM_ASBUILT.ifc",
    xkt: "usquare_abc.xkt",
    label: "Buildings A/B/C (Architecture)",
    layer: "architecture",
  },
  {
    id: "MEP",
    ifc: "USQUARE-13895_TS_BATIMENT_ABC_BIM_ASBUILT.ifc",
    xkt: "usquare_mep.xkt",
    label: "Buildings A/B/C (MEP/Technical Systems)",
    layer: "mep",
  },
];

// Parse --only flag
const onlyArg = process.argv.find((a) => a.startsWith("--only="));
const onlyId = onlyArg ? onlyArg.split("=")[1].toUpperCase() : null;

// Create output directory
if (!existsSync(OUTPUT_DIR)) {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  console.log(`Created output directory: ${OUTPUT_DIR}`);
}

console.log("=".repeat(70));
console.log("  Delta Intelligence Platform — USquare IFC → XKT Conversion");
console.log("=".repeat(70));
console.log();

const toConvert = onlyId
  ? MODELS.filter((m) => m.id === onlyId)
  : MODELS;

if (toConvert.length === 0) {
  console.error(`Unknown model ID: ${onlyId}`);
  console.error(`Available: ${MODELS.map((m) => m.id).join(", ")}`);
  process.exit(1);
}

console.log(`Models to convert: ${toConvert.map((m) => m.id).join(", ")}`);
console.log();

const results = [];

for (const model of toConvert) {
  const ifcPath = join(IFC_DIR, model.ifc);
  const xktPath = join(OUTPUT_DIR, model.xkt);

  console.log("-".repeat(70));
  console.log(`  ${model.label}`);
  console.log(`  IFC: ${model.ifc}`);
  console.log(`  XKT: ${model.xkt}`);
  console.log("-".repeat(70));

  // Check source exists
  if (!existsSync(ifcPath)) {
    console.error(`  ERROR: IFC not found: ${ifcPath}`);
    results.push({ ...model, status: "error", reason: "IFC not found" });
    continue;
  }

  const ifcSize = statSync(ifcPath).size;
  console.log(`  IFC size: ${(ifcSize / 1e6).toFixed(1)} MB`);

  // Check if XKT already exists
  if (existsSync(xktPath)) {
    const xktSize = statSync(xktPath).size;
    console.log(
      `  XKT already exists (${(xktSize / 1e6).toFixed(1)} MB). Skipping.`
    );
    console.log(`  Delete to reconvert: del "${xktPath}"`);
    results.push({ ...model, status: "skipped", xktSize });
    continue;
  }

  // Convert
  console.log(`  Converting... (this may take a while)`);
  const startTime = Date.now();

  try {
    const cmd = `npx xeokit-convert -s "${ifcPath}" -o "${xktPath}"`;
    execSync(cmd, {
      cwd: PROJECT_ROOT,
      stdio: "inherit",
      maxBuffer: 1024 * 1024 * 200, // 200MB buffer
      timeout: 7200000, // 2 hour timeout per file
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const xktSize = existsSync(xktPath) ? statSync(xktPath).size : 0;

    console.log();
    console.log(
      `  Done in ${elapsed}s → ${(xktSize / 1e6).toFixed(1)} MB XKT`
    );
    results.push({ ...model, status: "ok", elapsed, xktSize });
  } catch (err) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.error(`  FAILED after ${elapsed}s: ${err.message}`);
    results.push({ ...model, status: "error", elapsed, reason: err.message });
  }

  console.log();
}

// Summary
console.log("=".repeat(70));
console.log("  CONVERSION SUMMARY");
console.log("=".repeat(70));

for (const r of results) {
  const size = r.xktSize ? `${(r.xktSize / 1e6).toFixed(1)} MB` : "N/A";
  const time = r.elapsed ? `${r.elapsed}s` : "";
  console.log(
    `  ${r.id.padEnd(6)} ${r.status.padEnd(8)} ${size.padStart(10)}  ${time.padStart(8)}  ${r.label}`
  );
}

const totalXKT = results
  .filter((r) => r.xktSize)
  .reduce((sum, r) => sum + r.xktSize, 0);
console.log();
console.log(`  Total XKT size: ${(totalXKT / 1e6).toFixed(1)} MB`);
console.log(`  Output dir: ${OUTPUT_DIR}`);
console.log();

// Generate model manifest for the viewer
const manifest = {
  models: results
    .filter((r) => r.status === "ok" || r.status === "skipped")
    .map((r) => ({
      id: `usquare_${r.id.toLowerCase()}`,
      file: r.xkt,
      label: r.label,
      layer: r.layer,
      loadByDefault: r.layer !== "mep", // MEP off by default (heavy)
    })),
};

const manifestPath = join(OUTPUT_DIR, "manifest.json");
import { writeFileSync } from "fs";
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
console.log(`  Model manifest: ${manifestPath}`);
