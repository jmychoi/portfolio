# Synthetic portfolio sample

Every value, account, symbol, URL, and identifier in this directory is fictional.
The sample contains ten dated portfolio snapshots so both static browser views
can be tested without personal data or network access.

Source files are stored under `sources/<date>/`. Each dated source directory is a
complete aggregator input with deterministic `inputs/config.json`, holdings CSVs,
`cache/fx.csv`, and `cache/yields.csv`.

Regenerate the sample outputs from the repository root:

```powershell
$dates = Get-ChildItem sample\sources -Directory | Sort-Object Name | Select-Object -ExpandProperty Name
foreach ($date in $dates) {
  python aggregate.py "sample\sources\$date" --date $date
  Move-Item -Force "sample\sources\$date\portfolio.json" "sample\$date.json"
}
python history.py sample
```

Open `explorer.html` and select one of the dated JSON files to try Portfolio
Explorer. Open `history.html` and select `sample/history.json` to try History
Explorer.
