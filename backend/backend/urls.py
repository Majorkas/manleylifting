from django.contrib import admin
from django.urls import path, include
from django.conf import settings

urlpatterns = [
    path(settings.ADMIN_URL_PATH, admin.site.urls),
    path('api/', include('api.urls')),
]
