# Security

This extension requests broad permissions (`<all_urls>` host permissions,
`debugger`) because its job is debugging arbitrary pages in a live browser
on behalf of an Apty engineer. That's a deliberately wide surface — treat
any change that widens it further (new host permissions, new
`externally_connectable` entries, new `debugger` usage) as security-relevant
and call it out explicitly in the PR/commit description.

Current, deliberate constraints on that surface:

- **BYOK only**: the extension talks directly to the AI provider you
  configure. There is no login/proxy mode and no third-party backend in the
  loop.
- **`externally_connectable` is `{"ids": []}`**: no web origin and no other
  extension can message this extension. Don't widen this to a wildcard
  host/port pattern; if external messaging is ever needed, allowlist a
  specific extension ID.
- **Diagnostic log output is redacted** before being returned to the model —
  the pages this extension inspects are untrusted and may contain secrets in
  console output or a host application's own logs.

## Reporting a vulnerability

Report security issues to Apty engineering directly rather than filing a
public issue. Include the affected component, a reproduction, and the
potential impact.

## Findings log

The detailed, per-finding security audit (severity, affected component,
risk, mitigation, status) lives in
[`docs/security/SECURITY_AUDIT.md`](docs/security/SECURITY_AUDIT.md). It's a
living document — update it whenever a finding is fixed or a new one is
discovered, rather than only appending.
