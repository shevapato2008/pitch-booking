# 场馆库存工作台 v2

day-ready → pitch-picker-open → pitch-refreshing → same date + new pitch_id

pitch-refreshing → pitch-load-error keeps the new selection and exposes retry

day-ready → calendar-open → date-refreshing → confirmed date in same page

date-refreshing → date-load-error keeps the new date and current pitch and exposes retry

calendar confirm 2026-08-23 → cross-week-ready showing 2026-08-17..2026-08-23

week-strip managed date → immediate same-page refresh

day-empty → create-slot-open

day-ready → edit-slot-open for editable slot

create-slot-open → save-in-progress → save-result-unknown or create-slot-overlap

concurrent-change → authoritative day retained and draft retained for review

permission-expired → write controls disabled

long-list-end → final slot visible above fixed bottom action

production home → disabled

This reference-only flow preserves the selected pitch or date across the complementary query change and accepts only the latest request sequence. It does not create a Fixture, production route, or server contract.
