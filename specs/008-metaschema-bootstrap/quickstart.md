# Quickstart: validating a schema against the meta-schema

```ts
import { metaValidate } from "cascata";
import { createNodeHost, nodeMetaSchemaLocation } from "cascata/host/node";

const result = await metaValidate({
  host: createNodeHost(),
  subject: "./my-schema.yaml",
  metaSchema: nodeMetaSchemaLocation(),
});

if (!result.ok) {
  for (const d of result.diagnostics) {
    console.error(`${d.code}: ${d.message}`);
  }
}
```

Publishing a schema is validating it as a config (§2.6). This is that call, and nothing else in the
pipeline changes: `load()` does not run it (research.md D-2).

The meta-schema validates **itself**:

```ts
const meta = nodeMetaSchemaLocation();
await metaValidate({ host: createNodeHost(), subject: meta, metaSchema: meta }); // ok: true
```
