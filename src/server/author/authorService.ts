import { complete } from '@earendil-works/pi-ai';
import type { Api, Context, Model } from '@earendil-works/pi-ai';
import type { AuthorRequest, ModelRegistry, ResolvedModel } from '../../shared/index';
import { resolveModel } from '../../shared/index';
import {
  buildAuthorPrompt,
  pickAuthorAlias,
  type AuthorDoc,
  type AuthorPromptParts,
} from './prompt';

/**
 * The authoring assistant service — the logic behind `POST /api/author`.
 *
 * It loads the referenced databank docs, builds a scope-specific prompt (selection /
 * doc / multi), resolves the requested model alias through the registry, and calls the
 * model **provider-agnostically** via `@earendil-works/pi-ai` (so Claude or NVIDIA
 * Nemotron work with identical code). It returns `{ proposal }` — never a write: the
 * proposal is surfaced in the editor as an inline diff the user accepts or rejects.
 */

/**
 * Narrow slice of `FilesService` the author service needs (interface segregation): read
 * a doc's markdown body + the model registry. The real `FilesServiceImpl` satisfies this
 * structurally, so WP-6 can pass it straight in.
 */
export interface AuthorFiles {
  readAdr(relPath: string): Promise<{ body: string; title?: string }>;
  readModelRegistry(): Promise<ModelRegistry>;
}

/**
 * The model call, injectable so tests stand in a fake without a network round trip.
 * The default implementation calls Pi's `complete` with a `Model` built from the
 * resolved registry entry.
 */
export type AuthorModelCall = (
  resolved: ResolvedModel,
  parts: AuthorPromptParts,
) => Promise<string>;

export interface AuthorDeps {
  files: AuthorFiles;
  env?: NodeJS.ProcessEnv;
  /** Override the model call (tests inject a fake). Defaults to the Pi-backed call. */
  call?: AuthorModelCall;
  /** Fallback registry alias when the request names none and `SLOOP_AUTHOR_MODEL` is unset. */
  defaultModel?: string;
}

export interface AuthorResult {
  /** The replacement (selection), edited document (doc/multi), or chat answer. */
  proposal: string;
}

export interface AuthorService {
  author(req: AuthorRequest): Promise<AuthorResult>;
}

const ANTHROPIC_DEFAULT_BASE_URL = 'https://api.anthropic.com';

/**
 * Build a Pi `Model` from a resolved registry entry — the one provider boundary.
 *
 * Mirrors `planner/architect.ts`'s `toPiModel` deliberately: WP-7 stays self-contained
 * (depends only on shared types + pi-ai + WP-4's editor), so it does not import a helper
 * out of another work package's module. Post-hackathon this provider mapping should move
 * to `src/shared` as the single source of truth.
 */
export function toPiModel(resolved: ResolvedModel): Model<Api> {
  const base = {
    id: resolved.id,
    name: resolved.id,
    input: ['text'] as ('text' | 'image')[],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };

  if (resolved.provider === 'anthropic') {
    return {
      ...base,
      api: 'anthropic-messages',
      provider: 'anthropic',
      baseUrl: resolved.baseUrl ?? ANTHROPIC_DEFAULT_BASE_URL,
      reasoning: true,
      contextWindow: 200_000,
      maxTokens: 8_192,
    };
  }

  // nebius (NVIDIA Nemotron et al.) is registered as an OpenAI-compatible provider.
  if (!resolved.baseUrl) {
    throw new Error(
      `Provider "${resolved.provider}" requires a baseUrl in the model registry (OpenAI-compatible endpoint).`,
    );
  }
  return {
    ...base,
    api: 'openai-completions',
    provider: resolved.provider,
    baseUrl: resolved.baseUrl,
    reasoning: false,
    contextWindow: 128_000,
    maxTokens: 8_192,
  };
}

/** Default Pi-backed author call (non-streaming; streaming is a later enhancement). */
const piAuthorCall: AuthorModelCall = async (resolved, parts) => {
  const model = toPiModel(resolved);
  const context: Context = {
    systemPrompt: parts.systemPrompt,
    messages: [{ role: 'user', content: parts.userPrompt, timestamp: Date.now() }],
  };
  const message = await complete(model, context, { apiKey: resolved.apiKey, maxTokens: 4_096 });
  return message.content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
};

/**
 * Load the documents a request needs. For `doc`/`multi` the paths are required (fail
 * fast if missing). For `selection` the first path is best-effort context: a selection
 * edit must still work even if the surrounding doc cannot be read.
 */
async function loadDocs(files: AuthorFiles, req: AuthorRequest): Promise<AuthorDoc[]> {
  if (req.scope === 'selection') {
    const relPath = req.docPaths[0];
    if (!relPath) return [];
    try {
      const adr = await files.readAdr(relPath);
      return [{ relPath, content: adr.body }];
    } catch {
      return []; // degrade gracefully — selection still carries its own text
    }
  }

  if (req.docPaths.length === 0) {
    throw new Error(`author: scope "${req.scope}" requires at least one docPath.`);
  }
  return Promise.all(
    req.docPaths.map(async (relPath) => {
      const adr = await files.readAdr(relPath);
      return { relPath, content: adr.body };
    }),
  );
}

/**
 * Create the author service. Resolves the model from the registry on every call so a
 * hot-edited `.sloop/config.md` takes effect without a restart.
 */
export function createAuthorService(deps: AuthorDeps): AuthorService {
  const env = deps.env ?? process.env;
  const call = deps.call ?? piAuthorCall;
  const fallback = deps.defaultModel ?? 'sonnet';

  return {
    async author(req: AuthorRequest): Promise<AuthorResult> {
      if (!req.instruction || !req.instruction.trim()) {
        throw new Error('author: instruction is required.');
      }
      if (req.scope === 'selection' && (!req.selectionText || !req.selectionText.trim())) {
        throw new Error('author: scope "selection" requires non-empty selectionText.');
      }

      const docs = await loadDocs(deps.files, req);
      const registry = await deps.files.readModelRegistry();
      const alias = pickAuthorAlias(req, env, registry, fallback);
      const resolved = resolveModel(alias, registry, env);

      const parts = buildAuthorPrompt(req, docs);
      const proposal = (await call(resolved, parts)).trim();
      if (!proposal) {
        throw new Error(`author: model "${resolved.id}" returned an empty proposal.`);
      }
      return { proposal };
    },
  };
}
