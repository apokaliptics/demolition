# adblock-rust Mapping Policy

This compiler supports two parser modes:

- native: Uses the local parser in this repository.
- adblock: Uses adblock-rust to classify network rules, then applies Demolition's DNR adapter.

## Why this split exists

Manifest V3 request blocking uses declarativeNetRequest (DNR). adblock-rust supports broader ABP/uBO behavior than DNR can express directly. Demolition keeps conversion logic in a dedicated adapter so MV3 constraints stay explicit and deterministic.

## Supported in current adapter

- Basic URL blocking patterns (including ||domain^ style anchors)
- Resource type options mapped to DNR resourceTypes
- Priority scoring + static cap truncation
- Deterministic rule IDs via --start-id

## Explicitly not mapped yet

- Cosmetic selectors (##, #@#)
- Scriptlets (##+js)
- ABP exception rules (@@) in static output
- Redirect/CSP/removeparam modifiers
- Advanced domain-party logic beyond basic type mapping

These are intentionally dropped in stage 1 and should be handled by:

- content scripts (cosmetic)
- runtime dynamic/session rules or future adapter passes (exceptions/modifiers)

## Fallback policy

If adblock mode is unavailable or fails validation, use native mode for deterministic releases.

## Build examples

Native mode:

cargo run -- --input ../../rules.txt --output ../../rules/core-network.json --max-static-rules 30000 --start-id 1 --parser-mode native

adblock mode (requires feature):

cargo run --features adblock-bridge -- --input ../../rules.txt --output ../../rules/core-network.json --max-static-rules 30000 --start-id 1 --parser-mode adblock
