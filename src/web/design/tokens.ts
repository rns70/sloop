// Non-Tailwind design helpers: maps domain values (role) onto the locked visual
// language. Colors themselves live in tailwind.config.ts (single source of truth);
// this file only decides *which* token a value maps to.

/** The soft-pastel tones a role pill can take. */
export type Tone = 'blue' | 'purple' | 'green' | 'pink' | 'gray' | 'teal' | 'amber';

/** Tailwind class pair (bg + text) for each tone. Static strings so Tailwind's
 *  content scanner keeps them. */
export const TONE_CLASS: Record<Tone, string> = {
  blue: 'bg-role-blueBg text-role-blue',
  purple: 'bg-role-purpleBg text-role-purple',
  green: 'bg-role-greenBg text-role-green',
  pink: 'bg-role-pinkBg text-role-pink',
  gray: 'bg-role-grayBg text-role-gray',
  teal: 'bg-role-tealBg text-role-teal',
  amber: 'bg-role-amberBg text-role-amber',
};

/** Locked role → tone mapping (Engineer=blue, Architect=purple, QA=green, Security=pink). */
const ROLE_TONE: Record<string, Tone> = {
  engineer: 'blue',
  architect: 'purple',
  qa: 'green',
  security: 'pink',
  explorer: 'teal',
  debugger: 'amber',
};

/** Resolve a role id/name to its persistent pill tone; unknown roles fall back to gray. */
export function roleTone(role: string | undefined): Tone {
  if (!role) return 'gray';
  return ROLE_TONE[role.toLowerCase()] ?? 'gray';
}
