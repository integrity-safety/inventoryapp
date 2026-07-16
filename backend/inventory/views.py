from django.contrib.auth import get_user_model
from django.db import transaction as db_transaction
from django.db.models import F, Q
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response

from django.conf import settings

from .models import (
    ALLOWED_TRANSITIONS,
    MANAGER_ACTIONS,
    Asset,
    AssetStatus,
    Job,
    Tag,
    Transaction,
    TxAction,
)
from .serializers import (
    AssetSerializer,
    BulkTransitionSerializer,
    ConsumableSerializer,
    JobSerializer,
    TagSerializer,
    TransactionSerializer,
    TransitionSerializer,
    UserBriefSerializer,
)
from .services import apply_consumable, apply_transition

User = get_user_model()
ACTIVE_STATUSES = [AssetStatus.ASSIGNED, AssetStatus.CHECKED_OUT, AssetStatus.IN_TRANSIT]


def is_manager(user):
    return user.is_staff or user.groups.filter(name="Managers").exists()


def resolve_user(uid):
    if uid in (None, ""):
        return None
    u = User.objects.filter(pk=uid).first()
    if not u:
        raise ValidationError({"counterparty": "No such user."})
    return u


def resolve_job(jid):
    if jid in (None, ""):
        return None
    j = Job.objects.filter(pk=jid).first()
    if not j:
        raise ValidationError({"job": "No such job."})
    return j


class AssetViewSet(viewsets.ModelViewSet):
    queryset = Asset.objects.all().select_related("assigned_to", "job").prefetch_related("tags")
    serializer_class = AssetSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        p = self.request.query_params
        if p.get("status"):
            qs = qs.filter(status=p["status"])
        if p.get("kind"):
            qs = qs.filter(kind=p["kind"])
        if p.get("job"):
            qs = qs.filter(job_id=p["job"])
        if p.get("q"):
            qs = qs.filter(Q(code__icontains=p["q"]) | Q(name__icontains=p["q"]))
        if p.get("overdue") == "true":
            qs = qs.filter(due_at__lt=timezone.now(), status__in=ACTIVE_STATUSES)
        if p.get("low_stock") == "true":
            qs = qs.filter(kind="consumable", min_quantity__gt=0, quantity__lte=F("min_quantity"))
        if p.get("mine") == "pending":
            qs = qs.filter(assigned_to=self.request.user, status=AssetStatus.ASSIGNED)
        elif p.get("mine") == "held":
            qs = qs.filter(assigned_to=self.request.user, status__in=ACTIVE_STATUSES)
        return qs.distinct()

    @action(detail=False, methods=["get"], url_path="by-tag/(?P<uid>[^/]+)")
    def by_tag(self, request, uid=None):
        tag = Tag.objects.select_related("asset").filter(uid=uid).first()
        if not tag:
            return Response({"detail": "No asset for that tag."}, status=status.HTTP_404_NOT_FOUND)
        return Response(AssetSerializer(tag.asset, context=self.get_serializer_context()).data)

    @action(detail=True, methods=["get"])
    def history(self, request, pk=None):
        asset = self.get_object()
        txs = asset.transactions.all().select_related("actor", "counterparty", "job").prefetch_related("photos")
        return Response(TransactionSerializer(txs, many=True, context=self.get_serializer_context()).data)

    @action(detail=True, methods=["post"])
    def transition(self, request, pk=None):
        asset = self.get_object()
        s = TransitionSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        d = s.validated_data

        # Idempotent replay of an offline-queued transition.
        if d.get("client_uuid"):
            existing = Transaction.objects.filter(client_uuid=d["client_uuid"]).first()
            if existing:
                return Response(TransactionSerializer(existing, context=self.get_serializer_context()).data)

        self._authorize(request.user, d["action"], d.get("counterparty"))
        counterparty = resolve_user(d.get("counterparty"))
        job = resolve_job(d.get("job"))

        with db_transaction.atomic():
            tx = apply_transition(
                asset, d["action"], request.user, counterparty=counterparty, job=job,
                job_ref=d.get("job_ref", ""), due_at=d.get("due_at"), note=d.get("note", ""),
                latitude=d.get("latitude"), longitude=d.get("longitude"),
                client_uuid=d.get("client_uuid"), photo=d.get("photo"),
            )
        return Response(
            TransactionSerializer(tx, context=self.get_serializer_context()).data,
            status=status.HTTP_201_CREATED,
        )

    @action(detail=False, methods=["post"], url_path="bulk_transition")
    def bulk_transition(self, request):
        s = BulkTransitionSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        d = s.validated_data
        self._authorize(request.user, d["action"], d.get("counterparty"))
        counterparty = resolve_user(d.get("counterparty"))
        job = resolve_job(d.get("job"))

        results = []
        for aid in d["asset_ids"]:
            asset = Asset.objects.filter(pk=aid).first()
            if not asset:
                results.append({"asset": str(aid), "ok": False, "error": "not found"})
                continue
            try:
                with db_transaction.atomic():
                    apply_transition(
                        asset, d["action"], request.user, counterparty=counterparty, job=job,
                        job_ref=d.get("job_ref", ""), due_at=d.get("due_at"), note=d.get("note", ""),
                    )
                results.append({"asset": asset.code, "ok": True})
            except ValidationError as e:
                results.append({"asset": asset.code, "ok": False, "error": str(e.detail)})
        ok = sum(1 for r in results if r["ok"])
        return Response({"applied": ok, "total": len(results), "results": results})

    @action(detail=True, methods=["post"])
    def consume(self, request, pk=None):
        asset = self.get_object()
        s = ConsumableSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        d = s.validated_data
        if d["action"] == "restock" and not is_manager(request.user):
            raise PermissionDenied("Restocking requires a manager.")
        counterparty = resolve_user(d.get("counterparty"))
        job = resolve_job(d.get("job"))
        with db_transaction.atomic():
            tx = apply_consumable(
                asset, d["action"], request.user, d["quantity"],
                counterparty=counterparty, job=job, note=d.get("note", ""),
            )
        return Response(
            TransactionSerializer(tx, context=self.get_serializer_context()).data,
            status=status.HTTP_201_CREATED,
        )

    @action(detail=False, methods=["get"])
    def summary(self, request):
        """In-app notification feed for the current user."""
        ctx = self.get_serializer_context()
        me = request.user
        mine_pending = Asset.objects.filter(assigned_to=me, status=AssetStatus.ASSIGNED)
        overdue = Asset.objects.filter(due_at__lt=timezone.now(), status__in=ACTIVE_STATUSES)
        low_stock = Asset.objects.filter(kind="consumable", min_quantity__gt=0, quantity__lte=F("min_quantity"))
        data = {
            "my_pending": AssetSerializer(mine_pending, many=True, context=ctx).data,
            "overdue": AssetSerializer(overdue, many=True, context=ctx).data,
            "low_stock": AssetSerializer(low_stock, many=True, context=ctx).data,
        }
        if is_manager(me):
            to_inspect = Asset.objects.filter(status=AssetStatus.RETURNED_PENDING)
            data["to_inspect"] = AssetSerializer(to_inspect, many=True, context=ctx).data
        else:
            data["to_inspect"] = []
        data["counts"] = {k: len(v) for k, v in data.items()}
        return Response(data)

    # --- helpers ---
    def _authorize(self, user, action_value, counterparty):
        if action_value not in ALLOWED_TRANSITIONS:
            raise ValidationError({"action": f"Unknown action '{action_value}'."})
        if action_value in MANAGER_ACTIONS and not is_manager(user):
            raise PermissionDenied("This action requires a manager.")
        if action_value == TxAction.ASSIGN.value and not is_manager(user):
            self_only = counterparty in (None, "", user.id)
            if not (settings.ALLOW_SELF_ASSIGN and self_only):
                raise PermissionDenied("Only a manager can assign to someone else.")


class JobViewSet(viewsets.ModelViewSet):
    queryset = Job.objects.all().select_related("foreman").prefetch_related("assets")
    serializer_class = JobSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        if self.request.query_params.get("status"):
            qs = qs.filter(status=self.request.query_params["status"])
        return qs

    @action(detail=True, methods=["get"])
    def assets(self, request, pk=None):
        job = self.get_object()
        qs = job.assets.all().select_related("assigned_to", "job").prefetch_related("tags")
        return Response(AssetSerializer(qs, many=True, context=self.get_serializer_context()).data)


class TagViewSet(viewsets.ModelViewSet):
    queryset = Tag.objects.all().select_related("asset")
    serializer_class = TagSerializer


class UserViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = User.objects.filter(is_active=True).order_by("username")
    serializer_class = UserBriefSerializer


class TransactionViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = Transaction.objects.all().select_related(
        "asset", "actor", "counterparty", "job"
    ).prefetch_related("photos")
    serializer_class = TransactionSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        if self.request.query_params.get("asset"):
            qs = qs.filter(asset_id=self.request.query_params["asset"])
        return qs
