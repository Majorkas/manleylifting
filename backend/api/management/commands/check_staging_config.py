from django.conf import settings
from django.core.management.base import BaseCommand, CommandError


class Command(BaseCommand):
    help = "Validate the environment contract required for a staging deployment."

    def handle(self, *args, **options):
        checks = {
            "DJANGO_DEBUG": not settings.DEBUG,
            "DATABASE_URL": self._database_is_postgres(),
            "REDIS_URL": self._redis_is_configured(),
            "DJANGO_ALLOWED_HOSTS": bool(getattr(settings, "ALLOWED_HOSTS", [])),
            "CORS_ALLOWED_ORIGINS": self._https_origins_configured(
                getattr(settings, "CORS_ALLOWED_ORIGINS", [])
            ),
            "CSRF_TRUSTED_ORIGINS": self._https_origins_configured(
                getattr(settings, "CSRF_TRUSTED_ORIGINS", [])
            ),
            "STRIPE_SECRET_KEY": str(getattr(settings, "STRIPE_SECRET_KEY", "")).startswith(
                "sk_test_"
            ),
            "STRIPE_WEBHOOK_SECRET": str(
                getattr(settings, "STRIPE_WEBHOOK_SECRET", "")
            ).startswith("whsec_"),
            "SHOP_TURNSTILE_SECRET_KEY": bool(
                getattr(settings, "SHOP_REQUIRE_TURNSTILE", False)
                and getattr(settings, "SHOP_TURNSTILE_SECRET_KEY", "")
            ),
            "R2 storage": self._r2_is_configured(),
            "ZeptoMail": bool(
                getattr(settings, "ZEPTOMAIL_SEND_TOKEN", "")
                and getattr(settings, "ZEPTOMAIL_FROM_EMAIL", "")
            ),
            "JWT refresh cookie": bool(
                getattr(settings, "JWT_REFRESH_COOKIE_HTTPONLY", False)
                and getattr(settings, "JWT_REFRESH_COOKIE_SECURE", False)
                and getattr(settings, "JWT_REFRESH_COOKIE_SAMESITE", "") == "None"
            ),
            "JWT_REFRESH_COOKIE_DOMAIN": not bool(
                getattr(settings, "JWT_REFRESH_COOKIE_DOMAIN", None)
            ),
        }
        failed = [name for name, passed in checks.items() if not passed]
        if failed:
            raise CommandError(
                "Staging configuration failed: " + ", ".join(failed)
            )

        self.stdout.write(self.style.SUCCESS("Staging configuration is ready"))

    @staticmethod
    def _database_is_postgres():
        engine = settings.DATABASES["default"].get("ENGINE", "")
        return engine == "django.db.backends.postgresql"

    @staticmethod
    def _redis_is_configured():
        if not getattr(settings, "USE_REDIS_CACHE", False):
            return False
        cache_config = getattr(settings, "CACHES", {}).get("default", {})
        return bool(
            getattr(settings, "REDIS_URL", "")
            and "redis" in cache_config.get("BACKEND", "").lower()
        )

    @staticmethod
    def _https_origins_configured(origins):
        return bool(origins) and all(str(origin).startswith("https://") for origin in origins)

    @staticmethod
    def _r2_is_configured():
        if not getattr(settings, "USE_R2_STORAGE", False):
            return False
        return all(
            getattr(settings, name, "")
            for name in (
                "AWS_STORAGE_BUCKET_NAME",
                "AWS_S3_ENDPOINT_URL",
                "AWS_ACCESS_KEY_ID",
                "AWS_SECRET_ACCESS_KEY",
            )
        )
