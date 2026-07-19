import type { LibraryEntry } from "../../../library/components/LibrarySidebar";
import type { SourceSegment } from "@/shared/types/domain";

import { logicalSegmentUid } from "./readerUtils";

export function formatPdfParseStatus(status: LibraryEntry["status"]) {
  switch (status) {
    case "Queued":
      return "Queued";
    case "Uploading":
      return "Uploading";
    case "Parsing":
      return "Parsing";
    case "Failed":
      return "Failed";
    case "Canceled":
      return "Canceled";
    case "No PDF":
      return "No PDF";
    case "Parsed":
      return "Parsed";
  }
}

export function findSegmentByLogicalOrRealUid(
  segments: SourceSegment[],
  segmentUid: string,
) {
  return segments.find(
    (segment) =>
      segment.uid === segmentUid || logicalSegmentUid(segment) === segmentUid,
  );
}
