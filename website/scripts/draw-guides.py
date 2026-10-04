"""Regenerate guide illustrations on Windows: python website/scripts/draw-guides.py.
Requires Pillow and installed Microsoft YaHei. Output PNGs are checked in;
the website build does not require Python or distribute font files.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import math, json

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public/diagrams'
OUT.mkdir(parents=True, exist_ok=True)
REGULAR = Path('C:/Windows/Fonts/msyh.ttc')
BOLD = Path('C:/Windows/Fonts/msyhbd.ttc')
assert REGULAR.exists() and BOLD.exists(), 'Microsoft YaHei is required'
INK, MUTED, BLUE, GREEN = '#203349', '#53677d', '#315bb7', '#287360'
manifest = {}

def font(size, bold=False):
    return ImageFont.truetype(str(BOLD if bold else REGULAR), size)

def canvas(title, subtitle, height):
    im = Image.new('RGB', (1600, height), '#f8fafc')
    d = ImageDraw.Draw(im)
    d.text((64, 42), title, font=font(42, True), fill=INK)
    d.text((64, 105), subtitle, font=font(25), fill=MUTED)
    return im, d

def box(d, xy, title, detail='', tint='#ffffff', color=BLUE):
    x,y,w,h=xy
    d.rounded_rectangle((x,y,x+w,y+h), radius=16, fill=tint, outline='#ccd7e5', width=2)
    d.rectangle((x+1,y+20,x+5,y+h-20), fill=color)
    lines=[title]+detail.split('\n') if detail else [title]
    total=44+max(0,len(lines)-1)*36
    yy=y+(h-total)/2
    for i,line in enumerate(lines):
        f=font(29 if i==0 else 23, i==0)
        assert d.textlength(line,font=f)<w-30,(title,line)
        d.text((x+w/2,yy),line,font=f,fill=INK if i==0 else MUTED,anchor='mt')
        yy+=44 if i==0 else 36

def line(d, pts, label=None, label_at=None, color=BLUE, dashed=False):
    for a,b in zip(pts,pts[1:]):
        if dashed:
            length=math.dist(a,b)
            for n in range(0,int(length),20):
                t=n/length; t2=min((n+11)/length,1)
                d.line([(a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t),(a[0]+(b[0]-a[0])*t2,a[1]+(b[1]-a[1])*t2)],fill=color,width=3)
        else:d.line([a,b],fill=color,width=3)
    a,b=pts[-2:];angle=math.atan2(b[1]-a[1],b[0]-a[0])
    d.polygon([b,(b[0]-15*math.cos(angle-.45),b[1]-15*math.sin(angle-.45)),(b[0]-15*math.cos(angle+.45),b[1]-15*math.sin(angle+.45))],fill=color)
    if label:
        x,y=label_at;f=font(22);w=d.textlength(label,font=f)
        d.rectangle((x-w/2-9,y-4,x+w/2+9,y+30),fill='#f8fafc')
        d.text((x,y),label,font=f,fill=color,anchor='mt')

def save(im, name):
    im.save(OUT/f'{name}.png', optimize=True)
    manifest[f'{name}.png']=list(im.size)

im,d=canvas('资料库里，内容怎样组织？','实线表示管理归属；标签与论文的交叉关联另见关系图。',1060)
box(d,(580,175,440,115),'资料库 Workspace','存放你的文献与阅读成果', '#e9effc')
box(d,(130,375,620,110),'条目：一篇文献','题名、说明、属性与标签')
box(d,(1010,375,430,110),'标签：一个研究主题','可建立父标签与子标签','#eaf5f0',GREEN)
line(d,[(690,290),(690,330),(440,330),(440,375)])
line(d,[(910,290),(910,330),(1225,330),(1225,375)])
for x,title,detail in [(65,'原始 PDF','保留原版式'),(325,'解析结果','段落、表格、公式等片段'),(585,'文档笔记','整理这篇文献')]:
    box(d,(x,585,245,140),title,detail if x!=325 else '段落、表格\n公式、图片等片段')
    line(d,[(440,485),(440,535),(x+122,535),(x+122,585)])
box(d,(1010,585,430,140),'标签综合笔记','汇总这个主题的多篇文献','#eaf5f0',GREEN)
line(d,[(1225,485),(1225,585)],'归属',(1225,525),GREEN)
box(d,(245,815,425,115),'片段笔记与译文','围绕具体片段保存阅读成果')
line(d,[(447,725),(447,815)])
d.text((80,979),'批注贴近原文位置；未解析的 PDF 也可以直接阅读。',font=font(25),fill=MUTED)
save(im,'concept-hierarchy')

im,d=canvas('分类与引用，是两种不同的关系','一篇论文可以有多个标签；一篇综合笔记可以引用多篇论文。',970)
box(d,(70,205,360,105),'父标签：机器学习',tint='#eaf5f0',color=GREEN)
box(d,(70,405,360,105),'子标签：注意力机制',tint='#eaf5f0',color=GREEN)
line(d,[(250,310),(250,405)],'标签层级',(250,345),GREEN)
box(d,(70,695,360,105),'另一标签：组会阅读',tint='#eaf5f0',color=GREEN)
box(d,(625,405,340,105),'论文 A','一篇条目')
box(d,(625,695,340,105),'论文 B','另一篇条目')
line(d,[(430,455),(625,455)],'分类',(525,420),GREEN)
line(d,[(430,745),(525,745),(525,485),(625,485)],color=GREEN)
box(d,(1150,405,370,105),'主题综合笔记','属于“注意力机制”标签')
line(d,[(430,435),(485,435),(485,355),(1335,355),(1335,405)],'笔记归属',(900,322),GREEN)
line(d,[(1150,460),(965,460)],'引用原文',(1056,425),BLUE,True)
line(d,[(1335,510),(1335,745),(965,745)],'引用原文',(1150,710),BLUE,True)
d.text((80,867),'实线：层级、分类或笔记归属。   虚线：笔记通过来源链接引用文献。',font=font(25),fill=MUTED)
save(im,'concept-relations')

im,d=canvas('从一篇 PDF 到一份可分享的笔记','先走完基本阅读流程；解析、翻译和 AI 按需要加入。',1150)
steps=[('01  打开或新建资料库','确定文献和笔记的保存位置'),('02  导入 PDF，创建条目','打开原文，确认页面能够显示'),('03  分屏阅读与记录','一侧看原文，一侧整理文档笔记'),('04  核对依据并保存','检查来源、内容与保存状态'),('05  选择成果并导出','在接收人使用的软件中打开检查')]
for i,(a,b) in enumerate(steps):
    y=185+i*172;box(d,(85,y,690,118),a,b,tint='#ffffff')
    if i<4:line(d,[(430,y+118),(430,y+172)])
box(d,(965,355,550,155),'需要重排或精确片段？','导入 MinerU 解析结果\n检查段落、图表与原文对应','#eaf5f0',GREEN)
line(d,[(775,415),(965,415)],'可选',(870,376),GREEN,True)
box(d,(965,635,550,155),'需要翻译或助手？','先配置模型，再选择材料\n核对译文、回答与修改建议','#eaf5f0',GREEN)
line(d,[(775,760),(875,760),(875,710),(965,710)],color=GREEN,dashed=True)
d.text((80,1080),'提示：普通阅读与手动记笔记可以先开始，不必等待解析或配置 AI。',font=font(25),fill=MUTED)
save(im,'first-reading-flow')

im,d=canvas('该用哪一种记录？','按你想留下的内容选择，而不是按记录长短选择。',1010)
rows=[('我想下次回到这一段','记住此处','保存片段位置，方便继续阅读'),('我想标出原文并写短评','批注','围绕原文位置或选区记录'),('我想解释某个段落或公式','片段笔记','围绕一个解析片段保存想法'),('我想总结这一篇论文','文档笔记','整理研究问题、方法、结果与局限'),('我想比较同一主题的多篇论文','标签综合笔记','汇总共识与差异，分别附上来源')]
for i,(q,a,b) in enumerate(rows):
    y=185+i*153;box(d,(65,y,630,112),q)
    line(d,[(695,y+56),(865,y+56)])
    box(d,(865,y,665,112),a,b,tint='#eaf5f0',color=GREEN)
save(im,'choose-note')

im,d=canvas('让助手参与，同时保留你的判断','回答用于阅读和核对；修改提案需要你单独审阅。',1130)
rows=[('1  选模型与阅读对象','发送前确认论文、网页或附件范围'),('2  提问并查看来源','区分原文证据、模型解释与未确定项'),('3  助手提出修改时，打开预览','核对目标笔记及新增、删除、改写的内容'),('4  决定应用、拒绝或继续讨论','只有选择应用，才会执行对应修改'),('5  检查结果与保存状态','若提示内容已变化，先重新核对版本')]
for i,(a,b) in enumerate(rows):
    y=180+i*174;box(d,(280,y,1040,116),a,b)
    if i<4:line(d,[(800,y+116),(800,y+174)])
save(im,'assistant-review-flow')
(ROOT/'diagrams.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf8')
print('Rendered',len(manifest),'diagrams using Microsoft YaHei')

