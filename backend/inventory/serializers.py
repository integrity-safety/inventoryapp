from django.contrib.auth import get_user_model
from rest_framework import serializers

from .models import Asset, Tag, Transaction, TransactionPhoto

User = get_user_model()


class UserBriefSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ["id", "username", "first_name", "last_name"]


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
    photos = TransactionPhotoSerializer(many=True, read_only=True)

    class Meta:
        model = Transaction
        fields = [
            "id", "asset", "action", "from_status", "to_status", "actor",
            "counterparty", "job_ref", "note", "latitude", "longitude",
            "client_uuid", "photos", "created_at",
        ]
        read_only_fields = fields


class AssetSerializer(serializers.ModelSerializer):
    assigned_to = UserBriefSerializer(read_only=True)
    tags = TagSerializer(many=True, read_only=True)
    status_display = serializers.CharField(source="get_status_display", read_only=True)

    class Meta:
        model = Asset
        fields = [
            "id", "code", "name", "description", "category", "status",
            "status_display", "assigned_to", "job_ref", "image", "tags",
            "created_at", "updated_at",
        ]
        read_only_fields = ["id", "status", "assigned_to", "created_at", "updated_at"]


class TransitionSerializer(serializers.Serializer):
    """Input for POST /assets/{id}/transition/. A photo may be attached via
    multipart under the key 'photo'."""

    action = serializers.CharField()
    counterparty = serializers.IntegerField(required=False, allow_null=True)
    job_ref = serializers.CharField(required=False, allow_blank=True, default="")
    note = serializers.CharField(required=False, allow_blank=True, default="")
    latitude = serializers.FloatField(required=False, allow_null=True)
    longitude = serializers.FloatField(required=False, allow_null=True)
    client_uuid = serializers.UUIDField(required=False, allow_null=True)
    photo = serializers.ImageField(required=False, allow_null=True)
