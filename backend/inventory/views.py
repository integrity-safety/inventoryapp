import hashlib

from django.contrib.auth import get_user_model
from django.db import transaction as db_transaction
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response

from django.conf import settings

from .models import (
    ALLOWED_TRANSITIONS,
    MANAGER_ACTIONS,
    Asset,
    Tag,
    Transaction,
    TransactionPhoto,
    TxAction,
)
from .serializers import (
    AssetSerializer,
    TagSerializer,
    TransactionSerializer,
    TransitionSerializer,
    UserBriefSerializer,
)

User = get_user_model()


def is_manager(user):
    return user.is_staff or user.groups.filter(name="Managers").exists()


class AssetViewSet(viewsets.ModelViewSet):
    queryset = Asset.objects.all().prefetch_related("tags", "transactions")
    serializer_class = AssetSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        status_filter = self.request.query_params.get("status")
        if status_filter:
            qs = qs.filter(status=status_filter)
        search = self.request.query_params.get("q")
        if search:
            qs = qs.filter(code__icontains=search) | qs.filter(name__icontains=search)
        return qs.distinct()

    @action(detail=False, methods=["get"], url_path="by-tag/(?P<uid>[^/]+)")
    def by_tag(self, request, uid=None):
        """Resolve a scanned NFC UID or QR/barcode payload to its asset."""
        tag = Tag.objects.select_related("asset").filter(uid=uid).first()
        if not tag:
            return Response({"detail": "No asset for that tag."}, status=status.HTTP_404_NOT_FOUND)
        return Response(AssetSerializer(tag.asset, context=self.get_serializer_context()).data)

    @action(detail=True, methods=["get"])
    def history(self, request, pk=None):
        asset = self.get_object()
        txs = asset.transactions.all().select_related("actor", "counterparty").prefetch_related("photos")
        return Response(TransactionSerializer(txs, many=True, context=self.get_serializer_context()).data)

    @action(detail=True, methods=["post"])
    def transition(self, request, pk=None):
        asset = self.get_object()
        serializer = TransitionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        action_value = data["action"]
        if action_value not in ALLOWED_TRANSITIONS:
            raise ValidationError({"action": f"Unknown action '{action_value}'."})

        # Idempotent replay of an offline-queued transaction.
        client_uuid = data.get("client_uuid")
        if client_uuid:
            existing = Transaction.objects.filter(client_uuid=client_uuid).first()
            if existing:
                return Response(
                    TransactionSerializer(existing, context=self.get_serializer_context()).data,
                    status=status.HTTP_200_OK,
                )

        # Role gate.
        if action_value in MANAGER_ACTIONS and not is_manager(request.user):
            raise PermissionDenied("This action requires a manager.")
        if action_value == TxAction.ASSIGN.value:
            self._check_assign_permission(request, data)

        required_from, to_status = ALLOWED_TRANSITIONS[action_value]
        if required_from is not None and asset.status not in required_from:
            raise ValidationError(
                {"action": f"Cannot '{action_value}' an asset that is '{asset.status}'."}
            )

        counterparty = self._resolve_counterparty(data.get("counterparty"))

        with db_transaction.atomic():
            from_status = asset.status
            tx = Transaction.objects.create(
                asset=asset,
                action=action_value,
                from_status=from_status,
                to_status=to_status,
                actor=request.user,
                counterparty=counterparty,
                job_ref=data.get("job_ref", ""),
                note=data.get("note", ""),
                latitude=data.get("latitude"),
                longitude=data.get("longitude"),
                client_uuid=client_uuid,
            )

            photo = data.get("photo")
            if photo:
                raw = photo.read()
                photo.seek(0)
                TransactionPhoto.objects.create(
                    transaction=tx,
                    image=photo,
                    sha256=hashlib.sha256(raw).hexdigest(),
                )

            # Update the cached projection on the asset.
            asset.status = to_status
            asset.job_ref = data.get("job_ref", "") if to_status in (
                "assigned", "checked_out", "in_transit"
            ) else ""
            if action_value == TxAction.ASSIGN.value:
                asset.assigned_to = counterparty or request.user
            elif to_status == "available":
                asset.assigned_to = None
            asset.save()

        return Response(
            TransactionSerializer(tx, context=self.get_serializer_context()).data,
            status=status.HTTP_201_CREATED,
        )

    def _check_assign_permission(self, request, data):
        if is_manager(request.user):
            return
        # Non-managers may only self-assign, and only if enabled.
        cp = data.get("counterparty")
        self_assign = cp is None or cp == request.user.id
        if not (settings.ALLOW_SELF_ASSIGN and self_assign):
            raise PermissionDenied("Only a manager can assign to someone else.")

    def _resolve_counterparty(self, cp_id):
        if cp_id is None:
            return None
        user = User.objects.filter(pk=cp_id).first()
        if not user:
            raise ValidationError({"counterparty": "No such user."})
        return user


class TagViewSet(viewsets.ModelViewSet):
    queryset = Tag.objects.all().select_related("asset")
    serializer_class = TagSerializer


class UserViewSet(viewsets.ReadOnlyModelViewSet):
    """Read-only user list, used to populate the 'assign to' picker."""

    queryset = User.objects.filter(is_active=True).order_by("username")
    serializer_class = UserBriefSerializer


class TransactionViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = Transaction.objects.all().select_related(
        "asset", "actor", "counterparty"
    ).prefetch_related("photos")
    serializer_class = TransactionSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        asset_id = self.request.query_params.get("asset")
        if asset_id:
            qs = qs.filter(asset_id=asset_id)
        return qs
