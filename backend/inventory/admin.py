from django.contrib import admin

from .models import Asset, Category, Job, Location, Supplier, Tag, Transaction, TransactionPhoto


@admin.register(Category)
class CategoryAdmin(admin.ModelAdmin):
    list_display = ["name", "archived", "created_at"]
    list_filter = ["archived"]
    search_fields = ["name"]


@admin.register(Location)
class LocationAdmin(admin.ModelAdmin):
    list_display = ["name", "kind", "note", "archived", "created_at"]
    list_filter = ["kind", "archived"]
    search_fields = ["name", "note"]


@admin.register(Supplier)
class SupplierAdmin(admin.ModelAdmin):
    list_display = ["name", "contact", "phone", "archived", "created_at"]
    list_filter = ["archived"]
    search_fields = ["name", "contact"]


@admin.register(Job)
class JobAdmin(admin.ModelAdmin):
    list_display = ["code", "name", "site", "status", "foreman", "start_date", "end_date"]
    list_filter = ["status"]
    search_fields = ["code", "name", "site"]


class TagInline(admin.TabularInline):
    model = Tag
    extra = 1


class TransactionPhotoInline(admin.TabularInline):
    model = TransactionPhoto
    extra = 0
    readonly_fields = ["sha256", "created_at"]


@admin.register(Asset)
class AssetAdmin(admin.ModelAdmin):
    list_display = ["code", "name", "kind", "category", "location", "status", "assigned_to", "job", "quantity", "archived", "updated_at"]
    list_filter = ["kind", "status", "category", "location", "archived"]
    search_fields = ["code", "name", "description", "manufacturer", "model_number"]
    autocomplete_fields = ["job", "assigned_to", "category", "location", "supplier"]
    inlines = [TagInline]


@admin.register(Tag)
class TagAdmin(admin.ModelAdmin):
    list_display = ["uid", "tag_type", "asset", "locked", "created_at"]
    list_filter = ["tag_type", "locked"]
    search_fields = ["uid"]


@admin.register(Transaction)
class TransactionAdmin(admin.ModelAdmin):
    list_display = ["created_at", "asset", "action", "from_status", "to_status", "actor", "counterparty"]
    list_filter = ["action", "to_status"]
    search_fields = ["asset__code", "note", "job_ref"]
    readonly_fields = [f.name for f in Transaction._meta.fields]
    inlines = [TransactionPhotoInline]

    def has_add_permission(self, request):
        return False  # Transactions are append-only, created via the API only.

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
