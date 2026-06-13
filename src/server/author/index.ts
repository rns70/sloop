// WP-7 author assistant — server side. The logic behind `POST /api/author`:
// Cursor-style editing of databank docs through pi-ai, returning a proposal (never a write).
export {
  createAuthorService,
  toPiModel,
  type AuthorService,
  type AuthorDeps,
  type AuthorFiles,
  type AuthorModelCall,
  type AuthorResult,
} from './authorService';
export {
  buildAuthorPrompt,
  pickAuthorAlias,
  type AuthorDoc,
  type AuthorPromptParts,
} from './prompt';
