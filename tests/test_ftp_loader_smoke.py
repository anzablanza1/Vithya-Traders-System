#!/usr/bin/env python3
"""Offline smoke tests for the Vithya Traders CLI importer (never applies writes)."""
import csv
import json
import pathlib
import subprocess
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
LOADER = ROOT / "hostinger" / "vt_ftp_sync.php"
SCHEMA = ROOT / "hostinger" / "vt_ftp_schema.php"


def run(source_dir, name):
    return subprocess.run(
        ["php", str(LOADER), "--check", "--root=" + str(source_dir), "--file=" + name],
        text=True, capture_output=True
    )


def main():
    script = "$cfg=require '" + str(SCHEMA) + "'; echo json_encode($cfg);"
    specs = json.loads(subprocess.check_output(["php", "-r", script], text=True))
    assert len(specs) == 12
    with tempfile.TemporaryDirectory() as folder:
        root = pathlib.Path(folder)
        for prefix, spec in specs.items():
            name = prefix + "_21024_14112026_020000.csv"
            with (root / name).open("w", newline="") as f:
                csv.writer(f).writerow(spec["columns"])
            p = run(root, name)
            assert p.returncode == 0 and "rows=0" in p.stdout, (prefix, p.stderr)
            assert not (root / (name + ".processed")).exists()
        sales = specs["SalesInvoiceData"]
        name = "SalesInvoiceData_21024_15112026_020000.csv"
        path = root / name
        row = dict.fromkeys(sales["columns"], "")
        row["invoice_id_db_id"] = "123456"
        row["date"] = "15/11/2026"
        with path.open("w", newline="") as f:
            w = csv.DictWriter(f, sales["columns"]); w.writeheader(); w.writerow(row)
        assert run(root, name).returncode == 0
        row["date"] = "31/03/2025"
        with path.open("w", newline="") as f:
            w = csv.DictWriter(f, sales["columns"]); w.writeheader(); w.writerow(row)
        p = run(root, name)
        assert p.returncode != 0 and "Unapproved sales date" in p.stderr
        with path.open("w", newline="") as f:
            csv.writer(f).writerow(sales["columns"][:-1])
        p = run(root, name)
        assert p.returncode != 0 and "Unexpected Vasy columns" in p.stderr
        assert not (root / (name + ".processed")).exists()
    print("PASS: 12 schemas, header-only, valid sales, FY24 reject, header reject, no renames")


if __name__ == "__main__":
    main()
