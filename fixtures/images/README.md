# QA image fixtures

- `qa-red.png`, `qa-green.png`, `qa-blue.png`: 48 × 48 RGB PNGs, 123–124 bytes each.
- Generated locally from constant solid colors with Python's `struct`/`zlib`; no external or private source images.
- Intended only for the owned QA Healing Spot image scenario.
- Uploads use the exact checked-in file bytes. The request guard rejects other filenames or content.
