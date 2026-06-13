import { useEffect, useRef } from 'react';

export interface EditableTitleProps {
  value: string;
  onChange: (next: string) => void;
  /** Focus + select-all on mount (used when a freshly-created item opens). */
  autoFocus?: boolean;
  placeholder?: string;
}

/**
 * An inline-editable document title (Notion-style): a borderless input styled as the
 * page heading. Enter commits visually (blurs); persistence is the page's Save action.
 * Pure presentational — the parent owns the value and what saving means.
 */
export function EditableTitle({
  value,
  onChange,
  autoFocus = false,
  placeholder = 'Untitled',
}: EditableTitleProps) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus && ref.current) {
      ref.current.focus();
      ref.current.select();
    }
  }, [autoFocus]);

  return (
    <input
      ref={ref}
      type="text"
      value={value}
      placeholder={placeholder}
      aria-label="Title"
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          ref.current?.blur();
        }
      }}
      className="-mx-1 w-full rounded bg-transparent px-1 text-[20px] font-bold tracking-[-0.01em] text-ink outline-none placeholder:text-ink-subtle focus:bg-line-soft/60"
    />
  );
}
