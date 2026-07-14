import uuid

from django.conf import settings
from django.db import models


class AssetStatus(models.TextChoices):
    AVAILABLE = "available", "Available"
    ASSIGNED = "assigned", "Assigned"
    CHECKED_OUT = "checked_out", "Checked out"
    IN_TRANSIT = "in_transit", "In transit"
    RETURNED_PENDING = "returned_pending", "Returned, pending inspection"
    MAINTENANCE = "maintenance", "In maintenance"
    LOST = "lost", "Lost"


class TxAction(models.TextChoices):
    REGISTER = "register", "Register"
    ASSIGN = "assign", "Assign"
    CONFIRM_CHECKOUT = "confirm_checkout", "Confirm checkout"
    CONFIRM_RETURN = "confirm_return", "Confirm return"
    ACCEPT_RETURN = "accept_return", "Accept return"
    TO_MAINTENANCE = "to_maintenance", "Send to maintenance"
    MARK_LOST = "mark_lost", "Mark lost"


class Asset(models.Model):
    """A trackable physical item. Its current status is a cached projection of
    the append-only Transaction ledger."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.CharField(max_length=64, unique=True, help_text="Human-readable asset ID, also printed on the label")
    name = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    category = models.CharField(max_length=100, blank=True)
    status = models.CharField(
        max_length=32, choices=AssetStatus.choices, default=AssetStatus.AVAILABLE
    )
    assigned_to = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="held_assets",
    )
    job_ref = models.CharField(max_length=120, blank=True, help_text="Current job/project the asset is out on")
    image = models.ImageField(upload_to="assets/", null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["code"]

    def __str__(self):
        return f"{self.code} - {self.name}"


class Tag(models.Model):
    """A physical tag bound to an asset. One asset can carry several (an NFC
    chip plus a printed QR/barcode on the same combo label)."""

    class TagType(models.TextChoices):
        NFC = "nfc", "NFC"
        QR = "qr", "QR code"
        BARCODE = "barcode", "Barcode"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    asset = models.ForeignKey(Asset, on_delete=models.CASCADE, related_name="tags")
    tag_type = models.CharField(max_length=16, choices=TagType.choices, default=TagType.NFC)
    uid = models.CharField(
        max_length=128,
        unique=True,
        help_text="NFC chip UID, or the payload printed/encoded on the tag (URL, code)",
    )
    locked = models.BooleanField(default=False, help_text="Tag has been write-locked in the field")
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.get_tag_type_display()}:{self.uid}"


class Transaction(models.Model):
    """Immutable, append-only record of a single state change. Never edited or
    deleted. This is the audit trail / chain of custody."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    asset = models.ForeignKey(Asset, on_delete=models.CASCADE, related_name="transactions")
    action = models.CharField(max_length=32, choices=TxAction.choices)
    from_status = models.CharField(max_length=32, choices=AssetStatus.choices, blank=True)
    to_status = models.CharField(max_length=32, choices=AssetStatus.choices)
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="tx_performed"
    )
    counterparty = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="tx_counterparty",
        help_text="The other party in a two-factor handoff",
    )
    job_ref = models.CharField(max_length=120, blank=True)
    note = models.TextField(blank=True)
    latitude = models.FloatField(null=True, blank=True)
    longitude = models.FloatField(null=True, blank=True)
    # Client-generated UUID makes offline sync idempotent: replaying a queued
    # transaction with the same key is a no-op instead of a duplicate.
    client_uuid = models.UUIDField(unique=True, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.asset.code} {self.action} @ {self.created_at:%Y-%m-%d %H:%M}"


def photo_upload_path(instance, filename):
    return f"tx/{instance.transaction.asset_id}/{instance.transaction_id}/{filename}"


class TransactionPhoto(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    transaction = models.ForeignKey(Transaction, on_delete=models.CASCADE, related_name="photos")
    image = models.ImageField(upload_to=photo_upload_path)
    sha256 = models.CharField(max_length=64, blank=True, help_text="Hash of the image bytes for tamper-evidence")
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"photo for {self.transaction_id}"


# --- State machine -----------------------------------------------------------
# Allowed (action -> (required_from_statuses, resulting_status)). A transition
# is rejected unless the asset's current status is in required_from_statuses.

ALLOWED_TRANSITIONS = {
    TxAction.REGISTER: (None, AssetStatus.AVAILABLE),
    TxAction.ASSIGN: ({AssetStatus.AVAILABLE}, AssetStatus.ASSIGNED),
    TxAction.CONFIRM_CHECKOUT: ({AssetStatus.ASSIGNED}, AssetStatus.CHECKED_OUT),
    TxAction.CONFIRM_RETURN: ({AssetStatus.CHECKED_OUT, AssetStatus.IN_TRANSIT}, AssetStatus.RETURNED_PENDING),
    TxAction.ACCEPT_RETURN: ({AssetStatus.RETURNED_PENDING}, AssetStatus.AVAILABLE),
    TxAction.TO_MAINTENANCE: (
        {AssetStatus.AVAILABLE, AssetStatus.RETURNED_PENDING, AssetStatus.CHECKED_OUT},
        AssetStatus.MAINTENANCE,
    ),
    TxAction.MARK_LOST: (None, AssetStatus.LOST),
}

# Actions that require a manager (staff or member of the "Managers" group).
MANAGER_ACTIONS = {TxAction.ACCEPT_RETURN, TxAction.TO_MAINTENANCE, TxAction.MARK_LOST}
