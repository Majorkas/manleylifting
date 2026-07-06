from django.conf import settings


def set_refresh_cookie(response, refresh_token):
    response.set_cookie(
        settings.JWT_REFRESH_COOKIE_NAME,
        refresh_token,
        max_age=settings.JWT_REFRESH_COOKIE_MAX_AGE,
        httponly=settings.JWT_REFRESH_COOKIE_HTTPONLY,
        secure=settings.JWT_REFRESH_COOKIE_SECURE,
        samesite=settings.JWT_REFRESH_COOKIE_SAMESITE,
        path=settings.JWT_REFRESH_COOKIE_PATH,
    )
    return response


def clear_refresh_cookie(response):
    response.delete_cookie(
        settings.JWT_REFRESH_COOKIE_NAME,
        path=settings.JWT_REFRESH_COOKIE_PATH,
        samesite=settings.JWT_REFRESH_COOKIE_SAMESITE,
    )
    return response
