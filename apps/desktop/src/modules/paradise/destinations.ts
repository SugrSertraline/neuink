import type { Trip, TravelDestination, World } from '@/shared/types/paradise';

// Story copy is fictional; missing campus art must never be replaced by unrelated photos.
export const DESTINATIONS: Record<TravelDestination, {
  name: string; duration: number; description: string; stamp: string;
  moments: readonly string[]; souvenirs: readonly string[];
}> = {
  trial: {
    name: '校园散步', duration: 300_000, description: '一段轻松的体验旅程，先认识你的伙伴。', stamp: '初次出门',
    moments: ['沿着小路慢慢走，忽然发现阳光把影子拉得很长。我拍下这一刻，想和你分享。'],
    souvenirs: ['散步纪念卡'],
  },
  informatics: {
    name: '信息学馆', duration: 600_000, description: '带着好奇心，收集一个关于灵感的小故事。', stamp: '灵感来访',
    moments: ['我在信息学馆附近停了下来，给自己出了道小题：如果灵感有形状，会不会像一枚亮起来的螺丝？', '今天的观察题是“怎样把复杂的事情讲简单”。我在本子上画了三格，最后一格留给你。', '我把一路想到的问题叠成一架纸飞机。没让它飞走，等回家我们一起展开。'],
    souvenirs: ['灵感齿轮纸签', '三格观察卡', '问题纸飞机'],
  },
  lake: {
    name: '小南湖', duration: 900_000, description: '不赶路，给湖边的风和慢下来的自己留一点时间。', stamp: '湖畔慢游',
    moments: ['今天来小南湖，决定暂时不做任何计算。停下脚步，给自己留了一段发呆时间。', '我试着想象一道水纹，结果脑袋里全是自己的圆脑袋。你听到一定会笑。', '回去的路上，我给今天起了个名字：“没有白白浪费的休息”。这份好心情也送给你。'],
    souvenirs: ['湖风书签', '水纹小笺', '慢慢来纪念卡'],
  },
  teaching: {
    name: '一号教学楼', duration: 720_000, description: '一次校园观察，带回来一个值得追问的问题。', stamp: '求知脚印',
    moments: ['今天的目的地是一号教学楼。我给自己布置的任务很小：带回一个好问题，而不是十个标准答案。', '在这次散步里，我想到了你正在读的东西。虽然我不知道内容，但我给你留了一个“为什么”的空白格。', '我在小本子上写下：“今天学会一件小事就很好。”落款旁边画了一个歪歪的小海豹。'],
    souvenirs: ['为什么纸签', '空白提问卡', '求知纪念卡'],
  },
};
export const isDestination = (v: unknown): v is TravelDestination =>
  typeof v === 'string' && Object.prototype.hasOwnProperty.call(DESTINATIONS, v);
export const destinationOf = (trip: Trip) => trip.destination ?? 'trial';
export function tripStory(world: World, trip: Trip) {
  const id = destinationOf(trip), route = DESTINATIONS[id];
  const visit = world.trips.slice(0, world.trips.findIndex(t => t.id === trip.id))
    .filter(t => destinationOf(t) === id).length;
  return { route, text: route.moments[visit % route.moments.length], souvenir: route.souvenirs[visit % route.souvenirs.length] };
}
export const earnedStamps = (world: World, now: number) =>
  [...new Set(world.trips.filter(t => t.returnsAt <= now).map(destinationOf))];
