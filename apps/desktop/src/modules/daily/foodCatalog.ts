export const FOOD_CATEGORIES = [
  { id: 'meal', label: '日常正餐', kind: 'meal' },
  { id: 'snack', label: '小吃夜宵', kind: 'meal' },
  { id: 'feast', label: '聚餐大餐', kind: 'meal' },
  { id: 'drink', label: '喝点什么', kind: 'drink' },
] as const;
export type FoodCategory = typeof FOOD_CATEGORIES[number]['id'];
export type OtherFoodCategory = Exclude<FoodCategory, 'meal'>;
export const LEGACY_DRINK_PRESETS = {
  soda: ['雪碧', '可口可乐', '百事可乐', '无糖可乐', '芬达橙味', '美年达橙味', '北冰洋汽水', '冰峰汽水', '元气森林气泡水', '无糖苏打水', '冰红茶', '茉莉花茶', '乌龙茶', '椰子水', '橙汁', '酸梅汤', '矿泉水'],
  tea: ['蜜雪冰城柠檬水', '蜜雪冰城珍珠奶茶', '喜茶多肉葡萄', '古茗杨枝甘露', '沪上阿姨水果茶', '茶百道豆乳玉麒麟', 'CoCo 鲜百香双响炮', '益禾堂烤奶', '霸王茶姬伯牙绝弦', '茉莉奶茶', '手打柠檬茶', '百香果茶', '芒果酸奶', '鲜榨橙汁', '西瓜汁', '绿豆沙牛乳'],
  coffee: ['美式咖啡', '拿铁', '生椰拿铁', '燕麦拿铁', '卡布奇诺', '摩卡', '馥芮白', '冷萃咖啡', '热牛奶', '热豆浆', '热可可', '红枣姜茶', '热红茶', '热乌龙茶', '温水'],
} as const;
export const FOOD_PRESETS: Record<FoodCategory, string[]> = {
  meal: ['番茄鸡蛋面', '菌菇盖饭', '鸡肉饭', '牛肉粉', '饺子', '蔬菜炒饭', '寿司', '麻辣烫', '咖喱饭', '家常菜配米饭', '三明治', '砂锅米线', '黄焖鸡米饭', '兰州拉面', '烤肉拌饭', '螺蛳粉', '馄饨', '凉皮配肉夹馍', '鸡蛋饼配豆浆', '包子配粥'],
  snack: ['煎饼果子', '烤冷面', '手抓饼', '鸡蛋灌饼', '肉夹馍', '炸鸡', '薯条', '烤肠', '关东煮', '章鱼小丸子', '臭豆腐', '烤红薯', '烤玉米', '串串', '蛋挞', '冰淇淋', '水果杯', '酸奶碗'],
  feast: ['火锅', '烤肉', '烧烤', '烤鱼', '海鲜大餐', '自助餐', '东北菜', '川菜', '湘菜', '粤菜', '披萨', '牛排', '日式料理', '韩式料理', '椰子鸡', '铁锅炖'],
  drink: [...LEGACY_DRINK_PRESETS.soda, ...LEGACY_DRINK_PRESETS.tea, ...LEGACY_DRINK_PRESETS.coffee],
};
export const foodMenuLimit = (category: FoodCategory) => category === 'drink' ? 150 : 50;
export const isFoodCategory = (value: unknown): value is FoodCategory => FOOD_CATEGORIES.some(item => item.id === value);
