# Synthetic portfolio sample

Every value and identifier in this directory is fictional. The directory exercises
the Wealthsimple, TD Direct Investing, and real-estate parsers without requiring
network access: `inputs/config.json`, `cache/fx.csv`, and `cache/yields.csv` are
deterministic sample inputs and caches.

Regenerate the output from the repository root:

```powershell
python aggregate.py portfolio-sample
```

Open `explorer.html` and select `portfolio-sample/portfolio.json` to try the Explorer.
The sample intentionally uses generic account names; account selection is entirely
data-driven.
