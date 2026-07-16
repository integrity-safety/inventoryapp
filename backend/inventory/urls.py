from django.urls import include, path
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

from .views import AssetViewSet, JobViewSet, TagViewSet, TransactionViewSet, UserViewSet
from .whoami import whoami

router = DefaultRouter()
router.register(r"assets", AssetViewSet, basename="asset")
router.register(r"jobs", JobViewSet, basename="job")
router.register(r"tags", TagViewSet, basename="tag")
router.register(r"transactions", TransactionViewSet, basename="transaction")
router.register(r"users", UserViewSet, basename="user")

urlpatterns = [
    path("auth/token/", TokenObtainPairView.as_view(), name="token_obtain_pair"),
    path("auth/refresh/", TokenRefreshView.as_view(), name="token_refresh"),
    path("auth/me/", whoami, name="whoami"),
    path("", include(router.urls)),
]
