# Portfolio aggregator

Aggregate Wealthsimple, TD Direct Investing, and manually maintained real-estate
CSV files into a single asset-level portfolio dataset.

Detailed requirements are maintained in `specs/aggregator-specs.txt` and
`specs/explorer-specs.txt`.

`portfolio-sample/` is a fully synthetic, network-independent example containing
all supported input formats, deterministic FX/yield caches, and generated output.
Private dated portfolio directories match the repository's `.gitignore` rule and
must not be committed.

## Run

```powershell
python -m pip install -r aggregator/requirements.txt
python aggregate.py portfolio-sample
```

Exactly one portfolio directory is required. The default output is
`<portfolio-directory>/portfolio.csv`; use `--output another-name.csv` to change
the filename within that directory.

Raw source CSVs must be placed in the required `<portfolio-directory>/inputs/`
subdirectory. The aggregator scans that directory non-recursively and never writes
to it. Managed `fx.csv` and generated output files remain at the portfolio root.
Every `inputs/` directory must also contain `config.json`. It defines the account
columns, allowed classifications, Wealthsimple mappings, TD accounts, and market
asset metadata. This keeps private identifiers and portfolio-specific rules out of
the application source.

On the first run, the aggregator fetches the latest USD/CAD daily average from the
Bank of Canada and atomically creates `<portfolio-directory>/fx.csv`. Later runs
reuse that file for reproducibility. Delete `fx.csv` when you intentionally want
to fetch a new rate.

The first run also uses `yfinance` to create `<portfolio-directory>/yields.csv`
for every stock and ETF. It annualizes the latest distribution using the number
of positive distributions observed during the previous year. Cached rows are
reused; delete `yields.csv` to refresh every asset, or delete an individual row
to retry only that asset. For a symbol correction, edit `Provider Symbol` and set
`Status` to `refresh`. Unknown yields remain blank rather than becoming zero.

The output always includes `CASH-CAD` and `CASH-USD`. TD account mappings and one
immutable Type/Market/Sector/Risk metadata record per asset are loaded from the
portfolio's `inputs/config.json`. Real-estate Market, Risk, Currency, Value, and
Net Monthly Income and optional URL come directly from `inputs/real-estates.csv`; real-estate yield
is calculated as annual net income divided by property value. Cash yield is always
zero. `Projected Annual Income` applies each asset's yield to its CAD total. A new
CSV format can be added by
implementing the parser interface in `aggregator/parsers/` and registering
it in that package's `PARSERS` tuple.

Rows are ordered by the unrounded `% Holding` value in descending order, with the
asset identifier as the tie-breaker. The general identifier column is named `Asset`.
Monetary, yield, and percentage output fields are formatted to exactly two decimal
places; `FX Rate CAD` preserves the configured Decimal precision. Sorting uses the
unrounded internal percentage. Summary rows and other presentation concerns are left
to downstream tools.

## Test

```powershell
python -m unittest discover -s tests -v
```

## Portfolio Explorer

The dependency-free visualizer runs entirely in the browser. Double-click
`explorer.html`, then choose or drag an aggregator-generated `portfolio.csv` into
the page. The file is read locally and is not uploaded or transmitted.

All accounts are selected initially. `Select all`, `Clear all`, and individual
account controls update the portfolio dynamically. `Group by` defaults to `None`,
which shows assets in the table and groups the pie chart by Sector. Selecting
another grouping applies it to both views. The table and pie chart are always shown
together and stack on narrow screens.

Click a table heading to sort; Shift-click additional headings for multi-column
sorting. A sticky `TOTAL` footer remains visible below the sortable rows and
recalculates with the current account selection and grouping. Monetary values are
displayed as whole dollars, while percentages and FX rates retain useful decimal
precision.

Dark mode is enabled by default. Forest (the original green palette), Ocean,
Aubergine, and Amber color schemes can be selected independently of light/dark
mode. Both preferences are saved when browser storage is available. The dashboard
has no desktop maximum width, and the table viewport scales with browser height.
After a CSV is loaded, the dashboard fits within the browser viewport and uses
panel-level scrolling for overflow instead of extending the page. The launch panel
disappears; use `Open another CSV` in the header to
replace the file. A read-only FX table below the pie chart shows the explicit CAD
conversion rates from the source CSV.
Stock and ETF asset names link to Yahoo Finance using their cached provider symbols;
real-estate names use their optional input URLs. Cash remains plain text.

### Dynamic calculations

The explorer ignores the CSV's displayed `Total`, `Total CAD`, `% Holding`, and
`Projected Annual Income` values. It reads `FX Rate CAD` directly for conversion.

For the selected accounts it recalculates:

```text
Total = sum of selected account values
Total CAD = Total x FX Rate CAD
% Holding = Total CAD / selected portfolio Total CAD x 100
Projected Annual Income = Total CAD x Yield / 100
```

Grouped yield is weighted by selected CAD market value. Grouped projected income
is the sum of the selected assets' projected income.

### Explorer tests

The data model uses Node's built-in test runner and has no npm dependencies:

```powershell
node --test tests\model.test.js
```
