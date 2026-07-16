# v0.6 — managed picklists (Category/Location/Supplier) + expanded Asset fields.
# The category field converts from a free-text CharField to a Category FK. To
# avoid losing existing values, we rename the old text column aside, add the FK,
# copy each distinct string into a Category row, then drop the old column.

import django.db.models.deletion
import uuid
from django.db import migrations, models


def category_text_to_fk(apps, schema_editor):
    Asset = apps.get_model("inventory", "Asset")
    Category = apps.get_model("inventory", "Category")
    for asset in Asset.objects.all():
        name = (asset.category_old or "").strip()
        if not name:
            continue
        cat, _ = Category.objects.get_or_create(name=name)
        asset.category = cat
        asset.save(update_fields=["category"])


def category_fk_to_text(apps, schema_editor):
    # Best-effort reverse: write the category name back into the text column.
    Asset = apps.get_model("inventory", "Asset")
    for asset in Asset.objects.exclude(category__isnull=True):
        asset.category_old = asset.category.name
        asset.save(update_fields=["category_old"])


class Migration(migrations.Migration):

    dependencies = [
        ("inventory", "0002_asset_due_at_asset_kind_asset_min_quantity_and_more"),
    ]

    operations = [
        migrations.CreateModel(
            name="Category",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        default=uuid.uuid4,
                        editable=False,
                        primary_key=True,
                        serialize=False,
                    ),
                ),
                ("name", models.CharField(max_length=100, unique=True)),
                ("archived", models.BooleanField(default=False)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
            ],
            options={
                "verbose_name_plural": "categories",
                "ordering": ["name"],
            },
        ),
        migrations.CreateModel(
            name="Location",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        default=uuid.uuid4,
                        editable=False,
                        primary_key=True,
                        serialize=False,
                    ),
                ),
                ("name", models.CharField(max_length=120, unique=True)),
                (
                    "kind",
                    models.CharField(
                        choices=[
                            ("warehouse", "Warehouse"),
                            ("bin", "Bin / shelf"),
                            ("vehicle", "Truck / vehicle"),
                            ("yard", "Yard"),
                            ("other", "Other"),
                        ],
                        default="warehouse",
                        max_length=16,
                    ),
                ),
                ("note", models.CharField(blank=True, max_length=200)),
                ("archived", models.BooleanField(default=False)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
            ],
            options={
                "ordering": ["name"],
            },
        ),
        migrations.CreateModel(
            name="Supplier",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        default=uuid.uuid4,
                        editable=False,
                        primary_key=True,
                        serialize=False,
                    ),
                ),
                ("name", models.CharField(max_length=150, unique=True)),
                ("contact", models.CharField(blank=True, max_length=150)),
                ("phone", models.CharField(blank=True, max_length=40)),
                ("note", models.CharField(blank=True, max_length=200)),
                ("archived", models.BooleanField(default=False)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
            ],
            options={
                "ordering": ["name"],
            },
        ),
        migrations.AddField(
            model_name="asset",
            name="archived",
            field=models.BooleanField(
                default=False, help_text="Hidden from normal lists; ledger preserved"
            ),
        ),
        migrations.AddField(
            model_name="asset",
            name="manufacturer",
            field=models.CharField(blank=True, max_length=120),
        ),
        migrations.AddField(
            model_name="asset",
            name="max_quantity",
            field=models.IntegerField(
                blank=True,
                help_text="Target / max stock level (consumables)",
                null=True,
            ),
        ),
        migrations.AddField(
            model_name="asset",
            name="model_number",
            field=models.CharField(blank=True, max_length=120),
        ),
        migrations.AddField(
            model_name="asset",
            name="unit_cost",
            field=models.DecimalField(
                blank=True, decimal_places=2, max_digits=12, null=True
            ),
        ),
        migrations.AddField(
            model_name="asset",
            name="unit_of_measure",
            field=models.CharField(
                choices=[
                    ("each", "Each"),
                    ("box", "Box"),
                    ("case", "Case"),
                    ("pack", "Pack"),
                    ("roll", "Roll"),
                    ("foot", "Foot"),
                    ("meter", "Meter"),
                    ("gallon", "Gallon"),
                    ("liter", "Liter"),
                    ("pound", "Pound"),
                    ("kilogram", "Kilogram"),
                    ("set", "Set"),
                ],
                default="each",
                max_length=16,
            ),
        ),
        migrations.AddField(
            model_name="asset",
            name="location",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="assets",
                to="inventory.location",
            ),
        ),
        migrations.AddField(
            model_name="asset",
            name="supplier",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="assets",
                to="inventory.supplier",
            ),
        ),
        # --- category: text -> FK, preserving existing values ---
        migrations.RenameField(
            model_name="asset",
            old_name="category",
            new_name="category_old",
        ),
        migrations.AddField(
            model_name="asset",
            name="category",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="assets",
                to="inventory.category",
            ),
        ),
        migrations.RunPython(category_text_to_fk, category_fk_to_text),
        migrations.RemoveField(
            model_name="asset",
            name="category_old",
        ),
    ]
