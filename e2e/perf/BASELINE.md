# Loom browser benchmarks

Generated 2026-08-08T20:17:45.756Z — Chromium, `next start`, loopback.

## Transferred bytes per route

| target | js_kb | css_kb | total_kb | requests |
| --- | ---: | ---: | ---: | ---: |
| `/` | 660 | 22 | 748 | 61 |
| `/playground/chat` | 713 | 22 | 811 | 88 |
| `/logs` | 791 | 22 | 878 | 63 |
| `/providers` | 660 | 22 | 747 | 60 |
| `/settings` | 680 | 22 | 767 | 63 |

## navigation

| target | hops | p50_ms | worst_ms |
| --- | ---: | ---: | ---: |
| `SPA route transition` | 3 | 67 | 131 |

## memory

| target | before_mb | after_mb | growth_mb |
| --- | ---: | ---: | ---: |
| `5 streaming sends` | 12.1 | 12.1 | 0 |

## slow-device

| target | composer_visible_ms | fcp_ms | dcl_ms | interactions | inp_p50_ms | inp_p95_ms | inp_worst_ms | long_tasks | long_task_ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `/playground/chat @4x CPU` | 1132 | 916 | 395 |  |  |  |  |  |  |
| `typing during stream @4x CPU` |  |  |  | 97 | 24 | 72 | 104 | 2 | 156 |

## Streaming responsiveness

| target | interactions | inp_p50_ms | inp_p95_ms | inp_worst_ms | long_tasks | long_task_ms | typing_wall_ms | first_token_paint_ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `typing during stream` | 116 | 24 | 40 | 48 | 1 | 74 | 1118 |  |
| `first token painted` |  |  |  |  |  |  |  | 80 |

## Core Web Vitals (cold navigation, production build)

| target | ttfb_ms | fcp_ms | lcp_ms | cls | dcl_ms | long_tasks | long_task_ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `/playground/chat` | 5 | 208 | 260 | 0 | 71 | 1 | 74 |
| `/logs` | 2 | 188 | 288 | 0.0007 | 69 | 0 | 0 |
| `/providers` | 4 | 168 | 212 | 0 | 66 | 0 | 0 |
| `/mcp` | 5 | 156 | 156 | 0.0037 | 61 | 0 | 0 |
| `/settings` | 4 | 152 | 152 | 0 | 58 | 0 | 0 |

> Interaction-to-next-paint while streaming: **p95 40 ms** (good by Core Web Vitals thresholds).
