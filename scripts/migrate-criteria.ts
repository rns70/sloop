/**
 * One-shot migration: rewrite every ADR and loop so acceptance criteria move from
 * frontmatter into the markdown body. Read populates the structured field (with the
 * legacy frontmatter fallback); write serializes it back into the body section.
 * Idempotent — running it again is a no-op once files are migrated.
 *
 * Usage: SLOOP_WORKSPACE=fixtures/sample-workspace npx tsx scripts/migrate-criteria.ts
 */
import { FilesServiceImpl, resolveWorkspaceRoot } from '../src/server/files/filesService';

async function main() {
  const files = new FilesServiceImpl(resolveWorkspaceRoot());

  for (const adr of await files.listAdrs()) {
    await files.writeAdr(adr);
    console.log(`migrated ADR  ${adr.relPath}`);
  }

  for (const cascadeId of await files.listCascadeIds()) {
    for (const loop of await files.listLoops(cascadeId)) {
      await files.writeLoop(loop);
      console.log(`migrated loop ${loop.relPath}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
