# Configuration

All configuration goes through environment variables. [`.env.example`](../.env.example) describes them one by one. An empty variable takes its default value. An invalid value prevents the server from starting, and the error names the faulty variable.

- [Variables](#variables)
- [Judge](#judge)
- [Outbound calls](#outbound-calls)
- [Captures](#captures)

## Variables

| Variable                                                                                                             | Role                                                                                                        |
| -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `NUDGE_ENCRYPTION_KEY`                                                                                               | **Required.** Instance key (32 bytes, base64): encrypts the secrets stored in the database with AES-256-GCM |
| `NUDGE_POSTGRES_PASSWORD`                                                                                            | **Required** (compose). Postgres password                                                                   |
| `NUDGE_VERSION`, `NUDGE_ROLES`                                                                                       | Image version (compose, `latest`) and what the process runs (`api`, `worker`, default `api,worker`)         |
| `NUDGE_BIND`, `NUDGE_PORT`, `NUDGE_DASHBOARD_URL`, `NUDGE_COOKIE_SECURE`, `NUDGE_TRUST_PROXY`, `NUDGE_SETUP_TOKEN`   | Access: published address and port, public URL, HTTPS-only cookie, trusted proxies, setup token             |
| `NUDGE_WIDGET_RATE_LIMIT_IP`, `NUDGE_WIDGET_RATE_LIMIT_PROJECT`                                                      | Widget rate limit, in Feedbacks per minute (20 per IP, 600 per Project)                                     |
| `NUDGE_OUTBOUND_ALLOWED_HOSTS`                                                                                       | Internal hosts a Member-configured URL may reach (webhooks, Judge base URL, SMTP host); none by default     |
| `NUDGE_JUDGE_PROVIDER`, `NUDGE_JUDGE_API_KEY`, `NUDGE_JUDGE_MODEL`, `NUDGE_JUDGE_BASE_URL`, `NUDGE_JUDGE_TIMEOUT_MS` | Default Judge, and timeout of a request to the Judge (30 s)                                                 |
| `NUDGE_TRIAGE_JUNK_THRESHOLD`, `NUDGE_TRIAGE_MANIPULATION_THRESHOLD`, `NUDGE_TRIAGE_CONFIDENCE_THRESHOLD`            | Thresholds of the Verdict policy (0.8, 0.7, 0.6)                                                            |
| `NUDGE_SUSPENSION_FAILURE_THRESHOLD`, `NUDGE_SUSPENSION_COOLDOWN_MS`, `NUDGE_SUSPENSION_PROBE_INTERVAL_MS`           | Destination suspension (5 failures, 5 min, probe every minute)                                              |
| `NUDGE_PURGE_INTERVAL_MS`                                                                                            | Period of the Retention purge (1 h)                                                                         |
| `NUDGE_TRIAGE_CONCURRENCY`, `NUDGE_DISPATCH_CONCURRENCY`                                                             | Jobs a worker runs at the same time: Triages (2) and Deliveries (10)                                        |
| `NUDGE_CAPTURES_STORAGE`, `NUDGE_CAPTURES_DIR`, `NUDGE_S3_*`                                                         | Capture storage: `disk` or S3-compatible (`s3`)                                                             |

## Judge

The Judge is chosen in the dashboard (**Settings**), and its key is stored there encrypted. The `NUDGE_JUDGE_PROVIDER`, `NUDGE_JUDGE_API_KEY`, `NUDGE_JUDGE_MODEL` and `NUDGE_JUDGE_BASE_URL` variables are only a fallback as long as no Judge is chosen; `NUDGE_JUDGE_TIMEOUT_MS` always applies. Three providers are available:

- `typesafe`: TypeSafe System One (Jev, `jev-latest` by default). It requires `NUDGE_JUDGE_API_KEY`;
- `openrouter`: pplx-decider through OpenRouter's Decisions API (`perplexity/pplx-decider-v1.2` by default). It requires `NUDGE_JUDGE_API_KEY`;
- `self_hosted`: any server that exposes the Decisions API (a self-hosted pplx-decider, for example; `pplx-decider-flash-v1.2` by default). It requires `NUDGE_JUDGE_BASE_URL`, and the key is optional.

Without a Judge, nudge runs in degraded mode: it detects neither Severity, nor Junk, nor Manipulation, and every Verdict is Uncertain.

Only the Feedback text, its non-personal context and the Project description are sent to the Judge, and only as data. The Capture is never sent to it.

## Outbound calls

Members type the URLs that nudge calls: a webhook Destination or Alert destination, a Judge base URL, the SMTP host. So that they cannot reach the Instance's own network, the api and the worker only connect to public addresses. Loopback, private, link-local (cloud metadata), CGNAT, unique local and multicast addresses are refused, IPv4 and IPv6 alike, on the address actually connected to after DNS resolution. The test buttons answer with the refusal.

To send webhooks to a host on your network, to choose a self-hosted Judge in the dashboard, or to send email through an SMTP relay on your network, list that host in `NUDGE_OUTBOUND_ALLOWED_HOSTS`: host names (exact match, such as `hooks.lan` or a compose service like `decider`), IP addresses or CIDR ranges (`192.168.1.0/24`), comma-separated. Every Member can then target it. `0.0.0.0/0,::/0` turns the check off. The `NUDGE_JUDGE_*` Judge, which only you configure, is not checked.

## Email

Email Destinations, and an email Alert destination, send through the Instance's SMTP server, set in the dashboard under **Settings › Email (SMTP)**: host, port, security (STARTTLS on 587, implicit TLS on 465, or none for a relay on a trusted network), optional username and password, and the sender address. The password is encrypted with the Instance key and never returned; it is dropped when the host or the username changes. **Send test email** sends a message to the signed-in Member.

Without an SMTP server, an email Destination can be created but its Deliveries fail as refused credentials: the Destination is Suspended, and resumes once a server is saved. Refused credentials suspend the Destination too; a recipient the server refuses fails that Delivery only. Each Feedback is one email, with its Capture attached.

## Captures

By default, Captures are written to disk (`NUDGE_CAPTURES_STORAGE=disk`), in the `captures` volume that the api and the worker share. For S3-compatible object storage (AWS S3, MinIO, Garage…), set `NUDGE_CAPTURES_STORAGE=s3` as well as `NUDGE_S3_ENDPOINT`, `NUDGE_S3_BUCKET`, `NUDGE_S3_ACCESS_KEY_ID` and `NUDGE_S3_SECRET_ACCESS_KEY`. `NUDGE_S3_REGION` (`us-east-1`), `NUDGE_S3_PREFIX` and `NUDGE_S3_FORCE_PATH_STYLE` (`true`) are optional. Captures already on disk are not migrated to S3.
