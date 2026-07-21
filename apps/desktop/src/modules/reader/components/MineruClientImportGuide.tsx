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
          <li>复制 MinerU Extractor 链接：<Button className="h-6 px-2 align-middle" size="xs" type="button" variant="outline" onClick={() => void copyExtractorUrl()}><Copy size={12} />复制链接</Button>。</li>
          <li>在页面右上角下载客户端，安装并登录。</li>
          <li>上传 PDF，启动解析，等待任务完成。</li>
          <li>按图示打开解析完成后的结果文件夹。</li>
        </ol>
        <img alt="在 MinerU 客户端打开解析后的文件夹" className="w-full rounded-md border" src={stepOne} />
      </section>
      <section className="grid gap-3">
        <h2 className="font-semibold">第二步：打包并创建条目</h2>
        <p className="text-muted-foreground">选中结果文件夹中的全部内容，包括 <code>images</code>、<code>*_content_list_v2.json</code>、<code>*_origin.pdf</code> 等文件，压缩为一个 ZIP。Neuink 仅支持 ZIP，不支持 RAR 或 7Z。</p>
        <img alt="将 MinerU 客户端解析结果中的全部文件压缩为 ZIP" className="w-full rounded-md border" src={stepTwo} />
        <p className="text-muted-foreground">回到“新建条目”，切换到“从 MinerU 客户端导入”，选择该 ZIP 并创建。Neuink 会读取 PDF、图片及解析结果，不会再次提交自动解析。</p>
      </section>
    </main>
  );
}
