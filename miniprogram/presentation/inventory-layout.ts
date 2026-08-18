export function readInventoryHeaderLayout() {
  const windowInfo = wx.getWindowInfo();
  const menu = wx.getMenuButtonBoundingClientRect();
  const topPx = Math.max(0, Number(windowInfo.statusBarHeight) || 0);
  const menuTop = Math.max(topPx, Number(menu.top) || 0);
  const menuHeight = Math.max(0, Number(menu.height) || 0);
  return {
    topPx,
    rowHeightPx: Math.max(44, menuHeight + Math.max(0, menuTop - topPx) * 2),
    rightInsetPx: Math.max(0, (Number(windowInfo.windowWidth) || 0) - (Number(menu.left) || 0) + 8),
  };
}
