# Default embedding model

This directory holds the bundled default embedding model for offline semantic
search. The model files are large and intentionally excluded from Git, so on a
fresh checkout this directory contains only this placeholder. Tauri's build
step requires the `resources/embedding-models/default/**/*` glob to match at
least one file, which is why this README is tracked.

The runtime detects the model's presence and reports the provider as
**unavailable** until the real files are dropped in, so the app runs normally
without them — semantic search is simply disabled.

## Enabling semantic search

Place the `intfloat/multilingual-e5-small` FastEmbed-compatible resources here:

```text
apps/desktop/src-tauri/resources/embedding-models/default/
  config.json
  neuink-embedding.json
  onnx/model.onnx
  sentencepiece.bpe.model
  special_tokens_map.json
  tokenizer.json
  tokenizer_config.json
```

These files are matched by the surrounding `.gitignore` rule and will not be
committed. After they are in place, restart the app and the embedding provider
becomes available automatically.
