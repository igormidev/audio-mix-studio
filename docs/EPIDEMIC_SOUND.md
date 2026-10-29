# Epidemic Sound integration

Documentation and public catalog verified on **2026-10-29**. The integration uses each person's **MCP Server API key** and Epidemic Sound subscription in this local desktop app.

## Which API key works

Epidemic Sound has two separate products. Their keys are not interchangeable:

| Product             | Credential                              | Endpoint                                          | Intended use                                                         |
| ------------------- | --------------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------- |
| Personal MCP server | Account → API keys → MCP Server API key | `https://www.epidemicsound.com/a/mcp-service/mcp` | A local client accessing the account holder's subscription           |
| Developer API       | Developer Portal API key                | `https://api.epidemicsound.com`                   | Partner/product integrations with their own content-access agreement |

The [official MCP documentation](https://developers.epidemicsound.com/docs/mcp/) permits custom local clients to use account keys. Its OAuth flow is restricted to established clients' redirect URIs, so it is not a substitute for an account key in this app. Keys expire after one year. Create or rotate one on [Account → API keys](https://www.epidemicsound.com/account/api-keys).

The [Developer API getting-started guide](https://developers.epidemicsound.com/docs/getting-started/) describes the separate developer credential. The [free-tier guide](https://www.epidemicsoundhelp.com/hc/en-us/articles/35854988839570-Getting-Started-with-the-API) explains that developer trial downloads and previews have lifetime limits and do not include a commercial publishing license. An existing personal subscription or account MCP key does not turn into a Developer Portal credential.

## Connection and transport

The host sends the key only in the MCP endpoint's `Authorization: Bearer …` header. It initializes a Streamable HTTP session, sends `notifications/initialized`, and obtains the current `tools/list` schema. Subsequent calls include the returned session ID. JSON-RPC responses may arrive as JSON or server-sent events.

A connection is confirmed only after an authenticated catalog request succeeds. Invalid credentials, cancellation, network failure, and an authenticated account without the needed tool must remain distinct outcomes. A search-capable account can still lack download entitlement: free accounts can search and preview, while downloads require an active paid subscription. An unsuccessful download does not by itself prove that the key is invalid.

Keys remain outside project manifests, transcripts, exported alignment, and portable audio folders. Credential entry passes through the typed preload to the host. Preview/download requests never attach the MCP key to CDN URLs.

## Current catalog capabilities

The following contract was inspected from the installed server's live tool schemas and verified with real catalog requests. These are the MCP fields, rather than superficially similar fields from the separate REST API.

| Area                  | Exposed capabilities                                                                                                                                                                                                      |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Music search          | Free text (`query.term`), descriptive topic (`query.topic`), or a Spotify reference (`query.externalID`); only one query mode at a time                                                                                   |
| Music taxonomy        | Genres, decades, and world-country styles through `taxonomySlugs`; moods through `moodSlugs`; featured instruments through `featuredInstrumentSlugs`; musical keys through `musicalKeys`; generic tags through `tagSlugs` |
| Other music criteria  | `artistSlugs`, boolean `vocals`, minimum/maximum BPM, and minimum/maximum duration in milliseconds                                                                                                                        |
| Music ordering        | Relevance, popularity, date, duration, title, or BPM; ascending or descending                                                                                                                                             |
| Sound effects         | Text search, category/tag slugs, minimum/maximum duration, and explicit recording IDs                                                                                                                                     |
| Sound-effect ordering | Relevance, popularity, date, duration, or title; ascending or descending                                                                                                                                                  |
| Match behavior        | Slug-list filters support `ANY`, `ALL`, and `NOT_ANY` in the server contract                                                                                                                                              |
| Pagination            | `first` and opaque `after` cursor; responses include `hasNextPage`, `endCursor`, and search totals                                                                                                                        |
| Similar audio         | `SearchSimilarToRecording` and `SearchSimilarToSoundEffect`, with their own cursors                                                                                                                                       |
| Reference discovery   | `SearchExternalReferences` resolves a description to Spotify track identifiers for a subsequent music search                                                                                                              |
| Preview               | Low-quality MP3 and waveform URLs returned with each recording/effect; the current result can play in the selection dialog                                                                                                |
| Import                | `DownloadRecording` and `DownloadSoundEffect` return signed high-quality asset URLs; file types are WAV or MP3                                                                                                            |
| Music stems           | High-quality download supports full mix, bass, drums, and instruments, intersected with the selected track's available stems                                                                                              |

Music metadata includes title, BPM, artist credits, cover art, duration, stems, and dimension-labelled tags. Effects include title, duration, waveform/preview URLs, and tags with exact slugs. Some search totals are capped at 10,000; that number is not necessarily the complete catalog size.

The music `vocals` filter is boolean. The MCP response does not expose the REST API's three-way `vocalType` filter. Metadata can describe melody or vocal preview stems even though the current high-quality download tool does not accept those stem types. They must not be offered as downloadable stems without a matching server capability.

## Where filter choices come from

The MCP server currently has **no taxonomy-list or curated-collections tool**. The app therefore includes a dated snapshot of factual category labels and canonical paths from Epidemic Sound's public catalog, in `src/shared/epidemicCatalog.ts`:

| Options                 | Public source                                                               | Snapshot                                                            |
| ----------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Genres                  | [Official genre index](https://www.epidemicsound.com/music/genres/)         | 398 canonical genre slugs                                           |
| Moods                   | [Official mood index](https://www.epidemicsound.com/music/moods/)           | 34 public mood slugs                                                |
| Sound-effect categories | [Official sound-effect index](https://www.epidemicsound.com/sound-effects/) | 779 canonical category paths, including parent and child categories |
| Themes                  | [Official theme index](https://www.epidemicsound.com/music/themes/)         | 37 topic suggestions derived from displayed theme names             |
| Instruments             | Live `SearchRecordings` schema examples                                     | Acoustic guitar, accordion, electronic drums                        |
| Musical keys            | Live `SearchRecordings` musical-key filters                                 | 24 individually verified major/minor keys                           |
| Decades                 | Live `SearchRecordings` taxonomy filters                                    | Eight verified decades, 1950s through 2020s                         |
| Regional styles         | Schema examples, verified through live taxonomy filters                     | African continent, Australia, Cuba, France; a documented subset     |

These public counts are not claims about the larger taxonomies returned by the Developer API. Genre and mood values come from actual canonical links, never by guessing a slug from its label: for example, R&B uses `rb`, and Busy & Frantic uses `busy-frantic`. Effect paths use their observed MCP separator, such as `swooshes--whoosh`; breadcrumb labels distinguish repeated leaf names such as “Misc.” Parent labels are also taken from the public index.

Themes invoke descriptive topic search. They do not load the website's playlists or pretend to be MCP collection identifiers. Instrument suggestions are deliberately limited to the three documented, live-verified examples because a complete instrument taxonomy is not exposed by this MCP server. The source pages, rather than invented option names, should be used when refreshing the snapshot.

Representative live verification covered genre `hip-hop` and `rb`, mood `laid-back` and `busy-frantic`, all three suggested instruments, and effect categories `ambience`, `swooshes--whoosh`, and `designed--riser`. Deliberately invalid music/effect slugs produced zero results, confirming that category filters were applied rather than silently ignored. All 24 musical-key values, the eight suggested decades, and the four regional-style examples were also individually verified against the live search service. Accidentals use service-specific canonical values such as `cs-minor`, `db-major`, and `fs-major`; guessed long forms such as `c-sharp-minor` produced zero results. No high-quality download was needed for this catalog verification.

## Failures, cancellation, and limits

MCP rate limits are not published. Respect HTTP `429` and any `Retry-After` header. A tool can also return `RETRY_LATER` with `retryAfterSeconds`, including reference searches still being resolved and temporarily unavailable downloads; do not immediately repeat those requests.

Use preview URLs for auditioning and request the high-quality download only after selection. Signed download URLs can expire; keep them transient and retain the imported local audio instead. Cancelling a search, preview preparation, or import must stop its request and prevent a late callback from changing another dialog or project tab.

The server also advertises track adaptation and voiceover generation. Those tools are separate workflows from this catalog/import integration; their availability is not implied by a successful search. The [current MCP limitations](https://developers.epidemicsound.com/docs/mcp/#known-limitations) include five-minute adapted tracks, one retrievable full mix per adaptation job, and connection-dependent polling support.
