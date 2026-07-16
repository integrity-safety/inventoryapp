import uuid

from django.conf import settings
from django.db import models
from django.utils import timezone


class AssetStatus(models.TextChoices):
    AVAILABLE = "available", "Available"
    ASSIGNED = "assigned", "Assigned"
    CHECKED_OUT = "checked_out", "Checked out"
    IN_TRANSIT = "in_transit", "In transit"
    RETURNED_PENDING = "returned_pending", "Returned, pending inspection"
    MAINTENANCE = "maintenance", "In maintenance"
    LOST = "lost", "Lost"


class AssetKind(models.TextChoices):
    SERIALIZED = "serialized", "Serialized (tracked individually)"
    CONSUMABLE = "consumable", "Consumable (tracked by quantity)"


class UnitOfMeasure(models.TextChoices):
    """How a consumable is counted. Serialized assets are always 'each'."""
    EACH = "each", "Each"
    BOX = "box", "Box"
    CASE = "case", "Case"
    PACK = "pack", "Pack"
    ROLL = "roll", "Roll"
    FOOT = "foot", "Foot"
    METER = "meter", "Meter"
    GALLON = "gallon", "Gallon"
    LITER = "liter", "Liter"
    POUND = "pound", "Pound"
    KILOGRAM = "kilogram", "Kilogram"
    SET = "set", "Set"


class TxAction(models.TextChoices):
    REGISTER = "register", "Register"
    ASSIGN = "assign", "Assign"
    CONFIRM_CHECKOUT = "confirm_checkout", "Confirm checkout"
    CONFIRM_RETURN = "confirm_return", "Confirm return"
    ACCEPT_RETURN = "accept_return", "Accept return"
    TO_MAINTENANCE = "to_maintenance", "Send to maintenance"
    MARK_LOST = "mark_lost", "Mark lost"
    ISSUE = "issue", "Issue (consumable)"
    RESTOCK = "restock", "Restock (consumable)"


class Job(models.Model):
    """A job / project / cost code that assets get allocated to."""

    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        CLOSED = "closed", "Closed"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.CharField(max_length=64, unique=True, help_text="Job/project code, e.g. JOB-42")
    name = models.CharField(max_length=200)
    site = models.CharField(max_length=200, blank=True, help_text="Jobsite / location")
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.ACTIVE)
    foreman = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="jobs"
    )
    start_date = models.DateField(null=True, blank=True)
    end_date = models.DateField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-status", "code"]

    def __str__(self):
        return f"{self.code} - {self.name}"


class Category(models.Model):
    """Managed classification picklist (e.g. Power Tools, Fasteners, Safety)."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=100, unique=True)
    archived = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name"]
        verbose_name_plural = "categories"

    def __str__(self):
        return self.name


class Location(models.Model):
    """Where an item physically lives: a warehouse, bin, shelf, or vehicle.
    Distinct from Job, which is where an item has been allocated to work."""

    class Kind(models.TextChoices):
        WAREHOUSE = "warehouse", "Warehouse"
        BIN = "bin", "Bin / shelf"
        VEHICLE = "vehicle", "Truck / vehicle"
        YARD = "yard", "Yard"
        OTHER = "other", "Other"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=120, unique=True)
    kind = models.CharField(max_length=16, choices=Kind.choices, default=Kind.WAREHOUSE)
    note = models.CharField(max_length=200, blank=True)
    archived = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class Supplier(models.Model):
    """A vendor items are bought from."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=150, unique=True)
    contact = models.CharField(max_length=150, blank=True)
    phone = models.CharField(max_length=40, blank=True)
    note = models.CharField(max_length=200, blank=True)
    archived = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class Asset(models.Model):
    """A trackable item. Serialized assets move through the custody state
    machine; consumables are tracked by on-hand quantity."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.CharField(max_length=64, unique=True, help_text="Human-readable asset ID, also printed on the label")
    name = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    category = models.ForeignKey(
        Category, null=True, blank=True, on_delete=models.SET_NULL, related_name="assets"
    )
    kind = models.CharField(max_length=16, choices=AssetKind.choices, default=AssetKind.SERIALIZED)

    status = models.CharField(
        max_length=32, choices=AssetStatus.choices, default=AssetStatus.AVAILABLE
    )
    assigned_to = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="held_assets"
    )
    job = models.ForeignKey(Job, null=True, blank=True, on_delete=models.SET_NULL, related_name="assets")
    job_ref = models.CharField(max_length=120, blank=True, help_text="Free-text job note (legacy / when no Job record)")
    due_at = models.DateTimeField(null=True, blank=True, help_text="When the current checkout is due back")

    # Where the item physically lives (warehouse/bin/truck), and who it's from.
    location = models.ForeignKey(
        Location, null=True, blank=True, on_delete=models.SET_NULL, related_name="assets"
    )
    supplier = models.ForeignKey(
        Supplier, null=True, blank=True, on_delete=models.SET_NULL, related_name="assets"
    )
    manufacturer = models.CharField(max_length=120, blank=True)
    model_number = models.CharField(max_length=120, blank=True)
    unit_cost = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)

    # Consumable-only fields.
    unit_of_measure = models.CharField(
        max_length=16, choices=UnitOfMeasure.choices, default=UnitOfMeasure.EACH
    )
    quantity = models.IntegerField(default=1, help_text="On-hand quantity (consumables)")
    min_quantity = models.IntegerField(default=0, help_text="Reorder point; low stock at or below this (consumables)")
    max_quantity = models.IntegerField(null=True, blank=True, help_text="Target / max stock level (consumables)")

    archived = models.BooleanField(default=False, help_text="Hidden from normal lists; ledger preserved")

    image = models.ImageField(upload_to="assets/", null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["code"]

    def __str__(self):
        return f"{self.code} - {self.name}"

    @property
    def is_overdue(self):
        return bool(
            self.due_at
            and self.status in (AssetStatus.ASSIGNED, AssetStatus.CHECKED_OUT, AssetStatus.IN_TRANSIT)
            and self.due_at < timezone.now()
        )

    @property
    def low_stock(self):
        return self.kind == AssetKind.CONSUMABLE and self.min_quantity > 0 and self.quantity <= self.min_quantity


class Tag(models.Model):
    """A physical tag bound to an asset (NFC chip and/or printed QR/barcode)."""

    class TagType(models.TextChoices):
        NFC = "nfc", "NFC"
        QR = "qr", "QR code"
        BARCODE = "barcode", "Barcode"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    asset = models.ForeignKey(Asset, on_delete=models.CASCADE, related_name="tags")
    tag_type = models.CharField(max_length=16, choices=TagType.choices, default=TagType.NFC)
    uid = models.CharField(max_length=128, unique=True, help_text="NFC chip UID or encoded payload")
    locked = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.get_tag_type_display()}:{self.uid}"


class Transaction(models.Model):
    """Immutable, append-only record of a single change. Never edited."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    asset = models.ForeignKey(Asset, on_delete=models.CASCADE, related_name="transactions")
    action = models.CharField(max_length=32, choices=TxAction.choices)
    from_status = models.CharField(max_length=32, choices=AssetStatus.choices, blank=True)
    to_status = models.CharField(max_length=32, choices=AssetStatus.choices, blank=True)
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="tx_performed"
    )
    counterparty = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="tx_counterparty"
    )
    job = models.ForeignKey(Job, null=True, blank=True, on_delete=models.SET_NULL, related_name="transactions")
    job_ref = models.CharField(max_length=120, blank=True)
    due_at = models.DateTimeField(null=True, blank=True)
    quantity_delta = models.IntegerField(null=True, blank=True, help_text="Consumable change (+restock / -issue)")
    note = models.TextField(blank=True)
    latitude = models.FloatField(null=True, blank=True)
    longitude = models.FloatField(null=True, blank=True)
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
    sha256 = models.CharField(max_length=64, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"photo for {self.transaction_id}"


# --- State machine (serialized assets) ---------------------------------------
# action -> (required_from_statuses or None, resulting_status)

ALLOWED_TRANSITIONS = {
    TxAction.REGISTER: (None, AssetStatus.AVAILABLE),
    TxAction.ASSIGN: ({AssetStatus.AVAILABLE}, AssetStatus.ASSIGNED),
    TxAction.CONFIRM_CHECKOUT: ({AssetStatus.ASSIGNED}, AssetStatus.CHECKED_OUT),
    TxAction.CONFIRM_RETURN: ({AssetStatus.CHECKED_OUT, AssetStatus.IN_TRANSIT}, AssetStatus.RETURNED_PENDING),
    TxAction.ACCEPT_RETURN: ({AssetStatus.RETURNED_PENDING}, AssetStatus.AVAILABLE),
    TxAction.TO_MAINTENANCE: (
        {AssetStatus.AVAILABLE, AssetStatus.RETURNED_PENDING, AssetStatus.CHECKED_OUT, AssetStatus.MAINTENANCE},
        AssetStatus.MAINTENANCE,
    ),
    TxAction.MARK_LOST: (None, AssetStatus.LOST),
}

# Actions restricted to managers (staff or "Managers" group).
MANAGER_ACTIONS = {TxAction.ACCEPT_RETURN, TxAction.TO_MAINTENANCE, TxAction.MARK_LOST, TxAction.RESTOCK}
