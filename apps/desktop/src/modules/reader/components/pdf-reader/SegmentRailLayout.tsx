import type { ReactNode } from 'react';

import { PDF_RAIL_WIDTH } from './readerConstants';

export function SegmentRailLayout({
  children,
  overlay,
  rail
}: {
  children: ReactNode;
  overlay?: ReactNode;
  rail: ReactNode;
}) {
  return (
    <div className="relative grid h-full min-h-0 min-w-0 overflow-hidden">
      <div className="absolute inset-y-0 left-0 z-20" style={{ width: PDF_RAIL_WIDTH }}>
        {rail}
      </div>
      {children}
      {overlay}
    </div>
  );
}
