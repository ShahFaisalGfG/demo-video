# Security policy

## Supported release

Security corrections target the latest published release.

## Reporting

Report suspected command injection, unsafe path handling, credential exposure, untrusted model download, update verification, or automation-boundary issues privately to the maintainer, Shah Faisal, at shahfaisalgfg@gmail.com before public disclosure.

## Operating guidance

- Recording definitions can click, type, upload files, and control native input. Review definitions before execution.
- Run demonstrations with dedicated test accounts and non-production data unless the user authorizes another environment.
- Store credentials in environment variables and redact captured secrets.
- Semantic evidence sends screenshots to the configured endpoint. Use a local endpoint for confidential applications.
- Downloaded browser and model artifacts remain under `~/.demo_video`; delete that directory to remove cached runtimes.
- Skill updates install only after the release manifest's ECDSA signature and the archive's SHA-256 checksum match, and only when the user runs or approves `update-skill.mjs`.
- macOS Accessibility, macOS Screen Recording, Linux display access, and Windows desktop control should be granted only while needed.
