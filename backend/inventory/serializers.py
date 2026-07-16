from django.contrib.auth import get_user_model
from rest_framework import serializers

from .models import Asset, Job, Tag, Transaction, TransactionPhoto

User = get_user_model()


class UserBriefSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ["id", "username", "first_name", "last_name"]


class JobSerializer(serializers.ModelSerializer):
    foreman = UserBriefSerializer(read_only=True)
    foreman_id = serializers.PrimaryKeyRelatedField(
        source="foreman", queryset=User.objects.all(), required=False, allow_null=True, write_only=True
    )
    asset_count = serializers.IntegerField(source="assets.count", read_only=True)

    class Meta:
        model = Job
        fields = [
            "id", "code", "name", "site", "status", "foreman", "foreman_id",
            "start_date", "end_date", "asset_count", "created_at",
        ]
        read_only_fields = ["id", "created_at"]


class JobBriefSerializer(serializers.ModelSerializer):
    class Meta:
        model = Job
        fields = ["id", "code", "name"]


class TagSerializer(serializers.ModelSerializer):
    class Meta:
        model = Tag
        fields = ["id", "asset", "tag_type", "uid", "locked", "created_at"]
        read_only_fields = ["id", "created_at"]


class TransactionPhotoSerializer(serializers.ModelSerializer):
    class Meta:
        model = TransactionPhoto
        fields = ["id", "image", "sha256", "created_at"]
        read_only_fields = fields


class TransactionSerializer(serializers.ModelSerializer):
    actor = UserBriefSerializer(read_only=True)
    counterparty = UserBriefSerializer(read_only=True)
    job = JobBriefSerializer(read_only=True)
    photos = TransactionPhotoSerializer(many=True, read_only=True)

    class Meta:
        model = Transaction
        fields = [
            "id", "asset", "action", "from_status", "to_status", "actor",
            "counterparty", "job", "job_ref", "due_at", "quantity_delta",
            "note", "latitude", "longitude", "client_uuid", "photos", "created_at",
        ]
        read_only_fields = fields


class AssetSerializer(serializers.ModelSerializer):
    assigned_to = UserBriefSerializer(read_only=True)
    job = JobBriefSerializer(read_only=True)
    tags = TagSerializer(many=True, read_only=True)
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    is_overdue = serializers.BooleanField(read_only=True)
    low_stock = serializers.BooleanField(read_only=True)

    class Meta:
        model = Asset
        fields = [
            "id", "code", "name", "description", "category", "kind", "status",
            "status_display", "assigned_to", "job", "job_ref", "due_at",
            "quantity", "min_quantity", "low_stock", "is_overdue", "image",
            "tags", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "status", "assigned_to", "job", "due_at", "is_overdue", "low_stock", "created_at", "updated_at"]


class TransitionSerializer(serializers.Serializer):
    """Input for a single-asset transition (POST .../transition/). Photo may be
    attached via multipart under 'photo'."""

    action = serializers.CharField()
    counterparty = serializers.IntegerField(required=False, allow_null=True)
    job = serializers.UUIDField(required=False, allow_null=True)
    job_ref = serializers.CharField(required=False, allow_blank=True, default="")
    due_at = serializers.DateTimeField(required=False, allow_null=True)
    note = serializers.CharField(required=False, allow_blank=True, default="")
    latitude = serializers.FloatField(required=False, allow_null=True)
    longitude = serializers.FloatField(required=False, allow_null=True)
    client_uuid = serializers.UUIDField(required=False, allow_null=True)
    photo = serializers.ImageField(required=False, allow_null=True)


class BulkTransitionSerializer(serializers.Serializer):
    """Group action across many assets (POST /assets/bulk_transition/)."""

    asset_ids = serializers.ListField(child=serializers.UUIDField(), allow_empty=False)
    action = serializers.CharField()
    counterparty = serializers.IntegerField(required=False, allow_null=True)
    job = serializers.UUIDField(required=False, allow_null=True)
    job_ref = serializers.CharField(required=False, allow_blank=True, default="")
    due_at = serializers.DateTimeField(required=False, allow_null=True)
    note = serializers.CharField(required=False, allow_blank=True, default="")


class ConsumableSerializer(serializers.Serializer):
    """Issue or restock a consumable (POST .../consume/)."""

    action = serializers.ChoiceField(choices=["issue", "restock"])
    quantity = serializers.IntegerField(min_value=1)
    counterparty = serializers.IntegerField(required=False, allow_null=True)
    job = serializers.UUIDField(required=False, allow_null=True)
    note = serializers.CharField(required=False, allow_blank=True, default="")
