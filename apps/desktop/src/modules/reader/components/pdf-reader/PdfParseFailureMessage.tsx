import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";

import { ReaderMessage } from "./ReaderMessage";

export function PdfParseFailureMessage({
  busy,
  message,
  onRetry,
}: {
  busy: boolean;
  message: string | null | undefined;
  onRetry: () => void;
}) {
  return (
    <ReaderMessage
      title="PDF 解析失败"
      description={
        message ||
        "解析任务失败。检查解析服务配置后，可以复用当前 PDF 重新提交解析。"
      }
      tone="danger"
      action={
        <Button
          disabled={busy}
          size="sm"
          type="button"
          variant="outline"
          onClick={onRetry}
        >
          {busy ? <Loader2 className="animate-spin" size={14} aria-hidden="true" /> : null}
          重新解析
        </Button>
      }
    />
  );
}
