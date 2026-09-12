# Oversell experiment results

Generated 2026-09-12T19:35:39.146Z · Node v24.21.0 · 8.2.6 single-node replica set (mongodb-memory-server) · darwin/arm64

## Experiment 1 — 500 buyers rush 100 seats (5 runs each)

| Implementation | Seats granted | Capacity | Worst oversell | Errors | Mean duration (ms) | Mean p95 latency (ms) |
| -------------- | ------------- | -------- | -------------- | ------ | ------------------ | --------------------- |
| naive          | 500           | 100      | 400            | 0      | 149                | 146                   |
| atomic-only    | 100           | 100      | 0              | 0      | 61                 | 59                    |
| gatherly       | 100           | 100      | 0              | 0      | 1759               | 1621                  |

## Experiment 2 — one user fires 20 parallel requests, limit 4 (5 runs each)

| Implementation | Seats granted | Limit | Worst over-limit | Errors | Mean duration (ms) | Mean p95 latency (ms) |
| -------------- | ------------- | ----- | ---------------- | ------ | ------------------ | --------------------- |
| naive          | 20            | 4     | 16               | 0      | 13                 | 13                    |
| atomic-only    | 20            | 4     | 16               | 0      | 12                 | 12                    |
| gatherly       | 4             | 4     | 0                | 0      | 512                | 512                   |
