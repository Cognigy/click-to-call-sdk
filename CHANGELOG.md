## [0.2.2](https://github.com/Cognigy/click-to-call-sdk/compare/v0.2.1...v0.2.2) (2026-10-06)


### Bug Fixes

* **sip:** never REGISTER, authenticate legacy endpoints on the INVITE (CGY-41743) ([#16](https://github.com/Cognigy/click-to-call-sdk/issues/16)) ([c83fbb8](https://github.com/Cognigy/click-to-call-sdk/commit/c83fbb832f130d84d07180d8e30d160a6ea818d5))

## [0.2.1](https://github.com/Cognigy/click-to-call-sdk/compare/v0.2.0...v0.2.1) (2026-10-05)


### Bug Fixes

* **sip:** keep legacy endpoints on REGISTER and app-<applicationSid> (CGY-42103) ([#15](https://github.com/Cognigy/click-to-call-sdk/issues/15)) ([d8916ce](https://github.com/Cognigy/click-to-call-sdk/commit/d8916ce8f606100735c10070abb8ddb893ac2b10))

# [0.2.0](https://github.com/Cognigy/click-to-call-sdk/compare/v0.1.1...v0.2.0) (2026-09-28)


### Features

* **session:** send DTMF tones during a call (CGY-40577) ([#11](https://github.com/Cognigy/click-to-call-sdk/issues/11)) ([083641c](https://github.com/Cognigy/click-to-call-sdk/commit/083641c6bbc1127ba5dd2535decda6a79e8d6598))

## [0.1.1](https://github.com/Cognigy/click-to-call-sdk/compare/v0.1.0...v0.1.1) (2026-09-25)


### Bug Fixes

* **release:** publish to npm from the release job ([#8](https://github.com/Cognigy/click-to-call-sdk/issues/8)) ([65917d0](https://github.com/Cognigy/click-to-call-sdk/commit/65917d0df94e8abe4c1c5c6854cea48b76538541))
* **release:** publish to npm via trusted publishing ([#10](https://github.com/Cognigy/click-to-call-sdk/issues/10)) ([5fdbc5a](https://github.com/Cognigy/click-to-call-sdk/commit/5fdbc5a4d044f69ca92845a4c5721100a37962ad))

# [0.1.0](https://github.com/Cognigy/click-to-call-sdk/compare/v0.0.6...v0.1.0) (2026-09-25)


### Bug Fixes

* **sip:** skip REGISTER for runtime endpoints and use the wsUri host (CGY-39140) ([#6](https://github.com/Cognigy/click-to-call-sdk/issues/6)) ([ffb1b1c](https://github.com/Cognigy/click-to-call-sdk/commit/ffb1b1c50f8ac690840aa028e288ee9b1083ebd2))


### Features

* let click-to-call SDK declare org/project/endpoint identity (CGY-38734) ([#5](https://github.com/Cognigy/click-to-call-sdk/issues/5)) ([eff2e9d](https://github.com/Cognigy/click-to-call-sdk/commit/eff2e9dbf30700ab2423bd93a0d0df857b6e0d83)), closes [#4](https://github.com/Cognigy/click-to-call-sdk/issues/4)
