import hashlib

from rest_framework.exceptions import ValidationError

from .models import (
    ALLOWED_TRANSITIONS,
    AssetKind,
    AssetStatus,
    Transaction,
    TransactionPhoto,
    TxAction,
)


def apply_transition(
    asset, action, actor, *, counterparty=None, job=None, job_ref="", due_at=None,
    note="", latitude=None, longitude=None, client_uuid=None, photo=None,
):
    """Apply one serialized-asset state transition, write the ledger record, and
    update the asset's cached projection. Caller wraps in a DB transaction and
    handles permissions. Raises ValidationError on an illegal transition."""
    if action not in ALLOWED_TRANSITIONS:
        raise ValidationError({"action": f"Unknown action '{action}'."})
    required_from, to_status = ALLOWED_TRANSITIONS[action]
    if required_from is not None and asset.status not in required_from:
        raise ValidationError({"action": f"Cannot '{action}' {asset.code}: it is '{asset.status}'."})

    from_status = asset.status
    tx = Transaction.objects.create(
        asset=asset, action=action, from_status=from_status, to_status=to_status,
        actor=actor, counterparty=counterparty, job=job, job_ref=job_ref or "",
        due_at=due_at, note=note or "", latitude=latitude, longitude=longitude,
        client_uuid=client_uuid,
    )
    if photo:
        raw = photo.read()
        photo.seek(0)
        TransactionPhoto.objects.create(
            transaction=tx, image=photo, sha256=hashlib.sha256(raw).hexdigest()
        )

    asset.status = to_status
    if action == TxAction.ASSIGN.value:
        asset.assigned_to = counterparty or actor
        asset.job = job
        asset.job_ref = job_ref or ""
        asset.due_at = due_at
    elif action == TxAction.CONFIRM_CHECKOUT.value:
        if due_at:
            asset.due_at = due_at
    elif to_status == AssetStatus.AVAILABLE:
        asset.assigned_to = None
        asset.job = None
        asset.job_ref = ""
        asset.due_at = None
    asset.save()
    return tx


def apply_consumable(asset, action, actor, quantity, *, counterparty=None, job=None, note=""):
    """Issue (decrement) or restock (increment) a consumable's on-hand quantity."""
    if asset.kind != AssetKind.CONSUMABLE:
        raise ValidationError({"kind": f"{asset.code} is not a consumable."})
    if action == "issue":
        if asset.quantity - quantity < 0:
            raise ValidationError({"quantity": f"Only {asset.quantity} of {asset.code} on hand."})
        delta = -quantity
    else:
        delta = quantity

    tx = Transaction.objects.create(
        asset=asset, action=action, from_status=asset.status, to_status=asset.status,
        actor=actor, counterparty=counterparty, job=job, note=note or "", quantity_delta=delta,
    )
    asset.quantity += delta
    asset.save()
    return tx
