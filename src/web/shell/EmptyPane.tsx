import { Page } from '../design/index';

/**
 * The content pane when a file-backed section is open but no file is selected. Navigation
 * now lives entirely in the sidebar tree, so these section roots (/loops, /libraries)
 * are landing prompts rather than overview pages. Pure presentational — no data I/O.
 */
export function EmptyPane({ section, hint }: { section: string; hint: string }) {
  return (
    <Page breadcrumb={section}>
      <div className="flex h-full items-center justify-center">
        <div className="max-w-xs text-center">
          <h1 className="text-[15px] font-semibold text-ink-muted">{section}</h1>
          <p className="mt-1.5 text-[13px] text-ink-faint">{hint}</p>
        </div>
      </div>
    </Page>
  );
}
