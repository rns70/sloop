---
id: "001-add-slugify"
repo: toolkit
baseRef: main
adrPath: databank/adr-030-slugify.md
heldOut:
  - "node --test test/slugify.test.js"
  - "node --test test/regression.test.js"
modelMixes:
  - { plan: opus, execute: haiku }
  - { plan: opus, execute: nemotron }
  - { plan: opus, execute: opus }
---
# Add a `slugify` helper to the toolkit

The toolkit needs a `slugify(input)` function exported from `src/index.js` so callers
can turn arbitrary titles into URL-safe slugs.

`slugify` must:
- lowercase the input,
- trim leading/trailing whitespace,
- collapse internal whitespace runs to a single hyphen,
- strip punctuation (anything that is not a letter, number, or hyphen).

Examples: `"Hello, World!"` → `"hello-world"`; `"  Multiple   spaces  "` → `"multiple-spaces"`.

## Acceptance criteria
- AC1 — a `slugify` function is exported. (verify: `node -e "process.exit(typeof require('./src/index.js').slugify==='function'?0:1)"`)
- AC2 — existing exports still load without error. (verify: `node -e "require('./src/index.js')"`)
