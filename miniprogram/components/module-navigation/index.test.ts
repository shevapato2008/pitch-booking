/// <reference types="node" />
/* eslint-disable @typescript-eslint/no-explicit-any -- dynamic Mini Program Component harness */

import { beforeEach, expect, jest, test } from "@jest/globals";
import { existsSync, readFileSync } from "node:fs";

let definition: Record<string, any> | undefined;

function component() {
  expect(existsSync("miniprogram/components/module-navigation/index.ts")).toBe(true);
  if (!definition) {
    (globalThis as any).Component = (value: Record<string, any>) => { definition = value; };
    jest.requireActual("./index");
  }
  return {
    ...definition,
    ...definition!.methods,
    data: {
      ...structuredClone(definition!.data),
      title: "找球局", subtitle: "", action: "home", disabled: false,
    },
    triggerEvent: jest.fn(),
    setData(patch: Record<string, unknown>) { Object.assign(this.data, patch); },
  } as Record<string, any>;
}

beforeEach(() => {
  (globalThis as any).wx = {
    getWindowInfo: jest.fn(() => ({ windowWidth: 393, statusBarHeight: 59 })),
    getMenuButtonBoundingClientRect: jest.fn(() => ({ top: 63, left: 295, height: 32 })),
  };
});

test("reads current safe area and reserves equal capsule clearance on both sides", () => {
  const target = component();
  target.lifetimes.attached.call(target);
  expect(target.data).toMatchObject({ topPx: 59, rowHeightPx: 44, titleInsetPx: 106 });

  (wx.getWindowInfo as unknown as jest.Mock).mockReturnValue({ windowWidth: 744, statusBarHeight: 24 });
  (wx.getMenuButtonBoundingClientRect as unknown as jest.Mock).mockReturnValue({ top: 32, left: 640, height: 32 });
  target.pageLifetimes.resize.call(target);
  expect(target.data).toMatchObject({ topPx: 24, rowHeightPx: 48, titleInsetPx: 112 });
});

test("refreshes on page show and keeps a usable header when platform geometry is unavailable", () => {
  const target = component();
  target.pageLifetimes.show.call(target);
  expect(target.data.topPx).toBe(59);
  (wx.getWindowInfo as unknown as jest.Mock).mockImplementation(() => { throw new Error("unavailable"); });
  expect(() => target.pageLifetimes.show.call(target)).not.toThrow();
  expect(target.data).toMatchObject({ topPx: 0, rowHeightPx: 44, titleInsetPx: 96 });
});

test("home and back emit a page-owned navigation intent unless disabled", () => {
  const target = component();
  expect(target.properties.action.value).toBe("home");
  target.onNavigate();
  expect(target.triggerEvent).toHaveBeenLastCalledWith("navigate");
  target.data.action = "back";
  target.onNavigate();
  expect(target.triggerEvent).toHaveBeenCalledTimes(2);
  target.data.disabled = true;
  target.onNavigate();
  expect(target.triggerEvent).toHaveBeenCalledTimes(2);
});

test("shares a 44px action target, complete 24px icon, centered title and press treatment", () => {
  component();
  const markup = readFileSync("miniprogram/components/module-navigation/index.wxml", "utf8");
  const styles = readFileSync("miniprogram/components/module-navigation/index.wxss", "utf8");
  expect(markup).toContain('bindtap="onNavigate"');
  expect(markup).toContain('disabled="{{disabled}}"');
  expect(markup).toContain('hover-class="module-navigation__action--pressed"');
  expect(markup).toContain("返回目的选择入口");
  expect(markup).toContain("{{title}}");
  expect(markup).toContain('wx:if="{{subtitle}}"');
  expect(markup).toContain("left: {{titleInsetPx}}px; right: {{titleInsetPx}}px;");
  expect(styles).toMatch(/:host\s*\{[^}]*display:\s*block;[^}]*flex-shrink:\s*0/s);
  const action = styles.match(/\.module-navigation__action\s*\{([^}]*)\}/s)?.[1] ?? "";
  for (const declaration of [/left:\s*8px/, /width:\s*44px/, /height:\s*44px/, /align-items:\s*center/, /justify-content:\s*center/]) {
    expect(action).toMatch(declaration);
  }
  expect(styles).toMatch(/\.module-navigation__icon\s*\{[^}]*width:\s*24px;[^}]*height:\s*24px/s);
  expect(styles).toMatch(/\.module-navigation__title\s*\{[^}]*font-size:\s*17px;[^}]*font-weight:\s*700/s);
  expect(styles).toMatch(/\.module-navigation__action--pressed\s*\{[^}]*background:\s*#233449/s);
  expect(styles).toContain("#F3F8FF");
  expect(styles).toContain("#152539");
});
