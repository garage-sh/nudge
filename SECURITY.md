# Security

## Reporting a vulnerability

Do not report a vulnerability in a public issue. Use [GitHub's private reporting](https://github.com/garage-sh/nudge/security/advisories/new): only the maintainers can see it.

Describe the vulnerability, the affected version (image tag or commit), the steps to reproduce it and its impact. You will receive a response within seven days. Once the vulnerability is fixed and released, the report becomes a public security advisory, which credits you if you wish.

## Supported versions

Security fixes are released on the latest minor version. Update with `docker compose pull && docker compose up -d`.

## Verifying the images

Every image published on `ghcr.io/garage-sh` is signed with cosign from the repository's CI, and carries an SBOM and a provenance attestation. The verification command is in the [README](README.md#updating-backing-up-scaling).
