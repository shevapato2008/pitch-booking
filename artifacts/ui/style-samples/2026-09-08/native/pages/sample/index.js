const THEMES = [
  { id: 'night', letter: 'A', name: '夜场追光', strap: 'AFTER DARK. ALL HEART.', caption: '深海蓝 × 荧光青柠 · 聚光灯下的主场' },
  { id: 'sky', letter: 'B', name: '晴空竞技', strap: 'GOOD GAME. GREAT COMPANY.', caption: '冰川白 × 电光蓝 · 清透、明快、轻盈' },
  { id: 'club', letter: 'C', name: '复古球票', strap: 'THE BEAUTIFUL GAME / 2026', caption: '奶油白 × 朱砂橙 · 有温度的足球俱乐部' }
];
const GAMES = [
  { id: 'sample-1', day: 'today', date: '09.08', weekday: '周二', start: '19:30', end: '21:00', title: '下班后，来场痛快的', venue: '滨海运动公园 · 2号场', format: '7人制', tag: '友好交流', joined: 11, capacity: 14, remaining: 3, fill: 79, fee: '45', host: '阿川', color: 'green', avatars: ['川', '森', '林', '北'] },
  { id: 'sample-2', day: 'today', date: '09.08', weekday: '周二', start: '20:00', end: '22:00', title: '今晚，让脚下有点风', venue: '海河体育中心 · 1号场', format: '5人制', tag: '轻松踢球', joined: 8, capacity: 10, remaining: 2, fill: 80, fee: '38', host: '小北', color: 'blue', avatars: ['北', '宇', '乐', '明'] },
  { id: 'sample-3', day: 'tomorrow', date: '09.09', weekday: '周三', start: '19:00', end: '20:30', title: '老时间，新朋友', venue: '滨海运动公园 · 2号场', format: '7人制', tag: '友好交流', joined: 14, capacity: 14, remaining: 0, fill: 100, fee: '45', host: '阿川', color: 'green', avatars: ['川', '平', '舟', '飞'] }
];
Page({
  data: {
    themes: THEMES, theme: THEMES[0], scene: 'list', activeDay: 'today', availableOnly: false,
    days: [{ id: 'today', label: '今天', date: '09.08' }, { id: 'tomorrow', label: '明天', date: '09.09' }, { id: 'all', label: '全部', date: '全部日期' }],
    games: GAMES.filter(game => game.day === 'today'), selected: GAMES[0], sheet: '', motion: true,
    top: 44, navHeight: 44, rightInset: 100, scrollTop: 0,
    rules: ['请提前 15 分钟到场热身', '穿着适合人工草地的足球鞋', '尊重队友和对手，友好交流']
  },
  onLoad(options = {}) {
    const win = wx.getWindowInfo();
    const capsule = wx.getMenuButtonBoundingClientRect();
    const theme = THEMES.find(item => item.id === options.theme) || THEMES[0];
    this.setData({ theme, top: win.statusBarHeight || 20, navHeight: Math.max(44, capsule.height + 2 * Math.max(0, capsule.top - win.statusBarHeight)), rightInset: Math.max(96, win.windowWidth - capsule.left + 8), scene: options.scene === 'detail' ? 'detail' : 'list' });
    this.updateChrome(theme);
  },
  updateChrome(theme) { wx.setNavigationBarColor({ frontColor: theme.id === 'night' ? '#ffffff' : '#000000', backgroundColor: theme.id === 'night' ? '#0B1727' : theme.id === 'sky' ? '#F2F6FC' : '#F5F0E5' }); },
  onTheme(event) {
    const theme = THEMES.find(item => item.id === event.currentTarget.dataset.theme);
    if (!theme) return;
    this.setData({ theme, sheet: '' });
    this.updateChrome(theme);
  },
  onDay(event) { this.setData({ activeDay: event.currentTarget.dataset.day }); this.filterGames(); },
  onAvailable() { this.setData({ availableOnly: !this.data.availableOnly }); this.filterGames(); },
  filterGames() { this.setData({ games: GAMES.filter(game => (this.data.activeDay === 'all' || game.day === this.data.activeDay) && (!this.data.availableOnly || game.remaining > 0)) }); },
  onGame(event) { const selected = GAMES.find(game => game.id === event.currentTarget.dataset.id); if (selected) this.setData({ selected, scene: 'detail', scrollTop: 0 }); },
  onBack() { this.setData({ scene: 'list', sheet: '', scrollTop: 0 }); },
  onSheet(event) { this.setData({ sheet: event.currentTarget.dataset.sheet }); },
  onClose() { this.setData({ sheet: '' }); },
  onMotion() { this.setData({ motion: !this.data.motion }); },
  stopPropagation() {}
});
