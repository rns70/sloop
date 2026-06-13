// Cascades index. There is no "list cascades" endpoint yet (the mock seeds exactly one
// cascade and KickoffMenu creates clones), so this links to the known seed and points
// at the sidebar's "Kick off cascade" for new runs. WP-6 can replace the seed link
// with a real listing.

import { Link } from 'react-router-dom';
import { Label, Page } from '../../design/index';
import { humanizeCascade } from './text';

// Pre-registered by the mock backend (src/server/api/mock.ts).
const SEED_CASCADE_ID = '2026-06-13-token-rotation-sync';

export function CascadesIndex() {
  return (
    <Page breadcrumb="Cascades">
      <div className="max-w-prose">
        <h1 className="text-[23px] font-bold tracking-[-0.01em]">Cascades</h1>
        <p className="mt-1 text-[13.5px] text-ink-faint">
          A cascade reconciles the codebase to the databank. Kick one off from the sidebar, or open
          the seeded run below.
        </p>

        <div className="mt-7">
          <Label className="mb-1 px-1">Runs</Label>
          <div className="border-t border-line-soft">
            <Link
              to={`/cascades/${encodeURIComponent(SEED_CASCADE_ID)}`}
              className="flex items-baseline gap-3 border-b border-line-soft px-1 py-2.5 transition-colors hover:bg-line-soft"
            >
              <span className="text-[14.5px] text-ink">{humanizeCascade(SEED_CASCADE_ID)}</span>
              <span className="ml-auto shrink-0 text-[12px] text-ink-faint">
                spec-driven · awaiting approval
              </span>
            </Link>
          </div>
        </div>
      </div>
    </Page>
  );
}
