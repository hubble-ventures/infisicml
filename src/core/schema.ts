import { z } from "zod";

// Environment-variable names and vault key names share this shape.
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

const identifier = z
  .string()
  .regex(IDENT, "must be a valid environment-variable name");

// A key entry is either a bare source key (emitted under its own name) or a
// single-pair map `{ SOURCE: TARGET }` that aliases it to another name.
const keyEntrySchema = z.union([
  identifier,
  z
    .record(identifier, identifier)
    .refine((m) => Object.keys(m).length === 1, {
      message: "an alias must map exactly one source key to one target",
    }),
]);

export type KeyEntry = z.infer<typeof keyEntrySchema>;

// A folder path: leading slash, `/`-separated non-empty segments, no whitespace.
// The root folder `/` is allowed.
const folderPath = z
  .string()
  .regex(
    /^\/(?:[^/\s]+(?:\/[^/\s]+)*)?$/,
    "path must start with '/' and use '/'-separated segments"
  );

const secretsBlockSchema = z.object({
  path: folderPath,
  keys: z.array(keyEntrySchema).min(1, "a secrets block needs at least one key"),
});

export type SecretsBlock = z.infer<typeof secretsBlockSchema>;

const fetchModeSchema = z.enum(["folder", "keys"]);

const outputName = z
  .string()
  .regex(/^[^/\\]+$/, "output must be a bare filename (no path separators)");

// The manifest. `version` is the manifest-format version, independent of the
// package version — bump it only on a breaking format change.
export const manifestSchema = z
  .object({
    $schema: z.string().optional(),
    version: z.literal(1),
    /** Infisical project slug the secrets live in. */
    project: z.string().min(1),
    defaults: z
      .object({
        environment: z.string().min(1).optional(),
        output: outputName.optional(),
        fetch: fetchModeSchema.optional(),
      })
      .strict()
      .optional(),
    /** Ordered folder blocks naming which keys to pull and how to alias them. */
    secrets: z.array(secretsBlockSchema).min(1),
    /** Named alternates that replace `secrets` (and optionally `fetch`) when selected. */
    profiles: z
      .record(
        z.string(),
        z
          .object({
            secrets: z.array(secretsBlockSchema).min(1),
            fetch: fetchModeSchema.optional(),
          })
          .strict()
      )
      .optional(),
    /** Per-environment overrides — currently which keys may be absent. */
    environments: z
      .record(
        z.string(),
        z
          .object({
            optional: z.array(identifier).optional(),
          })
          .strict()
      )
      .optional(),
  })
  .strict();

export type Manifest = z.infer<typeof manifestSchema>;
