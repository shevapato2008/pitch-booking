# 场馆单日库存工作台

authorized worker → day-ready

day-ready → create-slot-open

create-slot-open → save-result-unknown or create-slot-overlap

day-ready → edit-slot-open → save-result-unknown

LOCKED / BOOKED / started slots → read-only

save-result-unknown → retry with the original Idempotency-Key

production home → disabled

Fixture deletion → after real inventory backend integration

本 Artifact 只冻结已授权场馆工作人员管理“渤海元丰足球场”未来 14 天单日库存的视觉与状态语义。它不创建 membership、生产路由、库存契约或服务端写入。
