/** Matches native back for stacked pages; a direct link has a real home fallback. */
export function returnToPreviousPage(): void {
  const home = () => wx.reLaunch({ url: "/pages/intent-entry/index" });
  if (getCurrentPages().length > 1) wx.navigateBack({ delta: 1, fail: home });
  else home();
}
