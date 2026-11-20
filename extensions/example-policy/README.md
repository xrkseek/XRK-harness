# example-policy

Gold sample for process plugin `kind: policy`.

Merges a denylist rule for tool name `example_deny_me` into the Host policy engine.

```bash
xrkh plugin add ./extensions/example-policy
xrkh restart
```

See [docs/policy.md](../../docs/policy.md) · [docs/plugin-loader.md](../../docs/plugin-loader.md).
