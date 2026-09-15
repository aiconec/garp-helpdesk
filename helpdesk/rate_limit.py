"""Per-user rate limiting for helpdesk endpoints that send outbound mail.

`HDTicket.reply_via_agent` hands caller-supplied recipients and a caller-supplied
body to `frappe.sendmail`, which posts them through the site's shared outgoing
account. Unthrottled, that endpoint is an open relay: one agent account scripting
a loop can send mail in volume from the platform's identity and burn its sender
reputation for every tenant on the estate.

Frappe's own `@rate_limit` decorator keys on the client IP, which is taken from
`X-Forwarded-For` and is therefore attacker-controlled behind our proxy. These
limits key on `frappe.session.user` instead, which the session cookie fixes.
"""

import frappe

# Outbound agent replies. Generous enough for an agent working a busy queue by
# hand, small enough that a scripted loop is stopped within seconds.
REPLY_PER_MINUTE = 15
REPLY_PER_HOUR = 120


def _configured(key: str, default: int) -> int:
    """Read a limit from site_config, falling back to the default."""
    value = frappe.conf.get(f"helpdesk_{key}")
    return int(value) if value else default


def _hit(window_key: str, seconds: int, limit: int) -> None:
    user = frappe.session.user
    # make_key prefixes the site's db name. The raw incrby/expire below bypass
    # RedisWrapper's own prefixing, and every site on the bench shares one
    # redis_cache -- so a bare key would let a tenant-A admin create a user named
    # after a tenant-B agent, burn its budget, and lock that person out on B.
    cache_key = frappe.cache.make_key(f"helpdesk:rl:{window_key}:{user}")

    count = frappe.cache.incrby(cache_key, 1)
    # Set the TTL whenever it is missing, not only on the first hit: a crash
    # between incrby and expire would otherwise leave a key that never expires
    # and an agent who is locked out for good.
    if count == 1 or frappe.cache.ttl(cache_key) < 0:
        frappe.cache.expire(cache_key, seconds)

    if count > limit:
        frappe.throw(
            frappe._("You are sending emails too quickly. Please wait a moment and try again."),
            frappe.RateLimitExceededError,
        )


def check_reply_rate_limit() -> None:
    """Throw RateLimitExceededError if the session user is over either window.

    Called at the top of every endpoint that puts mail on the wire. Skipped for
    background jobs and the scheduler, which have no request to throttle, and for
    Administrator, which runs automations such as the inbound email workflow.
    """
    if not getattr(frappe.local, "request", None):
        return

    if frappe.session.user in ("Guest", "Administrator"):
        return

    _hit("reply:min", 60, _configured("reply_rate_limit_per_minute", REPLY_PER_MINUTE))
    _hit("reply:hour", 3600, _configured("reply_rate_limit_per_hour", REPLY_PER_HOUR))
