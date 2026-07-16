"""Seed a realistic demo dataset so the dashboard looks like a real warehouse.

Render's free tier has no shell, so this runs from build.sh during deploy, gated
on the SEED_DEMO env var (same pattern as the superuser bootstrap). It is
idempotent: it only seeds when the demo data is absent.

    python manage.py seed_demo           # seed once (no-op if already seeded)
    python manage.py seed_demo --reset   # wipe demo data, then seed fresh
    python manage.py seed_demo --wipe     # remove demo data and stop

Demo rows are identifiable by convention so --wipe can find them cleanly:
  - serialized assets  code AST-####
  - consumables        code CON-####
  - jobs               code JOB-1##
  - field users        usernames mike / sara / carlos / dana
Managed picklist entries (categories/locations/suppliers) are left in place on a
wipe since they are harmless and you may have started using them for real items.
"""
import random
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand
from django.db import transaction as db_tx
from django.utils import timezone

from inventory.models import (
    Asset,
    AssetKind,
    AssetStatus,
    Category,
    Job,
    Location,
    Supplier,
    TxAction,
)
from inventory.services import apply_transition

User = get_user_model()

DEMO_PASSWORD = "test1234!"

FIELD_USERS = [
    ("mike", "Mike", "Alvarez"),
    ("sara", "Sara", "Chen"),
    ("carlos", "Carlos", "Diaz"),
    ("dana", "Dana", "Okafor"),
]

LOCATIONS = [
    ("Main Warehouse", "warehouse"),
    ("Yard", "yard"),
    ("Truck 1", "vehicle"),
    ("Truck 2", "vehicle"),
    ("Bin A1", "bin"),
    ("Bin B3", "bin"),
]

SUPPLIERS = ["Grainger", "Home Depot Pro", "Fastenal", "Milwaukee Direct"]

JOBS = [
    ("JOB-101", "North Ave Substation", "North Ave"),
    ("JOB-102", "Riverside Retrofit", "Riverside"),
    ("JOB-103", "Downtown Tower", "5th & Main"),
    ("JOB-104", "Airport Hangar", "Terminal C"),
]

# 24 serialized tools: (name, category, manufacturer, model, unit_cost)
TOOLS = [
    ("Impact driver", "Power Tools", "DeWalt", "DCF887", "199.00"),
    ("Hammer drill", "Power Tools", "Milwaukee", "2804-20", "229.00"),
    ("Angle grinder", "Power Tools", "Makita", "GA4530", "89.00"),
    ("Reciprocating saw", "Power Tools", "Milwaukee", "2821-20", "279.00"),
    ("Circular saw", "Power Tools", "DeWalt", "DCS570", "179.00"),
    ("Rotary hammer", "Power Tools", "Bosch", "RH328VC", "349.00"),
    ("Cordless drill", "Power Tools", "DeWalt", "DCD791", "159.00"),
    ("Heat gun", "Power Tools", "Milwaukee", "8988-20", "129.00"),
    ("Pipe wrench 18in", "Hand Tools", "Ridgid", "31025", "59.00"),
    ("Torque wrench", "Hand Tools", "Tekton", "24340", "79.00"),
    ("Bolt cutter 24in", "Hand Tools", "Klein", "63324", "69.00"),
    ("Socket set 90pc", "Hand Tools", "Craftsman", "CMMT12024", "119.00"),
    ("Step ladder 8ft", "Ladders & Access", "Werner", "6208", "149.00"),
    ("Extension ladder 24ft", "Ladders & Access", "Werner", "D1224-2", "299.00"),
    ("Scaffold section", "Ladders & Access", "MetalTech", "I-CISC", "199.00"),
    ("Fall arrest harness", "Safety", "3M", "1161500", "159.00"),
    ("Gas detector", "Safety", "MSA", "Altair 4XR", "699.00"),
    ("Arc flash kit 40cal", "Safety", "Salisbury", "SK40", "899.00"),
    ("Multimeter", "Test Equipment", "Fluke", "87V", "429.00"),
    ("Clamp meter", "Test Equipment", "Fluke", "376 FC", "489.00"),
    ("Thermal camera", "Test Equipment", "FLIR", "E8-XT", "1999.00"),
    ("Insulation tester", "Test Equipment", "Megger", "MIT430", "1299.00"),
    ("Laser level", "Test Equipment", "Bosch", "GLL3-330CG", "599.00"),
    ("Cable tester", "Test Equipment", "Klein", "VDV501-852", "199.00"),
]

# 6 consumables: (name, uom, quantity, min_quantity, max_quantity, category, supplier)
CONSUMABLES = [
    ("Nitrile gloves", "box", 3, 10, 60, "Safety", "Grainger"),          # low
    ("Foam ear plugs", "box", 8, 12, 50, "Safety", "Grainger"),          # low
    ("Zip ties 8in", "pack", 40, 20, 100, "Fasteners", "Fastenal"),
    ("Wire nuts assorted", "box", 5, 8, 40, "Fasteners", "Fastenal"),    # low
    ("Titanium drill bits", "set", 2, 3, 10, "Power Tools", "Home Depot Pro"),  # low
    ("Marking paint", "case", 15, 6, 30, "Safety", "Grainger"),
]


class Command(BaseCommand):
    help = "Seed realistic demo inventory data (idempotent). See module docstring."

    def add_arguments(self, parser):
        parser.add_argument("--wipe", action="store_true", help="Remove demo data and stop.")
        parser.add_argument("--reset", action="store_true", help="Wipe demo data, then seed fresh.")

    def handle(self, *args, **opts):
        if opts["wipe"] or opts["reset"]:
            self._wipe()
            if opts["wipe"]:
                self.stdout.write(self.style.SUCCESS("Demo data removed."))
                return

        if Asset.objects.filter(code__startswith="AST-").exists():
            self.stdout.write("Demo data already present; skipping. Use --reset to rebuild.")
            return

        random.seed(1183)  # deterministic spread across runs
        with db_tx.atomic():
            self._seed()
        self.stdout.write(self.style.SUCCESS(
            f"Seeded demo data: {Asset.objects.filter(code__startswith='AST-').count()} tools, "
            f"{Asset.objects.filter(code__startswith='CON-').count()} consumables, "
            f"{Job.objects.filter(code__startswith='JOB-1').count()} jobs, "
            f"{len(FIELD_USERS)} field users (password '{DEMO_PASSWORD}')."
        ))

    # ------------------------------------------------------------------
    def _wipe(self):
        Asset.objects.filter(code__startswith="AST-").delete()
        Asset.objects.filter(code__startswith="CON-").delete()
        Job.objects.filter(code__startswith="JOB-1").delete()
        User.objects.filter(username__in=[u[0] for u in FIELD_USERS]).delete()

    def _seed(self):
        now = timezone.now()

        # Manager to act as the actor on seeded transitions. Prefer a real one
        # (the env-created superuser); fall back to a demo manager.
        manager = (
            User.objects.filter(is_staff=True).first()
            or User.objects.filter(groups__name="Managers").first()
        )
        if not manager:
            manager = User.objects.create_user("demo_manager", password=DEMO_PASSWORD, is_staff=True)

        # Field users (non-managers) for the two-party checkout flow.
        crew = []
        for username, first, last in FIELD_USERS:
            u, created = User.objects.get_or_create(
                username=username, defaults={"first_name": first, "last_name": last}
            )
            if created:
                u.set_password(DEMO_PASSWORD)
                u.first_name, u.last_name, u.is_staff = first, last, False
                u.save()
            crew.append(u)

        cats = {name: Category.objects.get_or_create(name=name)[0]
                for name in {t[1] for t in TOOLS} | {c[5] for c in CONSUMABLES} | {"Fasteners"}}
        locs = [Location.objects.get_or_create(name=n, defaults={"kind": k})[0] for n, k in LOCATIONS]
        sups = {name: Supplier.objects.get_or_create(name=name)[0] for name in SUPPLIERS}

        jobs = [Job.objects.get_or_create(
            code=code, defaults={"name": name, "site": site, "status": "active"}
        )[0] for code, name, site in JOBS]

        # Build the 24 tools.
        tools = []
        for i, (name, cat, mfr, model, cost) in enumerate(TOOLS, start=1):
            tools.append(Asset.objects.create(
                code=f"AST-{i:04d}", name=name, kind=AssetKind.SERIALIZED,
                category=cats[cat], location=random.choice(locs),
                supplier=random.choice(list(sups.values())),
                manufacturer=mfr, model_number=model, unit_cost=cost,
                description=f"{mfr} {model}",
            ))

        # State spread over the 24 tools:
        #   0-5  assigned (0-2 overdue)   6-11 checked out (6-8 overdue)
        #   12-14 returned pending        15-17 in maintenance
        #   18-23 available (left as-is)
        def past():
            return now - timedelta(days=random.randint(2, 12))

        def future():
            return now + timedelta(days=random.randint(3, 21))

        for idx in range(0, 6):        # assigned
            a = tools[idx]
            due = past() if idx < 3 else future()
            apply_transition(a, TxAction.ASSIGN.value, manager,
                             counterparty=crew[idx % len(crew)], job=random.choice(jobs), due_at=due)

        for idx in range(6, 12):       # checked out (assign, then the field user confirms)
            a = tools[idx]
            fu = crew[idx % len(crew)]
            due = past() if idx < 9 else future()
            apply_transition(a, TxAction.ASSIGN.value, manager, counterparty=fu, job=random.choice(jobs), due_at=due)
            apply_transition(a, TxAction.CONFIRM_CHECKOUT.value, fu)

        for idx in range(12, 15):      # returned, pending inspection
            a = tools[idx]
            fu = crew[idx % len(crew)]
            apply_transition(a, TxAction.ASSIGN.value, manager, counterparty=fu, job=random.choice(jobs), due_at=future())
            apply_transition(a, TxAction.CONFIRM_CHECKOUT.value, fu)
            apply_transition(a, TxAction.CONFIRM_RETURN.value, fu, note="Returned from job")

        for idx in range(15, 18):      # in maintenance
            apply_transition(tools[idx], TxAction.TO_MAINTENANCE.value, manager, note="Scheduled service")

        # 6 consumables (all 'available'; 4 sit at or below their reorder point).
        for i, (name, uom, qty, minq, maxq, cat, sup) in enumerate(CONSUMABLES, start=1):
            Asset.objects.create(
                code=f"CON-{i:04d}", name=name, kind=AssetKind.CONSUMABLE,
                category=cats[cat], location=locs[0], supplier=sups[sup],
                unit_of_measure=uom, quantity=qty, min_quantity=minq, max_quantity=maxq,
            )
