// Syncs GitHub repo secrets to the Vercel project: any secret that is not
// already present in Vercel (per environment) gets added. Existing values are
// never overwritten. Values are never printed — only key names.
//
// Inputs (env): VERCEL_TOKEN, SECRETS_JSON (from `toJSON(secrets)`),
// VERCEL_ORG_ID + VERCEL_PROJECT_ID (so the CLI resolves the project unlinked).

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const token = process.env.VERCEL_TOKEN;
if (!token) {
  console.log("VERCEL_TOKEN no está seteado — se omite la sincronización.");
  process.exit(0);
}

// Secrets that must never be pushed to Vercel as app env vars.
const DENY = new Set(
  [
    "VERCEL_TOKEN",
    "VERCEL_ORG_ID",
    "VERCEL_PROJECT_ID",
    "VERCEL_OIDC_TOKEN", // Vercel injects this itself — pushing it would break OIDC
    "GITHUB_TOKEN",
  ].map((k) => k.toLowerCase()),
);
const isDenied = (key) => DENY.has(key.toLowerCase()) || key.toUpperCase().startsWith("GITHUB_");

const ENVIRONMENTS = ["production", "preview", "development"];

const secrets = JSON.parse(process.env.SECRETS_JSON || "{}");
const candidates = Object.keys(secrets).filter((k) => !isDenied(k));

if (candidates.length === 0) {
  console.log("No hay secrets candidatos para sincronizar.");
  process.exit(0);
}

const tmp = mkdtempSync(join(tmpdir(), "betia-env-"));

/** Keys already present in Vercel for a given environment. */
function existingKeys(environment) {
  const file = join(tmp, `${environment}.env`);
  try {
    execFileSync(
      "vercel",
      ["env", "pull", file, "--environment", environment, "--yes", "--token", token],
      { stdio: ["ignore", "ignore", "inherit"] },
    );
  } catch {
    return new Set(); // treat as empty; we'll try to add and skip on conflict
  }
  const keys = new Set();
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=/);
    if (m) keys.add(m[1]);
  }
  return keys;
}

const added = [];
for (const environment of ENVIRONMENTS) {
  const present = existingKeys(environment);
  for (const key of candidates) {
    if (present.has(key)) continue;
    try {
      execFileSync("vercel", ["env", "add", key, environment, "--token", token], {
        input: String(secrets[key]),
        stdio: ["pipe", "ignore", "inherit"],
      });
      added.push(`${key} (${environment})`);
    } catch {
      // Most likely the var already exists for this environment — skip it.
      console.log(`· ${key} (${environment}): ya existía o no se pudo agregar, se omite`);
    }
  }
}

if (added.length === 0) {
  console.log("Vercel ya tenía todas las variables. Nada para sincronizar.");
} else {
  console.log(`Agregadas a Vercel: ${added.join(", ")}`);
}
