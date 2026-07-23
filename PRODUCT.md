# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

People with a stake in Singapore's HDB resale market — buyers comparing towns and gauging fair
price-per-square-foot before an offer, sellers pricing a flat against recent nearby sales, and
owners or would-be owners who simply want to understand the market and what their flat is worth.
No single audience is privileged; the four tools intentionally serve this mix equally, so future
work should not optimize one journey at the expense of another.

## Product Purpose

HDB Kaki turns Singapore's public HDB resale transaction data into clear, honest answers about the
market. It exists to make official open data genuinely useful to ordinary people — replacing
guesswork and paywalled estimates with transparent figures anyone can inspect. Success is a visitor
leaving with a confident, well-grounded read on the market or on their own flat's likely value.

## Positioning

Everything is computed in the visitor's browser. The resale dataset is downloaded to the device and
queried locally (parquet via hyparquet), so tools stay fast and private inputs — including the
visitor's postal code — never leave their machine. Combined with being independent, open source, and
built directly on official data.gov.sg figures with no accounts, cookies, or analytics, this is a
stance most neighboring property tools (agent portals, valuation services) could not truthfully copy.

## Operating Context

- Delivered as a static Astro site on Cloudflare Workers (`web/`), replacing the retired Streamlit
  app (`webapp/`, now a migration notice; its `webapp/update/` pipeline still generates the data).
- Four analytical surfaces:
  - **Market Overview** (`/`) — median prices, distributions, and lease dynamics across every resale
    transaction since 2017; SSR hero chart + KPI strip.
  - **Town Analysis** (`/town-analysis`) — maps every recent transaction in a town, banded low / mid /
    high against that town's own median (Leaflet).
  - **PSF Trends** (`/psf-trends`) — fits a trend to price-per-square-foot over time for any town,
    street, storey, or lease band, with projection.
  - **My Flat Insights** (`/my-flat-insights`) — starts from a postal code and values the visitor's
    flat against nearby transactions.
- Supporting pages: About, Privacy, Terms.
- Visitors arrive on desktop or mobile web, often mid-research (comparing listings, deciding on an
  offer or asking price). No login; state is shareable via URL.

## Capabilities and Constraints

- Client-side data querying over a parquet dataset (hyparquet + web worker via comlink); charts with
  ECharts; maps with Leaflet + markercluster; SSR-inlined hero charts for instant paint.
- Data pipeline lives in `webapp/update/`; generated data is not committed, so a fresh checkout
  renders empty charts/forms until data is built.
- All prices and valuations are estimates drawn from past sales — indicative only, never presented
  as official valuations.
- Not affiliated with the Housing & Development Board (HDB) or any government agency.
- The privacy-first / client-side-only architecture (no accounts, no tracking, inputs stay local) is
  the current default and strong positioning, but is not locked: server-side features or optional
  accounts could be introduced later if there is a compelling reason.
- Terminology: "kaki" is Singlish for a buddy/companion; PSF = price per square foot; lease
  banding and remaining-lease dynamics are recurring analytical concepts.

## Brand Commitments

- Name: **HDB Kaki**. Existing marks: `assets/logo.svg` (wordmark) and `logo-icon.svg` (used in nav).
- Voice: plain, honest, unhyped — explains the market "without the guesswork," names its own
  limitations (estimates, not affiliated with HDB), and speaks like a knowledgeable, trustworthy
  friend rather than a marketer.
- Independent, personal, open-source project by Benjamin Dornel; not a company.
- Copy avoids em-dashes in prose (author preference).

## Evidence on Hand

- Primary data: official "Resale flat prices based on registration date from Jan-2017" dataset from
  [data.gov.sg](https://data.gov.sg/datasets/d_8b84c4ee58e3cfc0ece0d773c8ca6abc/view), used under the
  Singapore Open Data Licence v1.0 (attribution required).
- Live app: https://app.hdb-kaki.workers.dev
- Source: https://github.com/benjamin-awd/hdb-kaki (public); feedback via GitHub issues.
- Logo assets in `assets/` and `web/public/`.
- No testimonials, customer logos, pricing, benchmarks, or third-party endorsements exist; future
  work must not fabricate any.

## Product Principles

- **Public data, made genuinely useful.** Every figure traces back to official open data anyone can
  verify; clarity beats spectacle.
- **Honest by default.** State what the numbers are (estimates from past sales) and what they are
  not (official valuations, HDB-affiliated). Never overstate certainty.
- **Serve the whole market fairly.** Buyers, sellers, and curious owners all get first-class tools;
  don't privilege one journey.
- **Fast and private in the browser.** Keep the experience quick and keep private inputs on the
  device unless there is a deliberate, well-justified reason to change that.
- **Independent and open.** No accounts, no tracking, no lock-in; the code stays inspectable.

## Accessibility & Inclusion

Target WCAG 2.1 AA for all surfaces: sufficient color contrast, full keyboard operability
(including charts, maps, and the postal-code flow), meaningful semantics and labels, and respect for
reduced-motion preferences.
