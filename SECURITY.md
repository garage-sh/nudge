# Security

## Reporting a vulnerability

Do not report a vulnerability in a public issue. Use [GitHub's private reporting](https://github.com/garage-sh/nudge/security/advisories/new): only the maintainers can see it.

Describe the vulnerability, the affected version (image tag or commit), the steps to reproduce it and its impact. You will receive a response within seven days. Once the vulnerability is fixed and released, the report becomes a public security advisory, which credits you if you wish.

## Supported versions

Security fixes are released on the latest minor version. Update with `docker compose pull && docker compose up -d`.

## Verifying the images

Every image published on `ghcr.io/garage-sh` is signed with cosign by the `images.yml` workflow on `main` or a release tag, and carries an SBOM and a provenance attestation. The verification command, which pins that workflow and those refs, is in [Verifying an image](docs/self-hosting.md#verifying-an-image).

## Operating an Instance

What nudge does not protect on its own, and what is left to the operator:

- **Triage routes, it does not authenticate.** The Author writes the text the Judge reads, so anyone holding a Project's public key can describe a severe problem and reach the Destinations whose Filter only accepts `blocking` or `major` Feedback. Do not point a paging channel at a Filter on the assumption that only real incidents pass it.
- **The per-Project Widget budget is shared by every Author.** The public key is public and the `Origin` header can be forged outside a browser: a few dozen IPs can spend a Project's budget (`NUDGE_WIDGET_RATE_LIMIT_PROJECT`, 600 Feedbacks per minute per api replica) and, through Triage, the Judge's. Lower it to what each Project really receives, and set a spending cap at the Judge provider.
- **Invitation tokens are in URLs.** The link `/invitation/<token>`, then `/api/invitations/<token>`, lands in the access logs of the dashboard container and of your TLS proxy, for the 7 days the invitation is valid. Restrict who reads those logs until the invitation is accepted: it can then no longer be used.
- **The client IP depends on `NUDGE_TRUST_PROXY`.** The sign-in brute-force protection and the Widget per-IP limit rely on it: see [In production: HTTPS](docs/self-hosting.md#in-production-https).
