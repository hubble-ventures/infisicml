// Generate schema/secrets.schema.json from the Zod manifest schema, so the
// published JSON Schema and the runtime validator can never drift. Zod 4 ships
// JSON-Schema conversion natively (no extra dependency).
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { manifestSchema } from "../src/core/schema.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outPath = join(root, "schema", "secrets.schema.json");

const jsonSchema = z.toJSONSchema(manifestSchema, { target: "draft-2020-12" });
const document = {
  $id: "https://github.com/hubble-ventures/infisicml/schema/secrets.schema.json",
  title: "infisicml secrets manifest",
  ...jsonSchema,
};

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(document, null, 2)}\n`);
console.log(`Wrote ${outPath}`);
