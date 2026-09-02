# Optional Signup Avatar Design

## Goal

Let a first-time player join a shared game without uploading an avatar, while keeping the signup roster useful and preserving explicit adult/risk confirmation.

## Confirmed experience

- A missing public profile opens a compact **确认报名** sheet with the nickname prefilled as **微信用户**.
- The nickname remains editable through the WeChat nickname input.
- The avatar is optional. Without one, the UI displays the existing nickname-initial fallback avatar.
- Existing nickname/avatar data is reused. Choosing a new avatar remains an optional secondary action.
- The only blocking confirmations are **我已满 18 周岁** and **我已了解运动风险并自愿参与**.
- The primary action is **确认报名** (or **加入候补** when no spot remains), not “保存并报名”.

## Data and API behavior

- A confirmed public profile requires a non-empty nickname, confirmation timestamp, and version of at least 1; its avatar object key may be null.
- Saving `avatar_object_key: null` preserves an existing avatar and permits a first confirmation without one.
- Direct signup requires a confirmed nickname/version but does not require an avatar.
- Authenticated rosters return `avatar_url: null` for avatarless players; the mini program renders its existing fallback avatar.
- Migration `0029` replaces the current paired nickname/avatar check constraint. Downgrade fails closed while avatarless confirmed profiles exist.

## Scope

This change does not attempt to silently obtain a real WeChat avatar or nickname, add a new profile page, or change roster privacy. It only removes the unnecessary avatar requirement and simplifies the existing sheet.
