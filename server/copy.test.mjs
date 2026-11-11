// Phase 2.1 — UI copy guard: task estimates are planning forecasts ONLY.
//
// The actuals-only accounting invariant: the Scope Meter derives from
// time_logs plus manual adjustments; task estimates never touch it. UI copy
// claiming estimates feed the meter teaches the wrong model and sets the
// wrong billing expectation, so this guard greps the client source's
// user-visible strings for that claim. Fails BEFORE the 2.1 fix (4 offending
// strings in TasksPage/Dashboard) and passes after.
//
// Scope: lines rendering UI attributes (title= / subtitle= / placeholder= /
// aria-label=). Code comments are intentionally out of scope.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CLIENT_SRC = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "client",
  "src"
);

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
};

// Phrases implying estimates move the Scope Meter (the defect).
const FORBIDDEN = [
  "fed to the Scope Meter",
  "feeds the Scope Meter",
  "to the meter", // also catches `adds ${t.estimated_hours}h to the meter`
];
// Copy stating the actual model — what the 2.1 fix writes instead.
const REQUIRED = {
  "pages/TasksPage.jsx": "counts tracked time",
  "pages/Dashboard.jsx": "never moves the Scope Meter",
};

const UI_ATTR = /(?:title|subtitle|placeholder|aria-label)\s*=/;

function* sourceFiles(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* sourceFiles(p);
    else if (entry.name.endsWith(".jsx") || entry.name.endsWith(".js")) yield p;
  }
}

const offenders = [];
for (const file of sourceFiles(CLIENT_SRC)) {
  const rel = path.relative(CLIENT_SRC, file).replaceAll("\\", "/");
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  lines.forEach((line, i) => {
    if (!UI_ATTR.test(line)) return;
    for (const phrase of FORBIDDEN) {
      if (line.includes(phrase)) {
        offenders.push(`${rel}:${i + 1} → ${line.trim()}`);
      }
    }
  });
}

console.log("— UI copy must match actuals-only accounting —");
ok(
  "no UI copy claims estimates feed the Scope Meter",
  offenders.length === 0,
  `\n      ${offenders.join("\n      ")}`
);
for (const [rel, marker] of Object.entries(REQUIRED)) {
  const src = fs.readFileSync(path.join(CLIENT_SRC, ...rel.split("/")), "utf8");
  ok(`${rel} states the corrected accounting model`, src.includes(marker));
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
