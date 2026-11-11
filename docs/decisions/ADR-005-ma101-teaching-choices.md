# ADR-005: MathLab MA-101 teaching conventions

Status: **Accepted 2026-11-11 (GREEN, Godfrey Kariuki)**.

## Decision
- Default standard deviation is the **sample** standard deviation (Excel `STDEV.S`, divide by n−1); population SD (`STDEV.P`) is taught as the named alternative.
- Quartiles follow Excel **`QUARTILE.INC`**.
- Assessment pass mark **75% (3 of 4 items)** for MA-101.
- Numeric answers: exact for whole-number answers; **±0.01** for answers requested to 2 decimal places; learners are told the required rounding.
- Decimal separator is a dot; "3,5" gets a helpful correction message, not a wrong mark.

## Why
Analysts work with samples of sales data in Excel; matching Excel's defaults avoids "the app disagrees with my spreadsheet" confusion.
