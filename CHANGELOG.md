# Changelog

## Unreleased

### Breaking changes

- removed the legacy `bridge` API naming
- removed `startDiscordPiBridge`
- removed `loadDiscordPiBridgeConfigFromEnv`
- removed `DiscordPiBridge`
- removed `DiscordPiBridgeConfig`
- removed `ResolvedDiscordPiBridgeConfig`
- standardised the package API and internal types on `gateway`

### Changed

- `startDiscordGateway` is now the only gateway entry point
- `loadDiscordGatewayConfigFromEnv` is now the only env config loader
- internal config and service types now use `ResolvedDiscordGatewayConfig`
- package description and docs now refer to the package as a Discord gateway, not a bridge
