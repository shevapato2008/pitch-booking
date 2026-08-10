# 场地配置

authorized worker + zero configured pitches → first-entry-empty

authorized worker + configured pitches but zero ACTIVE pitches → inactive-only

first-entry-empty → add-first-open → first-pitch-draft

first-pitch-draft uses client_ref draft-pitch-1 and custom name A场

unnamed-pitch-draft uses a separate client_ref and temporary local label only

editor 完成 → page draft only

edit-custom-open → inline players_per_side input; no nested sheet

unused pitch delete confirmation → unused-deleted-draft

ACTIVE pitch with future blockers → deactivate-blocked

eligible ACTIVE pitch → deactivated-draft

INACTIVE pitch → reactivated-draft

save-in-progress → first-save-success or save-failed or save-result-unknown

first-save-success maps draft-pitch-1 → pitch-7-001 and then opens inventory v2 day-ready

configuration-changed → draft retained for manual reconciliation

unsaved page exit → unsaved-leave-confirm

production home → disabled

This reference-only flow records the immutable pitch identity and page-level future save boundary. It does not create a Fixture, production route, or server contract.
