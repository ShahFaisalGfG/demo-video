# Security policy

## Supported release

Security corrections target the latest published release.

## Reporting

Report suspected command injection, unsafe path handling, credential exposure, untrusted model download, or automation-boundary issues privately to the repository maintainer before public disclosure.

## Operating guidance

- Recording definitions can click, type, upload files, and control native input. Review definitions before execution.
- Run demonstrations with dedicated test accounts and non-production data unless the user authorizes another environment.
- Store credentials in environment variables and redact captured secrets.
- Semantic evidence sends screenshots to the configured endpoint. Use a local endpoint for confidential applications.
- Downloaded browser and model artifacts remain under `~/.demo_video`; delete that directory to remove cached runtimes.
- macOS Accessibility, macOS Screen Recording, Linux display access, and Windows desktop control should be granted only while needed.
