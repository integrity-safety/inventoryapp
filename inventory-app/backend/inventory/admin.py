from django.contrib import admin

from .models import Asset, Tag, Transaction, TransactionPhoto


class TagInline(admin.TabularInline):
    model = Tag
    extra = 1


class TransactionPhotoInline(admin.TabularInline):
    model = TransactionPhoto
    extra = 0
    readonly_fields = ["sha256", "created_at"]


@admin.register(Asset)
class AssetAdmin(admin.ModelAdmin):
    list_display = ["code", "name", "category", "status", "assigned_to", "job_ref", "updated_at"]
    list_filter = ["status", "category"]
    search_fields = ["code", "name", "description"]
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
