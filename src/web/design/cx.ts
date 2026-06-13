/** Tiny classNames joiner — drops falsy values, joins with a space. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
