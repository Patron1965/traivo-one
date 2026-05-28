import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { buildTemplateWorkbook } from "../server/routes/objektmallImportRoutes";
import { OBJEKTMALL_FILENAME } from "../shared/objektmall-template";

const out = process.argv[2] ?? `exports/${OBJEKTMALL_FILENAME}`;

(async () => {
  const buf = await buildTemplateWorkbook();
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, buf);
  console.log(`Skrev ${buf.length} bytes till ${out}`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
