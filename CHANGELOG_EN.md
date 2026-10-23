# Changelog

All notable changes to this project are documented in this file. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres to
[Semantic Versioning](https://semver.org/).

Chinese version: [CHANGELOG.md](CHANGELOG.md).

## [1.5.4] — 2026-10-24

### Compatibility

- Declares compatibility with DSH `0.2.1-rc.2`, verified in a real environment across three paths: a `[vision]` model is taken over by the bridge as expected, `vision_analyze` tool calls succeed, and a non-`[vision]` model calling that tool receives the correct denial message.
- Compared with the `0.2.0-rc.2` declared in 1.5.3, the `0.2.1-rc.2` host contract surface has no breaking changes, so no new version exemption is needed and the open-ended `>=0.1.2-rc.1` floors on both sides remain valid.

### Changed

- **The `vision_analyze` tool is now restricted to `[vision]` models.** Calling it from any other model is explicitly denied with an actionable reason (which provider is active, that the model should use its own capability, and how to switch to a `[vision]` model). Previously the tool was open to every model, which created two competing paths for models that already accept images. The gate is installed at the host's `tools/pre-execute` stage, so it denies before the tool body runs and produces no upstream call.
- When no vision model is configured (bridge disabled) the gate is not installed and the tool keeps its previous behaviour — no `[vision]` model can be selected in that state.
- Route resolution prefers the session's folded request context (`session.requestContext().provider`) and only falls back to `agent.options.provider` when that accessor is absent. For a bridged model, `agent.options` retains the base provider (e.g. `omniroute`) and does not reflect the actual route.

### Fixed

- **Image URLs now follow 30x redirects.** They were previously rejected outright, which made every short-link image host that answers with a 302 (e.g. `picsum.photos`) fail unconditionally. Redirects are now followed manually, hop by hop, with the SSRF check re-run on every hop (`redirect: "follow"` would let a redirect reach an address the first-hop check had already cleared), up to 5 hops.
- **Download failures now report the underlying cause.** `fetch` hides the useful detail in `cause`, and a bare `fetch failed` is undiagnosable. Errors now append the cause's code or message, e.g. `ATTACHMENT_READ_ERROR: fetch failed — cause: UND_ERR_CONNECT_TIMEOUT`, which distinguishes DNS failures, connect timeouts and TLS errors directly.

### Reliability

- The connect timeout is tightened from undici's 10s default to 5s. Measured healthy edges answer in 0.07–1.4s and the slowest working one in ~4s, so 5s keeps ample margin while making a blackholed address fail about twice as fast.
- Remote fetches now use a fresh connection pool per attempt (previously a module-level singleton), so a retry does not reuse the connection and DNS result of the attempt that just failed.
- A single bounded retry with a 400ms backoff covers transient connection errors only (`UND_ERR_CONNECT_TIMEOUT`, `ECONNRESET`, `ETIMEDOUT`, and similar). HTTP status errors, size-limit violations, SSRF rejections and user cancellation all fail immediately without retrying.

### Known limitations

- On some networks a CDN edge can be **continuously unreachable for tens of seconds** (measured ~53% reachability, with runs of up to ~20s). Such an outage cannot be crossed by sub-second retries; the fetch fails after roughly 13s with a clear reason. In that case, use a different image host or route Node through a proxy. This is a network-side issue, not a plugin defect.

## [1.5.3] — 2026-09-30

### Fixed

- Declares compatibility with DSH `0.2.0-rc.2`: verified end-to-end in real Web and desktop sessions (conversation-enhancement bridging, the `vision_analyze` tool, credential reads/writes, and the settings panel all work). Since 0.2.0 the version gate checks both `engines.dsh` and `peerDependencies`; this plugin's open-ended `>=0.1.2-rc.1` floors on both sides pass without any exemption.
- Fixed `Invalid schema for function 'vision_analyze'` when chatting through official models: the tool's parameter declaration is now a standard JSON Schema with an `object` root, matching what the host's `defineTool` compiles to. The host projects tool parameters verbatim to the model API, and DeepSeek official endpoints strictly require an object-rooted schema — the previous property-map shape was rejected. Custom models are unaffected.
- Fixed 403 on the desktop settings panel: the desktop front end loads through an Electron custom protocol without a `Referer`, so the same-origin check now allows loopback requests that lack a source header or carry a non-http/https protocol origin; malicious web pages always send an http/https Origin and cannot enter the new branches, so security is not weakened.
- Requirements updated: DSH `0.1.2-rc.1` or newer is required, verified up to `0.2.0-rc.2`.

## [1.5.2] — 2026-09-28

### Fixed

- Declares compatibility with DSH `0.1.7-rc.2`: the host contract surface between 0.1.5-rc.2 and 0.1.7-rc.2 was fully compared (`ctx.llm` adapter and routing, `ctx.credentials`, `ctx.attachments.readImage`, `ctx.fs`, the `ctx.remote.credentials` RPC, `webServer` route registration, and all four client injection points are compatible) and verified in a real session.
- Fixes two SSRF-guard defects (`vision/image-source.mjs`): ① the `::ffff:0:0/96` block rule was removed — Node's BlockList stores every IPv4 address internally in IPv4-mapped form, so that rule killed all public IPv4 hosts; the IPv4 rules already cover the mapped form. ② the custom `lookup` callback for `net.connect` now follows the `all: true` array contract and explicitly returns an error when every resolved address is blocked — previously a single address string was silently dropped by Node and an empty result passed `undefined`, both surfacing as `ERR_INVALID_IP_ADDRESS`.
- Attachment read errors now carry the original message (`vision/analysis-core.mjs`): non-`ATTACHMENT_*` faults (such as a plain Error thrown by the SSRF guard) are no longer collapsed into a bare `ATTACHMENT_READ_ERROR`; the stable suffix is kept for machine matching while the real reason is reported for diagnosis.
- Documents the interaction with capabilities added in 0.1.7: the host gained an `IMAGE_OFFLOAD_REQUIRED` image-budget mechanism and a text-only model image-projection tool, but bridged models declare `image` input support, so the host forwards images verbatim to the bridge adapter, which converts them to visual-evidence text before relaying to the underlying model. The two mechanisms do not conflict.
- Since 0.1.7 the GUI model selector filters by catalog membership: the plugin's `listModels` dynamically lists every bridged model from enabled routes, so they appear in the selector and can be chosen once configured.

## [1.5.1] — 2026-09-11

### Added

- Add a `@deepseek-ai/dsh` peer dependency declaration (`>=0.1.2-rc.1`), consistent with the existing engine declaration, so npm can validate the host version at install time.

### Fixed

- Declares compatibility with DSH `0.1.5-rc.2`: verified in a real session (conversation-enhancement bridge calls, credential reads/writes, settings and model-catalog routes, and attachment reads all work).

## [1.5.0] — 2026-09-07

### Fixed

- Fixed "DSH credential service unavailable" when saving settings on DSH 0.1.2-rc.1: credential access moved to the new `ctx.remote.credentials` interface, keeping a compatibility path for older hosts.
- When a gateway rejects image input (e.g. `Model do not support image input`) or the vision model returns empty content, a clear message is shown instead of injecting the gateway's raw JSON into the conversation.
- Fixed persisted settings being overwritten with `null`, and unbounded reads of the model-catalog response.
- Improved retry-path diagnostics, empty-response interception, and in-flight deduplication comments.

### Changed

- The "conversation enhancement" model selector now greys out models that already accept image input (they need no bridging) and labels them "native image support, no enhancement needed".

## [1.4.0] — 2026-09-05

### Changed

- The settings page's "conversation vision model" list now reads through DSH `0.1.2-rc.1`'s new model-catalog interface.
- The minimum host version is raised to `0.1.2-rc.1` (engine declarations in `dsh.plugin.json` and `package.json` tightened together).
- Client injection dependencies trimmed: `@deepseek-ai/dsh-client-runtime` is no longer injected.

## [1.3.0] — 2026-08-22

### Added

- New "diagnostic log" setting (off by default) that emits plugin runtime logs for troubleshooting.
- Concurrent analyses sharing the same image and prompt are merged into a single upstream request.
- The install command uses the `dsh` direct form (requires a globally installed DSH).

### Fixed

- Compatible with the adapter interface of newer DSH hosts (0.1.1-rc.8 and later).
- Session auxiliary calls (title generation, context compaction) no longer trigger duplicate visual analyses, reducing quota use and occasional failures.
- Improved connection test: uses a real token budget and includes an upstream response excerpt on failure.

## [1.2.0] — 2026-08-20

### Added

- Reworked the settings page's information hierarchy and connection flow: the panel starts collapsed when already configured and expands into full editing plus "save and test connection".

### Changed

- Improved vision-model selection, catalog loading, manual model ID entry, connection status and error feedback.
- Improved multi-turn image conversations: follow-up turns without an image no longer re-query the vision model, and explicitly referenced historical images reuse cached visual evidence.

### Fixed

- Added a clear, general error message for interface-protocol incompatibility with image content.