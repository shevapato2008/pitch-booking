(function exposeGameReportResolutionFixture(scope) {
  const GAME_REPORT_RESOLUTION_FIXTURE_MARKER = "GAME_REPORT_RESOLUTION_FIXTURE";
  const snapshots = {
    order: { status: "CONFIRMED", cancelRequestedAt: null, version: 8 },
    slot: { status: "HELD", startsAt: "2026-09-06T10:00:00+08:00", endsAt: "2026-09-06T12:00:00+08:00" },
    payment: { state: "DISABLED", amountCents: 0 },
    refundCase: null,
    refundAttempt: null,
  };

  const game = (overrides = {}) => ({
    name: "海河周日轻松局",
    teamName: "津门晨风队",
    venueName: "天津奥体足球场",
    pitchName: "七人制 A 场",
    startsAtLabel: "9月6日 周日 · 10:00–12:00",
    status: "PUBLISHED",
    effectiveStatus: "PUBLISHED",
    cancellationSource: null,
    version: 7,
    ...overrides,
  });

  const report = (overrides = {}) => ({
    reportId: "a1111111-1111-4111-8111-111111111111",
    state: "PENDING",
    category: "EXTRA_CHARGE",
    facts: "公开说明称费用已经包含，但组织者在现场要求额外支付场地费。",
    submittedAtLabel: "9月6日 周日 12:18",
    registrationContext: { playerLabel: "报名球员 · 林知远", currentStatus: "JOINED" },
    game: game(),
    allowedOutcomes: ["DISMISSED", "CONFIRMED_RECORDED", "CONFIRMED_GAME_CANCELLED"],
    resolution: null,
    governed: JSON.parse(JSON.stringify(snapshots)),
    ...overrides,
  });

  const reports = [
    report(),
    report({
      reportId: "a2222222-2222-4222-8222-222222222222",
      category: "ORGANIZER_NO_SHOW",
      facts: "约定开场后组织者仍未到场，现场也没有其他队长接待报名球员。",
      submittedAtLabel: "9月5日 周六 20:36",
      registrationContext: { playerLabel: "报名球员 · 周宁", currentStatus: "REMOVED" },
      game: game({ name: "滨海周六训练局", teamName: "渤海竞技队", startsAtLabel: "9月5日 周六 · 18:00–20:00" }),
      allowedOutcomes: ["DISMISSED", "CONFIRMED_RECORDED"],
    }),
    report({
      reportId: "a3333333-3333-4333-8333-333333333333",
      category: "DANGEROUS_BEHAVIOR",
      facts: "组织者多次允许明显危险动作继续，并拒绝暂停比赛处理现场冲突。",
      submittedAtLabel: "9月4日 周五 22:10",
      registrationContext: { playerLabel: "报名球员 · 陈屿", currentStatus: "WITHDRAWN" },
      game: game({ name: "河西周五对抗局", teamName: "蓝湾联队", startsAtLabel: "9月4日 周五 · 20:00–22:00", status: "COMPLETED", effectiveStatus: "COMPLETED" }),
      allowedOutcomes: ["DISMISSED", "CONFIRMED_RECORDED"],
    }),
    report({
      reportId: "b1111111-1111-4111-8111-111111111111",
      state: "RESOLVED",
      category: "FALSE_INFORMATION",
      facts: "页面标注为七人制整场，现场实际只开放了半场。",
      submittedAtLabel: "9月3日 周四 12:11",
      game: game({ name: "水西公园午间局", teamName: "午后十一人", startsAtLabel: "9月3日 周四 · 12:00–14:00" }),
      allowedOutcomes: [],
      resolution: { outcome: "CONFIRMED_RECORDED", resolvedAtLabel: "9月3日 周四 16:24" },
    }),
    report({
      reportId: "b2222222-2222-4222-8222-222222222222",
      state: "RESOLVED",
      category: "HARASSMENT",
      facts: "组织者在群内持续发表针对报名者的侮辱性言论。",
      submittedAtLabel: "9月2日 周三 21:20",
      game: game({ name: "空港周三夜场", teamName: "飞翼足球队", startsAtLabel: "9月2日 周三 · 19:00–21:00" }),
      allowedOutcomes: [],
      resolution: { outcome: "DISMISSED", resolvedAtLabel: "9月3日 周四 10:08" },
    }),
    report({
      reportId: "b3333333-3333-4333-8333-333333333333",
      state: "RESOLVED",
      category: "ORGANIZER_NO_SHOW",
      facts: "开场后组织者未到场，报名者无法领取场地物资。",
      submittedAtLabel: "9月1日 周二 18:44",
      game: game({ name: "东丽周二练习局", teamName: "晨光足球队", startsAtLabel: "9月2日 周三 · 09:00–11:00", status: "CANCELLED", effectiveStatus: "CANCELLED", cancellationSource: "PLATFORM_REPORT", version: 8 }),
      allowedOutcomes: [],
      resolution: { outcome: "CONFIRMED_GAME_CANCELLED", resolvedAtLabel: "9月1日 周二 19:16" },
    }),
  ];

  const fixture = {
    meta: {
      marker: GAME_REPORT_RESOLUTION_FIXTURE_MARKER,
      environmentLabel: "Development-only Fixture",
      truthLabel: "模拟数据，不会提交或修改生产数据",
      operatorName: "杨帆",
      operatorRole: "PLATFORM_ADMIN",
    },
    previewCases: {
      login: { screen: "login" },
      "pending-detail": { selectedId: reports[0].reportId },
      "cancel-confirm": {
        selectedId: reports[0].reportId,
        outcome: "CONFIRMED_GAME_CANCELLED",
        note: "已核对场馆值班记录与双方陈述，确认组织者未履行现场职责。",
        confirmationOpen: true,
      },
      "resolved-recorded": { filter: "RESOLVED", selectedId: reports[3].reportId },
      "resolved-dismissed": { filter: "RESOLVED", selectedId: reports[4].reportId },
      "resolved-cancelled": { filter: "RESOLVED", selectedId: reports[5].reportId },
      "state-changed": {
        selectedId: reports[0].reportId,
        outcome: "CONFIRMED_GAME_CANCELLED",
        note: "复核后准备取消公开球局。",
        confirmationOpen: true,
        stateChanged: true,
      },
      "unknown-result": {
        selectedId: reports[0].reportId,
        outcome: "CONFIRMED_RECORDED",
        note: "已核对双方陈述，本次问题成立并记录。",
        confirmationOpen: true,
        unknownResult: true,
      },
      forbidden: { principalRole: "ONBOARDING_REVIEWER" },
    },
    reports,
  };

  scope.GAME_REPORT_RESOLUTION_FIXTURE = Object.freeze(fixture);
})(globalThis);
