(function exposeAttendanceCorrectionFixture(scope) {
  const ATTENDANCE_CORRECTION_FIXTURE_MARKER = "ATTENDANCE_CORRECTION_FIXTURE";
  const registrationId = "8ed324a4-56cb-4d73-9a77-0b4605ac3b17";
  const fixture = {
    meta: {
      environmentLabel: "Development-only Fixture",
      truthLabel: "模拟数据，不会提交或修改生产数据",
      operatorName: "杨帆",
      operatorRole: "PLATFORM_ADMIN",
      marker: ATTENDANCE_CORRECTION_FIXTURE_MARKER,
    },
    previewCases: {
      login: { screen: "login", selectedId: null },
      ready: { selectedId: registrationId },
      confirm: {
        selectedId: registrationId,
        reason: "队长确认误将该球员标记为已到场。",
        confirmationOpen: true,
      },
      corrected: {
        selectedId: registrationId,
        corrected: true,
      },
      success: { selectedId: registrationId, corrected: true },
      "unknown-result": {
        selectedId: registrationId,
        reason: "已核对现场签到记录，原到场结果录入错误。",
        decisionResultUnknown: true,
      },
      "not-found": {
        query: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        initialLookupError: "未找到这笔报名，请核对 UUID",
      },
      "submit-error": {
        selectedId: registrationId,
        decisionShouldFail: true,
        initialError: "提交失败，当前记录可能已变化，请重新查询后再试",
      },
      unmarked: { selectedId: "19d97766-e889-47d8-9275-813a0327bcce" },
      forbidden: { selectedId: null, principalRole: "ONBOARDING_REVIEWER" },
    },
    registrations: [
      {
        registrationId,
        registrationStatus: "JOINED",
        playerPerGameName: "林知远（右边锋）",
        intendedPosition: "前锋",
        gameName: "C1b 预发布验收局",
        venueName: "测试环境·渤海元丰足球场",
        pitchName: "七人制 A 场",
        startsAtLabel: "8月31日 周一 · 09:00–10:00",
        attendanceStatus: "PRESENT",
        originalAttendanceStatus: "PRESENT",
        attendanceRecordedAtLabel: "8月31日 周一 10:06",
        attendanceRecordedByLabel: "球局队长",
        version: 3,
        corrections: [],
      },
      {
        registrationId: "19d97766-e889-47d8-9275-813a0327bcce",
        registrationStatus: "JOINED",
        playerPerGameName: "周宁（守门员）",
        intendedPosition: "门将",
        gameName: "C1b 预发布验收局",
        venueName: "测试环境·渤海元丰足球场",
        pitchName: "七人制 A 场",
        startsAtLabel: "8月31日 周一 · 09:00–10:00",
        attendanceStatus: "UNMARKED",
        originalAttendanceStatus: null,
        attendanceRecordedAtLabel: null,
        attendanceRecordedByLabel: null,
        version: 2,
        corrections: [],
      },
    ],
  };

  scope.ATTENDANCE_CORRECTION_FIXTURE = Object.freeze(fixture);
})(globalThis);
