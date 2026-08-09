import { expect, jest, test } from "@jest/globals";

import {
  TencentPoiSearchCapability,
  type TencentPoiRequest,
} from "./tencent-poi-search";

const KEY = "TEST_KEY_1234567890";

test("trims a valid query and sends only the restricted Tencent suggestion fields", async () => {
  const request = jest.fn<TencentPoiRequest>().mockResolvedValue({ status: 0, data: [] });
  const search = new TencentPoiSearchCapability(request, KEY);

  await expect(search.suggest("  天津 站  ")).resolves.toEqual([]);
  expect(request).toHaveBeenCalledWith({
    url: "https://apis.map.qq.com/ws/place/v1/suggestion",
    data: {
      keyword: "天津 站",
      key: KEY,
      region: "天津市",
      output: "json",
    },
  });
});

test.each(["", " ", "津", " 津 \t ", "🚉"])("does not request suggestions for short query %j", async (query) => {
  const request = jest.fn<TencentPoiRequest>();
  const search = new TencentPoiSearchCapability(request, KEY);

  await expect(search.suggest(query)).resolves.toEqual([]);
  expect(request).not.toHaveBeenCalled();
});

test("strictly decodes valid Tencent items as the frozen POI result shape", async () => {
  const request = jest.fn<TencentPoiRequest>().mockResolvedValue({
    status: 0,
    data: [{
      id: "poi-1",
      title: "天津站",
      address: "天津市河北区新纬路1号",
      city: "天津市",
      district: "河北区",
      adcode: 120105,
      location: { lat: 39.1365, lng: 117.2109 },
      category: "交通设施:火车站",
    }],
  });

  await expect(new TencentPoiSearchCapability(request, KEY).suggest("天津站")).resolves.toEqual([{
    id: "poi-1",
    name: "天津站",
    address: "天津市河北区新纬路1号",
    city: "天津市",
    district: "河北区",
    adcode: "120105",
    latitude: 39.1365,
    longitude: 117.2109,
    coordinateSystem: "GCJ02",
  }]);
});

test("drops individually invalid Tencent items without changing valid items", async () => {
  const valid = {
    id: "poi-valid",
    title: "天津站",
    address: "天津市河北区新纬路1号",
    city: "天津市",
    district: "河北区",
    adcode: 120105,
    location: { lat: 39.1365, lng: 117.2109 },
  };
  const request = jest.fn<TencentPoiRequest>().mockResolvedValue({
    status: 0,
    data: [
      valid,
      { ...valid, id: 1 },
      { ...valid, title: "" },
      { ...valid, title: " \t " },
      { ...valid, address: null },
      { ...valid, city: undefined },
      { ...valid, district: 7 },
      { ...valid, adcode: "120105" },
      { ...valid, adcode: Number.NaN },
      { ...valid, adcode: Number.POSITIVE_INFINITY },
      { ...valid, adcode: 120105.5 },
      { ...valid, adcode: 99_999 },
      { ...valid, adcode: 1_000_000 },
      { ...valid, location: null },
      { ...valid, location: { lat: Number.NaN, lng: 117.2 } },
      { ...valid, location: { lat: 91, lng: 117.2 } },
      { ...valid, location: { lat: 39.1, lng: 181 } },
    ],
  });

  await expect(new TencentPoiSearchCapability(request, KEY).suggest("天津站"))
    .resolves.toEqual([expect.objectContaining({ id: "poi-valid", name: "天津站" })]);
});

test("returns successful empty Tencent results honestly", async () => {
  const request = jest.fn<TencentPoiRequest>().mockResolvedValue({ status: 0, data: [] });

  await expect(new TencentPoiSearchCapability(request, KEY).suggest("不存在"))
    .resolves.toEqual([]);
});

test.each([
  ["non-zero Tencent status", { status: 110, message: "invalid key", data: [] }],
  ["missing status", { data: [] }],
  ["missing data", { status: 0 }],
  ["non-array data", { status: 0, data: {} }],
  ["null response", null],
] as const)("maps %s to POI_SEARCH_UNAVAILABLE", async (_label, response) => {
  const request = jest.fn<TencentPoiRequest>().mockResolvedValue(response);

  await expect(new TencentPoiSearchCapability(request, KEY).suggest("天津站"))
    .rejects.toMatchObject({ code: "POI_SEARCH_UNAVAILABLE" });
});

test.each([new Error("network"), { code: "REQUEST_TIMEOUT" }])(
  "maps request failure %# to POI_SEARCH_UNAVAILABLE",
  async (failure) => {
    const request = jest.fn<TencentPoiRequest>().mockRejectedValue(failure);

    await expect(new TencentPoiSearchCapability(request, KEY).suggest("天津站"))
      .rejects.toMatchObject({ code: "POI_SEARCH_UNAVAILABLE" });
  },
);
