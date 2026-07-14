from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .views import is_manager


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def whoami(request):
    u = request.user
    return Response(
        {
            "id": u.id,
            "username": u.username,
            "first_name": u.first_name,
            "last_name": u.last_name,
            "is_manager": is_manager(u),
        }
    )
