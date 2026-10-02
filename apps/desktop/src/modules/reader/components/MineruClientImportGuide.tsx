import stepOne from '@/assets/mineru-client-import/step-1-download-and-parse.png';
import stepTwo from '@/assets/mineru-client-import/step-2-zip-results.png';
import { Copy } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useToast } from '@/shared/hooks/useToast';

const MINERU_EXTRACTOR_URL = 'https://mineru.net/OpenSourceTools/Extractor';

export function MineruClientImportGuide() {
  const { notify } = useToast();
  const copyExtractorUrl = async () => {
    try {
      await navigator.clipboard.writeText(MINERU_EXTRACTOR_URL);
      notify({ durationMs: 2000, title: 'MinerU 链接已复制' });
    } catch (error) {
      notify({
        durationMs: 4000,
        title: '复制链接失败',
        description: error instanceof Error ? error.message : String(error),
        tone: 'danger'
      });
    }
  };
  return (
    <main className="mx-auto grid max-w-5xl gap-6 px-4 py-5 pb-10 text-sm leading-6">
      <header>
        <h1 className="text-xl font-semibold">MinerU 客户端导入教程</h1>
        <p className="mt-1 text-muted-foreground">使用客户端完成解析后，将完整结果压缩包直接创建为 Neuink 条目。</p>
      </header>
      <section className="grid gap-3">
        <h2 className="font-semibold">第一步：下载并解析文档</h2>
        <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
          <li>复制 MinerU Extractor 链接：<Button data-guide="mineru-copy-link" className="h-6 px-2 align-middle" size="xs" type="button" variant="outline" onClick={() => void copyExtractorUrl()}><Copy size={12} />复制链接</Button>。</li>
          <li>在页面右上角下载客户端，安装并登录。</li>
          <li>上传 PDF，启动解析，等待任务完成。</li>
          <li>按图示打开解析完成后的结果文件夹。</li>
        </ol>
        <img alt="在 MinerU 客户端打开解析后的文件夹" className="w-full rounded-md border" src={stepOne} />
      </section>
      <section className="grid gap-3">
        <h2 className="font-semibold">第二步：打包完整解析结果</h2>
        <p className="text-muted-foreground">选中结果文件夹中的内容，包括 <code>*_content_list_v2.json</code> 或兼容的 <code>*_content_list.json</code>，以及解析结果引用的 <code>images</code> 图片；使用 ZIP 新建条目时还要包含原 PDF。压缩为一个 ZIP，NeuInk 不接受 RAR 或 7Z。</p>
        <img alt="将 MinerU 客户端解析结果中的全部文件压缩为 ZIP" className="w-full rounded-md border" src={stepTwo} />
      </section>
      <section className="grid gap-2">
        <h2 className="font-semibold">第三步：导入 NeuInk</h2>
        <p className="text-muted-foreground">新建论文：打开“新建条目” → “从 MinerU 客户端导入”，选择包含原 PDF 的 ZIP 并创建。</p>
        <p className="text-muted-foreground">已有 PDF 条目：打开“条目详情” → “文件与时间” → “导入客户端解析结果”，选择同一篇论文的 ZIP。此时 ZIP 无需重复包含 PDF。</p>
        <p className="text-muted-foreground">NeuInk 会读取已有的解析结果，不会重新提交在线解析。</p>
      </section>
    </main>
  );
}
