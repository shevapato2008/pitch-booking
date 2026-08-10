interface IntentHeaderWindowInfo {
  windowWidth?: number;
  statusBarHeight?: number;
}

interface IntentHeaderMenuButton {
  top?: number;
  bottom?: number;
  left?: number;
  right?: number;
  width?: number;
  height?: number;
}

export interface IntentHeaderLayout {
  topPx: number;
  rowHeightPx: number;
  rightInsetPx: number;
}

function finite(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function resolveIntentHeaderLayout(
  windowInfo: IntentHeaderWindowInfo,
  menuButton: IntentHeaderMenuButton,
): IntentHeaderLayout {
  const topPx = Math.max(0, finite(windowInfo.statusBarHeight));
  const windowWidth = Math.max(0, finite(windowInfo.windowWidth));
  const menuTop = Math.max(topPx, finite(menuButton.top));
  const menuHeight = Math.max(0, finite(menuButton.height));
  const verticalGap = Math.max(0, menuTop - topPx);
  const rowHeightPx = Math.max(44, menuHeight + verticalGap * 2);
  const rightInsetPx = Math.max(0, windowWidth - finite(menuButton.left) + 8);
  return { topPx, rowHeightPx, rightInsetPx };
}

export function readIntentHeaderLayout(): IntentHeaderLayout {
  return resolveIntentHeaderLayout(wx.getWindowInfo(), wx.getMenuButtonBoundingClientRect());
}
