"""Billing & subscription management for MCP Grid.

Supports three tiers:
  - free:       Local Ollama only, 10 commands/day, basic features
  - pro:        Cloud AI (OpenAI/Anthropic), 500 commands/day, all features
  - enterprise: Unlimited commands, priority support, SSO, audit logs

Stripe integration is optional. When STRIPE_SECRET_KEY is not set,
the billing endpoints still work but skip actual payment processing
(useful for self-hosted / development).
"""

import logging
import os
import time
from typing import Any

import httpx

logger = logging.getLogger(__name__)

STRIPE_SECRET_KEY = os.getenv("STRIPE_SECRET_KEY", "")
STRIPE_WEBHOOK_SECRET = os.getenv("STRIPE_WEBHOOK_SECRET", "")
STRIPE_API = "https://api.stripe.com/v1"

# ─── Plan Definitions ────────────────────────────────────────────

PLANS: dict[str, dict[str, Any]] = {
    "free": {
        "name": "Free",
        "price_monthly": 0,
        "price_yearly": 0,
        "commands_per_day": 10,
        "ai_providers": ["ollama"],
        "features": [
            "local_ai",
            "code_generation",
            "basic_commands",
            "project_history",
        ],
        "max_projects": 25,
        "max_file_size_mb": 5,
        "stripe_price_id_monthly": None,
        "stripe_price_id_yearly": None,
    },
    "pro": {
        "name": "Pro",
        "price_monthly": 19,
        "price_yearly": 190,
        "commands_per_day": 500,
        "ai_providers": ["ollama", "openai", "anthropic"],
        "features": [
            "local_ai",
            "cloud_ai",
            "basic_commands",
            "code_generation",
            "code_review",
            "test_generation",
            "live_preview",
            "github_integration",
            "docs_generation",
            "project_templates",
            "file_management",
            "shell_assistant",
            "task_scheduling",
            "notifications",
            "clipboard_manager",
            "db_management",
            "api_testing",
            "plugin_system",
            "project_gallery",
            "collaboration",
            "project_history",
            "priority_generation",
        ],
        "max_projects": 500,
        "max_file_size_mb": 50,
        "stripe_price_id_monthly": os.getenv("STRIPE_PRO_MONTHLY_PRICE_ID", ""),
        "stripe_price_id_yearly": os.getenv("STRIPE_PRO_YEARLY_PRICE_ID", ""),
    },
    "enterprise": {
        "name": "Enterprise",
        "price_monthly": 99,
        "price_yearly": 990,
        "commands_per_day": -1,  # unlimited
        "ai_providers": ["ollama", "openai", "anthropic"],
        "features": [
            "local_ai",
            "cloud_ai",
            "basic_commands",
            "code_generation",
            "code_review",
            "test_generation",
            "live_preview",
            "github_integration",
            "docs_generation",
            "project_templates",
            "file_management",
            "shell_assistant",
            "task_scheduling",
            "notifications",
            "clipboard_manager",
            "db_management",
            "api_testing",
            "plugin_system",
            "project_gallery",
            "collaboration",
            "project_history",
            "priority_generation",
            "sso",
            "audit_logs",
            "priority_support",
            "custom_models",
            "team_management",
            "white_label",
        ],
        "max_projects": -1,  # unlimited
        "max_file_size_mb": 500,
        "stripe_price_id_monthly": os.getenv("STRIPE_ENTERPRISE_MONTHLY_PRICE_ID", ""),
        "stripe_price_id_yearly": os.getenv("STRIPE_ENTERPRISE_YEARLY_PRICE_ID", ""),
    },
}

# Map command names to required features for gating
COMMAND_FEATURE_MAP: dict[str, str] = {
    "code": "code_generation",
    "search": "basic_commands",
    "access": "basic_commands",
    "scan": "basic_commands",
    "alert": "basic_commands",
    "report": "basic_commands",
    "analyze": "basic_commands",
    "review": "code_review",
    "test": "test_generation",
    "preview": "live_preview",
    "github": "github_integration",
    "docs": "docs_generation",
    "template": "project_templates",
    "files": "file_management",
    "shell": "shell_assistant",
    "schedule": "task_scheduling",
    "notify": "notifications",
    "clip": "clipboard_manager",
    "db": "db_management",
    "apitest": "api_testing",
    "plugin": "plugin_system",
    "gallery": "project_gallery",
    "collab": "collaboration",
    "voice": "basic_commands",
    "mobile": "basic_commands",
}


# ─── Usage Tracking ──────────────────────────────────────────────

# In-memory usage counters (reset daily). Production should use Redis.
_daily_usage: dict[int, dict[str, Any]] = {}


def _get_today() -> str:
    """Get today's date string for usage tracking."""
    return time.strftime("%Y-%m-%d", time.gmtime())


def get_user_usage(user_id: int) -> dict[str, Any]:
    """Get or initialize usage for a user today."""
    today = _get_today()
    if user_id not in _daily_usage or _daily_usage[user_id].get("date") != today:
        _daily_usage[user_id] = {"date": today, "commands": 0}
    return _daily_usage[user_id]


def increment_usage(user_id: int) -> int:
    """Increment daily command count. Returns new count."""
    usage = get_user_usage(user_id)
    usage["commands"] += 1
    return usage["commands"]


def check_rate_limit(user_id: int, plan: str) -> tuple[bool, str]:
    """Check if user is within their daily rate limit.

    Returns (allowed, message).
    """
    plan_config = PLANS.get(plan, PLANS["free"])
    limit = plan_config["commands_per_day"]
    if limit == -1:  # unlimited
        return True, ""
    usage = get_user_usage(user_id)
    if usage["commands"] >= limit:
        return False, (
            f"Daily command limit reached ({limit}/{limit}). "
            f"Upgrade to {_next_plan(plan)} for more commands."
        )
    return True, ""


def check_feature_access(command: str, plan: str) -> tuple[bool, str]:
    """Check if a command is available on the user's plan.

    Returns (allowed, message).
    """
    feature = COMMAND_FEATURE_MAP.get(command, "basic_commands")
    plan_config = PLANS.get(plan, PLANS["free"])
    if feature in plan_config["features"]:
        return True, ""
    return False, (
        f"The '{command}' command requires a {_min_plan_for_feature(feature)} plan. "
        f"Upgrade at /billing to unlock this feature."
    )


def check_ai_provider(provider: str, plan: str) -> tuple[bool, str]:
    """Check if an AI provider is available on the user's plan.

    Returns (allowed, message).
    """
    plan_config = PLANS.get(plan, PLANS["free"])
    if provider in plan_config["ai_providers"]:
        return True, ""
    return False, (
        f"The '{provider}' AI provider requires a Pro or Enterprise plan. "
        f"Free plan includes local Ollama only."
    )


def _next_plan(current: str) -> str:
    """Get the next tier up."""
    order = ["free", "pro", "enterprise"]
    idx = order.index(current) if current in order else 0
    return order[min(idx + 1, len(order) - 1)]


def _min_plan_for_feature(feature: str) -> str:
    """Find the cheapest plan that includes a feature."""
    for plan_name in ("free", "pro", "enterprise"):
        if feature in PLANS[plan_name]["features"]:
            return plan_name
    return "enterprise"


# ─── Stripe Integration ─────────────────────────────────────────


async def create_checkout_session(
    user_id: int,
    plan: str,
    interval: str = "monthly",
    success_url: str = "",
    cancel_url: str = "",
) -> dict[str, Any]:
    """Create a Stripe Checkout session for upgrading.

    Returns checkout URL or error.
    """
    if not STRIPE_SECRET_KEY:
        return {
            "status": "demo",
            "message": (
                "Stripe not configured. Set STRIPE_SECRET_KEY to enable payments. "
                "For now, plans can be changed manually."
            ),
        }

    plan_config = PLANS.get(plan)
    if not plan_config:
        return {"status": "error", "message": f"Unknown plan: {plan}"}

    price_key = f"stripe_price_id_{interval}"
    price_id = plan_config.get(price_key, "")
    if not price_id:
        return {
            "status": "error",
            "message": f"No Stripe price configured for {plan}/{interval}",
        }

    async with httpx.AsyncClient() as client:
        response = await client.post(
            f"{STRIPE_API}/checkout/sessions",
            headers={"Authorization": f"Bearer {STRIPE_SECRET_KEY}"},
            data={
                "mode": "subscription",
                "line_items[0][price]": price_id,
                "line_items[0][quantity]": "1",
                "success_url": success_url or os.getenv("FRONTEND_URL", "https://mcp-tray-app-qrjt16oz.devinapps.com") + "/billing?success=true",
                "cancel_url": cancel_url or os.getenv("FRONTEND_URL", "https://mcp-tray-app-qrjt16oz.devinapps.com") + "/billing?canceled=true",
                "metadata[user_id]": str(user_id),
                "metadata[plan]": plan,
            },
        )
        if response.status_code == 200:
            data = response.json()
            return {"status": "success", "checkout_url": data.get("url", "")}
        return {
            "status": "error",
            "message": f"Stripe error: {response.text[:200]}",
        }


async def create_portal_session(
    stripe_customer_id: str,
    return_url: str = "",
) -> dict[str, Any]:
    """Create a Stripe Customer Portal session for managing subscription."""
    if not STRIPE_SECRET_KEY:
        return {"status": "demo", "message": "Stripe not configured."}

    async with httpx.AsyncClient() as client:
        response = await client.post(
            f"{STRIPE_API}/billing_portal/sessions",
            headers={"Authorization": f"Bearer {STRIPE_SECRET_KEY}"},
            data={
                "customer": stripe_customer_id,
                "return_url": return_url or os.getenv("FRONTEND_URL", "https://mcp-tray-app-qrjt16oz.devinapps.com") + "/billing",
            },
        )
        if response.status_code == 200:
            data = response.json()
            return {"status": "success", "portal_url": data.get("url", "")}
        return {
            "status": "error",
            "message": f"Stripe error: {response.text[:200]}",
        }


def handle_webhook_event(event_type: str, data: dict) -> dict[str, Any]:
    """Process Stripe webhook events.

    Returns action to take (plan change, cancellation, etc.).
    """
    if event_type == "checkout.session.completed":
        metadata = data.get("metadata", {})
        return {
            "action": "upgrade",
            "user_id": int(metadata.get("user_id", 0)),
            "plan": metadata.get("plan", "pro"),
            "stripe_customer_id": data.get("customer", ""),
            "stripe_subscription_id": data.get("subscription", ""),
        }
    if event_type == "customer.subscription.deleted":
        return {
            "action": "downgrade",
            "stripe_customer_id": data.get("customer", ""),
            "plan": "free",
        }
    if event_type == "invoice.payment_failed":
        return {
            "action": "payment_failed",
            "stripe_customer_id": data.get("customer", ""),
        }
    return {"action": "ignore", "event_type": event_type}


def get_plan_comparison() -> list[dict[str, Any]]:
    """Return plan comparison data for the pricing page."""
    result = []
    for plan_id, config in PLANS.items():
        result.append({
            "id": plan_id,
            "name": config["name"],
            "price_monthly": config["price_monthly"],
            "price_yearly": config["price_yearly"],
            "commands_per_day": config["commands_per_day"],
            "ai_providers": config["ai_providers"],
            "features": config["features"],
            "max_projects": config["max_projects"],
        })
    return result
